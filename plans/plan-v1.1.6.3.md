# Paper Puppeteer Engine — v1.1.6.3
## Environment Preview Playback, Camera & Scrubbing

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.1.6.2**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Implemented:
- Environment Preview
- Static background artwork
- Ground reference integration
- Motion-agnostic preview displacement trajectories
- Existing Animation Editor playback and scrubbing

## Goal

Make Environment Preview reliable for playing and inspecting any animation in context.

The artist must be able to view:
- Character posing
- World displacement
- Background position
- Ground reference
- Camera framing

All synchronized to the same animation time.

## 1. Inspect existing playback

Review:
- Animation playback controller
- Current playhead time
- Loop handling
- Pause/resume
- Playback speed
- Scrubbing
- Phaser camera
- Preview displacement evaluator
- Existing ground reference
- v1.2 cinematic camera utilities, if already implemented

Reuse the authoritative animation clock.

## 2. Unified playback

Environment Preview should use existing Animation Editor controls:

- Play
- Pause
- Stop
- Restart
- Scrub
- Playback speed
- Loop where supported

Do not create a separate animation player with independent timekeeping.

The character pose and preview displacement must be evaluated using the same time.

## 3. Static world background

The environment background exists in world space.

When the character moves, the background stays in place in world coordinates.

This is true even when the visible viewport changes.

Do not parent background images to the moving Actor or Puppet.

## 4. Camera modes

Support two optional preview camera modes.

### Fixed Camera

Camera remains at a selected world-space position.

The character visibly travels across the background.

This is particularly useful for:
- Sword cuts with steps
- Lunges
- Dodges
- Jumps
- Walk/run cycles

### Follow Character

Camera follows the character's preview world position.

The environment appears to scroll in the viewport while staying fixed in world coordinates.

Use existing Phaser camera transforms.

Do not modify authored scene cameras or AnimationDefinition data.

The initial implementation can use direct follow positioning rather than a new camera-smoothing system.

## 5. Camera controls

Suggested panel:

```text
PREVIEW CAMERA

Mode:
(o) Fixed
( ) Follow Character

Camera X: [ 0 ]
Camera Y: [ 0 ]

Zoom: [ 1.0 ]

[Reset Camera]
```

Use existing UI conventions.

Camera settings are preview-only.

## 6. Deterministic scrubbing

A direct seek to time T must produce the same:
- Character pose
- Preview displacement
- Camera position
- Ground alignment
- Background world position

regardless of the previously previewed time.

Compute preview state from authored animation plus preview configuration, not accumulated prior frame state.

Do not restart asynchronous Actor movement promises during each scrub.

## 7. Loop behavior

Clearly define what happens when animations loop.

Support at least:
- Reset preview displacement at the loop boundary
- Restart the preview from the configured beginning

For repeated locomotion, optionally support continuous travel across loop repetitions using a deterministic loop count and per-cycle displacement.

Do not let position drift accidentally because the same displacement is added repeatedly.

Scrubbing within a single animation loop must remain deterministic.

If continuous travel cannot be represented by the existing time model, keep it explicitly disabled until implemented correctly.

## 8. Ground and foot contact markers

Keep the ground reference visible in Environment Preview when enabled.

If foot contact markers exist, optionally display them.

They should follow the evaluated character pose and world displacement.

Do not automatically:
- Snap the foot to the ground
- Alter IK
- Lock foot positions
- Correct contact drift

These are existing or separate authoring functions, not responsibilities of passive preview.

## 9. Playback side-effect isolation

Seeking must not trigger:
- Gameplay callbacks
- Scene cues
- External audio
- Animation event side effects

Use existing preview/seek event-suppression mechanisms.

Real animation playback should retain its established semantics where appropriate.

## 10. Viewport boundaries

Handle movement beyond the visible background.

Do not silently clamp the character's world position to image bounds.

Provide clear viewport controls to:
- Reset/recenter the preview
- Zoom out
- Follow the character

Background tiling or infinite-world rendering is not required.

## 11. Editor integration

Switching out of Environment Preview must restore ordinary Animation Editor preview behavior.

Avoid accidentally persisting:
- Preview camera offsets as character transforms
- Background movement as animation keys
- Simulated trajectory as Actor movement

## 12. Tests

Add tests for:
- Play/pause
- Restart
- Speed changes
- Time synchronization
- Fixed camera
- Follow camera
- Camera zoom
- Forward/backward scrubbing
- Same-time evaluation
- Loop reset
- Optional continuous loops
- Facing and IK
- Foot marker visualization
- No external events during seek
- React/Phaser cleanup
- Animation data isolation

## 13. Manual verification

Use three different animations:
1. Sword cut with a forward step.
2. Jump or dodge.
3. Walking or running loop.

For each:
- Enable Environment Preview.
- Play against a fixed background.
- Try fixed camera.
- Try following camera.
- Scrub backward and forward.
- Restart.
- Confirm the result is consistent.

## 14. Out of scope

Do not implement:
- Camera keyframe authoring
- Scene transitions
- Physics
- Automatic foot sliding correction
- New IK solvers
- Dialogue/audio
- Complex scene layering

## 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

Environment Preview correctly synchronizes animation pose, optional world displacement, ground reference and preview camera.

Playback and scrubbing remain deterministic and do not modify the authored animation.

## Final report

Provide timing architecture, camera behavior, looping semantics, scrubbing guarantees, files changed, tests and exact verification results.
