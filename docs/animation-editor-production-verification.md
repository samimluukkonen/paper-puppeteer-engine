# Production animation workflow hardening — v0.5.2.8.3

The Visual Animation Timeline milestone provides loading, timeline navigation, playback, local transform keys, multi-key editing, interpolation inspection, event authoring, history and validated canonical import/export. This pass hardens the existing production workflow without changing animation format version 1 or adding a new authoring model. Package SemVer: `0.5.2-8.3`.

## Implemented and production workflow

Rig Editor now reserves its initially empty status line so loading cannot shift the canvas after Phaser caches its input bounds. The regression run exposed an intermittent first artwork drag offset on both shipped characters; the fix preserves the existing drag behavior.

The session names the current animation and displays Clean/Modified from the existing document dirty state. Dirty animation switching, paste/file imports, round-trip reload and source revert require confirmation. Imports validate first; rejection/cancellation preserves the session. Navigation and character switching retain the shared browser unsaved-change guard and draft recovery.

Use the [artist workflow](animation-editor.md#production-animation-workflow): load character/animation → scrub → select bone/property → commit keys → adjust timing/interpolation → author events → preview → check validation → export → optionally reload/import → place the JSON at the character manifest path. Rig Editor owns bind skeleton/joint/artwork alignment; Animation Editor owns motion over time. Export checkpoints do not write project assets.

## Session lifecycle

| Action                       | Source                           | Working copy / saved checkpoint                                       | History and preview                                                         |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Load/select                  | Immutable loaded/imported source | Last saved snapshot for that clip; Clean                              | Fresh history, paused at zero                                               |
| Edit                         | Unchanged                        | New authored snapshot; Modified if unequal to checkpoint              | One authored transaction                                                    |
| Undo/Redo                    | Unchanged                        | Dirty compares restored data to checkpoint                            | Current session only                                                        |
| Successful copy/download/log | Unchanged                        | Exported snapshot becomes Clean checkpoint; later edits stay Modified | History retained                                                            |
| Failed export                | Unchanged                        | Checkpoint unchanged                                                  | Session retained                                                            |
| Discard changes              | Unchanged                        | Last saved checkpoint                                                 | History reset, paused at zero                                               |
| Revert Animation             | Unchanged; no fetch              | Immutable source becomes Clean checkpoint                             | History, selection, drafts and gestures reset; paused at zero               |
| Import/reload                | New immutable imported source    | Independent imported working snapshot; Clean                          | Fresh history, cleared selection/drafts/gestures, paused at zero; no events |

Revert restores the loaded/imported source even after a successful export. It is available on clean sessions because the source and export checkpoint can differ. Import changes the source used by later reverts. Other saved animation checkpoints remain available within the loaded character session.

Session revisions prevent stale file reads and clipboard completions from changing a newer session, including direct API reverts and switching away/back to the same clip. Edits during file reading require rechoosing the file. Delayed clipboard success saves only its captured authored snapshot; a later successful export supersedes it.

## Serialization/import architecture and audit

- **Schema/validator:** shared `animationFileSchema` and `inspectAnimationDefinition`, also used by CharacterLoader. Positive duration remains required; zero duration rejects safely.
- **Serializer:** existing `serializeAnimation` remains the sole export implementation, validating both original and projected output.
- **Import pipeline:** `importAnimationJson` handles paste, file and reload JSON; document installation occurs only after validation and optional dirty confirmation. Empty JSON has a direct diagnostic.
- **Evaluator:** existing `compileClip`, `evaluateClip` and `quantizePlaybackTime`; preview still uses AnimationPlayer/Puppet. Comparison code does not interpolate transforms itself.
- **Ownership:** immutable source, owned authored snapshots, current-session SnapshotHistory, transient selection/clock/drafts/preferences. No DOM-owned authored data, serialized editor state, Phaser data in JSON, new dependency or `any` annotations.
- **Supported data:** all supported optional fields survive, including explicit linear metadata, smooth/stepped settings, partial/empty tracks, events and arbitrary valid JSON payloads. The existing strict file parser rejects unknown fields rather than discarding them.
- **Filenames:** manifest basenames and name fallbacks sanitize path/control/reserved characters, trailing dots/spaces and Windows device names. Clip IDs and manifest data remain unchanged. Valid Rig Editor basenames retain existing behavior through the shared utility.

## Round-trip guarantees

`verifyAnimationRoundTrip(input, rig)` verifies canonical export → import → export stability, then compares original and reloaded evaluated poses. It reports raw `posesEquivalent`, FPS-aware `playbackEquivalent`, `sampleTimes` in milliseconds, combined `equivalent`, both JSON strings and the imported snapshot. `compareEvaluatedAnimationPoses(original, reloaded, rig)` exposes the same dev/test comparison independently.

Samples include zero, every distinct key time, interval midpoints, near duration, duration, and representative stepped frame boundaries/holds. Property comparisons use a combined absolute/relative tolerance of `1e-10 * max(1, abs(a), abs(b))`. This is representative runtime confidence, not an exhaustive proof for every possible floating-point time or a pixel comparison helper. The separate local browser scenario compares rendered canvas pixels for smooth/stepped clips at key/intermediate/endpoint times with facing and fixed-target IK enabled.

Event tests compare real runtime start/crossing functions and editor dispatch, covering zero, duration, multiple same-time events, ordering, multiplicity, nested payloads, loops and multiple-cycle deltas. Import does not dispatch. Twenty serialize/parse cycles stabilize immediately, retaining small values, precision and nearby distinct key times. Existing canonical normalization remains unchanged.

Edge fixtures cover empty and single-key clips, safely rejected zero duration, empty/malformed/wrong-type/unsupported/unknown-field documents, and a larger sample with 32 tracks, 4,096 keys and 256 events. Timeline rows and event markers build successfully; no virtualization or performance threshold is introduced.

## Runtime/CharacterLoader verification

`animationProductionRoundTrip.test.ts` writes the actual editor export to `animations/walk.json` inside a temporary on-disk character folder with ordinary manifest, rig and skin files. CharacterLoader reads those files through its supported file-I/O fetch adapter. `new Puppet(scene, { definition })` plays `walk` without any editor conversion. Playback samples agree with editor evaluated transforms across representative times, and time-zero event delivery uses the normal runtime. The fixture uses the repository's affine scene adapter; local browser regressions separately cover real Phaser/artwork rendering.

## Files and APIs changed

| Files                                                                                               | Purpose                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `AnimationEditorDocument.ts`, `AnimationEditorState.ts`                                             | Source revert, shared session reset, optional validated replacement confirmation, session revisions                |
| `TimelineSessionController.ts`, `editorMarkup.ts`                                                   | Status, switch/import/reload/revert confirmation, source revert button, asynchronous session protection and help   |
| `animationImport.ts`                                                                                | Empty input diagnostic and evaluator-based round-trip comparison                                                   |
| `rig-editor/style.css`                                                                              | Reserve initial status-line height to prevent cached canvas-bound offsets                                          |
| `engine/assetFilename.ts`                                                                           | Safe manifest/fallback export filenames shared with Rig Editor                                                     |
| `animationEditorProductionSession.test.ts`, `animationProductionRoundTrip.test.ts`                  | Lifecycle/history, evaluated poses, event dispatch, floats, edge/large clips and CharacterLoader/Puppet regression |
| `animationEditorImportController.test.ts`, `animationEditorExport.test.ts`, `assetFilename.test.ts` | UI confirmation integration, stale actions and filename regression                                                 |
| `browser/animationProductionWorkflow.spec.ts`, `browser/animationImport.spec.ts`                    | Local confirmation/revert and visual round-trip scenarios; update import scenarios for confirmation                |
| `README.md`, `animation-editor.md`, `development.md`, this report                                   | Artist workflow, session/save policy, strict data handling and verification                                        |
| `package.json`, `package-lock.json`                                                                 | Milestone version `0.5.2-8.3`                                                                                      |

Editor-only additions: `AnimationImportOptions.confirmDiscard`, `state/document.revertAnimation({ discardChanges?: boolean })`, `state.sessionRevision`, `compareEvaluatedAnimationPoses`, and round-trip result pose flags/sample times. Direct import API callers without a callback retain existing replacement semantics. No engine public API/type, external schema or dependency changes.

## Tests and required commands

All required commands passed with exit code 0:

| Command             | Result                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run typecheck` | PASS — `tsc --noEmit`                                                                                  |
| `npm run test`      | PASS — 88 files passed, 3 skipped; 1,410 tests passed, 28 skipped; 12.88 s                             |
| `npm run build`     | PASS — typecheck, Vite demo, Vite library, TypeScript declarations and built `/core` Node verification |

`npm run lint`, `npm run format:check`, `npm run check:version` and `git diff --check` also passed. Skipped Vitest cases are the repository's opt-in performance profiles. Browser smoke tests remain local-only; no CI browser steps were added.

Local Chrome browser results:

- `PLAYWRIGHT_CHANNEL=chrome npx playwright test`: 242 passed, 4 Rig Editor artwork-drag failures (20.8 minutes). Every animation, demo, recovery and navigation case passed in development and production, including the new confirmations/source revert and eight-time smooth/stepped rendered pose comparisons with facing and fixed-target IK.
- The failure traces exposed an initially empty dirty-status line moving the Rig Editor canvas after Phaser cached its bounds. Reserving the line height fixes that layout shift. The initially failing sketch case then passed three focused development repeats.
- After rebuilding, `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/rigEditor.spec.ts`: **40 passed, exit code 0, 3.0 minutes**, covering both characters in development and production. All four initially failing cases passed. The entire Rig Editor file was rerun because its CSS changed; the 206 other browser scenarios had already passed and their code/assets were unchanged by this fix.

All 246 distinct browser scenarios have passing verification across the full run and the focused rerun. No remaining observed failures. These checks used installed Chrome and local servers; browser tests and installations remain absent from CI.

## Manual verification procedure

The automated local browser suite covers the main UI workflows. For a human artist pass:

1. Load `walk`; scrub and select a bone/property, set/edit/delete keys, marquee/range-select and move a group, snap/nudge/copy/paste/duplicate, inspect outgoing/terminal interpolation, edit clip mode/FPS, and add/edit/move/copy/delete events. Preview with loop, speed, facing and fixed-target IK; test typing/IME and native clipboard in JSON fields.
2. Undo back to Clean, Redo to Modified, export to a checkpoint, edit again, cancel and accept switch/import/reload/revert confirmations. Confirm old history never enters a new session and source revert differs from checkpoint discard after export.
3. Download a clip, capture key/intermediate/end poses, import the download or use Reload Current Export, and compare poses, FPS holds, duration and event markers/payloads. Repeat export/import and compare JSON.
4. Place the file at the manifest animation path and reload the demo/runtime; play its clip name. Repeat Rig Editor load, bone selection, joint/sprite offset/origin/slot edits, Undo/Redo and export.

Human visual judgment across every character/key combination remains a manual check; automated samples and regression suites provide the recorded verification evidence.

## Deferred to v0.5.3+

Onion skinning, ghost poses, mirrored pose/key operations, IK target animation authoring, IK baking, advanced timeline QoL, sprite upload/replacement, Animation Editor rig-tweak mode, scene choreography, physics/ragdolls and mesh deformation. Per-key/mixed interpolation requires a schema/runtime extension; advanced curves/tangents, auto-key, remapping and event multi-selection remain later work too.
