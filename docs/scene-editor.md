# Scene Editor: visual authoring, packages and playback (v0.9.7.3)

[Creating Your First Cinematic Scene](creating-your-first-cinematic-scene.md) · [Scene backgrounds and image assets](scene-artwork.md) · [All guides](../README.md#guides) · [Making Your First Scene](making-your-first-scene.md) · [v0.9 readiness report](scene-editor-readiness.md)

Open **Scene Editor** in the application navigation, or visit `/scene-editor/`. Use **New Scene** to choose a stable scene ID, name and duration. No character or scene JSON is required. Expand **Scene properties**, edit the name or duration in seconds, and click **Apply properties**. Inspector sections start collapsed. Scene IDs remain fixed after creation/import.

The inspector uses **Scene**, **Actors**, **Camera**, **Artwork**, **Dialogue**, **Audio** and **Transitions** tabs. **Scene** opens initially; **Actors** contains the actor list, actor/action properties, ground guide and runtime preview. **Artwork** contains image and layer controls. Tabs wrap to fit the inspector width and support Left/Right, Home and End keys. Switching tabs preserves unfinished fields and disclosure state; the collapse button hides the current group. Stage/timeline selections and Feature Guides reveal the relevant group without changing scene history. Sections remain collapsed until opened.

**Open scene JSON** imports a document; the scene picker switches among open documents without losing changes or Undo/Redo history. Each document has its own immutable source, working snapshot, saved checkpoint and bounded history. New documents start **New / Unsaved**, even if their initial values have not changed. [Local autosave and crash recovery](local-autosave.md) retain complete browser drafts, including retained scenes and their character dependencies; recovery opens a detached Project Workspace copy. Download scenes or export a project ZIP for portable disk copies. The browser guards refresh, closing and navigation if any open document is unsaved, including inactive scenes. Navigating to the character editors uses their existing guarded page navigation.

**Download scene JSON** validates and serializes authored data and marks the captured snapshot saved. Later edits remain dirty. **Revert** restores the original created/imported source with confirmation when dirty; it is undoable and does not replace the saved download checkpoint. Opening another document preserves drafts. Opening a document with the same ID replaces its source/history, with confirmation if that document is dirty, including when inactive. Invalid or canceled operations retain current data and history.

## Visual stage

Scenes accept at most 256 Actors and 10,000 actions. Loaded characters must stay within 32,768 instantiated bones and 32,768 instantiated slots per scene context, counting repeated Actors separately. Scene artwork also has aggregate limits of 100 MiB transferred bytes and 128 megapixels, alongside the existing per-character limits. Texture aliases count separately when they allocate separate textures. These limits apply before runtime construction or image decoding; smaller compressed JSON/ZIP sizes do not bypass allocation limits.

Expand **Scene ground** to show an optional horizontal guide, enter scene-world **Ground Y**, drag the amber **↕ Ground** label, or reset Y to zero. Settings are saved in this browser per scene ID and survive reopening/importing that scene; they are excluded from scene JSON/ZIPs. Guide Undo/Redo is separate from scene history. Moving the guide never moves Actors or changes actions. The guide follows camera zoom/pan and remains available during playback and scrubbing. See the [ground reference architecture](ground-reference.md).

With an Actor selected, **Show selected Actor contacts** optionally displays that Actor's rig markers, including during playback/scrubbing. Choose **Actor foot contact marker**, stop playback, then **Snap Actor to Ground** changes only initial Y so the selected evaluated marker rests on the guide, preserving X in one scene Undo/Redo entry. Placement includes FK/IK, bone transforms, facing and Puppet scale. No marker is selected automatically. Marker selection is temporary view state: choose it again after scene import/switch or Actor/character replacement. Feature Guide → Grounding Characters walks through this workflow. For characters without rig markers, **Align Feet to Ground** retains the labeled legacy fallback using the lowest authored sole point in active foot attachments (`groundContacts`); both shipped characters include these attachment points. Without a usable legacy point, alignment is disabled. **Snap to Ground** placement drags use the same selected marker or legacy fallback; hold **Shift** to move freely for jumping, flying or elevated Actors. Hiding the guide disables drag snapping. Ground changes never rewrite movement destinations, animations, rigs or keyframes; existing choreography remains authoritative. See the [contact grounding workflow and calculations](foot-contact-ground-integration.md).

Open **Scene actors** in the inspector, click **+ Add Actor**, choose a character from the same workspace catalog used by the character editors, and click **Add actor**. You can also enter a stable manifest path or HTTP(S) URL for any compatible package. The editor loads it with `CharacterLoader`; it does not rely on demo animation names, bone IDs or presentation profiles. Browser-only new-character identities have no permanent manifest yet; export and host their package before referencing them in a scene. Paths are resolved from the Scene Editor page during preview and from the hosted scene JSON location in the runtime. Keep that base location consistent or use permanent absolute URLs.

Expand **Scene actors** to select, duplicate, remove, or change preview depth with **Send backward** / **Bring forward**. Later actor-array entries draw in front. Each instance gets a scene-local ID independent of its character definition and animation names. Duplicate creates a separate instance offset by 32 stage units and does not copy scheduled actions. Renaming an actor updates its action references atomically. Removing an actor with actions asks explicitly whether to remove those actions too; cancellation preserves everything. Both operations are undoable.

Click an actor's artwork or origin handle to select and drag it. The colored X/Y handles constrain a move to one axis. **Actor properties** provides ID/name, read-only character manifest reference, numeric initial X/Y, facing and supported animation/skin choices. Inspector sections start collapsed. Animation selection samples its first pose without advancing a scene clock; choosing **Bind pose** restores the rig's bind pose. Facing and skin use existing runtime APIs. Character defaults remain implicit until you choose an override.

Coordinates are stage/world units: (0,0) starts at the viewport center, X increases rightward and Y downward. Canvas FIT scaling, camera zoom and camera scroll are converted before calculating drag offsets. Mouse wheel zooms around the pointer. Middle/right/Alt-drag pans; **Reset view** returns to the initial camera. The optional 32-unit grid, navigation camera and selection are editor-only. The separate [Cinematic Camera](cinematic-camera.md) defines the saved audience frame. One complete drag is one history entry. Escape, pointer cancellation or window blur restores the pre-drag snapshot without consuming history or losing Redo. Switching scenes also cancels unfinished moves.

## Action timeline

The timeline shares the Animation Editor's compact, collapsible tabs: **Actions**, **Camera**, **Transitions**, **Dialogue**, **Audio** and **View**. Tool panels start collapsed to maximize track space. Playback, status and the numeric playhead stay beside the tabs. Select a tab to open its controls; the chevron collapses them again. Arrow keys, Home and End navigate tabs. Switching or collapsing tabs retains settings and drafts, and Feature Guides reveal the appropriate tab automatically. **View** contains Zoom, Snap, playback speed and a collapsed Timeline help section; **Audio** contains track/clip creation, mute and preview audio status.

Every Actor has a track, even before it has actions. Click its track label, open **Actions**, choose an **Action type**, position the playhead using the ruler or its numeric field, then click **Add action**. Animation choices come from that Actor's loaded character. Clips occupy separate animation, movement and metadata lanes. Click a clip/marker to select it; expand **Action properties** to edit supported values. Inspector sections start collapsed, including when selecting another action.

Drag a clip to move it; drag its right edge to resize timed actions. **Zoom** increases horizontal detail; scroll the timeline horizontally to pan. **Snap** uses the Animation Editor's nearest-target policy: clip edges/markers, playhead and the 10 fps authoring grid, within eight screen pixels. Alt bypasses snapping. Numeric fields retain exact precision. Start/end bounds are enforced. Invalid edits retain the previous snapshot and report an error; releasing a drag on an invalid position cancels the gesture. Escape, capture loss, window blur and scene changes cancel unfinished gestures. One completed drag makes one Undo entry.

Use **Duplicate at (seconds)** and **Duplicate action** to copy with a new stable ID at an explicit time; conflicting copies reject without moving existing actions. **Delete action**, or Delete/Backspace while tracks are focused, removes the selection. Undo/Redo and downloads include all action edits. Editing a timeline action resets the preview to initial Actor placement; use Play or scrubbing to see scheduled transforms. Selecting a movement clip draws a read-only green destination crosshair; edit **Destination X/Y** in the inspector to change the future position.

### Timing and ownership

All authored times/durations are milliseconds; the UI displays seconds. Each action has `id`, `actorId`, `time` and a discriminating `type`. IDs are unique within the scene and never regenerated by moves or serialization. Clips require positive, finite duration and must end within the scene; markers may lie exactly at the scene end.

| Type        | Parameters and meaning                                                                                                                                                                                                                                     | Ownership                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `animation` | `animation` ID, explicit `duration`, `loop` boolean, positive `speed` multiplier. The finite window truncates longer playback. With `loop: false`, play once then hold the final pose for the remainder; with `loop: true`, repeat only within the window. | Base animation for `[time, time + duration)`. No implicit crossfade. |
| `move`      | `destination: {x, y}`, positive `duration`. Straight-line travel over that duration from the Actor's position at the action start.                                                                                                                         | Position only for the half-open interval.                            |
| `face`      | `target` is `{type: 'direction', facing: 'left'}` (or `'right'`), `{type: 'actor', actorId}`, or `{type: 'point', x, y}`. Uses horizontal facing; zero horizontal displacement preserves facing.                                                           | Instant marker; equal-time facing changes for one Actor reject.      |
| `wait`      | Positive `duration`; hold/scheduling annotation. It does not freeze or override concurrent channels.                                                                                                                                                       | None.                                                                |
| `cue`       | Nonempty `name`, optional JSON `payload`. Metadata/signals for application code, separate from animation-authored events. No built-in sound/dialogue/combat behavior.                                                                                      | None.                                                                |

Movement uses explicit duration rather than storing both speed and duration. The runtime Actor adapter computes travel speed as `worldDistance / (duration / 1000)` in world units per second; stationary movement is a timed hold. Sequential movements begin at the preceding destination; gaps retain position. Movement does not choose locomotion animations or change facing, so animation and facing actions may coexist with it. Parent transforms are included when calculating world distance. There is no pathfinding.

Two overlapping movement clips, or two overlapping base-animation clips, for one Actor reject regardless of array order. Adjacent clips are valid. Different Actors act concurrently. Waits/cues are metadata and may overlap any channel. Facing markers are instantaneous signals, not sustained tracking. The scene runner enforces these validated channel policies during playback and seeking.

## Playback and scrubbing

**Play** advances all Actors using Phaser's millisecond update delta. **Pause** freezes scene time, movement and animation together. **Restart** cancels the previous context and plays from zero; **Stop** restores the authored initial snapshot before time-zero actions and re-enables placement dragging. Playback speed scales the single shared scene clock. Completion holds final transforms and poses; Play from completion starts a fresh run.

The ruler and numeric **Playhead (s)** field seek and pause, including while playing. Focusing the numeric field pauses before editing so clock updates cannot overwrite typed input. Seeking creates fresh Actor/Puppet instances from immutable initial data, then runs the same validated declarations up to the requested time. Updates split at every action start/end, including when a frame crosses several commands. End ownership releases before adjacent clips start; equal-time starts follow authored array order. There are no browser execution timers or asynchronous Promise barriers in the scheduler. Wait actions annotate an absolute interval; they do not delay unrelated declarations.

Expand **Runtime preview** and select an Actor track to inspect its current position, facing, animation and clip time. Initial X/Y and appearance fields continue to describe authored data. Placement dragging is available after Stop; camera pan/zoom remain available during playback. Selection preserves playback. Actor/action edits, their Undo/Redo and scene switches cancel the old context and restore initial placement; camera, artwork and layer edits preserve the current Actors and playhead.

Animation actions restart the existing base clip with their authored loop and speed overrides, with no implicit crossfade. A finite clip that completes before its window ends holds its terminal pose; a looping or longer clip stops at its window end and holds that pose until another animation action replaces it. Movement uses `Actor.moveTo` independently of animation; author a simultaneous walk clip when desired. Facing uses `Actor.setFacing` / `lookAt` at the scheduled time after all Actors reach that time. Initial animations use their ordinary clip settings. Scene completion stops remaining playback and settles runtime waits. Actor destruction/disposal, movement replacement/cancellation, and owned animation interruption halt future scheduling. Cleanup cancels only matching owned movement/playback IDs and preserves newer external commands. Old movement Promise continuations cannot affect a rebuilt context.

Seeking suppresses named cues, authored animation events (including time zero and loop crossings) and legacy animation-completion callbacks. Playback retains runtime event ordering and completion semantics; resuming after seek delivers only future events/cues. Lifecycle settlement remains active so cancellation and disposal never strand waits. A seek discards previous instances, so runtime instance IDs and references are temporary. Shared character definitions, compiled clips and textures remain immutable and reusable. Playback and seeking create no scene commands, saved checkpoints, Undo entries or animation-file edits.

### Runtime adapter

`SceneRunner` is exported from the root and `/runtime` entries. Construct it with scene data and `createActor(data, depth)`, returning a fresh `Actor` with matching ID, an owned Puppet and `autoUpdate: false`. The runner validates/snapshots input and applies initial position, facing, optional skin/animation; the factory supplies the character's default skin and rendering depth. It owns and disposes these instances. Call `update(deltaMilliseconds)` once from the host Phaser update. Controls are `play`, `pause`, `restart`, `stop`, `seek`, `cancel`, `dispose` and `speed`; observations are `time`, `status`, `error` and the read-only `actors` map. `onCue` receives a detached named cue with actor/action IDs, exact scene time and optional payload during playback only.

Supported seek input is the five declarative scene action types. Unknown action kinds, functions and conflicting channel ownership reject explicitly; missing animation assets report their action ID before any scene cue executes. Stateful choreography scripts, gameplay lifecycle/update listeners, animation state policies, queued commands and procedural IK target providers are unsupported in the isolated factory contract. Do not attach them and expect arbitrary-time reconstruction. Authored animation/IK tracks use the existing runtime evaluator and solver. `AnimationPlayer.setPreviewMode(true)` suppresses authored/legacy gameplay notifications during reconstruction while retaining lifecycle outcomes; it is not a sandbox for arbitrary host callbacks. `Actor.movementStatus` exposes synchronous request identity/outcome so scheduling detects interruption before Promise continuation timing can advance obsolete actions.

### Two-character encounter

Import the shipped [encounter scene](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/public/scenes/encounter.scene.json) into Scene Editor. Its companion manifest reuses the demo rig/artwork and adds ordinary bow/response clips without changing the demo character's animations. Actors start apart, walk toward the center from 0.5 to 2.5 s, face each other, Actor A bows from 2.7 to 4.1 s, then Actor B responds from 4.3 to 5.7 s. Scene duration is 6.5 s.

Seek to 0.25 s (before movement), 1.5 s (mid-walk), 2.5 s (arrival), 3.4 s (bow), 5 s (response), and back to 1.5 s. A's X is -280, -195 and -110 before/during/after movement; B's X is 280, 195 and 110. Both remain at Y=120. Compare forward/backward seeks, pause/resume, restart during playback, and Stop. Download before/after to verify identical authored scene JSON.

## Authored contract

`SceneDefinition` is JSON data, independent of React, Phaser and live Actor/Puppet instances. Example:

```json
{
  "version": 2,
  "id": "opening",
  "name": "Opening scene",
  "duration": 10000,
  "actors": [
    {
      "id": "hero",
      "character": { "manifest": "../characters/demo-puppet/character.json" },
      "position": { "x": 120, "y": 300 },
      "facing": "right",
      "animation": "idle",
      "skin": "default"
    }
  ],
  "actions": [
    { "id": "walk-1", "type": "animation", "actorId": "hero", "time": 0, "animation": "walk", "duration": 2500, "loop": true, "speed": 1 },
    { "id": "move-1", "type": "move", "actorId": "hero", "time": 0, "destination": { "x": 420, "y": 300 }, "duration": 2500 },
    { "id": "face-1", "type": "face", "actorId": "hero", "time": 2500, "target": { "type": "direction", "facing": "left" } },
    { "id": "cue-1", "type": "cue", "actorId": "hero", "time": 2500, "name": "arrived", "payload": { "location": "door" } }
  ]
}
```

Times and duration are **milliseconds**, matching the existing Actor, animation and choreography APIs. Position is in stage/scene coordinates, with finite X/Y values. Facing uses the existing left/right convention. Actor IDs are stable, scene-local authored strings; multiple actors may reference the same character. Array order and authored numeric precision survive round trips. Actions may share times across compatible channels and need not be sorted; cue metadata retains authored array order for ties. Duration is finite and strictly positive; action times include both endpoints, from zero through duration.

Character references are stable manifest JSON paths resolved relative to the saved scene document, or permanent HTTP(S) URLs without query/fragment. Moving a scene file may require adjusting its relative references. JSON contains no embedded character definitions, texture URLs, functions, promises, runtime instances, selection, zoom or history. Strict schemas reject unknown fields and the existing JSON guard rejects non-JSON data before getters or schema reads. Existing character package formats, Actor and Puppet remain unchanged.

## APIs and boundaries

The renderer-independent `/core` and `/serialization` entries export:

- `SCENE_FORMAT_VERSION`, `SceneValidationError` and the scene, actor, action and character-reference Zod schemas.
- `createEmptyScene({ id, name?, duration? })` with a default 10,000 ms duration.
- `validateSceneDefinition(input, options?)`, returning shared field-path validation issues.
- `parseSceneDefinition(input, options?)`, returning detached authored data and retaining the existing `UnsupportedFormatVersionError` contract.
- `parseSceneJson(text, options?)`, with the shared 10 MiB input bound.
- `serializeSceneDefinition(input, options?)`, producing deterministic, sorted-key JSON with a trailing newline and the shared size bound.

`/data` also exports `SceneDefinition`, `SceneActorDefinition`, `SceneActionDefinition`, `SceneCharacterReference`, `SceneCharacterAssets` and `SceneValidationOptions` as types. The action discriminated union contains `animation`, `move`, `face`, `wait` and `cue`. `sceneActionDuration(action)` returns timed clip duration or zero for markers.

Without an asset catalog, validation checks reference syntax, actor ID uniqueness, document IDs, finite values, supported actions, action times and actor references. It performs no network I/O. Hosts can supply `characters: ReadonlyMap<string, SceneCharacterAssets>`, keyed by the exact authored manifest reference; values contain `animations` and `skins` name arrays. Then missing characters, starting animations/skins and scheduled animation names are also rejected. The workspace validates structure and conflicts atomically, restricts the animation picker to the owning character, and checks animation references against loaded character metadata on edits and exports. Unloaded references remain structurally valid until metadata is available; supply a complete catalog for strict offline asset validation. Asset-loading and unsupported initial-property errors appear in the stage. Hosts may still supply an asset catalog for strict offline document validation.

`src/devtools/scene-editor/SceneEditorDocument.ts` owns scene documents, actor selection, validated commands and drag transactions through the existing `SnapshotHistory`. React subscribes through `useSyncExternalStore`; `SceneActorsPanel` owns dialog/form state and ignores stale asynchronous Add completions after cancellation or scene changes. `SceneStageView` creates one Phaser game in a layout effect using the shared `createEditorGame` and `observePreview` conventions. React updates reconcile instances without rebuilding the game.

`SceneCharacterRegistry` caches immutable metadata and concurrent requests, and aborts metadata loads on page teardown. `SceneStage` serializes artwork loads through `loadSceneCharacter`, which uses the existing texture queue, validation and shutdown cancellation. `SceneActorPreview` creates one owned `Actor`/`Puppet` pair per scene actor and applies position, facing, skin and initial pose through the existing runtime. Actors referencing one definition share immutable rig/compiled clips and textures while retaining separate pose buffers and playback state. It disposes removed/replaced actors immediately and all instances when switching scenes or shutting down. Texture ownership belongs to the game: shared artwork remains cached across removal/Undo and scene switches and is released by game destruction, never by an individual actor. Runtime texture-key conflicts are reported using the loader's existing contract.

`stageCoordinates.ts` converts DOM coordinates through Phaser's camera and computes offset-preserving, optionally axis-constrained positions. Existing camera pan/zoom utilities are reused. Drag coordinates use the editors' six-decimal rounding; numeric inspector values retain authored precision. No engine module imports React or editor code, and no character rig, source package or animation track is modified by actor placement. Scene data/schema is now version 2. Version-1 scene documents reject with the existing unsupported-version error, rather than guessing ownership or the duration of an infinite loop. To migrate a scene, set `version: 2`, assign a unique `id` to every action, add explicit `duration`, `loop` and `speed` to animation actions, and replace face `facing` with `target: {type: 'direction', facing}`. Choose finite animation windows explicitly and resolve ownership conflicts before import. Character/rig/animation formats remain version 1.

`SceneTimeline.tsx` owns session-only zoom, pointer capture and drag presentation; `SceneEditorPlayback` owns the shared runtime playhead. `timelineActions.ts` builds Actor tracks and adapts clip edges to the existing Animation Editor `resolveTimelineSnap`; ruler and time coordinates reuse `timeline.ts`. Animation-specific keyframe selection stays in that editor; scene selection uses stable action IDs in `SceneEditorDocument`, with no duplicated keyframe architecture. `SceneActionInspector.tsx` applies complete validated action updates, keeping draft form state separate from authored snapshots. The document uses the existing `SnapshotHistory` begin/end/cancel transactions for timeline and stage gestures.

## Verification

Unit regressions cover empty creation, valid/invalid documents, non-JSON rejection, versions, stable actor IDs, optional asset catalogs, deterministic round trips, immutable source/working isolation, history, saved checkpoints, switching, guarded replacement and character-data preservation. Local desktop Playwright coverage exercises creation, property edits, switching, Undo/Redo, downloads, inactive-document unload protection, imports, canceled replacements, revert, and navigation from Project Workspace. Browser tests remain local-only.

Required commands:

```bash
npm run typecheck
npm run test
npm run build
```

Additional local checks:

```bash
npm run check
npm run check:version
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneEditor.spec.ts
```

Deferred at v0.9.2: camera direction, dialogue, branching, physics, pathfinding and automatic scene draft recovery. Initial cinematic framing and recovery have since been added; see the linked current guides.

### v0.9.2 verification

Placement unit tests cover Add, duplicate/remove/reorder, action-reference safety, unique IDs, drag history/cancellation, independent scene histories, FIT/zoom/pan coordinate conversion, facing, skins, animation pose restoration, two instances of one arbitrary character definition, source isolation, registry cancellation, instance disposal and retained shared textures. Local desktop browser coverage extends the document workflow with two visible actors, initial properties, drag, Escape, Undo/Redo, duplicate/remove and scene switching without repeated character requests.

Verified locally on 2026-10-18:

| Command                                                                                                                       | Result                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                           | Exit 0                                                                      |
| `npm run test`                                                                                                                | Exit 0; 179 files passed, 5 skipped; 3,134 tests passed, 56 skipped         |
| `npm run build`                                                                                                               | Exit 0; demo and library built; Node entry-point checks passed              |
| `npm run check`                                                                                                               | Exit 0; formatting, lint and typecheck passed                               |
| `npm run check:version`                                                                                                       | Exit 0; v0.9.2 package, lockfiles, standalone reference and changelog agree |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneEditor.spec.ts -g 'visual actor placement' --timeout=90000` | Exit 0; both development and production placement workflows passed          |

The six existing document/navigation/desktop scenarios also passed across development and production. Placement assertions allow fractional-canvas-pixel tolerance while checking exact Undo/Redo and Escape restoration.

Builds retain the existing non-failing Lucide module-directive warnings. Browser checks remain local-only, and no browser/dependency-audit CI configuration changed.

### Changed files

- `SceneEditorDocument.ts`: actor commands, selection, action-reference safety, preview order and drag transactions.
- `SceneEditorView.tsx`, `SceneActorsPanel.tsx`, `main.tsx`, `style.css`: React workspace, collapsed inspectors, package picker and stage mount.
- `SceneStage.tsx`, `stageCoordinates.ts`: Phaser canvas lifetime, camera/grid, selection, pointer capture and world-coordinate translation handles.
- `SceneCharacterRegistry.ts`, `SceneActorPreview.ts`: cached metadata/artwork loading and independent owned Actor/Puppet previews.
- `tests/sceneActorPlacement.test.ts`, `tests/browser/sceneEditor.spec.ts`: placement, lifecycle, isolation, coordinate and desktop workflow regressions.
- `docs/development.md`, this guide, `CHANGELOG.md`, package/standalone manifests and lockfiles: architecture and v0.9.2 release metadata.

### v0.9.3 verification

`tests/sceneTimeline.test.ts` covers track creation, add/move/resize/delete/duplicate, Actor concurrency, explicit looping windows, movement bounds, snap behavior, ownership conflicts, facing target reference updates, grouped Undo/Redo, cancellation, serialization, JSON payload isolation and loaded animation references. Existing scene data/document/placement tests now use version-2 action fixtures. `tests/browser/sceneEditor.spec.ts` includes the local desktop timeline workflow. No CI browser installation or smoke tests are added.

Verified locally on 2026-10-18:

- `npm run typecheck`, `npm run check`, `npm run check:version` and `npm run build`: passed. Demo/library builds and renderer-independent Node entry-point checks passed; existing Lucide module-directive warnings remain non-failing.
- `npm run test`: 180 files passed, 5 skipped; 3,146 tests passed, 56 skipped. The final scene version/timeline regression rerun also passed (48 tests).
- Existing document, placement and desktop browser workflows: eight passed across development and production. The new timeline workflow passed in both environments with `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneEditor.spec.ts -g 'visual scene timeline' --timeout=60000` after correcting its dropdown selectors.

Changed files for this milestone: `engine/SceneDefinition.ts` and public value exports; generated `schemas/scene.schema.json`; `SceneEditorDocument.ts`; new `SceneTimeline.tsx`, `timelineActions.ts` and `SceneActionInspector.tsx`; scene workspace/stage/bootstrap/styles; scene unit/browser tests; scene/schema/development guides, changelog and v0.9.3 package/standalone metadata. No scene playback engine or CI browser workflow was added.

### v0.9.4 verification

Verified locally on 2026-10-19:

- `npm run typecheck`, `npm run check`, `npm run check:version` and `npm run build`: passed. Demo/library builds and renderer-independent Node entry checks passed; existing non-failing Lucide module-directive warnings remain.
- `npm run test`: 181 files passed, 5 skipped; 3,173 tests passed, 56 skipped. The 27 new runtime/controller regressions cover deterministic stepping, scheduling, concurrent movement, animation speeds/loops/completion, facing, forward/backward seeking, reconstruction from different previous states, event/cue suppression, unchanged documents/history/character clips, cancellation/disposal, reentrant controls and newer-owner preservation.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneEditor.spec.ts --timeout=90000`: 14 passed across development and production, including existing authoring/layout/history regressions and the encounter. The final encounter rerun also exercises complete playback at 2x speed against the final runtime build.

The real encounter character is loaded through `CharacterLoader` in unit and browser verification. Before/during/after movement positions, the bow/response animation selections, pause/resume, restart, backward seek, completion and identical downloaded scene JSON are checked. The rendered bow was also inspected in a desktop screenshot. Numeric playhead focus pauses the clock before text editing. Browser checks remain local-only; no CI browser installation or dependency-audit configuration changed.

## Scene transfer and dependency validation

**Validate Scene**, **Copy Scene JSON** and **Download scene JSON** use the canonical `serializeSceneDefinition` serializer. Object keys are sorted, arrays preserve authored order, exact numeric values are retained, and output is indented JSON ending in a newline. The scene format stays at version 2; unsupported versions and unknown fields are rejected. Zoom, selection, layouts, preview handles and history never enter exported data. Safe, bounded filenames derive from the scene ID. Clipboard export requires browser clipboard access; a denied copy reports an error and leaves the document unchanged.

**Paste scene JSON** and **Open scene JSON** parse bounded JSON and load every referenced character's metadata before registering a fresh immutable working copy. Character, skin and starting/scheduled animation references must resolve. A successful replacement resets selection, history and playback to the initial scene. Dirty replacements require the existing discard confirmation. Failed or cancelled imports retain the current scene, playback source, selections and history. Copies do not checkpoint a document; successful downloads checkpoint the captured snapshot, so edits made during dependency loading remain dirty.

Character manifests are stable relative JSON references or permanent HTTP(S) URLs. For editor file/paste imports, relative references resolve from the editor page URL, since the browser cannot infer a selected local file's original hosting directory. For runtime JSON, references resolve from the scene JSON URL. Save JSON beside the corresponding hosted paths, adjust references explicitly, or use a scene ZIP for portability. Leading `../` paths remain supported for the shipped shared assets; encoded aliases, internal traversal, absolute asset paths, credentials, temporary URLs, queries and fragments are rejected. Hosted character metadata/artwork stays on its manifest's origin. A custom host cache is responsible for loading complete definitions; its authored paths are still checked.

**Download scene package** collects only referenced character packages, deduplicates repeated character references and image aliases, and writes this existing character layout into the existing stored ZIP format:

```text
scene.json
characters/character-1/character.json
characters/character-1/rig.json
characters/character-1/animations/...
characters/character-1/skins/...
characters/character-1/images/...
```

Shared hosted files outside a character folder are rebased under its `shared/` directory. Each character manifest and scene reference is rewritten in a detached package copy; working scenes and source characters are unchanged. Distinct character packages retain their own asset trees. Every archived character path is confined to its folder, and archive loading has no network fallback. Metadata, image presence/headers/dimensions, static frame support and existing ZIP limits are checked before download. Browser runtime image decoding uses the existing guarded artwork loader. Limits remain 256 files, 10 MiB per file and 100 MiB per archive, plus existing per-character image budgets and a 64-character dependency limit. ZIP encoding has no added dependency.

Downloads create browser files; they do not modify repository files. Extract a scene ZIP for ordinary web hosting or pass its bytes to the runtime adapter. The editor imports scene JSON; the standalone runtime also accepts scene ZIPs.

## Runtime scene loading

Pure `/core` and `/serialization` exports include `resolveSceneDefinition`, `sceneAssetCatalog`, `buildScenePackage`, `validateScenePackage`, `encodePackageZip` and `decodePackageZip`. Dependency resolution returns an immutable scene snapshot and a map of complete `CharacterDefinition` values keyed by authored manifest references. These APIs do not import Phaser or React.

The optional `/runtime` adapter constructs exclusively owned Actors using `autoUpdate: false` Puppets and the existing `SceneRunner`:

```ts
import { SceneLoader, type LoadedScene } from 'paper-puppeteer-engine/runtime';

// In a host Phaser scene; keep this lease on the host instance.
const loaded: LoadedScene = await SceneLoader.load(scene, sceneJsonUrl, {
  signal: abortController.signal,
  onCue: (cue) => console.log(cue.name),
});
loaded.runner.play();
// From the host's update(_time, delta), once per frame:
loaded.runner.update(delta);
// On replacement or when finished:
loaded.dispose();
```

`SceneLoader.fromDefinition` accepts an unknown authored value with a `baseUrl`; `SceneLoader.loadPackage` accepts a hosted ZIP URL, ZIP bytes or decoded file map. All variants preflight dependencies before constructing Actors and cancel on host shutdown or an external abort signal. The host owns the update clock. Seeks use existing reconstruction behavior and suppress cues/gameplay events. A ZIP lease owns isolated runtime texture aliases, temporary image URLs and its private textures, and releases them on disposal. Ordinary hosted character textures stay shared and host-owned. Puppet and Actor remain usable independently.

See the [runtime integration guide](runtime-integration.md#project-and-scene-handoff) for loading authored scenes in your own Phaser application. `tests/scenePackaging.test.ts` and `tests/sceneLoader.test.ts` cover stable JSON/ZIP output, round trips, failures, source/working-copy isolation, playback/seek equivalence, cancellation and artwork cleanup. Desktop browser checks remain local-only.

## v0.9 production hardening

Start with [Making Your First Scene](making-your-first-scene.md) for the complete visual workflow and the standalone ZIP handoff. The [v0.9 readiness report](scene-editor-readiness.md) records architecture, current verification, measured performance and deliberate limits. Scene Editor now offers thirty Explain tours through the existing Feature Guide registry and spotlight. They never modify authored data or history.

Playback subscriptions are confined to clock controls, the playhead and an expanded runtime inspector. Authored clip rows no longer rebuild on every Phaser frame. Initial-placement animation sampling suppresses gameplay events and uses explicit hard cuts. Teardown clears ownership and attempts all Actor cleanup even when a callback fails. Runtime scene windows remain hard cuts, and scene/character format versions remain 2/1.

See [visual layers, depth and parallax](scene-layers.md) for foreground/background ordering, the Actors band, layer locks and view-only camera preview.

## Cinematic framing

Use the collapsed **Cinematic Camera** inspector to author a center and zoom independently of editor pan/zoom, frame an Actor, or preview the 1000 × 700 audience view. See the [Cinematic Camera guide](cinematic-camera.md) for coordinate conventions, parallax, persistence and runtime camera application.

## Dialogue and subtitle authoring

The **Dialogue** timeline track and collapsed **Dialogue line** inspector support multiline plain text, scene-local Actor speakers, optional labels and voice-clip metadata, timing, duplication, deletion and scene Undo/Redo. Lines use non-overlapping half-open intervals within scene duration. JSON, portable ZIPs and recovery preserve dialogue without changing legacy scene data. See the [dialogue authoring guide](scene-dialogue.md) for the workflow, schema, reference repair and timing rules. Playback and silent seeks display deterministic Phaser subtitles above fades, fixed to the cinematic frame. See the same guide for default/custom standalone presentation and cue/audio semantics.
