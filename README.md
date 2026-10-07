# Paper Puppeteer Engine

A reusable TypeScript + Phaser engine for 2D paper puppets: rigid transparent cutouts connected by hierarchical joints, animated through local keyframed transforms. The engine includes static pose presets, bind pose reset, a developer pose inspector, pose JSON export, crossfades, timeline events, stepped playback, masked animation layers, IK, facing, slots, and skins. The demo and editor display the version from `package.json`.

**Live demo:** [GitHub Pages](https://samimluukkonen.github.io/paper-puppeteer-engine/)

Pushes to `master` build and deploy the demo through [the Pages workflow](.github/workflows/deploy-pages.yml). In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. The workflow publishes `dist/demo` and can also be run from the Actions tab.

## Install and run

Requires Node.js **24 or newer** and npm. Local development and CI use **24.19.0**, pinned in [.nvmrc](.nvmrc). Run `nvm use` if you use nvm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The demo starts in idle. The control panel also supports clicking/tapping.

The [Animation Editor](docs/animation-editor.md) at `/animation-editor/` supports playback preview, property keyframing, multi-key selection, dragging, clipboard commands, and undo/redo. Use the [Rig Editor](docs/rig-editor.md) at `/rig-editor/` to edit bind poses. Both editors keep changes in memory; download JSON to save your work.

## Quick start

Build the library with `npm run build:lib`, then install this checkout in your Phaser project:

```bash
npm install /absolute/path/to/paper-puppeteer-engine
```

Load the shipped character's metadata and artwork before creating its puppet:

```ts
import Phaser from 'phaser';
import { CharacterLoader, Puppet, queueCharacterTextures } from 'paper-puppeteer-engine';

const definition = await CharacterLoader.load('/characters/demo-puppet/character.json');
queueCharacterTextures(scene, definition);
scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
  const puppet = new Puppet(scene, { definition, x: 500, y: 500 });
  puppet.play('idle');
});
scene.load.start();
```

`scene` is your Phaser scene. Serve the sample folder from `public/characters/demo-puppet/` at the URL above, or use your own character manifest. The puppet updates automatically with the scene. For Node asset tooling, use the renderer-independent `paper-puppeteer-engine/core` entry point.

## Guides

| Guide                                                | Contents                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Demo controls](docs/demo.md)                        | Keyboard controls, playback examples, facing, skins, and pose authoring                                 |
| [Rig editor](docs/rig-editor.md)                     | Editing, snapping, undo/redo, validation, imports, exports, and embedding                               |
| [Animation editor](docs/animation-editor.md)         | Working copies, property keyframing, keyframe dragging and snapping, playback, and runtime pose preview |
| [Character assets and rigs](docs/characters.md)      | Manifests, JSON validation, slots, skins, artwork, and rig definitions                                  |
| [Animation and poses](docs/animation.md)             | Keyframes, static poses, playback, crossfades, events, layers, and manual updates                       |
| [IK and object attachments](docs/ik.md)              | Two-bone solving, transforms, foot planting, katana grips, and attached props                           |
| [Development and package usage](docs/development.md) | Checks, browser tests, profiling, architecture, packaging, and Node APIs                                |

## Development checks

```bash
npm run typecheck
npm run check
npm test
npm run build
npm run test:package
```

`npm run check` validates Oxfmt formatting, Oxlint's type-aware lint rules, and TypeScript 7 types. Use `npm run check:fix` to apply safe lint fixes and formatting. VS Code recommends the official Oxc extension for formatting and fixes on save.

For browser checks, install Chromium with `npx playwright install chromium`, then run `npm run test:browser`. The [development guide](docs/development.md#checks-and-profiling) describes the test suites and profiling commands.

## Current limitations

- Rigid pieces only: no mesh deformation, weighted skinning, physics, ragdolls, or cloth.
- One clip per layer with simple masked overlays; no animation graph, blend tree, or automatic state machine.
- Only direct two-link chains and endpoint positions: no joint limits, end-effector rotation constraints, arbitrary-length chains, or terrain-aware locomotion. Foot planting is manual; the walk remains in place.
- The rotating chain root must have uniform scale magnitudes (`abs(scaleX) === abs(scaleY)`); its signs may differ. Nonuniform scale inside that joint is skipped with `unsupported-scale`. Arbitrary nonsingular ancestor transforms and middle-joint scale are supported. Zero/singular transforms skip solving safely.
- Two-handed gripping adjusts the primary arm target when the second grip leaves the opposite arm's reach. The katana is a demo prop, not a combat system.
- Debug name labels can overlap on dense rigs. Independent draw slots use two transform containers per drawable; profile very large rigs for your rendering workload.
- The rig editor loads the sample character and edits an in-memory working copy. It exports JSON for manual placement in the character folder; it does not write to the project automatically or edit animation timelines. Character JSON loading uses `fetch`; apps with another asset pipeline can use `CharacterDefinition.fromData`.

## Planned features

- Joint angle limits and optional end-effector rotation alignment.
- More advanced animation state orchestration and editor tooling.
- Transform drag handles.
- Character editing tools and richer asset pipeline integration.
