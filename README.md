# Paper Puppeteer Engine

A reusable TypeScript + Phaser engine for 2D paper puppets: rigid transparent cutouts connected by hierarchical joints, animated through local keyframed transforms. The engine includes static pose presets, bind pose reset, a developer pose inspector, pose JSON export, crossfades, timeline events, stepped playback, masked animation layers, IK, facing, slots, and skins. The demo and editor display the version from `package.json`.

**Live demo:** [GitHub Pages](https://samimluukkonen.github.io/paper-puppeteer-engine/)

Pushes to `master` build and deploy the demo through [the Pages workflow](.github/workflows/deploy-pages.yml). In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. The workflow publishes `dist/demo` and can also be run from the Actions tab.

## Install and run

Requires Node.js **20.19+ or 22.12+** (Node 24 recommended) and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The demo starts in idle. The control panel also supports clicking/tapping.

## Rig editor

Open `/rig-editor/` from the demo's **Open Rig Editor** link. The editor loads the sample character with its default skin and shows its canonical bind pose in right facing. Select bones by clicking joints or their parent lines, or use the hierarchy. Select slots by clicking their square markers or hierarchy entries. Hold Alt while clicking when a slot overlaps a joint.

Choose **Joint** to drag a joint and change its local position; descendants follow their parent transforms. Choose **Sprite** to drag selected artwork independently of its skeleton joint. A selected slot's square marker moves the slot; in Sprite mode, dragging its artwork moves the attachment offset. The inspector edits local x/y, rotation in radians, scale, logical length, sprite offset and normalized origin. It also shows degrees for reference. Arrow keys nudge a selected joint by one unit; Shift uses ten. Comma and period rotate by 0.01 radians; Shift uses 0.1. Inputs and drags update the preview immediately. When a parent has an explicit logical length, child x/y edits set the joint's direction while that length controls its distance in both the preview and the exported runtime rig. A zero child offset uses the parent's positive y axis. Logical length changes reposition direct child joints along their current directions and do not scale images.

Bone depth edits change preview draw order; enter a lower value to move a piece back or a higher value to move it forward. Slot depth is a global numeric draw depth. **Dim unselected artwork** helps expose overlapping parts. **IK Preview** pins the current chain endpoints and runs the existing solver as the rig changes; its temporary pose does not enter the working rig. Visibility controls show artwork, bones, names, lengths, slots, origins, and IK chains. Mouse wheel zoom and middle mouse pan affect only the camera.

Production workflow:

1. Start the rig editor and load the sample character. Select bones or slots in the hierarchy or canvas.
2. Position joints, then use Sprite mode or inspector fields to adjust artwork offsets and origins. Set logical bone lengths, slot transforms, and render depth as needed.
3. Preview IK. Use Grid (Off, 1, 2, 5, 10) for drag and nudge translation, and Rotation Snap (Off, 1°, 5°, 15°) for keyboard rotation. When Grid is on, the canvas shows lines aligned with the selected joint, slot, or artwork's local edit coordinates. At low zoom it shows a readable subset of those snap lines. Numeric fields retain exact values. Snapping never changes untouched values.
4. Undo with Ctrl/Cmd+Z and redo with Ctrl/Cmd+Shift+Z. A canvas drag or one numeric field focus session makes one history entry. A new edit after undo clears redo. **Reset Selected** restores the selected bone or slot and its active artwork attachment to session-start values; **Reset Rig** restores the whole session-start rig. Both resets are undoable.
5. Click **Validate**. Export uses the complete versioned rig validator and blocks errors, showing their paths and messages. The session panel reports character, file, mode, selection, snapping, modified state, and validation state.
6. Click **Copy rig JSON**, **Download rig.json**, or **Log rig JSON**. Each generates readable, stable, version 1 JSON with canonical local transforms. Edited numbers use six decimal places; untouched numbers retain their original precision. Export marks the current working copy as the saved baseline, so Modified becomes No. Further edits become dirty; undoing back to the exported state becomes clean.
7. Click **Reload exported rig** to rebuild the puppet preview from the last export and verify its appearance. **Reload original rig** starts a new session from the shipped file. **Load rig JSON** accepts a local JSON file for the same character and validates it before rebuilding the preview. The imported rig must use textures already loaded for that character.

The exported file keeps the rig name and IDs. Skin files from `character.json` stay separate unless skins were already embedded in the rig file. Copy needs a browser with clipboard access; Download and Log are alternatives. Reloading starts a new clean history and resets selection and preview controls.

Undo history retains the most recent 100 operations by default, dropping the oldest entries as the limit is reached. Embedded editors can configure this with `new RigEditorState(rig, rigFile, { historyLimit: 250 })`; pass that state to `RigEditor`. The limit must be a nonnegative safe integer; zero disables undo/redo. Grouped drags and field edits count as one operation. Saved baselines and full-rig reset remain available after older history is dropped.

Field values are checked immediately while editing. Full rig validation runs when a drag or numeric field session finishes; the panel shows Pending during edits. Validate and export always check the current rig, including unfinished edits.

For embedded editors, `workingCopy`, `getBone()`, `getSlot()`, and `getAttachment()` return frozen readonly data. Use the state's `editBoneFields()`, `editSlotFields()`, and `editSpriteFields()` methods to preserve validation, dirty tracking, and undo history. Retained views keep their previous values after edits; request a fresh view to read the current data, or use `structuredClone(state.workingCopy)` for an independent mutable copy.

| Key | Action |
| --- | --- |
| `1` | Play / restart idle |
| `2` | Play / restart walk |
| `3` | Two-handed katana stance; enables hand IK |
| `4` / `5` | Crossfade to idle / walk over 300 ms |
| `S` | Toggle smooth / stepped playback |
| `8` / `0` | Set stepped playback to 8 / 10 FPS |
| `L` | Toggle the masked upper-body sword layer |
| `P` | Pause / resume animation clocks |
| `[` / `]` | Decrease / increase playback speed by 0.25× |
| `A` / `D` | Face left / right |
| `B` | Toggle joint pivots, hierarchy lines, and bone names |
| `I` | Toggle IK targets, joints, chain lines, lengths, bend signs and names |
| `H` | Toggle mouse-controlled right-hand IK |
| `F` | Toggle fixed world-space foot targets and gentle body sway |
| Mouse | Move the hand target while hand IK is enabled |
| `Q` / `E` | Rotate the katana in either pose; the right-facing two-handed rear palm stays visible beside the body |
| `T` | Hide / show the katana |
| `K` / `M` | Select default / armored skin |
| `G` | Swap open / gripping right hand |
| `N` | Toggle the headwear skin override |
| `V` | Toggle slot markers, names, parent bones, and attachment names |
| `Space` | Stop at the current pose / restart |
| `R` | Restart the current clip |
| `O` | Enter / exit pose authoring mode |
| `C` (pose mode) | Apply the sample combat-ready pose |
| `R` (pose mode) | Reset to bind pose |
| `[` / `]` (pose mode) | Select previous / next bone |
| `←` / `→` (pose mode) | Rotate selected bone by 0.01 radians; `Shift` uses 0.1 |
| `Alt` + `←` / `→` (pose mode) | Move selected bone's local x by 1; `Shift` uses 5 |
| `↑` / `↓` (pose mode) | Move selected bone's local y by 1; `Shift` uses 5 |
| `U` (pose mode) | Reset selected bone to its bind transform |
| `X` (pose mode) | Print, copy, and download pose JSON |
| `J` (pose mode) | Print normalized rig JSON to the console |

To compare playback styles, press `2`, then `S` and `8`. The walk pose updates eight times per second while Phaser continues rendering and IK still solves every frame. Press `S` again for smooth motion. Press `4` and `5` to compare crossfades in both directions. Press `L` during walking to keep the legs walking under a sword-ready upper body. The status panel shows the current event, transition progress, playback speed and layer state.

To verify the hierarchy, press `2`, then `B`: elbow, wrist, and hand follow the upper arm; knee, ankle, and foot follow the thigh. Press `A` and `D` to see the entire skeleton mirror while the labels stay readable. Press `Space` to freeze a pose. `T` demonstrates attachment ownership.

The single `T` control shows a sprite attachment in the right-hand item slot during idle and walk. The sword stance uses the existing grip-aware Phaser prop so its second hand can follow the hilt. Both respond to `Q` / `E` with the same facing-aware angle. Switching poses changes the visual representation without showing two swords.

Press `H` and move the mouse over the stage to aim the right wrist. Press `I` to inspect the chain and residual line to an unreachable target. Press `F` to plant the feet while walking; they alternate between a grounded stance and a lifted return step. Idle and sword use their authored, nearly straight leg pose. Press `3`, then rotate with `Q` / `E`: the left wrist follows the second katana grip. Switching to idle or walk disables hand IK; foot IK has its own toggle. Turn off `F` to inspect the original authored gait.

The two-handed katana stance reuses idle's pelvis bob, leg rotations, and facing-dependent hip positions. This keeps the lower-body pose the same when switching between idle and the stance, even when foot planting is enabled for walking.

Each limb has a consistent color across all its pieces: left arm blue, right arm purple, left leg coral, and right leg gold. The legend beside the stage identifies them; it moves below the stage on narrower screens.

The walk is authored facing right: thighs swing forward and backward, knees stay fairly straight through stance and flex for the shorter return swing, and the legs alternate half a cycle apart. A smaller pelvis rise and gentler foot lift keep the knees from folding too deeply. Walking uses the same thigh attachment points on the pelvis as idle for each facing direction. Mirroring the root reverses the whole gait for left-facing playback. Right-facing idle tilts the right arm slightly toward screen-left and the left arm slightly toward screen-right.

During walking and idle, the whole left arm draws behind the body when facing right, and the whole right arm draws behind the body when facing left; the other arm draws in front of the body. The near leg draws in front of the pelvis and the far leg: the right leg when facing right, and the left leg when facing left. During walking and idle in both directions, the left arm attaches to the screen's right-side shoulder and the right arm to the left-side shoulder. Both animations swap hip positions when facing right and keep the default hip positions when facing left. The right elbow bends inward in idle and has a stronger bend during walking; both bends mirror with facing. Props follow their hand's draw slot.

```bash
npm run typecheck
npm test
npm run check
npm run build
npm run preview
```

`check` runs Biome's formatting, lint, and import checks; `npm run check:fix` applies safe fixes. `build` verifies TypeScript and produces **both** the demo in `dist/demo` and the reusable ES module plus declarations in `dist/library`. `preview` serves the production demo. Vitest tests cover rig validation, animation, pure IK math, coordinate adapters, lengths, mix, and pose restoration without requiring a browser; `npm run test:watch` runs them interactively.

Run the small browser smoke suite against the real rig editor, Phaser canvas, and shipped character assets:

```bash
npx playwright install chromium
npm run test:browser
```

The command builds the demo, then runs every scenario against both the Vite development server and the production preview under `/paper-puppeteer-engine/`. Tests cover demo playback, facing, skins, IK controls, navigation between demo and editor, dragging outside the canvas, inspector focus and per-field undo, and exported/original/imported rig reloads plus a page reload. They verify artwork changes through canvas screenshots and catch browser exceptions and failed local asset requests. CI builds first, then runs `npx playwright test` against that artifact. To use an installed Chrome (including on macOS versions unsupported by bundled Chromium), run `PLAYWRIGHT_CHANNEL=chrome npm run test:browser`. Failure traces are saved under `test-results/`.

Run the optional CPU frame profile with `VITE_PROFILE=1 npx vitest run tests/perFrame.profile.test.ts --reporter=verbose`. It reports warmed medians for base animation, layered fades, active/inactive IK, and the full demo presentation loop with walk, steady sword grip, out-of-reach targets, head crossings, and upper-body grip in both facings. Demo cases use shipped PNG dimensions and real affine transforms, animation, IK, and render projection. They report mean/maximum `syncPose()` calls and the percentage of frames requiring katana corrections. The lightweight scene excludes browser rendering and GPU costs; timings vary by machine and are not test thresholds. Normal test runs skip these measurements. Add `VITE_PROFILE_UNCACHED=1` to recreate unconditional render-order application for comparison.

One local run of the extended profile on Node 24.19.0 measured the following. Sync counts include warmup:

| Katana workload | Left: µs/frame | Right: µs/frame | Left: mean/max syncs | Right: mean/max syncs |
| --- | ---: | ---: | ---: | ---: |
| Steady reachable grip | 93.04 | 64.51 | 1.00 / 1 | 1.00 / 1 |
| Out-of-reach target sweep | 230.99 | 120.66 | 5.73 / 25 | 2.92 / 8 |
| Head crossing sweep | 79.76 | 77.25 | 1.02 / 2 | 1.39 / 3 |
| Upper-body grip | 82.71 | 74.18 | 1.00 / 1 | 1.00 / 1 |

The correction loops can dominate out-of-reach frames: each extra sync restores the pose, projects all bones, and executes IK. The demo defers debug overlays until the final corrected pose and caches render order to skip depth updates/sorting when the order is already applied. Existing iteration limits preserve grip behavior. The profile reports debug refreshes as well as pose synchronization counts and covers the remaining cost for future targeted optimization. Each profiling case has a 30-second timeout to accommodate slower machines.

A local comparison against `89c64e6` on Node 24.19.0, x86_64, used the same scene fixture and seven batches of 2,000 frames after 1,000 warmup frames. Median CPU times in microseconds per frame:

| Scenario | Before | After |
| --- | ---: | ---: |
| 32 tracked bones, base animation | 56.61 | 40.65 |
| 32 tracked bones, three layers with fades | 170.53 | 114.17 |
| 36 bones, one active and 12 inactive IK constraints | 41.19 | 10.37 |

Animation evaluation reuses working poses, clip buffers, and controlled-property sets. IK reuses rotation snapshots and synchronizes each changed bone into all of its render projections before later target providers run. Inactive constraints still update their status without adding projection passes.

Direct dependencies use exact versions: Zod **4.6.5**, Biome **2.5.14**, Phaser **4.2.1**, Vite **8.3.1**, TypeScript **7.0.2**, Vitest **5.0.2**, Playwright **1.63.0**, and Node type definitions **24.19.1**. `package-lock.json` locks the resolved dependency graph.

## Architecture

```text
src/engine/
  CharacterDefinition.ts  Manifest assembly and cross-file validation (no I/O)
  CharacterLoader.ts      Fetches manifest, rig, skins, animations, and poses as JSON
  Pose.ts             Static pose validation, blending, and sparse serialization
  queueCharacterTextures.ts  Queues image files with Phaser's scene loader
  types.ts             JSON-friendly rig and transform definitions
  schemas.ts           Zod schemas for rig, animation and IK definitions
  externalData.ts      Versioned JSON formats, validation and parsing
  Rig.ts               Validation, immutable rig snapshot, parent-first ordering
  Joint.ts             Renderer-independent bind pose and mutable local pose
  Bone.ts              Joint backed by a Phaser container and optional image
  AnimationClip.ts      Keyframe types, validation and property-track compilation
  AnimationPlayer.ts    Layer clocks, transitions, events and completion
  AnimationPose.ts      Pure clip evaluation and pose blending
  Puppet.ts            Hierarchy, playback API, facing, attachments and lifecycle
  PuppetDebug.ts       Scene-space joint, pivot and hierarchy overlay
  PuppetRenderer.ts    Independent draw slots retaining ancestor transform chains
  SlotState.ts         Attachment selection and base/partial skin application
  SlotDebug.ts         Scene-space slot position and assignment overlay
  ik/
    types.ts           Targets, constraint definitions and coordinate adapter
    solveTwoBoneIK.ts  Pure law-of-cosines solver and angular blending
    TwoBoneIKConstraint.ts  Chain validation, effective lengths and pose solving
    IKPoseState.ts     Pre-IK rotation restoration between passes
    IKDebug.ts         Independent world-space IK overlay
  index.ts             Public library entry point
src/demo/
  DemoScene.ts         Character loading, playback controls and UI state
  DemoInput.ts         Pointer/keyboard bindings and shutdown cleanup
  DemoPoseAuthoring.ts  Static pose editing, inspector and export
  DemoPresenter.ts     Sampled pose layout, IK coordination and target markers
  DemoFootPlanting.ts  Ground targets, body sway and walk contact constraints
  DemoKatanaController.ts  Weapon modes, arm targets and continuous rear-palm constraints
  data/                Versioned JSON rig and idle animation
  demoRig.ts           Parsed 16-joint character
  demoAnimations.ts    Parsed idle and TypeScript-authored walk/sword data
  demoPresentation.ts  Walking arm order and walking/idle shoulder placement by facing
  createTextures.ts    Legacy generated cutouts for TypeScript demos
  demoIK.ts            Arm/leg chains with explicit execution priorities
  Katana.ts            Placeholder weapon transform and two data-defined grips
src/devtools/rig-editor/
  main.ts              Page bootstrap and controller wiring
  editorMarkup.ts      Static page shell
  InspectorController.ts  Numeric editing, derived labels, and field undo grouping
  HierarchyController.ts  Cached tree rendering and selection
  ControlsController.ts   Editing, snapping, visibility, and preview controls
  SessionController.ts    Status, validation, history actions, export, reload, and import
  RigEditorScene.ts    Character loading and preview session lifecycle
  RigEditor.ts         Canvas editing and working-rig preview synchronization
  RigEditorState.ts    Working rig, validation, bounded history, and serialization
src/main.ts            Demo bootstrap and control panel
```

The engine does not import demo code or assets. `Rig`, `Joint`, `AnimationPlayer`, the IK solver, and `TwoBoneIKConstraint` do not depend on Phaser. Bone containers provide the joint hierarchy; each image and its attachments have an independent draw slot with a copy of their ancestor transform chain. This permits global drawing order while preserving rotation, scaling, and shear. `syncPose()` applies the evaluated pose, executes IK, then synchronizes rendering and debug overlays. The puppet's outer container provides placement, scale, and facing independently of animation tracks. The demo uses one texture per WebGL batch for reliable rendering on software WebGL; hosts control their own Phaser renderer settings.

## Static poses and authoring

A pose file is a version 1 JSON object with a name and sparse local bone transforms. Rotations are radians. Every property is an absolute local value; properties and bones left out preserve their current underlying pose. The sample is [combat-ready.json](public/characters/demo-puppet/poses/combat-ready.json). List pose paths in the optional `poses` array of `character.json`; `CharacterLoader` loads and validates them against the rig. For programmatic puppets, pass `poses` to the constructor or call `addPose`. Invalid versions, unknown bones, extra fields, and nonfinite values are rejected.

```json
{ "version": 1, "name": "combat-ready", "bones": { "torso": { "rotation": -0.08 }, "rightForearm": { "rotation": -1.1 } } }
```

```ts
puppet.applyPose('combat-ready');
puppet.applyPose('combat-ready', { mix: 0.5 });
puppet.clearPose();
puppet.resetToBindPose();
const json = JSON.stringify(puppet.exportPose('my-pose'), null, 2);
const rigValues = puppet.exportRig();
```

`mix` ranges from 0 to 1. At 0 the pose changes nothing; at 1 it fully replaces named properties. A preset remains active across updates until `clearPose`, another `applyPose`, or bind reset. Each joint's immutable `bindPose` comes from the normalized rig and remains available after reset. Evaluation order is **bind/rest pose → base animation → animation layers → persistent pose preset → IK → rendered pose**. Animation does not advance when paused or stopped. IK is temporary: its changes are restored before the next evaluation and before export. `resetToBindPose()` clears animation layer state and the active preset, resets joint transforms, and disables IK constraints so the displayed result matches the bind pose. It leaves the rig, registered clips, and registered poses intact. Resume IK explicitly if needed.

Press `O` in the demo to enter the developer inspector. It stops animation, resets joints, disables IK, and restores a consistent draw order and limb placement for the current facing. The on-screen panel shows the selected bone's local x, y, rotation, and scales. Use the controls in the table above to select and adjust a bone. `A` / `D` change facing while preserving manual adjustments relative to the facing layout. `C` loads the combat-ready preset as editable values; `R` resets the current facing's rest layout. Pressing `O` again exits the inspector and starts idle. `X` logs JSON, copies it when clipboard access is available, and downloads `exported-pose.json`. Export compares each authored local property with its rig bind value using an epsilon of `0.0001`, so unchanged properties are omitted. The demo's right-facing layout may therefore export shoulder, hip, and arm corrections even before manual edits; those values are needed to recreate that facing-specific pose. Save the result under a character's `poses/` directory and add its path to `character.json`; it will load like the sample pose. `J` logs a versioned rig snapshot with normalized local positions, rotation, logical lengths, slot transforms, sprite offsets, and origins. These exports contain data only, never Phaser objects. The rig snapshot reflects loaded rig definitions; tuning pivots or sprite offsets still requires editing the rig JSON.

The recommended new character workflow is: load the artist's artwork, load its rig, press `B` to inspect bones, tune pivots and sprite offsets in the rig JSON, press `O` to inspect and adjust a pose, press `X` to export it, save the file under `poses/`, then use its name in scripted scenes. The `schemas/` folder has JSON Schemas for character, rig, skin, animation, and pose files, generated from the engine's Zod definitions. Run `npm run schemas:generate` after changing file shapes or scalar constraints; tests check that the committed schemas stay in sync. Rig references and animation timeline rules are shared by file validation and runtime construction. This repository includes VS Code file associations in `.vscode/settings.json`; external projects can associate the packaged schemas with their own folders.

## External characters

The primary demo loads [character.json](public/characters/demo-puppet/character.json) from `public/characters/demo-puppet/`. The folder contains `rig.json`, three skin files, four animation files, `poses/combat-ready.json`, and transparent PNG files under `images/`. The combat idle file has the runtime clip name `sword`; file names and stable animation IDs can differ.

The version 1 manifest names a rig path, a default skin key, skin keys mapped to JSON paths, animation and optional pose JSON paths, and Phaser texture keys mapped to image paths. All paths resolve relative to `character.json`. Texture keys are separate from bone, slot, and attachment IDs. `frame` on an attachment or legacy bone sprite selects an atlas frame when the host has preloaded an atlas under the named texture key. The sample uses ordinary PNGs.

```json
{
  "version": 1,
  "id": "demo-puppet",
  "rig": "rig.json",
  "defaultSkin": "default",
  "skins": { "default": "skins/default.json", "alternate": "skins/alternate.json" },
  "animations": ["animations/idle.json", "animations/walk.json"],
  "poses": ["poses/combat-ready.json"],
  "textures": { "paper-head": "images/paper-head.png" }
}
```

`CharacterLoader.load` fetches JSON metadata only. Queue images through Phaser after loading the metadata, then construct the puppet when Phaser reports completion:

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

For Phaser `preload`, custom pipelines, generated content, or tests, pass already parsed values to `CharacterDefinition.fromData({ manifest, rig, skins, animations, poses }, optionalManifestUrl)`. The `skins`, `animations`, and `poses` objects are indexed by the paths in the manifest. `queueCharacterTextures` skips texture keys already loaded in the scene, so an app can preload an atlas itself. `definition.textureUrl(key)` resolves a key to a URL when given a manifest URL; without one it returns the authored path. `new Puppet(scene, { rig, animations, poses, skin })` and TypeScript-authored rigs and clips continue to work.

Texture keys are shared across every scene in a Phaser game. Use unique keys such as `hero-body` and `enemy-body` for different artwork, updating the manifest and rig texture references together. `queueCharacterTextures` tracks queued and loaded character image URLs and rejects a conflicting key before queueing any files. Identical URLs can share a key, and host-preloaded atlas keys retain their intentional override. Failed loads and scene shutdown release pending reservations. The helper returns a cleanup callback for hosts that cancel a load themselves; call it after canceling the loader to release reservations and listeners.

`validateCharacterDefinition(data)` returns structured `{ severity, path, message }` issues without Phaser. It checks the manifest version and shape, missing files, default skin, skin and slot references, attachment texture keys, duplicate animation names, and animation bone references in addition to the existing rig and timeline rules. `CharacterDefinition.fromData` throws `CharacterValidationError` with those issues. Validation checks declared texture keys and image paths; image bytes and atlas frame existence are checked by Phaser at load or Puppet construction.

### Artist workflow

```text
Artist exports transparent PNG body parts
  ↓ developer assigns stable texture keys
rig.json defines skeleton and pivots
  ↓ slots connect visuals to bones
skins/*.json choose attachments
  ↓ animations/*.json reference stable bone IDs
character.json ties the files together
```

Export near and far limbs separately, as well as weapons and alternate hand states. Keep a consistent resolution and enough transparent canvas near joints. The image center is not the joint pivot: rig bone positions define the skeleton, while attachment `x`/`y` offset the image and `originX`/`originY` set its normalized pivot within the image. Adjust these values in JSON to align art without re-exporting PNGs. Keep asset filenames and texture keys independent of bone IDs such as `leftUpperArm`, `leftForearm`, and `leftHand`.

`Rig`, animation registration and IK constraint construction validate plain input with Zod before applying hierarchy and timeline rules. Their underlying `rigDefinitionSchema`, `animationClipSchema` and `twoBoneIKDefinitionSchema` are also public. Use the versioned parsers below for external rig and animation files; they add version, JSON compatibility, hierarchy and timeline checks. Validation runs when definitions are loaded or registered, not during animation frames.

## Load versioned JSON

Identifiers (bone, slot, attachment, texture, skin, animation, event, pose, character, and IK names and references) are nonempty strings. `__proto__` is reserved and rejected before parsing or pose serialization because record parsers discard that key. Other names, including `toString`, `constructor`, and `prototype`, are allowed. Dictionary lookups use only own entries; inherited texture and file names do not resolve. File paths and descriptive metadata are separate from identifiers.

The external formats currently use `RIG_FORMAT_VERSION = 1` and `ANIMATION_FORMAT_VERSION = 1`. A rig file has `version`, optional `name`, `root`, and `bones`. Bone records use `id`, optional `parent`, local `x`, `y`, `rotation`, `scaleX`, `scaleY`, optional nonnegative `length`, optional `depth`, and optional `sprite` with texture/frame, offsets, normalized origins, scales, and depth. The bone container origin is its pivot. An animation file has `version`, `name`, positive `duration` in milliseconds, `loop`, `tracks` keyed by bone id, optional `events`, and optional `playback` (`{ "mode": "smooth" }` or `{ "mode": "stepped", "fps": 10 }`). Keyframes have `time` and any of the five local transform properties. See [demo-rig.json](src/demo/data/demo-rig.json) and [idle.json](src/demo/data/idle.json).

```ts
import {
  parseRigDefinition,
  parseAnimationClip,
  validateRigDefinition,
  validateAnimationDefinition,
  Puppet,
} from 'paper-puppeteer-engine';

// Load the files with your app's own I/O (fetch, imports, or a file system).
const rig = parseRigDefinition(rigJson);
const idle = parseAnimationClip(idleJson, rig);
const puppet = new Puppet(scene, { rig, animations: [idle] });

// For editor-style diagnostics, inspect all reported issues without throwing.
const rigIssues = validateRigDefinition(rigJson);
const animationIssues = validateAnimationDefinition(idleJson, rig);
```

The parsers accept already-loaded JavaScript values and require no `fetch`. They return the existing `Rig` and `AnimationClip` runtime types. Invalid files throw `RigValidationError` or `AnimationValidationError`, each with an `issues` array of severity, path, and message. Unsupported versions throw `UnsupportedFormatVersionError`. Validation catches duplicate and missing bones, invalid parents and cycles, nonfinite transforms, negative lengths, invalid timeline times, unknown track bones, invalid FPS, and non-JSON values such as functions, `Map`, `Set`, and cyclic references. Existing unversioned TypeScript `RigDefinition` and `AnimationClip` inputs still work through their original constructors and registration APIs. The external format has no migration support yet.

## Slots, sprite attachments, and skins

Bones define the hierarchy and joint geometry. A named slot follows one bone and holds one sprite attachment at a time. Attachments define texture, optional atlas frame, local offset, rotation, scale, and normalized origin. A skin maps slot IDs to attachment IDs. All three are serializable parts of a rig definition; skin format version is `1`.

```ts
const rig: RigDefinition = {
  root: 'root',
  bones: [{ id: 'root' }, { id: 'hand', parent: 'root', y: 40 }],
  slots: [{ id: 'handVisual', bone: 'hand' }, { id: 'handItem', bone: 'hand', depth: 20 }],
  attachments: [
    { id: 'open', texture: 'hand-open', originY: 0.2 },
    { id: 'grip', texture: 'hand-grip', originY: 0.2 },
    { id: 'katana', texture: 'katana', x: 4, y: 2, rotation: -0.5 },
  ],
  skins: [
    { version: 1, name: 'default', slots: { handVisual: 'open' } },
    { version: 1, name: 'sword-hand', slots: { handVisual: 'grip', handItem: 'katana' } },
  ],
};
const puppet = new Puppet(scene, { rig, skin: 'default' });
puppet.setSkin('default');       // Replace the complete selection; omitted slots become empty.
puppet.applySkin('sword-hand');   // Override only listed slots.
puppet.setAttachment('handItem', 'katana');
puppet.clearAttachment('handItem');
puppet.getAttachment('handVisual'); // Attachment ID or undefined.
puppet.getSlotImage('handVisual');  // Current Phaser image or undefined.
puppet.setSlotDebug(true);
puppet.setSlotDepth('handVisual', 50); // Override draw depth at runtime.
puppet.clearSlotDepth('handVisual');   // Restore rig depth or automatic placement in the current order.
```

Use `null` in a skin mapping to clear one slot during `applySkin`. Slot `x`, `y`, `rotation`, `scaleX`, and `scaleY` transform the attachment relative to its parent bone. Slot `depth` sets global draw depth; without it, the slot follows its bone in `setRenderOrder`, just in front of the bone's legacy image. Slots attached to the same bone draw in definition order at equal depth. Changing a skin or attachment leaves bone objects, animation tracks, and IK references intact. The puppet's outer facing mirror applies to slots and attachments automatically. Legacy `bone.sprite` definitions and Phaser object `attach`/`detach` continue to work.

Validation reports duplicate slot and attachment IDs, missing parent bones, unknown skin slots or attachments, unsupported skin versions, and malformed transforms. `Puppet` checks texture keys and frame names against the Phaser scene when it is constructed. Texture atlases are optional; an attachment can name an ordinary texture.

## Define a rig

Definitions are plain serializable data. Bone IDs must be unique. There is exactly one root; every other bone needs a valid parent. Bones may appear in any order; cycles and invalid transforms are rejected.

```ts
import { Puppet, type RigDefinition } from 'paper-puppeteer-engine';

const rig: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'root' },
    {
      id: 'upperArm', parent: 'root', x: 0, y: -50,
      sprite: { texture: 'upper-arm', originX: 0.5, originY: 0.1 },
    },
    {
      id: 'forearm', parent: 'upperArm', x: 0, y: 60,
      sprite: { texture: 'forearm', originX: 0.5, originY: 0.15 },
    },
    { id: 'hand', parent: 'forearm', y: 45, sprite: { texture: 'hand', originY: 0.2 } },
  ],
};

// Load these texture keys through your Phaser scene before constructing the puppet.
const puppet = new Puppet(scene, { x: 400, y: 300, rig });
puppet.setDebug(true);
```

`x`, `y`, `rotation`, `scaleX`, and `scaleY` define a bone's **local bind pose** relative to its parent. Positions use pixels, rotations use **radians** (positive clockwise in Phaser's downward Y axis), and scales default to 1. Each container's `(0, 0)` is its joint/pivot. Rotating an upper arm therefore carries the elbow, forearm, and hand automatically.

