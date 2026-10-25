# Paper Puppeteer Engine — v1.3.1
## Audio Assets & Sound Foundation

Continue developing my Paper Puppeteer Engine project.

**Current completed version: v1.2.6**, including the v1.1.7 root-motion features.

### Technology
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

Existing functionality includes:
- Project Workspace and asset management
- Rig, Animation and Scene Editors
- Actor choreography and scene timeline
- Scene camera, backgrounds, parallax and transitions
- Project import/export
- Autosave and crash recovery
- Validation and Undo/Redo
- Feature Guide Wizard

This is a private tool for myself and one artist friend. Avoid unnecessary infrastructure.

## Goal

Implement the foundation for audio in Paper Puppeteer Engine.

I want to import and manage:
- Background music
- Ambient audio
- Sound effects
- Optional prerecorded character voices

Audio assets will later be placed on the Scene Editor timeline.

This phase covers asset management, validation, loading and basic preview/audition. Timeline authoring comes later.

## 1. Inspect repository architecture

Review:
- Project asset registry
- Binary asset import/export
- Asset IDs and manifest format
- Phaser runtime services
- Existing audio features, if any
- Browser file import
- Current validators
- Asset disposal and lifecycle

Reuse existing patterns.

Do not implement a second project asset system.

## 2. Audio asset model

Introduce typed audio asset metadata.

Conceptually:

```ts
interface AudioAssetDefinition {
  id: string;
  name: string;
  assetPath: string;
  category: "music" | "ambience" | "sfx" | "voice";
}
```

Adapt to actual project architecture.

Audio category is organizational metadata, not a separate runtime implementation.

Support:
- Stable asset IDs
- Display names
- File references
- Audio type/category
- Duration metadata when reliably available

Do not serialize decoded audio buffers.

## 3. Import audio

Add audio import to Project Workspace.

Support browser-compatible formats such as WAV, MP3 and OGG when the actual browser/audio backend can decode them.

Validate:
- File existence
- Nonempty data
- Supported/decodable format
- Reasonable file sizes
- Duplicate asset identifiers
- Filename collisions

Do not trust extensions alone.

An unsupported audio file should produce an actionable error rather than crashing.

## 4. Audio asset browser

Add an Audio section in Project Workspace.

Example:

AUDIO

Music
- forest-theme
- battle-theme

Ambience
- forest-wind

Sound Effects
- sword-swing
- sword-impact
- footsteps

Actions:
- Import
- Preview
- Rename
- Remove

Use existing React components and project conventions.

## 5. Basic audio audition

Allow clicking an audio asset to listen to it.

Provide simple:
- Play
- Stop
- Volume control where appropriate

This is asset audition, not scene playback.

Respect browser audio permission/autoplay restrictions. Audio should begin only after appropriate user interaction.

Use an existing Phaser/Web Audio-based audio backend where practical.

Do not build a new audio processing engine.

## 6. Audio loading service

Implement or extend a reusable runtime-facing audio asset loader.

It must:
- Load registered audio assets
- Resolve stable asset IDs
- Handle decoding/loading failures
- Reuse loaded resources where appropriate
- Release resources safely
- Remain independent of React components

Avoid memory leaks and repeated decoding of identical assets.

## 7. Persistence and packaging

Ensure:
- Imported audio survives autosave
- Browser recovery restores binary files
- Project export includes required audio assets
- Re-import restores audio references
- File paths are portable
- Temporary object URLs are not serialized

Do not assume browser downloads overwrite local repository files.

## 8. Dependency integrity

Integrate audio with existing project validation.

Detect:
- Missing binary data
- Broken references
- Invalid file paths
- Unsupported metadata
- Duplicate IDs

Protect assets referenced by scenes from accidental deletion once dependencies exist.

## 9. Tests

Cover:
- WAV/MP3/OGG import where supported
- Invalid/unsupported files
- Audio asset registration
- Duplicate IDs
- Asset resolution
- Loading/decoding failures
- Resource cleanup
- Autosave/recovery
- Project export/import
- Backward compatibility

Use audio-backend mocks where necessary.

## 10. Out of scope

Do not implement:
- Audio timeline
- Scene playback synchronization
- Dialogue UI
- Audio recording
- Audio editing/waveform processing
- Sound synthesis
- Cloud media storage
- Voice generation

## 11. Verification

Run available repository equivalents of:

```bash
npm run typecheck
npm run test
npm run build
```

Also run lint and existing integration tests where available.

Fix failures.

## Definition of done

Audio files can be imported, organized, auditioned, validated, saved and loaded using the existing project asset system.

## Final report

Describe:
1. Audio model
2. Import workflow
3. Supported formats
4. Playback backend
5. Binary asset lifecycle
6. Persistence and packaging
7. Files/APIs changed
8. Tests and exact command results
9. Deferred v1.3.2 work
