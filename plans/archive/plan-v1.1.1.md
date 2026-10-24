# Paper Puppeteer Engine — v1.1.1
## Advanced Pose Library

Continue developing my Paper Puppeteer Engine project.

**Current completed version: v1.0.5**

### Technology stack
- React + TypeScript (strict)
- Phaser for rendering
- Vite, npm, ES modules

The engine already includes:
- Rig Editor, Animation Editor and Scene Editor
- Character and project workspaces
- Existing pose presets and pose export
- Bone keyframe authoring
- IK, mirroring and onion skinning
- Autosave and project export/import
- Undo/Redo
- Feature Guide Wizard

This application is a private tool for myself and my artist friend. Avoid unnecessary infrastructure.

## Goal

Implement **v1.1.1 — Advanced Pose Library**.

I want the artist to save useful character poses, browse them, preview them and reuse them while authoring animations.

For example:
- Idle
- Sword ready
- Overhead attack
- Defensive stance
- Crouching
- Bowing

These are examples, not hardcoded pose categories.

## 1. Inspect existing functionality

Review:
- Existing pose presets
- PoseDefinition and serialization
- Animation keyframe APIs
- Bone hierarchy and transform evaluation
- Animation selection
- Mirroring tools
- Project workspace asset registry
- Existing inspector and modal patterns

Extend existing pose support rather than implementing a competing pose format.

## 2. Pose Library

Create a React Pose Library panel accessible from Animation Editor.

Suggested UI:

```text
POSE LIBRARY

[+ Save Current Pose]

Search: [                 ]

Sword Ready
Crouching
Defensive Stance
Overhead Attack

[Preview] [Apply] [Rename] [Delete]
```

Support:
- Save pose
- Browse poses
- Rename
- Delete with confirmation
- Search/filter
- Select
- Preview
- Apply

Keep the interface compact.

## 3. Save current pose

Allow capturing the current character pose at the animation playhead.

Use the existing evaluation and pose-preset architecture.

Clearly distinguish:
- Authored FK bone transforms
- Final IK-solved appearance
- Animated IK target data

Do not silently save a post-IK solved pose as ordinary FK keys, because applying IK again could produce different results.

Initially, capturing compatible FK bone transforms is sufficient. Support IK target values only if existing pose formats safely represent them.

## 4. Pose selection

Support saving:
- Full character pose
- Selected bones only

A partial pose must affect only its explicitly stored bones when applied.

Do not silently reset unrelated bones.

## 5. Pose preview

Allow non-destructive preview before applying a pose.

The artist should see how it would look at the current animation time.

Preview must not:
- Create keyframes
- Mark animation dirty
- Replace source data
- Create Undo entries

Cancel restores the original preview.

## 6. Apply to animation

Provide an explicit Apply Pose action.

Apply using the existing keyframe-authoring APIs at the current playhead.

Requirements:
- Create/update only relevant keys
- Preserve unrelated tracks
- Honor existing animation time conventions
- Use one Undo transaction
- Respect supported IK/mirroring behavior
- Avoid double-applying IK

The artist should be able to continue editing the resulting keys normally.

## 7. Pose compatibility

Store appropriate rig identity/compatibility metadata.

Handle:
- Same rig
- Changed bone hierarchy
- Missing bones
- Different characters
- Incompatible rigs

Do not blindly apply poses solely because bone display names match.

Initially, exact compatible-rig support is acceptable.

Advanced cross-rig retargeting is NOT required.

## 8. Persistence

Store reusable poses using existing project/character asset organization.

Ensure:
- Local autosave works
- Export/import works
- Stable pose IDs
- No editor-only objects in authored JSON
- No accidental changes to existing character assets

## 9. Undo/Redo

Applying a pose must be undoable.

Library editing should follow existing project/document history conventions.

A preview is not an authored operation.

## 10. Tests

Add tests for:
- Save full pose
- Save selected bones
- Preview and cancel
- Apply pose
- Overwrite existing keys
- Undo/Redo
- Missing bones
- Compatibility rejection
- Multiple animations
- Pose serialization
- Project export/import
- IK interaction
- Existing pose-preset compatibility

## 11. Manual verification

1. Open a character.
2. Create a sword-ready pose.
3. Save it into Pose Library.
4. Open a different animation.
5. Preview the pose.
6. Cancel.
7. Preview again.
8. Apply at the playhead.
9. Verify created keyframes.
10. Undo/Redo.
11. Export/reload the project.
12. Verify the pose remains available.

## 12. Out of scope

Do not implement:
- Cross-rig automatic retargeting
- AI pose generation
- Pose blending system
- New IK solver
- New animation formats unrelated to pose support

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

Run available UI tests.

## Definition of done

- Poses can be saved and organized.
- The artist can browse them.
- Previews are non-destructive.
- Poses can be applied as animation keyframes.
- Partial poses are supported.
- Existing poses remain compatible.
- Undo/Redo works.
- Persistence works.
- Tests, typecheck and build pass.

## Final report

Provide implemented functionality, pose storage format, compatibility behavior, UI changes, files changed, tests, manual verification and exact command results.