`sprite.originX` / `originY` are normalized image origins in `[0, 1]`; put them at the shoulder/elbow/etc. within the texture, rather than assuming the center. `sprite.x` / `y` offset the image relative to the joint, and `sprite.scaleX` / `scaleY` scale only the image. Bone scale affects descendants too. `sprite.frame` selects an atlas/spritesheet frame. Transparent images are supported directly.

IK normally measures the current joint-to-child offsets, including effective chain scale. Optional `length` overrides the logical bind distance to each direct child. `Rig` normalizes the child's `x`/`y` to that length while keeping its direction; a child with no offset defaults to positive Y. For example, an upper arm with `length: 52` places its elbow 52 logical pixels from its shoulder, regardless of image height. Images keep their original dimensions. Position animation can subsequently change that distance, and IK measures the evaluated offsets. Lengths must be finite and nonnegative.

`depth` orders subtrees among siblings for the default drawing order; `sprite.depth` determines where the parent's image appears relative to its children. The engine derives a global back-to-front order from these defaults. To interleave unrelated branches, pass every bone ID exactly once to `puppet.setRenderOrder(ids)`. `puppet.getRenderOrder()` returns the current order; `puppet.resetRenderOrder()` restores the rig default. Bones without images still have a draw slot for attachments. The skeleton's parenting stays unchanged when the order changes.

