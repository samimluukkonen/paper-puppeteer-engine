// No checkout aliases: resolve the installed engine package and its declarations.
export default {
  base: './',
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: { input: ['index.html', 'choreography.html', 'scene.html'] },
  },
};
