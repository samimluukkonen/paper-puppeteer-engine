# v0.5.2.3.2 — Visual bone keyframing verification

## Implemented

The Animation Editor now selects bones from the shared hierarchy traversal and clickable runtime joint visualization. A selected-joint ring identifies the bone. The inspector displays evaluated X/Y, rotation, and scale at the continuous playhead, with explicit property keys and keyed indicators. It supports editor-only prospective values, create/update/delete through the existing keyframe APIs, cancellation, dirty/history integration, and immediate pose refresh. Desktop layout places the inspector beside the preview; narrow layouts stack the controls. Package version is `0.5.2-3.2`.

## Visual authoring workflow

1. Open `/animation-editor/`, select an animation, and scrub to a time.
2. Select a bone in the hierarchy or click its joint marker.
3. Enter a property value. The field is highlighted and previews the prospective pose. Field focus pauses playback at the held time; entering a draft does not dirty animation data.
4. Press that property's **Set Key**. It creates a sparse key or updates the existing property key at the playhead. No unrelated property is implicitly keyed. Set Key without typing commits the evaluated value at full precision.
5. Press **Delete Key** on a keyed row to remove only that property's current key. The evaluator immediately restores interpolation or bind fallback.

Other property drafts survive an individual commit/delete. **Cancel edits** or **Escape** restores all evaluated values. Time, bone/animation navigation, Play, authored settings changes, and undo/redo discard pending drafts. Playback does not automatically resume after editing. Preview preferences stay outside authored data/history. No-op mutations do not add history or dirty state.

## Transform space

Keys store absolute bone-local animation transforms in the existing sparse `tracks[boneId]` representation. Time is milliseconds; rotation is radians; scales are unitless. The UI accepts rotation in degrees and converts it to radians. The inspector uses the existing runtime sampler and playback quantization rather than implementing interpolation. Bind values supply wholly unkeyed properties. Six-decimal numeric display formatting does not round keys when keying an evaluated value without typing. Parent transforms, screen/world coordinates, and mirrored transforms are never used as key values.

Stepped clips retain continuous authored key times and existing playback sampling. A temporary draft previews directly; after committing, the evaluator samples the authored clip according to its playback mode, including its stepped frame boundaries.

## IK/facing safety

The inspector and commits read evaluated authored values plus editor drafts, independently of the rendered joints. Drafts apply after animation sampling and before optional presets/IK/rendering. Cancellation resets even draft properties that were not tracked by the player. Facing mirrors the outer container. Optional configured demo IK chains pin the current end joints in canonical puppet coordinates, with world targets projected through facing. IK output is never saved as a key. Rig bind definitions, source snapshots, and caller-owned animation data remain unchanged.

## Files changed

- `src/devtools/animation-editor/AnimationEditorState.ts`: bone selection, immutable sparse drafts, authoring commands, draft cancellation boundaries.
- `src/devtools/animation-editor/BoneInspectorController.ts`: stable numeric controls, property actions, indicators, hierarchy selection, degree conversion.
- `src/devtools/animation-editor/AnimationEditorPreview.ts`: prospective pose application and restoration of untracked temporary properties.
- `src/devtools/animation-editor/AnimationEditorScene.ts`: joint picking/highlight, optional fixed-target IK, facing and visibility controls, lifecycle cleanup.
- `src/devtools/animation-editor/main.ts` and `style.css`: inspector, preview preferences, responsive layout, controller binding/disposal.
- `src/devtools/shared/boneHierarchy.ts` and `src/devtools/rig-editor/RigEditorState.ts`: shared hierarchy traversal.
- `tests/animationEditorAuthoring.test.ts`, `tests/animationEditorPreview.test.ts`, `tests/browser/animationBoneAuthoring.spec.ts`, and `tests/browser/animationEditor.spec.ts`: authoring/state/runtime/browser coverage and stable viewport positioning for the existing settings screenshot check.
- `README.md`, `docs/animation-editor.md`, and this report: workflow, API, safety and verification documentation.
- `package.json` and `package-lock.json`: milestone version.

The existing user plan files were preserved.

## APIs changed

Added editor state views: `selectedBoneId`, `boneTransformDraft`, `hasTemporaryTransform`, `selectedBoneTransform`.

Added editor state commands: `selectBone`, `beginTransformEdit`, `setTemporaryBoneProperty`, `commitBoneProperty`, `deleteBonePropertyKey`, `cancelTransformEdit`.

Added `BoneInspectorController` and shared `boneHierarchy(rig)`; the Rig Editor delegates its existing `hierarchy()` to that traversal. Added scene preview commands `setFacing`, `setBonesVisible`, `setIKPreview`, and optional `ikChains` configuration.

Existing v0.5.2.3.1 pure mutation/query APIs and signatures are unchanged. Production engine APIs, package exports, external schemas, and dependencies are unchanged.

## Tests

State/controller tests cover selection without mutation, correct sparse property creation/update/deletion, unrelated property retention, drafts remaining clean until commit, dirty/history behavior, navigation cancellation, no-op edits, finite-value validation, source immutability, and absolute local values for nested bones.

Runtime preview tests cover immediate draft/key refresh, restoration of untracked properties on cancel/selection/navigation/Play, pre-IK authoring for both facings, rig bind/source isolation, local translation projection, and existing smooth/stepped playback, events, presets and constraints.

Browser scenarios use `demo-puppet` and cover torso/upper arm/forearm/hand hierarchy selection, joint-marker picking, a 35° forearm key at 0.5 s, scrub away/back, updates, X/Y keys, sparse key indicators, property deletion, several-key playback, pause-on-focus, cancel/Escape, blank-field rejection, and authoring under IK/mirroring. Existing browser regressions cover timeline/navigation/playback and deployed base paths.

## Manual verification

Verification used actual Chrome browser workflows against the existing `demo-puppet` character, driven by Playwright. Desktop and mobile screenshots were visually inspected for the puppet, selected-joint highlight, hierarchy, numeric inspector, keyed indicators and responsive layout. These were automated interactions plus screenshot review; no separate human interactive session is claimed.

## Required command results

- `npm run typecheck`: passed.
- `npm run test`: passed — 57 files passed, 2 skipped; 871 tests passed, 26 skipped.
- `npm run build`: passed — demo bundle, library bundle/declarations, and renderer-independent core smoke check.
- `npm run check:version`: passed — `0.5.2-3.2` is valid SemVer.
- Biome check on changed TypeScript/CSS/test files and `git diff HEAD --check`: passed.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationBoneAuthoring.spec.ts tests/browser/animationEditor.spec.ts --max-failures=3`: 48 passed; the existing settings screenshot comparison failed in both projects because scrolling to the relocated settings changed the canvas viewport position.
- The settings test now captures the canvas at a consistent viewport position. `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEditor.spec.ts -g 'authored mode and FPS' --max-failures=1`: both development and production rechecks passed.
- All 50 selected Animation Editor browser scenarios are therefore verified across the regression run and the focused rechecks. Local server/browser checks used installed Chrome outside the sandbox; no packages were installed.

## Deferred to v0.5.2.3.3+

Full bone/property/event tracks, draggable key diamonds, key/range/multi-key selection, copy/paste, transform drag handles, auto-key, mirrored-key operations, per-key interpolation/event editors, onion skinning, ghost poses, IK targets/baking, and production animation export/save/import UI remain deferred. No bone-level all-property convenience key is included; property-level keying remains authoritative.
