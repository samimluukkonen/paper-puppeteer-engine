# Paper Puppeteer Engine

A reusable TypeScript + Phaser engine for 2D paper puppets: rigid transparent cutouts connected by hierarchical joints, animated through local keyframed transforms. The engine includes static pose presets, bind pose reset, pose JSON export, awaitable animation playback, named animation states, animation queues, crossfades, timeline events, stepped playback, masked animation layers, IK, facing, slots, and skins. The authoring tools display the version from `package.json`.

**Authoring tools:** [GitHub Pages](https://samimluukkonen.github.io/paper-puppeteer-engine/)

Pushes to `master` build and deploy the authoring tools through [the Pages workflow](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/.github/workflows/deploy-pages.yml). In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. The workflow publishes `dist/demo` and can also be run from the Actions tab.

## Install and run

Requires Node.js **24.22.1 or newer** and npm. Local development and CI use **24.22.1**, pinned in [.nvmrc](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/.nvmrc). Run `nvm use` if you use nvm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite to start in Project Workspace. Use the shared header to open the Rig, Animation or Scene Editor.

The [Animation Editor](docs/animation-editor.md) at `/animation-editor/` supports playback preview, property keyframing, multi-key selection, dragging, clipboard commands, undo/redo, and [configurable multi-pose onion skinning](docs/onion-skin-controls.md). See [onion-skin production verification](docs/animation-editor-onion-skinning-verification.md) for v0.5.3 completion checks. Use the [Rig Editor](docs/rig-editor.md) at `/rig-editor/` to edit bind poses. Both editors offer recovery of unsaved edits from browser drafts; download JSON to save your work in the project.

Use [Animation Environment Preview](docs/animation-environment-preview.md) to evaluate any animation against a static project image, with world-space transforms and the shared ground reference. Choose authored root travel, a temporary [preview displacement trajectory](docs/motion-preview.md), or no world displacement. Fixed/follow cameras and reset/continuous root loops share the same evaluated movement; preview never changes animation keys.

The [Scene Editor](docs/scene-editor.md) at `/scene-editor/` provides independent scene documents, Actor placement, action timelines, [visual audio clips](docs/scene-audio-timeline.md) with [synchronized playback](docs/scene-audio-playback.md), Play/Pause/Restart/Stop, speed and deterministic scrubbing. Inspect runtime transforms without changing authored positions, saved state or Undo history. Download scenes before leaving the page.

The [Project Workspace](docs/project-workspace.md) at `/project/` organizes characters, artwork, animations, scenes and [audio assets](docs/audio-assets.md), retains editing sessions across navigation, and imports/exports complete project ZIPs. New projects start empty. Export a project ZIP to keep work after closing the tab.

The completed v0.5.5 [IK authoring workflow](docs/ik-animation-authoring.md) covers reaching, influence, supported timeline operations, serialization, compatibility and production verification.

The completed v0.5.6 [IK Baking workflow](docs/react-ik-baking.md) selects rig constraints, controls sampling FPS, previews the proposed baked animation while scrubbing, and reports actual key counts before a single undoable bake. [Production fidelity checks](docs/ik-bake-hardening.md) compare key-time and between-key runtime motion, including endpoint positions, with measured low-FPS feedback. It reuses [atomic IK bake commit](docs/ik-bake-commit.md), [bone-key generation](docs/ik-bake-generation.md), and [isolated sampling](docs/ik-bake-sampling.md).

The completed v0.5.7 [Animation Editor workflow](docs/animation-editor.md#production-animation-workflow) combines track filtering, zoom/navigation, advanced snapping, proportional retiming, bone/IK authoring, mirroring, baking and events. See [UX and production verification](docs/animation-editor-ux-verification.md) for command guards, history/lifecycle regressions and dense-workload measurements.

The v0.5.8.1 [sprite import and replacement foundation](docs/sprite-replacement.md) adds local PNG/WebP validation, original/replacement comparison, Phaser preview, explicit Apply/Cancel and original-artwork reversion in both editors. Pending binary assets stay in session memory, separate from authored JSON.

The v0.5.8.2 [visual artwork alignment](docs/visual-artwork-alignment.md) adds explicit joint, artwork offset, sprite origin and slot transform modes; exact pixel pivots, joint references, undoable alignment helpers, facing and read-only animation bone poses. Artwork drag proposals stay separate from authored rig data until release.

The v0.5.8.3 [Animation Editor Rig-Tweak Mode](docs/animation-rig-tweak.md) reuses rig joint/artwork/slot tools at the paused animation pose. Rig and animation histories, dirty states and exports remain independent; rig changes reevaluate the animation and IK without creating keys.

The v0.5.8.6 [production asset workflow](docs/artist-workflow.md) exports complete validated character ZIPs with replacement image binaries and reloads them through `CharacterLoader` and `Puppet`. Package checkpoints track rig, skin, animation and artwork changes independently of individual file downloads.

The v0.5.8.5 [Safe Sprite Replacement & Hot Reload](docs/sprite-replacement.md) adds explicit shared/individual artwork scopes, dimension and pivot policies, transactional preview refresh and independent artwork Undo/Redo. Stable attachment IDs, skins, slots, rig transforms and existing animations remain intact.

The v0.5.7.2 [timeline navigation and zoom](docs/timeline-navigation.md) adds pointer-anchored zoom, horizontal panning, fit/center commands, precise seconds/frame input and optional playhead follow. Navigation preserves authored data and selection.

The v0.5.7.1 [timeline track search and filtering](docs/timeline-track-filtering.md) finds bones, properties, IK targets and events, preserves ancestor context, and reveals hidden selections. Visibility and expansion controls preserve authored data, history and exports.

The v0.5.5.4 [visual IK target controls](docs/visual-ik-targets.md) let artists drag hand and foot targets in the preview, cancel with Escape, and commit both coordinates with Set Target Key. Temporary previews stay outside exported JSON and document history.

The animation format defaults to linear interpolation and supports optional outgoing property curves with linear, stepped or cubic Bézier timing. Smooth and stepped playback modes control sampling independently. The [Graph Editor](docs/graph-editor.md) provides visual property curves, Bézier tangents and precision key/handle editing with shared timeline selection and Undo/Redo. [Create Variation](docs/animation-editor.md#create-an-animation-variation) makes an independent animation from the current authored clip, with optional time scaling and a temporary canvas preview. See the [animation guide](docs/animation.md) for runtime behavior and the [changelog](CHANGELOG.md) for milestone history and verification notes.

The v0.5.4 [mirrored animation tools](docs/mirroring-hardening-verification.md) combine [bone pairing](docs/bone-symmetry-mapping.md), [bind-relative pose reflection](docs/pose-mirroring.md), [sparse keyframe authoring](docs/mirrored-keyframe-authoring.md), and [React controls](docs/react-mirroring-tools.md). Browser-local pair preferences and a read-only overlay support artist review before atomic, undoable commits. The completed hardening phase covers asymmetric rigs, lifecycle cleanup, runtime/serialization regressions and an [artist walkthrough](docs/animation-editor.md#mirror-a-left-arm-movement).

The v0.8 [Actor and choreography layer](docs/choreography-production.md) supports direct movement, walk animation, spatial facing and synchronized sequential/parallel scenes with cancellation and ownership. See the [v0.8 release report](docs/release-notes-v0.8.md) for verification and limitations.

The v0.9.8 [foot contact workflow and readiness report](docs/foot-contact-readiness.md) covers bone-local marker authoring, explicit IK alignment, Actor grounding, exports and compatibility.

## Quick start

v0.6.3 unifies the [React editor production workflow](docs/react-editor-workflow-verification.md): shared character ownership, retained clip sessions, independent dirty domains and safe editor navigation.

v0.6.2 hardens [schema compatibility and serialization](docs/schema-compatibility.md), retaining version-1 authored formats and verifying real v0.4.3 assets, canonical exports, cross-file references and safe package paths.

v0.6.1 stabilizes the [runtime architecture and public API](docs/runtime-api.md), with explicit `/runtime`, `/data` and `/serialization` entry points alongside the existing root and `/core` imports. Character scene loading is available from the runtime, and ownership/cleanup contracts are documented.

Build the library with `npm run build:lib`, then install this checkout in your Phaser project:

```bash
npm install /absolute/path/to/paper-puppeteer-engine
```

Load the shipped character's metadata and artwork before creating its puppet:

```ts
import Phaser from 'phaser';
import { CharacterLoader, Puppet, queueCharacterTextures } from 'paper-puppeteer-engine/runtime';

const definition = await CharacterLoader.load('/characters/demo-puppet/character.json');
queueCharacterTextures(scene, definition);
scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
  const puppet = new Puppet(scene, { definition, x: 500, y: 500 });
  puppet.play('idle');
});
scene.load.start();
```

`scene` is your Phaser scene. Serve the sample folder from `public/characters/demo-puppet/` at the URL above, or use your own character manifest. The puppet updates automatically with the scene. For Node asset tooling, use the renderer-independent `paper-puppeteer-engine/core` entry point.

The [runtime integration guide](docs/runtime-integration.md) covers portable character exports and loading them in your own Phaser application. Packed-package checks verify public APIs and browser bundling.

Milestone v0.7.6.6 (package `0.7.6-6`) completes the [Feature Guide](docs/feature-guide.md), with Rig Editor and Animation Editor tutorials, optional practice using real controls, prerequisite recovery and restart/navigation. See the [implementation and verification report](docs/feature-guide-verification.md).

v0.7.5 completes [runtime controller production hardening](docs/runtime-controller-readiness.md), with a playback interaction matrix, standalone controls, crossfade/layer/IK regressions, cleanup stress tests and measured CPU profiles. v0.7.4 adds [async animation playback](docs/async-animation.md): await exact playback instances with typed outcomes, wait-only cancellation and disposal cleanup. v0.7.3 adds [named animation states](docs/animation-states.md): reusable runtime state definitions, idempotent requests, configurable crossfades and temporary actions that return to a persistent state. It builds on v0.7.2 [animation queues](docs/animation-queues.md) and [runtime playback lifecycle and completion](docs/playback-lifecycle.md). The [v0.6 release gates and regression results](docs/release-readiness.md) retain the earlier production authoring assessment.

## Guides

- [Character runtime integration](docs/runtime-integration.md)
- [GitHub / Primer UI style guide](docs/style-guide.md)
- [Complete artist workflow and production character packages](docs/artist-workflow.md)
- [Advanced Pose Library](docs/pose-library.md)
- [Advanced animation artist workflow](docs/advanced-animation-workflow.md)
- [v1.1 internal readiness assessment](docs/advanced-animation-readiness.md)
- [v1.0.5 internal production readiness and verification](docs/personal-production-readiness.md)
- [Creating Your First Character](docs/creating-your-first-character.md)
- [Making Your First Scene](docs/making-your-first-scene.md)
- [Creating Your First Cinematic Scene](docs/creating-your-first-cinematic-scene.md)
- [v1.2 cinematic integration report](docs/cinematic-scene-readiness.md)
- [v0.9 Scene Editor readiness and verification](docs/scene-editor-readiness.md)
- [Using Feature Guide](docs/feature-guide.md)
- [Schema inventory, compatibility policy and canonical serialization](docs/schema-compatibility.md)
- [Root-motion data, runtime evaluation and application](docs/root-motion.md)
- [Visual root-motion authoring and sword-attack walkthrough](docs/root-motion-authoring.md)
- [Root motion and Environment Preview integration](docs/root-motion-environment-preview.md)
- [Scene root motion, ownership and choreography](docs/scene-root-motion.md)
- [Root-motion workflow, tool compatibility and hardening](docs/root-motion-hardening.md)

| Guide                                                                | Contents                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [Foot contact markers](docs/foot-contact-markers.md)                 | Visual rig marker editing, bone-local data, validation and post-IK world position evaluation               |
| [Rig editor](docs/rig-editor.md)                                     | Editing, snapping, undo/redo, validation, imports, exports, and embedding                                  |
| [Animation editor](docs/animation-editor.md)                         | Working copies, property keyframing, keyframe dragging and snapping, playback, and runtime pose preview    |
| [Timeline snapping](docs/timeline-snapping.md)                       | Frame/key/event/playhead alignment, zoom-aware tolerance, temporary guides and group timing                |
| [Keyframe retiming](docs/keyframe-retiming.md)                       | Proportional selected-key timing, anchors, numerical preview and atomic Undo/Redo                          |
| [Bone symmetry mapping](docs/bone-symmetry-mapping.md)               | Editor-only pairing candidates, manual overrides, validation, lookup, and rig-session lifecycle            |
| [Pose mirroring core](docs/pose-mirroring.md)                        | Pure authored-pose reflection, bind frames, hierarchy, supported transforms, and structured failures       |
| [React mirroring tools](docs/react-mirroring-tools.md)               | Bone-pair configuration, persistence, preview, directions and React/editor integration                     |
| [Mirrored keyframe authoring](docs/mirrored-keyframe-authoring.md)   | Current-pose/selected-key commands, sparse properties, timing, collisions, history and selection           |
| [Character assets and rigs](docs/characters.md)                      | Manifests, JSON validation, slots, skins, artwork, and rig definitions                                     |
| [Animation queues](docs/animation-queues.md)                         | FIFO requests, completion transitions, loop rejection, interruption and cleanup                            |
| [Async animation](docs/async-animation.md)                           | Awaitable playback, typed outcomes, cancellation, looping policy and disposal                              |
| [Actors, movement and facing](docs/actors.md)                        | Optional Puppet facade, world targeting, configurable walk facing, locomotion, animation and ownership     |
| [Choreography sequences](docs/choreography-sequences.md)             | Sequential/parallel Actor groups, synchronization, deterministic waits, conflicts and owned cancellation   |
| [Runtime controller readiness](docs/runtime-controller-readiness.md) | Complete public API, interaction matrix, compatibility, cleanup, measurements and v0.7 verification        |
| [Animation states](docs/animation-states.md)                         | Named states, transition fades, one-shot returns, playback ownership and disposal                          |
| [Animation and poses](docs/animation.md)                             | Keyframes, static poses, playback, crossfades, events, layers, and manual updates                          |
| [IK constraint authoring](docs/ik-constraint-authoring.md)           | Rig model/controller creation, configuration, dependency-safe deletion, history and default targets        |
| [IK authoring integration](docs/ik-authoring-integration.md)         | New/existing character workflows, Rig Tweak, shared discovery, import safety and runtime ownership         |
| [React IK authoring](docs/react-ik-authoring.md)                     | IK timeline tracks, numeric target/influence keys, selection, history, and local verification              |
| [IK production authoring](docs/ik-animation-authoring.md)            | Reaching workflow, operation limits, compatibility, lifecycle and regression coverage                      |
| [Visual IK targets](docs/visual-ik-targets.md)                       | Phaser crosshairs, dragging, explicit target commitment, coordinate conversion, ownership and verification |
| [Runtime IK animation](docs/ik-animation-runtime.md)                 | Animated targets and influence, runtime precedence, scrubbing, crossfades, and masks                       |
| [IK bake sampling](docs/ik-bake-sampling.md)                         | Read-only whole-animation samples, frame times, local transforms and supported constraint scope            |
| [IK bone-key generation](docs/ik-bake-generation.md)                 | Pure key proposals, replacement reporting, playback policy and local-pose fidelity tolerances              |
| [Atomic IK bake commit](docs/ik-bake-commit.md)                      | Whole-clip key replacement, runtime constraint deactivation, validation and exact Undo/Redo                |
| [IK bake production fidelity](docs/ik-bake-hardening.md)             | Key/midpoint/endpoint tolerances, sampling quality, runtime transitions, editing and loader regressions    |
| [IK and object attachments](docs/ik.md)                              | Two-bone solving, transforms, foot planting, katana grips, and attached props                              |
| [Scene audio playback](docs/scene-audio-playback.md)                 | Scene clock, browser unlock, speed, silent scrubbing, drift correction and standalone audio                |
| [Development and package usage](docs/development.md)                 | Checks, browser tests, architecture, packaging, and Node APIs                                              |
| [Performance profiling](docs/profiling.md)                           | Local CPU/browser profiles, workloads, and historical measurements                                         |
| [v0.6 release readiness](docs/release-readiness.md)                  | Release gates, regression results, resource and performance observations, outstanding risks                |
| [v0.6 release notes](docs/release-notes-v0.6.md)                     | Public API summary, supported formats, migration and known limitations                                     |

## Development checks

```bash
npm run typecheck
npm run check
npm test
npm run build
npm run test:package
# All non-browser release checks in sequence:
npm run check:release
```

`npm run check` validates Oxfmt formatting, Oxlint's type-aware lint rules, and TypeScript 7 types. Use `npm run check:fix` to apply safe lint fixes and formatting. VS Code recommends the official Oxc extension for formatting and fixes on save.

Browser smoke tests are local-only and excluded from CI. For local browser checks, install Chromium with `npx playwright install chromium`, then run `npm run test:browser`. The [development guide](docs/development.md#checks-and-profiling) describes the test suites; the [profiling guide](docs/profiling.md) covers optional performance measurements.

## Current limitations

- Rigid pieces only: no mesh deformation, weighted skinning, physics, ragdolls, or cloth.
- One clip per layer with simple masked overlays; no animation graph, blend tree, or automatic state machine.
- Only direct two-link chains and endpoint positions: no joint limits, end-effector rotation constraints, arbitrary-length chains, or terrain-aware locomotion. Foot contacts require explicit IK targets; the sample walk remains in place.
- The rotating chain root must have uniform scale magnitudes (`abs(scaleX) === abs(scaleY)`); its signs may differ. Nonuniform scale inside that joint is skipped with `unsupported-scale`. Arbitrary nonsingular ancestor transforms and middle-joint scale are supported. Zero/singular transforms skip solving safely.
- Debug name labels can overlap on dense rigs. Independent draw slots use two transform containers per drawable; profile very large rigs for your rendering workload.
- The rig editor loads the sample character and edits an in-memory working copy. It exports JSON for manual placement in the character folder; it does not write to the project automatically or edit animation timelines. Character JSON loading uses `fetch`; apps with another asset pipeline can use `CharacterDefinition.fromData`.

## Planned features

- Joint angle limits and optional end-effector rotation alignment.
- More advanced animation state orchestration and editor tooling.
- Transform drag handles.
- Character editing tools and richer asset pipeline integration.

See the [IK animation data model](docs/ik-animation-data.md) for optional target/mix tracks, puppet-local coordinates, stable rig constraint names, validation, and pure authoring APIs. See [runtime IK evaluation](docs/ik-animation-runtime.md) for playback, scrubbing, precedence, and layer blending. See [React IK authoring](docs/react-ik-authoring.md) for timeline constraint selection and numeric property keying. See [visual IK targets](docs/visual-ik-targets.md) for draggable target handles and explicit target-key commits.
