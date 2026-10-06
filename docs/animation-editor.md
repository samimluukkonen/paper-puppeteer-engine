# Visual Animation Editor — v0.5.2.5.1

Open `/animation-editor/` from **Open Animation Editor** in the demo or **Animation Editor** in the Rig Editor. The sample character loads with its default skin and its first animation (`idle`). The independent Rig Editor remains at `/rig-editor/`.

Select `idle`, `walk`, or another character animation in the Animation menu. Click the timeline or drag the ruler to preview its authored pose. Drag empty lanes to select keys. Pointer capture keeps scrubbing active outside the timeline; time clamps at both ends. Release, pointer cancellation, focus loss, or hiding the page ends scrubbing. Touch and pen use the same pointer path. With no selected key and the timeline focused, arrow keys scrub by 0.01 seconds and Shift increases the step to 0.1 seconds. With exactly one selected key, arrows nudge its authored time instead. Multiple-key nudging remains deferred. Home / End navigate to the endpoints.

The sample `sword` and `guardUpperBody` clips contain baked arm rotations for a two-handed katana grip, so both show a complete sword-ready pose without IK. `sword` adds the idle body bob; `guardUpperBody` is the torso/arm overlay used while walking in the demo. The editor shows the default skin without the demo's katana prop; interactive weapon aiming and grip IK remain demo behavior.

**Play** starts or resumes at the current time. **Pause** holds time, playhead, and pose. **Restart** immediately returns to zero and preserves whether playback is active. **Home** does the same from anywhere outside typing controls; **End** remains timeline-only. **Space** toggles Play/Pause outside input, select, textarea, and content-editable regions; holding Space toggles only once. Focused buttons retain native Space activation (Restart rewinds, Loop preview toggles looping). Modified shortcuts and IME composition leave editor time alone. **Loop preview** toggles a transient editor preference (off by default). With it off, playback stops exactly at duration and holds the final pose. With it on, the editor wraps time and preserves overshoot, including deltas spanning several animation lengths. Scrubbing the ruler while playing temporarily suspends advancement; release, cancellation, lost pointer capture, focus loss, or page hiding ends the drag and resumes from the scrubbed time. Dragging while paused stays paused. Releasing at the final endpoint stops non-looping playback; looping playback wraps on the next update. An explicit Pause during a drag cancels resume. Pressing Play at the endpoint starts again at zero. Selecting another animation resets time and pauses. Controls are disabled without a valid animation. There is no separate Stop control in this milestone.

The ruler adapts to duration and available width, with major labels, minor ticks, and an end marker. The playhead and numeric time display reflect continuous seconds, formatted as `0.742 / 2.000 s` without rounding the internal clock. Metadata shows smooth/stepped playback, authored FPS for stepped clips, authored loop state, preview loop preference, speed, and current playback/scrub status. Preview loop and speed preferences persist across animation selection.

**Speed** offers 0.25×, 0.5×, 1× (default), 1.5×, and 2×. Each update advances animation time by elapsed real time multiplied by this editor-only speed. Changing speed while playing or scrubbing preserves time and playback intent; it never changes authored data, dirty state, or undo history.

**Mode** edits the animation's existing `playback` property in the working copy. Smooth interpolation stays continuous. Stepped mode holds poses at authored FPS boundaries while the playhead stays continuous and Phaser continues rendering at its normal rate. Switching to stepped mode starts at 10 FPS; switching to smooth removes the FPS field as required by the schema. **FPS** is enabled only for stepped clips and accepts finite values from 1 to 240, including fractional rates. Existing clips with valid runtime FPS outside those editor bounds still load and preview unchanged. Invalid or empty edits show a validation error and restore the held value. Mode/FPS edits update the paused or playing preview immediately without retiming keys or events (the format stores their times in milliseconds).

