# Paper Puppeteer Engine — v1.3.2
## Visual Audio Timeline

Continue developing Paper Puppeteer Engine.

**Current completed version: v1.3.1**

Stack:
- React + TypeScript (strict)
- Phaser
- Vite, npm, ES modules

The project now supports imported audio assets using the existing Project Workspace.

The Scene Editor already has:
- Actor tracks
- Camera tracks
- Generic scene cues
- Scene clock
- Timeline selection
- Snapping
- Undo/Redo
- Scene serialization

## Goal

Allow the artist to visually arrange audio clips in Scene Editor.

Examples:
- Background music across an entire scene
- Forest ambience
- Sword-swing sound during an attack
- Impact sound at the moment of contact
- A short voice recording aligned with dialogue

This phase focuses on authoring and data. Precise runtime synchronization comes in v1.3.3.

## 1. Inspect current timeline

Reuse existing:
- Time ruler
- Timeline coordinate utilities
- Clip selection
- Dragging
- Resizing
- Snapping
- History transactions
- Scene working-copy ownership

Do not build another timeline implementation.

## 2. Scene audio clip model

Extend the existing scene data format with optional audio clips.

Each clip needs:
- Stable clip ID
- Audio asset reference
- Start time
- Play duration
- Source start offset / trim
- Volume
- Looping policy
- Optional fade-in/out durations
- Track association

Use existing schema and validation conventions.

Clearly distinguish:
- Media duration
- Source offset
- Clip duration on the scene timeline
- Scene playback time

Looped clips must still have finite authored timeline bounds unless the existing scene model explicitly supports an end policy.

## 3. Audio tracks

Support a few organizational track categories:
- Music
- Ambience
- Sound Effects
- Voice

These are organizational labels; don't impose artificial playback restrictions solely because of their names.

Allow multiple tracks/clips where valid.

## 4. Scene Editor UI

Example:

SCENE TIMELINE

Actors
  Hero
  Guard

Camera
  Position
  Zoom

Audio
  Music
    forest-theme ──────────────
  Ambience
    wind ──────────────────────
  SFX
              sword-swing
                 sword-impact

Implement using actual existing timeline UI patterns.

## 5. Audio clip editing

Support:
- Add Audio Clip
- Choose audio asset
- Select
- Drag clip in time
- Trim from beginning/end
- Duplicate
- Delete
- Change volume
- Enable/disable looping
- Change fade-in/out
- Undo/Redo

Trimming must not modify the underlying audio file.

One completed drag should create one history transaction.

## 6. Audio clip inspector

Suggested properties:

AUDIO CLIP

Asset: sword-impact
Start: 3.50 s
Duration: 0.70 s
Source Offset: 0.00 s
Volume: 100%
Loop: Off
Fade In: 0.00 s
Fade Out: 0.00 s

All values are examples.

Use actual media duration when available for validation.

## 7. Waveform visualization

If straightforward with existing audio decoding, render a lightweight read-only waveform preview inside clips.

It must:
- Be cached when practical
- Reflect trim boundaries
- Not be required for basic editing
- Not decode/render full-resolution waveforms every React frame

Do not build a digital audio workstation.

If the waveform is expensive or difficult, prioritize functioning clips and defer it.

## 8. Clip validation

Validate:
- Missing audio asset
- Negative start/duration
- Invalid source offset
- Invalid volume
- Fade duration exceeding clip duration
- Illegal trim range
- Unsupported looping parameters
- Duplicate clip IDs

Allow intentionally overlapping audio clips.

Do not treat overlapping effects as an error by default.

## 9. Scene duration

Audio clips must follow existing scene-duration rules.

Avoid silently extending or truncating a scene without making the behavior explicit.

## 10. Persistence

Extend:
- Scene serialization
- Import/export
- Project packaging
- Dependency inspection
- Autosave/recovery

Old scenes without audio must load unchanged.

## 11. Tests

Cover:
- Add/remove audio clip
- Trim
- Drag and snapping
- Duplicate
- Multiple tracks
- Overlap
- Volume
- Fades
- Loop configuration
- Undo/Redo
- Serialization
- Missing references
- Older scene compatibility

## 12. Out of scope

Do not implement:
- Full synchronized audio playback
- Dialogue
- Voice generation
- Spatial/3D audio
- Audio recording
- Audio effects plugins
- Automatic beat detection

## 13. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix failures.

## Definition of done

The artist can place and edit audio clips on the Scene Editor timeline and save their timing and playback properties reliably.

## Final report

Explain the clip model, timeline integration, trim/loop/fade semantics, history, validation, files changed, tests and verification results.
