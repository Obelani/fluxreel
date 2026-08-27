import { makeProject } from '@revideo/core';
import video from './scenes/video?scene';

// Projeto único e parametrizado: os dados de cada vídeo (imagens, áudio,
// legenda, estilo) chegam via `variables` na hora do render (renderVideo()
// em server.ts), não são fixos aqui.
export default makeProject({
  scenes: [video],
});
