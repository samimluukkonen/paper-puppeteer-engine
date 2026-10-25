# Dialogue and subtitle authoring

[All guides](../README.md#guides) · [Scene Editor](scene-editor.md)

Scene Editor authors timed plain-text dialogue for narration and Actor exchanges. Dialogue is portable scene data; subtitle rendering, input waits, branching, typewriter effects, localization automation and lip sync are outside this milestone.

1. Set the scene playhead and click **Add Dialogue Line**. With an Actor selected, the new line uses that instance as speaker; otherwise it starts as narration. The initial duration is up to two seconds, bounded by the next line and scene end. Adding inside an occupied interval reports an overlap error.
2. Select the line in the **Dialogue** track and expand the initially collapsed **Dialogue line** inspector.
3. Edit **Dialogue text** with multiple lines in any language, including Japanese. Whitespace and intentional line breaks are preserved. Text is literal, never HTML or executable markup.
4. Choose a **Speaker Actor** or **Narration (no Actor)**. **Speaker label** overrides the displayed Actor ID or the default Narrator label. Two instances of the same character remain distinct speakers through their scene-local Actor IDs.
5. Set **Dialogue start** and **Dialogue duration** in seconds and click **Apply dialogue properties**. Each application is one scene Undo/Redo action. Scene duration never expands automatically.
6. **Duplicate dialogue line** creates a new stable ID in the first gap after the source that fits its whole duration. If no gap fits, extend the scene or move/shorten lines. **Delete dialogue line**, Delete/Backspace outside text controls and scene Undo/Redo use the same document history.

The timeline shows speaker/text clips aligned with its existing ruler and playhead. Select a clip to pause and edit its timing in the inspector. Dialogue edges also participate in shared timeline snapping. Selection and inspector expansion remain view state and are excluded from exports.

Open **Feature Guide** and choose **Dialogue & Subtitle Authoring** for a nine-step Explain tour. It needs only an open scene, reveals the relevant controls and empty-state guidance, and preserves authored data, selection, playback and history.

## Data and timing contract

Scene format remains **2**. Legacy scenes omit `dialogue` and load unchanged. A scene can contain up to 4,000 lines:

```json
{
  "dialogue": [
    {
      "id": "dialogue-1",
      "actorId": "hero-instance-2",
      "speakerName": "勇者",
      "text": "準備はいい？\nAre you ready?",
      "time": 1000,
      "duration": 2000,
      "voiceClipId": "audio-1"
    }
  ]
}
```

`id`, `text`, `time` and `duration` are required. Times use **milliseconds**, matching actions and audio. `actorId`, `speakerName` and `voiceClipId` are optional. Text is bounded to 100,000 characters and labels to 1,000. Empty text is allowed while authoring. IDs follow the existing identifier bounds. Unknown fields and non-text markup objects are rejected.

The initial policy is **one subtitle at a time**. Intervals are half-open `[time, time + duration)`: a line includes its start and excludes its end, so exact adjacency is valid. Start must be nonnegative, duration positive, and the finite end must advance time and fit inside the scene. Overlapping lines are rejected atomically in imports and edits, regardless of speaker or authored array order. Timing is deterministic and never waits for player input.

Actor renames update dialogue references in the same history entry. Removing a speaking Actor reports the affected line IDs and requires reassignment or conversion to narration first. Invalid imported speaker IDs identify the offending line and explain the repair. Speaker labels never resolve character or Actor identity.

**Voice reference** optionally points to an existing scene audio clip. It is organizational metadata; it neither starts sound nor changes the line interval, source trim or audio schedule. The audio timeline owns playback. Clear or replace the reference before deleting the referenced clip or its track. It can refer to any audio track, without requiring a separate voice scheduling system.

## Persistence and APIs

Canonical scene JSON, standalone scene ZIPs, project ZIPs, local autosave and recovery preserve dialogue. Character and audio path rebasing leave scene-local speaker and clip IDs intact. Project inspection includes dialogue-to-Actor and voice-asset dependencies and line-specific diagnostics. Authored text/timing changes affect dirty state and recovery fingerprints; selection does not.

`SceneDialogueLine` is exported from `/data`, `/core`, `/serialization` and the runtime/root entries. Pure `sceneDialogueLineSchema`, `dialogueSpeaker(line)` and `getDialogueLineAtTime(scene, milliseconds)` are available from `/core`, `/serialization` and runtime/root. Validate complete scenes with `parseSceneDefinition` to check timing, overlap and references; the individual line schema checks only its shape. The evaluator returns the authored active line or `undefined`, without pausing, emitting events or rendering UI.

Regression coverage lives in `tests/sceneDialogue.test.ts` and the local desktop browser scenario `tests/browser/sceneDialogue.spec.ts`, with tour coverage in `tests/sceneGuides.test.ts` and `tests/browser/sceneDialogueGuide.spec.ts`. Browser verification remains local-only.
