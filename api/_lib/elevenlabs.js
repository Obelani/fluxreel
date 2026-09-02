// Narração via ElevenLabs — usado por api/pipeline/narration.js na geração
// inicial, e por api/pipeline/captions.js quando precisa regenerar a
// narração mais curta (ver validação de duração real lá).
async function generateNarrationAudio(voiceId, text) {
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      // Valores testados manualmente no playground da ElevenLabs — deixam a
      // narração menos "lendo" e com mais entonação.
      voice_settings: { stability: 0.35, similarity_boost: 0.6, style: 0.43, speed: 1.2 },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(function () { return ''; });
    throw new Error('ElevenLabs respondeu ' + res.status + ': ' + errText.slice(0, 500));
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { generateNarrationAudio };