**Undo** and **Redo** restore authored settings and keys through the existing snapshot history and refresh the preview. **Ctrl/Cmd+Z** undoes and **Ctrl/Cmd+Shift+Z** redoes outside typing controls, matching the Rig Editor. Input, select, textarea and content-editable regions keep their native undo behavior; consumed shortcuts, IME composition, Alt-modified combinations and held-key repeats do not replay authored history. Each Set Key/Delete Key click, Mode change, or committed FPS change records one logical edit. Intermediate numeric input events remain temporary. Unchanged/invalid edits preserve redo; a new authored change invalidates it. This editor owns its own bounded history of 100 snapshots, separate from the Rig Editor. Undoing back to the exact loaded/saved baseline restores clean state, including when history has branched. Redo restores dirty state when its data differs from that baseline. The original source remains immutable. Animation switching preserves a dirty working copy and reports the issue; download, discard, or undo edits back to the baseline before switching. Every successful selection starts a clean history baseline. **Download animation JSON** exports the committed versioned file and establishes the saved baseline when the download starts. It excludes temporary fields, selection, history, IK and facing. Downloaded filenames preserve the original character manifest filename (for example, the `sword` clip exports as `combat-idle.json`). Place the file in the folder referenced by its manifest path. Embedded editors without source paths fall back to a sanitized clip name. The editor does not write into the project automatically. **Discard changes** confirms before restoring the last downloaded/saved baseline (or the loaded clip if none was saved), resetting time and history. Canceling keeps edits intact. Failed downloads retain dirty state and display an error. Saved clips remain available when switching away and back within this session; a page reload reads the character files again.

Mode/FPS and committed key edits also protect page navigation, refresh, closing, and character selection with the browser's unsaved-change confirmation. Download committed edits, discard them explicitly, or undo them before leaving. Preview navigation and playback preferences do not trigger this confirmation.

## Visual bone keyframing

Select a bone from the **Bones** hierarchy or click its joint marker in the preview. The selected joint has an orange ring. **Show bones** controls the existing skeleton visualization; the hierarchy stays available when overlapping joints are hard to pick. Selection does not edit the animation or rig.

Scrub to a time, then inspect X, Y, Rotation, Scale X, and Scale Y. These are absolute bone-local authored animation values from the existing evaluator, before IK. Rotation is displayed and entered in degrees, then converted to radians for the animation format. Unkeyed properties fall back to the rig bind values; smooth and stepped evaluation match the existing preview. The numeric display uses six decimal places at most; **Set Key** without typing uses the full evaluated value, without rounding it to the display precision.

For example, at **0.5 s**, select `rightForearm`, enter **35** in Rotation, and press that row's **Set Key**. Typing previews a temporary editor-only transform, highlighted in yellow, and pauses playback at the held time. No key, history entry, or dirty change exists until Set Key. Set Key creates a sparse rotation key at 500 ms, or updates the existing rotation key within the core's floating-point time tolerance. Other properties are not implicitly keyed. You can also press Set Key directly to author the currently evaluated value. Each row shows **● keyed** or **○ no key**, using the existing keyed-state query API.

**Delete Key** removes only that property's key at the playhead, discards its draft, and immediately re-evaluates interpolation or bind fallback. Other properties and other times remain intact. A property commit clears only that property's draft; other pending fields remain temporary until individually keyed or cancelled. Empty/nonfinite input cannot be committed. **Cancel edits** or **Escape** restores all evaluated values and does not resume playback. Changing time, bone, or animation, pressing Play, changing authored settings, and undo/redo discard pending drafts. Preview preferences do not clear drafts. Undo/redo applies to authored keys through the existing snapshot history; navigation and drafts do not enter history. Creating/updating/deleting changed data marks the working animation dirty; no-op edits remain clean, and deleting newly created keys can restore the baseline.

**Facing** mirrors only the outer puppet container. **IK preview (fixed targets)** pins the configured demo chains' current end joints in canonical puppet coordinates; targets project with facing and remain fixed while scrubbing/playing. The render pose can differ from the pre-IK inspector while IK is enabled. Neither preview preference edits authored values or dirty state, and Set Key never reads rendered joints, screen/world coordinates, or IK output. The Rig Editor's bind pose remains unchanged. Numeric editing is the authoring interface for this milestone; transform drag handles remain deferred.

