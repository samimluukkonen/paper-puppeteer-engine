# Visual Animation Editor — v0.5.2.3.2

Open `/animation-editor/` from **Open Animation Editor** in the demo or **Animation Editor** in the Rig Editor. The sample character loads with its default skin and its first animation (`idle`). The independent Rig Editor remains at `/rig-editor/`.

Select `idle`, `walk`, or another character animation in the Animation menu. Click or drag anywhere on the timeline to preview its authored pose. Pointer capture keeps scrubbing active outside the timeline; time clamps at both ends. Release, pointer cancellation, focus loss, or hiding the page ends scrubbing. Touch and pen use the same pointer path. With the timeline focused, arrow keys move by 0.01 seconds, Shift increases the step to 0.1 seconds, and Home / End jump to the endpoints.

The sample `sword` and `guardUpperBody` clips contain baked arm rotations for a two-handed katana grip, so both show a complete sword-ready pose without IK. `sword` adds the idle body bob; `guardUpperBody` is the torso/arm overlay used while walking in the demo. The editor shows the default skin without the demo's katana prop; interactive weapon aiming and grip IK remain demo behavior.

**Play** starts or resumes at the current time. **Pause** holds time, playhead, and pose. **Restart** immediately returns to zero and preserves whether playback is active. **Home** does the same from anywhere outside typing controls; **End** remains timeline-only. **Space** toggles Play/Pause outside input, select, textarea, and content-editable regions; holding Space toggles only once. Focused buttons retain native Space activation (Restart rewinds, Loop preview toggles looping). Modified shortcuts and IME composition leave editor time alone. **Loop preview** toggles a transient editor preference (off by default). With it off, playback stops exactly at duration and holds the final pose. With it on, the editor wraps time and preserves overshoot, including deltas spanning several animation lengths. Dragging while playing temporarily suspends advancement; release, cancellation, lost pointer capture, focus loss, or page hiding ends the drag and resumes from the scrubbed time. Dragging while paused stays paused. Releasing at the final endpoint stops non-looping playback; looping playback wraps on the next update. An explicit Pause during a drag cancels resume. Pressing Play at the endpoint starts again at zero. Selecting another animation resets time and pauses. Controls are disabled without a valid animation. There is no separate Stop control in this milestone.

The ruler adapts to duration and available width, with major labels, minor ticks, and an end marker. The playhead and numeric time display reflect continuous seconds, formatted as `0.742 / 2.000 s` without rounding the internal clock. Metadata shows smooth/stepped playback, authored FPS for stepped clips, authored loop state, preview loop preference, speed, and current playback/scrub status. Preview loop and speed preferences persist across animation selection.

**Speed** offers 0.25×, 0.5×, 1× (default), 1.5×, and 2×. Each update advances animation time by elapsed real time multiplied by this editor-only speed. Changing speed while playing or scrubbing preserves time and playback intent; it never changes authored data, dirty state, or undo history.

**Mode** edits the animation's existing `playback` property in the working copy. Smooth interpolation stays continuous. Stepped mode holds poses at authored FPS boundaries while the playhead stays continuous and Phaser continues rendering at its normal rate. Switching to stepped mode starts at 10 FPS; switching to smooth removes the FPS field as required by the schema. **FPS** is enabled only for stepped clips and accepts finite values from 1 to 240, including fractional rates. Existing clips with valid runtime FPS outside those editor bounds still load and preview unchanged. Invalid or empty edits show a validation error and restore the held value. Mode/FPS edits update the paused or playing preview immediately without retiming keys or events (the format stores their times in milliseconds).

**Undo** and **Redo** restore authored settings and keys through the existing snapshot history and refresh the preview. Settings changes mark the working animation dirty when it differs from the saved baseline. The original source remains immutable. Animation switching preserves a dirty working copy and reports the issue; undo edits back to the baseline before switching. Saving/exporting animation data remains deferred.

Mode/FPS and committed key edits also protect page navigation, refresh, closing, and character selection with the browser's unsaved-change confirmation. Undo the edits before leaving to avoid discarding them. Preview navigation and playback preferences do not trigger this confirmation.

