# Changelog

Versions use package SemVer; for example, milestone `0.5.2.8.3` is packaged as `0.5.2-8.3`.

## Unreleased

- Publish completed Animation Editor commands in one state notification.
- Share pending import and export guards between the editors.
- Group overlapping collapsed timeline summaries by pixel position and add `npm run profile:timeline` for local browser measurements.
- Share responsive inspector behavior across the demo and both editors.

## 0.5.3-2

The v0.5.3.2 [ghost rendering layer](docs/ghost-pose-rendering.md) adds a transient Onion Skinning toggle with one cool previous and one warm next authored pose behind the active puppet. Render-only instances reuse the engine's bones and affine renderer, follow current artwork, skins, slot transforms/depth, placement and facing, and retain their GameObjects across frame and skin changes. Sampling and authored JSON remain unchanged; ghosts exclude procedural IK.

## 0.5.3-1

The v0.5.3.1 [ghost pose sampling foundation](docs/ghost-pose-sampling.md) adds read-only complete authored pose snapshots and pure neighboring-frame time calculation. Sampling uses the editor working copy and existing runtime evaluator before IK, with authored FPS spacing, a shared 10 FPS fallback, and omitted out-of-range neighbors. No ghost rendering or UI controls are added. The implementation plan now reflects the existing React workspace UI.

## 0.5.2-8.3

The v0.5.2.8.3 [production workflow hardening](docs/animation-editor-production-verification.md) completes the Visual Animation Timeline milestone with clear session status, dirty-replacement confirmations, local source revert, runtime pose/event round-trip verification, portable filenames and a documented [artist workflow](docs/animation-editor.md#production-animation-workflow).

## 0.5.2-8.2

The v0.5.2.8.2 [animation import and reload](docs/animation-editor-import-verification.md) adds pasted/file JSON import, clean session resets and canonical export/import round-trip verification. Invalid imports preserve the current session; successful imports preview through the existing runtime evaluator.

## 0.5.2-8.1

The v0.5.2.8.1 [stable animation export](docs/animation-editor-export-verification.md) adds canonical validated JSON, conservative float cleanup, Copy JSON, downloads and a console fallback. Exports preserve authored data and establish saved session checkpoints without mutating source or working snapshots.

## 0.5.2-7.3

The v0.5.2.7.3 [event clipboard and playback](docs/animation-editor-event-hardening-verification.md) completes event authoring: editable name/time/JSON data, movement/snapping/nudging, copy/paste/duplicate and Undo/Redo. Same-time events stay separate. Normal playback reuses runtime event crossings, including loops and large deltas; navigation stays silent.

## 0.5.2-6.3

The [interpolation UI](docs/animation-editor-interpolation-ui-verification.md) exposes selection inspection, clip declaration edits, and outgoing/terminal marker indicators using the existing [authoring core](docs/animation-editor-interpolation-verification.md). The v0.5.2.6.3 [hardening regression](docs/animation-editor-interpolation-hardening-verification.md) covers key workflows, history, serialization, and preview integration, including exact spacing for nearby pasted keys. The format supports clip-level linear interpolation; smooth/stepped remain playback sampling modes. Per-key interpolation editing and mixed modes remain unavailable.