Explicit time navigation and starting a scrub cancel drafts even when the playhead stays at the same time or clamps to its current endpoint. Restart at zero also cancels drafts. Undo/Redo cancel drafts even when their history stack is empty; cancelled fields refresh immediately, including focused fields. Other preview preferences retain drafts. Uncommitted FPS text is replaced by the held authored value when the working snapshot changes, so it cannot carry into another animation or a restored history snapshot.

## Bone and property timeline tracks

Every rig bone has a row in the same parent-first depth-first order as the Bones hierarchy. Expand a bone with its arrow to show `x`, `y`, `rotation`, `scaleX`, and `scaleY` in runtime order. Collapsing hides that bone's properties while keeping descendant bones available. **●** indicates authored keys anywhere in the animation; **○** indicates no authored keys. This differs from the inspector's indicator, which checks only the current playhead time. Bind-pose values and evaluated poses do not affect timeline key presence.

Click a bone label to select the same bone in the hierarchy, inspector, and puppet preview. Click a property label to select its bone plus a transient property track. Picking a bone from any surface clears property selection, including when picking the same bone. Successful animation selection clears the property selection and keeps expansion for this rig session. Collapse preserves a hidden property selection. Track selection cancels transform drafts when the selection changes, preserves time and playback intent, and never edits animation data or history. Expansion and scrolling also stay transient.

Labels and time lanes share one grid and vertical scroll container, with matching fixed row heights. The existing ruler, time conversions, pointer capture, keyboard scrubbing and single playhead operate on the entire time column. Clicking an empty time lane seeks and clears key selection; dragging it selects a rectangle; label buttons select or expand without scrubbing. Each property lane hosts authored keyframe diamonds using the same time coordinates as the ruler and playhead.

With no animation selected, the rig's rows and properties remain available, key indicators are empty, and time controls are disabled at zero. Empty authored tracks still show all rig bones. Invalid animation/zero-duration data continues through existing validation, preserving an existing valid session where applicable.

## Keyframe markers and selection

Every authored property sample has a diamond on its expanded property lane. Sparse rows create markers only for their authored properties; evaluated poses, bind values and animation events never create markers. `PropertyTimelineTrack.keyframes` is an immutable array of `TimelineKeyframe` records (`boneId`, `property`, `time` in seconds, and `value`). It belongs to the cached row model, rebuilt from `workingAnimation` on authored changes or expansion. Markers and surviving DOM buttons remain stationary during playback; width changes reposition them with `timeToTimelineX()`.

Click a marker, or focus it and press Enter/Space, to pause playback, cancel drafts, select its bone/property and seek the sole editor clock to its exact authored time. A selected diamond has a contrasting color and `aria-pressed="true"`; the primary has a stronger outline. Selection uses frozen editor-only `KeyframeSelection` references (`boneId`, `property`, `time` in seconds). The immutable `selectedKeys` array is the whole selection, while `primaryKey` (also exposed as the compatibility getter `selectedKeyframe`) controls the bone/property inspector. Lookup uses the existing millisecond time tolerance and canonical authored times. Selection never dirties, serializes or enters authored history.

**Ctrl/Cmd-click** adds an unselected key or removes a selected key. It preserves the primary while that key survives; removing it chooses the first remaining key in selection order. Add/toggle never seeks, including when it needs a fallback primary. A normal click replaces the whole selection and seeks. **Shift-click** selects an inclusive range on the same property track, anchored at the last normal selection (or a surviving fallback anchor). Repeated Shift-clicks retain that anchor. Across tracks it adds the clicked key. Shift makes the clicked key primary and seeks; Ctrl/Cmd+Shift unions the range with existing selection.

