// Testes do catálogo de estilos visuais + montagem do prompt de imagem.
// Sem framework de teste — só node:assert, seguindo o padrão do resto do
// projeto (sem build step, dependências mínimas). Roda com:
//
//   node scripts/test-visual-styles.js
//
// Não depende de nenhuma API externa (fal.ai, Claude, Supabase) — testa só
// a montagem de texto em api/_lib/visualStyles.js e api/_lib/imagePrompt.js.

const assert = require('node:assert/strict');
const {
  VISUAL_STYLES,
  DEFAULT_STYLE_ID,
  getVisualStyle,
} = require('../api/_lib/visualStyles');
const {
  buildImagePrompt,
  validateImagePromptInput,
  UNIVERSAL_NEGATIVE_PROMPT,
} = require('../api/_lib/imagePrompt');

const EXPECTED_STYLE_IDS = [
  'comic', 'creepy-comic', 'modern-cartoon', 'disney', 'mythology',
  'pixel-art', 'stickmans', 'ghibli', 'anime', 'painting',
  'dark-fantasy', 'lego', 'realism', 'fantastic',
];

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (err) {
    console.error('  FALHOU - ' + name);
    console.error('    ' + err.message);
    process.exitCode = 1;
  }
}

console.log('Catálogo de estilos visuais (api/_lib/visualStyles.js)');

test('1. Todos os 14 estilos estão cadastrados', () => {
  assert.equal(Object.keys(VISUAL_STYLES).length, 14);
  EXPECTED_STYLE_IDS.forEach((id) => assert.ok(VISUAL_STYLES[id], 'faltando: ' + id));
});

test('2. Cada estilo possui um ID único (bate com a chave do objeto)', () => {
  Object.keys(VISUAL_STYLES).forEach((key) => {
    assert.equal(VISUAL_STYLES[key].id, key);
  });
});

test('3. Cada estilo possui um prompt completo (não vazio, com conteúdo real)', () => {
  Object.values(VISUAL_STYLES).forEach((style) => {
    assert.ok(style.prompt && style.prompt.length > 100, style.id + ' com prompt curto/vazio demais');
    assert.ok(style.negativeRules && style.negativeRules.length > 10, style.id + ' sem negativeRules');
  });
});

test('11. Disney, Ghibli e Lego usam descrições visuais neutras (sem citar a marca)', () => {
  assert.ok(!/disney/i.test(VISUAL_STYLES.disney.prompt), 'prompt do "disney" não pode citar a marca');
  assert.ok(!/ghibli|studio ghibli/i.test(VISUAL_STYLES.ghibli.prompt), 'prompt do "ghibli" não pode citar o estúdio');
  assert.ok(!/\blego\b/i.test(VISUAL_STYLES.lego.prompt), 'prompt do "lego" não pode citar a marca');
  // O label (nome exibido na interface) continua podendo usar o nome comum.
  assert.equal(VISUAL_STYLES.disney.label, 'Disney');
  assert.equal(VISUAL_STYLES.ghibli.label, 'Ghibli');
  assert.equal(VISUAL_STYLES.lego.label, 'Lego');
});

test('10. Estilo inválido aciona o fallback explícito (Modern Cartoon), sem escolher outro silenciosamente', () => {
  assert.equal(DEFAULT_STYLE_ID, 'modern-cartoon');
  const fallback = getVisualStyle('estilo-que-nao-existe');
  assert.equal(fallback.id, DEFAULT_STYLE_ID);
  const fallbackVazio = getVisualStyle(undefined);
  assert.equal(fallbackVazio.id, DEFAULT_STYLE_ID);
});

console.log('\nMontagem do prompt final (api/_lib/imagePrompt.js)');

const sampleCharacter = {
  id: 'hero',
  description: 'Young woman, early 20s, olive skin, curly red hair shoulder-length, green eyes, wearing a worn brown leather jacket and dark jeans, silver pendant necklace.',
};
const sampleEnvironment = 'Rain-soaked cyberpunk city at night, neon signs in Portuguese and Japanese, wet asphalt reflections, year 2088.';

test('4. O prompt completo do estilo escolhido aparece no prompt final', () => {
  const output = buildImagePrompt({
    sceneDescription: 'The hero looks up at a giant hologram billboard.',
    characterBible: [sampleCharacter],
    environmentBible: sampleEnvironment,
    selectedVisualStyle: 'anime',
    aspectRatio: '9:16',
  });
  assert.ok(output.includes(VISUAL_STYLES.anime.prompt), 'prompt do estilo "anime" não apareceu por inteiro no resultado');
});