Debug crosses and outlined circles mark joint pivots; orange dots mark sprite origins (which may differ if the image has an offset). Lines connect parents and children. Names remain upright when mirrored.

Use `puppet.setDebugLabelSide('boneId', 'left')` or `'right'` to choose the screen side of a pivot label. Omit the side to restore automatic placement. In the demo's idle pose, the near knee label faces outward: right lower leg to the left when facing right, and left lower leg to the right when facing left. The left foot label stays to the right in right-facing idle, and the right foot label stays to the left in left-facing idle.

## Define an animation

Animation clips are independent of rigs and can be passed at construction or registered later.

```ts
import type { AnimationClip } from 'paper-puppeteer-engine';

const wave: AnimationClip = {
  name: 'wave', duration: 1200, loop: true,
  interpolation: 'linear',
  tracks: {
    upperArm: [
      { time: 0, rotation: -0.4 },
      { time: 600, rotation: 0.4 },
      { time: 1200, rotation: -0.4 },
    ],
    forearm: [
      { time: 0, rotation: -0.2, scaleY: 1 },
      { time: 600, rotation: -0.8, scaleY: 1.02 },
      { time: 1200, rotation: -0.2, scaleY: 1 },
    ],
  },
};

puppet.addAnimation(wave).play('wave');
puppet.stop();    // Freeze the current pose.
puppet.restart(); // Restart the selected clip at time zero.
puppet.setFacing('left');
puppet.setFacing('right');
```

