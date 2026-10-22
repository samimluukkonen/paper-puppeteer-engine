# Paper Puppeteer Engine — v1.0.2
## Autosave & Crash Recovery

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.0.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The project now has a unified Project Workspace managing characters, animations, artwork and scenes.

## Goal

Implement **v1.0.2 — Local Autosave & Crash Recovery**.

My artist friend and I should not lose substantial editing work because the browser refreshes, crashes or is accidentally closed.

This is a private, browser-based editing tool.

Do not introduce cloud infrastructure.

### 1. Inspect existing document lifecycle

Review:
- Project working copies
- Rig working copies
- Animation working copies
- Scene working copies
- Imported image binary management
- Undo/Redo
- Dirty-state tracking
- Export checkpoints
- Browser startup/loading

Reuse current document ownership.

### 2. Local persistence

Implement reliable local draft persistence.

Prefer IndexedDB for:
- Project metadata
- Authored JSON document snapshots
- Imported image Blob data
- Recovery metadata

Reuse an existing suitable persistence layer if available.

Do not use localStorage for large image binaries.

### 3. Autosave behavior

Save drafts automatically after authored changes.

Use a modest debounce rather than writing continuously during:
- Joint dragging
- Timeline scrubbing
- Keyframe dragging
- Actor movement previews

Only committed authored changes should trigger snapshot updates.

Playback and preview operations must not produce autosaves.

### 4. Snapshot consistency

Snapshots must represent consistent document revisions.

Avoid saving:
- Partially committed drag operations
- Half-imported images
- Incomplete scene packages
- References to missing asset blobs

Use transactions or an equivalent atomic commit strategy.

Keep authored source data separate from temporary editor UI state.

### 5. Recovery

On application startup, detect available recovery drafts.

Show a simple dialog:

```text
RECOVER UNSAVED WORK?

Project: My Animation Project

A local recovery draft is available.

Last saved: [actual timestamp]

[Recover Draft]
[Discard Draft]
[Cancel]
```

Do not automatically overwrite the original imported project.

Allow the user to inspect or explicitly select recovery.

### 6. Save status

Provide clear status indicators:

- Unsaved changes
- Saving locally
- Local draft saved
- Autosave failed
- Explicitly exported

**A local autosave is not the same as saving files to disk.**

Do not show "Saved to file" unless a real file-write or export succeeded.

### 7. Recovery after errors

Handle:
- Interrupted persistence
- Corrupt snapshots
- Unsupported snapshot versions
- Missing binary assets
- Storage quota errors
- Browser storage unavailable
- Unexpected application closure

Preserve the last valid recoverable snapshot where feasible.

Report actionable errors instead of silently losing work.

### 8. Storage lifecycle

Avoid unlimited growth of recovery snapshots.

Use a small, documented retention policy.

Do not automatically delete the most recent valid draft simply because an export was initiated.

Provide a simple way to discard obsolete recovery data.

### 9. Multiple browser tabs

Prevent or detect dangerous concurrent editing of the same local project.

A lightweight warning or project edit lock is sufficient.

Do not build real-time multi-user synchronization.

### 10. Imported images

Ensure unsaved imported/replaced artwork can be recovered.

Persist actual binary data when necessary, not temporary Blob URL strings.

Restore safe temporary texture references after recovery.

Clean up superseded object URLs and Phaser textures.

### 11. Integration

Autosave should work across:
- Project Workspace
- Rig Editor
- Animation Editor
- Scene Editor

Switching editors must not lose pending changes.

### 12. Tests

Add tests for:
- Snapshot creation
- Debounced saves
- Committed edits only
- Crash recovery
- Corrupt snapshot handling
- Quota errors
- Binary sprite recovery
- Project switching
- Multiple-tab conflict detection
- Version incompatibility
- No authored mutation during playback
- Cleanup and retention

### 13. Manual verification

Test:
1. Create a project.
2. Import character artwork.
3. Edit a rig joint.
4. Create animation keys.
5. Modify scene actions.
6. Allow local autosave.
7. Refresh the browser.
8. Recover the draft.
9. Confirm all authored assets remain available.
10. Explicitly export and re-import the project.

### 14. Out of scope

Do not implement:
- Cloud backup
- Login/accounts
- Collaborative editing
- Server-side synchronization
- Complex version-control history
- Automatic repository file overwriting

### 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Run browser persistence tests where available.

Fix all failures.

## Definition of done

- Local draft autosaving works.
- Imported images survive recovery.
- Incomplete writes do not corrupt the last valid draft.
- Startup recovery is available.
- Dirty/exported/autosaved states are clearly distinguished.
- Multiple tabs cannot silently overwrite one another.
- Existing editor history remains functional.
- Tests, typecheck and build pass.

## Final report

Provide architecture, persistence format, recovery behavior, storage failure handling, files changed, tests and exact command results.

Do not claim completion unless required checks pass.
