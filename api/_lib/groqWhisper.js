// Transcrição com timestamp por palavra via Groq Whisper — usado por
// api/pipeline/captions.js na transcrição inicial e na re-transcrição
// depois de uma narração regenerada mais curta (ver validação de duração
// real em captions.js).
async function transcribeWithWordTimestamps(audioUrl) {
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error('Não foi possível baixar o áudio pra transcrever: ' + audioRes.status);
  const audioBuffer = await audioRes.arrayBuffer();

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'narration.mp3');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', 'pt');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(function () { return ''; });
    throw new Error('Groq respondeu ' + res.status + ': ' + errText.slice(0, 500));
  }
  return res.json();
}

module.exports = { transcribeWithWordTimestamps };