Key times and durations are **milliseconds**. Values are **absolute local transforms**, not deltas from the bind pose. All five transform properties support interpolation, independently across sparse keys. Rotations take the shortest angular path in radians. Each property's first/last value is held outside its key range; a single key holds a constant value. Key times must increase strictly and stay within the duration. Missing properties/bones use the bind pose on the base layer and the underlying pose on an overlay. Playing the same name restarts it unless `restart: false` is passed. Duplicate clip names and unknown bones/animations throw descriptive errors.

Looping wraps the clock at the duration; use matching start/end poses for a seamless cycle. Nonlooping clips stop at their exact final pose. Shortest-path rotation interpolation is intended for joint poses, not authored full-turn spins.

## Playback, events and layers

```ts
puppet.play('idle');
puppet.play('walk', { fadeDuration: 250, speed: 1.2 });
puppet.pauseAnimation();
puppet.resumeAnimation();
puppet.setAnimationSpeed(0.5); // Global multiplier; nonnegative.

puppet.setAnimationPlaybackMode({ mode: 'stepped', fps: 10 });
puppet.setAnimationPlaybackMode({ mode: 'smooth' });
// Equivalent shortcut for stepped playback:
puppet.setAnimationFPS(8);
```

A crossfade evaluates the outgoing and incoming clips at their own advancing times and blends x, y, rotation, scaleX and scaleY. An interrupted fade starts from its currently visible pose. The fade duration uses real elapsed milliseconds; animation speed changes timeline progression but does not change fade duration. The outgoing clip is sampled during a fade but only the incoming clip sends events or completion. The base layer begins at the rig's bind pose, so partial clips also fade cleanly. A weight of zero is the source pose, one is the target pose. Rotation blending uses the shortest path around ±π.