## Visual bone keyframing

Select a bone from the **Bones** hierarchy or click its joint marker in the preview. The selected joint has an orange ring. **Show bones** controls the existing skeleton visualization; the hierarchy stays available when overlapping joints are hard to pick. Selection does not edit the animation or rig.

Scrub to a time, then inspect X, Y, Rotation, Scale X, and Scale Y. These are absolute bone-local authored animation values from the existing evaluator, before IK. Rotation is displayed and entered in degrees, then converted to radians for the animation format. Unkeyed properties fall back to the rig bind values; smooth and stepped evaluation match the existing preview. The numeric display uses six decimal places at most; **Set Key** without typing uses the full evaluated value, without rounding it to the display precision.

For example, at **0.5 s**, select `rightForearm`, enter **35** in Rotation, and press that row's **Set Key**. Typing previews a temporary editor-only transform, highlighted in yellow, and pauses playback at the held time. No key, history entry, or dirty change exists until Set Key. Set Key creates a sparse rotation key at 500 ms, or updates the existing rotation key within the core's floating-point time tolerance. Other properties are not implicitly keyed. You can also press Set Key directly to author the currently evaluated value. Each row shows **● keyed** or **○ no key**, using the existing keyed-state query API.

**Delete Key** removes only that property's key at the playhead, discards its draft, and immediately re-evaluates interpolation or bind fallback. Other properties and other times remain intact. A property commit clears only that property's draft; other pending fields remain temporary until individually keyed or cancelled. Empty/nonfinite input cannot be committed. **Cancel edits** or **Escape** restores all evaluated values and does not resume playback. Changing time, bone, or animation, pressing Play, changing authored settings, and undo/redo discard pending drafts. Preview preferences do not clear drafts. Undo/redo applies to authored keys through the existing snapshot history; navigation and drafts do not enter history. Creating/updating/deleting changed data marks the working animation dirty; no-op edits remain clean, and deleting newly created keys can restore the baseline.

**Facing** mirrors only the outer puppet container. **IK preview (fixed targets)** pins the configured demo chains' current end joints in canonical puppet coordinates; targets project with facing and remain fixed while scrubbing/playing. The render pose can differ from the pre-IK inspector while IK is enabled. Neither preview preference edits authored values or dirty state, and Set Key never reads rendered joints, screen/world coordinates, or IK output. The Rig Editor's bind pose remains unchanged. Numeric editing is the authoring interface for this milestone; transform drag handles remain deferred.

## Data and preview ownership

`AnimationEditorState` is independent of Phaser and the DOM. It owns a frozen source snapshot and saved baseline per animation and a separately cloned working animation in the existing versioned file format. `markSaved()` retains the selected animation's working data across selection changes while keeping its original source untouched. Explicitly discarding changes restores the last saved baseline on the next selection. Caller-owned character animations remain untouched. Editor-only selection, time, playback, speed, preview loop preference, scrubbing, validation issues, and history stay outside the serialized data. Authored FPS/mode use the existing `playback` union; no schema or engine changes are needed. `subscribe()` connects external state changes to the preview and UI.

`currentTime` is the sole editor clock, in continuous seconds. `AnimationEditorScene.update()` converts Phaser's elapsed milliseconds to seconds and calls `advancePlayback()`. Rendering runs at the normal Phaser rate; pose quantization remains the evaluator's responsibility. `duration` reads the working animation's explicit `duration` in milliseconds and converts it to seconds; keys and events do not redefine the endpoint. Zero-duration clips are invalid in the existing runtime schema and display its validation errors. Empty/partial tracks and event-only clips retain their explicit positive duration. No character, no animations, or no selection uses a disabled zero-length timeline. Nonpositive or nonfinite playback deltas do nothing, and completed playback sends no further time notifications. Looping reduces the speed-scaled delta modulo duration before adding it to current time, preserving the held fraction even for `Number.MAX_VALUE`. If multiplication overflows, real time is reduced by one preview loop before scaling. The zero-length guard runs before modulo; empty or rejected zero-duration clips hold time at zero with playback stopped.