Drag empty timeline lanes to show a transient **marquee**. Release selects marker centers inside its time and visible-row bounds across bones/properties. Ctrl/Cmd unions the result with the selection. Replacement retains the primary when included; otherwise it chooses the first result in visible track/key order and seeks once. Additive marquee never seeks. Scroll and resize use content-relative row geometry and the shared time conversion. Hidden/collapsed tracks are excluded. Escape, pointer cancellation, lost capture, blur, page hiding, session replacement, track-layout changes and authored mutations cancel the rectangle without changing selection. Playback pauses at the start and does not resume.

An empty-lane click clears keys and seeks, retaining bone/property context; Ctrl/Cmd-empty click retains selection and time. **Escape** cancels an active key drag or marquee first, and otherwise clears key selection. Bone/property navigation and successful animation switching clear all keys. Collapse retains selection. Ruler scrubbing and Home / End retain selection without forcing the playhead back.

**Delete Selected Keys**, Delete, or Backspace removes every selected property at its selected time, even after scrubbing away. Deletion pauses and cancels drafts but preserves the playhead time. Existing mutation APIs produce one snapshot/history transaction for the whole deletion, preserve unrelated keys, sparse siblings, events and source data, refresh preview/markers/indicators and clear selection. Shortcuts ignore typing controls, content-editable regions, composition and modified commands. Inspector value edits preserve selection. Reconciliation resolves surviving references through the shared tolerance, removes deleted keys and chooses a valid primary. Explicit time moves follow the primary key while retaining secondary selection; normal pointer dragging selects and moves only the clicked key. Undo/Redo reconcile the transient selection against restored authored data; they do not resurrect cleared selection. Undo after multi-delete restores every authored key in one operation.

**Previous Key** and **Next Key** navigate only the selected bone/property relative to current time, ignoring the held key within the shared tolerance. A destination selects and seeks exactly as a marker click does; unavailable directions are disabled. Time dragging and single-key keyboard nudging are described below.

## Data and preview ownership

`AnimationEditorState` is independent of Phaser and the DOM. Its internal `AnimationEditorSelection` owns transient bone/property/key selection, transform drafts, expansion, and cached timeline rows. The state facade coordinates notifications, playback, validation, authored edits, and history through the existing public API; history snapshots contain only authored animation data. It owns a frozen source snapshot and saved baseline per animation and a separately cloned working animation in the existing versioned file format. `markSaved()` retains the selected animation's working data across selection changes while keeping its original source untouched. Explicitly discarding changes restores the last saved baseline on the next selection. Caller-owned character animations remain untouched. Editor-only selection, time, playback, speed, preview loop preference, scrubbing, validation issues, and history stay outside the serialized data. Authored FPS/mode use the existing `playback` union; no schema or engine changes are needed. `subscribe()` connects external state changes to the preview and UI.

`currentTime` is the sole editor clock, in continuous seconds. `AnimationEditorScene.update()` converts Phaser's elapsed milliseconds to seconds and calls `advancePlayback()`. Rendering runs at the normal Phaser rate; pose quantization remains the evaluator's responsibility. `duration` reads the working animation's explicit `duration` in milliseconds and converts it to seconds; keys and events do not redefine the endpoint. Zero-duration clips are invalid in the existing runtime schema and display its validation errors. Empty/partial tracks and event-only clips retain their explicit positive duration. No character, no animations, or no selection uses a disabled zero-length timeline. Nonpositive or nonfinite playback deltas do nothing, and completed playback sends no further time notifications. Looping reduces the speed-scaled delta modulo duration before adding it to current time, preserving the held fraction even for `Number.MAX_VALUE`. If multiplication overflows, real time is reduced by one preview loop before scaling. The zero-length guard runs before modulo; empty or rejected zero-duration clips hold time at zero with playback stopped.