```ts
const walk: AnimationClip = {
  name: 'walk', duration: 1000, loop: true,
  events: [
    { time: 100, name: 'footstep', data: { foot: 'left' } },
    { time: 600, name: 'footstep', data: { foot: 'right' } },
  ],
  tracks: { /* bone keyframes */ },
};

const offEvent = puppet.onAnimationEvent(({ name, data, clip, layer }) => {
  if (name === 'footstep') console.log(clip, layer, data);
});
const offComplete = puppet.onAnimationComplete(({ clip, layer }) => {
  if (clip === 'drawSword' && layer === 'base') puppet.play('combatIdle');
});
// Call offEvent() and offComplete() to unsubscribe.
```

Events fire once per timestamp crossing, including wraps and large frame deltas. They use the continuous timeline, so they fire even when the visible pose is held in stepped mode. A marker at time zero fires when a clip starts and on each loop wrap. Nonlooping completion fires once after the final pose is applied; looping clips do not complete. Pause holds all clocks, events and fades. IK targets can still move and solve while animation is paused.

Stepped playback quantizes pose sample time to `floor(time / (1000 / fps)) * (1000 / fps)`. It also quantizes crossfade weights. At 10 FPS, one authored pose is held for 100 ms across normal Phaser render frames. Clip-specific `playback: { mode: 'stepped', fps: 12 }` or `{ mode: 'smooth' }` overrides the puppet default. The animation clock, event crossings and IK still update at normal frame rate. A nonlooping clip shows its exact final pose at completion.

