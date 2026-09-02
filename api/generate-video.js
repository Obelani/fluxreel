const { getAuthenticatedUser } = require('./_lib/auth');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { publishNextStep } = require('./_lib/qstash');
const { VISUAL_STYLES } = require('./_lib/visualStyles');

// Dispara a geração de um vídeo pra uma série já criada. Debita 1 crédito
// de forma atômica, cria a linha em `videos` e entrega a primeira etapa do
// pipeline pro QStash — o resto roda em background, essa function só
// confirma que começou (202) e devolve o video_id pro front acompanhar via
// Supabase Realtime.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const seriesId = req.body && req.body.series_id;
    if (!seriesId) {
      res.status(400).json({ error: 'series_id obrigatório' });
      return;
    }
    // Tema específico só pra esse vídeo (opcional) — sobrepõe o nicho da
    // série apenas na geração do roteiro dele, sem alterar a série.
    const customPrompt = typeof req.body.custom_prompt === 'string' ? req.body.custom_prompt.trim().slice(0, 2000) : null;
    // Estilo visual específico só pra esse vídeo (opcional) — sobrepõe o
    // estilo da série apenas na geração das imagens dele. Ignora valor
    // inválido em vez de guardar lixo no banco (a etapa de imagem já cai no
    // fallback se vier vazio, mas aqui é melhor nem persistir um id errado).
    const customStyleRaw = typeof req.body.custom_style === 'string' ? req.body.custom_style.trim() : null;
    const customStyle = customStyleRaw && VISUAL_STYLES[customStyleRaw] ? customStyleRaw : null;

    const supabase = getSupabaseAdmin();

    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id')
      .eq('id', seriesId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (seriesError) throw seriesError;
    if (!series) {
      res.status(404).json({ error: 'Série não encontrada' });
      return;
    }

    const { data: newBalance, error: debitError } = await supabase.rpc('debit_one_credit', {
      p_user_id: user.id,
    });
    if (debitError) throw debitError;
    if (newBalance === null) {
      res.status(402).json({ error: 'Créditos insuficientes' });
      return;
    }

    try {
      const { data: video, error: videoError } = await supabase
        .from('videos')
        .insert({ user_id: user.id, series_id: seriesId, status: 'queued', custom_prompt: customPrompt || null, custom_style: customStyle })
        .select('id')
        .single();
      if (videoError) throw videoError;

      await publishNextStep('/api/pipeline/script', { video_id: video.id });

      res.status(202).json({ video_id: video.id });
    } catch (innerErr) {
      // O crédito já foi debitado mas o pipeline não conseguiu nem começar
      // — devolve o crédito em vez de deixar o usuário no prejuízo.
      const { error: refundError } = await supabase.rpc('add_credits', {
        p_user_id: user.id,
        p_amount: 1,
      });
      if (refundError) console.error('[generate-video] Falha ao devolver crédito após erro:', refundError);
      throw innerErr;
    }
  } catch (err) {
    console.error('[generate-video] Falha inesperada:', err);
    res.status(500).json({ error: 'Falha inesperada no servidor: ' + err.message });
  }
};
