# Paper Puppeteer Engine — v1.6.2.1
## Dialogue Advancement & Timeline Hold Semantics

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.6.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing systems:
- Authored dialogue and subtitles
- Scene timeline
- Deterministic scrubbing
- Actor choreography
- Audio scheduling
- Scene cues
- Linear StoryDefinition and sequencing

## Goal

Allow an authored dialogue line to pause the main cinematic timeline until the viewer explicitly advances the dialogue.

This is the central interaction model of Mukashi Monogatari.

There are NO player choices or branching storylines.

## 1. Inspect current dialogue architecture

Review:
- Dialogue line definitions
- Start time/duration
- Subtitle evaluation
- Scene clock
- Pause/resume
- Scene cue dispatch
- Audio synchronization
- Story scene completion
- Playback seek behavior

Extend existing dialogue, not a second dialogue engine.

## 2. Dialogue progression modes

Preserve existing timed dialogue behavior.

Add an optional dialogue progression mode:

**Timed**
- Displays according to existing scene timing.
- Does not require input.

**Advance Required**
- Displays at the authored point.
- Pauses main cinematic progression.
- Waits for an explicit advance command.
- Resumes when advanced.

Use an optional backward-compatible field in the existing dialogue schema.

Do not convert old dialogue automatically.

## 3. Hold points

At an authored advance-required dialogue point:

1. Advance main scene time to the exact hold position.
2. Evaluate character poses, camera, background and dialogue at that position.
3. Show the dialogue.
4. Enter a waiting-for-advance state.
5. Stop advancing main scene time.
6. Continue only after an explicit advance command.

Do not repeatedly re-enter the same hold after it has been consumed.

## 4. Dialogue state machine

Implement a small explicit state machine.

Conceptual states:

- Playing
- WaitingForDialogueAdvance
- PausedByAuthor/PlayerRuntime
- TransitioningScene
- Completed
- Stopped

Adapt to existing playback lifecycle.

Avoid ambiguous combinations of independent boolean flags.

## 5. Advance API

Provide a runtime-facing API equivalent to:

```ts
advanceDialogue(): AdvanceResult
```

It should:
- Work only when an advance-required dialogue is pending.
- Consume exactly one eligible advance.
- Resume cinematic playback or proceed to the next authored dialogue point.
- Ignore commands when no dialogue hold is active.
- Avoid duplicate dispatch from repeated calls.

Keyboard wiring comes in v1.6.4.

## 6. Multiple dialogue lines

Support consecutive dialogue holds.

For example:

Hero: "Who are you?"
[Enter]

Samurai: "I am Yagyū Sekishūsai."
[Enter]

Cinematic animation resumes.

Define exact behavior when consecutive lines share a scene timestamp.

Use stable dialogue ordering, not incidental array iteration order.

One advance should consume one dialogue hold unless an explicit authored policy says otherwise.

## 7. Deterministic time semantics

Do not implement waiting by accumulating a large wall-clock delta and applying it after Enter.

Main scene time must remain frozen while waiting.

When resumed, playback continues from the held scene time without catching up the elapsed real-world waiting duration.

If a frame's elapsed time crosses a hold boundary, clamp the scene evaluation to the hold point and do not execute later events.

## 8. Side effects

While waiting:
- No future scene cues fire.
- No future root-motion displacement applies.
- Camera tracks do not advance.
- Subsequent choreography does not begin.

At advance:
- The same cue is not dispatched twice.
- The same dialogue hold is not immediately re-triggered.

## 9. Scrubbing and authoring

Passive Scene Editor scrubbing should remain deterministic and must not enter a blocking viewer-input session.

Separate:
- Pure scene evaluation at time T
- Interactive playback hold state

Editor playback may simulate holds, but scrubbing must not depend on previous Enter presses.

## 10. Edge cases

Handle:
- Dialogue at scene time 0
- Dialogue at scene end
- Back-to-back dialogue
- Invalid overlapping holds
- Stop while waiting
- Restart
- Scene switching
- Missing speaker
- Multiple advance calls
- Large frame deltas

## 11. Tests

Cover hold boundaries, resume behavior, consecutive lines, consumed holds, deterministic seeking, cue suppression, stop/restart and compatibility with existing timed dialogue.

## 12. Out of scope

Do not implement:
- Idle animation during hold
- Special audio hold policies
- Keyboard input
- Branching choices
- Story variables
- Player-controlled movement

## 13. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

An advance-required dialogue line can hold the main cinematic timeline until explicitly advanced, without corrupting scene time, duplicating events or breaking existing timed dialogue.

## Final report

Explain the state machine, hold time semantics, advance behavior, event safety, files changed, tests and exact results.
