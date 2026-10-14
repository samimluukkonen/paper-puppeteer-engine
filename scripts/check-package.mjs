import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { checkDocumentationLinks } from './documentationLinks.mjs';
import { readPackageManifest } from './packageManifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const installed = createRequire(new URL('../package.json', import.meta.url));
const manifest = await readPackageManifest(new URL('../package.json', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'paper-puppeteer-package-'));
const consumer = join(temporary, 'consumer');
const env = { ...process.env, npm_config_cache: join(temporary, 'npm-cache') };
/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
const npm = (args, cwd = root) => execFileSync('npm', args, { cwd, env, stdio: 'inherit' });

try {
  // Run the actual prepack hook and install its artifact, rather than resolving this checkout's exports.
  npm(['pack', '--quiet', '--pack-destination', temporary]);
  const archives = (await readdir(temporary)).filter((file) => file.endsWith('.tgz'));
  assert.equal(archives.length, 1, 'npm pack must create exactly one archive.');
  await mkdir(consumer);
  const dependencies = { [manifest.name]: `file:${join(temporary, archives[0])}` };
  const pending = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  // Reuse installed dependencies so the consumer check is offline and tests the locked versions.
  for (const name of pending) {
    const path = installed.resolve(`${name}/package.json`);
    const dependency = await readPackageManifest(path);
    dependencies[name] = `file:${dirname(path)}`;
    for (const child of Object.keys(dependency.dependencies ?? {})) pending.add(child);
  }
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'package-consumer', private: true, type: 'module', dependencies }),
  );
  npm(
    ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false'],
    consumer,
  );
  const packageRoot = await realpath(join(consumer, 'node_modules', manifest.name));
  assert.notEqual(packageRoot, await realpath(root), 'The consumer must load the packed package, not this checkout.');
  const guides = await readdir(join(packageRoot, 'docs'));
  assert.ok(
    guides.every((file) => file.endsWith('.md')),
    'Only Markdown guides belong in the packaged docs.',
  );
  for (const guide of [
    'animation.md',
    'characters.md',
    'development.md',
    'ik.md',
    'animation-editor.md',
    'rig-editor.md',
    'runtime-api.md',
  ])
    assert.ok(guides.includes(guide), `The package must retain the ${guide} guide.`);

  await checkDocumentationLinks(packageRoot, ['README.md', 'CHANGELOG.md', ...guides.map((guide) => `docs/${guide}`)]);

  const smoke = join(consumer, 'check-core.mjs');
  await writeFile(smoke, await readFile(new URL('./check-core.mjs', import.meta.url)));
  execFileSync(
    process.execPath,
    [smoke, new URL('../public/characters/demo-puppet/character.json', import.meta.url).href],
    { cwd: consumer, stdio: 'inherit' },
  );

  await writeFile(
    join(consumer, 'core.ts'),
    `
import { AnimationPlayer, CharacterLoader, Joint, Rig, compileClip, evaluateClip } from 'paper-puppeteer-engine/core';
import type { AnimationClip, CharacterDefinition, CharacterLoadOptions, CompiledClip, DeepReadonly, RigJsonDefinition } from 'paper-puppeteer-engine/core';
import type { CharacterManifest, IKAnimationTrack, RigDefinition } from 'paper-puppeteer-engine/data';
import { validateCharacterDefinition, parseRigDefinition } from 'paper-puppeteer-engine/serialization';

export function checkData(manifest: CharacterManifest, rig: RigDefinition, track: IKAnimationTrack): void {
  validateCharacterDefinition({ manifest, rig });
  parseRigDefinition({ version: 1, ...rig });
  track[0]?.time satisfies number | undefined;
}

export function loadCharacter(url: string, options: CharacterLoadOptions): Promise<CharacterDefinition> {
  return CharacterLoader.load(url, undefined, options);
}

export function sample(): number | undefined {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const joints = new Map([['root', new Joint('root')]]);
  const clip: AnimationClip = { name: 'idle', duration: 1000, loop: true, tracks: {} };
  const player = new AnimationPlayer(rig, joints);
  player.addAnimation(clip);
  player.play('idle');
  return player.duration + (evaluateClip(compileClip(clip, rig), 500).get('root')?.x ?? 0);
}

export function checkOwnership(character: CharacterDefinition, rig: DeepReadonly<RigJsonDefinition>): void {
  // @ts-expect-error Shared compilation lists cannot be extended by a consumer.
  character.compiledAnimations.push(character.compiledAnimations[0]!);
  // @ts-expect-error Shared clip metadata cannot be changed by a consumer.
  character.compiledAnimations[0]!.duration = 1;
  // @ts-expect-error Character definitions expose readonly animation fields.
  character.animations[0]!.duration = 1;
  // @ts-expect-error Readonly rig data includes nested bone transforms.
  rig.bones[0]!.x = 1;
  // @ts-expect-error Runtime rig bones expose immutable transforms.
  character.rig.bones[0]!.x = 1;
  // @ts-expect-error Bone getters preserve nested artwork immutability.
  character.rig.getBone(character.rig.root).sprite!.originX = 0;
  // @ts-expect-error Runtime slots expose immutable transforms.
  character.rig.slots[0]!.x = 1;
  // @ts-expect-error Slot getters preserve immutable transforms.
  character.rig.getSlot('visual').x = 1;
  // @ts-expect-error Runtime attachments expose immutable artwork.
  character.rig.attachments[0]!.texture = 'changed';
  // @ts-expect-error Attachment getters preserve immutable artwork.
  character.rig.getAttachment('art').texture = 'changed';
  // @ts-expect-error Runtime skins expose immutable metadata.
  character.rig.skins[0]!.name = 'changed';
}

export function checkCompiledOwnership(clip: CompiledClip): void {
  // @ts-expect-error Compiled event metadata is readonly.
  clip.events[0]!.time = 1;
  if (clip.playback?.mode === 'stepped') {
    // @ts-expect-error Compiled playback settings are readonly.
    clip.playback.fps = 1;
  }
  // @ts-expect-error Compiled property maps expose no mutation methods.
  clip.tracks[0]!.properties.clear();
  // @ts-expect-error Compiled key values are readonly.
  clip.tracks[0]!.properties.get('x')![0]!.value = 1;
}
`,
  );
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      lib: ['ES2022', 'DOM'],
    },
    include: ['core.ts'],
  };
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify(config));
  const typecheck = () =>
    execFileSync(
      process.execPath,
      [join(dirname(installed.resolve('typescript/package.json')), 'bin/tsc'), '-p', join(consumer, 'tsconfig.json')],
      { cwd: consumer, stdio: 'inherit' },
    );
  typecheck();

  const browserEntry = join(consumer, 'browser.ts');
  await writeFile(
    browserEntry,
    `
import type { Puppet, SyncPoseOptions } from 'paper-puppeteer-engine';
import { Puppet as RootPuppet } from 'paper-puppeteer-engine';
import { Puppet as RuntimePuppet, loadSceneCharacter } from 'paper-puppeteer-engine/runtime';
export { Puppet } from 'paper-puppeteer-engine/runtime';
export { runRuntimeExample } from './runtime-example.js';

if (RootPuppet !== RuntimePuppet) throw new Error('Root and /runtime must share the Puppet class.');
export const load = loadSceneCharacter;

export function sync(puppet: Puppet, options: SyncPoseOptions): void {
  puppet.syncPose(options);
  puppet.syncIK(options);
  puppet.sampleAnimation(500, { mode: 'playback' }).sampleAnimation(250);
}
`,
  );
  // Compile and bundle the actual repository example against installed package entry points.
  const example = await readFile(new URL('../src/examples/runtime.ts', import.meta.url), 'utf8');
  assert.ok(example.includes('../engine/runtime.js'));
  await writeFile(
    join(consumer, 'runtime-example.ts'),
    example.replace('../engine/runtime.js', 'paper-puppeteer-engine/runtime'),
  );
  // Match the repository's skipLibCheck for the browser entry's third-party Phaser declarations.
  config.compilerOptions.skipLibCheck = true;
  config.include = ['browser.ts'];
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify(config));
  typecheck();
  const browserBuild = await build({
    configFile: false,
    root: consumer,
    logLevel: 'warn',
    build: {
      write: false,
      lib: { entry: browserEntry, formats: ['es'] },
      rollupOptions: { external: ['phaser', 'zod'] },
    },
  });
  for (const result of Array.isArray(browserBuild) ? browserBuild : [browserBuild]) {
    assert.ok('output' in result, 'Consumer build must return bundle output.');
    for (const output of result.output) {
      if (output.type !== 'chunk') continue;
      assert.ok(
        output.imports.every((specifier) => ['phaser', 'zod'].includes(specifier)),
        'Only declared runtime dependencies belong in the consumer bundle.',
      );
      for (const module of Object.keys(output.modules))
        assert.ok(
          !/\/(?:devtools|ui|react|react-dom)\//.test(module),
          `Runtime bundle includes editor code: ${module}`,
        );
    }
  }
  console.log(
    'Packed package works in an isolated consumer: documentation, Node entry points, public declarations, runtime example, compatibility, and browser isolation.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
