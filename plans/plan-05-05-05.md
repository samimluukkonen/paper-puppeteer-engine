# Paper Puppeteer Engine — v0.5.5.5
## IK Animation Authoring Production Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.5.4**

Already implemented:
- Serializable IK animation tracks
- Animated IK target evaluation
- Animated IK influence where supported
- React IK timeline and inspector
- Numeric IK target keyframe editing
- Visual IK handles
- Interactive target dragging
- Explicit IK target authoring
- Undo/Redo integration

This phase completes v0.5.5.

Do not introduce major new features.

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

---

## Goal

Harden IK Animation Authoring for real production use.

Focus on:
1. Runtime/evaluator correctness
2. Constraint precedence
3. Animation editing integration
4. Playback and interpolation
5. IK and bone animation interaction
6. Onion skinning
7. Mirroring compatibility
8. Import/export
9. Performance and resource lifecycle
10. Documentation and regression testing

## 1. Animation evaluation

Verify animated IK target keys are evaluated correctly at:
- Keyframe times
- Between keyframes
- Animation start
- Animation end
- Loop boundaries

Respect existing stepped/smooth interpolation.

Do not introduce duplicate interpolation algorithms.

## 2. Bone animation and IK interaction

Create a test animation containing both:
- Authored upper-arm/forearm rotation keys
- Animated hand IK target keys

Verify the engine applies ordinary bone animation before IK correction.

Test influence values:

```text
0.0 → no IK influence
0.5 → partial IK influence
1.0 → full IK influence
```

The resulting pose must follow existing solver blending semantics.

IK must never permanently modify authored bone keys.

## 3. Constraint precedence

Verify interactions with:
- Hand IK
- Foot IK
- Foot planting
- Primary weapon grip
- Secondary weapon grip
- Two-handed weapon constraints

Use the precedence policy established in v0.5.5.2.

Do not let two competing systems unpredictably overwrite the same target.

Provide clear developer-facing feedback for unsupported conflicts.

## 4. Animation blending

Test:
- Crossfading between animations with IK tracks
- Crossfading between IK and non-IK animations
- Layered animations
- Partial animations
- Animation completion
- Restart

Target positions and influence must transition according to the established runtime semantics.

Do not add new animation-state systems.

## 5. Timeline operations

Verify IK keys work correctly with applicable existing features:
- Create
- Update
- Delete
- Move
- Snapping
- Multi-selection
- Copy/paste
- Duplicate
- Group movement
- Undo/Redo

Ensure these operations preserve valid IK data.

If any generic operation remains unsupported, either implement it using the established typed keyframe infrastructure or clearly document why it is unavailable.

Do not copy-paste entire alternative editing implementations.

## 6. Visual manipulation

Test IK target dragging under:
- Zoom
- Pan
- Different puppet positions
- Puppet scaling
- Facing left/right
- Nested transforms
- Partial IK influence
- Unreachable targets

The handle must represent the authored target position, not necessarily the final solved end-effector position.

## 7. Onion skinning

Review compatibility with the existing ghost-pose system.

Ghost rendering must remain non-destructive and must not mutate active IK state.

If v0.5.3 currently samples authored bone poses only, preserve that documented behavior rather than silently displaying incorrect IK-corrected ghosts.

If the existing architecture supports isolated, read-only IK evaluation for ghosts, integrate it safely and test it.

Do not introduce IK baking as a shortcut for ghost rendering.

## 8. Mirroring

Verify v0.5.4 bone mirroring remains functional.

IK animation tracks must not be accidentally rewritten by regular bone mirroring operations.

Document that direct IK target mirroring is not yet part of this milestone unless it has already been implemented explicitly.

Do not confuse:
- Mirrored bone poses
- Mirrored IK target positions
- Preview facing

## 9. Animation events

IK sampling, target inspection and scrubbing must not fire animation events.

Normal playback must preserve existing event semantics.

No new event dispatch system.

## 10. JSON import/export

Test animations containing:
- Bone transform keys
- IK target position keys
- IK influence keys
- Interpolation metadata
- Animation events

Verify:

```text
Animation Editor
     ↓
Export animation.json
     ↓
Import/reload
     ↓
Same authored data
     ↓
Same evaluated animation
```

Canonical serialization should stabilize across repeated round trips.

Do not include:
- IK gizmo positions in screen space
- Selected handles
- Drag state
- Temporary preview overrides
- React state
- Phaser objects

## 11. CharacterLoader compatibility

Verify an exported IK animation can be loaded normally through the existing character package system.

Use CharacterLoader and Puppet playback without any editor-only conversion.

Example workflow:

