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
      'ESTILO VISUAL OBRIGATÓRIO: COMIC.\n' +
      'Produza uma ilustração profissional de história em quadrinhos contemporânea, com contornos pretos firmes, desenho detalhado, anatomia estilizada, sombras dramáticas feitas com tinta, cores sólidas, contraste forte e discretas retículas de impressão.\n' +
      'A composição deve parecer um painel de graphic novel, com enquadramento cinematográfico, movimento visual, expressões claramente desenhadas e leitura imediata da ação.\n' +
      'A imagem precisa parecer uma ilustração criada originalmente como história em quadrinhos. Preserve exatamente essa estética em todas as cenas.',
    negativeRules: 'Não utilize fotografia, pintura, anime, cartoon infantil ou renderização 3D.',
  },

  'creepy-comic': {
    id: 'creepy-comic',
    label: 'Creepy Comic',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: CREEPY COMIC.\n' +
      'Produza uma ilustração profissional de quadrinhos de terror, com linhas pretas irregulares, sombras profundas, rostos expressivos e levemente perturbadores, ambientes escuros, perspectiva desconfortável e atmosfera constante de suspense.\n' +
      'Utilize cores dessaturadas, azul-petróleo, cinza, marrom, verde escuro e pequenos detalhes vermelhos. A iluminação deve criar tensão e destacar silhuetas, olhos e elementos importantes.\n' +
      'A imagem deve parecer um painel de horror graphic novel. O resultado pode ser assustador, mas sem violência gráfica excessiva.',
    negativeRules: 'Não utilize fotografia, anime, cartoon infantil ou renderização 3D.',
  },

  'modern-cartoon': {
    id: 'modern-cartoon',
    label: 'Modern Cartoon',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: MODERN CARTOON.\n' +
      'Produza uma ilustração digital 2D contemporânea, com contornos limpos e expressivos, formas simplificadas, cores vibrantes, sombreamento cel shading suave e personagens com proporções levemente estilizadas.\n' +
      'Utilize cenários bem desenhados, expressões marcantes e acabamento de série animada moderna. As linhas devem ser uniformes e as cores visualmente organizadas.\n' +
      'Preserve o mesmo design dos personagens em todas as cenas.',
    negativeRules: 'Não utilize textura de pintura, realismo fotográfico, estética de anime, aparência infantil excessiva ou renderização 3D.',
  },

  // Nome "Disney" continua na interface, mas o prompt real é neutro (não
  // referencia a marca) — descrição de animação 3D familiar cinematográfica.
  disney: {
    id: 'disney',
    label: 'Disney',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: ANIMAÇÃO 3D FAMILIAR CINEMATOGRÁFICA.\n' +
      'Produza uma cena com aparência de longa-metragem de animação 3D familiar, com personagens expressivos, olhos grandes e naturais, formas arredondadas, anatomia estilizada, materiais suaves, cabelos bem definidos, iluminação cinematográfica e cenários ricos em profundidade.\n' +
      'A imagem deve transmitir emoção, carisma e acabamento premium de cinema de animação. Utilize cores agradáveis, composição cinematográfica e expressões faciais de fácil compreensão.',
    negativeRules: 'Não utilize fotografia, anime, desenho 2D, aparência de brinquedo plástico ou anatomia excessivamente realista.',
  },

  mythology: {
    id: 'mythology',
    label: 'Mythology',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: MYTHOLOGY.\n' +
      'Produza uma ilustração épica inspirada em mitologias antigas, com deuses, heróis, guerreiros, templos monumentais, armaduras ornamentadas, tecidos nobres, esculturas, raios, fogo, névoa divina e símbolos mitológicos.\n' +
      'Utilize composição heroica, proporções majestosas, iluminação celestial, atmosfera sobrenatural e alto nível de detalhes. A estética deve combinar pintura digital épica e iconografia clássica.',
    negativeRules: 'Não utilize objetos modernos, cartoon infantil, fotografia cotidiana, ficção científica ou roupas incompatíveis com o universo mitológico da cena.',
  },

  'pixel-art': {
    id: 'pixel-art',
    label: 'Pixel Art',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: PIXEL ART.\n' +
      'Produza uma autêntica ilustração pixel art de RPG 16-bit, com pixels quadrados claramente visíveis, bordas rígidas, sprites detalhados, paleta limitada, sombreamento construído com blocos de cor e iluminação pixelizada.\n' +
      'Todos os elementos da imagem, incluindo personagens, rostos, roupas, objetos, céu, partículas e cenários, devem ser construídos integralmente em pixel art. A imagem deve parecer criada manualmente pixel por pixel.',
    negativeRules: 'Não utilize linhas suaves, pintura digital, vetores, fotografia, desfoque, anti-aliasing ou filtros que apenas simulem pixels.',
  },

  stickmans: {
    id: 'stickmans',
    label: 'Stickmans',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: STICKMAN.\n' +
      'Produza uma ilustração minimalista com personagens formados por cabeças circulares e corpos construídos com linhas simples. As poses devem ser muito claras, expressivas e dinâmicas, comunicando perfeitamente a ação da cena.\n' +
      'Utilize fundo claro semelhante a papel, traços pretos desenhados à mão, poucas linhas de cenário, efeitos de movimento e pequenos detalhes em vermelho, amarelo ou azul. Todos os personagens devem permanecer reconhecíveis por acessórios simples e cores identificadoras.',
    negativeRules: 'Não desenhe anatomia humana realista, rostos detalhados, roupas complexas, personagens tridimensionais ou corpos volumosos.',
  },

  // Nome "Ghibli" continua na interface, mas o prompt real é neutro —
  // descrição de animação japonesa artesanal e acolhedora.
  ghibli: {
    id: 'ghibli',
    label: 'Ghibli',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: ANIMAÇÃO JAPONESA ARTESANAL E ACOLHEDORA.\n' +
      'Produza uma ilustração 2D desenhada à mão, com fundos delicadamente pintados em aquarela, natureza exuberante, cores suaves, luz natural, atmosfera contemplativa e personagens com expressões gentis.\n' +
      'Utilize texturas orgânicas, cenários detalhados, pequenas imperfeições artesanais e sensação de encantamento cotidiano. A imagem deve parecer um frame tradicional de animação japonesa clássica.',
    negativeRules: 'Não utilize renderização 3D, realismo fotográfico, neon intenso, contornos agressivos ou estética sombria excessiva.',
  },

  anime: {
    id: 'anime',
    label: 'Anime',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: ANIME.\n' +
      'Produza uma cena de anime 2D de alta qualidade, com linhas limpas, olhos expressivos, cabelos desenhados em mechas definidas, anatomia estilizada, cel shading, luz dramática e composição cinematográfica.\n' +
      'Utilize fundos detalhados, expressões intensas e ângulos de câmera dinâmicos. Preserve exatamente o design, as roupas e as cores dos personagens em todas as cenas.',
    negativeRules: 'Não utilize fotografia, renderização 3D, cartoon ocidental, pintura realista, aquarela infantil ou proporções chibi, salvo quando isso for solicitado explicitamente.',
  },

  painting: {
    id: 'painting',
    label: 'Painting',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: PAINTING.\n' +
      'Produza uma pintura digital com aparência de óleo sobre tela, pinceladas visíveis, mistura natural de cores, textura artística, iluminação clássica e profundidade atmosférica.\n' +
      'Rostos, roupas, objetos e cenários devem apresentar detalhes pintados manualmente, sem acabamento fotográfico perfeito. A composição deve parecer uma pintura narrativa profissional.',
    negativeRules: 'Não utilize contornos de quadrinhos, cel shading, pixel art, renderização 3D, vetores ou aparência de fotografia tratada apenas com um filtro.',
  },

  'dark-fantasy': {
    id: 'dark-fantasy',
    label: 'Dark Fantasy',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: DARK FANTASY.\n' +
      'Produza uma ilustração cinematográfica de fantasia sombria, com ruínas góticas, florestas mortas, armaduras desgastadas, névoa, criaturas ameaçadoras, magia obscura e iluminação dramática de baixo contraste.\n' +
      'Utilize preto, cinza, azul profundo, marrom e pequenos detalhes vermelhos ou violetas. A atmosfera deve ser opressiva, misteriosa e épica, com realismo fantástico detalhado.',
    negativeRules: 'Não utilize cartoon, cores excessivamente alegres, estética infantil, anime brilhante ou violência gráfica excessiva.',
  },

  // Nome "Lego" continua na interface, mas o prompt real é neutro —
  // descrição de brinquedos de blocos plásticos, sem citar a marca.
  lego: {
    id: 'lego',
    label: 'Lego',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: BRINQUEDOS DE BLOCOS PLÁSTICOS.\n' +
      'Reconstrua toda a cena como uma maquete feita com blocos plásticos de encaixe. Os personagens devem possuir formato de minifiguras, mãos em formato de gancho, pernas articuladas, rostos impressos e acessórios construídos com pequenas peças.\n' +
      'Utilize plástico brilhante, encaixes visíveis, iluminação de fotografia macro e profundidade de campo de miniatura. Todos os ambientes, veículos, objetos e efeitos devem ser construídos com blocos.',
    negativeRules: 'Não misture pessoas reais, anatomia humana, pintura, massinha ou outros tipos de brinquedo.',
  },

  realism: {
    id: 'realism',
    label: 'Realism',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: REALISM.\n' +
      'Produza uma imagem fotográfica extremamente realista, com anatomia humana correta, pele natural, poros discretos, cabelos individuais, tecidos convincentes, materiais fisicamente precisos e iluminação cinematográfica plausível.\n' +
      'Utilize enquadramento de câmera profissional, profundidade de campo natural, perspectiva correta e cores equilibradas. A cena deve parecer registrada no mundo real.',
    negativeRules: 'Não utilize aparência de desenho, anime, cartoon, pintura, pele plástica, excesso de nitidez, anatomia deformada ou aparência artificial de imagem gerada por inteligência artificial.',
  },

  fantastic: {
    id: 'fantastic',
    label: 'Fantastic',
    prompt:
      'ESTILO VISUAL OBRIGATÓRIO: FANTASTIC.\n' +
      'Produza uma cena de fantasia luminosa e espetacular, com paisagens grandiosas, cidades impossíveis, ruínas mágicas, criaturas fantásticas, feixes de luz, partículas brilhantes e cores intensas.\n' +
      'Utilize escala monumental, profundidade cinematográfica e sensação constante de descoberta. A estética deve ser de concept art fantástico premium, detalhado e visualmente deslumbrante.',
    negativeRules: 'Não utilize terror sombrio predominante, cenário cotidiano, cartoon infantil, fotografia comum ou elementos sem relação com o universo fantástico.',
  },
};

// Nunca escolhe outro estilo "no susto" se o id vier inválido/vazio —
// cai sempre no mesmo fallback explícito, e quem chamar isso deve logar o
// problema (ver getVisualStyle em uso em api/_lib/imagePrompt.js).
function getVisualStyle(styleId) {
  return VISUAL_STYLES[styleId] || VISUAL_STYLES[DEFAULT_STYLE_ID];
}

module.exports = { VISUAL_STYLES, DEFAULT_STYLE_ID, getVisualStyle };
