# Animation curve foundation — v1.1.2.1

The runtime's existing property sampler remains authoritative. Bone and IK channels use the same evaluator in raw previews, smooth/stepped playback, layers, crossfades and IK baking. No Graph Editor or tangent controls were added.

## Interpolation and data

Previously, interpolation was linear only. Smooth playback sampled continuously; stepped playback quantized time at the authored FPS. Those behaviors and the optional clip-level `interpolation: 'linear'` default remain unchanged.

Bone and IK keyframe rows now accept an optional `curves` map. Each keyed property can specify outgoing `linear`, `stepped` (hold), or `bezier` interpolation. Bézier controls use normalized segment time/value progress, with finite coordinates in `[0, 1]` and ordered time handles. Deterministic bisection supports flat and coincident handles. Curves remain bounded; overshoot and explicit multi-turn rotation are outside this extension.

The file format remains version **1**. New readers preserve old animations and omitted defaults; older strict readers require updating to accept the new optional field. Serialization retains exact handle values and deterministic ordering. Controls must belong to a numeric property on the same row. Existing strict timeline validation rejects duplicate, descending and out-of-range times; zero clip duration remains invalid. Terminal controls are allowed but have no outgoing segment to evaluate. No viewport or selection state enters JSON.

Rotation still follows the shortest arc in radians, including the existing negative half-turn tie. Curves change progress along that arc without reinterpreting authored values as full-turn spins. Exact-key sampling retains the existing equivalent unwrapped angular endpoint convention; samples after the final key hold its stored value. See the [animation data contract](animation.md#interpolation-and-sample-timing).

## APIs and authoring compatibility

- Export `sampleProperty` through `/core` and the root/runtime entries. Future graph previews can sample compiled property maps directly.
- Export `CurveHandle`, `PropertyCurve` and `PropertyCurves` types through `/core`, root/runtime and `/data`.
- Extend authored bone/IK rows with optional `curves`, and compiled `PropertyKeyframe` with optional `curve`. Compiled controls are detached and deeply immutable.
- Preserve controls through value edits, movement, retiming, clipboard, duplication, selected-key mirroring, import/export and Undo/Redo. Property deletion removes only its own controls. Copied default keys reset destination controls; unrelated channels remain intact.
- Bake IK through ordinary runtime sampling. Generated rotations use linear interpolation and replace previous rotation controls; unrelated authored curves remain.
- Existing read-only segment metadata and marker descriptions recognize overrides. Visual editing remains deferred.

## Changed files

| Area                                                         | Files                                                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime model, evaluation and public exports (`src/engine/`) | `animationCurves.ts` (new), `AnimationClip.ts`, `core.ts`, `data.ts`                                                                                             |
| Validation and file schema                                   | `src/engine/schemas.ts`, `src/engine/validation.ts`, `schemas/animation.schema.json`                                                                             |
| IK authoring and baking (`src/engine/ik/`)                   | `animationKeyframes.ts`, `IKBakeCommit.ts`                                                                                                                       |
| Editor data preservation (`src/devtools/animation-editor/`)  | `animationSerialization.ts`, `keyframeClipboard.ts`, `keyframeEdits.ts`, `keyframeQueries.ts`, `keyframeRetiming.ts`, `keyframeMirroring.ts`                     |
| Existing read-only interpolation information                 | `src/devtools/animation-editor/interpolation.ts`, `interpolationPresentation.ts`, `TimelineTracksController.ts`; `src/devtools/shared/guides/animationGuides.ts` |
| Regressions                                                  | `tests/animationCurves.test.ts` (new, 35 tests)                                                                                                                  |
| Documentation                                                | `README.md`, `CHANGELOG.md` (heading `1.1.2-1`), `docs/animation.md`, `docs/animation-editor.md`, this report                                                    |

## Verification

| Command                    | Result                                                                            |
| -------------------------- | --------------------------------------------------------------------------------- |
| `npm run typecheck`        | Exit 0                                                                            |
| `npm run test`             | Exit 0: 190 test files passed, 5 skipped; 3,364 tests passed, 46 skipped          |
| `npm run build`            | Exit 0: application and library builds, declarations and Node entry checks passed |
| `npm run check`            | Exit 0: formatting, lint and type checking passed                                 |
| `npm run schemas:generate` | Exit 0: animation schema regenerated                                              |
| `npm run check:version`    | Exit 0: existing package/lockfile versions and changelog agree                    |
| `git diff --check`         | Exit 0                                                                            |

The new regressions cover defaults and linear interpolation, stepped segments and playback, existing smooth sampling, Bézier endpoints/midpoints/time inversion, finite degenerate controls, invalid handles, duplicate/descending times, zero duration, shortest-path wrapping, negative/scale values, IK influence, immutable ownership, deterministic serialization, editing/history, mirroring, layers/crossfades and baking. Existing fixtures and compatibility regressions pass in the complete suite.

One earlier full-suite run alongside build/check work timed out in the existing large-scene autosave test. The complete suite passed when rerun without concurrent builds. No timeout or CI configuration was changed.
