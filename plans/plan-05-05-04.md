# Paper Puppeteer Engine — v0.5.5.4
## Visual IK Target Manipulation

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.5.3**

The Animation Editor now supports:
- IK target timeline tracks
- IK target selection
- Numeric target editing
- IK keyframe creation/update/deletion
- Animated IK evaluation
- Existing solver integration
- Undo/Redo
- React inspector integration

Do not rebuild those systems.

Technology stack: React, TypeScript, Phaser, Vite, npm, strict TypeScript and ES modules.

---

## Goal

Implement **v0.5.5.4 — Visual IK Target Manipulation**.

Allow artists to manipulate IK targets directly in the Phaser character preview.

Implement:
1. Visible IK target handles
2. Direct pointer dragging
3. Live IK preview
4. Local/world coordinate conversion
5. Explicit target keyframe commitment
6. Undo/Redo gesture handling
7. Target selection synchronization
8. Visibility and interaction controls

## 1. IK target handles

Render editor-only handles for IK constraints.

For example:

```text
leftHandIK     → draggable handle
rightHandIK    → draggable handle
leftFootIK     → draggable handle
rightFootIK    → draggable handle
```

Use actual existing constraints.

Handles must not be added to production character rendering.

## 2. Handle visualization

Each IK target should have a distinct visual indicator.

For example:
- Small circle or crosshair at target
- Optional line to the constrained end effector
- Highlight for selected target
- Optional indication of active influence

Use Phaser's existing debug/editor rendering facilities where practical.

Do not create a new rendering engine.

## 3. Selection

Clicking an IK handle should:
- Select the corresponding IK constraint
- Update React inspector
- Update timeline selection context
- Display its current target values

Do not accidentally select the hand/foot bone for transform editing.

## 4. Dragging

Allow dragging an IK target with pointer input.

Conceptually:

```text
pointer down on target
        ↓
drag
        ↓
convert pointer to authored target coordinates
        ↓
temporarily update target preview
        ↓
existing IK solver updates limb
        ↓
pointer release
```

Use existing editor pointer and coordinate utilities.

## 5. Coordinate correctness

Handle:
- Phaser camera transforms
- Editor zoom
- Editor pan
- Puppet translation
- Puppet scale
- Left/right facing
- Target local coordinate space

Do not directly save pointer screen coordinates as IK keys.

Use explicit conversion functions.

## 6. Live preview

While dragging:

- Target handle follows the pointer
- Existing IK solver updates the limb
- Joint hierarchy remains intact
- Bend direction remains stable
- Unreachable targets use existing solver behavior

Do not create new IK mathematics.

## 7. Commit model

Use explicit keyframe authoring semantics consistent with the Animation Editor.

Preferred approach:

- Dragging previews an IK target position.
- On release, the previewed position remains as a temporary editor value.
- The artist commits it using Set Target Key or an equivalent clear action.

If the existing editor uses committed-on-release gestures, that is also acceptable, provided the behavior is clearly communicated and Undo/Redo remains correct.

Do not silently switch between authoring modes.

Uncommitted preview state must never leak into exported animation JSON.

## 8. History

One committed drag/keyframe edit must create one history operation.

Do not create history entries for every pointer movement.

Cancelled gestures must not create history entries.

## 9. Escape/cancel

Support cancelling an active target drag.

Preferred:

```text
Escape
→ cancel drag
→ restore previous preview target
→ no authored change
```

Use existing gesture transaction conventions.

## 10. CurrentTime

While dragging an IK target:
- Pause playback
- Preserve currentTime
- Keep playhead stationary
- Do not modify unrelated keyframes

Do not let automatic playback fight with target manipulation.

## 11. Target vs final end-effector position

Clearly distinguish:
- Requested IK target
- Actual solved hand/foot location

When a target is unreachable, the handle should remain at the requested target while the limb uses existing unreachable-target behavior.

Do not silently clamp authored target coordinates merely to make the limb reach them.

## 12. IK influence

Respect current influence.

If influence is less than 1, the limb may not fully reach the target.

Do not automatically set influence to 1 during normal dragging unless the user explicitly requests an appropriate authoring action.

## 13. Existing constraints

Verify target dragging does not break:
- Weapon primary grip
- Secondary hand grip
- Existing foot planting
- Hand IK
- Leg IK
- Existing constraint precedence

When a constraint is controlled by a higher-priority system, follow the ownership policy defined in v0.5.5.2.

If direct manipulation is unavailable, show a useful disabled state instead of silently overriding the constraint.

## 14. Temporary preview state

Keep provisional target positions separate from authored animation data.

Do not mutate:
- Source animation
- Working keyframes before commit
- Rig bind pose
- Skin/attachment definitions

Preview may temporarily affect the final evaluated pose.

## 15. Onion skinning

Ensure onion skinning remains functional.

Ghosts should reflect committed authored animation data.

Do not accidentally use uncommitted target drag state for neighboring sampled poses.

## 16. Mirroring

Existing bone/keyframe mirroring must continue working.

Do not implement mirrored IK target copying yet.

That is a separate authoring capability and should not happen automatically.

## 17. React lifecycle

React controls and Phaser handles must remain synchronized.

Avoid:
- Duplicate event listeners
- Stale selected target state
- Leaked Phaser objects
- Pointer handlers surviving editor unmount
- Recreating handles unnecessarily on every React render

Use existing integration architecture.

## 18. Tests

Add tests for:
- Target selection
- Coordinate conversion
- Preview updates
- Drag commit/cancel
- CurrentTime preservation
- Source immutability
- Dirty-state behavior
- Undo/Redo
- Unreachable targets
- Facing
- Puppet scaling
- Constraint precedence
- React/Phaser synchronization

## 19. Manual verification

Using an existing IK-enabled puppet:

1. Select hand IK.
2. Drag its target.
3. Verify arm follows.
4. Cancel drag.
5. Drag to another position.
6. Commit target key.
7. Scrub to another time.
8. Drag and commit a second key.
9. Play animation.

Repeat with foot IK.

Also test:
- Facing left/right
- Zoom/pan
- Puppet scaling
- Unreachable target
- IK influence
- Undo/Redo
- Onion skinning

## 20. Do NOT implement yet

- IK baking
- Mirrored IK target operations
- New IK solver types
- Constraint creation GUI
- New physics systems
- Scene choreography
- Rig joint modification

## 21. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix every failure.

## Definition of done

- IK target handles render
- Handles can be selected
- Dragging works
- Solver updates live
- Coordinate conversion is correct
- Authored commit/cancel is predictable
- Undo/Redo works
- Playback and timeline remain synchronized
- Existing constraints remain functional
- React/Phaser lifecycle is safe
- Tests, typecheck and build pass

## Final report

Provide:
1. Handle rendering architecture
2. Pointer/coordinate handling
3. Drag and commit semantics
4. IK preview behavior
5. Constraint precedence
6. React integration
7. Files/APIs changed
8. Tests
9. Manual verification
10. Required command results
11. Deferred features

Do not claim completion unless all required commands pass.
