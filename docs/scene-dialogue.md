# Dialogue and subtitle playback

[All guides](../README.md#guides) · [Scene Editor](scene-editor.md)

Scene Editor authors plain-text dialogue for narration and Actor exchanges. Dialogue is portable scene data. Scene Editor and standalone Phaser consumers display it from the same scene clock. Choose **Timed** for existing subtitle timing or **Advance Required** to freeze the cinematic timeline until an explicit advance. There are no choices or branches; keyboard wiring, typewriter effects, localization automation and lip sync remain outside this milestone.

1. Set the scene playhead and click **Add Dialogue Line**. With an Actor selected, the new line uses that instance as speaker; otherwise it starts as narration. The initial duration is up to two seconds, bounded by the next line and scene end. Adding inside an occupied interval reports an overlap error.
2. Select the line in the **Dialogue** track and expand the initially collapsed **Dialogue line** inspector.
3. Edit **Dialogue text** with multiple lines in any language, including Japanese. Whitespace and intentional line breaks are preserved. Text is literal, never HTML or executable markup.
4. Choose a **Speaker Actor** or **Narration (no Actor)**. **Speaker label** overrides the displayed Actor ID or the default Narrator label. Two instances of the same character remain distinct speakers through their scene-local Actor IDs.
5. Set **Dialogue progression**, **Dialogue start** and **Dialogue duration** in seconds and click **Apply dialogue properties**. Each application is one scene Undo/Redo action. Scene duration never expands automatically. Timed duration must be positive. Advance Required duration controls passive preview only and may be zero, including a line starting exactly at scene end. To author an ending hold, add a line earlier, choose Advance Required, then move its start to scene duration and set its duration to zero.
6. **Duplicate dialogue line** creates a new stable ID in the first gap after the source that fits its whole duration. If no gap fits, extend the scene or move/shorten lines. **Delete dialogue line**, Delete/Backspace outside text controls and scene Undo/Redo use the same document history.

The timeline shows speaker/text clips aligned with its existing ruler and playhead. Select a clip to pause and edit its timing in the inspector. Dialogue edges also participate in shared timeline snapping. Selection and inspector expansion remain view state and are excluded from exports.

For an exchange at one scene timestamp, create the lines in separate free intervals, choose **Advance Required** for each, then give them the same start. Simultaneous lines occupy separate selectable timeline lanes in playback order. Generated IDs stay visible in the inspector; imported JSON can supply IDs such as `01-question` and `02-reply` for explicit ordering.

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

`id`, `text`, `time` and `duration` are required. Times use **milliseconds**, matching actions and audio. `actorId`, `speakerName`, `voiceClipId` and `progression` are optional. Omitted progression and explicit `"timed"` retain existing behavior; `"advance-required"` enables a hold. Old dialogue is never converted automatically. Text is bounded to 100,000 characters and labels to 1,000. Empty text is allowed while authoring. IDs follow the existing identifier bounds. Unknown fields and non-text markup objects are rejected.

Only **one subtitle at a time** is presented. Timed intervals are half-open `[time, time + duration)`: a line includes its start and excludes its end, so exact adjacency is valid. Start must be nonnegative, timed duration positive, and the finite end must fit inside the scene. Advance Required permits zero-duration point holds, visible in passive evaluation exactly at their start. Overlapping intervals are rejected atomically, except Advance Required lines sharing exactly the same start. Mixed timed/hold lines at the same start and overlapping holds at different starts are invalid. For simultaneous holds, passive preview chooses the first active line in ascending, case-sensitive JavaScript string ID order; interactive playback presents every line in that same order, independent of array order. Use IDs such as `01-question`, `02-reply` to make the intended order explicit.

Actor renames update dialogue references in the same history entry. Removing a speaking Actor reports the affected line IDs and requires reassignment or conversion to narration first. Invalid imported speaker IDs identify the offending line and explain the repair. Speaker labels never resolve character or Actor identity.

**Voice reference** optionally points to an existing scene audio clip. It is organizational metadata; it neither starts sound nor changes the line interval, source trim or audio schedule. The audio timeline owns playback. Clear or replace the reference before deleting the referenced clip or its track. It can refer to any audio track, without requiring a separate voice scheduling system.

## Persistence and APIs

Canonical scene JSON, standalone scene ZIPs, project ZIPs, local autosave and recovery preserve dialogue. Character and audio path rebasing leave scene-local speaker and clip IDs intact. Project inspection includes dialogue-to-Actor and voice-asset dependencies and line-specific diagnostics. Authored text/timing changes affect dirty state and recovery fingerprints; selection does not.

`SceneDialogueLine` is exported from `/data`, `/core`, `/serialization` and the runtime/root entries. Pure `sceneDialogueLineSchema`, `dialogueSpeaker(line)` and `getDialogueLineAtTime(scene, milliseconds)` are available from `/core`, `/serialization` and runtime/root. Validate complete scenes with `parseSceneDefinition` to check timing, overlap and references; the individual line schema checks only its shape. The evaluator returns the authored active line or `undefined`, without pausing, emitting events or rendering UI.

Regression coverage lives in `tests/sceneDialogue.test.ts` and the local desktop browser scenario `tests/browser/sceneDialogue.spec.ts`, with tour coverage in `tests/sceneGuides.test.ts` and `tests/browser/sceneDialogueGuide.spec.ts`. Browser verification remains local-only.

## Playback and presentation

Play displays timed lines at the current scene time. Advance Required pauses at the exact authored start and shows **Advance dialogue** in the editor transport. Click it once per line. The final line at a shared timestamp resumes playback; an ending hold delays completion until advanced. Pause suspends an active wait: Play restores the wait, while Advance is ignored during Pause. Play alone never bypasses a wait. Restart begins again at zero, and Stop clears text and restores authored placement. Scene switching, cancellation, interruption, failure and disposal clear presentation.

Scrubbing and programmatic `seek(T)` are always passive: they display the pure sample at T, suppress cues/audio and never start a viewer-input session. Their result does not depend on previous advances. Resuming consumes holds at or before T and can wait only at later holds. Seeking backward rearms later holds. A consumed interactive line clears immediately even if its passive-preview duration has not ended. Passive seeking to an ending point hold may display it in completed state; advancing there is ignored, and Play follows the existing completed-scene restart behavior.

### Runtime advancement and clock semantics

```ts
// Add these lines to the existing scene dialogue array.
const dialogue = [
  { id: '01-question', text: 'Who are you?', time: 1000, duration: 0, progression: 'advance-required' },
  { id: '02-reply', text: 'I am Yagyū Sekishūsai.', time: 1000, duration: 0, progression: 'advance-required' },
];

// Call from your host's explicit Advance command. No keyboard binding is installed.
const result = loaded.runner.advanceDialogue();
if (result.advanced) console.log('Consumed', result.lineId);
```

`advanceDialogue(): AdvanceResult` returns `{ advanced: true, lineId }` only for an active wait, otherwise `{ advanced: false }`. Each call consumes one pending line, including simultaneous exchanges. A second call can consume the next simultaneous line; reentrant calls from presentation during advancement are ignored. When no next line shares the timestamp, cinematic playback resumes from the held time. An ending hold completes immediately after its last advance. `StoryPlayer.advanceDialogue()` forwards to the current session; the next story `update()` loads the next scene only after completion. Legacy scene adapters may omit the optional advance method.

`SceneRunner.status` explicitly distinguishes `playing`, `waiting-for-dialogue-advance`, `paused`, `completed` and `stopped`, alongside cancellation, interruption, failure and disposal. Story loading owns scene transitions. A wait retains the runner's Actor contexts and frozen poses without cancelling choreography. The runner processes actions/cues **at** the hold timestamp once, then waits; all later actions, main animation clocks/events, root-motion displacement, camera tracks, fades and cues remain frozen. Explicitly configured hold idle overlays can animate the pose without advancing those clocks. Time-zero holds run time-zero actions once before waiting. Scene-end holds run terminal actions/cues once before waiting and defer completion.

Only the host's next supplied delta advances playback after release. A frame crossing a hold clamps to its exact timestamp and discards the excess delta. Frames supplied while waiting advance only optional hold-local presentation; no accumulated wall time catches up after an advance. Existing audio pause behavior stops voices during waiting and restarts currently active clips at the held scene offset when released. Optional per-Actor idle overlays and dedicated hold-only music/ambience loops can continue on a separate presentation clock. Ordinary time-bound audio keeps its frozen scene-offset behavior. See [idle animation and audio during dialogue holds](dialogue-hold-presentation.md) for authoring, explicit snap behavior and lifecycle semantics.

The shared React-free `SceneDialogueOverlay` uses Phaser text with a system sans-serif font, optional speaker label, multiline wrapping, safe padding and a dark translucent backing near the bottom of the **1000 × 700 cinematic output**. Unlabelled narration omits the speaker row; Actor lines use their scene-local ID unless a label overrides it. Text is literal. The default presentation bounds exceptionally long content to twelve wrapped text rows and two label rows, fitting the result inside the frame. A custom target can present the complete authored content differently.

The output-space layout compensates for authored camera pan and zoom, and scales with the letterboxed host viewport. Editor navigation shows the subtitles within the authored camera frame; **Preview Through Camera** shows audience framing without gizmos by default. Subtitles use depth **8500**, above cinematic fades (**8000**) and below editor guides (**9000**). A full fade therefore leaves an active subtitle readable. Standalone loading creates no editor guides.

### Pure evaluation and custom consumers

`getDialogueAtTime(scene, milliseconds)` is available from `/core`, `/serialization` and root/runtime. It returns `undefined` outside a line, or `{ line, speaker, actor }`, where `actor` is authored metadata rather than a temporary runtime instance. An explicit label takes precedence over an Actor ID; narration has an undefined speaker. Missing Actor metadata falls back to the authored ID in the pure evaluator, while complete scene validation rejects dangling speaker references before playback. Time must be finite. Evaluation depends only on scene data and time and has no audio or cue side effects. The original `getDialogueLineAtTime` and authoring helper `dialogueSpeaker` remain available; the latter retains its Narrator fallback for authoring labels.

`SceneLoader.load`, `fromDefinition` and `loadPackage` provide the default Phaser overlay for scenes with dialogue. Apply the cinematic camera to render the intended audience viewport; call `applyCamera` again after a host resize. Customize using one small host-owned render target:

```ts
import { SceneLoader } from 'paper-puppeteer-engine/runtime';

const loaded = await SceneLoader.load(phaserScene, sceneUrl, {
  dialoguePresentation: {
    setDialogue(active) {
      // Replace view state, including on seeks. Keep gameplay side effects in onCue.
      dialogueBox.setText(active?.line.text ?? '');
      speakerLabel.setText(active?.speaker ?? '');
    },
  },
  onCue(cue) {
    if (cue.name === 'sword-impact') showImpact(cue.actorId);
  },
});
loaded.applyCamera(phaserScene.cameras.main);
// Host Phaser update: loaded.runner.update(deltaMilliseconds)
// Host teardown: loaded.dispose()
```

Pass `dialoguePresentation: false` to disable the default overlay and poll `loaded.runner.dialogue` yourself. Direct `SceneRunner` consumers can supply the same `dialoguePresentation` target, or combine `SceneDialogueOverlay` with `onCamera: state => overlay.setCamera(state)`. A runner clears a target but does not destroy host-owned UI. Loader-owned default overlays are destroyed on disposal, aborted loading and Phaser shutdown. Render targets receive clock-command samples, including silent seeks, and must tolerate repeated state. They are not line-start callbacks and should not perform gameplay actions or start audio.

### Cue and audio semantics

The existing `SceneRunner.onCue` is the sole scene cue dispatcher. Cue data remains named JSON with optional JSON payloads; scene documents contain no JavaScript callbacks. Starting or restarting playback delivers time-zero cues once. Forward updates deliver every crossed cue in time order, including large deltas and the terminal scene boundary; ties preserve authored order. Zero-delta updates and pause/resume never repeat consumed cues. Passive seek emits none and consumes cues at or before its target, so resuming delivers only later crossings. A backward seek permits later forward crossings to deliver those cues again. Restart begins a fresh pass. There is no automatic scene loop; a host repeats a scene by calling Restart, which also begins a fresh cue pass. Cancellation/disposal prevents further delivery.

Dialogue never depends on cues and never starts a sound. `voiceClipId` and audio IDs inside cue payloads are metadata. The existing v1.3.3 audio scheduler exclusively owns authored sound playback. Put voice, music and effects on that timeline; align their intervals explicitly. If a host also plays a sound from `onCue`, it owns avoiding duplication with an already authored audio clip. Passive scrubbing remains silent; resume starts only currently active audio from its current offset. No speech is generated or automatically aligned.

## Local verification scene

Open the repository sample `public/scenes/dialogue.scene.json` through **Open scene JSON** while running the editor, then choose **Preview Through Camera** and Play. It uses the existing paper puppet artwork with a dedicated sword animation/skin and small generated preview chord/noise WAV assets, not voice synthesis:

1. Actor A walks toward B during 0–2 seconds as the camera pans and zooms.
2. Hero speaks at 2 seconds; music continues beneath the subtitle.
3. A swings the sword at 3.5 seconds; one SFX and the `sword-impact` cue occur at 4 seconds.
4. B responds at 4.8 seconds. The scene fades out during 6.5–8 seconds; the response remains above the fade until its 7.5-second endpoint.
5. Pause, seek backward/forward, Restart, Stop and switch scenes. Seek into either line to see it immediately with no sounds or cue effects. Download the scene package to exercise the same output without React.

Runtime regressions cover boundaries, metadata, pause/restart, cue crossing/seek isolation, audio coexistence and cleanup. The local desktop `sceneDialoguePlayback.spec.ts` additionally checks actual canvas subtitle pixels through pan/zoom/full fades, transport controls, scene switching and an independently bundled Phaser package consumer. Browser checks remain local-only; no CI browser setup is added.