`TimelineController` owns pointer capture and measured DOM width, generates the ruler through pure helpers, and translates pixels into calls to `setCurrentTime()`. It calls `beginScrub()` on pointer-down and `endScrub()` on release or interruption, and releases a captured pointer when selection clears the scrub state. It has no independent animation clock. `buildTimelineTracks()` produces immutable discriminated bone/property rows from the shared hierarchy traversal, runtime property list, authored-key query and expansion set. `AnimationEditorState.timelineTracks` caches rows until expansion or the working snapshot changes. `TimelineTracksController` reconciles corresponding labels and lanes, retaining surviving DOM elements and updating selection separately. Playback and scrubbing do not rebuild track layout. Row expansion and property selection never enter animation JSON or authored history.

`AnimationEditorPreview` and inspector value queries share compiled clips through `getCompiledPreviewClip()`, cached by fully frozen working animation and rig identity. Each retains independent pose buffers; mutable inputs are validated and compiled fresh. The preview owns an existing `AnimationPlayer` over the puppet's joints. The compiled preview uses `loop: false` and an empty event list without changing source or working data, so the evaluator also samples the exact final pose for stepped clips whose endpoint falls between frames. It converts seconds to milliseconds and calls `sample(..., { mode: 'playback' })`, then `Puppet.syncPose()` projects the pose through the runtime rendering pipeline. This reuses interpolation, shortest-path rotations, and stepped sampling; timeline code never interpolates bones. Each changed pose sample resets joints to bind pose before evaluation, preventing untracked temporary values from leaking after cancellation or navigation. Temporary local properties apply after evaluation and before pose presets/IK, while preserving optional IK configuration and pose presets. The page configures optional demo IK chains, disabled by default, and a facing preference; these affect only rendering. Embedded previews with enabled IK or mirroring retain the runtime order: evaluator, pose presets, constraints/IK, and rendering. Facing mirrors the outer puppet container without editing local animation transforms. Scrubbing and editor playback neither advance runtime playback clocks nor dispatch animation events; stripping markers also suppresses time-zero events on initialization, selection, authored settings edits, and undo/redo. Runtime gameplay events remain unchanged.

`replaceWorkingAnimation()` validates external authored changes with the existing JSON/schema/reference checks and owns a fresh frozen copy. Internal FPS/mode setters validate their scalar changes; keyframe setters use the validating mutation helpers. These internal edits retain unchanged frozen tracks, rows, events, and playback settings instead of copying the whole clip again. All edits record one replacement through the shared `SnapshotHistory`, preserving those shared branches through undo/redo. Invalid replacements preserve the held working copy and pose. Replacements must retain the selected animation’s name; renaming is deferred. Dirty state compares the working snapshot with a saved baseline, following the Rig Editor pattern. `exportJson()` validates and serializes committed data without changing state; the download controller calls `markSaved()` only after starting the download. The save baseline retains undo history, while `undo()` and `redo()` are exposed for authored edits. `selectAnimation()` refuses dirty replacement unless explicitly called with `{ discardChanges: true }`. Scrubbing and selection never record history.

`previewLoop`, `playbackSpeed`, and `isScrubbing` are transient state views. `isPlaying` retains playback intent during a ruler scrub, so `advancePlayback()` skips while `isScrubbing` and resumes naturally after `endScrub()`; no separate saved playback flag is needed. Successful animation selection clears both playback and scrub state and resets time before notifying the preview. Failed selection preserves the held session. Binding a new session, disposal, and scene shutdown pause before ending a scrub, preventing accidental resume.

Playback commands, loop toggles, scrubbing, and time advancement never change animation snapshots, dirty state, or authored history. Existing dirty edits remain dirty. Replacements and history restoration that shorten duration clamp time and pause if the endpoint is reached.

For a custom character, pass `{ characterUrl: '../characters/hero/character.json' }` as the third constructor argument of `AnimationEditorScene`. It uses the shared cancelable character loader, existing manifest validation, and default skin. Failed loads show errors; scene shutdown invalidates pending loads, pauses and releases editor playback, disposes the preview subscription/player, and destroys the puppet.

## APIs