`TimelineController` owns pointer capture and measured DOM width, generates the ruler through pure helpers, and translates pixels into calls to `setCurrentTime()`. It calls `beginScrub()` on pointer-down and `endScrub()` on release or interruption, and releases a captured pointer when selection clears the scrub state. It has no independent animation clock. Ruler, playhead, and the empty track region are separate so later versions can add bone/property/event rows without replacing time navigation.

`AnimationEditorPreview` compiles only when the working animation identity changes and owns an existing `AnimationPlayer` over the puppet's joints. The compiled preview uses `loop: false` and an empty event list without changing source or working data, so the evaluator also samples the exact final pose for stepped clips whose endpoint falls between frames. It converts seconds to milliseconds and calls `sample(..., { mode: 'playback' })`, then `Puppet.syncPose()` projects the pose through the runtime rendering pipeline. This reuses interpolation, shortest-path rotations, and stepped sampling; timeline code never interpolates bones. Each changed pose sample resets joints to bind pose before evaluation, preventing untracked temporary values from leaking after cancellation or navigation. Temporary local properties apply after evaluation and before pose presets/IK, while preserving optional IK configuration and pose presets. The page configures optional demo IK chains, disabled by default, and a facing preference; these affect only rendering. Embedded previews with enabled IK or mirroring retain the runtime order: evaluator, pose presets, constraints/IK, and rendering. Facing mirrors the outer puppet container without editing local animation transforms. Scrubbing and editor playback neither advance runtime playback clocks nor dispatch animation events; stripping markers also suppresses time-zero events on initialization, selection, authored settings edits, and undo/redo. Runtime gameplay events remain unchanged.

`replaceWorkingAnimation()` validates external authored changes with the existing JSON/schema/reference checks and owns a fresh frozen copy. Internal FPS/mode setters validate their scalar changes; keyframe setters use the validating mutation helpers. These internal edits retain unchanged frozen tracks, rows, events, and playback settings instead of copying the whole clip again. All edits record one replacement through the shared `SnapshotHistory`, preserving those shared branches through undo/redo. Invalid replacements preserve the held working copy and pose. Replacements must retain the selected animation’s name; renaming is deferred. Dirty state compares the working snapshot with a saved baseline, following the Rig Editor pattern. `markSaved()` is internal save plumbing, while `undo()` and `redo()` are exposed for authored edits. `selectAnimation()` refuses dirty replacement unless explicitly called with `{ discardChanges: true }`. Scrubbing and selection never record history.

`previewLoop`, `playbackSpeed`, and `isScrubbing` are transient state views. `isPlaying` retains playback intent during a drag, so `advancePlayback()` skips while `isScrubbing` and resumes naturally after `endScrub()`; no separate saved playback flag is needed. Successful animation selection clears both playback and scrub state and resets time before notifying the preview. Failed selection preserves the held session. Binding a new session, disposal, and scene shutdown pause before ending a scrub, preventing accidental resume.

Playback commands, loop toggles, scrubbing, and time advancement never change animation snapshots, dirty state, or authored history. Existing dirty edits remain dirty. Replacements and history restoration that shorten duration clamp time and pause if the endpoint is reached.

For a custom character, pass `{ characterUrl: '../characters/hero/character.json' }` as the third constructor argument of `AnimationEditorScene`. It uses the shared cancelable character loader, existing manifest validation, and default skin. Failed loads show errors; scene shutdown invalidates pending loads, pauses and releases editor playback, disposes the preview subscription/player, and destroys the puppet.

## APIs

