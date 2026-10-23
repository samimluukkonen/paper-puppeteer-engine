import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { z } from 'zod';
import { profileEditorWorkflow } from './profile-editor-workflow.mjs';
import { profileProjectWorkflow } from './profile-project-workflow.mjs';
import { profileSceneWorkflow } from './profile-scene-workflow.mjs';
// Local browser diagnostic only; timings are observations, never CI thresholds.
const repo = fileURLToPath(new URL('../', import.meta.url));
const rig = z
  .object({
    root: z.string(),
    bones: z.array(z.object({ id: z.string() }).passthrough()),
    ik: z.array(z.object({ name: z.string() }).passthrough()),
  })
  .passthrough()
  .parse(JSON.parse(await readFile(new URL('../public/characters/demo-puppet/rig.json', import.meta.url), 'utf8')));
const socket = createServer();
await new Promise((resolve, reject) => {
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', resolve);
});
const address = socket.address();
if (!address || typeof address === 'string') throw new Error('Could not allocate a local profile port.');
const port = String(address.port);
await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
const baseUrl = `http://127.0.0.1:${port}`;
const vite = spawn(
  process.execPath,
  [`${repo}/node_modules/vite/bin/vite.js`, '--host', '127.0.0.1', '--port', port, '--strictPort'],
  { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] },
);
let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite did not start within 15 seconds.')), 15000);
    const fail = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    vite.once('error', fail);
    vite.once('exit', (code) => fail(new Error(`Vite exited before the profile completed (${code}).`)));
    vite.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Local:')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    vite.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));
  });
  if (process.argv.includes('--project')) {
    console.log(JSON.stringify(await profileProjectWorkflow(baseUrl, process.env.PLAYWRIGHT_CHANNEL)));
  } else if (process.argv.includes('--scene')) {
    console.log(JSON.stringify(await profileSceneWorkflow(baseUrl, process.env.PLAYWRIGHT_CHANNEL)));
  } else if (process.argv.includes('--workflow')) {
    console.log(JSON.stringify(await profileEditorWorkflow(baseUrl, rig, process.env.PLAYWRIGHT_CHANNEL)));
  } else {
    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      headless: true,
    });
    const samples = [];
    for (let run = 0; run < 3; run++) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/animations/idle.json', async (route) => {
        await route.fulfill({
          json: {
            version: 1,
            name: 'idle',
            loop: false,
            duration: 5120,
            playback: { mode: 'smooth' },
            events: [],
            tracks: Object.fromEntries(
              rig.bones.map((bone) => [bone.id, Array.from({ length: 512 }, (_, i) => ({ time: i * 10, x: 0, y: 0 }))]),
            ),
          },
        });
      });
      await page.goto(`${baseUrl}/animation-editor/`);
      await page.locator('#animation-status').filter({ hasText: 'Validation: OK' }).waitFor();
      await page.locator('.timeline-summary').first().waitFor();
      const sample = await page.evaluate(() => {
        const summaries = document.querySelectorAll('.timeline-summary').length;
        const width = document.querySelector('#timeline').getBoundingClientRect().width;
        const start = performance.now();
        /** @type {HTMLButtonElement} */ (document.querySelector('[aria-label="Expand root properties"]')).click();
        document.querySelector('#timeline').getBoundingClientRect();
        const expandMs = performance.now() - start;
        const collapseStart = performance.now();
        /** @type {HTMLButtonElement} */ (document.querySelector('[aria-label="Collapse root properties"]')).click();
        document.querySelector('#timeline').getBoundingClientRect();
        return { summaries, width, expandMs, collapseMs: performance.now() - collapseStart };
      });
      samples.push(sample);
      if (errors.length) throw new Error(errors.join('\n'));
      await page.close();
    }
    console.log(JSON.stringify({ bones: rig.bones.length, samples }));
  }
} finally {
  await browser?.close();
  vite.kill();
}
