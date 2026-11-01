# Idle animation and audio during dialogue holds

[All guides](../README.md#guides) · [Dialogue and subtitles](scene-dialogue.md) · [Scene audio](scene-audio-playback.md)

Advance Required dialogue can keep selected idle animations and dedicated music/ambience loops alive while the viewer reads. The default retains the cinematic pose and pauses all scene audio. These settings are optional and remain scene format **2** data.

## Author and preview

1. Select an Actor and expand **Actors → Actor properties**. Choose **Dialogue hold idle** from its existing character animations. Configure each Actor separately; the speaker does not select an idle automatically. **Hold cinematic pose** disables the overlay.
2. Choose a subtle looping pose such as breathing or blinking. The explicit **snap overlay** policy replaces only channels tracked by that animation. Entry samples its start immediately; Advance restores the exact held cinematic pose immediately. There is no entrance/exit crossfade in this policy. Match the idle to the cinematic pose to minimize visible snapping. Existing cinematic blends remain frozen and intact underneath the overlay.
3. Add/select dialogue and set **Dialogue progression → Advance Required**, then **Apply dialogue properties**. The line's start is the hold boundary; its duration controls passive preview only.
4. For sound, add a **Music** or **Ambience** track and an audio clip. Expand **Audio → Audio clip**, choose **Audio playback → Hold-only loop (music / ambience)** and **Apply audio clip properties**. This selects looping and clears scene fades. Set **Source offset** and **Volume**. The asset uses the existing audio backend and browser unlock flow.
5. Set the clip's **Start** and **Duration** to cover the scene timestamps where it may sound during holds. The interval is half-open, except a window ending exactly at scene end also includes an ending hold. These values select eligible holds; they do not limit how long the viewer may wait. A hold-only clip is silent during ordinary scene playback.
6. Choose **Play**. At the hold, the subtitle remains visible, the playhead stops, and configured idle/audio loops continue. **Runtime preview** shows separate Scene time and Hold elapsed values. **Pause** freezes the idle and stops audio. **Play** retains the idle phase and restarts hold audio at the matching local source position. Mute and preview speed also apply to holds.
7. Click **Advance dialogue** to end one hold. Same-time successor lines start fresh local sessions. The last advance resumes the cinematic scene at its exact frozen time; an ending hold completes the scene. Restart, Stop, seek and scene switching release hold state and audio.

**Feature Guide → Idle Animation & Audio During Dialogue Holds** explains these controls without editing or starting playback. Add and select an Actor first. Actor and audio inspector disclosures start collapsed. Idle/audio settings participate in scene Undo/Redo, JSON, portable packages, project exports and local recovery; they do not edit character animation assets.

## Clock ownership and pose safety

`SceneRunner` owns one main scene clock and one small hold-local elapsed value. Only interactive waiting creates a local session. Each host `update(deltaMilliseconds)` while waiting advances local time by `deltaMilliseconds * runner.speed`; it never updates the Actor/Puppet gameplay clock. A delta that first reaches a hold stops at its boundary and discards the remainder. No wall time accumulates for cinematic catch-up.

The main animation clocks, existing crossfades, movement requests, root-motion origins, camera tracks, scene fades, dialogue schedule and scene cues stay frozen. The existing animation layer evaluator samples a temporary sparse overlay above the frozen cinematic layers, including supported IK and mesh channels. The idle loops even if its source asset is non-looping, using a private loop override. Authored tracks and registered assets remain unchanged. There are no idle animation events, completions or scene cues. Root-motion displacement is always ignored; skeletal channels still affect the pose, so choose idle assets without unwanted skeletal travel.

On exit, the overlay is removed, its sparse channels are restored and the frozen cinematic layers are reevaluated before playback resumes. Existing playback identities, fades and event cursors survive the hold. Snap entry/exit is the supported conservative policy; seamless blending is not promised. No second scene timeline, procedural animation, gameplay or lip synchronization is introduced.

Passive `seek(T)` removes a live overlay before sampling, never creates a hold session and remains silent. The result is deterministic at scene time T regardless of earlier waiting. Hold-local presentation is intentionally session-dependent and is not serialized into scene assets or recovery drafts.

## Audio policy and resume behavior

All ordinary scene clips—including SFX, voice, music and ambience—stop at a hold and resume from their exact frozen scene offset after Advance. Later scene clips cannot start while waiting. A `voiceClipId` remains organizational metadata.

Only dedicated `playback: "dialogue-hold"` clips run during waiting. Validation requires a music/ambience track, `loop: true` and zero/omitted fades. They loop from source offset to decoded media end at constant volume for arbitrary waiting time, independently of their eligibility-window duration. The first sample starts at source offset; pause/resume, speed changes and mute recovery reconcile with hold-local elapsed time. They stop on every exit and never continue into the main timeline. Ordinary time-bound music continuation is not supported; use a separate hold-safe loop where that behavior is appropriate.

The controller retains at most one voice per eligible clip and stops/releases owned voices on Advance, seek, Stop, Restart, cancellation, failure, disposal and scene switching. There are no hold timers. Web Audio schedules no finite stop for a hold-only loop; explicit owner cleanup disconnects its nodes.

## Runtime data and API

```ts
// Existing Actor data; animation names resolve against that character's loaded catalog.
actor.dialogueIdle = { animation: 'breathing', policy: 'overlay-snap' };

// Existing scene audio clip on a music/ambience track.
clip.playback = 'dialogue-hold';
clip.loop = true;
clip.fadeIn = 0;
clip.fadeOut = 0;

// Supplied deltas advance only explicitly permitted presentation while waiting.
loaded.runner.update(deltaMilliseconds);
console.log(loaded.runner.dialogueHoldPlayback);
// undefined outside a session, otherwise { sceneTime, holdElapsedTime } in milliseconds.
loaded.runner.advanceDialogue();
```

`dialogueHoldPlayback` returns a detached snapshot, retained without advancement during Pause. Hosts changing mute/unlock state directly can call `runner.syncAudio()` to reconcile immediately using the current clock owner. Otherwise the next runner update/transport command reconciles audio. Custom timeline-capable audio backends must support an owned looping voice with `remaining: Infinity`, `duration: Infinity` and zero fades, and release it when `stop()` is called.

Regression coverage: `tests/sceneDialogueAdvancement.test.ts`, `tests/sceneAudioPlayback.test.ts`, `tests/sceneDialogue.test.ts`, `tests/ikAnimationRuntime.test.ts`, `tests/meshDeformation.test.ts`, `tests/sceneGuides.test.ts` and the local desktop `tests/browser/sceneDialogueHoldPresentation.spec.ts`.
