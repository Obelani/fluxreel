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

const { VISUAL_STYLES, DEFAULT_STYLE_ID, getVisualStyle } = require('./visualStyles');

// Bloco fixo, mandado em toda geração sem exceção.
const UNIVERSAL_NEGATIVE_PROMPT =
  'EVITAR: mistura de estilos, mudança de técnica artística entre cenas, personagens inconsistentes, alteração de rosto, mudança de idade, mudança de cabelo, mudança de roupas, mudança de acessórios, mudança de proporções, mudança injustificada de paleta, mãos deformadas, dedos extras, membros duplicados, anatomia incorreta, olhos desalinhados, rostos duplicados, objetos flutuando sem motivo, textos, letras, legendas, balões de fala, logotipos, marcas-d\'água, assinaturas, molduras e interfaces de aplicativo.';

// `characterBible` é um array de { id, description } — só os personagens
// PRESENTES na cena atual (filtrados antes de chegar aqui), nunca a lista
// completa da história inteira. `description` é a ficha visual fixa
// gerada uma única vez (ver api/pipeline/script.js) e reaproveitada
// literalmente em toda cena onde o personagem aparece — nunca reconstruída
// a partir do nome.
function formatCharacterBible(characterBible) {
  if (!characterBible || !characterBible.length) {
    return 'Nenhum personagem fixo aparece nesta cena.';
  }
  return characterBible
    .map(function (c) {
      var label = (c && (c.id || c.name)) || 'Personagem';
      var description = (c && c.description) || '';
      return '- ' + label + ': ' + description;
    })
    .join('\n');
}

// Partes 1-4 da estrutura pedida (formato/finalidade, cena, personagens,
// regras universais de consistência) — texto fixo, só os trechos entre
// colchetes do original são interpolados.
function buildConsistencyBlock(opts) {
  var aspectRatio = opts.aspectRatio || '9:16';
  var aspectLabel = aspectRatio === '9:16' ? 'vertical 9:16' : aspectRatio;
  var environmentBible = (opts.environmentBible && opts.environmentBible.trim()) || 'Sem descrição fixa de universo definida para este vídeo.';

  return (
    'Crie uma imagem ' + aspectLabel + ' para uma cena de vídeo.\n' +
    'Descrição da cena atual:\n' + opts.sceneDescription + '\n' +
    'Personagens presentes:\n' + formatCharacterBible(opts.characterBible) + '\n' +
    'Universo e ambientes:\n' + environmentBible + '\n' +
    'Mantenha consistência visual absoluta com todas as outras cenas do mesmo vídeo. Todos os personagens recorrentes devem conservar exatamente o mesmo rosto, idade, cor de pele, cabelo, penteado, formato dos olhos, proporções corporais, roupas, calçados, acessórios e paleta de cores.\n' +
    'Mantenha o mesmo período histórico, universo visual, arquitetura, objetos, materiais, iluminação predominante e linguagem artística durante todo o vídeo.\n' +
    'Apenas a pose, a expressão, o enquadramento e a ação podem mudar conforme a cena. Não redesenhe os personagens e não faça alterações que não tenham sido solicitadas.\n' +
    'O estilo visual escolhido é obrigatório e deve ocupar toda a imagem. Não misture técnicas ou características de outros estilos.'
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

// Função central: monta o prompt final de UMA cena, já com os 7 blocos
// pedidos (formato/cena/personagens -> regras universais -> estilo
// completo -> negativo universal -> negativo específico do estilo).
// Nunca resume nem remove nada — cada bloco entra inteiro.
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
    buildConsistencyBlock(opts), // partes 1-4
    style.prompt, // parte 5
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
