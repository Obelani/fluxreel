import express from 'express';
import { renderVideo } from '@revideo/renderer';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 4000;
const RENDER_SECRET = process.env.RENDER_SERVICE_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = 'media';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados nas secrets do Fly.io.');
}
// `createClient` sempre inicializa um RealtimeClient internamente, mesmo
// sem a gente usar Realtime aqui — no Node 20 (sem WebSocket nativo) isso
// derruba o processo no boot sem o transport `ws` explícito.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as any },
});

// Chamado por api/pipeline/render.js (Vercel). Autenticado por segredo
// compartilhado — não é um endpoint público. Responde 202 na hora e faz o
// render em segundo plano, escrevendo o resultado direto no Supabase
// quando termina (sem precisar de webhook de volta pra Vercel).
app.post('/render', async (req, res) => {
  if (RENDER_SECRET && req.headers['authorization'] !== 'Bearer ' + RENDER_SECRET) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  const body = req.body || {};
  const videoId = body.video_id;
  if (!videoId) {
    res.status(400).json({ error: 'video_id obrigatório' });
    return;
  }

  res.status(202).json({ ok: true });
  renderAndPublish(videoId, body).catch((err) => {
    console.error('[render-service] Erro não tratado renderizando', videoId, err);
  });
});

async function renderAndPublish(videoId, body) {
  const outDir = path.join('/tmp', 'renders');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, videoId + '.mp4');

  try {
    await renderVideo({
      projectFile: path.join(process.cwd(), 'src', 'project.ts'),
      variables: {
        imageUrls: body.image_urls || [],
        sceneDurations: body.scene_durations || [],
        audioUrl: body.audio_url || '',
        musicUrl: body.music_url || null,
        words: body.words || [],
        style: body.style || undefined,
      },
      settings: {
        outFile: outPath,
        dimensions: [1080, 1920],
      },
    });

    const fileBuffer = fs.readFileSync(outPath);
    const storagePath = 'videos/' + videoId + '.mp4';
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileBuffer, { contentType: 'video/mp4', upsert: true });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

    await supabase
      .from('videos')
      .update({ video_url: publicUrlData.publicUrl, status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', videoId);
  } catch (err) {
    console.error('[render-service] Falha ao renderizar', videoId, err);
    await markVideoFailed(videoId, err);
  } finally {
    fs.rmSync(outPath, { force: true });
  }
}

// Mesma lógica de api/_lib/pipelineStage.js do lado da Vercel: marca o
// vídeo como falho e devolve o crédito, checando o status atual antes pra
// não devolver duas vezes.
async function markVideoFailed(videoId, err) {
  const { data: video } = await supabase.from('videos').select('user_id, status').eq('id', videoId).maybeSingle();

  await supabase
    .from('videos')
    .update({
      status: 'failed',
      error_message: String((err && err.message) || err).slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', videoId);

  if (video && video.status !== 'failed') {
    const { error: refundError } = await supabase.rpc('add_credits', { p_user_id: video.user_id, p_amount: 1 });
    if (refundError) console.error('[render-service] Falha ao devolver crédito', videoId, refundError);
  }
}

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.listen(PORT, () => {
  console.log('[render-service] Ouvindo na porta ' + PORT);
});
