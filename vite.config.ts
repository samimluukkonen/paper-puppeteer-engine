import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pages = Object.fromEntries(
  Object.entries({
    main: './index.html',
    rigEditor: './rig-editor/index.html',
    animationEditor: './animation-editor/index.html',
    sceneEditor: './scene-editor/index.html',
    project: './project/index.html',
  }).map(([name, path]) => [name, fileURLToPath(new URL(path, import.meta.url))]),
);

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'view-loading-screen',
      transformIndexHtml: {
        order: 'pre',
        handler: (_html, context) =>
          Object.values(pages).includes(context.filename)
            ? [
                {
                  tag: 'style',
                  children: ['theme.css', 'viewLoading.css']
                    .map((file) => readFileSync(new URL(`./src/ui/${file}`, import.meta.url), 'utf8'))
                    .join('\n'),
                  injectTo: 'head',
                },
                {
                  tag: 'div',
                  attrs: { id: 'view-loading', class: 'view-loading', role: 'status', 'aria-live': 'polite' },
                  children:
                    '<div class="view-loading-content"><span class="view-loading-spinner" aria-hidden="true"></span><div><strong>Paper Puppeteer Engine</strong><p>Loading workspace…</p></div></div>',
                  injectTo: 'body-prepend',
                },
              ]
            : [],
      },
    },
  ],
  build: {
    outDir: 'dist/demo',
    rollupOptions: {
      input: pages,
      output: {
        codeSplitting: {
          // Keep vendor hashes independent of changes to shared application modules.
          groups: [
            { name: 'phaser', test: /node_modules[\\/]phaser[\\/]/ },
            { name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
    // The editor application includes Phaser; the library build leaves it external.
    chunkSizeWarningLimit: 1600,
  },
});
