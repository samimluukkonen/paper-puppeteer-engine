# Paper Puppeteer Engine — v1.0.4
## Unified Editor Workflow & UX

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.0.3**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing editors:
- Rig Editor
- Animation Editor
- Scene Editor

Also implemented:
- Project Workspace
- Local autosave/recovery
- Project asset validation
- Existing guide/tutorial system, if present

This tool is for myself and one artist friend.

## Goal

Implement **v1.0.4 — Unified Editor Workflow & UX**.

Improve the consistency and practical usability of the application without redesigning every editor.

### 1. Inspect current workflows

Review navigation, selection and editing behavior across all editors.

Identify confusing inconsistencies in:
- Toolbars
- Inspector panels
- Selection behavior
- Keyboard shortcuts
- Undo/Redo
- Dirty-state indicators
- Save/export actions
- Error messages
- Scene/character switching

Prioritize actual inconsistencies over cosmetic changes.

### 2. Project navigation

The user should always understand:
- Which project is open
- Which character/scene is open
- Which editor is active
- Which document is modified
- How to return to Project Workspace

Provide a consistent navigation area using existing React components.

### 3. Editor status indicators

Display meaningful status such as:

```text
Project: Forest Story

Character: Hero
Editor: Animation

Animation: walk-cycle
Status: Unsaved changes

Local draft: Saved
File export: Not updated
```

Only display states actually known by the application.

Avoid mixing up local autosave with explicit export.

### 4. Keyboard shortcuts

Audit current shortcuts.

Standardize where practical:
- Undo
- Redo
- Save/export access
- Delete selected item
- Escape/cancel active gesture
- Playback shortcuts where relevant

Do not let shortcuts interfere with:
- Text inputs
- Modal dialogs
- Numeric fields
- Active guided tutorials

Avoid assigning the same shortcut to conflicting operations.

### 5. Selection consistency

Ensure predictable interactions when:
- Selecting bones
- Selecting animation keys
- Selecting scene Actors
- Selecting scene timeline clips
- Switching inspectors
- Deselecting items

Do not combine unrelated editor selection stores.

Reuse established editor conventions.

### 6. Error and notification behavior

Use consistent, non-intrusive feedback for:
- Failed imports
- Failed exports
- Invalid assets
- Recovery failures
- Successful local autosave
- Unsupported operations

Messages should say what happened and what the artist can do next.

### 7. Feature Guide integration

Inspect the previously developed Feature Guide Wizard.

If implemented:
- Ensure it is accessible from Project Workspace.
- Preserve Rig Editor and Animation Editor guides.
- Include Scene Editor tutorials if available.
- Keep spotlight positioning accurate after layout changes.
- Avoid interfering with keyboard shortcuts and modal focus.

If the guide system is not implemented, do not rebuild the entire planned system inside this milestone; document the missing integration.

### 8. Empty states

Improve guidance for:
- Empty project
- Character without artwork
- Character without animation
- Scene without Actors
- Timeline without clips
- Missing dependencies

Provide clear next actions.

Do not inject demo assets without explicit user action.

### 9. Cross-editor continuity

Verify:
1. Select character.
2. Open Rig Editor.
3. Edit joint.
4. Open Animation Editor.
5. Preview changes.
6. Return to Project Workspace.
7. Open Scene Editor.
8. Preview character.

State must remain coherent.

### 10. Responsive layout

Ensure editors remain usable at reasonable desktop resolutions.

Support panels that resize or scroll appropriately.

Do not prioritize mobile layouts over the actual desktop authoring workflow.

### 11. Tests

Cover:
- Navigation
- Editor switching
- Selection consistency
- Shortcuts
- Focus handling
- Dialogs
- Status indicators
- Empty states
- Feature Guide interaction
- Unsaved-change protection
- React/Phaser lifecycle

### 12. Out of scope

Do not implement:
- Major UI redesign
- New animation tools
- New scene capabilities
- Accounts and permissions
- Theme marketplace
- Remote tutorials

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Also run existing browser/UI checks.

Fix failures.

## Definition of done

- Navigation is consistent.
- The active project and document are clear.
- Save/autosave status is truthful.
- Shortcuts do not conflict.
- Editors preserve working context.
- Feature guides remain functional where implemented.
- Empty states are understandable.
- Tests, typecheck and build pass.

## Final report

Provide UX improvements, component changes, shortcut behavior, feature-guide integration, tests, actual manual verification and exact command results.

Do not claim completion unless required checks pass.
