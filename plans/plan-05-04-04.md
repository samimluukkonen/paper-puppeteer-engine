# Paper Puppeteer Engine — v0.5.4.4
## React Mirroring Tools UI

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.4.3**

Already implemented:
- Bone symmetry mapping
- Automatic pair matching
- Manual mapping support in the model
- Pose mirroring math
- Mirrored keyframe authoring operations
- Atomic Undo/Redo integration

Do not rewrite these systems.

The editor uses **React + TypeScript**, with Phaser rendering.

Use existing React components, hooks and state-management conventions.

Do not introduce another UI framework.

---

## Goal

Implement **v0.5.4.4 — React Mirroring Tools UI**.

Expose mirrored pose/keyframe authoring through the Animation Editor.

Implement:
1. Mirroring panel
2. Bone pair configuration
3. Direction controls
4. Current-pose mirror action
5. Selected-keyframe mirror action
6. Non-destructive mirror preview
7. Validation feedback
8. Shortcut/help integration

## 1. React mirror panel

Create a compact panel integrated with the existing Animation Editor.

Conceptual UI:

```text
MIRROR TOOLS

Symmetry Mapping
[ Configure Bone Pairs ]

Direction:
(o) Left → Right
( ) Right → Left
( ) Swap

Actions:
[ Preview Mirrored Pose ]
[ Mirror Current Pose ]
[ Mirror Selected Keys ]
```

Match current editor styling.

Do not redesign the entire UI.

## 2. Bone mapping configuration

Provide a React UI for:
- Viewing inferred pairs
- Editing pairs
- Adding manual pairs
- Removing pairs
- Validating mappings
- Showing unpaired bones

Example:

```text
LEFT             RIGHT

leftUpperArm  ↔  rightUpperArm
leftForearm   ↔  rightForearm
leftHand      ↔  rightHand
```

Use existing rig bone IDs.

Do not make matching dependent on specific character names.

## 3. Mapping persistence

Review existing editor configuration/persistence conventions.

Symmetry mappings should be reusable when reopening the same rig.

Prefer an established editor-side configuration mechanism.

If the project has no suitable persistence mechanism, support a small validated mapping import/export facility or clearly scoped session persistence.

Do NOT silently add editor-only mappings to `animation.json`.

Do not change the production rig schema without explicit compatibility handling.

## 4. Direction controls

Provide:
- Left → Right
- Right → Left
- Swap

Display the selected direction clearly.

Never silently choose Swap if the user requested one-way copying.

## 5. Mirror current pose

When clicked:
- Pause playback
- Use currentTime
- Use the validated mapping
- Invoke the existing authored mirror operation
- Refresh Puppet preview
- Refresh timeline
- Preserve normal history/dirty semantics

The action must be explicit.

## 6. Mirror selected keyframes

Enable when compatible selected keys exist.

The operation must:
- Respect current selection
- Mirror only supported source tracks
- Preserve time and interpolation
- Commit one history operation
- Select resulting keys appropriately

Show an understandable reason when disabled.

## 7. Non-destructive preview

Add a simple preview of the mirrored pose before committing.

Reuse existing pose evaluation and editor rendering/ghost infrastructure where practical.

The preview must not:
- Write keyframes
- Mutate rig data
- Change `currentTime`
- Mark animation dirty
- Dispatch events
- Create Undo history

A translucent overlay of the proposed mirrored result is suitable.

If sharing the onion-skin renderer, keep mirror preview and temporal ghost poses logically distinct.

## 8. Visual clarity

Display which side is:
- Source
- Destination

Make it difficult to accidentally overwrite the wrong side.

A concise confirmation may be used for destructive operations if existing editor conventions justify it.

Do not add confirmations for harmless selection/preview actions.

## 9. Selection integration

Use existing Animation Editor selection state.

Do not introduce competing React state for:
- Selected bone
- Selected keys
- Primary key
- Current time

React should reflect authoritative editor/controller state.

## 10. Error feedback

Show meaningful feedback for:
- No paired bone
- Invalid mapping
- Unsupported transform
- Missing destination
- Invalid animation
- Collision rejection

Do not show only generic errors.

## 11. Dirty state

These do not mark animation dirty:
- Opening mirror panel
- Changing direction
- Inspecting pairs
- Previewing mirrored pose
- Modifying editor-only pair configuration

Only committed authored mirror operations mark animation dirty.

## 12. React lifecycle

Use current React integration conventions.

Avoid:
- Duplicate Phaser scenes
- Duplicate editor controllers
- Unnecessary re-evaluation on every React render
- Stale selection closures
- Leaked listeners
- Repeated renderer construction

Clean up transient mirror preview resources properly.

## 13. Tests

Test:
- Direction changes
- Valid/invalid mapping UI state
- Button enable/disable state
- Correct controller invocation
- Preview immutability
- Commit updates working animation
- History integration
- React/editor synchronization
- Mapping configuration validation
- Source unchanged

Use existing component-test tooling if available.

## 14. Manual verification

Test:
- Auto-detected pairs
- Manual pair override
- Preview left → right
- Preview right → left
- Preview swap
- Commit current pose
- Commit selected keys
- Undo/Redo
- Invalid mapping
- Timeline refresh
- Onion skinning enabled
- Skin/facing changes

No editor crashes or unexpected data mutations.

## 15. Do NOT implement

- Sprite import/replacement
- Rig joint modifications
- Mirrored IK target editing
- Mirrored event editing
- Advanced animation retargeting
- Scene choreography
- Mesh deformation

## 16. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- React mirroring panel exists
- Bone pairs can be configured
- Direction controls work
- Mirrored pose preview works
- Current pose can be mirrored
- Selected keys can be mirrored
- Selection and timeline stay synchronized
- Mapping errors are actionable
- React/Phaser lifecycle remains clean
- Tests, typecheck and build pass

## Final report

Report:
1. Implemented React components
2. Controller integration
3. Mapping configuration workflow
4. Preview implementation
5. Authored command behavior
6. Files/APIs changed
7. Tests and manual checks
8. Verification results
9. Deferred work

Do not claim completion unless all required commands pass.
