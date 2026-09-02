// Montagem centralizada do prompt final de cada imagem de cena — o único
// lugar do projeto que combina estilo visual + cena + personagens +
// universo + regras de consistência num prompt só. Nada disso deve ser
// remontado, resumido ou reescrito em nenhuma etapa depois (ver
// api/pipeline/images.js, o único chamador).
//
// A fal.ai/z-image/turbo (modelo usado aqui) não tem campo dedicado de
// negative_prompt nem aceita imagem de referência/seed de continuidade
// visual (confirmado na documentação da API) — por isso o "prompt
// negativo" abaixo é só texto dentro do mesmo prompt, não um parâmetro
// separado. `seed` é o único desses recursos que a API realmente suporta.
//
// Texto em inglês e o ESTILO vem primeiro no prompt final (não por último,
// como na primeira versão) — um teste real mostrou que estilos como
// Stickmans e Disney saíam foto realistas quando a instrução de estilo
// vinha em português e enterrada no meio de um bloco grande de
// cena/personagem/universo. Modelos de imagem entendem inglês bem melhor,
// e colocar o estilo logo no início evita que ele seja "diluído".

const { VISUAL_STYLES, DEFAULT_STYLE_ID, getVisualStyle } = require('./visualStyles');

// Bloco fixo, mandado em toda geração sem exceção.
const UNIVERSAL_NEGATIVE_PROMPT =
  'AVOID: mixing styles, changing artistic technique between scenes, inconsistent characters, changing face, changing age, changing hair, changing clothes, changing accessories, changing proportions, unjustified palette changes, deformed hands, extra fingers, duplicated limbs, incorrect anatomy, misaligned eyes, duplicated faces, objects floating without reason, text, letters, captions, speech bubbles, logos, watermarks, signatures, frames, app interfaces.';

// `characterBible` é um array de { id, description } — só os personagens
// PRESENTES na cena atual (filtrados antes de chegar aqui), nunca a lista
// completa da história inteira. `description` é a ficha visual fixa
// gerada uma única vez (ver api/pipeline/script.js) e reaproveitada
// literalmente em toda cena onde o personagem aparece — nunca reconstruída
// a partir do nome.
function formatCharacterBible(characterBible) {
  if (!characterBible || !characterBible.length) {
    return 'No fixed character appears in this scene.';
  }
  return characterBible
    .map(function (c) {
      var label = (c && (c.id || c.name)) || 'character';
      var description = (c && c.description) || '';
      return '- ' + label + ': ' + description;
    })
    .join('\n');
}

// Cena + personagens + universo + regras universais de consistência —
// tudo, exceto o estilo em si (que vai primeiro, fora dessa função, ver
// buildImagePrompt) e os blocos negativos (que vão por último).
function buildConsistencyBlock(opts) {
  var aspectRatio = opts.aspectRatio || '9:16';
  var environmentBible = (opts.environmentBible && opts.environmentBible.trim()) || 'No fixed world/setting description defined for this video.';

  return (
    'Create a ' + aspectRatio + ' vertical image for a video scene.\n' +
    'Current scene:\n' + opts.sceneDescription + '\n' +
    'Characters present:\n' + formatCharacterBible(opts.characterBible) + '\n' +
    'World and setting:\n' + environmentBible + '\n' +
    'Maintain absolute visual consistency with every other scene in this same video. All recurring characters must keep exactly the same face, age, skin tone, hair color and style, hairstyle, eye shape, body proportions, clothes, shoes, accessories and color palette.\n' +
    'Keep the same historical period, visual universe, architecture, objects, materials, dominant lighting and artistic language throughout the entire video.\n' +
    'Only pose, expression, framing and action may change from scene to scene. Do not redesign the characters and do not make any change that was not requested.\n' +
    'The chosen visual style is mandatory and must fill the entire image. Do not mix techniques or traits from other styles.'
  );
}

// Valida a entrada ANTES de gastar uma chamada de API — nunca falha
// silenciosamente trocando de estilo (isso é feito à parte, com log, em
// getVisualStyle/buildImagePrompt). Retorna um array de avisos (vazio =
// tudo certo); quem chama decide se algum deles deve travar a geração.
function validateImagePromptInput(opts) {
  opts = opts || {};
  var warnings = [];
  if (!opts.sceneDescription || !String(opts.sceneDescription).trim()) {
    warnings.push('sceneDescription ausente ou vazio.');
  }
  if (!opts.selectedVisualStyle || !VISUAL_STYLES[opts.selectedVisualStyle]) {
    warnings.push('selectedVisualStyle "' + opts.selectedVisualStyle + '" não existe no catálogo — vai cair no fallback "' + DEFAULT_STYLE_ID + '".');
  }
  if (!Array.isArray(opts.characterBible)) {
    warnings.push('characterBible não foi passado como array (pode ser [] se a cena não tiver personagem, mas precisa existir).');
  }
  return warnings;
}

// Função central: monta o prompt final de UMA cena. Ordem: estilo completo
// primeiro (parte 5 do pedido original, promovida pra frente por causa da
// diluição observada em teste real) -> formato/cena/personagens/universo +
// regras universais de consistência (partes 1-4) -> negativo universal
// (parte 6) -> negativo específico do estilo (parte 7). Nunca resume nem
// remove nada — cada bloco entra inteiro.
function buildImagePrompt(opts) {
  opts = opts || {};
  if (!opts.sceneDescription || !String(opts.sceneDescription).trim()) {
    throw new Error('buildImagePrompt: sceneDescription é obrigatório');
  }

  var style = getVisualStyle(opts.selectedVisualStyle);
  if (!opts.selectedVisualStyle || !VISUAL_STYLES[opts.selectedVisualStyle]) {
    console.warn('[imagePrompt] Estilo "' + opts.selectedVisualStyle + '" inválido/ausente — usando fallback "' + DEFAULT_STYLE_ID + '".');
  }

  var blocks = [
    style.prompt, // parte 5, promovida pro início
    buildConsistencyBlock(opts), // partes 1-4
    UNIVERSAL_NEGATIVE_PROMPT, // parte 6
    style.negativeRules, // parte 7
  ];

  return blocks.filter(Boolean).join('\n\n');
}

module.exports = {
  buildImagePrompt,
  validateImagePromptInput,
  formatCharacterBible,
  UNIVERSAL_NEGATIVE_PROMPT,
};
