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

// Estilo de legenda escolhido -> estilo do texto queimado no vídeo (Creatomate).
// Usa o recurso nativo de transcript (transcript_effect + transcript_source)
// da Creatomate — um único elemento de texto anima palavra por palavra
// sozinho, em vez de a gente montar dezenas de blocos de texto manualmente.
const CAPTION_STYLES = {
  classic: {
    font_family: 'Arial', font_weight: '700', fill_color: '#FFFFFF',
    stroke_color: '#000000', stroke_width: '1.4 vmin',
    transcript_effect: 'highlight', transcript_color: '#FFD500',
  },
  'bold-yellow': {
    font_family: 'Arial', font_weight: '900', fill_color: '#FFD500',
    stroke_color: '#000000', stroke_width: '1.8 vmin',
    transcript_effect: 'highlight', transcript_color: '#FFFFFF',
  },
  neon: {
    font_family: 'Arial', font_weight: '800', fill_color: '#20D9FF',
    stroke_color: '#0A2A33', stroke_width: '1.4 vmin',
    transcript_effect: 'highlight', transcript_color: '#FF3DAD',
  },
  blackbox: {
    font_family: 'Arial', font_weight: '700', fill_color: '#FFFFFF',
    background_color: 'rgba(0,0,0,0.75)', background_x_padding: '18%', background_y_padding: '12%', background_border_radius: '20%',
    transcript_effect: 'highlight', transcript_color: '#FFD500',
  },
  'gradient-word': {
    font_family: 'Arial', font_weight: '800', fill_color: '#4F6BFF',
    stroke_color: '#000000', stroke_width: '1.4 vmin',
    transcript_effect: 'karaoke', transcript_color: '#20D9FF',
  },
};

module.exports = { SCENE_COUNT_BY_DURATION, VOICE_IDS, STYLE_PROMPTS, CAPTION_STYLES };
