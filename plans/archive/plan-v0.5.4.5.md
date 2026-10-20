# Paper Puppeteer Engine — v0.5.4.5
## Mirrored Animation Tools Hardening & Regression

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.4.4**

Already implemented:
- Bone symmetry mapping
- Automatic/manual pairing
- Pure pose mirroring
- Mirrored keyframe authoring
- React mirror controls
- Non-destructive mirrored pose preview
- Undo/Redo integration

This phase completes v0.5.4.

Do not introduce major new features.

Tech stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

---

## Goal

Harden mirroring for real artist workflows.

Focus on:
1. Pose correctness
2. Symmetrical/asymmetrical rigs
3. Hierarchical transforms
4. Animation data integrity
5. Keyframe workflows
6. IK compatibility
7. Onion skinning compatibility
8. React/Phaser synchronization
9. Documentation
10. Regression testing

## 1. Symmetrical rigs

Verify accurate mirroring on a normal humanoid rig.

Test:
- Upper arms
- Forearms
- Hands
- Thighs
- Lower legs
- Feet

Include nested and rotated parent bones.

Expected result: reflected motion should behave naturally across the character's symmetry axis.

## 2. Asymmetrical rigs

Test configurations with:
- Unequal bone lengths
- Different rest rotations
- Different joint offsets
- Missing counterpart bones
- Nonuniform scales
- Different attachment sizes

Do not assume pixel-perfect results on inherently asymmetric artwork.

Use rest-pose-aware transforms where supported.

Unsupported transformations must produce clear feedback rather than corrupted authored animation.

## 3. Round-trip symmetry

For supported symmetric rigs, test:

```text
Original pose
↓
Mirror left → right
↓
Mirror right → left
↓
Compare with original
```

Use reasonable floating-point tolerance.

Also test Swap twice.

Document limitations where the existing transform model prevents exact involution.

## 4. Sparse keyframes

Test partial property tracks.

Example:

```text
leftForearm:
rotation keys only
```

Mirroring should not unexpectedly generate unrelated translation/scale keys.

Preserve sparse authored animations.

## 5. Interpolation preservation

Verify all supported interpolation metadata survives mirroring.

Test:
- Stepped
- Smooth
- Mixed selection
- Copy/paste after mirroring
- Key movement after mirroring
- Undo/Redo

## 6. Collision handling

Test destination tracks with existing keys.

Ensure:
- Established collision policy is followed
- No duplicate keys are introduced
- Atomic operations do not partially commit
- Undo restores exact destination data
- Redo reproduces results

## 7. Animation playback

After creating mirrored keys, verify:
- Play/Pause
- Looping
- Restart
- FPS preview
- Stepped interpolation
- Smooth interpolation
- Scrubbing
- Playback speed

The existing runtime evaluator must work without an editor-specific animation path.

## 8. IK compatibility

Verify mirroring does not accidentally save IK-corrected transforms.

Test arm IK and leg IK where available.

Preserve:

```text
authored mirrored pose
↓
normal procedural IK
↓
final rendered pose
```

Mirrored IK target authoring remains a future feature.

## 9. Facing and artwork

Verify left/right preview facing does not unexpectedly alter authored mirror operations.

Changing character facing must not mutate:
- Bone mappings
- Keyframe values
- Interpolation
- Source animation

Attachments and skins must remain unchanged unless specifically authored by another existing feature.

## 10. Onion skinning

Verify temporal ghost poses correctly reflect newly mirrored animation.

After mirror commit:
- Previous ghosts update
- Next ghosts update
- Current pose updates

The mirrored preview must not corrupt onion-skin rendering state.

Test enabling/disabling both features repeatedly.

## 11. Events

Mirroring bone transforms must not:
- Add animation events
- Delete events
- Rewrite event payloads
- Dispatch events during preview

Normal playback event behavior must remain intact.

## 12. React lifecycle

Verify:
- Opening/closing mirror panel
- Switching animations
- Switching characters
- Changing rig
- Navigating between editor routes
- Unmounting React editor components

No stale listeners, retained invalid mappings or leaked Phaser preview objects.

## 13. Serialization

Test exporting/importing animations containing mirrored keys.

Verify:
- Identical key times
- Identical values within existing serialization precision
- Preserved interpolation
- No editor-only symmetry metadata
- Stable JSON round-trip
- Compatibility with CharacterLoader

## 14. History

Perform a stress sequence:

```text
Mirror pose
Mirror selected keys
Move keys
Change interpolation
Undo
Undo
Redo
Mirror opposite direction
Undo
Redo
```

History and dirty state must remain coherent.

## 15. Automated tests

Expand test coverage for:
- Mapping validation
- Asymmetric rig handling
- Hierarchical transforms
- Inverse mirroring
- Sparse tracks
- Collision atomicity
- Undo/Redo
- Source immutability
- IK safety
- Facing safety
- Onion-skin refresh
- Serialization
- React component/controller lifecycle

## 16. Full regression pass

Verify no regressions to:

**Rig Editor**
- Bone/joint editing
- Sprite origin/offset
- Slot manipulation
- Undo/Redo
- Rig export

**Animation Editor**
- Timeline
- Bone/property tracks
- Keyframe creation
- Keyframe selection
- Marquee selection
- Group movement
- Snapping
- Copy/paste
- Duplicate
- Interpolation
- Events
- Playback
- Onion skinning
- Animation import/export

**Runtime**
- Puppet animation
- Layered animation
- Crossfading
- IK
- Attachment/skin handling
- Character loading

## 17. Documentation

Update artist-facing documentation.

Explain:
- What mirrored posing does
- How bones are paired
- How to configure manual pairs
- Left-to-right vs right-to-left vs Swap
- How to mirror current pose
- How to mirror selected keyframes
- How preview differs from commit
- How collisions work
- How to Undo
- Asymmetrical rig limitations
- Difference between mirrored animation and facing/sprite flipping

Include a short walkthrough of creating a left-arm movement and mirroring it onto the right arm.

## 18. Scope restrictions

Do NOT implement:
- New sprite import/replacement tools
- Rig joint editing from Animation Editor
- IK-target authoring
- IK baking
- Animation retargeting across different rigs
- Scene choreography
- Physics
- Mesh deformation

## 19. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

Do not claim manual verification of interactions that were not actually exercised.

---

## Final v0.5.4 definition of done

v0.5.4 is complete when:

- Left/right bone mapping is reliable
- Manual mapping configuration works
- Pose mirroring is correct for supported rig configurations
- Mirrored keys can be authored
- Keyframe time/interpolation are preserved
- Sparse tracks remain sparse
- Operations are atomic and undoable
- React mirror UI works
- Non-destructive preview works
- Asymmetric rigs are handled safely
- IK is not baked
- Onion skinning remains functional
- Animation events are unaffected
- Rig Editor has no regressions
- Import/export works
- Artist documentation is updated
- Tests pass
- Typecheck passes
- Build passes

## Final report

Provide:
1. Implemented functionality
2. Final symmetry mapping architecture
3. Mirroring mathematics
4. Supported/unsupported rig configurations
5. Keyframe authoring behavior
6. Collision and Undo/Redo semantics
7. React editor integration
8. IK/onion-skin/facing behavior
9. Files/APIs changed
10. Automated tests
11. Manual verification
12. Required command results
13. Remaining deferred features

Do not claim completion unless all required commands pass.
