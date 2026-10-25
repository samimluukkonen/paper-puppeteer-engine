# Visual audio timeline (v1.3.2)

[All guides](../README.md#guides)

For an in-app tour, open **Feature Guide → Scene Editor → Visual Audio Timeline**. Its nine Explain steps reveal the real controls, including initially collapsed inspector sections and the Edit tab for saving. Create or open a scene first; audio assets, tracks, clips and Actors are optional. The tour explains how to import audio and begin when the scene is empty, and preserves authored data, selection, playhead, preview and Undo/Redo without starting sound.

Import audio in Project Workspace, open a scene, choose **Track category** and **Add audio track** below the scene timeline controls. Choose **Audio asset**, choose **Audio track**, position the playhead and click **Add Audio Clip**. New clips use the decoded media duration, limited explicitly to the remaining scene time; unknown media duration starts at one second. Music, Ambience, Sound Effects and Voice are organizational categories. Add several tracks of any category and overlap any clips, including clips on the same track. Overlaps get separate visible lanes.

Select a clip to reveal its initially collapsed **Audio clip** inspector. Drag its body to move in scene time. Drag its left edge to change start, source offset and duration while keeping its scene end fixed; extend left only as far as source offset zero. Drag the right edge to change duration while keeping start and offset fixed. Snapping shares frames, playhead, Actor clip edges, camera keys, transitions and other audio edges with the existing timeline. Hold Alt to bypass snapping. One completed drag is one scene Undo/Redo entry; Escape, lost pointer capture, window blur and selection/session changes cancel an unfinished gesture.

The inspector changes asset, track, start, duration, source offset, volume (0–100%), looping and fades. **Apply audio clip properties** commits one validated edit. **Duplicate audio clip** creates a new ID at the same time, preserving properties; drag the copy to another time or assign another track. **Delete audio clip** and the Delete/Backspace shortcut remove the selected clip. Scene Undo/Redo retains the original media bytes.

All scene timing and source offsets are milliseconds in JSON; the UI displays seconds. `durationSeconds` describes decoded media length and is separate from the clip's scene duration and current scene playback time. Trimming never changes an audio file. A non-looping clip requires `sourceOffset + duration <= mediaDuration` when duration is known. A loop repeats the remaining source window, from `sourceOffset` through media end, within the finite authored clip interval. Left trimming a loop changes that repeated window, and cannot advance its source offset beyond the media end. Right trimming a loop can extend its scene duration past media length, within scene bounds. No custom loop points, infinite end policy or playback-rate parameters are supported.

`fadeIn` and `fadeOut` are optional durations (omitted means zero), each bounded by clip duration. They describe linear gain ramps at the clip's scene edges; overlapping ramps multiply. Volume zero is valid. This phase saves these playback properties; synchronized playback, seeking and actual fade evaluation arrive in v1.3.3. Project Workspace's existing explicit audio audition is available independently. Scene playback and passive scrubbing do not start sound. Lightweight waveform previews are deferred; clips remain editable without decoding waveforms.

The scene-format-2 document gains optional arrays:

```ts
interface SceneAudioTrack {
  id: string;
  name: string;
  category: 'music' | 'ambience' | 'sfx' | 'voice';
}
interface SceneAudioClip {
  id: string;
  assetId: string;
  trackId: string;
  time: number;
  duration: number;
  sourceOffset: number;
  volume: number;
  loop: boolean;
  fadeIn?: number;
  fadeOut?: number;
}
```

`audioAssets` contains stable asset registrations matching Project Workspace audio IDs, with paths relative to scene JSON and optional decoded duration. The project catalog is authoritative for existence and media bounds. Clips must reference registered assets and tracks; IDs must be unique within each collection. Invalid timing, source ranges, volume, fades, looping values and scene-boundary violations reject the edit while retaining the prior snapshot. Decreasing scene duration past an audio clip's end also fails explicitly. Old scenes gain no audio fields when loaded or serialized.

JSON retains timing and stable relative references. Download a project ZIP or standalone scene package for a portable copy including binaries. Both packaging paths include the referenced audio, and scene dependency inspection blocks removing a used project asset. Project recovery uses the existing project archive. Standalone import uses content-addressed binary paths so later imports cannot overwrite earlier retained media; standalone recovery gives conflicting same-ID assets recovery-only aliases without changing the source documents. Browser import checks actual decoded duration before accepting trims. Headless parsing checks supplied metadata, and package resolution additionally checks signatures, formats and missing files.

`sceneAudio.ts` supplies the pure schemas, types and non-destructive trim helper through `/core`, `/serialization` and `/data` (types). SceneEditorDocument remains the working-copy, validation and history owner; SceneAudioCommands builds proposals, SceneAudioTimeline uses the existing viewport/ruler and SceneAudioInspector uses shared inspector controls. Optional audio arrays are bounded to 128 tracks/assets and 4,000 clips. Existing per-file and total package budgets apply.

## Implementation and verification

The main additions are `src/engine/sceneAudio.ts`, `src/devtools/scene-editor/SceneAudioCommands.ts`, `SceneAudioTimeline.tsx` and `SceneAudioInspector.tsx`. Integration updates cover `SceneDefinition`, `SceneAssets`, `ScenePackage`, public engine entry points, `SceneEditorDocument`, `SceneTimeline`, shared timeline actions, keyboard commands, playback preservation, scene transfers, project validation/dependencies/packaging, standalone recovery, the scene JSON schema, package/lockfile versions and changelog.

`tests/sceneAudio.test.ts` covers add/remove/duplicate, all categories and multiple tracks, overlaps and lane layout, source trims and timeline movement/snapping, volume/fades/loops, invalid values and duplicate identities, duration boundaries, grouped history and cancellation, legacy scenes, missing references/removal guards, project and standalone JSON/ZIP persistence, real decoded bounds and recovery aliases/binary ownership. Its 33 tests pass. The complete unit suite passes with 3,777 tests passed and 53 skipped (215 files passed, seven skipped).

`tests/browser/sceneAudio.spec.ts` exercises real WAV decoding, initially collapsed inspectors, movement and both trim handles, one-step drag Undo/Redo, volume/fades/loop properties, duplication/deletion, adding tracks and clips, project catalog access, dependency removal guards and portable exports. All four desktop checks pass across development and production builds (41.7 seconds); the desktop layout was inspected locally. Browser checks remain local-only.

Verification commands:

```bash
npm run typecheck
npm run test
npm run build
npm run check
npm run check:version
npm run test:package
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneAudio.spec.ts --workers=1
```

All runners use one worker and run sequentially. Builds retain existing Lucide `use client` directive warnings; they complete successfully.

### Audio Feature Guide verification

The nine-step **Visual Audio Timeline** guide is registered in `src/devtools/shared/guides/sceneGuides.ts`. It requires only an open scene and uses stable anchors on the asset picker, Add audio track, Add Audio Clip, audio rows and inspector timing, volume/loop, fade and duplicate/delete controls. Empty inspector sections provide guidance without selecting or creating a clip. Shared target preparation reveals disclosures, scrolls targets into view and activates Edit for portable saving.

`tests/sceneGuides.test.ts` verifies prerequisite gating, unique anchors in empty and selected-clip states, collapsed inspectors, Back/Restart/Finish and preserved scene/history/view state. `tests/browser/sceneAudioGuide.spec.ts` walks every step with an empty scene and real decoded audio, starts from Local draft, verifies the real spotlight targets and checks unchanged exported JSON, selected clip, volume, playhead, preview/overlays, Undo/Redo and zero audio starts. The desktop spotlight layout was inspected locally.

Verification: `npm run check` and `npm run build` pass. The focused scene/audio/registry/controller/target unit run passes 5 files and 63 tests. Local Chrome browser checks pass all 4 cases across development and production in 40.6 seconds:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneAudioGuide.spec.ts --workers=1
```
