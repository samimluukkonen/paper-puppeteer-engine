# Paper Puppeteer Engine — v1.2.4
## Camera Timeline & Keyframe Animation

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.2.3**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing features:
- Scene Editor timeline
- Actor action tracks
- Scene playback and deterministic scrubbing
- Cinematic Camera controller
- Editor/cinematic camera separation
- v1.1 Graph Editor and animation curve interpolation
- Undo/Redo and autosave

Do not rebuild existing animation or scene scheduling systems.

## Goal

Make the Cinematic Camera animatable using Scene Editor timeline keyframes.

For example:
- Start with a wide shot.
- Slowly pan toward an Actor.
- Zoom in during a dramatic moment.
- Hold the final shot.

## 1. Inspect existing timeline architecture

Review:
- Scene action tracks
- Timeline selection and dragging
- Time ruler
- Snapping
- Scene clock
- Existing interpolation utilities
- Cinematic Camera state
- SceneDefinition serialization

Reuse shared utilities where practical.

## 2. Camera timeline data

Introduce optional authored camera tracks for:
- Center X
- Center Y
- Zoom

Prefer a typed model that reuses existing curve/keyframe evaluation concepts.

Do not duplicate scene animation documents unnecessarily.

Initial cinematic camera settings provide the fallback when no camera keys exist.

## 3. Scene timeline UI

Add a Camera track or track group:

```text
SCENE TIMELINE

Actor A     Walk ──── Bow
Actor B     Idle ──── Bow

Camera
  X         •────────•
  Y         •────────•
  Zoom      •────•───•
```

Use actual existing timeline components.

Support selecting keys and inspecting their properties.

## 4. Camera keyframe authoring

Provide:
- Set Camera Key
- Select key
- Move key time
- Edit camera X/Y/zoom
- Delete key
- Duplicate key
- Change interpolation
- Undo/Redo

Avoid creating camera keys automatically when the artist merely pans around the editor viewport.

## 5. Interpolation

Reuse existing interpolation evaluation wherever practical.

Support:
- Linear
- Stepped
- Smooth/eased
- Bézier if compatible with the v1.1 system

Do not create a separate curve solver with subtly different numerical behavior.

Ensure camera zoom remains valid throughout interpolation; clamp or reject invalid curves using an explicit, documented policy.

## 6. Deterministic camera evaluation

Create a pure or isolated camera evaluation path:

```ts
evaluateCameraAtTime(
  scene,
  time
): CinematicCameraState
```

Adapt to actual types.

The result must not depend on the previously previewed time.

Seeking to 5 seconds should produce the same camera state whether coming from 2 seconds or 9 seconds.

Do not use accumulated Phaser tweens for authoritative seeking.

## 7. Scene playback integration

During real scene playback:
- Camera follows the authored camera track.
- Actors use existing choreography.
- Backgrounds use their parallax settings.
- All components share the same scene clock.

Avoid independent camera timers.

## 8. Editor behavior

Maintain a clear separation between:
- Editing camera keyframes
- Moving the editor viewport
- Viewing the scene through the cinematic camera

Provide an explicit Camera Edit mode or equivalent if necessary.

Never silently commit camera keys from navigation gestures.

## 9. Camera targeting

An explicit "Frame Selected Actor" action may set a key at the current playhead.

Do not automatically animate continuous Actor tracking in this milestone.

Live tracking creates additional ownership and deterministic seeking questions that should be addressed separately.

## 10. Compatibility

Old scenes with a static camera or no camera configuration must continue playing.

Scene export/import must preserve keyframe curves.

Camera animation data must not affect character rigs or animation files.

## 11. Tests

Cover:
- Create camera keys
- Position interpolation
- Zoom interpolation
- Stepped changes
- Bézier curves
- Timeline dragging
- Scrubbing backward/forward
- Direct seek equivalence
- Playback pause/restart
- Actor/camera synchronization
- Parallax
- Undo/Redo
- Export/import
- Backward compatibility

## 12. Manual verification

1. Create a scene with two Actors.
2. Add camera key at 0 seconds.
3. Add another at 3 seconds.
4. Pan toward Actor A.
5. Add a zoom key at 5 seconds.
6. Preview the scene.
7. Scrub backward and forward repeatedly.
8. Verify camera positions are identical at identical times.
9. Adjust interpolation.
10. Export/reload.

## 13. Out of scope

Do not implement:
- Scene cuts/fades yet
- Camera shake
- Automatic cinematic direction
- Multiple simultaneous cinematic cameras
- Physics tracking
- Dialogue/audio

## 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

- Camera position/zoom can be keyframed.
- Camera timeline integrates with Scene Editor.
- Curves use established evaluator semantics.
- Seeking is deterministic.
- Editor navigation never creates accidental camera keys.
- Export/import works.
- Actors and parallax remain synchronized.
- Tests, typecheck and build pass.

## Final report

Describe camera track model, evaluator, timeline UI, time semantics, compatibility, files changed, tests and exact verification results.
