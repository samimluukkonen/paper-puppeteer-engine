# v0.5.2.5.2 — Copy, Paste & Duplicate Keyframes

Verification date: October 7, 2026. Package version: `0.5.2-5.2`.

## Implemented

Selected authored keys can be copied, pasted relative to the playhead, and duplicated across bones/properties. Timeline buttons and Ctrl/Cmd+C/V/D expose the commands. The existing selection architecture, evaluator, immutable document snapshots and bounded history remain in use. No dependencies, runtime exports or authored schema fields were added.

## Clipboard architecture

`AnimationEditorKeyframeCommands` owns a private session clipboard, exposed read-only through `AnimationEditorState.keyframeClipboard`. `keyframeClipboard.ts` defines deeply frozen `KeyframeClipboard` / `KeyframeClipboardEntry` data and pure copy/paste helpers. Entries contain only `boneId`, `TransformProperty`, `relativeTimeMs` and numeric authored `value`; `anchorTimeMs` records the earliest original authored time. No DOM, Phaser, evaluator, visual pose, IK, facing, event or system clipboard objects enter it.

The clipboard persists through animation selection, scrubbing, playback, selection clearing and history restoration. Empty copy retains the previous contents. A new editor state (including a character change or reload) starts empty. Duplicate uses a temporary group and leaves the user's clipboard unchanged. Interpolation is clip-level, with only `linear` currently supported; destination clip metadata stays intact and there is no per-key interpolation metadata to transfer.

## Anchor/relative-time behavior

Copy resolves selected references to canonical authored millisecond samples, sorts them stably by time, and subtracts the earliest time. Copying 0.5/0.8/1.2-second keys produces 0/300/700-ms offsets. Paste adds those offsets to `currentTime * 1000`, producing 2/2.3/2.7-second keys at a 2-second playhead. Values are copied exactly, including multi-turn rotations and negative scales, without sampling or display rounding.

## Paste behavior

The group becomes one validated batch mutation of `workingAnimation`. Playback pauses, scrubbing ends, drafts/dragging cancel and preview refreshes at the held playhead time. Successful installation replaces selection with the resulting canonical keys and chooses the earliest as primary; stable clipboard order breaks ties. Existing selection setters keep primary inspector context and marker visuals coherent before observers see the installed snapshot.

**Duration policy:** the existing authored `AnimationClip.duration` is an explicit millisecond upper bound used by validation and runtime evaluation. Paste/duplicate extend it to the latest requested key in the same transaction, preserving all key spacing. No new duration semantic or clamped endpoint groups are introduced. Events, authored loop, playback and interpolation stay intact. Undo restores the original duration.

## Collision policy

Single-key paste/duplicate uses the same canonical destination policy as `moveBonePropertyKeyframe()`: the nearest same-bone/property sample inside `KEYFRAME_TIME_TOLERANCE_MS` supplies the destination time; stored-order ties follow existing movement behavior. Every property sample within tolerance of that canonical time is replaced. Sparse sibling properties retain their times/values, empty rows disappear and rows stay sorted. Other tracks remain unchanged.

Since v0.5.2.6.3, multi-key paste/duplicate follows group movement: external tolerant collisions are removed before inserting all exact translated group times. Distinct nearby group members no longer replace each other. Copy deduplicates repeated canonical references; paste rejects translated duplicate same-property identities caused by floating point precision. Undo/Redo restore exact complete snapshots, including all replaced values and sparse sibling rows. See the [hardening report](animation-editor-interpolation-hardening-verification.md).

## Duplicate behavior

Duplicate uses the copy-group and paste-group helpers. Stepped clips shift by one authored frame (`1 / fps` seconds for finite positive FPS); smooth clips or absent FPS use 0.01 seconds. The step does not depend on Snap or round off-frame keys. It preserves spacing and the held playhead, selects the duplicate result and extends duration when needed. Offset collisions deterministically replace destination samples through the same policy; no search for another free position or group move mode is added.

## Cross-animation validation

Clipboard identity is independent of the source animation. Compatible animation switching works with existing or empty destination tracks. Every group's bone/property/time/value is validated against the destination rig and ordinary schema before installation. Missing bones, unknown properties, negative/nonfinite relative times, invalid anchors and nonfinite values reject the entire group with the existing validation status. No partial snapshot/history installation occurs. Unit tests cover a separate compatible rig and a destination missing copied bones; browser tests cover idle-to-walk paste.

## History/dirty behavior

Copy and selection do not dirty authored data or create/invalidate history. Each changed paste/duplicate installs one immutable snapshot and therefore one `SnapshotHistory` action. Undo/Redo restore exact before/after objects, collision values and duration. Selection continues to reconcile against restored data; cleared transient navigation is not resurrected by history.