- `AnimationEditorState(rig?, animations?)`: animation catalogue and owned session.
- `animationIds`, `selectedAnimationId`, `sourceAnimation`, `workingAnimation`, `currentTime`, `duration`, `loop` (authored), `previewLoop`, `isPlaying`, `isScrubbing`, `dirty`, `validationIssues`: read-only session views.
- `selectAnimation(id | null, options?)`, `setCurrentTime(seconds)`, `subscribe(listener)`: navigation and notifications.
- `play()`, `pause()`, `togglePlayback()`, `restart()`, `advancePlayback(deltaSeconds)`: transient playback commands on `AnimationEditorState`; `isPlaying` retains playback intent during a scrub.
- `setPreviewLoop(boolean)`, `beginScrub()`, `endScrub()`: editor preference and pointer navigation lifecycle.
- `playbackSpeed`, `setPlaybackSpeed(number)`: transient speed view and setter; unsupported speeds return false.
- `setAuthoredFPS(number)`, `setAuthoredPlaybackMode('smooth' | 'stepped')`: validated authored edits; return success, use working-copy history, and leave key/event times untouched.
- `PREVIEW_PLAYBACK_SPEEDS`, `AUTHORED_FPS_MIN`, `AUTHORED_FPS_MAX`, `DEFAULT_AUTHORED_FPS`: shared editor control values.
- `replaceWorkingAnimation(input)`, `markSaved()`, `undo()`, `redo()`: internal authored-change foundation.
- `selectedBoneId`, `boneTransformDraft`, `hasTemporaryTransform`, `selectedBoneTransform`: editor-only bone selection, immutable sparse drafts, and evaluated local values with prospective overrides.
- `selectBone(id | null)`, `beginTransformEdit()`, `setTemporaryBoneProperty(property, localValue)`, `commitBoneProperty(property)`, `deleteBonePropertyKey(property)`, `cancelTransformEdit()`: visual authoring commands; the UI handles degrees/radians conversion. Key mutations retain the existing core/state APIs.
- `BoneInspectorController(app)` / `bind(state)` / `dispose()`: stable hierarchy and numeric property controls.
- `AnimationEditorScene.setFacing(facing)`, `setBonesVisible(boolean)`, `setIKPreview(boolean)`, and optional `AnimationEditorSceneOptions.ikChains`: preview-only projection/configuration.
- `boneHierarchy(rig)`: shared pure hierarchy traversal used by both editors.
- `AnimationEditorPreview(state, puppet)` / `dispose()`: existing evaluator-to-puppet adapter.
- `TimelineController(app)` / `bind(state, characterId?)` / `showError(message)` / `dispose()`: DOM adapter.
- `animationDurationSeconds`, `clampTime`, `timeToTimelineX`, `timelineXToTime`, `generateRulerTicks`, `RulerTick`: pure timeline logic.
- `AnimationEditorSceneOptions`, `ReadonlyAnimation`: editor configuration and immutable data views.

These APIs live under `src/devtools/animation-editor/`; the production package exports and external JSON schemas are unchanged.

## Keyframe authoring core

v0.5.2.3.1 adds pure data operations in `keyframes.ts` and commands/queries on `AnimationEditorState`. v0.5.2.3.2 connects these existing APIs to the visual inspector without changing their signatures. Package version: `0.5.2-3.2`.

The existing file format remains authoritative: `tracks[boneId]` holds a strictly time-sorted array of sparse `{ time, x?, y?, rotation?, scaleX?, scaleY? }` rows. Time is milliseconds, rotation is radians, and values are absolute local transforms. Each property has its own independent samples even when several properties share a row. Setting rotation never authors position or scale implicitly.

Pure mutation signatures are:

```ts
setBonePropertyKeyframe(animation, rig, boneId, property, timeMs, value)
removeBonePropertyKeyframe(animation, rig, boneId, property, timeMs)
```

Both return a replacement animation, preserve supplied version/metadata, and never mutate or freeze the input. Changed arrays/rows are copied; unrelated branches are shared and should be treated as read-only. No-op edits return the input identity. They guard rig references, supported properties, finite values, and duration bounds, and validate both input and result through the existing file validator. Invalid inputs throw. Existing invalid/unsorted timelines are rejected rather than silently repaired.

