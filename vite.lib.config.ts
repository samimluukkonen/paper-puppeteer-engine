import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    outDir: 'dist/library',
    lib: { entry: { index: 'src/engine/index.ts', core: 'src/engine/core.ts' }, formats: ['es'] },
    rollupOptions: { external: ['phaser', 'zod'] },
    sourcemap: true,
  },
});
