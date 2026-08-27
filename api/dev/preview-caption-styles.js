const { getAuthenticatedUser } = require('../_lib/auth');
const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { publishNextStep } = require('../_lib/qstash');

// Ferramenta de teste: reaproveita imagens/narração/legendas de um vídeo já
// pronto e dispara um novo render mostrando os 5 estilos de legenda
// empilhados ao mesmo tempo — só pra comparar visualmente, sem gastar
// crédito nem repetir as etapas caras (roteiro/imagens/narração/transcrição).
// Chamar com POST { video_id: '<id de um vídeo que já tem image_urls,
// audio_url e captions_json preenchidos>' }.
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

    const sourceVideoId = req.body && req.body.video_id;
    if (!sourceVideoId) {
      res.status(400).json({ error: 'video_id obrigatório (de um vídeo que já tem imagens/áudio/legendas prontos)' });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: source, error: sourceError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', sourceVideoId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source || !source.image_urls || !source.audio_url || !source.captions_json) {
      res.status(400).json({ error: 'Esse vídeo não tem imagens/áudio/legendas prontos pra reaproveitar' });
      return;
    }

    const { data: preview, error: previewError } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        series_id: source.series_id,
        status: 'rendering',
        script: source.script,
        image_urls: source.image_urls,
        audio_url: source.audio_url,
        captions_json: source.captions_json,
      })
      .select('id')
      .single();
    if (previewError) throw previewError;

    await publishNextStep('/api/pipeline/render', { video_id: preview.id, preview_all_styles: true });

    res.status(202).json({ video_id: preview.id });
  } catch (err) {
    console.error('[preview-caption-styles] Falha inesperada:', err);
    res.status(500).json({ error: 'Falha inesperada no servidor: ' + err.message });
  }
};
