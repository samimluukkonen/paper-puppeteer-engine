# Scene Editor: visual stage and actor placement (v0.9.2)

[All guides](../README.md#guides)

Open **Scene Editor** in the application navigation, or visit `/scene-editor/`. Use **New Scene** to choose a stable scene ID, name and duration. No character or scene JSON is required. Expand **Scene properties**, edit the name or duration in seconds, and click **Apply properties**. Inspector sections start collapsed. Scene IDs remain fixed after creation/import.

**Open scene JSON** imports a document; the scene picker switches among open documents without losing changes or Undo/Redo history. Each document has its own immutable source, working snapshot, saved checkpoint and bounded history. New documents start **New / Unsaved**, even if their initial values have not changed. Download each scene to keep it after leaving the page. The browser guards refresh, closing and navigation if any open document is unsaved, including inactive scenes. Scene drafts are held in this page's memory; automatic browser draft recovery is deferred. Navigating to the character editors uses their existing guarded page navigation.

**Download scene JSON** validates and serializes authored data and marks the captured snapshot saved. Later edits remain dirty. **Revert** restores the original created/imported source with confirmation when dirty; it is undoable and does not replace the saved download checkpoint. Opening another document preserves drafts. Opening a document with the same ID replaces its source/history, with confirmation if that document is dirty, including when inactive. Invalid or canceled operations retain current data and history.

## Visual stage

Click **+ Add Actor**, choose a character from the same workspace catalog used by the character editors, and click **Add actor**. You can also enter a stable manifest path or HTTP(S) URL for any compatible package. The editor loads it with `CharacterLoader`; it does not rely on demo animation names, bone IDs or presentation profiles. Browser-only new-character identities have no permanent manifest yet; export and host their package before referencing them in a scene. Paths are resolved from the Scene Editor page during preview and from the saved scene location in a future host. Keep that base location consistent or use permanent absolute URLs.

Expand **Scene actors** to select, duplicate, remove, or change preview depth with **Send backward** / **Bring forward**. Later actor-array entries draw in front. Each instance gets a scene-local ID independent of its character definition and animation names. Duplicate creates a separate instance offset by 32 stage units and does not copy scheduled actions. Renaming an actor updates its action references atomically. Removing an actor with actions asks explicitly whether to remove those actions too; cancellation preserves everything. Both operations are undoable.

Click an actor's artwork or origin handle to select and drag it. The colored X/Y handles constrain a move to one axis. **Actor properties** provides ID/name, read-only character manifest reference, numeric initial X/Y, facing and supported animation/skin choices. Inspector sections start collapsed. Animation selection samples its first pose without advancing a scene clock; choosing **Bind pose** restores the rig's bind pose. Facing and skin use existing runtime APIs. Character defaults remain implicit until you choose an override.

Coordinates are stage/world units: (0,0) starts at the viewport center, X increases rightward and Y downward. Canvas FIT scaling, camera zoom and camera scroll are converted before calculating drag offsets. Mouse wheel zooms around the pointer. Middle/right/Alt-drag pans; **Reset view** returns to the initial camera. The optional 32-unit grid, camera and selection are editor-only. One complete drag is one history entry. Escape, pointer cancellation or window blur restores the pre-drag snapshot without consuming history or losing Redo. Switching scenes also cancels unfinished moves.

The timeline remains a placeholder. Imported actions are preserved and validated; they are not scheduled or executed.

## Authored contract

`SceneDefinition` is JSON data, independent of React, Phaser and live Actor/Puppet instances. Example:

```json
{
  "version": 1,
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
    { "type": "animation", "actorId": "hero", "time": 0, "animation": "walk" },
    { "type": "face", "actorId": "hero", "time": 2500, "facing": "left" }
  ]
}
```

Times and duration are **milliseconds**, matching the existing Actor, animation and choreography APIs. Position is in stage/scene coordinates, with finite X/Y values. Facing uses the existing left/right convention. Actor IDs are stable, scene-local authored strings; multiple actors may reference the same character. Array order and authored numeric precision survive round trips. Actions may share times and need not be sorted; future scheduling must preserve deterministic authored ordering for ties. Duration is finite and strictly positive; action times include both endpoints, from zero through duration.

Character references are stable manifest JSON paths resolved relative to the saved scene document, or permanent HTTP(S) URLs without query/fragment. Moving a scene file may require adjusting its relative references. JSON contains no embedded character definitions, texture URLs, functions, promises, runtime instances, selection, zoom or history. Strict schemas reject unknown fields and the existing JSON guard rejects non-JSON data before getters or schema reads. Existing character package formats, Actor and Puppet remain unchanged.

## APIs and boundaries

The renderer-independent `/core` and `/serialization` entries export:

- `SCENE_FORMAT_VERSION`, `SceneValidationError` and the scene, actor, action and character-reference Zod schemas.
- `createEmptyScene({ id, name?, duration? })` with a default 10,000 ms duration.
- `validateSceneDefinition(input, options?)`, returning shared field-path validation issues.
- `parseSceneDefinition(input, options?)`, returning detached authored data and retaining the existing `UnsupportedFormatVersionError` contract.
- `parseSceneJson(text, options?)`, with the shared 10 MiB input bound.
- `serializeSceneDefinition(input, options?)`, producing deterministic, sorted-key JSON with a trailing newline and the shared size bound.

`/data` also exports `SceneDefinition`, `SceneActorDefinition`, `SceneActionDefinition`, `SceneCharacterReference`, `SceneCharacterAssets` and `SceneValidationOptions` as types. The action discriminated union currently contains only `animation` and `face`. Extending the format requires updating the union/schema and validation together, with normal format-version compatibility decisions.

Without an asset catalog, validation checks reference syntax, actor ID uniqueness, document IDs, finite values, supported actions, action times and actor references. It performs no network I/O. Hosts can supply `characters: ReadonlyMap<string, SceneCharacterAssets>`, keyed by the exact authored manifest reference; values contain `animations` and `skins` name arrays. Then missing characters, starting animations/skins and scheduled animation names are also rejected. The workspace retains structural document validation, resolves character definitions for the picker and preview, and reports asset-loading and unsupported initial-property errors in the stage. Hosts may still supply an asset catalog for strict offline document validation.

`src/devtools/scene-editor/SceneEditorDocument.ts` owns scene documents, actor selection, validated commands and drag transactions through the existing `SnapshotHistory`. React subscribes through `useSyncExternalStore`; `SceneActorsPanel` owns dialog/form state and ignores stale asynchronous Add completions after cancellation or scene changes. `SceneStageView` creates one Phaser game in a layout effect using the shared `createEditorGame` and `observePreview` conventions. React updates reconcile instances without rebuilding the game.

`SceneCharacterRegistry` caches immutable metadata and concurrent requests, and aborts metadata loads on page teardown. `SceneStage` serializes artwork loads through `loadSceneCharacter`, which uses the existing texture queue, validation and shutdown cancellation. `SceneActorPreview` creates one owned `Actor`/`Puppet` pair per scene actor and applies position, facing, skin and initial pose through the existing runtime. Actors referencing one definition share immutable rig/compiled clips and textures while retaining separate pose buffers and playback state. It disposes removed/replaced actors immediately and all instances when switching scenes or shutting down. Texture ownership belongs to the game: shared artwork remains cached across removal/Undo and scene switches and is released by game destruction, never by an individual actor. Runtime texture-key conflicts are reported using the loader's existing contract.

`stageCoordinates.ts` converts DOM coordinates through Phaser's camera and computes offset-preserving, optionally axis-constrained positions. Existing camera pan/zoom utilities are reused. Drag coordinates use the editors' six-decimal rounding; numeric inspector values retain authored precision. No engine module imports React or editor code, and no character rig, source package or animation track is modified by actor placement. Scene data/schema version stays at 1; actor array order already supplies preview depth without a new authored field.

## Verification and next milestone

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

Deferred: timeline clip editing, runtime scene playback adapter, camera direction, dialogue, branching, physics and pathfinding. Automatic scene draft recovery is also deferred. This foundation introduces authored action declarations only; it does not execute them.

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
