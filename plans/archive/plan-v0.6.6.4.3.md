# Paper Puppeteer Engine — v0.6.6.4.3
## IK Authoring Integration & Production Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.6.6.4.2**

Tech stack: React + TypeScript (strict), Phaser, Vite, npm, ES modules.

The Rig Editor now supports visual creation and editing of IK constraints.

The Animation Editor already supports:
- Animated IK target tracks
- Target keyframes
- Draggable IK target handles
- Influence animation
- IK baking
- Animation import/export

This phase integrates the systems and hardens the workflow.

## Goal

Ensure IK constraints created or edited through Rig Editor work correctly with existing characters, new characters and Animation Editor.

## 1. New character workflow

Test creation entirely from scratch:

```text
New Character
      ↓
Create Skeleton
      ↓
Create IK Constraint
      ↓
Position IK Target
      ↓
Save/Export Rig
      ↓
New Animation
      ↓
Animate IK Target
      ↓
Export Character Package
```

No example-character IK definitions or manual JSON editing should be required.

## 2. Existing character workflow

Load an existing character containing IK constraints.

The artist should be able to:
- Inspect existing constraints
- Change target positions
- Edit supported settings
- Disable/enable constraints
- Create additional constraints
- Delete unused constraints safely

Do not overwrite unrelated rig information.

## 3. Animation Editor discovery

Newly created IK constraints must appear in the Animation Editor's IK selection/authoring UI.

The artist should be able to:
1. Select the new IK constraint.
2. Create target position keys.
3. Scrub.
4. Preview IK motion.
5. Edit influence.
6. Export animation JSON.

No editor restart should be needed once the shared rig change is committed and synchronized.

## 4. Rig-Tweak integration

If the Animation Editor supports Rig-Tweak mode, use the existing shared rig authoring tools.

The artist may access and edit IK constraints through that mode.

Keep:
- Rig edits in rig history
- IK animation keys in animation history
- Separate dirty states
- Correct source/working-copy ownership

Do not accidentally turn target-rig edits into animation keyframes.

## 5. Dependency-safe editing

Existing animations may reference IK constraints by ID.

When renaming, deleting or changing an IK chain:
- Identify affected animation tracks
- Identify baked IK metadata references
- Show the affected documents
- Reject unsafe changes by default

Do not silently remove or remap authored animation keys.

A safe explicit reference migration can be added only if it can be implemented atomically across all affected documents with Undo/Redo and validation.

Otherwise leave the operation blocked with a clear explanation.

## 6. Shared constraint ownership

Preserve specialized runtime constraints:
- Foot planting
- Hand IK
- Primary weapon grip
- Secondary weapon grip

New generic IK constraints must not unexpectedly override system-owned targets.

Use the existing runtime precedence model.

## 7. Serialization and export

Verify:
- IK definitions survive rig JSON round-trip
- IK animation tracks reference valid constraint IDs
- Character packages include updated rig and animations
- CharacterLoader can load the result
- No editor-only gizmo state is serialized
- Existing supported character formats remain compatible

## 8. Runtime behavior

Load exported packages and verify:
- Default/static targets work
- Animated targets override or combine according to existing precedence
- IK influence works
- Facing works
- Existing two-bone solver remains authoritative
- Baked IK clips avoid double-solving

## 9. Regression testing

Verify no regressions to:
- Joint editing
- Bone hierarchies
- Sprite origins/offsets
- Attachments and skins
- Rig-Tweak mode
- Animation keyframes
- IK authoring
- IK baking
- Onion skinning
- Mirroring
- Export/import
- CharacterLoader

## 10. Tests

Add automated tests for:
- New character with new IK
- Existing character IK modification
- New IK target discovery
- Referenced-constraint deletion safety
- Renaming/reference safety
- Disabled constraints
- Undo/Redo
- Import/export round-trip
- Runtime animation evaluation
- Legacy character compatibility
- React/Phaser resource cleanup

## 11. Artist documentation

Update the artist guide with two tutorials.

**Creating IK on a new character**
- Build the bone chain
- Add IK constraint
- Position target
- Adjust bend/influence
- Create IK animation keys

**Editing IK on an existing character**
- Select constraint
- Adjust properties
- Understand dependency warnings
- Save/reload rig
- Verify existing animations

Explain the difference between:
- Static rig IK target
- Animated IK target
- Runtime target override
- Baked IK bone keyframes

## 12. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

Also run available integration and browser tests.

Do not claim manual testing that has not been performed.

## Definition of done

- IK constraints can be created on new characters
- Existing character IK can be modified
- New targets appear in Animation Editor
- IK target animation works immediately
- Unsafe reference changes are prevented
- Rig and animation histories remain separate
- Export/reload works
- CharacterLoader supports the resulting assets
- Existing IK systems remain compatible
- Tests, typecheck and build pass

## Final report

Provide:
1. New-character IK workflow
2. Existing-character IK workflow
3. Rig/Animation Editor synchronization
4. Dependency/reference safety
5. Runtime precedence behavior
6. Import/export compatibility
7. Files and APIs changed
8. Tests
9. Actual manual verification
10. Exact command results
11. Remaining limitations

Do not claim completion unless all checks pass.
