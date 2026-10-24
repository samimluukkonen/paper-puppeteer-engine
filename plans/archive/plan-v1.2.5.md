# Paper Puppeteer Engine — v1.2.5
## Cinematic Cuts, Fades & Transitions

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.2.4**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Already implemented:
- Scene backgrounds and layers
- Parallax
- Cinematic Camera
- Camera timeline and keyframe interpolation
- Deterministic scene playback/scrubbing
- Actor choreography
- Scene export/import

Do not create a second scene runtime.

## Goal

Introduce simple cinematic shot changes and fade effects controlled through Scene Editor's timeline.

Examples:
- Cut instantly from a wide shot to a close-up.
- Fade from black at the beginning.
- Fade to black at the end.
- Fade back in after a short hold.

Focus on practical 2D storytelling features.

## 1. Inspect existing timeline and camera

Review:
- Scene timeline tracks
- Camera keyframes
- Scene time evaluation
- Current Phaser camera rendering
- Existing fade/camera utilities
- Scene cues and transitions
- SceneDefinition schema

Reuse existing implementations when possible.

## 2. Shot cuts

Implement a clear way to create instantaneous camera shot changes.

A cut can be represented by stepped camera interpolation or by an explicit shot marker using the existing camera model.

Avoid creating competing camera owners.

Example:

```text
TIME       0s      3s      6s

Camera     Wide | Close-up | Wide
                  ^
                 Cut
```

At a cut boundary, the new frame must appear immediately.

The result must be deterministic when seeking to the exact boundary.

## 3. Fade effects

Support a small set of cinematic fades:
- Fade in from black/color
- Fade out to black/color
- Optional fade-out followed by fade-in

Use a color overlay or an equivalent Phaser-supported mechanism.

Define authored properties such as:
- Start time
- Duration
- Direction/type
- Color
- Stable ID

Do not implement arbitrary visual effects.

## 4. Timeline UI

Add a compact transition/effect track.

Example:

```text
SCENE TIMELINE

Camera      Wide | Close-up ─── Wide

Transitions Fade In     Cut   Fade Out
```

Allow:
- Add effect
- Select
- Change time
- Adjust duration
- Delete
- Undo/Redo

Reuse existing timeline editing utilities.

## 5. Deterministic seeking

This is critical.

The fade state at any time must be evaluable from authored scene data.

For example:

```ts
evaluateTransitionAtTime(scene, time)
```

Return the required overlay color/opacity or equivalent state.

Do not use independent wall-clock tweens as the authoritative model.

Seeking forward/backward must not accidentally replay a fade animation from its beginning.

## 6. Transition conflicts

Define how overlapping fades behave.

For the initial implementation, rejecting incompatible overlapping fade intervals is acceptable.

Do not silently stack contradictory effects.

Camera cuts and fades may coexist when their semantics are well defined.

## 7. Scene playback

During runtime playback:
- Camera cuts occur at authored times.
- Fade opacity follows the scene clock.
- Actors and animations continue according to existing scene choreography.
- Scene cues retain existing event semantics.

Seeking must not dispatch unrelated external events.

## 8. Rendering order

A full-frame fade should visually cover:
- Backgrounds
- Actors
- Foreground artwork

Do not permanently obscure React editor controls.

Separate cinematic overlay rendering from the editor's selection handles and guide overlays.

## 9. Scene transitions versus shot transitions

For this milestone, implement transitions **within one scene**.

Do not require automatic loading/unloading of an entirely separate scene or project.

Cross-scene orchestration can be added later if needed.

## 10. Validation and persistence

Validate:
- Start times
- Durations
- Supported transition types
- Color values
- Overlapping intervals
- Scene duration boundaries

Persist the transitions in authored scene data.

Keep existing scenes compatible.

## 11. Tests

Cover:
- Instant camera cut
- Exact cut boundary
- Fade in
- Fade out
- Fade duration
- Seek into middle of fade
- Backward seek
- Pause/resume
- Overlapping fades
- Invalid parameters
- Undo/Redo
- Export/import
- Standalone playback
- Overlay cleanup

## 12. Manual verification

1. Create a scene with two Actors.
2. Start with a wide camera shot.
3. Add a cut to a close-up.
4. Add fade-in at the beginning.
5. Add fade-out near the end.
6. Preview.
7. Scrub to points inside the fades.
8. Verify correct opacity.
9. Scrub across cut boundaries.
10. Export/reload.

## 13. Out of scope

Do not implement:
- Cross-scene loading
- Full nonlinear video editor
- 3D camera effects
- Motion blur
- Complex shader transitions
- Audio/dialogue synchronization

## 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

- Camera cuts are supported.
- Fade in/out effects are supported.
- Effects can be authored on the scene timeline.
- Seeking is deterministic.
- Actors and backgrounds render correctly beneath fades.
- Undo/Redo and export/import work.
- Tests, typecheck and build pass.

## Final report

Describe cut semantics, fade evaluation, timeline integration, rendering order, files changed, tests and exact verification results.
