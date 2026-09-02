const Anthropic = require('@anthropic-ai/sdk');
const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { publishNextStep } = require('../_lib/qstash');
const { SCENE_COUNT_BY_DURATION, WORD_BUDGET_BY_DURATION } = require('../_lib/pipelineConfig');

// Precisa do corpo bruto pra verificar a assinatura do QStash.
module.exports.config = { api: { bodyParser: false } };

// Etapa 1 do pipeline: gera o roteiro (cena a cena) com Claude. Ao terminar,
// entrega a próxima etapa (imagens) pro QStash.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const supabase = getSupabaseAdmin();
  let payload;
  try {
    payload = await readVerifiedQstashPayload(req);
  } catch (err) {
    console.error('[pipeline/script] Payload/assinatura inválida:', err.message);
    res.status(401).end();
    return;
  }

  const videoId = payload.video_id;

  try {
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('*, series:series_id(*)')
      .eq('id', videoId)
      .single();
    if (videoError) throw videoError;

    await supabase.from('videos').update({ status: 'script', updated_at: new Date().toISOString() }).eq('id', videoId);

    const series = video.series;
    const sceneCount = SCENE_COUNT_BY_DURATION[series.duration_bucket] || 7;
    const wordBudget = WORD_BUDGET_BY_DURATION[series.duration_bucket] || [70, 100];

    // Outros vídeos já gerados nessa série — evita que o Claude converja
    // sempre pros mesmos temas "óbvios" do nicho quando o prompt é quase
    // idêntico a cada chamada (mesmo nicho, mesma instrução).
    const { data: priorVideos } = await supabase
      .from('videos')
      .select('script')
      .eq('series_id', series.id)
      .neq('id', videoId)
      .not('script', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);
    const usedTitles = (priorVideos || [])
      .map(function (v) { return v.script && v.script.title; })
      .filter(Boolean);

    const scriptTool = {
      name: 'roteiro_video',
      description: 'Roteiro de um vídeo curto para redes sociais, dividido em cenas.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título curto e chamativo do vídeo, em português.' },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: {
                  type: 'string',
                  enum: ['gancho', 'desenvolvimento', 'conclusao'],
                  description: 'Papel dessa cena na história: "gancho" (só a 1ª cena), "desenvolvimento" (cenas do meio) ou "conclusao" (só a(s) última(s) cena(s) — precisa fechar a história de vez).',
                },
                narration: { type: 'string', description: 'Texto narrado nessa cena, em português do Brasil, 1 a 3 frases. Na(s) cena(s) com role="conclusao", use um tom perceptivelmente mais pausado/reflexivo/conclusivo (frase mais curta, pontuação que sinalize fechamento) — diferente do ritmo do resto do vídeo.' },
                visual: { type: 'string', description: 'Descrição visual da cena, em inglês, para um gerador de imagem por IA.' },
              },
              required: ['role', 'narration', 'visual'],
            },
          },
        },
        required: ['title', 'scenes'],
      },
    };

    // Tema desse vídeo específico: o que o usuário digitou na hora de
    // clicar em "Gerar vídeo" (dashboard) tem prioridade sobre o nicho
    // padrão da série — permite pedir um tema pontual sem mexer na série.
    const nicheForPrompt = (video.custom_prompt && video.custom_prompt.trim()) || series.niche;

    const promptParts = [
      'Escreva o roteiro de um vídeo curto e viral para redes sociais (estilo TikTok/Reels/Shorts).',
      // nicheForPrompt costuma vir como frase completa (preset com descrição
      // rica, texto livre do "Personalizado" no wizard, ou o tema específico
      // pedido pra esse vídeo) — não força mais um "." no final, pra não
      // duplicar pontuação.
      'Nicho/tema deste vídeo: ' + nicheForPrompt.trim().replace(/[.!?]+$/, '') + '.',
      'Idioma da narração: português do Brasil.',
      'Divida em exatamente ' + sceneCount + ' cenas.',
      'Cada cena tem uma narração curta (1 a 3 frases) que prende a atenção, e uma descrição visual em inglês para gerar a imagem daquela cena.',
      'A primeira cena precisa ser um gancho forte que prenda a atenção nos primeiros segundos.',
      'As ' + sceneCount + ' cenas juntas formam uma história COMPLETA, com começo, meio e fim — planeje o arco inteiro antes de escrever, distribuindo o desenvolvimento e a conclusão dentro desse número exato de cenas.',
      'A última cena precisa fechar a história com uma conclusão clara (revelação, resolução, virada ou reflexão final) — nunca termine de forma abrupta, incompleta ou como se faltasse continuação.',
      'Marque o papel de cada cena no campo "role" (gancho/desenvolvimento/conclusao) — pense no arco completo ANTES de escrever a narração de cada uma. A narração da(s) cena(s) de conclusão precisa soar diferente do resto: tom mais pausado e reflexivo, frase mais curta, pontuação que sinalize o fechamento — como se a voz estivesse desacelerando pra encerrar, não continuando no mesmo ritmo do meio da história.',
      'MUITO IMPORTANTE: o total de palavras narradas somando TODAS as cenas precisa ficar entre ' + wordBudget[0] + ' e ' + wordBudget[1] + ' palavras — esse é o orçamento pra bater com a duração escolhida do vídeo. Não escreva mais que isso, mesmo que pareça pouco: ajuste o ritmo e a economia de palavras da história pra caber exatamente nesse limite, sem perder o começo-meio-fim.',
    ];
    if (usedTitles.length) {
      promptParts.push(
        'Essa série já publicou vídeos com estes títulos — escolha um tema e um ângulo diferentes de todos eles, sem repetir a mesma história/fato/curiosidade: ' +
        usedTitles.map(function (t) { return '"' + t + '"'; }).join(', ') + '.'
      );
    }
    const prompt = promptParts.join(' ');

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      tools: [scriptTool],
      tool_choice: { type: 'tool', name: 'roteiro_video' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find(function (block) { return block.type === 'tool_use'; });
    if (!toolUse) throw new Error('Claude não retornou o roteiro no formato esperado');
    const scriptData = toolUse.input;
    if (!scriptData.scenes || !scriptData.scenes.length) throw new Error('Roteiro veio sem cenas');

    await supabase
      .from('videos')
      .update({ script: scriptData, status: 'images', updated_at: new Date().toISOString() })
      .eq('id', videoId);

    await publishNextStep('/api/pipeline/images', { video_id: videoId });

    res.status(200).json({ ok: true });
  } catch (err) {
    await markVideoFailed(supabase, videoId, err.message);
    // 200 mesmo em erro: já tratamos (marcamos falho + devolvemos crédito),
    // não queremos que o QStash reentregue e gaste crédito de API de novo.
    res.status(200).json({ ok: false });
  }
};
