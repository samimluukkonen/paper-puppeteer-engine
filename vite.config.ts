import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/demo',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        rigEditor: fileURLToPath(new URL('./rig-editor/index.html', import.meta.url)),
        animationEditor: fileURLToPath(new URL('./animation-editor/index.html', import.meta.url)),
      },
    },
    // The demo includes Phaser; the library build leaves it external.
    chunkSizeWarningLimit: 1600,
  },
});
