# Paper Puppeteer Engine — v1.3.4
## Dialogue & Subtitle Authoring

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.3.3**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing Scene Editor supports:
- Multiple Actors
- Actor choreography
- Scene timeline
- Audio tracks and synchronized playback
- Camera animation
- Scene cuts/fades
- Project import/export
- Undo/Redo

## Goal

Allow the artist to author timed dialogue and subtitles directly in Scene Editor.

For example, two characters can exchange lines during a cinematic scene.

The system must remain generic and reusable.

Do not build a full visual novel conversation engine.

## 1. Inspect existing architecture

Review:
- SceneDefinition
- Timeline track/action models
- Actor IDs and character references
- Existing cue/event definitions
- React inspectors
- Document validation
- Import/export
- Localization conventions, if any

Reuse existing patterns.

## 2. Dialogue line model

Create a typed, serializable dialogue item.

Conceptually:

```ts
interface SceneDialogueLine {
  id: string;
  actorId?: string;
  speakerName?: string;
  text: string;
  startTime: number;
  duration: number;
}
```

Adapt to actual schemas.

Support:
- Stable line ID
- Text content
- Start/duration
- Optional Actor speaker
- Optional explicit speaker label
- Narration without Actor
- Text in any language, including Japanese

Do not store arbitrary HTML or executable markup.

## 3. Dialogue timeline

Add a Dialogue or Subtitles track to Scene Editor.

Example:

DIALOGUE

0.0–2.0  Narrator: "The forest was silent."

3.0–5.0  Hero: "Prepare yourself."

6.0–8.0  Guard: "I am ready."

Reuse existing timeline time/selection utilities.

## 4. Editing UI

Support:
- Add Dialogue Line
- Select line
- Change start time
- Change duration
- Edit text
- Associate with Actor
- Change speaker label
- Duplicate
- Delete
- Undo/Redo

Use a multiline text editor for dialogue.

Preserve Unicode and intentional line breaks.

## 5. Actor association

Speaker association must use the scene-local Actor ID.

Do not confuse:
- Character definition
- Actor instance
- Speaker label

A scene containing two instances of the same character should still be able to distinguish their dialogue.

If the referenced Actor is removed, show an actionable validation warning/error according to existing conventions.

## 6. Timing policy

Initially use time-based dialogue display.

A line appears during its authored interval.

Do not automatically pause the scene to await player input.

This allows deterministic playback and scrubbing.

Do not introduce branching dialogue choices yet.

## 7. Overlap policy

Define an explicit initial policy for overlapping visible subtitles.

For a simple single-subtitle presentation, reject ambiguous overlapping line intervals or provide a clearly documented priority rule.

Do not let overlapping lines silently overwrite each other.

## 8. Optional voice reference

If practical, allow associating a dialogue line with an existing audio asset/clip for organizational purposes.

Do not duplicate audio playback scheduling.

Voice playback should remain controlled by the audio timeline.

A voice association is metadata unless explicitly and safely integrated.

## 9. Serialization

Extend:
- Scene validation
- Scene JSON import/export
- Project dependency inspection
- Autosave/recovery

Old scenes without dialogue must load unchanged.

## 10. Tests

Cover:
- New line
- Multiline text
- Unicode/Japanese text
- Narrator
- Actor association
- Duplicate Actor instances
- Timing edits
- Overlapping lines
- Invalid references
- Undo/Redo
- Import/export
- Existing scene compatibility

## 11. Out of scope

Do not implement:
- Dialogue playback UI yet
- Branching choices
- Typewriter effects
- Automatic voice generation
- Automatic localization
- Lip synchronization
- Character emotion synthesis

## 12. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

The artist can author and edit timed dialogue/subtitles in Scene Editor, associate lines with Actors and save them as portable scene data.

## Final report

Describe dialogue schema, track UI, speaker association, timing/overlap rules, persistence, files changed, tests and exact results.
