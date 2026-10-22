# Unified editor workflow — v1.0.4

The Project Workspace retains character editors and their independent rig/animation histories. Opening a scene uses the existing scene document owner; returning to Project releases its Phaser preview so the next opening sees the latest character artwork and clips. No authored formats or runtime capabilities change in this milestone.

The workflow audit found practical gaps in project identity inside retained editors, scene history/playback keyboard access, native-focus guards, export wording, Project Workspace guide access, and empty-state instructions. Existing toolbar commands, panel resizing, character ownership, independent selection stores, and collapsed inspector defaults are retained.

| Area         | Result                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation   | Editor headers show the project and character/scene name. The shared context strip names the editor, document and modified domains. Return to Project restores focus to its heading. Scene and character rows show project checkpoint differences.                                                 |
| Status       | “Matches loaded / exported checkpoint” describes known document state without claiming a file was overwritten. Character package differences appear separately from rig/animation JSON checkpoints. Browser local-save messages remain separate.                                                   |
| Selection    | Scene clips keep their Actor selected. Escape cancels a gesture first, then clears clip selection, then Actor selection. Rig Escape cancels a gesture first and otherwise clears bone/slot/IK/contact selection. Animation retains its existing timeline selection conventions.                    |
| Feedback     | Recovery failures identify recovery rather than autosave. Character package failures include a retry action; unavailable scene clipboard export points to JSON download; preview dependency failures point to references/artwork and Retry preview. Existing validation diagnostics remain intact. |
| Empty states | Project creation/import/recovery, PNG assignment, animation creation/import, Actor creation and empty timeline next actions are explained. No assets are added automatically.                                                                                                                      |
| Layout       | Shared theme and existing desktop panel resize/scroll behavior are preserved. Context strips wrap, and project identity wraps within the existing header. The scene summary shares the context strip, and timeline tracks shrink and scroll when desktop toolbars wrap.                            |

`EditorContext` and `ViewHeader` present shared identity and checkpoint facts. `ProjectFeatureGuide` launches the selected asset's existing catalog through the retained project bridge. `keyboardShortcuts` provides common history/export routing and focus guards; `SceneKeyboardController` owns scene command routing. The character entry point binds these controls to its existing rig, animation, attachment and package owners. `GuideSpotlight` remeasures card content before paint, and recovery feedback retains the existing status components with operation-specific messages. `ProjectWorkspace.sceneDirty()` reads project checkpoints without changing scene selection.

## Keyboard behavior

| Command                        | Project                  | Rig / Rig Tweak                                                          | Animation                  | Scene                                                            |
| ------------------------------ | ------------------------ | ------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------- |
| Ctrl/Cmd+Z                     | Undo metadata            | Undo rig                                                                 | Undo animation             | Undo scene                                                       |
| Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y | Redo metadata            | Redo rig                                                                 | Redo animation             | Redo scene                                                       |
| Ctrl/Cmd+S                     | Export project ZIP       | Open File tools; Rig Tweak focuses Download rig JSON                     | Open File tools            | Download scene JSON                                              |
| Delete / Backspace             | Existing removal buttons | Existing bone/empty-slot removal with dependency checks and confirmation | Existing timeline deletion | Remove selected clip, otherwise Actor; confirm dependent actions |
| Escape                         | Native dialog dismissal  | Cancel gesture, otherwise deselect                                       | Existing cancel/deselect   | Cancel gesture, otherwise deselect clip, then Actor              |
| Space / Home / End             | —                        | Existing rig preview controls                                            | Play/pause, restart, end   | Play/pause, restart, seek to end                                 |

Global commands leave text fields, numeric fields, selects, content-editable descendants, modal dialogs, IME composition and guided tutorials alone. Space on buttons, links and disclosures retains native activation. Modified Delete shortcuts do not delete scene items. Repeated history/export/delete keys do not replay commands. Scene history/playback commands wait until an authored Actor/clip drag is committed or canceled. Controllers release their listeners on unmount.

