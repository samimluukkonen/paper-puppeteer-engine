import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    outDir: 'dist/library',
    lib: {
      entry: {
        index: 'src/engine/index.ts',
        runtime: 'src/engine/runtime.ts',
        core: 'src/engine/core.ts',
        data: 'src/engine/data.ts',
        serialization: 'src/engine/serialization.ts',
      },
      formats: ['es'],
    },
    rollupOptions: { external: ['phaser', 'zod'] },
    sourcemap: true,
  },
});
