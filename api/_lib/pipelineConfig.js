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

// Faixa de duração -> orçamento de palavras narradas (somando todas as
// cenas), pra o áudio final bater com o tempo escolhido no wizard. Baseado
// em ritmo médio de fala em português (~2.3-2.6 palavras/segundo) — sem
// isso, o Claude escrevia narração livre e o vídeo saía bem mais longo que
// o selecionado (ex.: "15-30s" virando 65s de vídeo).
const WORD_BUDGET_BY_DURATION = {
  '15-30': [35, 70],
  '30-40': [70, 100],
  '40-60': [95, 150],
  '60-90': [145, 220],
};

// Nome da voz escolhida no wizard -> voice_id da ElevenLabs.
const VOICE_IDS = {
  Rafael: 'orF2qy9215xjwqqxqsWW',
  Heitor: 'obFqURkm39iiEiDvnsdG',
  Vicente: 'bhehD3jAYQsch18622NF',
  Bianca: '9LwXyqQB0mUwtLRsS227',
  Clara: 'iScHbNW8K33gNo3lGgbo',
  Marcelo: 'jkiD8IhCU1i2V7VvmNwi',
  Silvio: 'EIkHVdkuarjkYUyMnoes',
  Leo: 'QyWUOLLpCqeUq1ZnuAup',
};

// Estilo visual escolhido -> ver api/_lib/visualStyles.js (catálogo
// centralizado dos 14 estilos, com prompt completo + regras negativas por
// estilo). Saiu daqui pra não duplicar/espalhar os prompts de imagem.

// Estilo de legenda escolhido -> cores do texto queimado no vídeo (via
// arquivo .ass, ver api/pipeline/render.js). Espelha o CSS do preview do
// wizard (create-series.html, classes .style-*.word.active) — fillColor é a
// cor da palavra "em repouso" (opacidade 100%), highlightTextColor/
// backgroundColor é o destaque da palavra sendo falada no momento
// (equivalente ao .word.active de cada estilo). A fonte é escolhida à parte
// (ver CAPTION_FONTS) — não faz parte do estilo de cor.
const CAPTION_STYLES = {
  classic: {
    fillColor: 'rgba(255,255,255,1)',
    highlightTextColor: '#FFFFFF',
  },
  'bold-yellow': {
    fillColor: 'rgba(255,255,255,1)',
    highlightTextColor: '#18181B',
    backgroundColor: '#FACC15',
  },
  neon: {
    fillColor: 'rgba(255,255,255,1)',
    highlightTextColor: '#20D9FF',
  },
  blackbox: {
    fillColor: 'rgba(255,255,255,1)',
    highlightTextColor: '#FFFFFF',
    backgroundColor: '#000000',
  },
  'gradient-word': {
    // Gradiente de verdade fica pra uma iteração futura do componente de
    // legenda — por enquanto aproxima com a cor cyan da marca.
    fillColor: 'rgba(255,255,255,1)',
    highlightTextColor: '#20D9FF',
  },
};

// Fonte escolhida no wizard pra legenda (independente do estilo de cor
// acima) -> arquivo(s) .ttf (em /fonts, baixados por URL em render.js já
// que a Vercel não inclui a pasta no bundle da function) + o nome de família
// exato gravado dentro do arquivo (precisa bater com o que o fontconfig/
// libass enxerga, não é só um rótulo nosso).
const CAPTION_FONTS = {
  montserrat: { label: 'Montserrat', fontFamily: 'Montserrat', bold: true, files: ['Montserrat-Bold.ttf'] },
  anton: { label: 'Anton', fontFamily: 'Anton', bold: false, files: ['Anton-Regular.ttf'] },
  bebas: { label: 'Bebas Neue', fontFamily: 'Bebas Neue', bold: false, files: ['BebasNeue-Regular.ttf'] },
  poppins: { label: 'Poppins', fontFamily: 'Poppins', bold: true, files: ['Poppins-Bold.ttf'] },
  oswald: { label: 'Oswald', fontFamily: 'Oswald', bold: true, files: ['Oswald-Bold.ttf'] },
};

module.exports = { SCENE_COUNT_BY_DURATION, WORD_BUDGET_BY_DURATION, VOICE_IDS, CAPTION_STYLES, CAPTION_FONTS };
