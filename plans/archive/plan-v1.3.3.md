# Paper Puppeteer Engine — v1.3.3
## Audio Playback & Synchronization

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.3.2**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing systems:
- Deterministic Scene Editor playback/scrubbing
- Scene clock
- Actor movement and root motion
- Camera animation and transitions
- Scene audio clips and asset loader
- Animation/scene event lifecycle

## Goal

Play audio clips in synchronization with the existing Scene Editor timeline.

The artist should hear music, ambience and sound effects at their authored times.

This feature must use **one authoritative scene timeline**, not independent JS timers for every audio clip.

## 1. Inspect current runtime

Review:
- Scene clock
- Playback states
- Pause/resume/stop
- Playback speed
- Scene seeking
- Event suppression during seek
- Audio asset loader
- Phaser Sound / Web Audio backend
- Runtime cleanup and disposal

Use existing services.

## 2. Audio playback scheduler

Create a reusable audio scheduling controller.

It must:
- Start clips at their authored scene times
- Stop clips at clip end
- Respect source offsets
- Respect finite loop ranges
- Apply volume and fades
- Support simultaneous clips
- Avoid duplicate playback instances
- Dispose all owned playback resources

The scene clock remains the source of truth for desired clip position.

Audio backend scheduling may use its own clock for accurate output, but it must be reconciled with scene time.

## 3. Synchronization

Ensure audio stays aligned with:
- Actor animation
- Root-motion movement
- Camera movement
- Camera cuts
- Fades
- Scene cues

Define an acceptable drift tolerance and correction strategy.

Do not continuously restart sound on every frame.

Use bounded correction or resynchronization when necessary.

Do not claim sample-perfect synchronization unless the backend genuinely supports it.

## 4. Playback lifecycle

Support:
- Play
- Pause
- Resume
- Stop
- Restart
- Scene completion
- Project/scene switching
- Runtime disposal

No background sound should continue playing after its owning scene is destroyed.

## 5. Seeking and scrubbing

Scrubbing must not cause short sound effects to fire repeatedly as the playhead crosses their start markers.

Default behavior:
- Passive scrubbing is silent.
- Visual Scene Editor state is updated deterministically.
- Audio resumes from the correct clip-relative position when playback begins.

Where feasible, allow an explicit audio audition action at the selected time.

Do not automatically emit an old sound effect when seeking past its start time.

## 6. Browser audio restrictions

Browsers may block sound before user interaction.

Implement a clear audio-unlock flow using the chosen backend.

Requirements:
- No autoplay promises without user action
- Visible audio-disabled/unavailable state
- Graceful decode/loading errors
- Retry or user-action recovery

Do not circumvent browser media permission restrictions.

## 7. Music and SFX

Support concurrent music and sound effects.

Allow clips to overlap normally.

Apply clip-level volume and fades.

A global preview mute control is useful.

Avoid implementing a professional mixing console.

## 8. Playback speed

Inspect current scene speed controls.

Where supported, keep audio consistent with scene playback speed.

If a backend cannot reproduce audio at a requested speed, disable unsupported combinations or clearly document the behavior.

Do not allow the scene to silently become desynchronized.

## 9. Deterministic state versus audible side effects

Keep audio timeline state evaluation deterministic.

Conceptually:

```ts
getActiveAudioClipsAtTime(scene, time)
```

This should return which clips are logically active and their desired offsets without starting sound.

Actual sound playback is a separate side-effecting operation.

Do not trigger sound during pure scene evaluation or arbitrary seeking.

## 10. Standalone runtime

Exported scenes must support audio through runtime-facing modules without importing React.

Reuse character/scene asset resolution.

## 11. Tests

Cover:
- Clip start/end
- Overlapping clips
- Source offset
- Looping
- Fades
- Volume
- Pause/resume
- Restart
- Rapid seeking
- Silent scrubbing
- Playback after seek
- Audio decode failure
- Browser audio lock
- Speed changes
- Cleanup
- Standalone playback

Use mocks/fake clocks where appropriate for deterministic scheduling tests.

## 12. Manual verification

Build a short scene:
1. Start background music at 0 seconds.
2. Begin walking at 1 second.
3. Trigger a sword-swing effect at 3 seconds.
4. Trigger an impact effect at 3.4 seconds.
5. Animate a camera zoom.
6. Play/pause/restart.
7. Scrub repeatedly.
8. Confirm unwanted sound effects do not trigger.
9. Start playback after seeking to the middle.
10. Close the scene and verify audio stops.

## 13. Out of scope

Do not implement:
- Dialogue/subtitles
- Voice recording
- Audio synthesis
- Spatial/3D audio
- Automatic lip sync
- Full multitrack audio editing

## 14. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

Run available browser integration tests.

## Definition of done

Audio follows scene timing, handles pause/seek/restart correctly, respects browser playback restrictions and works in standalone scene consumers.

## Final report

Describe the scene-clock relationship, scheduler, audio backend, drift handling, silent scrubbing, resource cleanup, tests and exact command results.
