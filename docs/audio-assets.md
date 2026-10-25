# Audio assets (v1.3.1)

[All guides](../README.md#guides)

Project Workspace can import, organize and audition background music, ambience, sound effects and prerecorded voices. Audio belongs to the existing project registry. Scene timeline placement is available in the [v1.3.2 audio timeline](scene-audio-timeline.md); synchronized playback is deferred to v1.3.3.

## Import and audition

For an in-app tour, open **Feature Guide → Project Workspace → Importing and Managing Audio**. Its seven Explain steps work in an empty project and reveal the real controls without changing assets, history or playback. Create or import a project before starting.

Open a project, expand **Audio**, choose **Import category**, then **Import Audio**. The Music, Ambience, Sound effects and Voice categories start collapsed and show their counts. Import does not start playback. Asset names are plain labels. Click **Play** on a row to audition it; the same button becomes **Stop** while loading or playing. Click **Stop** on that row to end or cancel its preview. **Stop preview** at the top stops the current asset too. Preview volume affects only audition. Closing a category stops its preview. Closing Audio, changing projects or closing the workspace releases the audition resources; entering an editor stops audition.

Use **Rename** to edit the display name, or the row's **Category** selector to move an asset. Neither operation changes its stable ID or file path. **Remove** removes membership; **Undo Project** restores the asset and its original bytes. Rename and category edits use the same project history. The shared dependency graph guards removal when non-project dependents exist; scene audio clips now create those dependencies.

Imports accept WAV, MP3 and OGG containers with a codec that the current browser's Web Audio decoder supports. PCM WAV is a useful fallback for unsupported encodings. File contents, rather than the extension or MIME type, identify the container, and decoding must succeed before registration. Renaming an extension does not convert audio. Corrupt data, unsupported codecs and denied playback produce inline feedback. Playback starts from an explicit click and resumes the browser AudioContext in that gesture; import, recovery and passive view updates never start sound.

Limits reuse the existing package constraints: 1 byte–10 MiB per encoded file, 100 MiB per ZIP/expanded project and 256 total archive files. The manifest allows up to 128 audio entries. Decoded audition resources have a separate aggregate 128 MiB PCM budget. If that cache fills, close and reopen Audio to release it, or import shorter audio. Loading/decoding and permission waits have a 60-second deadline. A codec may be supported in one browser and unavailable in another; package import checks compatibility in the receiving browser.

## Model and portable storage

The version-1 project manifest gains an optional `audio` array. Older projects remain valid without it:

```ts
interface AudioAssetDefinition {
  id: string;
  name: string;
  path: string;
  category: 'music' | 'ambience' | 'sfx' | 'voice';
  durationSeconds?: number;
}
```

New imports use random stable IDs, sanitized relative paths such as `audio/forest-theme.ogg`, and duration reported by successful decoding. Filename collisions get a numeric suffix, including case-only collisions. Audio IDs and paths reject case-insensitive duplicates; malformed metadata, paths and missing binaries fail validation. Duration is measured again when a browser imports a project. Categories are organizational metadata and share one playback implementation.

`ProjectWorkspace` owns detached encoded bytes and retains removed bytes for membership Undo, under the existing package budget. Public `audioSource(id)` reads return a copy, so callers cannot alter registered data. Export captures audio synchronously alongside the existing document captures. `buildProjectPackage()` writes each registered audio file at its manifest path; `importProjectPackage()` preflights missing files and expanded bytes before copying resources into an independent workspace. Physical package collisions remain errors. Project imports memoize compatibility results for identical encoded content while releasing decoded buffers between files, and accept an optional cancellation signal tied to the workspace's transfer lifetime.

Existing `LocalAutosave` and `LocalDraftStore` persist the same complete project package, including audio binaries in the existing Blob/digest records. Recovery reads those files through the project importer. No second database or registry is introduced. Project ZIP downloads remain portable disk copies and do not overwrite repository files. Decoded buffers, source nodes, gain nodes, AudioContexts, volume and preview state are never serialized. Audio audition needs no object URLs.

## Runtime API and ownership

`AudioAssetLoader` is independent of React and resolves stable IDs through a host-supplied callback returning `{ definition, bytes }`. `load(id)` returns a decoded resource. `prepare(bytes, signal?)` validates and decodes import candidates before registration. SHA-256 content keys deduplicate concurrent loads and identical files even when they have different asset IDs.

The default `WebAudioBackend` uses the browser's existing Web Audio API: `decodeAudioData`, a buffer source and a gain node. No audio processing engine or additional dependency is introduced. A host can inject `AudioBackend` for testing or another compatible backend. Browser project imports always decode audio; headless callers without AudioContext validate metadata, signatures, paths and binary presence, and can pass `{ audioBackend }` to `importProjectPackage()` to require actual decoding.

Call `play(id)` from a user gesture. The loader owns one audition voice; a later Play replaces it. `setVolume(0..1)` updates the current voice. `stop()` invalidates pending Play requests. `clear()` stops audition, cancels pending cache waits and releases decoded memory while keeping the backend. `dispose()` additionally closes the owned AudioContext. Failed decodes are evicted for retry, late results after cancellation/disposal are released, and natural endings disconnect source/gain nodes. The Audio panel owns its loader and closes it on unmount. Project bytes remain available for later auditions.

The package `/runtime` and root export `AudioAssetLoader`, `WebAudioBackend`, backend/resource types and load/decoded-budget constants. `/core` exports the pure metadata schema, category and format types, signature/data validators and encoded-file limit; `/data` exposes the data types. Pure entry points remain safe to import in Node.

## Changed files and verification

- `src/engine/AudioAsset.ts`: shared metadata schema, categories, encoded-size, signature and path/format checks.
- `src/engine/AudioAssetLoader.ts`: reusable ID resolution, decoding/cache, browser backend, audition and resource disposal.
- `src/devtools/project/ProjectDefinition.ts`, `ProjectWorkspace.ts`, `projectInspection.ts`, `projectPackage.ts`: existing registry, project history, diagnostics/dependencies, packaging and recovery integration.
- `src/devtools/project/ProjectAudioLibrary.tsx`, `ProjectView.tsx`, `style.css`: collapsed audio browser and shared workspace controls.
- Engine entry points, package version metadata, changelog and guides expose/document the foundation. `src/ui/workspace.css` exposes the existing command-bar icon spacing as a shared button utility for audio controls.
- `tests/audioAssets.test.ts` and `tests/fixtures/audio/`: import, metadata, ownership, dependency guard, backend failures, content reuse, cancellation, deadlines, cleanup, autosave, ZIP and legacy-project regressions.
- `tests/browser/projectAudio.spec.ts`: real WAV/MP3/OGG decoding, explicit audition, volume/Stop, collapsed libraries, rename/category/removal Undo, corrupt-file feedback, AudioContext cleanup, IndexedDB recovery and ZIP reimport on desktop development/production builds.

Verified locally on 2026-10-25, with test runners executed sequentially and one worker per runner:

| Command                                                                                                                      | Result                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                          | Passed, including the final invocations through check/build                                                    |
| `npm test`                                                                                                                   | 213 files passed, 7 skipped; 3,740 tests passed, 53 skipped; 152.40 s                                          |
| `npm exec -- vitest run tests/audioAssets.test.ts tests/projectWorkspace.test.ts tests/localAutosave.test.ts --maxWorkers=1` | 3 files and 62 tests passed; 5.25 s, after the final packaging changes                                         |
| `npm run check`                                                                                                              | Formatting, lint and typecheck passed                                                                          |
| `npm run build`                                                                                                              | Application, library, declarations and Node pure-entry checks passed                                           |
| `npm run check:version`                                                                                                      | Package 1.3.1, lockfile and changelog agree                                                                    |
| `npm run test:package`                                                                                                       | Passed isolated packed consumer, public declarations, examples, compatibility and browser dependency isolation |

Browser checks are local-only:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/projectAudio.spec.ts tests/browser/projectStyle.spec.ts --workers=1
```

All 8 checks passed in 58.2 s across development and production builds, including all four shared view headers. Desktop audio screenshots were inspected locally. The volume slider exposes its percentage through `aria-valuetext` while project feedback retains one status region.

The application build retains the existing non-failing Lucide `use client` directive warnings; browser tooling emits its existing `NO_COLOR`/`FORCE_COLOR` warning. No browser steps or dependency audit schedules were added to CI.

## Audio Feature Guide verification

The seven-step **Importing and Managing Audio** guide is registered in `src/devtools/shared/guides/projectGuides.ts`, with project-presence facts supplied by `projectGuideHost.ts`. `ProjectFeatureGuide` launches it through the existing controller and spotlight. Stable anchors in the Audio panel and Project commands reveal collapsed disclosures and inactive tabs. Catalog return, Restart, Back/Next, Escape, Exit and Finish retain project data, binaries, history and playback; focus returns to the shared Feature Guide button on exit.

On 2026-10-25, `npm run check` and `npm run build` passed. The final shared spotlight focus change also passed `npm run check` and `npm run build:demo`. Guide regression commands run sequentially with one worker:

```bash
npm exec -- vitest run tests/projectGuides.test.ts tests/guideSpotlightLifecycle.test.ts tests/guideRegistry.test.ts tests/guideController.test.ts tests/guideLauncher.test.ts tests/guideTargets.test.ts tests/sceneGuides.test.ts tests/animationGuides.test.ts tests/rigGuides.test.ts --maxWorkers=1
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/projectAudioGuide.spec.ts --workers=1
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/guidePractice.spec.ts tests/browser/featureGuide.spec.ts --grep 'practice|feature selection|spotlight reveals' --workers=1
```

The unit run passed 9 files and 58 tests in 4.30 s. All 6 audio-guide browser checks passed in 26.4 s across development and production. Browser coverage checks empty-project gating/search, real target reveal, an empty and an imported-audio project, focus restoration after catalog return, no audio starts, preserved Undo/Redo, and identical exported metadata/binary bytes before and after the tour. Desktop spotlight screenshots were inspected locally.

All 10 selected shared modal/practice browser checks passed in 1.7 minutes after the focus restoration change, including real key authoring with Undo/Redo, catalog return, target recovery and input cleanup. The existing project-to-editor guide launch workflow and the remaining catalog/spotlight browser regressions also passed during the broader verification run.

## Deferred v1.3.2 work

[Scene audio clips, tracks, references and trimming](scene-audio-timeline.md) are available in v1.3.2. Synchronization with scene playback/seeking remains future work (v1.3.3). This foundation does not add dialogue UI, recording, waveform editing, synthesis, cloud storage or voice generation.