Local autosave stores recovery data in this browser. Explicit JSON/clipboard/console export and complete character/project package checkpoints are separate scopes. A downloaded project can contain current rig changes even when the rig JSON document still differs from its own checkpoint. File tools remain the place to choose an export format; shortcuts do not overwrite imported files. No “file updated” or autosave success state is inferred from a clean document.

## Feature Guide

Project Workspace's Feature Guide asks for an existing project character or scene and opens that asset's existing editor catalog. It explains missing assets when the project is empty. Rig, Animation and Scene guides retain their current prerequisites, spotlight target observers, practice isolation and modal focus behavior. Cards remeasure when step content changes, and both the spotlight and card move immediately to the measured layout so they do not sweep across each other's controls. The project bridge binds the catalog opener after the editor mounts; retained character hosts reopen their existing guide rather than installing a second owner.

## Verification

`tests/editorWorkflow.test.ts` covers scene history, selection, dependency confirmation, gesture cancellation, playback routing, focus isolation, export shortcut lifetime and truthful context wording. The local `tests/browser/editorWorkflow.spec.ts` exercises Project → Rig → Animation → Project → Scene, guide entry points, retained joint edits, one canvas, empty states, export access and scene history/playback at desktop resolutions. Existing guide, project, recovery and editor lifecycle suites remain applicable. Browser checks remain local-only.

Verification on 22 October 2026:

| Command                                                                                                                                                | Result                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                    | Exit 0.                                                                                                                                   |
| `npm run test`                                                                                                                                         | Exit 0; 194 test files passed, 5 skipped; 3,389 tests passed, 56 skipped.                                                                 |
| `npm run build`                                                                                                                                        | Exit 0; demo and library builds plus the built Node entry-point check passed. Existing third-party `use client` bundling warnings remain. |
| `npm run check`                                                                                                                                        | Exit 0; formatting, lint and TypeScript passed.                                                                                           |
| Local browser acceptance command below                                                                                                                 | Exit 0; 81 passed, 1 intentionally skipped across both build modes, in 8.2 minutes.                                                       |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEditor.spec.ts --grep 'unsaved animation settings' --trace=off --max-failures=1` | Exit 0; both build modes passed.                                                                                                          |

The production skip is the existing direct IndexedDB module harness, which requires Vite source imports; the same case passed in development.

The local browser acceptance run uses the installed Chrome, one worker from the existing configuration, and the development and production projects:

```sh
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/editorWorkflow.spec.ts \
  tests/browser/projectWorkspace.spec.ts \
  tests/browser/sceneEditor.spec.ts \
  tests/browser/featureGuide.spec.ts \
  tests/browser/rigGuides.spec.ts \
  tests/browser/animationGuides.spec.ts \
  tests/browser/sceneGuides.spec.ts \
  tests/browser/guidePractice.spec.ts \
  tests/browser/characterWorkspace.spec.ts \
  tests/browser/sharedWorkspace.spec.ts \
  tests/browser/localAutosave.spec.ts --trace=off --max-failures=1
```

The bundled Playwright Chromium is not installed on this host. Initial default-browser launches and an attempt inside the port-restricted sandbox could not start; the successful checks use installed Chrome with local-server permission. The complete 504-case browser suite was interrupted rather than completed. A four-worker attempt reported one character-switching load timeout; that scenario passed in both build modes when rerun serially as recorded above. The acceptance run is scoped to the affected existing suites and the new workflow regression; it is not a claim that all 504 scenarios passed.

Actual visual verification: inspected the new workflow's captured Animation and Scene Editor screenshots at 1280×900. Project/document identity, separate local-draft feedback, navigation, stage, timeline and collapsed inspector sections remained visible and usable. Also inspected the 1440×1000 Timeline Navigation screenshot and confirmed the card leaves the highlighted time field clear. The automated workflow also starts at 1600×1400. This was screenshot inspection after real automated browser input, not a separate manual artist session or a freehand drag-through of every tool.
