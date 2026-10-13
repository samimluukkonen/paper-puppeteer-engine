# Animation Editor UX and production verification — v0.5.7.5

[Artist workflow](animation-editor.md#production-animation-workflow) · [Profiling](profiling.md#dense-editor-workflow) · [Development checks](development.md#checks-and-profiling)

## Implemented behavior

The v0.5.7.5 pass completes the filtering/navigation/snapping/retiming milestone using the existing AnimationEditorState document, clock and SnapshotHistory. No major subsystem, schema change or runtime editor dependency was added. Package SemVer is `0.5.7-5`.

- Toolbar and keyboard Delete share `AnimationEditorState.deleteTimelineSelection()`, dispatching to bone groups, one IK channel key or one event. Previously the toolbar enabled itself for an IK key but invoked bone deletion. Escape now also clears selected IK-key identity while retaining the selected constraint for inspection.
- Retime requires bone keys or an IK channel key. Delete, copy, duplicate, paste, mirror and bake entry controls explain missing selection/setup in their titles. Fit Selection accepts hidden bone keys, an IK key or an event. IK clipboard/duplication remain unavailable. Mirror configuration stays reachable when pairs need repair; individual mirror commands retain validated mapping/transform checks. Bake requires active rig constraints, then the panel validates selection, ownership, FPS and proposal fidelity before enabling commit.
- Retime and bake buttons reference visible disabled explanations. Tool-panel Escape stops propagation and preserves background selection. IME Escape does not dismiss those panels. Tool arrows/Delete leave background authored keys alone. Unrelated page controls no longer trigger editor global commands; body/canvas focus retains playback navigation. Native input, editable-text and dialog shortcuts remain guarded.
- Existing styles, focus treatments, property diamonds, compact menus, explicit Close buttons and responsive inspector layout are retained. Help contains the complete shortcut scope and workflow; the artist guide now includes all eleven workflow steps and removes stale zoom/deferred-retiming guidance.

## Timeline and authored timing

The existing timeline uses one seconds-to-pixels mapping shared by ruler, playhead, markers, marquee, scrubbing and pointer drags. Native horizontal scrolling and bounded 1×–128× zoom remain view state. Fit uses hidden selections too. Pointer anchoring and visible-range ruler generation remain unchanged; the fit-button clock refresh now checks selection presence without allocating a selected-time array every frame.

One shared snapping resolver aligns frames, keys, events and the captured playhead within eight current-zoom pixels. It excludes moving source identities, resolves deterministic nearest-first priorities, shows a labeled temporary guide and supports Shift bypass without introducing authored history. Group movement retains relative offsets.

Retiming builds a detached complete proposal, validates selected identities, scales around the earliest time or playhead, rejects bounds/selected-destination conflicts atomically and replaces unselected same-property collisions. Apply creates one working-copy history snapshot, reconciles destination selections, pauses playback and preserves duration, FPS, values, interpolation, events and source data. The numerical preview never enters history or exports.

## React and Phaser lifecycle

React owns the shell and tool panels; authoritative authored state stays in AnimationEditorState. Clock-only notifications update time/playhead controls without rebuilding tracks or the full React shell. Tool adapters retain snapshots when visible values/readiness are unchanged. Empty IK inspectors now skip clock reconciliation entirely and compare selected snapshots structurally instead of serializing them. Immutable authored-property queries reuse existing property indexes; mutable caller data continues to be inspected afresh.

Failed scene setup now releases workspace-selection subscriptions, clears the bone hierarchy and its listeners through `BoneInspectorController.unbind()`, and binds timeline adapters to an empty session before presenting the error. These adapters cannot keep editing obsolete authored data. Rebinding builds fresh hierarchy controls; unbind/dispose are safe to repeat. Tests exercise old controls after unbind and old state after rebinding.

Existing Phaser shutdown handling disposes the owned preview, puppet, ghost pool, IK handles and mirror/bake overlays; it removes scene pointer handlers and rejects late character loads. Timeline disposal cancels gestures, releases capture, removes keyboard/listener scopes and disconnects resize observation. Bake planning cancels debounce/worker tasks on options/session changes, closed panels and disposal; obsolete replies cannot install results. Scene, ghost, handle, preview and worker lifecycle regressions remain part of the full unit suite. React panel cleanup hides previews without committing data. No extra per-frame React clock was introduced.

## Data and history regression

The combined hardening workflow commits bone editing, X/Y target editing, clip interpolation, an event update, mirroring, group retiming and IK baking. Each changed operation publishes one coherent notification and adds exactly one authored history entry. Undo restores every prior immutable snapshot; Redo restores the exported checkpoint and its clean dirty state. Selection is reconciled against current authored data after restoration.

Toolbar tests cover empty, hidden bone, IK and event selections, disabled reasons and exact Undo restoration. Adapter tests cover playback snapshot stability, hidden selected IK inspection, replacement-session isolation and resource cleanup. Existing suites cover marquee, copy/paste, group movement, snapping overrides, interpolation, event identity, ghost appearance, mirror mapping, IK baking, import failure atomicity, character switching and rig editing/history/export.

Sources and rig data remain immutable. Filtering, zoom, selection, expansion, snapping, mirror mapping, preview options and panel settings never enter rig/animation/skin/manifest JSON. A combined exported bone/IK/baked clip is loaded through normal CharacterLoader and played/sampled by Puppet; all bone transforms, event data and baked IK suppression are compared. Import starts a clean session with reset selections, history and playhead. No editor runtime imports or external-format changes are required.

## Performance findings

The local dense Chrome diagnostic uses 32 bones, three property tracks per bone, 128 key rows per track, two IK targets and 128 events. Actual measurements and reproduction commands are in [the profiling guide](profiling.md#dense-editor-workflow). Playback produced zero timeline-track DOM mutations in all six observed samples. Search/expansion still materialize individual property markers and have noticeable dense-workload costs; no virtualized timeline or unsupported frame-rate claim was added.

## Verification results

The final sequential required run completed successfully on Node 24.19.0:

| Command                                                            | Result                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                | Exit 0; strict TypeScript passed                                                         |
| `npm run test`                                                     | Exit 0; 129 files passed, 3 skipped; 2,211 tests passed, 32 skipped; 22.52 seconds       |
| `npm run build`                                                    | Exit 0; demo and library/declarations built; built `/core` works in plain Node           |
| `npm run check`                                                    | Exit 0; formatting, type-aware lint and typecheck passed                                 |
| `npm run test:package`                                             | Exit 0; isolated consumer, declarations, documentation links and browser bundling passed |
| `npm run check:version`                                            | Exit 0; `0.5.7-5` is valid SemVer                                                        |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:timeline -- --workflow` | Exit 0; three dense browser samples, no page exceptions                                  |

The existing build emits two nonfatal lucide-react `use client` bundler warnings. Optional performance tests stay skipped in the normal unit run.

A broad local browser run hit the default 30-second timeout in an existing multi-step authoring test. A four-worker attempt competed with unit profiling tests and was stopped; the overlapping unit attempt timed out in two ghost-pool tests. Required checks were rerun sequentially and all passed. These interrupted browser runs are not claimed as full-suite verification. The focused sequential browser run passed **36 scenarios in 5.0 minutes** (18 each against development and production), exit 0. It covers event editing; group nudging/clipboard/duplicate/delete; command availability and IK deletion; panel dismissal; worker cancellation; visual IK handles; import/export; interpolation/history; mirroring; marquee; onion skins; retiming; zoom/drag coordinates; snapping; playback DOM stability; hidden selections; rig canvas dragging/history; and rig export/import reloads.

Exact local browser command:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test --workers=1 --timeout=90000 -g 'context commands|retiming panel|preview/compress|group event snapping|pointer zoom|hidden selected keys|dense bake planning|hand and foot handles|onion skins render|current pose and selected keys|clip declaration UI|paste and downloaded|multi-track marquee/delete|a canvas drag released outside|exported, original and imported|playback updates time|moved group nudge|event name drafts'
```

Browser scenarios are local-only; no browser installation, smoke tests or periodic dependency audits were added to CI.

## Manual verification

No human/manual UI walkthrough is claimed. The local browser regression suite and dense profile exercise real DOM, Chrome pointer/keyboard input and Phaser canvas behavior automatically. A human artist review of terminology, visual focus, tooltips and subjective interaction feel remains useful; automated timings do not establish subjective usability.

## Files and APIs

- `AnimationEditorState.deleteTimelineSelection()` provides common typed command dispatch; `AnimationEditorSelectionCommands.clearTimelineSelection()` includes IK keys.
- `commandAvailability.ts`, session/navigation controllers, retiming controller and tool panels provide selection-aware availability, explanations and guarded dismissal.
- `BoneInspectorController.unbind()`, `TimelineController.showError()` and `main.tsx` release failed/replaced UI sessions.
- `IKInspectorController` avoids empty-panel clock work; `keyframeQueries.getAuthoredBoneProperties()` uses immutable property indexes.
- `scripts/profile-timeline.mjs --workflow` delegates the representative dense diagnostic to `scripts/profile-editor-workflow.mjs`.
- `animationEditorHardening.test.ts`, keyboard/navigation controller tests and local `animationHardening.spec.ts` expand regression coverage.
- Artist/help text, README, changelog, profiling/verification guides and package/lock versions are updated. Engine APIs, schemas, runtime formats and dependencies are unchanged.

## Deferred scope

Sprite import/replacement, Animation Editor rig-joint editing, artwork asset management, advanced retargeting, scene choreography, physics/ragdolls and mesh deformation remain deferred. IK marker group selection/clipboard/dragging and advanced curves remain outside the existing editor contract.