```text
characters/demo/
  character.json
  rig.json
  animations/
    reach.json
```

The runtime must evaluate IK target animation using the rig's existing constraint definitions.

## 12. Backward compatibility

Verify all previously supported characters/animations without IK tracks still load and play normally.

Test older format versions according to the compatibility policy established in v0.5.5.1.

Do not break existing public Puppet APIs.

## 13. Performance

Test with:
- Multiple IK constraints
- Several animated IK tracks
- Normal playback
- Rapid scrubbing
- Onion skinning enabled
- Different playback speeds

Avoid:
- Duplicate solver passes
- Per-frame React state storms
- Rebuilding constraints every frame
- Repeated target object allocations where avoidable
- Unbounded Phaser GameObject creation

Optimize only where a real bottleneck exists.

## 14. Resource lifecycle

Verify cleanup when:
- Changing animation
- Changing character
- Switching editor routes
- Disabling IK gizmos
- Unmounting React components
- Destroying the Phaser scene

No stale subscriptions, pointer handlers or leaked debug handles.

## 15. Edge cases

Test:
- No IK constraints
- No IK animation tracks
- Missing target keys
- Zero-duration animations
- One target key
- Invalid target reference
- Unreachable targets
- Zero influence
- Partial influence
- Large playback delta
- Negative/invalid values
- Animation import failure
- Undo/Redo after IK edits

No crashes or invalid transforms.

## 16. Full regression pass

Verify the following remain functional.

### Rig Editor

- Joint manipulation
- Bone hierarchy
- Sprite origins/offsets
- Slots
- Bind/rest pose
- IK preview
- Undo/Redo
- JSON export

### Animation Editor

- Bone keyframe authoring
- Playback
- Timeline
- Multi-selection
- Group movement
- Copy/paste
- Interpolation
- Events
- Onion skinning
- Mirroring
- Import/export

### Runtime

- Puppet playback
- Crossfading
- Animation layers
- Two-bone IK
- Foot planting
- Hand constraints
- Weapon constraints
- Attachments/skins
- Facing
- CharacterLoader

## 17. Artist documentation

Update documentation with an IK animation workflow.

Include a practical example:

**Animating a character reaching for an object**

1. Open the character in Animation Editor.
2. Select the hand IK constraint.
3. Move to time 0.
4. Position hand target at starting point.
5. Create IK target key.
6. Move to time 0.5.
7. Drag hand target toward object.
8. Create another key.
9. Adjust interpolation.
10. Play the animation.
11. Tune IK influence.
12. Export animation.json.

Explain:
- IK targets vs bone transform keys
- Target coordinate space
- IK influence
- Target reachability
- Interaction with existing bone animation
- Difference between IK authoring and IK baking

## 18. Automated tests

Expand tests for:
- IK data validation
- Target evaluation
- Influence evaluation
- Layer/crossfade behavior
- Constraint precedence
- Keyframe editing
- Undo/Redo
- Coordinate conversion
- Facing
- Source immutability
- JSON round-trip
- CharacterLoader integration
- Old animation compatibility
- Resource cleanup

Use existing test infrastructure.

Do not claim manual UI verification unless actually performed.

## 19. Do NOT implement yet

Explicitly defer:
- IK baking into bone keyframes
- New IK solver types
- Full IK rig creation GUI
- Advanced IK target mirroring
- Physics
- Ragdolls
- Mesh deformation
- Scene choreography
- Sprite import/replacement
- Animation Editor Rig-Tweak mode

## 20. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

---

## Final v0.5.5 definition of done

v0.5.5 is complete when:
- IK target animations are serializable
- Animated IK targets evaluate correctly
- Existing IK solvers are reused
- IK influence works
- Target tracks exist in Animation Editor
- React IK inspector works
- Visual target handles work
- Dragging and numeric editing work
- Keyframe operations integrate with history
- Constraint precedence remains correct
- Playback/crossfading remain functional
- Onion skinning/mirroring remain safe
- Source animation remains immutable
- IK output is never baked accidentally
- Export/import works
- CharacterLoader supports the authored animations
- Existing characters remain compatible
- Tests, typecheck and build pass

## Final report

Provide:
1. Implemented functionality
2. Final IK authoring architecture
3. Runtime evaluation and constraint order
4. Target coordinate representation
5. React editor/Phaser gizmo integration
6. IK influence/blending
7. Timeline/keyframe workflow
8. Compatibility and serialization
9. Performance/resource lifecycle
10. Files/APIs changed
11. Tests
12. Manual verification
13. Documentation changes
14. Required command results
15. Remaining deferred features

Do not claim completion unless all required commands pass.
