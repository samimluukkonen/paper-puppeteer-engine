# Paper Puppeteer Engine — v1.6.2.2
## Idle Animation & Audio During Dialogue Holds

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.6.2.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The engine supports dialogue holds that pause the main cinematic timeline until explicitly advanced.

## Goal

Make dialogue holds feel natural rather than freezing every visible and audible part of the scene.

For example, while the viewer reads dialogue:
- A samurai continues breathing.
- A character can blink or maintain a subtle idle animation.
- Forest ambience continues.
- Background music may continue if explicitly configured.
- Camera choreography and scripted action remain paused.

Do not introduce gameplay or interactive behavior.

## 1. Inspect existing systems

Review:
- Dialogue hold state machine
- Animation blending/crossfades
- Animation playback clocks
- Scene clock
- Audio scheduler
- Scene cue/event system
- Actor root motion
- Existing looped animations

Reuse existing evaluators.

## 2. Separate main and hold-local time

The main scene clock must remain frozen during an advance-required dialogue hold.

Introduce a controlled hold-local elapsed time used only by explicitly permitted presentation activity.

Conceptually:

```ts
interface DialogueHoldPlaybackState {
  sceneTime: number;
  holdElapsedTime: number;
}
```

Do not create another full scene timeline.

Hold-local time must not advance:
- Scene actions
- Camera keyframes
- Root-motion choreography
- Scene dialogue schedule
- Scene cues

## 3. Actor idle playback

Allow an optional looping animation during a dialogue hold.

Examples:
- Breathing
- Blinking
- Subtle idle movement

The artist should be able to configure which Actor uses which existing idle animation.

Reuse existing animation assets and playback.

Do not require special new animation formats.

## 4. Pose continuity

When entering a hold:
- Preserve the evaluated main cinematic pose.
- Start an optional hold animation only through an explicit supported policy.
- Avoid unexpected root movement.
- Do not overwrite the Actor's authored animation tracks.

When leaving a hold:
- Restore or transition back to the exact main-timeline pose appropriate for resuming.
- Avoid visible snapping where the current blending system can handle it safely.

If seamless blending cannot be guaranteed, expose a conservative snap/hold behavior and document it.

## 5. Root motion safety

An idle animation may contain root motion.

Default hold-time behavior must ignore Actor displacement.

Do not allow an idle loop to move the Actor away from its authored scene position unless a future explicit feature provides safe semantics.

Do not modify scene movement actions.

## 6. Audio hold policy

Define clear behavior for audio while waiting.

Recommended initial defaults:
- Time-bound SFX: pause with the scene.
- Dialogue voice clips: pause with the scene unless an explicit policy provides another behavior.
- Music/ambience: may be configured to continue.
- New scene audio cues: must not trigger while waiting.

Reuse the existing audio backend.

A practical initial implementation may use dedicated hold-safe music/ambience loops if continuously advancing ordinary scene-timed clips would cause synchronization problems.

If continuing an existing time-bound music clip is supported, preserve its media position consistently and implement explicit resume/reconciliation semantics.

Do not simply let a clip advance silently and restart it from an inconsistent scene offset after the hold.

## 7. Deterministic evaluation

The main scene state is still deterministic at a given scene time.

Hold-local animation is explicitly session-dependent because the viewer can wait an arbitrary amount of time.

Keep these concepts separate.

Passive scrubbing must not create or advance hold-local playback sessions.

## 8. Editor behavior

In Scene Editor, allow the artist to preview:
- Paused cinematic frame
- Optional idle animation
- Dialogue presentation
- Selected hold-audio behavior

A simulated advance should end the hold and resume the main timeline.

## 9. Resource lifecycle

On leaving a hold:
- Stop or transition hold-local animations.
- Stop owned hold-only audio.
- Dispose temporary playback state.
- Avoid orphaned audio handles and timers.

Repeated holds must not accumulate active resources.

## 10. Tests

Cover:
- Frozen main clock
- Advancing idle animation
- Idle without root displacement
- Hold-local loop
- Music/ambience continuation
- Time-bound SFX suppression
- Enter/exit hold
- Multiple Actors
- Restart
- Scene disposal
- Rapid repeated holds
- No animation source mutation

## 11. Out of scope

Do not implement:
- Procedural breathing
- Automatic lip synchronization
- Interactive dialogue choices
- Background gameplay simulation
- Physics
- General concurrent scene timelines

## 12. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

Dialogue holds can optionally keep selected idle animations and appropriate audio alive while the main cinematic scene remains paused.

## Final report

Describe clock ownership, idle layering/blending, audio hold policy, resume behavior, files changed, tests and exact verification results.