For base-clip previews, `animationPlayer.sample(time, { mode: 'playback' })` uses the same pose timing rules, including clip playback overrides and the exact nonlooping final pose. `sample(time)` (or `{ mode: 'raw' }`) interpolates at the requested time regardless of playback settings. Both paths clamp time to `[0, duration]`, including for looping clips, and leave clocks, playback state, and events unchanged. They sample only the base clip, excluding crossfades, overlay layers, and IK. At 50 ms in a linear clip from x=0 to x=100 over 1000 ms, raw sampling gives x=5; playback sampling at 10 FPS gives x=0.

```ts
puppet.setLayerMask('upperBody', [
  'torso', 'head', 'leftUpperArm', 'leftForearm', 'leftHand',
  'rightUpperArm', 'rightForearm', 'rightHand',
]);
puppet.play('walk');
puppet.play('guardUpperBody', { layer: 'upperBody', fadeDuration: 250 });
puppet.setLayerWeight('upperBody', 0.7); // Range: 0–1.
puppet.clearLayer('upperBody');
```

Additional layers apply in insertion order after the base layer. A layer touches only tracked properties on masked bones; all other properties retain the pose below it. The base layer has a fixed weight of one. Each layer has its own clip, clock and optional transition. The update order is: restore the previous pre-IK pose, advance animation clocks, sample and blend the base clips, apply masked layers, run per-frame host pose adjustments, solve IK constraints in priority order, synchronize world transforms and rendering, then refresh debug overlays. In the demo, foot and hand IK therefore operate on the blended authored pose.

