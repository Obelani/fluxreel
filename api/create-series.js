const { getAuthenticatedUser } = require('./_lib/auth');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

// Salva a configuração que sai do wizard (create-series.html, etapas 1-7)
// assim que o usuário termina a etapa 7 — antes mesmo de abrir o paywall.
// Não custa crédito nenhum: é só a config da série, o vídeo em si só é
// gerado depois do pagamento confirmado (ver generate-video.js).
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

    const body = req.body || {};
    const required = ['name', 'niche', 'voice', 'style', 'captionStyle', 'duration'];
    for (const field of required) {
      if (!body[field]) {
        res.status(400).json({ error: 'Campo obrigatório ausente: ' + field });
        return;
      }
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('series')
      .insert({
        user_id: user.id,
        name: body.name,
        niche: body.niche,
        language: body.language || 'pt-BR',
        voice: body.voice,
        music: body.music || null,
        style: body.style,
        caption_style: body.captionStyle,
        glitch: !!body.glitch,
        hook: !!body.hook,
        duration_bucket: body.duration,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[create-series] Erro ao salvar série:', error);
      res.status(500).json({ error: 'Não foi possível salvar a série: ' + error.message });
      return;
    }

    res.status(200).json({ series_id: data.id });
  } catch (err) {
    console.error('[create-series] Falha inesperada:', err);
    res.status(500).json({ error: 'Falha inesperada no servidor: ' + err.message });
  }
};
