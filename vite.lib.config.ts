import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/library',
    lib: { entry: 'src/engine/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: ['phaser'] },
    sourcemap: true,
  },
});
