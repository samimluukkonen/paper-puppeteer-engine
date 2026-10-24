# Paper Puppeteer Engine — v1.1.4
## Motion Cleanup & Diagnostics

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.1.3**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing functionality:
- Keyframe editing
- Graph Editor with interpolation curves
- IK animation/baking
- Animation playback and scrubbing
- Pose Library
- Animation Variations
- Undo/Redo
- Validation and export

## Goal

Implement **v1.1.4 — Motion Cleanup & Diagnostics**.

Help the artist identify motion problems and safely simplify authored animations.

The feature should be useful without automatically changing the artist's work.

## 1. Inspect existing evaluators

Review:
- Keyframe interpolation
- Rotation handling
- IK evaluation
- Baked IK metadata
- Animation event timing
- Timeline selection
- Existing diagnostic utilities

Reuse actual animation evaluation.

## 2. Motion diagnostics panel

Add a compact **Motion Diagnostics** panel in Animation Editor.

Example:

```text
MOTION DIAGNOSTICS

Selected animation: walk-cycle

Possible issues:

• Abrupt right-arm rotation at 0.45s
• Large position change at 0.80s
• 3 potentially redundant keyframes

[Inspect] [Preview Cleanup]
```

Diagnostics must be computed from real data.

Do not invent findings.

## 3. Abrupt motion detection

Implement configurable heuristics for:
- Large rotation changes
- Sudden translation changes
- Discontinuous or unusually rapid motion
- Suspicious interpolation changes

Use actual time differences between keys.

Do not flag legitimate fast attacks as definitely incorrect.

Clearly label findings as possible issues.

## 4. Redundant keyframe detection

Identify keyframes that may be removable without meaningfully changing evaluated motion.

Use tolerances appropriate to each property.

Preserve:
- Animation endpoints
- Authored events
- IK semantics
- Distinct stepped transitions
- Nonlinear Bézier motion
- Required constraint/baking metadata

If removing a key changes the motion beyond tolerance, it is not safely redundant.

A conservative implementation is preferable to an aggressive destructive optimizer.

## 5. Cleanup preview

Before deleting keys:
- Show candidate keys.
- Show before/after motion.
- Show expected numerical deviation where measurable.
- Allow cancel.
- Require explicit Apply.

Do not automatically edit authored data simply because diagnostics ran.

## 6. Safe cleanup operation

Apply selected cleanup using existing keyframe-authoring APIs.

Use one Undo transaction.

Revalidate after cleanup.

Preserve all unrelated animation properties and events.

## 7. Timeline integration

Selecting a diagnostic should navigate to the corresponding time/track.

Where practical, highlight the affected keys.

Do not duplicate timeline selection ownership.

## 8. IK and contact diagnostics

If the project already has foot contact markers, consider optional read-only ground/contact deviation diagnostics.

Do not assume markers exist.

Do not implement automatic foot locking or foot planting as part of cleanup.

If exact detection requires authored contact intervals that do not exist, clearly defer that diagnostic.

## 9. Performance

Diagnostics can be initiated manually rather than recalculated continuously.

Avoid expensive full-animation analysis every frame.

Use deterministic sampling with documented resolution and tolerances.

## 10. Tests

Cover:
- Abrupt motion
- Smooth motion
- False-positive boundaries
- Redundant linear keys
- Nonredundant Bézier keys
- Stepped keys
- Rotation wraparound
- IK animation
- Baked IK
- Event preservation
- Cleanup preview
- Undo/Redo
- Export/import
- Source immutability

## 11. Manual verification

1. Open a walking animation.
2. Add an unnecessary middle keyframe.
3. Run diagnostics.
4. Inspect candidates.
5. Preview removal.
6. Apply cleanup.
7. Compare resulting playback.
8. Undo/Redo.
9. Export/reload.
10. Test a fast attack animation and verify legitimate motion isn't automatically removed.

## 12. Out of scope

Do not implement:
- Automatic animation generation
- AI-based motion correction
- Physics-based correction
- Automatic foot locking
- New IK solvers
- Animation retargeting

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

- Motion diagnostics are available.
- Potential problems are clearly presented.
- Redundant keys can be identified conservatively.
- Cleanup can be previewed and cancelled.
- Applying cleanup is explicit and undoable.
- Motion remains within verified tolerances.
- IK and events remain compatible.
- Tests, typecheck and build pass.

## Final report

Provide diagnostic methods, tolerances, cleanup safety, before/after evaluation, files/APIs changed, tests and exact verification results.
