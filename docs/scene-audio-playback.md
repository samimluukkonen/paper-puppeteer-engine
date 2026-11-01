# Scene audio playback (v1.3.3)

[All guides](../README.md#guides)

For an in-app walkthrough, open **Feature Guide → Scene Editor → Audio Playback & Synchronization**. Its nine Explain steps reveal the real clip rows, audio status, transport, playhead, speed, mute and saving controls. Only an open scene is required; audio, Actors and selected clips are optional. The tour never unlocks browser sound, starts playback, seeks or changes preview settings or authored data.

Author clips using the [visual audio timeline](scene-audio-timeline.md). Click **Play** to enable browser audio, load the referenced clips and begin scene playback. **Enable audio** prepares sound without moving the playhead and retries browser restrictions or decode failures. Audio status shows disabled (no clips), locked, loading, ready or error. Failures retain the authored scene; correct the file or clip bounds and retry. **Mute preview audio** allows silent visual playback. This control affects the scene preview, independently of Project Workspace audition.

Pause stops audible voices; Play resumes active clips at the current scene position. Stop restores time zero, Restart begins again, and scene completion/cancellation/disposal releases every voice. Switching scenes, leaving a project editor and hiding the editor page stop or pause its audio. Passive scrubbing never starts sound. Seeking past a completed effect does not replay it. Starting playback inside an active effect plays its remaining portion, including source offset and fades. There is no separate stationary scrub audition: use Play at the selected time, then Pause.

## Clock and backend

`SceneRunner` owns the authoritative millisecond clock for Actors, root motion, camera keys/cuts, transitions and scene cues. `getActiveAudioClipsAtTime(scene, time)` is a pure half-open interval evaluator returning active clip declarations, elapsed/remaining milliseconds, source positions and faded volume. It emits no cues, decodes nothing and starts no sound. Decoded duration can override metadata through its optional duration map (milliseconds).

`SceneAudioController` uses the existing `AudioAssetLoader` content cache, bounded decoding, cancellation and retry behavior. The default backend is Web Audio, independently of Phaser's sound manager (including games configured with `noAudio`). Creating/importing a controller never resumes audio. Call `unlock()` directly inside a user gesture; it invokes context resume before awaiting decoding. The controller reports unavailable Web Audio, suspended contexts, malformed media, decoded trim violations and audition-only custom backends. Visual playback may run silently when audio is explicitly muted or unavailable; check audio status in a standalone host.

The host calls `runner.update(delta)` once per frame. Each transport command/update reconciles voices with the same scene position. Clip starts are quantized to the host update; intervals skipped entirely by a large delta are not replayed. A Web Audio source starts at its evaluated media offset, loops from sourceOffset to decoded media end and receives a backend-scheduled finite stop. Two separate linear gain ramps multiply fade-in and fade-out, including when they overlap. Clip volume scales both. Backend output latency and the host frame interval still apply; synchronization is not sample-perfect.

Voices report unwrapped consumed media time using `AudioContext.currentTime`. The controller tolerates 80 ms of position drift, then replaces an out-of-sync voice at the desired scene offset. Drift correction happens at most once per voice per 250 ms of backend time. Normal frames keep the existing voice. Explicit speed/clip edits resynchronize immediately; pause, seek and restart intentionally replace playback resources. Sources, gains and callbacks disconnect on stop or natural completion. Scene disposal also clears decoded buffers, aborts pending work and closes the owned context; obsolete loading results never start sound.

All positive scene speeds are forwarded to Web Audio `playbackRate`; the editor offers 0.25×, 0.5×, 1×, 1.5× and 2×. This changes pitch as well as duration. Fade and stop scheduling scale with the rate. There is no time-stretch/pitch-preserving mode. Custom timeline adapters must implement the same rate/offset/loop/fade contract or report an error instead of silently ignoring it. See the Web Audio [source scheduling](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start) and [loop window](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/loopStart) references.

## Standalone consumers

Hosted definitions and portable scene ZIPs retain their resolved audio binaries. `SceneLoader` creates an exclusive controller at `loaded.runner.audio`, without React or editor imports. Listen to audio status/errors in your own UI, allow retry and mute, and invoke unlock from your own button:

```ts
import { SceneLoader } from 'paper-puppeteer-engine/runtime';

const loaded = await SceneLoader.loadPackage(phaserScene, sceneZipBytes);
playButton.addEventListener('click', () => {
  // Resume is invoked synchronously in this gesture, before the await.
  void loaded.runner.audio!.unlock().then(() => loaded.runner.play()).catch(showAudioError);
});
// In the host's existing update method:
loaded.runner.update(deltaMilliseconds);
// On scene removal (Phaser shutdown also disposes the loaded session):
loaded.dispose();
```

For custom Actor factories, pass `audio: { resolve, backend? }` to `SceneRunner`; the resolver returns the registered definition and encoded bytes by asset ID. Asset-loader definitions use confined paths; resolve scene-relative paths before passing them (SceneLoader/editor already do this). A runner exclusively owns/disposes its audio controller/backend. The reusable controller, adapter interfaces and drift constants are exported through `/runtime`; the pure evaluator and its return type are available through `/core` and `/serialization`, with types also in `/data`. Legacy audition backends remain compatible with Project Workspace; timeline playback requires `DecodedAudioResource.playTimeline`.

## Verification

`tests/sceneAudioPlayback.test.ts` exercises clip boundaries, concurrent clips, source offsets, bounded loops, multiplicative fades/volume, pause/resume/stop/restart/completion/cancel/dispose, silent repeated seeks and playback afterward, speed changes, drift correction, mute, browser lock/suspension/retry, decode and bounds errors, obsolete async work, editor audio edits and hosted/ZIP standalone shutdown. A fake backend clock makes scheduler behavior deterministic; a Web Audio boundary test inspects source/gain scheduling and disconnection.

`tests/browser/sceneAudioPlayback.spec.ts` runs a six-second desktop scene with background music at zero, walking animation/movement at one second, sword/impact effects at 3/3.4 seconds and a camera zoom, using tone fixtures for all audio. It uses real WAV decoding and Web Audio nodes, verifies transport, silent scrubbing, playback from the middle, rate, mute and scene switching, and captures `/tmp/paper-puppeteer-audio-playback.png`. A second case simulates a rejected context resume, verifies visible failure and then recovers through Enable audio without starting sound until Play. Automated source observations verify scheduling; they do not substitute for a human listening assessment.

Desktop browser regressions also cover the existing audio library, authoring and Feature Guide workflows, scene documents, Actors, root motion, camera keys/cuts and transitions. Keep the timeline panel scrollable at its minimum desktop height; its track viewport retains usable space even when toolbars wrap. Tabular playback numbers and reserved status width keep neighboring controls stable while the scene clock advances.

Validation commands (all test runners use one worker and run sequentially):

```bash
npm run typecheck
npm run check
npm run test
npm run build
npm run check:version
npm run test:package
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneAudioPlayback.spec.ts tests/browser/sceneAudio.spec.ts tests/browser/sceneAudioGuide.spec.ts tests/browser/projectAudio.spec.ts tests/browser/sceneEditor.spec.ts tests/browser/cameraAnimation.spec.ts tests/browser/sceneTransitions.spec.ts tests/browser/sceneRootMotion.spec.ts --workers=1
```

The browser command passed all **34 checks** across development and production in **6.0 minutes**. Earlier runs exposed the minimum-height timeline overflow and moving playback-number widths; both were fixed and the complete selected browser set rerun successfully. The desktop screenshot was inspected locally. No human listening assessment was performed.

Final command results:

| Command                       | Result                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`           | Exit 0; strict TypeScript passes, also rerun by the final check/build commands.                                                                                  |
| `npm run check`               | Exit 0; formatting, lint and typecheck pass.                                                                                                                     |
| `npm run test`                | Exit 0; 217 files passed, 7 skipped; 3,804 tests passed, 53 skipped in 139.48 seconds.                                                                           |
| `npm run build`               | Exit 0; authoring app, library, declarations and Node core checks pass. Existing Lucide `use client` bundling warnings remain nonfatal.                          |
| `npm run check:version`       | Exit 0; package/lockfile version 1.3.3 and changelog agree.                                                                                                      |
| `npm run test:package`        | Exit 0; offline packed consumer passes documentation links, Node entry points, public declarations, runtime example, compatibility and browser isolation checks. |
| Full Playwright command above | Exit 0; 34 checks pass across development and production.                                                                                                        |

The final unit run includes 23 audio playback tests, including cancellation of an obsolete pending Restart by a newer muted Play and clearing obsolete output errors when the last clip is removed.

After those two state refinements, the rebuilt final code also passed all four development/production audio browser checks in 37.2 seconds (exit 0):

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneAudioPlayback.spec.ts --workers=1
```

### Audio playback Feature Guide verification

The nine-step **Audio Playback & Synchronization** Explain tour is registered as `scene-audio-synchronization` in the shared Scene catalog. It highlights the existing clip rows, audio status, Play/Pause, playhead, speed, mute, Restart, Stop and package controls. Audio status remains a usable target when Enable audio is absent because sound is already ready or there are no clips. The tour requires only an open scene, preserves selected clips, playhead, speed, mute, camera preview/overlays and Undo/Redo, and never resumes a browser audio context or starts a voice.

`npm run check` and `npm run build:demo` pass. The focused unit run passes five files and 37 tests in 3.56 seconds. The local Chrome run passes all eight checks across development and production in 3.2 minutes, covering both audio tours with empty and selected-clip scenes, real WAV decoding, initially collapsed inspectors, Back/Restart/Finish, Edit-tab reveal for saving, unchanged exported JSON and zero context resumes or sound starts. Desktop spotlight screenshots were inspected locally.

```bash
npx vitest run tests/sceneGuides.test.ts tests/guideRegistry.test.ts tests/guideController.test.ts tests/guideTargets.test.ts tests/guideLauncher.test.ts --maxWorkers=1
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneAudioGuide.spec.ts --workers=1
```

## Dialogue holds

Ordinary clips pause during Advance Required waits and resume at the frozen scene offset. For optional dedicated music/ambience during a wait, choose **Audio playback → Hold-only loop (music / ambience)** in the clip inspector. See [hold-local animation and audio](dialogue-hold-presentation.md) for eligibility windows, pause/resume, constant-volume looping and cleanup.
