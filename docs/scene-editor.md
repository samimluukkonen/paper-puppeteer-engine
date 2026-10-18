# Scene Editor foundation (v0.9.1)

[All guides](../README.md#guides)

Open **Scene Editor** in the application navigation, or visit `/scene-editor/`. Use **New Scene** to choose a stable scene ID, name and duration. No character or scene JSON is required. Expand **Scene properties**, edit the name or duration in seconds, and click **Apply properties**. Inspector sections start collapsed. Scene IDs remain fixed after creation/import.

**Open scene JSON** imports a document; the scene picker switches among open documents without losing changes or Undo/Redo history. Each document has its own immutable source, working snapshot, saved checkpoint and bounded history. New documents start **New / Unsaved**, even if their initial values have not changed. Download each scene to keep it after leaving the page. The browser guards refresh, closing and navigation if any open document is unsaved, including inactive scenes. Scene drafts are held in this page's memory; automatic browser draft recovery is deferred. Navigating to the character editors uses their existing guarded page navigation.

**Download scene JSON** validates and serializes authored data and marks the captured snapshot saved. Later edits remain dirty. **Revert** restores the original created/imported source with confirmation when dirty; it is undoable and does not replace the saved download checkpoint. Opening another document preserves drafts. Opening a document with the same ID replaces its source/history, with confirmation if that document is dirty, including when inactive. Invalid or canceled operations retain current data and history.

The empty stage and scene timeline are placeholders. Imported actors/actions are retained and can be downloaded, but are not rendered, scheduled or executed in this milestone.

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

Without an asset catalog, validation checks reference syntax, actor ID uniqueness, document IDs, finite values, supported actions, action times and actor references. It performs no network I/O. Hosts can supply `characters: ReadonlyMap<string, SceneCharacterAssets>`, keyed by the exact authored manifest reference; values contain `animations` and `skins` name arrays. Then missing characters, starting animations/skins and scheduled animation names are also rejected. The foundation workspace uses structural validation and does not load referenced characters; existence is checked when a host supplies its asset catalog.

`src/devtools/scene-editor/SceneEditorDocument.ts` is the editor-only document owner. It reuses `SnapshotHistory`, shared JSON equality/freezing and the existing unsaved navigation guard. `replaceScene` is the validated whole-document boundary for future authored actor/action commands. The React workspace subscribes through `useSyncExternalStore`, owns only form/dialog state, cancels stale file-import completions on unmount, and displays validation issues. No engine module imports editor or React code. `generateJsonSchemas` emits `schemas/scene.schema.json` alongside the existing format schemas.

The separate Vite HTML entry keeps scene creation independent of character loading and Phaser initialization. The shared header adds Scene Editor navigation from the demo and both character editors. Existing rig/animation shared-document navigation remains intact. Existing animation timeline conversion, selection and playback controllers were reviewed; the empty scene timeline has no clock or interactive ruler to reuse yet.

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

Deferred to v0.9.2 or later: visual actor placement and character-resolution UI, timeline clip editing, runtime scene playback adapter, camera direction, dialogue, branching, physics and pathfinding. Automatic scene draft recovery is also deferred. This foundation introduces authored action declarations only; it does not execute them.

### Verified command results

Local verification on 2026-10-18:

| Command                                                                                                           | Result                                                                                  |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                               | Exit 0                                                                                  |
| `npm run test`                                                                                                    | Exit 0; 178 files passed, 5 skipped; 3,126 tests passed, 56 skipped                     |
| `npm run build`                                                                                                   | Exit 0; demo (including Scene Editor) and library built; Node entry-point checks passed |
| `npm run check`                                                                                                   | Exit 0; formatting, lint and typecheck passed                                           |
| `npm run check:version`                                                                                           | Exit 0; 0.9.1 package, lockfile, consumer reference and changelog agree                 |
| `npm run test:package`                                                                                            | Exit 0; isolated package checks plus standalone tests/typecheck/build passed            |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneEditor.spec.ts`                                 | Exit 0; 6 passed across development and production                                      |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sharedWorkspace.spec.ts -g 'fits desktop viewports'` | Exit 0; 6 passed across development and production                                      |

Builds retain non-failing Lucide `use client` directive warnings; the standalone consumer also reports its existing large Phaser bundle warning. No browser or dependency-audit CI configuration was changed.
