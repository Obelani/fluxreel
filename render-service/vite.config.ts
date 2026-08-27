import { defineConfig } from 'vite';
import revideo from '@revideo/vite-plugin';

// Config padrão de um projeto Revideo — necessária mesmo em uso 100%
// headless (sem editor visual), porque o `renderVideo()` carrega o
// projeto através desse mesmo pipeline de build.
export default defineConfig({
  plugins: [revideo()],
});
