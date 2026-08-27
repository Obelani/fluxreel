import { Audio, Img, Layout, Rect, Txt, makeScene2D } from '@revideo/2d';
import { all, createRef, useScene, waitFor } from '@revideo/core';

// ATENÇÃO: esse arquivo é a peça mais provável de precisar de ajuste no
// primeiro teste real — a documentação do Revideo confirma os componentes
// (Txt, Img, Audio, Layout) e o mecanismo de variáveis (`variables.get`),
// mas os nomes exatos de algumas props (ex.: se `Layout` aceita `wrap`
// direto, se `Rect` aceita `padding` como array) não foram 100%
// confirmados — ajustar aqui com base no erro real do primeiro render.

interface Word {
  word: string;
  start: number;
  end: number;
}

interface CaptionStyle {
  fillColor: string;
  highlightTextColor: string;
  backgroundColor?: string;
  fontFamily: string;
  fontWeight: number;
}

const DEFAULT_STYLE: CaptionStyle = {
  fillColor: 'rgba(255,255,255,0.55)',
  highlightTextColor: '#000000',
  fontFamily: 'Montserrat',
  fontWeight: 700,
};

export default makeScene2D(function* (view) {
  const imageUrls = useScene().variables.get<string[]>('imageUrls', [])();
  const sceneDurations = useScene().variables.get<number[]>('sceneDurations', [])();
  const audioUrl = useScene().variables.get<string>('audioUrl', '')();
  const musicUrl = useScene().variables.get<string | null>('musicUrl', null)();
  const words = useScene().variables.get<Word[]>('words', [])();
  const style = useScene().variables.get<CaptionStyle>('style', DEFAULT_STYLE)();

  view.fill('#000000');

  // ---------- Imagens: uma por cena, trocando em sequência ----------
  const imageRef = createRef<Img>();
  view.add(<Img ref={imageRef} width={1080} height={1920} src={imageUrls[0] || ''} />);

  // ---------- Áudio: narração (sempre) + música de fundo (se houver) ----------
  view.add(<Audio src={audioUrl} play />);
  if (musicUrl) {
    view.add(<Audio src={musicUrl} play volume={0.15} />);
  }

  // ---------- Legenda: agrupa as palavras em linhas curtas ----------
  const LINE_SIZE = 6;
  const lines: Word[][] = [];
  for (let i = 0; i < words.length; i += LINE_SIZE) {
    lines.push(words.slice(i, i + LINE_SIZE));
  }

  const captionLayer = createRef<Layout>();
  view.add(
    <Layout
      ref={captionLayer}
      layout
      direction="row"
      wrap="wrap"
      justifyContent="center"
      alignItems="center"
      width={900}
      y={650}
      gap={12}
    />
  );

  yield* all(
    // Troca a imagem de fundo conforme o tempo de cada cena.
    (function* () {
      for (let i = 0; i < imageUrls.length; i++) {
        imageRef().src(imageUrls[i]);
        yield* waitFor(Math.max(sceneDurations[i] || 1, 0.1));
      }
    })(),

    // Mostra uma linha de legenda por vez, destacando a palavra sendo
    // falada no momento (resto da linha fica em fillColor "apagado").
    (function* () {
      for (const line of lines) {
        if (!line.length) continue;
        captionLayer().removeChildren();

        const wordRefs = line.map(() => createRef<Txt>());
        const bgRefs = line.map(() => createRef<Rect>());

        line.forEach((w, i) => {
          captionLayer().add(
            <Rect ref={bgRefs[i]} radius={8} padding={[4, 10]} fill="rgba(0,0,0,0)">
              <Txt
                ref={wordRefs[i]}
                text={w.word.toUpperCase()}
                fontFamily={style.fontFamily}
                fontWeight={style.fontWeight}
                fontSize={64}
                fill={style.fillColor}
              />
            </Rect>
          );
        });

        for (let i = 0; i < line.length; i++) {
          const w = line[i];
          const previousEnd = i === 0 ? w.start : line[i - 1].end;
          yield* waitFor(Math.max(w.start - previousEnd, 0));

          wordRefs[i]().fill(style.highlightTextColor);
          if (style.backgroundColor) bgRefs[i]().fill(style.backgroundColor);

          yield* waitFor(Math.max(w.end - w.start, 0.05));

          wordRefs[i]().fill(style.fillColor);
          if (style.backgroundColor) bgRefs[i]().fill('rgba(0,0,0,0)');
        }
      }
    })()
  );
});