The puppet updates automatically with its scene. For manual scheduling or future constraints:

```ts
const puppet = new Puppet(scene, { rig, animations: [wave], autoUpdate: false });
puppet.play('wave');
// In Scene.update(time, delta):
puppet.update(delta);

puppet.stop();
puppet.setBoneRotation('forearm', 0.1);
const hand = puppet.getBone('hand');
hand.pose.x = 3;
puppet.syncPose();
const worldPosition = hand.getWorldPosition();
```

An active track overwrites manual changes to its property on the next update. With `autoUpdate: false`, advanced hosts call `puppet.preparePose()` to restore the previous pre-IK pose, then `puppet.animationPlayer.update(delta)`, modify joint poses, and call `puppet.syncPose()` to evaluate constraints. `animationPlayer.update(delta)` returns `true` when it evaluated a pose and `false` when playback was paused or no layer advanced; hosts can use this result to avoid evaluating again before presentation. `animationPlayer.applyCurrentPose()` reapplies the current stepped/blended/layered pose before external adjustments; `sample(time)` remains available to sample the base clip at an explicit smooth time without changing its clock. `puppet.resetPose()` stops playback and restores all bind transforms; enabled IK is then evaluated on that pose.

## Two-bone inverse kinematics

Forward animation specifies joint rotations to place a hand or foot. **Inverse kinematics (IK)** starts with a desired endpoint and calculates those rotations. A two-bone chain contains a root joint (shoulder/hip), middle joint (elbow/knee), and end joint (wrist/ankle).

The pure `solveTwoBoneIK` function uses the law of cosines to solve a triangle from two segment lengths and the root-to-target distance. It clamps that distance to the chain's inner and outer reach boundaries and clamps cosine arguments to `[-1, 1]`. Far targets fully extend the chain; close targets fully fold it. No images stretch. Zero-length segments and a target at the root have deterministic finite solutions. Invalid nonfinite input is rejected.

```ts
import { Puppet, type TwoBoneIKDefinition } from 'paper-puppeteer-engine';

const rightArmIK: TwoBoneIKDefinition = {
  name: 'rightArmIK',
  rootBone: 'rightUpperArm', middleBone: 'rightForearm', endBone: 'rightHand',
  bendDirection: -1, mix: 1, priority: 0,
};
const puppet = new Puppet(scene, { rig, ik: [rightArmIK], ikDebug: true });
puppet.setIKTarget('rightArmIK', { x: 500, y: 300 });
puppet.setIKTarget('rightArmIK', 500, 300); // Equivalent overload.

const arm = puppet.getIK('rightArmIK');
arm.setTarget(450, 320);
arm.target = { x: 460, y: 330 };
arm.mix = 0.5;
arm.enabled = false;

// Constraints can also be registered after construction.
puppet.addIK({
  name: 'leftLegIK', rootBone: 'leftThigh', middleBone: 'leftLowerLeg', endBone: 'leftFoot',
  bendDirection: 1,
});
```

The three IDs must form a direct parent-child chain. Names must be unique. Definitions default to `bendDirection: 1`, `mix: 1`, `enabled: true`, and `priority: 0`. A constraint stays inactive until a target is supplied. Assigning `target = undefined` clears it. Targets are copied; assign a new point or use `setTarget` to move them. Changes take effect on the next update or an explicit `syncPose()`.

An optional `endOffset: { x, y }` moves the solved endpoint from the end bone's joint to a local point on that bone. The solver includes the end bone's rotation and scale when measuring the second effective link. With the default `{ x: 0, y: 0 }`, it still targets the joint itself. Use an offset such as `{ x: 0, y: 20 }` to place a hand's palm on a target while its wrist remains behind it.

`bendDirection: 1` selects a positive turn from the first segment to the second; `-1` selects the opposite turn. In Phaser's downward Y axis, positive rotation is clockwise. The sign is defined in rig space and mirrors with facing, so a knee keeps its intended bend when the entire character turns around. The solver does not choose an elbow side based on the previous frame or randomly change branches.

`mix: 0` leaves the evaluated animation rotations alone; `mix: 1` applies the solved rotations; intermediate values blend each local angle along the shortest angular path. Mix must be finite and in `[0, 1]`. Angle blending does not interpolate the endpoint linearly and does not guarantee exact target contact below full influence. Authored full turns are preserved through the nearest equivalent solved angle.

### World coordinates and execution order

Targets use Phaser **world coordinates**, independent of camera screen coordinates. The Puppet adapter inverts the full world matrix of the chain root's parent, then solves in that parent's coordinates. This removes puppet translation, facing, scale, root bone transforms, and rotated/scaled enclosing containers, including affine shear from their combined transforms. Local child offset directions are accounted for; segments need not point along +X or +Y. Sprite origins never supply skeleton lengths. Use `pointer.worldX` / `pointer.worldY` for the default camera; with other cameras, use `camera.getWorldPoint(pointer.x, pointer.y)`.

The normal `puppet.update(delta)` pass is:

1. Restore the previous pre-IK rotations.
2. Advance animation and evaluate local poses.
3. Synchronize skeleton and attachment render mounts.
4. Execute constraints by ascending priority, retaining insertion order for ties. Each constraint resolves its target immediately before solving; the skeleton and render mounts are refreshed after it.
5. Record solved rotations, then update both debug overlays and render the final pose.

IK modifies the evaluated pose, never animation keys or bind poses. Restoring before each pass prevents partial influence from accumulating on stopped animation or untracked bones. Disabling IK restores the authored pose on the next pass. `syncPose()` also restores the previous pass before resolving constraints; explicit changed pose rotations are retained. For externally scheduled animation, call `preparePose()` before sampling so the evaluation starts from the authored pose:

```ts
puppet.preparePose();
puppet.animationPlayer.update(delta);
// Apply any custom procedural pose edits here.
puppet.syncPose();
```

Hosts making several corrective IK passes in a frame can call `puppet.syncPose({ updateDebug: false })`, then `puppet.refreshDebugViews()` after the final pass. Bone and attachment transforms remain synchronized for dependent target providers during every pass; overlays read the final pose without running another solve.

Constraint `status` reports `inactive`, `solved`, `clamped`, `singular-transform`, or `unsupported-scale`. `resolvedTarget`, `lengthA`, and `lengthB` expose the last solve's diagnostics. `puppet.setIKDebug(true)` controls the separate IK overlay; `setDebug(true)` still controls the existing bone overlay. Displayed lengths are in the chain parent's solve coordinates.