Setting a property first looks for its nearest authored key within `KEYFRAME_TIME_TOLERANCE_MS = 1e-6` milliseconds (one nanosecond). It updates that value while retaining its stored time. If the property is absent, it merges into the nearest row in tolerance or inserts a new sorted row. Equal-distance matches favor the earlier stored row. Existing distinct close rows are retained; new edits do not add effectively duplicate times. The same `keyframeTimesMatch()` policy applies to lookup, deletion, and keyed-state queries. No FPS quantization or global rounding changes authored time. Endpoint arithmetic error within tolerance is clamped to zero/duration; times farther outside the duration are rejected.

Deleting removes only the requested property. Rows with no remaining transform values are removed; tracks with no remaining rows are omitted. Other bones, properties, key times, events, and playback metadata remain intact.

Pure queries are `findBonePropertyKeyframe(animation, boneId, property, timeMs)` (a detached `{ time, value }` or `undefined`), `hasKeyframeAtTime(...)`, and `getKeyedPropertiesAtTime(animation, boneId, timeMs)` (in runtime property order). Missing keys and nonfinite query times produce an empty result.

`getEvaluatedBonePropertyValue(animation, rig, boneId, property, timeMs)` uses the runtime pose buffer and playback quantization, compiling an event-free, nonlooping preview clip. `getEvaluatedBoneTransform(animation, rig, boneId, timeMs)` reads all five local properties together. Fully frozen animation snapshots cache compilation per rig and reuse pose evaluation within the same sampled frame; mutable or shallow-frozen caller data is validated and compiled afresh. Returned transforms are detached copies. Sampling never advances a clock or stores an evaluated pose as authored data. Smooth interpolation and shortest-path rotation come from the runtime; stepped clips hold at authored FPS boundaries and retain the exact endpoint. Before the first property key and after its last, the runtime holds the nearest value. A wholly unkeyed property falls back to the rig bind pose. Results represent the animation's local transform before optional presets, IK, and facing. Invalid evaluation targets throw.

State methods use **seconds**, defaulting to `currentTime`:

```ts
state.setBonePropertyKeyframe(boneId, property, value, timeSeconds?)
state.removeBonePropertyKeyframe(boneId, property, timeSeconds?)
state.findBonePropertyKeyframe(boneId, property, timeSeconds?)
state.hasKeyframeAtTime(boneId, property, timeSeconds?)
state.getKeyedPropertiesAtTime(boneId, timeSeconds?)
state.getEvaluatedBonePropertyValue(boneId, property, timeSeconds?)
state.getEvaluatedBoneTransform(boneId, timeSeconds?)
```

The returned keyframe's `time` remains milliseconds. Mutation methods return success, including no-ops; invalid edits return `false` with validation issues and leave the working snapshot/history unchanged. Without selection, mutations return `false`, key/value lookups return `undefined`, and keyed-state queries return `false`/`[]`. Evaluation errors on a selected animation throw without changing session diagnostics.

Only `workingAnimation` is replaced. Actual data changes record one history entry, update the existing dirty comparison, and notify the existing preview subscription, which refreshes immediately while paused. No-ops preserve snapshot identity and redo history. Deleting newly created keys can return the animation to its clean baseline. Queries never notify or change history, validation issues, or dirty state. Edits preserve continuous time and playback intent; the clock architecture is unchanged.

For example, explicitly key the value visible at a paused playhead:

```ts
const value = state.getEvaluatedBonePropertyValue('head', 'rotation');
if (value !== undefined) state.setBonePropertyKeyframe('head', 'rotation', value);
```

## Authoring verification

The controller/state and preview tests cover selection without mutation, property create/update/delete, sparse tracks, draft/dirty/history behavior, cancellation on navigation, source and bind-pose isolation, nested local transforms, and pre-IK/canonical-facing values. The browser authoring scenarios use `demo-puppet`, select torso/upper arm/forearm/hand, author a rotation at 0.5 s, scrub away/back, update it, author local X/Y, delete only rotation, interpolate/play several keys, pause on field focus, cancel drafts, reject blank fields, and key with IK and mirrored preview enabled. They also capture desktop/mobile screenshots. Run `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationBoneAuthoring.spec.ts` to use installed Chrome.

## Verification checklist

