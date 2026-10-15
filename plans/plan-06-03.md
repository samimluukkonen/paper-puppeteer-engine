# Paper Puppeteer Engine — v0.6.3
## React Editor Production Workflow

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.6.2**

Technology stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The project includes:
- Rig Editor
- Animation Editor
- Rig-Tweak mode
- Artwork replacement/alignment
- Attachment and skin management
- IK, baking, onion skinning and mirroring
- Import/export and Undo/Redo

This milestone is a production usability pass, not a major feature expansion.

## Goal

Implement **v0.6.3 — React Editor Production Workflow**.

Make the editors feel like one coherent application that an artist can use without understanding the internal engine architecture.

### 1. Unified character workspace

Review how a character is loaded and shared between editors.

The artist should be able to work on:
- Rig
- Artwork
- Skins/attachments
- Animations

without accidentally creating inconsistent duplicate working copies.

Establish one clear owner for each editable document domain.

Avoid rewriting all editor controllers.

### 2. Editor navigation

Improve transitions between:
- Rig Editor
- Animation Editor
- Rig-Tweak mode
- Artwork/attachment controls
- Character/package export

Preserve appropriate selection and working context.

Do not discard pending edits silently.

### 3. Independent dirty states

Show accurate modified/clean indicators for the actual document domains.

Examples:
- Rig
- Animation
- Assets
- Skins

Do not mark animation dirty when only artwork changes.

Follow existing save/export checkpoint conventions.

### 4. Unsaved-change protection

Handle:
- Character switching
- Document switching
- Import/reload
- Revert
- Editor navigation
- Browser navigation where supported

Provide clear choices for keeping or discarding pending changes.

Do not claim browser downloads automatically overwrite local repository files.

### 5. Error presentation

Provide consistent, actionable errors for:
- Invalid JSON
- Missing image assets
- Broken character references
- Failed texture loading
- Unsupported formats
- Invalid animation edits
- Failed package export

Preserve valid working state after recoverable failures.

Use existing React error handling rather than creating competing systems.

### 6. Mode and selection clarity

Distinguish:
- Joint editing
- Artwork alignment
- Animation keyframe editing
- IK handle authoring
- Rig-Tweak mode

Prevent gestures in one mode from accidentally modifying another domain.

### 7. React/Phaser lifecycle

Verify no duplicate scenes, subscriptions, pointer handlers or rendering objects during:
- Editor switching
- Character switching
- Animation switching
- Repeated panel opening/closing
- React component unmounting

Fix observed leaks or stale-state bugs.

### 8. Performance

Profile representative operations:
- Timeline scrubbing
- Playback
- Large keyframe selections
- Onion skinning
- Artwork replacement
- Skin switching

Avoid excessive React tree updates on Phaser render frames.

Only optimize verified bottlenecks.

### 9. Artist usability

Polish:
- Labels/tooltips
- Confirmation dialogs
- Disabled control explanations
- Keyboard focus
- Shortcut consistency
- Empty states
- Success/error feedback

Prefer incremental improvements to a full UI redesign.

### 10. End-to-end artist test

Exercise:

1. Open a character.
2. Adjust a joint.
3. Replace a sprite.
4. Align artwork.
5. Edit animation keys.
6. Use Rig-Tweak mode.
7. Switch skins.
8. Undo/Redo relevant edits.
9. Export documents.
10. Reopen/reload.

Verify authored domains stay consistent.

### 11. Tests

Add tests for:
- Document ownership
- Mode switching
- Dirty-state transitions
- Unsaved-change guards
- Error recovery
- React/controller synchronization
- Resource lifecycle
- Editor navigation

### 12. Scope restrictions

Do not implement new animation solvers, mesh deformation, physics or choreography.

### 13. Verification

Run and fix failures:
- `npm run typecheck`
- `npm run test`
- `npm run build`

## Definition of done

- Character workspace ownership is coherent
- Editor navigation preserves valid working state
- Dirty states are accurate
- Unsaved changes are protected
- Mode boundaries remain safe
- Errors are recoverable
- React/Phaser lifecycle is stable
- Artist workflow is documented
- Tests, typecheck and build pass

## Final report

Provide:
1. Workflow improvements
2. State/document ownership
3. Dirty-state behavior
4. Navigation and error recovery
5. React/Phaser lifecycle findings
6. Files changed
7. Tests
8. Manual verification performed
9. Exact command results
10. Remaining v0.6.4 work

Do not claim completion unless required commands pass.b
