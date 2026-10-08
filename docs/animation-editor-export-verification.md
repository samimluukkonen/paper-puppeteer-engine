# Stable animation export verification — v0.5.2.8.1

[Animation Editor](animation-editor.md)

Automated unit coverage in `animationSerialization.test.ts` checks deterministic output across insertion orders, readable JSON, format version 1 and runtime parser/compiler compatibility, payload preservation, same-time duplicate events, partial tracks, interpolation/playback metadata, float cleanup and close-time safety. It also checks source/working/input immutability and exclusion of editor session data. Invalid schema fields, timeline order, references, nonfinite values, unsupported versions and non-JSON payloads are rejected before serialization.

`animationEditorExport.test.ts` exercises shared output for copy/download/log, successful save checkpoints, failed destinations, validation feedback, delayed clipboard saves with newer edits, and stale writes after newer exports, discard, selection, rebinding or disposal. Existing authoring, event, interpolation, playback and Rig Editor tests provide regression coverage.

Local-only Playwright scenarios in `tests/browser/animationExport.spec.ts` verify real clipboard writes and repeated download equality, smooth/stepped settings, multiple bones, partial keys, linear metadata, same-time events and nested payload data. They also cover manifest filenames, saved/discarded baselines, failed downloads and unavailable clipboard fallback. These tests run against development and production servers; no browser tests or installation steps are added to CI.

```bash
npm run typecheck
npm run test
npm run build
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationExport.spec.ts
```

Implementation verification results: typecheck, all 1,344 unit tests (28 existing skips), the demo/library build, formatting/lint checks, and package version validation passed. All 12 local export browser scenarios passed against development and production using installed Chrome. Browser coverage includes actual clipboard readback and exact downloaded-content comparisons; the human text-editor checklist below remains unperformed.

Human verification checklist (separate from automated browser coverage):

- [ ] Author multiple bones with partial X/Y/rotation tracks and several keys.
- [ ] Select explicit Linear interpolation, then preview smooth and stepped sampling with fractional FPS.
- [ ] Create several events, including two at the same time, duplicate names, nested payload data and one event without data.
- [ ] Click Copy Animation JSON and paste into a text editor; inspect two-space indentation and trailing newline.
- [ ] Download the file and compare its exact contents to the clipboard text. Repeat both exports without edits.
- [ ] Confirm authored settings, keys, event ordering/payloads and optional fields survive, and no editor/session fields appear.
- [ ] Leave a temporary bone-field draft and confirm it is excluded from export.
- [ ] Confirm successful copy/download/log clears dirty state, preserves history, and Undo/Redo compares against that saved checkpoint.
- [ ] Reject clipboard permission; confirm actionable Download/Log feedback and retained unsaved changes.
- [ ] Start a delayed copy, make another authored edit, and confirm that edit stays unsaved when copying finishes.
- [ ] Verify normal authoring, event editing, movement, multi-selection, playback, scrubbing and Rig Editor exports still work.

Import/reload, drag-and-drop, visual round-trip comparison, onion skinning, ghost poses, mirrored animation tools, IK target authoring and IK baking are deferred to v0.5.2.8.2+.