- [ ] Open the demo, Rig Editor, and Animation Editor independently; navigate between them under the local and deployed base paths.
- [ ] In the Rig Editor select `head`, edit its X value, and undo; confirm validation still succeeds.
- [ ] Confirm the sample puppet artwork and default skin appear in the Animation Editor.
- [ ] Select `idle` and `walk`; confirm time resets to zero and duration/metadata/ruler update.
- [ ] Confirm ruler labels, minor ticks, end marker, playhead, and numeric current time are visible.
- [ ] Click near start, middle, and end; continuously drag and release outside both timeline edges; confirm time clamps and stops changing on release.
- [ ] Scrub a visible walk pose and restart; confirm the preview changes immediately while paused.
- [ ] Play, pause, resume, and restart both while playing and paused; confirm time, playhead, and artwork stay synchronized.
- [ ] Confirm playback stops at duration and holds the final pose with Loop preview off; Play at the endpoint starts again at zero.
- [ ] Enable Loop preview, observe repeated wrapping, disable it, and confirm playback stops at the final pose.
- [ ] Drag while playing: confirm time and artwork hold until pointer movement, then resume on release. Drag while paused and confirm it remains paused.
- [ ] Switch animation while playing or dragging; confirm the old pointer is released, playback pauses, time resets, and the new pose appears.
- [ ] Confirm loop toggles, dragging, and repeated wrapping keep **No unsaved changes**. Unit tests cover overshoot, very large finite deltas, and rejected zero-duration data.
- [ ] Confirm Space toggles once per press, including with Play focused; other buttons retain native activation. Home rewinds with a button or preview focused. Both leave form controls, content-editable regions, modified shortcuts, and IME composition alone.
- [ ] Use keyboard navigation and resize to a narrow window; confirm the same current time and correct playhead position.
- [ ] Set Mode to stepped; confirm metadata and held frames while time stays continuous.
- [ ] Clear selection, load a character with no animations, and load invalid zero-duration data; confirm useful empty/error messages without exceptions.
- [ ] Confirm **No unsaved changes** after all navigation. Unit tests verify caller/source isolation and runtime agreement for smooth/stepped/partial clips, presets, partial/full IK, and both facings.
- [ ] Compare 0.5×, 1×, and 2× playback; confirm speed persists across selection without dirtying data.
- [ ] Switch Mode to stepped, edit FPS while paused and playing, and confirm immediate pose changes with continuous time and normal rendering.
- [ ] Reject empty, negative, zero, and out-of-range FPS without changing the held animation. Confirm typing an FPS draft while playing does not reset the input.
- [ ] Undo/redo settings edits and return to the clean baseline before switching animations; source and caller data remain unchanged in unit tests.

The automated browser suite performs the route, artwork, selection, click/drag/clamping, release, keyboard, resize, empty-state, invalid-data, stepped-frame, playback, endpoint-hold, and typing-target scenarios against development and production builds. The route test also edits and undoes a Rig Editor field. Run with `npm run test:browser`; `PLAYWRIGHT_CHANNEL=chrome` can use installed Chrome.

The v0.5.2.2.4 stabilization pass adds global Home navigation, modifier/IME shortcut guards, event-free preview compilation, finite duration fallback, and bind-pose resets that retain optional IK and pose presets. No new runtime/schema APIs or dependencies were introduced. Package version: `0.5.2-2.4`.

Verification details, architecture audit, changed files, and remaining manual checks are recorded in [Playback verification](animation-editor-playback-verification.md).

The v0.5.2.3.2 implementation report, changed files, API additions, and verification results are recorded in [Bone authoring verification](animation-editor-authoring-verification.md).

## Deferred features

Bone/property/event timeline tracks, keyframe diamonds, key selection/dragging/movement, transform drag handles, copy/paste, multi-key selection, auto-key, per-keyframe interpolation UI, event authoring, snapping, animation export/save/import UI, onion skinning, mirrored keyframes, ghost poses, and IK target authoring/baking remain deferred to v0.5.2.3.3+. Property create/update/delete is now available through the inspector as well as the data APIs above.