- `AnimationEditorState(rig?, animations?, options?)`: animation catalogue and owned session. Pass `options.animationPaths` to retain original manifest paths by clip name; `selectedAnimationFilename` exposes the selected export filename.
- `animationIds`, `selectedAnimationId`, `sourceAnimation`, `workingAnimation`, `currentTime`, `duration`, `loop` (authored), `previewLoop`, `isPlaying`, `isScrubbing`, `dirty`, `validationIssues`: read-only session views.
- `selectAnimation(id | null, options?)`, `setCurrentTime(seconds)`, `subscribe(listener)`: navigation and notifications.
- `play()`, `pause()`, `togglePlayback()`, `restart()`, `advancePlayback(deltaSeconds)`: transient playback commands on `AnimationEditorState`; `isPlaying` retains playback intent during a scrub.
- `setPreviewLoop(boolean)`, `beginScrub()`, `endScrub()`: editor preference and pointer navigation lifecycle.
- `playbackSpeed`, `setPlaybackSpeed(number)`: transient speed view and setter; unsupported speeds return false.
- `setAuthoredFPS(number)`, `setAuthoredPlaybackMode('smooth' | 'stepped')`: validated authored edits; return success, use working-copy history, and leave key/event times untouched.
- `PREVIEW_PLAYBACK_SPEEDS`, `AUTHORED_FPS_MIN`, `AUTHORED_FPS_MAX`, `DEFAULT_AUTHORED_FPS`: shared editor control values.
- `replaceWorkingAnimation(input)`, `exportJson()`, `markSaved()`, `undo()`, `redo()`: authored replacement, validated JSON export, save baseline, and history commands.
- `selectedBoneId`, `boneTransformDraft`, `hasTemporaryTransform`, `selectedBoneTransform`: editor-only bone selection, immutable sparse drafts, and evaluated local values with prospective overrides.
- `selectedTimelineProperty`, `selectTimelineProperty(boneId, property)`: transient property view and atomic bone/property selection using the existing bone owner.
- `selectedKeyframe`, `selectKeyframe(selection)`, `clearKeyframeSelection()`, `deleteSelectedKeyframe()`: compatibility APIs for primary context, normal selection/seek, clearing the set and deleting all selected authored keys.
- `keyframeDrag`, `beginKeyframeDrag(selection)`, `previewKeyframeDrag(seconds, disableSnapping?)`, `commitKeyframeDrag()`, `cancelKeyframeDrag()`: provisional gesture lifecycle; immutable `KeyframeDrag` holds the original key identity and preview time.
- `selectedKeys`, `primaryKey`: immutable selection references and inspector context.
- `selectKeyframe(ref, { additive?, range? })`, `selectKeyframes(refs, additive?)`, `selectKeyframeMarquee(bounds, additive?)`: transient selection commands.
- `deleteSelectedKeyframes()`: remove the whole selection in one transaction; `deleteSelectedKeyframe()` remains an alias.
- `moveSelectedKeyframe(seconds)`, `nudgeSelectedKeyframe(-1 | 1, large?)`: centralized time-only moves and one history action per changed nudge.
- `keyframeSnapMode`, `setKeyframeSnapMode('none' | 'frame')`, `keyframeFPS`, `snapKeyframeTime(seconds, duration, mode, fps?)`, `KeyframeSnapMode`, `DEFAULT_KEYFRAME_FPS`: editor-only snapping and shared 10 FPS fallback.
- `getAdjacentKeyframe(-1 | 1)`, `selectAdjacentKeyframe(-1 | 1)`: previous/next key query and navigation on the selected property.
- `timelineTracks`, `isTimelineBoneExpanded(boneId)`, `setTimelineBoneExpanded(boneId, expanded)`: immutable visible rows and transient expansion queries/commands; invalid bones are rejected.
- `TimelineTrack`, `BoneTimelineTrack`, `PropertyTimelineTrack`, `TimelineKeyframe`, `KeyframeSelection`, `buildTimelineTracks(rig, animation, expandedBones)`: pure hierarchy/property row model with depth, authored-key presence and immutable property markers.
- `getAuthoredBoneProperties(animation, boneId)`: supported properties with authored samples anywhere in the track, independent of current time.
- `TimelineTracksController(labels, lanes, onKeyPointerDown)` / `render(state, width)` / `dispose()`: stable labels, time lanes and key buttons positioned with shared timeline coordinates.
- `selectBone(id | null)`, `beginTransformEdit()`, `setTemporaryBoneProperty(property, localValue)`, `commitBoneProperty(property)`, `deleteBonePropertyKey(property)`, `cancelTransformEdit()`: visual authoring commands; the UI handles degrees/radians conversion. Key mutations retain the existing core/state APIs.
- `BoneInspectorController(app)` / `bind(state)` / `dispose()`: stable hierarchy and numeric property controls.
- `AnimationEditorScene.setFacing(facing)`, `setBonesVisible(boolean)`, `setIKPreview(boolean)`, and optional `AnimationEditorSceneOptions.ikChains`: preview-only projection/configuration.
- `boneHierarchy(rig)`: shared pure hierarchy traversal used by both editors.
- `AnimationEditorPreview(state, puppet)` / `dispose()`: existing evaluator-to-puppet adapter.
- `TimelineController(app)` / `bind(state, characterId?)` / `showError(message)` / `dispose()`: DOM adapter.
- `animationDurationSeconds`, `clampTime`, `timeToTimelineX`, `timelineXToTime`, `generateRulerTicks`, `RulerTick`: pure timeline logic.
- `AnimationEditorSceneOptions`, `ReadonlyAnimation`: editor configuration and immutable data views.

