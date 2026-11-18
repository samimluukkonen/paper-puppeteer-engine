import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'vitest';

const run = promisify(execFile);
const script = resolve(fileURLToPath(new URL('../scripts/check-engine-internals.mjs', import.meta.url)));

async function check(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'paper-puppeteer-engine-internals-'));
  try {
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    return await run(process.execPath, [script, root]).then(
      ({ stderr }) => ({ code: 0, stderr }),
      (error: { code: number; stderr: string }) => ({ code: error.code, stderr: error.stderr }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('the engine-internals check rejects posePipeline access outside src/engine', async () => {
  const result = await check({
    'devtools/Preview.ts': 'export const sync = (puppet) => {\n  puppet.posePipeline.syncPose();\n};\n',
    'devtools/Narrowed.ts': "type Host = Pick<Puppet, 'rig' | 'posePipeline'>;\n",
    'engine/Puppet.ts': 'this.posePipeline.syncPose();\n',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /devtools\/Preview\.ts:2/);
  assert.match(result.stderr, /devtools\/Narrowed\.ts:1/, 'type-level access is rejected too');
  assert.doesNotMatch(result.stderr, /engine\/Puppet\.ts/, 'the engine owns its pipeline');
  assert.match(result.stderr, /editPose/, 'the message points at the public seam');
});

test('the engine-internals check ignores comments and passes on the real source tree', async () => {
  const commented = await check({
    'devtools/Preview.tsx': '// puppet.posePipeline is engine-internal\n/* puppet.posePipeline\n */ export {};\n',
  });
  assert.equal(commented.code, 0, commented.stderr);
  const real = await run(process.execPath, [script]);
  assert.equal(real.stderr, '');
});
