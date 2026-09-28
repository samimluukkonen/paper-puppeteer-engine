import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/demo',
    // The demo includes Phaser; the library build leaves it external.
    chunkSizeWarningLimit: 1600,
  },
});