test('5. O bloco universal de consistência aparece no prompt de toda cena', () => {
  const output = buildImagePrompt({
    sceneDescription: 'Any scene.',
    characterBible: [],
    environmentBible: sampleEnvironment,
    selectedVisualStyle: 'comic',
  });
  assert.ok(output.includes('Mantenha consistência visual absoluta com todas as outras cenas do mesmo vídeo.'));
  assert.ok(output.includes('O estilo visual escolhido é obrigatório e deve ocupar toda a imagem.'));
});

test('6. O prompt negativo universal aparece no prompt de toda cena', () => {
  const output = buildImagePrompt({
    sceneDescription: 'Any scene.',
    characterBible: [],
    environmentBible: sampleEnvironment,
    selectedVisualStyle: 'realism',
  });
  assert.ok(output.includes(UNIVERSAL_NEGATIVE_PROMPT));
});

test('7. A ficha do personagem é reproduzida IDÊNTICA em cenas diferentes (nunca reconstruída)', () => {
  const cena1 = buildImagePrompt({
    sceneDescription: 'The hero walks into a dark alley.',
    characterBible: [sampleCharacter],
    environmentBible: sampleEnvironment,
    selectedVisualStyle: 'anime',
  });
  const cena2 = buildImagePrompt({
    sceneDescription: 'The hero finds a hidden door.',
    characterBible: [sampleCharacter],
    environmentBible: sampleEnvironment,
    selectedVisualStyle: 'anime',
  });
  // .includes() com o texto exato da ficha já garante reprodução
  // caractere-por-caractere — se o modelo/lógica tivesse reescrito ou
  // resumido a ficha em qualquer uma das cenas, essa checagem falharia.
  assert.ok(cena1.includes(sampleCharacter.description), 'ficha do personagem não apareceu idêntica na cena 1');
  assert.ok(cena2.includes(sampleCharacter.description), 'ficha do personagem não apareceu idêntica na cena 2');
});

test('8. Trocar de cena não altera o estilo selecionado', () => {
  const base = { characterBible: [], environmentBible: sampleEnvironment, selectedVisualStyle: 'pixel-art' };
  const cenaA = buildImagePrompt(Object.assign({ sceneDescription: 'Scene A.' }, base));
  const cenaB = buildImagePrompt(Object.assign({ sceneDescription: 'Scene B, completely different.' }, base));
  assert.ok(cenaA.includes(VISUAL_STYLES['pixel-art'].prompt));
  assert.ok(cenaB.includes(VISUAL_STYLES['pixel-art'].prompt));
});

test('9. A proporção 9:16 é mantida no bloco de consistência', () => {
  const output = buildImagePrompt({
    sceneDescription: 'Any scene.',
    characterBible: [],
    environmentBible: sampleEnvironment,
    selectedVisualStyle: 'fantastic',
  });
  assert.ok(output.includes('vertical 9:16'));
});

test('10b. Estilo inválido em buildImagePrompt cai no fallback (não quebra, não escolhe outro estilo silenciosamente)', () => {
  const output = buildImagePrompt({
    sceneDescription: 'Any scene.',
    characterBible: [],
    environmentBible: sampleEnvironment,
    selectedVisualStyle: 'estilo-inventado-que-nao-existe',
  });
  assert.ok(output.includes(VISUAL_STYLES[DEFAULT_STYLE_ID].prompt));
});

test('12. O prompt final não resume nem corta nenhum bloco (todas as partes inteiras)', () => {
  const style = VISUAL_STYLES.mythology;
  const output = buildImagePrompt({
    sceneDescription: 'A temple collapses.',
    characterBible: [sampleCharacter],
    environmentBible: sampleEnvironment,
    selectedVisualStyle: 'mythology',
  });
  [style.prompt, style.negativeRules, UNIVERSAL_NEGATIVE_PROMPT, sampleCharacter.description, sampleEnvironment].forEach((block) => {
    assert.ok(output.includes(block), 'bloco cortado/resumido no prompt final: ' + block.slice(0, 40) + '...');
  });
});

console.log('\nValidação de entrada (validateImagePromptInput)');

test('Detecta sceneDescription ausente', () => {
  const warnings = validateImagePromptInput({ characterBible: [], selectedVisualStyle: 'comic' });
  assert.ok(warnings.some((w) => /sceneDescription/.test(w)));
});

test('Detecta estilo inexistente', () => {
  const warnings = validateImagePromptInput({ sceneDescription: 'x', characterBible: [], selectedVisualStyle: 'nao-existe' });
  assert.ok(warnings.some((w) => /não existe no catálogo/.test(w)));
});

test('Não gera aviso quando tudo está correto', () => {
  const warnings = validateImagePromptInput({ sceneDescription: 'x', characterBible: [], selectedVisualStyle: 'comic' });
  assert.deepEqual(warnings, []);
});

console.log('\n' + passed + ' teste(s) passaram.');
if (process.exitCode) {
  console.error('\nAlgum teste falhou — ver detalhes acima.');
} else {
  console.log('Tudo certo.');
}