An identical paste succeeds and selects the resulting keys without creating history, dirtying a clean saved baseline or discarding redo. Source animations and caller-owned inputs remain untouched and unfrozen. Invalid paste preserves the working snapshot, selection, history and dirty state and reports its error.

## Files changed

- `src/devtools/animation-editor/keyframeClipboard.ts`: new immutable clipboard types and pure authored group copy/paste.
- `src/devtools/animation-editor/keyframeEdits.ts`: validated batch setter and shared movement/paste collision replacement.
- `src/devtools/animation-editor/AnimationEditorKeyframeCommands.ts`: session clipboard and transactional commands.
- `src/devtools/animation-editor/AnimationEditorState.ts`: command/getter facade and atomic pasted selection during installation.
- `src/devtools/animation-editor/TimelineInputController.ts`: timeline-scoped C/V/D shortcuts and existing native-editing guards.
- `src/devtools/animation-editor/TimelineSessionController.ts`: command button handlers and enabled states.
- `src/devtools/animation-editor/main.ts`: buttons, accessible shortcuts and timeline instructions.
- `tests/animationEditorClipboard.test.ts`: authored copy/paste/duplicate, validation, collision and history regression tests.
- `tests/browser/animationClipboard.spec.ts`: shortcut/button, multi-bone/property, duration, selection, preview, cross-animation and native-editing verification.
- `README.md`, `docs/animation-editor.md`, `docs/development.md`, this report: current behavior, architecture, APIs and verification.
- `package.json`, `package-lock.json`: milestone version `0.5.2-5.2`.

The supplied `plans/archive/plan-v0.5.2.5.2.md` remains unchanged.

## APIs/types changed

Editor-only additions:

- `KeyframeClipboard`, `KeyframeClipboardEntry`.
- `copyKeyframeSelection(animation, keys)`, `pasteKeyframeClipboard(animation, rig, clipboard, anchorTimeMs)`.
- `PropertyKeyframeEdit`, `setBonePropertyKeyframes(animation, rig, edits, { extendDuration? })`.
- State getter `keyframeClipboard` and boolean commands `copySelectedKeyframes()`, `pasteKeyframes()`, `duplicateSelectedKeyframes()`.
- Internal install callbacks accept optional resulting selection so authored data and selection notify together.

Existing engine schema/runtime/public exports and selection APIs are unchanged.

## Tests

Eleven new unit cases cover five-key groups over torso/upper arm/forearm and multiple properties; exact authored values, spacing and source immutability; no-op/empty copy/paste; duration extension; selection/primary/preview; single-step history; movement-equivalent tolerant replacement; smooth/stepped duplicate offsets; duplicate collisions; clipboard retention; compatible rigs/animation switching; invalid destinations; and unchanged-paste redo preservation.

Five browser scenarios run against development and production. They cover a five-key cross-bone/property group, internal clipboard buttons and Ctrl/Cmd shortcuts, timing offsets, held playhead, new selection, duration/ruler updates, inspector values, playback, one-step Undo/Redo, collision restoration, compatible animation switching, smooth/stepped duplicates, and input/select/textarea/inherited content-editable/IME/repeat/modifier/bookmark guards. Existing multi-selection and movement browser suites run alongside them.

## Manual verification

Verification uses automated Chrome interactions and a timeline screenshot, rather than a separate hands-on user session. The fixture includes torso, right upper arm, right forearm and five selected keys over four properties. It copies at 0.5 seconds, pastes at 2 seconds, verifies 2/2.3/2.7-second positions and selection, undoes/redoes the entire group, duplicates at a frame/fallback step, replaces an existing collision, switches idle to walk, and plays the edited animation. The screenshot is saved as `pasted-keyframes.png` under the corresponding `test-results/animationClipboard-...` directory. The production screenshot was visually inspected: command buttons, selected/primary diamonds, row alignment, extended ruler and held 2-second playhead display correctly; lower arm rows remain accessible by scrolling.

## Required command results

Using the repository's installed Node.js 24.19.0:

- `npm run typecheck`: passed.
- `npm run test`: passed, 1,104 tests passed / 27 existing skips (66 passing files / 3 skipped files).
- `npm run build`: passed, including demo, library declarations and the Node `/core` smoke check.
- `npm run lint`: passed.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationClipboard.spec.ts tests/browser/animationMultiSelection.spec.ts tests/browser/animationKeyframeMovement.spec.ts`: passed, 28 scenarios across development and production, including all 10 new clipboard scenario runs.

The host shell defaults to Node 13, so checks use `/Users/samiluukkonen/.nvm/versions/node/v24.19.0/bin` first on `PATH`. Browser tests require localhost servers and Chrome outside the port-binding sandbox.

## Deferred to v0.5.2.5.3+

Group dragging, multi-key keyboard nudging, time scaling/stretching, mirrored copying, track remapping UI, clipboard JSON/system clipboard export, interpolation editing, event copying, onion skinning and IK-target authoring remain deferred.
