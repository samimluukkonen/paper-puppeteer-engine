# Paper Puppeteer Engine — v1.3.5
## Dialogue Playback & Scene Cue Integration

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.3.4**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The engine already supports:
- Scene timeline
- Authored dialogue tracks
- Audio playback
- Actor animation/root motion
- Cinematic camera and transitions
- Existing generic scene cues
- Deterministic scene seeking

## Goal

Display dialogue/subtitles during scene playback and integrate them safely with existing scene event mechanisms.

The artist should be able to preview a scene with characters moving, speaking and reacting.

## 1. Inspect existing systems

Review:
- Dialogue definitions
- Scene playback clock
- Scene cue dispatch
- Existing subtitle/text components
- Camera preview rendering
- Fade overlay ordering
- Standalone runtime consumer API
- Seek and event suppression logic

Reuse existing event systems rather than creating another callback engine.

## 2. Deterministic dialogue evaluation

Implement a pure or equivalent time-based evaluator:

```ts
getDialogueAtTime(scene, time)
```

The result must be independent of previous playback position.

For an authored line:
- Show it during its interval
- Hide it outside its interval
- Resolve speaker metadata
- Handle exact start/end boundaries consistently

Seeking must not automatically trigger dialogue callbacks.

## 3. Dialogue presentation

Provide a simple default subtitle/dialogue presentation.

Suggested UI:

--------------------------------
Hero

"Prepare yourself."
--------------------------------

Support:
- Optional speaker name
- Multiline text
- Readable typography
- Long-line wrapping
- Safe padding
- Transparent or subtly darkened backing
- Sensible screen placement

Use existing Phaser text or React presentation conventions where suitable.

The runtime presentation must not require React.

## 4. Camera and fade integration

Subtitles should be positioned relative to the cinematic output viewport, not the moving character's world position.

They should stay readable when the camera pans or zooms.

Define whether subtitles appear above or below cinematic fade overlays, and make the behavior consistent.

Do not let editor-only gizmos appear in standalone scene output.

## 5. Preview behavior

In Scene Editor, dialogue must update correctly during:
- Play
- Pause
- Stop
- Restart
- Scrub
- Scene switching
- Camera movement
- Scene fades

When seeking to the middle of a line, show the corresponding text immediately.

Do not replay the line from its beginning.

## 6. Existing scene cues

Inspect the generic scene cue system already implemented in v0.9.

Preserve one authoritative cue dispatch mechanism.

Support developer callbacks for normal forward playback according to documented event semantics.

A cue might represent:
- Sword impact
- Start of an interaction
- Character reaction
- Application-defined cinematic event

The authoring data should remain JSON-compatible.

Do not embed arbitrary JavaScript functions in scene documents.

## 7. Cue side-effect safety

Scene cues and dialogue display have different responsibilities.

Dialogue display is deterministic state.

Cue callbacks are potentially side-effecting events.

Requirements:
- No cue dispatch during passive seek
- No duplicate events at one playback crossing
- Explicit behavior on restart and loop
- Correct handling of large frame deltas
- Cleanup on scene disposal

Do not make subtitle rendering rely on cue callbacks.

## 8. Audio coordination

Dialogue timing should align with the existing audio timeline.

If a prerecorded voice clip exists, the artist can place it alongside its dialogue interval.

Do not generate or automatically time-align speech.

Audio playback remains owned by the v1.3.3 audio scheduler.

Avoid playing one sound twice because both an audio clip and a scene cue reference it.

## 9. Custom presentation API

Keep a small runtime-facing way for consumer applications to customize dialogue presentation if needed.

Examples:
- Default subtitles
- Custom JRPG dialogue box
- Application-specific UI

Keep the authored scene format independent of any particular visual style.

Do not implement a full UI theming framework.

## 10. Tests

Cover:
- Dialogue start/end
- Exact boundaries
- Direct seeking
- Backward seeking
- Camera movement
- Fade rendering
- Multiline text
- Missing Actor speaker
- Pause/restart
- Cue dispatch
- No cue events during seek
- Audio coexistence
- Runtime cleanup
- Standalone consumer support

## 11. Manual verification

Create a scene:
1. Actor A walks toward Actor B.
2. Camera zooms in.
3. A subtitle appears.
4. Music continues.
5. Actor A performs a sword movement.
6. Sword SFX plays at the authored time.
7. Actor B responds with dialogue.
8. The scene fades out.

Verify:
- Timing alignment
- Readable subtitles
- Stable camera-relative text
- No unwanted effects while scrubbing
- No duplicated audio/cues

## 12. Out of scope

Do not implement:
- Branching dialogue
- Interactive player choices
- Automatic lip sync
- Voice synthesis
- Emotion detection
- Advanced dialogue portraits
- Localization editor

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

Authored dialogue plays deterministically in Scene Editor and standalone runtime, while scene cue callbacks remain correctly isolated from seeking and subtitle rendering.

## Final report

Describe dialogue evaluation, rendering, camera/fade ordering, cue behavior, audio coordination, files changed, tests and exact command results.
