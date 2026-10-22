# Paper Puppeteer Engine — v1.0.3
## Asset Integrity & Dependency Validation

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.0.2**

Stack: React, TypeScript (strict), Phaser, Vite, npm, ES modules.

The engine has a Project Workspace, local autosave/recovery, character packages and scene packages.

## Goal

Implement **v1.0.3 — Project Asset Integrity & Dependency Validation**.

I need a reliable way to detect problems in characters, animations, sprites and scenes before exporting or using them.

This should provide actionable information without automatically destroying or rewriting authored assets.

### 1. Inspect existing validators

Review:
- Rig validators
- Animation validators
- IK constraint references
- Skin/attachment validators
- Character manifest validators
- Scene validators
- Package export checks
- Project asset registry

Reuse existing validation logic.

Do not implement competing schema validators.

### 2. Project-wide dependency inspection

Create a typed dependency inspection service.

It should understand relationships such as:

```text
Project
  → Character
      → Rig
          → Bones
          → IK constraints
          → Slots
      → Skins / Attachments
          → Sprite assets
      → Animations
          → Bone tracks
          → IK tracks
  → Scenes
      → Actors
          → Characters
      → Actions
          → Animations
```

Adapt to actual schemas.

### 3. Issue types

Detect problems including:
- Missing sprite files
- Missing referenced character
- Missing animation
- Broken bone references
- Invalid IK constraint references
- Invalid skin attachments
- Duplicate identifiers
- Invalid scene Actor references
- Unsupported format versions
- Unsafe package paths
- Unresolved image frame references

Only report issues that the existing formats can meaningfully establish.

### 4. Severity

Use a small severity model such as:
- Error: prevents correct loading/export
- Warning: may cause unexpected behavior
- Information: optional improvement

Do not overwhelm the user with harmless notices.

### 5. Validation panel

Add a React validation panel accessible from the Project Workspace.

Example:

```text
PROJECT VALIDATION

2 Errors
1 Warning

ERROR
Scene "Training" refers to missing
character "guard-v2".

ERROR
Attachment "left-hand" uses missing
image "hand.png".

WARNING
Animation "idle" is not referenced
by any scene.

[Open Affected Asset]
[Revalidate]
```

Use actual validation findings.

Avoid fabricated warnings when the project is healthy.

### 6. Navigate to affected asset

Where possible, allow clicking an issue to open:
- Correct character
- Rig Editor
- Animation Editor
- Scene Editor
- Asset reference inspector

Respect existing unsaved-change guards.

The UI should explain the problem in terms an artist can understand.

### 7. Validation timing

Support:
- Explicit project validation
- Validation before export
- Targeted checks after relevant asset changes

Avoid revalidating the entire project on every animation frame or pointer movement.

### 8. Destructive-operation protection

Before deleting or replacing shared assets, identify dependents.

For example, deleting an animation referenced by three scene clips should show those dependencies.

Do not silently remove them.

Only permit automated repairs when the operation is unambiguous, previewable, undoable and fully validated.

Otherwise provide instructions rather than unsafe automatic fixes.

### 9. Draft versus production validity

An unfinished character with no artwork may be acceptable as an editing draft.

A production package with unresolved required artwork is not.

Make these contexts explicit.

Do not prevent normal creation of incomplete work.

### 10. Export integration

Before exporting a project or scene:
1. Validate required dependencies.
2. Show blocking errors.
3. Allow fixing the problems.
4. Export only when required checks pass.

Preserve existing exporters and their own validation.

### 11. Tests

Cover:
- Complete valid project
- Missing texture
- Invalid bone ID
- Broken IK reference
- Missing animation
- Scene using missing character
- Duplicate asset ID
- Asset deletion dependency warnings
- Invalid package paths
- Editing draft versus export validation
- Export blocking
- Project-wide validation performance
- Source immutability

### 12. Out of scope

Do not implement:
- Automatic rig repair
- Automatic animation retargeting
- AI-based asset repair
- Cloud asset registry
- Enterprise dependency management

### 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Project dependencies can be inspected.
- Broken references are identified.
- Errors are understandable and actionable.
- Users can navigate to affected assets.
- Unsafe deletions are protected.
- Incomplete drafts remain editable.
- Invalid production exports are blocked.
- Tests, typecheck and build pass.

## Final report

Provide dependency model, validation diagnostics, UI, export integration, files/APIs changed, tests and exact verification results.

Do not claim completion unless required checks pass.
