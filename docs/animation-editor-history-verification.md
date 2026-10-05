# v0.5.2.3.3 — Keyframe authoring history and regression verification

## Implemented

Stabilized the existing bone inspector and authored key/settings history for the final v0.5.2.3 milestone. The Animation Editor already used the Rig Editor's shared `SnapshotHistory`; this implementation retains it and each editor's independent session ownership. Added Rig Editor-compatible keyboard Undo/Redo, hardened draft cancellation at unchanged/clamped times and empty history stacks, refreshed cancelled focused inspector values, prevented uncommitted FPS text from surviving snapshot changes, and centralized degrees/radians conversion. Expanded state, runtime and browser regression coverage. Package version is `0.5.2-3.3`.

## Authoring workflow

Select a bone and move the playhead. Type a local transform value to preview a temporary pose; typing pauses playback and creates no history entry. Press the property's **Set Key** to create or update its sparse key. Multiple input events preceding that click still produce one operation. Set Key without typing retains the evaluated value's full precision. **Delete Key** removes only that property's key at the playhead; deleting its final key returns to the existing bind/rest fallback. Other property drafts remain until explicitly committed or cancelled.

Undo/Redo buttons and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z restore authored data and immediately refresh preview and keyed indicators. Typing controls retain native undo. Cancel/Escape, time navigation, scrub start, bone/animation navigation, Play, authored settings changes and history restoration cancel drafts. Time navigation cancels even if its clamped result is unchanged; Undo/Redo cancel even if there is no history operation to restore. Dirty animation selection is blocked, preserving the working data and history. The state API's existing explicit discard option starts a clean session; no new modal or export workflow is added.

## Data architecture

The frozen source snapshot and separately cloned working animation are owned independently of caller data. The saved checkpoint retains an immutable working snapshot. Authored mutations validate before installation and share unchanged immutable branches. History holds exact authored snapshots, including sparse rows, playback settings, interpolation metadata and event payloads. Dirty state compares working data against the saved checkpoint and caches the result until authored data changes. Returning to the exact loaded/saved data is clean, even via an authored deletion or Undo. Switching animation clears both undo and redo stacks.

Selection, the continuous seconds clock, playback intent, speed, preview looping, facing/IK preferences and property drafts remain outside animation data and history. Evaluation uses the existing runtime compilation/pose sampling and stepped quantization. Temporary values overlay the evaluated local pose before rendering and IK. No second evaluator or undo framework was introduced.

## Transform-space handling

Authored time remains milliseconds and rotation remains radians. `transformValues.ts` handles degree display/input without normalization or unintended rounding of stored values. Multiple-turn values remain authored as entered; the runtime's shortest-path interpolation is unchanged. Authoring at zero and duration uses the clamped editor time. The existing shared nanosecond tolerance updates near-equal keys without inserting duplicate rows.

Parent and child keys remain independent absolute local transforms. Neither parent/world transforms nor rendered/IK-corrected joint values are read for authoring. Facing mirrors the outer container; changing facing and switching back leaves keys unchanged. Undo/Redo under active IK restores authored snapshots while IK stays a separate runtime preview pass. The rig bind pose and caller-owned clip stay unchanged.

## History architecture

The shared bounded `SnapshotHistory` retains up to 100 authored changes per editor session. Set Key, Delete Key, Mode changes and committed FPS changes each use one `history.change()` boundary. Bone inputs only change temporary state; FPS commits on `change`, rather than intermediate `input` events. There are no transform drag authoring controls in this milestone, so no additional gesture transaction API is needed. The existing Rig Editor gesture implementation is untouched.

Undo/Redo restore exact snapshots instead of reconstructing keys from evaluated poses. A new authored mutation after Undo clears redo; temporary, invalid and no-op mutations preserve it. All playback/navigation/preview preferences stay outside this history. Undo/Redo cancellation may notify subscribers without restoring a snapshot; the return value still reports whether an authored history entry was restored.

## Files changed

