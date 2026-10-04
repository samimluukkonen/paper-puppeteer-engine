import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/demo',
    rollupOptions: {
      input: {
        main: decodeURIComponent(new URL('./index.html', import.meta.url).pathname),
        rigEditor: decodeURIComponent(new URL('./rig-editor/index.html', import.meta.url).pathname),
        animationEditor: decodeURIComponent(new URL('./animation-editor/index.html', import.meta.url).pathname),
      },
    },
    // The demo includes Phaser; the library build leaves it external.
    chunkSizeWarningLimit: 1600,
  },
});
