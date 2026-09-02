// Catálogo centralizado dos estilos visuais pra geração de imagens (fal.ai).
// Único lugar onde os prompts de estilo existem — nada disso deve ser
// duplicado ou reescrito em outro arquivo. Ver api/_lib/imagePrompt.js pra
// como cada estilo é combinado com a cena/personagens/universo no prompt
// final mandado pra API de imagem.
//
// Os IDs abaixo precisam bater exatamente com os values de `series.style`
// salvos pelo wizard (create-series.html, array STYLES) — são os mesmos 14
// estilos oferecidos lá, sem exceção.
//
// Os prompts em si são em INGLÊS (mesma convenção que já existia no
// projeto antes desse arquivo — modelos de imagem entendem inglês bem
// melhor que português) e escritos em estilo mais direto/tag-like — um
// primeiro teste real mostrou que frases longas em português diluíam a
// instrução de estilo e o resultado saía genérico/realista (ex.: Stickmans
// e Disney saindo foto realistas). O conteúdo/regras continuam os mesmos
// definidos originalmente, só a língua e o formato mudaram.
//
// Cada estilo tem 3 campos:
//   - label: nome exibido (não usado no prompt, só documentação/UI)
//   - prompt: prompt visual completo e positivo do estilo
//   - negativeRules: o que esse estilo especificamente NÃO pode conter,
//     mandado como uma seção própria do prompt final (a API de imagem do
//     fal.ai usada aqui não tem campo de negative_prompt dedicado — ver
//     api/_lib/imagePrompt.js).

const DEFAULT_STYLE_ID = 'modern-cartoon';

