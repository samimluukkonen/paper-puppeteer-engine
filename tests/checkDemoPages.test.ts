import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'vitest';

const run = promisify(execFile);
const script = resolve(fileURLToPath(new URL('../scripts/check-demo-pages.mjs', import.meta.url)));

interface Fixture {
  dist: string;
  cleanup: () => Promise<void>;
}

async function fixture(pages: Record<string, string>, assets: Record<string, string> = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'paper-puppeteer-demo-pages-'));
  const dist = join(root, 'dist');
  for (const [page, html] of Object.entries(pages)) {
    const file = join(dist, page, 'index.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
  }
  for (const [asset, contents] of Object.entries(assets)) {
    const file = join(dist, asset);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return { dist, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const healthyPage = (entry: string) =>
  `<!doctype html><html><head>
<script type="module" crossorigin src="${entry}"></script>
</head><body>
<div id="view-loading" class="view-loading"></div>
<div id="animation-editor-app"></div>
</body></html>`;

// The shape of the broken production artifact: the loading screen is present but
// the only script left is the modulepreload polyfill, so the app never boots.
const polyfillOnlyPage = `<!doctype html><html><head>
<script type="module" crossorigin src="../assets/modulepreload-polyfill-P2Xu9kJm.js"></script>
</head><body>
<div id="view-loading" class="view-loading"></div>
<div id="animation-editor-app"></div>
</body></html>`;

test('built demo pages each reference an entry module script and resolvable assets', async () => {
  const { dist, cleanup } = await fixture(
    {
      '.': healthyPage('./assets/main-home.js'),
      'animation-editor': healthyPage('../assets/main-editor.js'),
    },
    {
      'assets/main-home.js': '// home',
      'assets/main-editor.js': '// editor',
    },
  );
  try {
    const { stdout } = await run('node', [script, dist]);
    assert.match(stdout, /animation-editor/);
  } finally {
    await cleanup();
  }
});

test('a page whose entry script was stripped during the build fails the check', async () => {
  const { dist, cleanup } = await fixture(
    { 'animation-editor': polyfillOnlyPage },
    { 'assets/modulepreload-polyfill-P2Xu9kJm.js': '// polyfill' },
  );
  try {
    await assert.rejects(run('node', [script, dist]), (error: unknown) => {
      const failure = error as { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr + failure.stdout, /animation-editor/);
      assert.match(failure.stderr + failure.stdout, /entry/i);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('a page referencing a missing asset fails the check', async () => {
  const { dist, cleanup } = await fixture({ '.': healthyPage('./assets/main-gone.js') });
  try {
    await assert.rejects(run('node', [script, dist]), (error: unknown) => {
      const failure = error as { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr + failure.stdout, /main-gone\.js/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('an empty build output fails the check instead of passing vacuously', async () => {
  const { dist, cleanup } = await fixture({});
  try {
    await assert.rejects(run('node', [script, dist]), (error: unknown) => {
      const failure = error as { code: number };
      assert.equal(failure.code, 1);
      return true;
    });
  } finally {
    await cleanup();
  }
});