- `src/devtools/animation-editor/AnimationEditorState.ts`: unchanged/clamped navigation, scrub-start and empty-history draft cancellation.
- `src/devtools/animation-editor/BoneInspectorController.ts`: refresh cancelled focused fields and use shared conversion helpers.
- `src/devtools/animation-editor/transformValues.ts`: centralized rotation display/storage conversions.
- `src/devtools/animation-editor/TimelineController.ts`: guarded history shortcuts and FPS text cancellation when snapshots change.
- `src/devtools/animation-editor/main.ts`: keyboard shortcut titles/accessibility metadata.
- `tests/animationEditorHistory.test.ts`: exact history, checkpoints, redo branches, cancellation, switching, endpoints, validation and unit conversion.
- `tests/animationEditorPreview.test.ts`: authored Undo/Redo under IK and facing changes.
- `tests/browser/animationBoneAuthoring.spec.ts`: three-key workflow, browser input transactions, hierarchy, playback, shortcuts and navigation safety.
- `README.md`, `docs/animation-editor.md`, this report: workflow and verification documentation.
- `package.json`, `package-lock.json`: milestone version only.

The user-supplied plan is preserved.

## APIs changed

No production engine, schema, package export or dependency changes. Existing state and authoring method signatures are unchanged. `undo()` and `redo()` still return whether authored data was restored; they now cancel pending transforms even when returning false. Explicit `setCurrentTime()` and `beginScrub()` now cancel drafts at a held time. Added internal editor conversion helpers `toDisplayTransformValue(property, value)` and `toLocalTransformValue(property, value)`.

## Tests

New unit coverage verifies Undo/Redo of create/update/delete with exact snapshot identity, source/caller/rig immutability, dirty saved checkpoints, redo invalidation and no-op preservation, many temporary inputs per commit, held-time and empty-history cancellation with immediate notification, blocked dirty switching, explicit discard and history isolation, zero/duration/near-equal times, sparse nested local transforms, degree/radian conversion and finite/time validation. Runtime coverage exercises active IK across Undo/Redo and facing changes. Existing tests cover smooth/stepped playback and FPS, bind fallback, rotation shortest paths, playback/restart/loop/speed, Rig Editor history/manipulation/export, runtime blending/layers/events, IK, slots/attachments/skins, character loading and JSON validation.

Architecture review found no authored reads from world or final IK poses, no new unsafe casts or TypeScript `any`, no hidden global authored state, no new dependencies and no duplicate mutation/evaluation/history implementation. Existing DOM element casts and numeric HTML `step="any"` do not alter authored data ownership.

## Manual verification

The browser scenario enters -20° at 0 s, 35° at 0.5 s and -10° at 1 s on `rightForearm`. It scrubs, plays, loops at 2× speed, restarts, switches smooth/stepped sampling, undoes/redoes the latest key, changes and restores the middle key, deletes and restores it, and authors `rightUpperArm` while checking that the child remains independently local. It also checks facing/IK preferences and validation status. Further scenarios cover dirty selection, clean new sessions, native typing/history shortcut guards, drafts at a held endpoint and empty-history cancellation.

All 80 selected browser checks passed in development and production, including the three-key scenario and Rig Editor regressions. The development scenario's full-page screenshot was visually inspected: the rotated parent/child preview, selected joint, 45° keyed child inspector, 0.5 s playhead and preview preferences were consistent. These were automated Chrome interactions and screenshot inspection; no human interactive session is claimed.

## Command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0 — 58 files passed, 2 skipped; 888 tests passed, 26 skipped.
- `npm run build`: passed, exit 0 — demo bundle, library bundle, TypeScript declarations and renderer-independent core smoke check.
- `npm run check:version`: passed, exit 0 — `0.5.2-3.3` is valid SemVer.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationBoneAuthoring.spec.ts tests/browser/animationEditor.spec.ts tests/browser/rigEditor.spec.ts --max-failures=3`: passed, exit 0 — 80 tests passed in 6.0 minutes across development and production. The initial sandbox attempt could not bind port 4173 (`EPERM`); the permitted retry used local servers and installed Chrome outside the sandbox. No packages were installed.
- Biome check on all changed TypeScript/test/package files: passed, no fixes required after formatting.
- `git diff --check`: passed.

## Deferred to v0.5.2.4+

Expanded bone/property/event tracks; visual keyframe diamonds; dragging keys along the timeline; multi-key selection; box/range selection; copy/paste; duplicate-key commands; mirrored-key copying; auto-key; transform drag handles; per-key interpolation editing; visual event editing; onion skinning; ghost poses; animated IK targets; IK baking; and production animation JSON export/import/save workflows remain deferred. No timeline track/keyframe UI or unrelated large refactor was added.