const VISUAL_STYLES = {
  comic: {
    id: 'comic',
    label: 'Comic',
    prompt:
      'MANDATORY VISUAL STYLE: COMIC BOOK.\n' +
      'Professional contemporary comic book illustration: bold black outlines, detailed inked linework, stylized anatomy, dramatic ink shading, solid flat colors, strong contrast, subtle halftone dots.\n' +
      'Graphic novel panel composition, cinematic framing, dynamic motion, clearly drawn expressions, instantly readable action.\n' +
      'Must look like an illustration originally created as a comic book. Keep this exact aesthetic in every scene.',
    negativeRules: 'No photography, no painting, no anime, no childish cartoon, no 3D render.',
  },

  'creepy-comic': {
    id: 'creepy-comic',
    label: 'Creepy Comic',
    prompt:
      'MANDATORY VISUAL STYLE: CREEPY HORROR COMIC.\n' +
      'Professional horror comic book illustration: irregular black linework, deep shadows, expressive slightly unsettling faces, dark environments, uncomfortable perspective, constant suspenseful atmosphere.\n' +
      'Desaturated colors, teal, gray, brown, dark green, small red accents. Lighting builds tension and highlights silhouettes, eyes and key elements.\n' +
      'Must look like a horror graphic novel panel. Can be scary, but without excessive graphic violence.',
    negativeRules: 'No photography, no anime, no childish cartoon, no 3D render.',
  },

  'modern-cartoon': {
    id: 'modern-cartoon',
    label: 'Modern Cartoon',
    prompt:
      'MANDATORY VISUAL STYLE: MODERN CARTOON.\n' +
      'Contemporary 2D digital illustration: clean expressive outlines, simplified shapes, vibrant colors, soft cel shading, slightly stylized character proportions.\n' +
      'Well-designed backgrounds, strong expressions, modern animated-series finish. Uniform linework, visually organized colors.\n' +
      'Keep the exact same character design in every scene.',
    negativeRules: 'No painterly texture, no photorealism, no anime aesthetic, no excessively childish look, no 3D render.',
  },

  // Nome "Disney" continua na interface, mas o prompt real é neutro (não
  // referencia a marca) — descrição de animação 3D familiar cinematográfica.
  disney: {
    id: 'disney',
    label: 'Disney',
    prompt:
      'MANDATORY VISUAL STYLE: CINEMATIC FAMILY 3D ANIMATION.\n' +
      'High-end animated feature film look: expressive characters, large natural eyes, rounded shapes, stylized anatomy, soft materials, well-defined hair, cinematic lighting, backgrounds rich in depth.\n' +
      'Must convey emotion, charm and premium animated-movie finish. Pleasant colors, cinematic composition, easily readable facial expressions.',
    negativeRules: 'No photography, no anime, no flat 2D drawing, no plastic toy look, no overly realistic human anatomy.',
  },

  mythology: {
    id: 'mythology',
    label: 'Mythology',
    prompt:
      'MANDATORY VISUAL STYLE: MYTHOLOGY.\n' +
      'Epic illustration inspired by ancient mythology: gods, heroes, warriors, monumental temples, ornate armor, noble fabrics, sculptures, lightning, fire, divine mist, mythological symbols.\n' +
      'Heroic composition, majestic proportions, celestial lighting, supernatural atmosphere, highly detailed. Combine epic digital painting with classical iconography.',
    negativeRules: 'No modern objects, no childish cartoon, no everyday photography, no science fiction, no clothing incompatible with the mythological setting.',
  },

  'pixel-art': {
    id: 'pixel-art',
    label: 'Pixel Art',
    prompt:
      'MANDATORY VISUAL STYLE: PIXEL ART.\n' +
      'Authentic 16-bit RPG pixel art: clearly visible square pixels, hard edges, detailed sprites, limited color palette, block-based shading, pixelated lighting.\n' +
      'Every element — characters, faces, clothes, objects, sky, particles, backgrounds — must be built entirely in pixel art. Must look hand-crafted pixel by pixel.',
    negativeRules: 'No smooth lines, no digital painting, no vector art, no photography, no blur, no anti-aliasing, no filters that only simulate pixels.',
  },

  stickmans: {
    id: 'stickmans',
    label: 'Stickmans',
    prompt:
      'MANDATORY VISUAL STYLE: STICK FIGURE (STICKMAN).\n' +
      'Minimalist illustration: characters made of a circular head and simple line-drawn limbs and body. Poses must be extremely clear, expressive and dynamic, instantly communicating the scene\'s action.\n' +
      'Plain paper-like light background, hand-drawn black strokes, minimal background lines, motion lines, small accent details in red, yellow or blue. Characters stay recognizable only through simple accessories and identifying colors.',
    negativeRules: 'No realistic human anatomy, no detailed faces, no complex clothing, no three-dimensional characters, no bulky/voluminous bodies.',
  },

  // Nome "Ghibli" continua na interface, mas o prompt real é neutro —
  // descrição de animação japonesa artesanal e acolhedora.
  ghibli: {
    id: 'ghibli',
    label: 'Ghibli',
    prompt:
      'MANDATORY VISUAL STYLE: HANDCRAFTED, WARM JAPANESE-STYLE ANIMATION.\n' +
      'Hand-drawn 2D illustration: delicately watercolor-painted backgrounds, lush nature, soft colors, natural light, contemplative atmosphere, gently expressive characters.\n' +
      'Organic textures, detailed scenery, small handcrafted imperfections, everyday sense of wonder. Must look like a classic hand-drawn Japanese animation frame.',
    negativeRules: 'No 3D render, no photorealism, no intense neon, no harsh outlines, no excessively dark aesthetic.',
  },

  anime: {
    id: 'anime',
    label: 'Anime',
    prompt:
      'MANDATORY VISUAL STYLE: ANIME.\n' +
      'High-quality 2D anime scene: clean lines, expressive eyes, hair drawn in defined strands, stylized anatomy, cel shading, dramatic lighting, cinematic composition.\n' +
      'Detailed backgrounds, intense expressions, dynamic camera angles. Keep the exact same character design, clothes and colors in every scene.',
    negativeRules: 'No photography, no 3D render, no western cartoon, no realistic painting, no childish watercolor, no chibi proportions unless explicitly requested.',
  },

  painting: {
    id: 'painting',
    label: 'Painting',
    prompt:
      'MANDATORY VISUAL STYLE: PAINTING.\n' +
      'Digital painting with an oil-on-canvas look: visible brushstrokes, natural color blending, artistic texture, classical lighting, atmospheric depth.\n' +
      'Faces, clothes, objects and backgrounds must show hand-painted detail, not a flawless photographic finish. Composition should look like a professional narrative painting.',
    negativeRules: 'No comic-book outlines, no cel shading, no pixel art, no 3D render, no vector art, no photo with just a filter applied.',
  },

  'dark-fantasy': {
    id: 'dark-fantasy',
    label: 'Dark Fantasy',
    prompt:
      'MANDATORY VISUAL STYLE: DARK FANTASY.\n' +
      'Cinematic dark fantasy illustration: gothic ruins, dead forests, worn armor, mist, threatening creatures, dark magic, dramatic low-contrast lighting.\n' +
      'Black, gray, deep blue, brown, small red or violet accents. Atmosphere must be oppressive, mysterious and epic, with detailed fantastical realism.',
    negativeRules: 'No cartoon, no excessively cheerful colors, no childish aesthetic, no bright anime, no excessive graphic violence.',
  },

  // Nome "Lego" continua na interface, mas o prompt real é neutro —
  // descrição de brinquedos de blocos plásticos, sem citar a marca.
  lego: {
    id: 'lego',
    label: 'Lego',
    prompt:
      'MANDATORY VISUAL STYLE: PLASTIC BRICK TOY DIORAMA.\n' +
      'Rebuild the entire scene as a diorama made of interlocking plastic bricks. Characters must have minifigure proportions, hook-shaped hands, articulated legs, printed faces, and accessories built from small pieces.\n' +
      'Glossy plastic, visible studs/connectors, macro-photography-style lighting, miniature depth of field. Every environment, vehicle, object and effect must be built out of bricks.',
    negativeRules: 'No real people, no human anatomy, no painting, no clay/playdough, no other toy types mixed in.',
  },

  realism: {
    id: 'realism',
    label: 'Realism',
    prompt:
      'MANDATORY VISUAL STYLE: REALISM.\n' +
      'Extremely realistic photographic image: correct human anatomy, natural skin, subtle pores, individual hair strands, convincing fabrics, physically accurate materials, plausible cinematic lighting.\n' +
      'Professional camera framing, natural depth of field, correct perspective, balanced colors. The scene must look like it was captured in the real world.',
    negativeRules: 'No drawn/illustrated look, no anime, no cartoon, no painting, no plastic-looking skin, no over-sharpening, no deformed anatomy, no artificial AI-generated look.',
  },

  fantastic: {
    id: 'fantastic',
    label: 'Fantastic',
    prompt:
      'MANDATORY VISUAL STYLE: FANTASTIC.\n' +
      'Luminous, spectacular fantasy scene: grand landscapes, impossible cities, magical ruins, fantastical creatures, light beams, glowing particles, intense colors.\n' +
      'Monumental scale, cinematic depth, constant sense of discovery. Aesthetic should read as premium, detailed, visually stunning fantasy concept art.',
    negativeRules: 'No predominantly dark horror, no everyday setting, no childish cartoon, no ordinary photography, no elements unrelated to the fantastical universe.',
  },
};

// Nunca escolhe outro estilo "no susto" se o id vier inválido/vazio —
// cai sempre no mesmo fallback explícito, e quem chamar isso deve logar o
// problema (ver getVisualStyle em uso em api/_lib/imagePrompt.js).
function getVisualStyle(styleId) {
  return VISUAL_STYLES[styleId] || VISUAL_STYLES[DEFAULT_STYLE_ID];
}

module.exports = { VISUAL_STYLES, DEFAULT_STYLE_ID, getVisualStyle };