These APIs live under `src/devtools/animation-editor/`; the production package exports and external JSON schemas are unchanged.

## Moving keyframes

Drag one diamond horizontally to move its authored time on its existing bone/property lane. Vertical pointer motion never changes tracks. The marker and sole playhead follow a provisional time; preview and inspector evaluate the unchanged working animation at that time until release. Release commits the move once, selects the new canonical key time, and immediately refreshes markers, keyed indicators and the runtime evaluator. Playback pauses at pointer down and remains paused after release or cancellation. A click without movement only selects; a 3px movement threshold prevents accidental retiming.

**Snap → None** (default) keeps continuous seconds. **Snap → Frame** rounds to the nearest frame with `Math.round(time * fps) / fps`, using stepped clips' authored FPS and a shared 10 FPS fallback for smooth clips or unavailable/invalid FPS. Both endpoints remain reachable even when duration is off-frame. Snapping never retimes the rest of the clip or enters history. Hold **Shift** during dragging to bypass snapping. Selected-key **Left/Right** nudges by one snapped frame or 0.01 seconds with snapping off; **Shift+Arrow** uses ten steps. These shortcuts ignore typing fields, consumed events, composition and Ctrl/Cmd/Alt combinations.

Destinations clamp to `[0, duration]`. Moving onto an existing key on the same bone/property replaces its value with the moving key's value. Matching uses the shared nanosecond tolerance and nearest-row tie rule; a collision keeps the destination's canonical authored time. All other matching destination samples for that property are removed, preventing duplicates. Other properties in either sparse row retain their times/values; empty rows are removed and the bone's rows remain sorted. Interpolation is clip-level in the current schema and is preserved, along with events/playback settings and other bone tracks.

The original authored snapshot stays untouched during dragging. **Escape**, pointer cancellation, lost capture, focus loss, page hiding, navigation, selection, track collapse, settings edits, history restoration and rebinding cancel provisional movement. Cancellation returns the clock to the original key time, keeps playback paused and preserves authored data, dirty state, history and redo. An unchanged gesture or endpoint nudge adds no history entry. A committed drag or changed nudge records one immutable `SnapshotHistory` entry; Undo/Redo restores exact prior/result snapshots, including collision replacement. Selection remains transient under the existing history policy: history validates it and clears a time that no longer exists rather than restoring past navigation.

