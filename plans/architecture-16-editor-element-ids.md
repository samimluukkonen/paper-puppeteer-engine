# Architecture candidate 16 — Typed element ids between editor markup and controllers

Continue developing Paper Puppeteer Engine.

Source: codebase-design scan of the whole repo on 2026-11-17 (measured at `64f7e6e`). This applies architecture-06's approach (typed guide anchors plus a contract test) to the animation and rig editors' imperative controllers.

## Problem

The animation and rig editors render their markup with React (`AnimationEditorView` in `src/devtools/animation-editor/editorMarkup.tsx`, 132 `id="…"` attributes; `RigEditorView` in `src/devtools/rig-editor/editorMarkup.tsx`, 41). Their imperative controllers then find elements with string selectors:

| Editor | Lookups | Heaviest files |
|---|---|---|
| Animation | 71 in 19 files | `main.tsx` 21, `AnimationWorkspaceController` 13, `RigTweakController` 12, `RootMotionController` 10, `EditorMenuController` 9 |
| Rig | 43 in 6 files | `ControlsController` 22, `SessionController` 9, `RigWorkspaceLayoutController` 5 |

The id string is the whole interface between the markup and its controller, and nothing checks it:

- 36 of the animation editor's `#id` lookups use `!`. If an id is renamed, the controller fails later with a `TypeError` far from the cause.
- 7 use `?.`. If an id is renamed, the feature silently stops working (for example `#tweak-download-json`'s focus in `main.tsx:228`, and `#rig-tools-open`'s click in `main.tsx:223`).
- The same id string is repeated across files (`#animation-authoring-tools > summary` 5 times, `#animation-facing` and `#animation-draft-status` twice each).

`tests/guideAnchorContract.test.ts` already proves this kind of contract can be checked cheaply.

## Goal

Each editor has one typed table of the element ids its controllers use, and both the markup and the controllers read from it. Looking up a missing element fails immediately, naming the id. A contract test fails if any id in the table is missing or duplicated in the rendered markup.

## What to build

1. **`animationEditorIds` and `rigEditorIds` tables** (`src/devtools/animation-editor/elementIds.ts` and `src/devtools/rig-editor/elementIds.ts`):
   ```ts
   export const ANIMATION_IDS = { eventTime: 'animation-event-time', facing: 'animation-facing', … } as const;
   ```
   Include only ids that a controller or `main.tsx` looks up. Ids used purely for `<label htmlFor>` can stay literal.
2. **One lookup helper** in `src/devtools/shared/editorElements.ts`:
   ```ts
   requireElement<T extends HTMLElement>(root: ParentNode, id: string, type: new () => T): T  // throws `Missing editor element #id`
   optionalElement<T extends HTMLElement>(root: ParentNode, id: string, type: new () => T): T | null
   ```
   It also checks the element's type, so `#animation-facing` really is an `HTMLSelectElement`. Use `optionalElement` only where the element is legitimately conditional (for example, only rendered in project mode), with a comment saying why.
3. **Migrate.** `editorMarkup.tsx` uses `id={ANIMATION_IDS.eventTime}`. Controllers use `requireElement(root, ANIMATION_IDS.eventTime, HTMLInputElement)`. Do the same for the rig editor. Compound selectors such as `#animation-authoring-tools > summary` become a lookup of the id plus a child query, in one named helper if it's used more than once.
4. **Contract test** `tests/editorElementIdContract.test.ts`, modelled on `guideAnchorContract.test.ts`:
   - render `AnimationEditorView` and `RigEditorView` with `react-dom/server`, then assert every table id appears exactly once, accounting for ids that only render in a given mode;
   - scan `src/devtools/{animation-editor,rig-editor}` and fail on any remaining `querySelector('#…')` or `getElementById` string literal outside the tables.

## Constraints

- No behaviour or markup change: the same ids, structure and styling.
- Don't convert the imperative controllers to React. That is out of scope.
- `devtools/shared` must not import the editors (architecture-05). The helper takes ids as plain strings.
- Changelog entry goes under Unreleased (internal refactor; a "Changed" note is enough).

## Verification

- `npm run check` and `npm run test` (sequential, one worker)
- `npm run test:browser` locally: animation editor and rig editor smoke runs (open each editor, use the menu, timeline, root motion, rig tweak, export).
- The contract test fails when you rename one id only in the markup, and again when you rename it only in the table. Try both by hand once.

## Acceptance

- `grep -rnE "querySelector(All)?<[^>]+>\('#|getElementById\('" src/devtools/animation-editor src/devtools/rig-editor` finds nothing outside the lookup helper.
- No `!` or `?.` on element lookups in those editors, except `optionalElement` call sites with a stated reason.
- The contract test is part of `npm run test`.
- Full test suite passes.
