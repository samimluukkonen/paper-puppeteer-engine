# Paper Puppeteer Engine

A reusable TypeScript + Phaser engine for 2D paper puppets: transparent cutouts connected by hierarchical joints, animated through local keyframed transforms. Build characters, animate them and arrange scenes in the authoring tools, then load exported assets in your own Phaser application. The engine supports poses, animation states and queues, crossfades, timeline events, masked layers, IK, facing, slots, skins and optional [textured mesh deformation](docs/mesh-attachments.md).

**Authoring tools:** [GitHub Pages](https://samimluukkonen.github.io/paper-puppeteer-engine/)

[Install and run](#install-and-run) · [First project](#first-project) · [Runtime integration](#runtime-integration) · [Current limitations](#current-limitations) · [Guides](#guides) · [Release notes](docs/release-notes.md)

## Install and run

Requires Node.js **24.22.1 or newer** and npm. Local development and CI use **24.22.1**, pinned in [.nvmrc](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/.nvmrc). Run `nvm use` if you use nvm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite to start in Project Workspace. Use the shared header to open the Rig, Animation or Scene Editor.

## First project

1. In [Project Workspace](docs/project-workspace.md), choose **New Project**, enter a name and choose **Create Project**. Projects start empty.
2. Choose **Add Existing Character** to start with a shipped character, or **New Character** to build your own rig and import artwork in the [Rig Editor](docs/rig-editor.md).
3. Open the character in the [Animation Editor](docs/animation-editor.md) to create or edit clips. Use **Feature Guide** for tutorials with the editor's real controls.
4. Return to Project Workspace and choose **New Scene**. In the [Scene Editor](docs/scene-editor.md), add an Actor from your project characters and arrange its actions on the timeline.
5. Choose **Export Project** to download a complete project ZIP. Reopen it with **Import Project**. [Local autosave](docs/local-autosave.md) provides browser recovery; keep a ZIP for a portable disk copy.

Follow [Creating Your First Character](docs/creating-your-first-character.md) or [Making Your First Scene](docs/making-your-first-scene.md) for a full walkthrough. For cameras, audio and subtitles, continue with [Creating Your First Cinematic Scene](docs/creating-your-first-cinematic-scene.md) and [Creating an Audiovisual Scene](docs/creating-an-audiovisual-scene.md).

## Runtime integration

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

The [runtime integration guide](docs/runtime-integration.md) covers portable character exports and loading them in your own Phaser application. Project ZIPs are editor archives; use a character ZIP or **Download scene package** for runtime handoff. See the guide for scene loading and cleanup.

## Current limitations

- Rigid pieces and authored textured meshes with up to four painted bone influences per vertex and sparse deformation shape keys; no physics, ragdolls or cloth simulation.
- One clip per layer with simple masked overlays; no animation graph, blend tree, or automatic state machine.
- Only direct two-link chains and endpoint positions: no joint limits, end-effector rotation constraints, arbitrary-length chains, or terrain-aware locomotion. Foot contacts require explicit IK targets; the sample walk remains in place.
- The rotating chain root must have uniform scale magnitudes (`abs(scaleX) === abs(scaleY)`); its signs may differ. Nonuniform scale inside that joint is skipped with `unsupported-scale`. Arbitrary nonsingular ancestor transforms and middle-joint scale are supported. Zero/singular transforms skip solving safely.
- Debug name labels can overlap on dense rigs. Independent draw slots use two transform containers per drawable; profile very large rigs for your rendering workload.
- Editors work on browser-held documents; downloads do not overwrite repository files. Export complete project or character ZIPs to retain artwork alongside JSON. Character JSON loading uses `fetch`; apps with another asset pipeline can use `CharacterDefinition.fromData`.

## Guides

- [Linear stories](docs/linear-stories.md) — ordered scene references, validation, persistence and runtime sequencing (API foundation).

- [Character runtime integration](docs/runtime-integration.md)
- [Rig constraint workflow, transform audit and optional deformation design](docs/rig-constraints-and-deformation.md)
- [Getting Started with Mesh Deformation](docs/getting-started-mesh-deformation.md)
- [Mesh attachment quick start, coordinates and current limits](docs/mesh-attachments.md#using-this-milestone)
- [Mesh deformation integration across editors and runtime](docs/mesh-integration.md)
- [GitHub / Primer UI style guide](docs/style-guide.md)
- [Complete artist workflow and production character packages](docs/artist-workflow.md)
- [Reusing Animations and Scenes — artist walkthrough](docs/reusing-animations-and-scenes.md)
- [Reusable Animation Library](docs/animation-library.md)
- [Character variants and reusable templates](docs/character-variants.md)
- [Rig compatibility and bone mapping](docs/rig-compatibility.md)
- [Visual animation retargeting, comparison preview, API and transfer policies](docs/animation-retargeting.md)
- [Advanced Pose Library](docs/pose-library.md)
- [Advanced animation artist workflow](docs/advanced-animation-workflow.md)
- [Using Feature Guide](docs/feature-guide.md)
- [Schema inventory, compatibility policy and canonical serialization](docs/schema-compatibility.md)
- [Root-motion data, runtime evaluation and application](docs/root-motion.md)
- [Visual root-motion authoring and sword-attack walkthrough](docs/root-motion-authoring.md)
- [Root motion and Environment Preview integration](docs/root-motion-environment-preview.md)
- [Scene root motion, ownership and choreography](docs/scene-root-motion.md)
- [Reusable choreography and scene templates](docs/reusable-scenes.md)
- [Root-motion workflow, tool compatibility and hardening](docs/root-motion-hardening.md)

| Guide                                                                  | Contents                                                                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Foot contact markers](docs/foot-contact-markers.md)                   | Visual rig marker editing, bone-local data, validation and post-IK world position evaluation                           |
| [Rig editor](docs/rig-editor.md)                                       | Editing, snapping, undo/redo, validation, imports, exports, and embedding                                              |
| [Animation editor](docs/animation-editor.md)                           | Working copies, property keyframing, keyframe dragging and snapping, playback, and runtime pose preview                |
| [Graph Editor](docs/graph-editor.md)                                   | Property curves, Bézier tangents, precision key editing and shared timeline selection                                  |
| [Onion skinning](docs/onion-skin-controls.md)                          | Configurable multi-pose previews while authoring animation                                                             |
| [Animation Environment Preview](docs/animation-environment-preview.md) | Static project backgrounds, ground references, cameras and temporary [motion previews](docs/motion-preview.md)         |
| [Artwork alignment](docs/visual-artwork-alignment.md)                  | Joints, offsets, sprite origins and slot transforms, including [sprite replacement](docs/sprite-replacement.md)        |
| [Animation Rig Tweak](docs/animation-rig-tweak.md)                     | Rig corrections at a paused animation pose with independent rig and animation histories                                |
| [Scene editor](docs/scene-editor.md)                                   | Actors, action timelines, [audio clips](docs/scene-audio-timeline.md) and [dialogue/subtitles](docs/scene-dialogue.md) |
| [Dialogue holds](docs/dialogue-hold-presentation.md)                   | Idle overlays, hold-only ambience, frozen cinematic time and explicit Advance                                          |
| [Story Editor](docs/story-editor.md)                                   | Visual scene sequencing, dialogue advancement, entire-story preview and project persistence                            |
| [Audio assets](docs/audio-assets.md)                                   | Project audio import, organization, auditioning, runtime loading and limits                                            |
| [Timeline snapping](docs/timeline-snapping.md)                         | Frame/key/event/playhead alignment, zoom-aware tolerance, temporary guides and group timing                            |
| [Keyframe retiming](docs/keyframe-retiming.md)                         | Proportional selected-key timing, anchors, numerical preview and atomic Undo/Redo                                      |
| [Bone symmetry mapping](docs/bone-symmetry-mapping.md)                 | Editor-only pairing candidates, manual overrides, validation, lookup, and rig-session lifecycle                        |
| [Pose mirroring core](docs/pose-mirroring.md)                          | Pure authored-pose reflection, bind frames, hierarchy, supported transforms, and structured failures                   |
| [React mirroring tools](docs/react-mirroring-tools.md)                 | Bone-pair configuration, persistence, preview, directions and React/editor integration                                 |
| [Mirrored keyframe authoring](docs/mirrored-keyframe-authoring.md)     | Current-pose/selected-key commands, sparse properties, timing, collisions, history and selection                       |
| [Character assets and rigs](docs/characters.md)                        | Manifests, JSON validation, slots, skins, artwork, and rig definitions                                                 |
| [Animation queues](docs/animation-queues.md)                           | FIFO requests, completion transitions, loop rejection, interruption and cleanup                                        |
| [Async animation](docs/async-animation.md)                             | Awaitable playback, typed outcomes, cancellation, looping policy and disposal                                          |
| [Actors, movement and facing](docs/actors.md)                          | Optional Puppet facade, world targeting, configurable walk facing, locomotion, animation and ownership                 |
| [Choreography sequences](docs/choreography-sequences.md)               | Sequential/parallel Actor groups, synchronization, deterministic waits, conflicts and owned cancellation               |
| [Animation states](docs/animation-states.md)                           | Named states, transition fades, one-shot returns, playback ownership and disposal                                      |
| [Animation and poses](docs/animation.md)                               | Keyframes, static poses, playback, crossfades, events, layers, and manual updates                                      |
| [IK constraint authoring](docs/ik-constraint-authoring.md)             | Rig model/controller creation, configuration, dependency-safe deletion, history and default targets                    |
| [IK authoring integration](docs/ik-authoring-integration.md)           | New/existing character workflows, Rig Tweak, shared discovery, import safety and runtime ownership                     |
| [React IK authoring](docs/react-ik-authoring.md)                       | IK timeline tracks, numeric target/influence keys, selection, history, and local verification                          |
| [IK production authoring](docs/ik-animation-authoring.md)              | Reaching workflow, operation limits, compatibility, lifecycle and regression coverage                                  |
| [Visual IK targets](docs/visual-ik-targets.md)                         | Phaser crosshairs, dragging, explicit target commitment, coordinate conversion, ownership and verification             |
| [Runtime IK animation](docs/ik-animation-runtime.md)                   | Animated targets and influence, runtime precedence, scrubbing, crossfades, and masks                                   |
| [IK bake sampling](docs/ik-bake-sampling.md)                           | Read-only whole-animation samples, frame times, local transforms and supported constraint scope                        |
| [IK bone-key generation](docs/ik-bake-generation.md)                   | Pure key proposals, replacement reporting, playback policy and local-pose fidelity tolerances                          |
| [Atomic IK bake commit](docs/ik-bake-commit.md)                        | Whole-clip key replacement, runtime constraint deactivation, validation and exact Undo/Redo                            |
| [IK bake production fidelity](docs/ik-bake-hardening.md)               | Key/midpoint/endpoint tolerances, sampling quality, runtime transitions, editing and loader regressions                |
| [IK and object attachments](docs/ik.md)                                | Two-bone solving, transforms, foot planting, katana grips, and attached props                                          |
| [Scene audio playback](docs/scene-audio-playback.md)                   | Scene clock, browser unlock, speed, silent scrubbing, drift correction and standalone audio                            |
| [Development and package usage](docs/development.md)                   | Checks, browser tests, architecture, packaging, and Node APIs                                                          |
| [Performance profiling](docs/profiling.md)                             | Local CPU/browser profiles, workloads, and historical measurements                                                     |

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

## Planned features

- Joint angle limits and optional end-effector rotation alignment.
- More advanced animation state orchestration and editor tooling.
- Transform drag handles.
- Character editing tools and richer asset pipeline integration.

See the [IK animation data model](docs/ik-animation-data.md) for optional target/mix tracks, puppet-local coordinates, stable rig constraint names, validation, and pure authoring APIs. See [runtime IK evaluation](docs/ik-animation-runtime.md) for playback, scrubbing, precedence, and layer blending. See [React IK authoring](docs/react-ik-authoring.md) for timeline constraint selection and numeric property keying. See [visual IK targets](docs/visual-ik-targets.md) for draggable target handles and explicit target-key commits.

## Release notes and hosting

See [release notes and milestone reports](docs/release-notes.md) for historical summaries and readiness assessments, and the [changelog](CHANGELOG.md) for the complete version history.

Pushes to `master` build and deploy the authoring tools through [the Pages workflow](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/.github/workflows/deploy-pages.yml). In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. The workflow publishes `dist/demo` and can also be run from the Actions tab. The authoring tools display the version from `package.json`.