`TimelineController` owns pointer capture on the stable timeline container and measures its current client rectangle for every pointer conversion. Scrolling and resizing during a drag re-evaluate that rectangle. `TimelineTracksController` only positions the provisional selected marker with the existing `timeToTimelineX()` helper. No extra clock, animation copy, DOM-owned data mutation, world-space or IK baking is introduced.

## Keyframe authoring core

v0.5.2.3.1 adds pure data operations in `keyframes.ts` and commands/queries on `AnimationEditorState`. v0.5.2.3.2 connects these existing APIs to the visual inspector without changing their signatures. v0.5.2.3.3 hardens cancellation boundaries, integrates keyboard history and expands regression verification. v0.5.2.4.1 adds bone/property timeline tracks and transient track navigation. v0.5.2.4.2 adds authored markers, single-key selection, selected deletion and previous/next navigation. v0.5.2.4.3 adds time movement, provisional dragging, snapping, keyboard nudges and timeline hardening. v0.5.2.5.1 adds selection sets, primary context, additive/range/marquee selection and atomic multi-delete. Package version: `0.5.2-5.1`.

The existing file format remains authoritative: `tracks[boneId]` holds a strictly time-sorted array of sparse `{ time, x?, y?, rotation?, scaleX?, scaleY? }` rows. Time is milliseconds, rotation is radians, and values are absolute local transforms. Each property has its own independent samples even when several properties share a row. Setting rotation never authors position or scale implicitly.

Pure mutation signatures are:

```ts
setBonePropertyKeyframe(animation, rig, boneId, property, timeMs, value)
removeBonePropertyKeyframe(animation, rig, boneId, property, timeMs)
moveBonePropertyKeyframe(animation, rig, boneId, property, fromTimeMs, toTimeMs)
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
- [ ] Click near start, middle, and end of the ruler; continuously drag and release outside both timeline edges; confirm time clamps and stops changing on release.
- [ ] Scrub a visible walk pose and restart; confirm the preview changes immediately while paused.
- [ ] Play, pause, resume, and restart both while playing and paused; confirm time, playhead, and artwork stay synchronized.
- [ ] Confirm playback stops at duration and holds the final pose with Loop preview off; Play at the endpoint starts again at zero.
- [ ] Enable Loop preview, observe repeated wrapping, disable it, and confirm playback stops at the final pose.
- [ ] Drag while playing: confirm time and artwork hold until pointer movement, then resume on release. Drag while paused and confirm it remains paused.
- [ ] Switch animation while playing or dragging; confirm the old pointer is released, playback pauses, time resets, and the new pose appears.
- [ ] Confirm loop toggles, empty-lane scrubbing, and repeated wrapping keep **No unsaved changes**. Unit tests cover overshoot, very large finite deltas, and rejected zero-duration data.
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

The v0.5.2.3.3 stabilization report and command results are recorded in [History and regression verification](animation-editor-history-verification.md).

The v0.5.2.4.1 implementation, track architecture, APIs and verification results are recorded in [Timeline track verification](animation-editor-tracks-verification.md).

The v0.5.2.4.2 marker/selection architecture, deletion behavior, APIs and verification results are recorded in [Keyframe marker verification](animation-editor-keyframe-markers-verification.md).

The v0.5.2.4.3 movement architecture and verification results are recorded in [Keyframe movement verification](animation-editor-keyframe-movement-verification.md).

## Deferred features

Event tracks, transform drag handles, copy/paste, duplication, keyframe groups, auto-key, per-keyframe interpolation UI, event authoring, animation import UI, onion skinning, mirrored keyframes, ghost poses, and IK target authoring/baking remain deferred to v0.5.2.5.2+. Property create/update/delete remains available through the inspector and data APIs above.

The v0.5.2.5.1 selection policies, APIs, files and verification results are recorded in [Multi-key selection verification](animation-editor-multi-selection-verification.md).
