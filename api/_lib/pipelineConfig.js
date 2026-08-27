// Dados de referência do pipeline de geração — nomes/valores que já existem
// no wizard (create-series.html) traduzidos pro que cada API externa espera.

// Duração escolhida no wizard -> número de cenas do roteiro. Baseado na
// tabela de custo do ViralIA (15-30s=5, 30-40s=7, 40-60s=9); 60-90s
// extrapolado seguindo o mesmo padrão (+2 cenas por faixa).
const SCENE_COUNT_BY_DURATION = {
  '15-30': 5,
  '30-40': 7,
  '40-60': 9,
  '60-90': 11,
};

// Nome da voz escolhida no wizard -> voice_id da ElevenLabs.
const VOICE_IDS = {
  Rafael: 'orF2qy9215xjwqqxqsWW',
  Heitor: 'obFqURkm39iiEiDvnsdG',
  Vicente: 'bhehD3jAYQsch18622NF',
  Bianca: '9LwXyqQB0mUwtLRsS227',
  Clara: 'iScHbNW8K33gNo3lGgbo',
};

// Estilo visual escolhido -> sufixo de prompt (em inglês, os modelos de
// imagem respondem melhor) pra geração de cada cena.
const STYLE_PROMPTS = {
  comic: 'comic book style illustration, bold outlines, vibrant colors',
  'creepy-comic': 'creepy horror comic book illustration, dark inking, unsettling atmosphere',
  'modern-cartoon': 'modern flat cartoon illustration, clean shapes, bright colors',
  disney: 'Disney animated movie style illustration, expressive characters, warm lighting',
  mythology: 'epic mythological painting style, dramatic lighting, classical composition',
  'pixel-art': 'detailed pixel art illustration, retro video game aesthetic',
  ghibli: 'Studio Ghibli inspired anime illustration, soft colors, whimsical atmosphere',
  anime: 'anime illustration style, detailed line art, vibrant cel shading',
  painting: 'oil painting style illustration, visible brush strokes, rich textures',
  'dark-fantasy': 'dark fantasy digital painting, moody atmosphere, dramatic shadows',
  lego: 'LEGO brick style 3D render, toy-like aesthetic, bright colors',
  realism: 'photorealistic digital illustration, cinematic lighting, high detail',
  fantastic: 'fantasy art illustration, magical atmosphere, vivid colors',
};

// Estilo de legenda escolhido -> estilo do texto queimado no vídeo
// (render-service/src/scenes/video.tsx, componente de legenda escrito à
// mão em cima do Revideo). Espelha o CSS do preview do wizard
// (create-series.html, classes .style-*.word.active, por volta da linha
// 229) — fillColor é a cor da palavra "em repouso" (branco apagado),
// highlightTextColor/backgroundColor é o destaque da palavra sendo falada
// no momento (equivalente ao .word.active de cada estilo).
const CAPTION_STYLES = {
  classic: {
    fontFamily: 'Montserrat', fontWeight: 700,
    fillColor: 'rgba(255,255,255,0.55)',
    highlightTextColor: '#FFFFFF',
  },
  'bold-yellow': {
    fontFamily: 'Montserrat', fontWeight: 900,
    fillColor: 'rgba(255,255,255,0.55)',
    highlightTextColor: '#18181B',
    backgroundColor: '#FACC15',
  },
  neon: {
    fontFamily: 'Montserrat', fontWeight: 700,
    fillColor: 'rgba(255,255,255,0.55)',
    highlightTextColor: '#20D9FF',
  },
  blackbox: {
    fontFamily: 'Montserrat', fontWeight: 700,
    fillColor: 'rgba(255,255,255,0.55)',
    highlightTextColor: '#FFFFFF',
    backgroundColor: '#000000',
  },
  'gradient-word': {
    // Gradiente de verdade fica pra uma iteração futura do componente de
    // legenda — por enquanto aproxima com a cor cyan da marca.
    fontFamily: 'Montserrat', fontWeight: 700,
    fillColor: 'rgba(255,255,255,0.55)',
    highlightTextColor: '#20D9FF',
  },
};

module.exports = { SCENE_COUNT_BY_DURATION, VOICE_IDS, STYLE_PROMPTS, CAPTION_STYLES };
