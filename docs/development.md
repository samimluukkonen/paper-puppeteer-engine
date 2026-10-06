# Development, architecture, and package usage

[All guides](../README.md#guides)

## Checks and profiling

```bash
npm run typecheck
npm test
npm run check
npm run build
npm run preview
```

`check` runs Oxfmt formatting validation, Oxlint linting (including type-aware TypeScript rules), and TypeScript 7's authoritative `tsc --noEmit` check. `npm run check:fix` applies Oxlint's safe fixes, formats with Oxfmt, and checks types. `build` verifies TypeScript and produces **both** the demo in `dist/demo` and the reusable ES module plus declarations in `dist/library`. `preview` serves the production demo. Vitest tests cover rig validation, animation, pure IK math, coordinate adapters, lengths, mix, and pose restoration without requiring a browser; `npm run test:watch` runs them interactively.

Use `npm run format` / `npm run format:check` for formatting, and `npm run lint` / `npm run lint:fix` for linting. Oxfmt's root `.oxfmtrc.json` keeps two-space indentation, single quotes in JavaScript/TypeScript, double quotes in CSS, semicolons, trailing commas, 120-column lines, and sorted imports. Side-effect imports retain their order; embedded code snippets and package fields are not reorganized. Oxfmt covers TypeScript, JavaScript, JSON/JSONC, CSS, HTML, Markdown, and YAML. Dependency/build/coverage/browser-test outputs, caches, temporary directories, and the npm lockfile are excluded. `plans/` holds historical and in-progress design notes and is excluded from formatting to avoid rewriting those records.

Oxlint's root `.oxlintrc.json` uses JSON so it works across the project's supported Node versions. `options.typeAware: true` activates the installed `oxlint-tsgolint` backend with TypeScript 7; experimental compiler diagnostics (`typeCheck`) are deliberately omitted. Correctness rules are errors, with explicit checks for floating/misused promises, awaiting non-promises, array `for-in` loops, unnecessary assertions, unsafe arguments/assignments/calls/member access/returns, type-only imports, duplicate/self imports, and unsafe promise patterns. Non-null assertions remain allowed. React hooks and JSX accessibility checks apply to future `.tsx`/`.jsx` files; the current application uses Phaser and DOM controllers.

Unsafe-value and unbound-method rules are errors throughout application code, tests, and scripts; the migration's transitional warning overrides have been removed. Mock callbacks use explicit signatures, dynamic values are narrowed or validated before use, and deliberately invalid fixtures remain `unknown`. Package scripts validate manifest fields with Zod, and browser fixtures validate shipped data before applying their intentional mutations. Narrow, explained inline exceptions preserve Phaser's explicit listener contexts, deliberately borrowed test methods, listener snapshots, aggregate-error contents, arbitrary validation diagnostics, and intentionally invalid test inputs. Unused exceptions are errors. `eslint/preserve-caught-error` and future React hook dependency checks remain warning-level rules, with no current findings. Suspicious rules are selected individually rather than enabling noisy assertion/style restrictions across the engine.

Install the recommended `oxc.oxc-vscode` extension for format-on-save and explicit safe fixes on save. Existing character JSON schema associations are retained, and the editor inherits type-aware linting from the root config.

Run the small browser smoke suite against the real rig editor, Phaser canvas, and shipped character assets:

```bash
npx playwright install chromium
npm run test:browser
```

The command builds the demo, then runs every scenario against both the Vite development server and the production preview under `/paper-puppeteer-engine/`. Tests cover animation playback, global Home navigation, shortcut typing/modifier/IME guards, repeated animation switching, scrub interruption, demo playback, facing, skins, IK controls, navigation between demo and editor, dragging outside the canvas, inspector focus and per-field undo, and exported/original/imported rig reloads plus a page reload. They verify artwork changes through canvas screenshots and catch browser exceptions and failed local asset requests. CI builds first, then runs `npx playwright test` against that artifact. To use an installed Chrome (including on macOS versions unsupported by bundled Chromium), run `PLAYWRIGHT_CHANNEL=chrome npm run test:browser`. Failure traces are saved under `test-results/`.

Run the optional CPU frame profile with `VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose`. It reports warmed medians for base animation, layered fades, active/inactive IK, and the full demo presentation loop with walk, steady sword grip, out-of-reach targets, head crossings, and upper-body grip in both facings. Demo cases use shipped PNG dimensions and real affine transforms, animation, IK, and render projection. They report mean/maximum `syncPose()` and `syncIK()` calls and the percentage of frames requiring katana corrections. The lightweight scene excludes browser rendering and GPU costs; timings vary by machine and are not test thresholds. Normal test runs skip these measurements. Add `VITE_PROFILE_UNCACHED=1` to recreate unconditional render-order application, or `VITE_PROFILE_FULL_IK_SYNC=1` to compare corrections using the previous full-puppet synchronization path.

The rig editor caches unchanged overlay geometry and labels, redrawing after edits, selection/visibility changes, camera changes, or preview invalidation. Run `VITE_PROFILE=1 npx vitest run tests/rigEditorOverlay.test.ts --reporter=verbose` to compare cached idle frames with forced redraws. This profile uses 33 joints and a minimal scene, excluding browser/GPU costs, and reports timings without performance thresholds.

One local run of the earlier full-sync correction path on Node 24.19.0 measured the following. Sync counts include warmup:

| Katana workload           | Left: µs/frame | Right: µs/frame | Left: mean/max syncs | Right: mean/max syncs |
| ------------------------- | -------------: | --------------: | -------------------: | --------------------: |
| Steady reachable grip     |          93.04 |           64.51 |             1.00 / 1 |              1.00 / 1 |
| Out-of-reach target sweep |         230.99 |          120.66 |            5.73 / 25 |              2.92 / 8 |
| Head crossing sweep       |          79.76 |           77.25 |             1.02 / 2 |              1.39 / 3 |
| Upper-body grip           |          82.71 |           74.18 |             1.00 / 1 |              1.00 / 1 |

The correction loops can dominate out-of-reach frames. The demo now performs one full `syncPose()` per frame, then uses `syncIK()` for target corrections, restoring and projecting only affected IK joints. It defers debug overlays until the final corrected pose and caches render order to skip depth updates/sorting when the order is already applied. The three correction loops remain bounded at 24, 6, and 12 passes, while full synchronizations remain at one. The current profile selects the default skin so body silhouette checks run against the visible cutouts. The profile reports both kinds of passes and debug refreshes. Each profiling case has a 30-second timeout to accommodate slower machines.

Grip correction also reuses transformed head, torso, pelvis, and leg corners within each solve. These passes change arm targets while the body pose and leg targets stay fixed; the next frame rebuilds the cache to reflect animation, placement, facing, and skin changes. Corrections stop when floating-point rounding can no longer move the target, while useful corrections retain the existing iteration limits. Both arms' reach limits are recovered, and body clearance is checked again after smoothing so those adjustments cannot move the rear grip through a cutout.

A local comparison against `89c64e6` on Node 24.19.0, x86_64, used the same scene fixture and seven batches of 2,000 frames after 1,000 warmup frames. Median CPU times in microseconds per frame:

| Scenario                                            | Before |  After |
| --------------------------------------------------- | -----: | -----: |
| 32 tracked bones, base animation                    |  56.61 |  40.65 |
| 32 tracked bones, three layers with fades           | 170.53 | 114.17 |
| 36 bones, one active and 12 inactive IK constraints |  41.19 |  10.37 |

Animation evaluation reuses working poses, clip buffers, and controlled-property sets. IK reuses rotation snapshots and synchronizes each changed bone into its descendant render branches before later target providers run. Inactive constraints still update their status without adding projection passes.

Profile renderer scaling separately from animation and IK:

```bash
VITE_PROFILE=1 npx vitest run tests/puppetRenderer.profile.test.ts --reporter=verbose
```

The profile compares 32- and 128-bone chains with a leaf slot, chains with artwork on every bone, and shallow rigs with a leaf slot. It reports actual container/transform-copy allocations and warmed CPU synchronization medians, excluding browser/GPU costs. Timings are diagnostic and have no test thresholds.

Bones without authored sprites allocate an independent render branch only when `attach()` needs a prop mount. Each sprite, slot, or prop branch uses two transform containers to represent its complete affine transform, including shear, reflection, and singular scales. The renderer composes skeleton matrices in parent order once per full synchronization. Partial IK synchronization recomposes only the changed bone's subtree, preserving unrelated unpublished edits and making descendant mounts current before later target providers run. Creating a lazy mount publishes current source transforms to the renderer before attaching the prop, so subsequent partial updates retain that same ancestor state. The mount uses the current draw order immediately.

| Workload           | Bones | Previous transform copies | Current transform factors | Previous containers | Current containers |
| ------------------ | ----: | ------------------------: | ------------------------: | ------------------: | -----------------: |
| Chain, leaf slot   |    32 |                        32 |                         2 |                  68 |                 37 |
| Chain, leaf slot   |   128 |                       128 |                         2 |                 260 |                133 |
| Chain, all sprites |    32 |                       528 |                        64 |                 594 |                 98 |
| Chain, all sprites |   128 |                     8,256 |                       256 |               8,514 |                386 |

Container counts include the source skeleton and fixture root. Each additional prop mount allocates two transform containers once and reuses them thereafter. Dense artwork now requires linear storage and synchronization work. One local CPU profile measured the 128-bone dense chain at about 26 microseconds per synchronization, versus about 459 microseconds before this change; timings vary by machine. Sparse rigs still traverse their skeleton during full synchronization, so their CPU cost depends on bone count even with only one drawable.

Direct dependencies use exact versions: Zod **4.6.5**, Oxfmt **0.72.0**, Oxlint **1.87.0**, oxlint-tsgolint **7.0.2003**, Phaser **4.2.1**, Vite **8.3.1**, TypeScript **7.0.2**, Vitest **5.0.2**, Playwright **1.63.0**, and Node type definitions **24.19.1**. `package-lock.json` locks the resolved dependency graph. The Oxc tools use the latest npm releases at migration time; TypeScript **7.0.2** remains the latest stable compiler.

## Architecture

```text
src/engine/
  CharacterDefinition.ts  Manifest assembly and cross-file validation (no I/O)
  CharacterLoader.ts      Fetches manifest, rig, skins, animations, and poses as JSON
  Pose.ts             Static pose validation, blending, and sparse serialization
  queueCharacterTextures.ts  Queues image files with Phaser's scene loader
  mergeSkins.ts         Shared embedded/standalone skin precedence
  types.ts             JSON-friendly rig and transform definitions
  schemas.ts           Zod schemas for rig, animation and IK definitions
  externalData.ts      Versioned JSON formats, validation and parsing
  Rig.ts               Validation, immutable rig snapshot, indexed definitions, parent-first ordering
  Joint.ts             Renderer-independent bind pose and mutable local pose
  Bone.ts              Joint backed by a Phaser container and optional image
  AnimationClip.ts      Keyframe types, validation and property-track compilation
  AnimationPlayer.ts    Layer clocks, transitions, events and completion
  AnimationLayerEvaluator.ts  Layer sampling, blending, pose buffers and controlled properties
  AnimationPose.ts      Pure clip evaluation and pose blending
  Puppet.ts            Hierarchy, playback API, facing, attachments and lifecycle
  PuppetPoseController.ts  Pose overrides, restoration, IK ordering and projection passes
  PuppetDebug.ts       Scene-space joint, pivot and hierarchy overlay
  PuppetRenderer.ts    Independent draw slots with constant-size affine factors
  affineProjection.ts  Two-factor affine decomposition preserving shear and singular scales
  SlotState.ts         Attachment selection and base/partial skin application
  SlotDebug.ts         Scene-space slot position and assignment overlay
  ik/
    types.ts           Targets, constraint definitions and coordinate adapter
    solveTwoBoneIK.ts  Pure law-of-cosines solver and angular blending
    TwoBoneIKConstraint.ts  Chain validation, effective lengths and pose solving
    IKPoseState.ts     Pre-IK rotation restoration between passes
    IKDebug.ts         Independent world-space IK overlay
  index.ts             Public library entry point
  core.ts              Renderer-independent public entry point for Node and asset tooling
src/demo/
  DemoScene.ts         Character loading, playback controls and UI state
  DemoInput.ts         Pointer/keyboard bindings and shutdown cleanup
  demoCommands.ts      Shared button commands and pose-aware keyboard shortcuts
  DemoPoseAuthoring.ts  Static pose editing, inspector and export
  DemoPresenter.ts     Sampled pose layout, IK coordination and target markers
  DemoFootPlanting.ts  Ground targets, body sway and walk contact constraints
  DemoKatanaController.ts  Weapon modes, arm targets, mounting and draw layers
  DemoKatanaGripSolver.ts  Rear-palm clearance, path continuity and reach recovery
  demoPresentation.ts  Walking arm order and walking/idle shoulder placement by facing
  demoCharacterProfiles.ts  Per-character placement, facing, grips, foot contacts and IK configuration
  demoIK.ts            Default arm/leg chains with explicit execution priorities
  Katana.ts            Placeholder weapon transform and two data-defined grips
src/devtools/rig-editor/
  main.ts              Page bootstrap and controller wiring
  editorMarkup.ts      Static page shell
  InspectorController.ts  Numeric editing, derived labels, and field undo grouping
  HierarchyController.ts  Cached tree rendering and selection
  ControlsController.ts   Editing, snapping, visibility, and preview controls
  SessionController.ts    Status, validation, history actions, export, reload, and import
  RigEditorScene.ts    Character loading and preview session lifecycle
  RigEditor.ts         Editor activation and working-rig preview synchronization
  RigEditorInputController.ts  Dragging, keyboard commands, and input listener lifecycle
  RigEditorState.ts    Working rig, validation, bounded history, and serialization
src/devtools/animation-editor/
  main.ts              Animation editor page and Phaser bootstrap
  AnimationEditorScene.ts  Sample/custom character loading and preview lifecycle
  AnimationEditorState.ts  Owned animation data, transform drafts, authored FPS/mode and history
  AnimationEditorPlayback.ts  Sole continuous editor clock, preview speed/loop and scrub playback intent
  AnimationEditorPreview.ts  Runtime sampling of the working copy and puppet synchronization
  TimelineController.ts   Responsive ruler, pointer capture, keyboard navigation and status display
  timeline.ts          Pure duration, coordinate conversion, clamping and ruler generation
src/devtools/shared/
  SnapshotHistory.ts   Bounded snapshot history and operation grouping
  editorGame.ts        Shared Phaser rendering and scaling defaults for editor previews
  editorCamera.ts      Reusable screen-space panning and pointer-anchored camera zoom
  editorData.ts        Readonly data and editor number rounding
src/shared/
  downloadJson.ts       Browser JSON download and temporary URL cleanup
  loadSceneCharacter.ts  Cancelable metadata and artwork loading for a scene session
public/characters/demo-puppet/  Shipped rig, skins, animations, poses, and artwork
docs/                  Focused user and developer guides
src/main.ts            Demo bootstrap and control panel
```

The engine does not import demo code or assets. `Rig`, `Joint`, `AnimationPlayer`, the IK solver, and `TwoBoneIKConstraint` do not depend on Phaser. Bone containers provide the joint hierarchy; each image and its attachments have an independent draw slot with two factors representing their composed ancestor transform. This permits global drawing order while preserving rotation, scaling, and shear. `syncPose()` applies the evaluated pose, executes IK, then synchronizes rendering and debug overlays. Debug overlays allocate their Phaser objects only when first enabled and reuse them across toggles; label-side settings made before enabling debug are retained. The puppet's outer container provides placement, scale, and facing independently of animation tracks. The demo uses one texture per WebGL batch for reliable rendering on software WebGL; hosts control their own Phaser renderer settings.

Demo character identities and picker labels live in `src/shared/characterCatalog.ts`; presentation is configured in `src/demo/demoCharacterProfiles.ts`. Each profile supplies clip names for the idle, walk, and sword actions, the upper-body clip and bone mask, combat pose name, appearance overrides, stage placement, IK definitions and names, layout/facing behavior, katana grip and clearance settings, and foot contact settings. The default skin comes from the character definition. The demo scene, presenter, pose authoring, and rig-editor IK preview consume those profiles. Register another catalog entry and profile alongside its character definition to add a demo character; sample layout and sketch limb swapping still expect their existing humanoid bone and limb attachment conventions.

To profile dense animation playback and nonsequential scrubbing, run:

```bash
VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose -t dense
```

The profiles cover 32 tracked bones with two properties per track, 128 or 512 keys, base playback, three layers with fades, and backward/forward scrubbing. Property sampling uses binary search without a mutable cursor. A local comparison of warmed CPU medians (microseconds per frame, excluding browser/GPU costs) measured:

| 512-key workload        | Linear scan | Binary search |
| ----------------------- | ----------: | ------------: |
| Base animation          |      156.72 |         47.22 |
| Three layers with fades |      656.91 |        155.48 |
| Nonsequential scrubbing |      135.47 |         33.35 |

These are diagnostic measurements from one machine, not CI timing thresholds. The two-key control profiles remain available by omitting `-t dense`.

Character definitions lazily cache compiler-owned immutable clips in `compiledAnimations`. Puppets created from the same definition share those clips while retaining independent clocks, event listeners, pose buffers, and disposal. Supplying `animations` explicitly (including an empty array) overrides the character clips and keeps ordinary runtime validation and snapshot ownership.

## Use as a local package

`new Rig(existingRig)` shares its validated immutable skeleton and indexes. Pass a second skin array to create a rig with independently validated, owned skins: `new Rig(existingRig, skins)`. The rig editor uses this to retain authored skins separately from preview skins, and its working copy stays independent of the shared source skeleton. New JSON imports still receive full rig validation.

Build this repository first, then in another Phaser TypeScript project:

```bash
npm install /absolute/path/to/paper-puppeteer-engine
```

```ts
import { Puppet, type RigDefinition, type AnimationClip } from 'paper-puppeteer-engine';
```

`npm pack` validates the package version with `npm run check:version`, then rebuilds the library through the `prepack` hook before creating a tarball. Package versions use SemVer; milestone 0.5.2.3.1 is represented as `0.5.2-3.1`. Run `npm run test:package` to install that tarball into a temporary consumer and verify Node `/core` imports, public TypeScript APIs, and browser bundling. The check reuses installed dependencies offline and removes its temporary files afterward. CI runs it after the build. Core declarations receive a full type check; browser consumer types use the repository's `skipLibCheck` setting for Phaser declarations.

The library includes TypeScript declarations and source maps. Zod is externalized and supplied through the package dependency, so consumers share its validation runtime and error classes. Phaser is externalized and declared as an exact peer dependency so the consumer provides the same Phaser runtime. No package has been published. Engine rendering APIs are browser-based and should be imported in a browser environment.

For Node scripts and asset tooling, import the renderer-independent entry point:

```ts
import { CharacterLoader, validateRigDefinition, Joint, AnimationPlayer, solveTwoBoneIK } from 'paper-puppeteer-engine/core';

const character = await CharacterLoader.load('https://example.com/characters/hero/character.json');
const joints = new Map(character.rig.bones.map(bone => [bone.id, new Joint(bone.id, bone)]));
const player = new AnimationPlayer(character.rig, joints);
```

`/core` exports character loading and validation, rig/slot data, pose and animation APIs, and IK without loading Phaser or requiring browser globals. `CharacterLoader.load` accepts an optional fetch implementation for file system or custom I/O. Every library build checks the built `/core` package in plain Node.

For stateless pose tooling, import `compileClip` and `evaluateClip` from `/core`: `compileClip(clip, rig)` validates and prepares an authored clip, and `evaluateClip(compiled, timeMilliseconds)` returns its sparse interpolated pose. `CompiledClip`, `CompiledTrack`, and `PropertyKeyframe` are also exported types. This evaluator uses raw interpolation; use `AnimationPlayer.sample(time, { mode: 'playback' })` for playback-aware previews.

Compiled clips own immutable metadata, property maps, keyframes, playback settings, and JSON event payloads, so they can be shared between compatible players. `AnimationPlayer` takes an independent snapshot of externally assembled compiled clips. Non-JSON runtime event payloads retain reference semantics; listener notifications receive independent metadata and copies of JSON payloads.
