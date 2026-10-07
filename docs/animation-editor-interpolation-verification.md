# v0.5.2.6.1 — Interpolation Authoring Core

## Implemented

Pure clip interpolation queries/edits, outgoing sparse-property segment queries, selection queries, explicit per-key/batch capability reporting, and state integration with the existing immutable document, dirty state and Undo/Redo. Package version is `0.5.2-6.1`. No UI, runtime evaluator, schema, dependency or prior editing workflow is replaced.

## Existing interpolation model

`AnimationClip.interpolation?: Interpolation` reuses the exported engine type `Interpolation = 'linear'`. The Zod runtime and strict version 1 JSON schemas accept only this literal. Omitting the declaration defaults to the same linear interpolation. Tracks are arrays of sparse transform keyframes; neither tracks nor keys have interpolation fields. The compiler builds independent property timelines and does not carry an interpolation override into compiled keys. The evaluator linearly interpolates numeric values and uses the existing shortest angular path for rotation.

`AnimationPlaybackMode` is a separate strict type: smooth continuous sampling or stepped FPS quantization of the same linear evaluator. A clip's `playback` is authored metadata; the player default is runtime configuration, and editor speed/loop are preview preferences. Existing authored Mode/FPS APIs remain authoritative. Smooth/stepped do not map to authored interpolation and are rejected by these new APIs.

## Segment ownership

The clip owns interpolation for every segment. No endpoint owns a mode. `getSegmentInterpolation(animation, ref)` identifies the outgoing segment from the resolved key to the next key of the same bone/property, skipping rows that author only sibling properties. It returns canonical references in editor seconds, `scope: 'clip'` and `mode: 'linear'`. It reuses the existing tolerant key resolver and preserves distinct nearby canonical keys when finding the next endpoint. No pose evaluation is duplicated.

Last keys and single-key timelines return no outgoing segment. Looping wraps time without introducing a last-to-first segment. Clip metadata can still be authored on single-key or empty clips; it has no new segment effect. Property values continue to hold under the existing evaluator rules.

## Mutation APIs

- `setAnimationInterpolation(animation, rig, mode)` adds `'linear'` or removes the declaration when passed `undefined`. It validates against the existing strict schema/rig rules and returns a new root only when metadata changes. Removing the field retains the implicit linear default.
- `setInterpolationForKeys(animation, refs, mode)` returns an unavailable result with the unchanged input and a reason. A valid outgoing selection reports `clip-only`; empty/missing/terminal selections report their query reason. Unsupported modes throw before any operation. This explicit boundary prevents key requests from changing unrelated clip segments.
- `state.setAuthoredInterpolation(mode)` installs a validated immutable working snapshot through the existing document/history transaction. It returns false for invalid modes or a missing clip/rig.
- `state.setSelectedKeyframeInterpolation(mode)` returns false without changing data, history, validation, drafts, clock, selection or notifications.

Pure edits never mutate or freeze mutable caller inputs. Keys retain their exact bone/property/time/value and array identities; tracks, events and playback are shared unchanged. Source animation remains immutable. Adding/removing metadata preserves strict JSON serialization; no editor-only fields are exported.

## Multi-key behavior

`getInterpolationForKeys(animation, refs)` returns `{ kind: 'uniform', scope: 'clip', mode: 'linear' }` when every key identifies an outgoing segment. Any empty, missing or terminal reference makes the whole selection unavailable; duplicates are harmless. Mixed interpolation cannot exist under this schema, so the selection type deliberately has no unreachable mixed variant. Distinct smooth/stepped playback modes cannot create a mixed selection.

Individual or selected-key mode edits cannot be implemented without a schema/compiler/runtime extension. The plan explicitly requires preserving the existing representation and forbids pretending that per-key interpolation exists. Accordingly, this milestone implements the compatible clip-level operation and honest selection capability reporting. It does not claim smooth-to-stepped key interpolation, mixed authored modes, or successful multi-key interpolation mutation. A clip declaration change made while several keys are selected records one history transaction; unavailable selection edits record none.

## Files changed

- `src/devtools/animation-editor/interpolation.ts`: pure queries, edits and capability types.
- `src/devtools/animation-editor/AnimationEditorState.ts`: state query/mutation integration.
- `tests/animationEditorInterpolation.test.ts`: metadata, scope, history, runtime and serialization regression tests.
- `README.md`, `docs/animation-editor.md`, this report: behavior and verification documentation.
- `package.json`, `package-lock.json`: milestone version only.

The supplied plan remains unchanged.

## APIs/types changed

Editor-only types: `SegmentInterpolation`, `InterpolationSelectionState`, `InterpolationUnavailableReason`, `UnavailableInterpolationEdit<Animation>`. The strict engine `Interpolation` type is reused unchanged.

Pure functions: `getAnimationInterpolation`, `getSegmentInterpolation`, `getInterpolationForKeys`, `setAnimationInterpolation`, `setInterpolationForKeys`. The clip setter's return type preserves unrelated input fields while keeping `interpolation` optional, including when removing an explicitly declared field.

State additions: `authoredInterpolation`, `selectedInterpolation`, `getSegmentInterpolation`, `setAuthoredInterpolation`, `setSelectedKeyframeInterpolation`. Runtime exports, JSON schemas and existing authored playback APIs are unchanged.

## Tests

Twenty-three new pure/session regression cases cover implicit/explicit linear declarations, playback independence, outgoing segment ownership, sparse properties, canonical reference tolerance, close distinct keys, last/single/empty timelines, unavailable refs, whole-selection rejection, no-op identity, mutable/frozen source ownership, preservation of all unrelated data, unsupported smooth/stepped modes, strict key/track schema rejection, exact Undo/Redo, saved checkpoints, no-op redo/draft/notification preservation, serialization and unchanged smooth/stepped runtime evaluation.

## Verification

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 71 files passed, 3 skipped (74 total); 1,183 tests passed, 28 skipped (1,211 total). All 23 new interpolation tests passed.
- `npm run build`: passed, exit 0; demo and library production builds, TypeScript declarations and the Node `/core` smoke check for character loading, validation, animation and IK passed.
- `npm run lint`: passed, exit 0.
- `npm run check:version`: passed, exit 0.
- Formatting checks for changed source/tests/documentation/package manifest and `git diff --check`: passed, exit 0.

No browser/manual pass was run: this milestone adds no UI or runtime evaluation changes. The full unit suite covers the existing editor and runtime regression paths.

## Deferred to v0.5.2.6.2+

Interpolation controls and marker appearance, curve editor, Bézier/tangents, easing presets/custom curves, event tracks, onion skinning, ghost poses, mirrored keys, IK targets and baking. Per-key/per-track modes, successful multi-key interpolation edits, and mixed authored modes require an explicit runtime/schema design before a UI can expose them.
