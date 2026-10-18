# Scene Editor: visual stage and action timeline (v0.9.3)

[All guides](../README.md#guides)

Open **Scene Editor** in the application navigation, or visit `/scene-editor/`. Use **New Scene** to choose a stable scene ID, name and duration. No character or scene JSON is required. Expand **Scene properties**, edit the name or duration in seconds, and click **Apply properties**. Inspector sections start collapsed. Scene IDs remain fixed after creation/import.

**Open scene JSON** imports a document; the scene picker switches among open documents without losing changes or Undo/Redo history. Each document has its own immutable source, working snapshot, saved checkpoint and bounded history. New documents start **New / Unsaved**, even if their initial values have not changed. Download each scene to keep it after leaving the page. The browser guards refresh, closing and navigation if any open document is unsaved, including inactive scenes. Scene drafts are held in this page's memory; automatic browser draft recovery is deferred. Navigating to the character editors uses their existing guarded page navigation.

**Download scene JSON** validates and serializes authored data and marks the captured snapshot saved. Later edits remain dirty. **Revert** restores the original created/imported source with confirmation when dirty; it is undoable and does not replace the saved download checkpoint. Opening another document preserves drafts. Opening a document with the same ID replaces its source/history, with confirmation if that document is dirty, including when inactive. Invalid or canceled operations retain current data and history.

## Visual stage

Click **+ Add Actor**, choose a character from the same workspace catalog used by the character editors, and click **Add actor**. You can also enter a stable manifest path or HTTP(S) URL for any compatible package. The editor loads it with `CharacterLoader`; it does not rely on demo animation names, bone IDs or presentation profiles. Browser-only new-character identities have no permanent manifest yet; export and host their package before referencing them in a scene. Paths are resolved from the Scene Editor page during preview and from the saved scene location in a future host. Keep that base location consistent or use permanent absolute URLs.

Expand **Scene actors** to select, duplicate, remove, or change preview depth with **Send backward** / **Bring forward**. Later actor-array entries draw in front. Each instance gets a scene-local ID independent of its character definition and animation names. Duplicate creates a separate instance offset by 32 stage units and does not copy scheduled actions. Renaming an actor updates its action references atomically. Removing an actor with actions asks explicitly whether to remove those actions too; cancellation preserves everything. Both operations are undoable.

Click an actor's artwork or origin handle to select and drag it. The colored X/Y handles constrain a move to one axis. **Actor properties** provides ID/name, read-only character manifest reference, numeric initial X/Y, facing and supported animation/skin choices. Inspector sections start collapsed. Animation selection samples its first pose without advancing a scene clock; choosing **Bind pose** restores the rig's bind pose. Facing and skin use existing runtime APIs. Character defaults remain implicit until you choose an override.

Coordinates are stage/world units: (0,0) starts at the viewport center, X increases rightward and Y downward. Canvas FIT scaling, camera zoom and camera scroll are converted before calculating drag offsets. Mouse wheel zooms around the pointer. Middle/right/Alt-drag pans; **Reset view** returns to the initial camera. The optional 32-unit grid, camera and selection are editor-only. One complete drag is one history entry. Escape, pointer cancellation or window blur restores the pre-drag snapshot without consuming history or losing Redo. Switching scenes also cancels unfinished moves.

## Action timeline

Every Actor has a track, even before it has actions. Click its track label, choose an **Action type**, position the playhead using the ruler or its numeric field, then click **Add action**. Animation choices come from that Actor's loaded character. Clips occupy separate animation, movement and metadata lanes. Click a clip/marker to select it; expand **Action properties** to edit supported values. Inspector sections start collapsed, including when selecting another action.

Drag a clip to move it; drag its right edge to resize timed actions. **Zoom** increases horizontal detail; scroll the timeline horizontally to pan. **Snap** uses the Animation Editor's nearest-target policy: clip edges/markers, playhead and the 10 fps authoring grid, within eight screen pixels. Alt bypasses snapping. Numeric fields retain exact precision. Start/end bounds are enforced. Invalid edits retain the previous snapshot and report an error; releasing a drag on an invalid position cancels the gesture. Escape, capture loss, window blur and scene changes cancel unfinished gestures. One completed drag makes one Undo entry.

Use **Duplicate at (seconds)** and **Duplicate action** to copy with a new stable ID at an explicit time; conflicting copies reject without moving existing actions. **Delete action**, or Delete/Backspace while tracks are focused, removes the selection. Undo/Redo and downloads include all action edits. No timeline action advances the preview: the stage continues to show initial Actor placement. Selecting a movement clip draws a read-only green destination crosshair; edit **Destination X/Y** in the inspector to change the future position.

### Timing and ownership

All authored times/durations are milliseconds; the UI displays seconds. Each action has `id`, `actorId`, `time` and a discriminating `type`. IDs are unique within the scene and never regenerated by moves or serialization. Clips require positive, finite duration and must end within the scene; markers may lie exactly at the scene end.

| Type        | Parameters and meaning                                                                                                                                                                                                                                     | Ownership                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `animation` | `animation` ID, explicit `duration`, `loop` boolean, positive `speed` multiplier. The finite window truncates longer playback. With `loop: false`, play once then hold the final pose for the remainder; with `loop: true`, repeat only within the window. | Base animation for `[time, time + duration)`. No implicit crossfade. |
| `move`      | `destination: {x, y}`, positive `duration`. Straight-line travel over that duration from the Actor's position at the action start.                                                                                                                         | Position only for the half-open interval.                            |
| `face`      | `target` is `{type: 'direction', facing: 'left'}` (or `'right'`), `{type: 'actor', actorId}`, or `{type: 'point', x, y}`. Uses horizontal facing; zero horizontal displacement preserves facing.                                                           | Instant marker; equal-time facing changes for one Actor reject.      |
| `wait`      | Positive `duration`; hold/scheduling annotation. It does not freeze or override concurrent channels.                                                                                                                                                       | None.                                                                |
| `cue`       | Nonempty `name`, optional JSON `payload`. Metadata/signals for application code, separate from animation-authored events. No built-in sound/dialogue/combat behavior.                                                                                      | None.                                                                |

Movement uses explicit duration rather than storing both speed and duration. For a future v0.8 Actor adapter, travel speed is `worldDistance / (duration / 1000)` in world units per second; stationary movement is a timed hold. Sequential movements begin at the preceding destination; gaps retain position. Movement does not choose locomotion animations or change facing, so animation and facing actions may coexist with it. No pathfinding or transformed-parent runtime adapter is implemented here.

Two overlapping movement clips, or two overlapping base-animation clips, for one Actor reject regardless of array order. Adjacent clips are valid. Different Actors act concurrently. Waits/cues are metadata and may overlap any channel. Facing markers are instantaneous signals, not sustained tracking. These are authored policies for a later runtime adapter; this release implements no scene playback engine.

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

`SceneTimeline.tsx` owns session-only zoom, playhead, pointer capture and drag presentation. `timelineActions.ts` builds Actor tracks and adapts clip edges to the existing Animation Editor `resolveTimelineSnap`; ruler and time coordinates reuse `timeline.ts`. Animation-specific keyframe selection stays in that editor; scene selection uses stable action IDs in `SceneEditorDocument`, with no duplicated keyframe architecture. `SceneActionInspector.tsx` applies complete validated action updates, keeping draft form state separate from authored snapshots. The document uses the existing `SnapshotHistory` begin/end/cancel transactions for timeline and stage gestures.

## Verification

Unit regressions cover empty creation, valid/invalid documents, non-JSON rejection, versions, stable actor IDs, optional asset catalogs, deterministic round trips, immutable source/working isolation, history, saved checkpoints, switching, guarded replacement and character-data preservation. Local desktop Playwright coverage exercises creation, property edits, switching, Undo/Redo, downloads, inactive-document unload protection, imports, canceled replacements, revert, and navigation from the demo. Browser tests remain local-only.

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

Deferred: runtime scene playback adapter, camera direction, dialogue, branching, physics and pathfinding. Automatic scene draft recovery is also deferred. This foundation introduces authored action declarations only; it does not execute them.

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