### Foot planting

`F` enables foot planting only while walking, when the puppet's body sways horizontally and vertically. Idle and sword stance keep their authored leg poses, leave leg IK disabled, and recenter the puppet. During walking, each ankle target follows the authored horizontal stride. IK limits how low the ankle can sink during contact, then fades out before toe-off so the authored heel rise and return swing remain visible. The legs alternate by half a cycle and mirror with facing. This is an in-place stepping demonstration without terrain detection or ground raycasts. Foot orientation remains authored; this version constrains endpoint position only.

```ts
puppet.setIKTarget('leftLegIK', { x: 360, y: 510 });
puppet.getIK('leftLegIK').enabled = true;
// Moving the puppet container now makes the leg solve toward the fixed point.
```

### Two-handed katana

`src/demo/Katana.ts` defines a weapon container with primary and secondary grip points in its own coordinates. Hand joints are at the wrists; the demo places each grip 15 local pixels down the corresponding hand, at the palm center. Facing changes remount the weapon on the front hand: the right hand holds the primary grip when facing right, and the left hand holds the secondary grip when facing left. The mount compensates for blade rotation so its grip stays on that palm. One-handed mouse targeting (`H`) moves the front arm and its attached katana.

In stance `3`, the front arm runs at priority 0 and follows the mouse target. Its solved hand transform carries the katana. The rear arm runs at priority 1 with an `endOffset` at the **palm**. A target provider reads its grip in world space after the demo aims the blade with `Q` / `E`. Rotating the katana therefore moves the rear grip, and that arm solves toward it in the same frame. Priorities switch when facing changes, so the left arm can fully extend when pointing left.

The demo uses bend direction `-1` for both elbows in the two-handed stance. Both hands follow their grip points without moving the shoulders.

In the two-handed stance, the blade can turn through a horizontal overhead pose. In either facing direction, the rear palm stays outside the head, torso, and pelvis cutouts. It travels around the head's top corners in bounded steps, so moving the mouse or rotating the sword cannot make the hands snap across the face. The demo checks the cutout edges at the palm's height and adjusts the front arm's hand target when either input would carry the rear palm behind the body. Both shoulders stay fixed and both palms stay on the hilt.

```ts
// Assume katana is attached at its primary grip and both arm chains are registered.
puppet.getIK('leftArmIK').setTargetProvider(() => {
  const point = katana.container.getWorldTransformMatrix()
    .transformPoint(katanaGrips.secondary.x, katanaGrips.secondary.y);
  return { x: point.x, y: point.y };
});
```

Use lower priority for the primary arm and higher priority for the secondary arm. Providers may return `undefined` to skip a pass. `setTarget` or assigning `target` replaces a provider; `setTargetProvider(undefined)` restores use of the stored fixed target. Register dependent constraints in one direction; dependency graphs and cycle detection are outside this iteration. If either grip is beyond an arm's reach, that arm clamps and the debug residual line shows the gap.

## Attach an object

Any Phaser GameObject from the same scene can be mounted under a bone. A mount container supplies offset/rotation without overwriting the object's transform.

```ts
const prop = scene.add.image(0, 0, 'flag').setOrigin(0.1, 0.8);
puppet.attach('hand', prop, { x: 4, y: 8, rotation: 0.1, depth: 1 });
puppet.detach(prop);
```

Attached props inherit all ancestor transforms and facing, and draw in their bone's global slot. Attachment `depth` sorts relative to that bone's image and other props. `detach` returns `true` when it releases a registered prop back to the scene display list; the object survives with its original local transform. It does **not** preserve world coordinates automatically. Reattaching moves the object to the new mount. Attached objects are destroyed with the puppet; detach anything you want to keep before `puppet.destroy()`. The puppet removes its update hooks and debug objects on scene shutdown or destruction.

## Use as a local package

Build this repository first, then in another Phaser TypeScript project:

```bash
npm install /absolute/path/to/paper-puppeteer-engine
```

```ts
import { Puppet, type RigDefinition, type AnimationClip } from 'paper-puppeteer-engine';
```

The library includes TypeScript declarations and source maps. Phaser is externalized and declared as an exact peer dependency so the consumer provides the same Phaser runtime. No package has been published. Engine rendering APIs are browser-based and should be imported in a browser environment.

For Node scripts and asset tooling, import the renderer-independent entry point:

```ts
import { CharacterLoader, validateRigDefinition, Joint, AnimationPlayer, solveTwoBoneIK } from 'paper-puppeteer-engine/core';

const character = await CharacterLoader.load('https://example.com/characters/hero/character.json');
const joints = new Map(character.rig.bones.map(bone => [bone.id, new Joint(bone.id, bone)]));
const player = new AnimationPlayer(character.rig, joints);
```

`/core` exports character loading and validation, rig/slot data, pose and animation APIs, and IK without loading Phaser or requiring browser globals. `CharacterLoader.load` accepts an optional fetch implementation for file system or custom I/O. Every library build checks the built `/core` package in plain Node.

## Current limitations

- Rigid pieces only: no mesh deformation, weighted skinning, physics, ragdolls, or cloth.
- One clip per layer with simple masked overlays; no animation graph, blend tree, editor or automatic state machine.
- Only direct two-link chains and endpoint positions: no joint limits, end-effector rotation constraints, arbitrary-length chains, or terrain-aware locomotion. Foot planting is manual; the walk remains in place.
- The rotating chain root must have uniform scale magnitudes (`abs(scaleX) === abs(scaleY)`); its signs may differ. Nonuniform scale inside that joint is skipped with `unsupported-scale`. Arbitrary nonsingular ancestor transforms and middle-joint scale are supported. Zero/singular transforms skip solving safely.
- Two-handed gripping adjusts the primary arm target when the second grip leaves the opposite arm's reach. The katana is a demo prop, not a combat system.
- Debug name labels can overlap on dense rigs. Independent draw slots duplicate ancestor containers, so very large rigs require profiling.
- The rig editor loads the sample character and edits an in-memory working copy. It exports JSON for manual placement in the character folder; it does not write to the project automatically or edit animation timelines. Character JSON loading uses `fetch`; apps with another asset pipeline can use `CharacterDefinition.fromData`.

## Planned features

- Joint angle limits and optional end-effector rotation alignment.
- More advanced animation state orchestration and editor tooling.
- Visual rig and animation editors.
- Character editing tools and richer asset pipeline integration.

The next useful milestone is joint limits and palm/foot orientation constraints, plus attachment or facial sprite swapping driven by the new event API.
