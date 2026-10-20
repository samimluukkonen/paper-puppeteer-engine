# v0.5.2.6.3 — Interpolation Hardening & Regression

## Implemented

Hardened the existing interpolation model and key workflows for `plans/archive/plan-v0.5.2.6.3.md`. Package version is `0.5.2-6.3`. Regression coverage includes copy/paste, duplicate, group movement, collisions, deletion, exact history restoration, selection/UI reconciliation, serialization, validation, preview sampling, playback controls, FPS, IK, facing, and source immutability.

Three defects were reproduced before fixes: selection queries reported different unavailable reasons when terminal/missing references were reordered; paste/duplicate collapsed distinct group members within the shared key-time tolerance; and translation at large timestamps silently merged group identities through floating point rounding. Selection queries now prioritize missing identities. Multi-key paste uses the existing group mutation path to retain exact translated times and rejects merged identities atomically. Copy deduplicates repeated canonical references.

The plan's full per-key interpolation definition of done remains **unsatisfied by the existing model**. Previous v0.5.2.6.1/6.2 work explicitly established clip-only Linear authoring and unavailable per-key mutation. Smooth/stepped keys, mixed authored modes, and successful multi-key interpolation edits cannot be tested or implemented without changing the schema/compiler/runtime. This hardening phase preserves that boundary and adds no major interpolation feature.

## Final interpolation model

Version 1 accepts only optional clip-level `interpolation: 'linear'`. Omission has identical runtime behavior, but the declaration's presence/absence remains authored data and round-trips exactly. All segments inherit that declaration. A property's final key, singleton, or empty track has no outgoing segment, including looping clips. These states stay safe for sampling, selection, copying, UI, and validation.

Smooth/stepped are the authored `playback` sample-timing modes. Stepped sampling at 10 FPS plus Linear interpolation is valid and remains distinct from the declaration. No per-key or per-track interpolation metadata is introduced; validation continues rejecting such fields and unsupported interpolation values.

## Runtime/editor integration

The existing runtime evaluator and editor preview compilation cache remain authoritative. Snapshot changes, Undo/Redo, and Mode/FPS edits immediately refresh the held preview. Tests cover paused scrubs, Play/Pause, looping, speed changes, Restart, scrub playback suspension/resumption, and the exact endpoint between stepped frames.

The preview pipeline remains animation sampling → authored local pose → IK correction → rendering. An IK target provider asserts it receives the current authored rotation before correction, across metadata changes, history, FPS edits, and playback. Repeated facing changes preserve working snapshot identity, history, and authored metadata. Disabling IK reveals the authored sampled pose; no IK/facing data is baked into keys.

## Multi-key behavior

Selections across bones/properties inherit Linear when all keys have successors. Any terminal member makes an existing-key selection unavailable. Missing references take precedence over terminal members regardless of order. Per-key mutation stays unavailable and cannot silently change the whole clip.

History restores authored snapshots, not transient selection. Existing references survive when present in the restored snapshot, including replaced destination keys; absent references are removed. Deletion clears selection, and Undo/Redo does not resurrect it. Inspector/marker regressions verify that surviving keys gain/lose outgoing availability when successors are pasted, deleted, or restored. Surviving DOM marker buttons retain identity while titles refresh.

## Copy/paste/move preservation

Explicit and implicit Linear declarations survive paste, duplicate, move, deletion, and repeated Undo/Redo without adding/removing metadata unexpectedly. Clipboard entries contain only existing authored property values and relative millisecond times; there is no per-key interpolation metadata to copy. Cross-animation paste preserves destination interpolation, playback, and events.

Single-key paste keeps the documented nearest canonical destination-time policy. Multi-key paste/duplicate now matches group movement: remove external tolerant property collisions first, then insert every exact translated group member. Nearby distinct keys do not collide with each other. Sparse sibling properties retain their values/times. Destination values and the entire original metadata/duration restore exactly through Undo. Duplicate keeps the existing one-frame/0.01-second offset and the user's clipboard/playhead.

Group moves continue changing only key times. Source animation and mutable caller data remain untouched and unfrozen by pure helpers. Unrepresentable paste destinations reject the complete group without changing authored state/history/selection.

## Serialization/validation

Existing `state.exportJson()`, `parseAnimationClip()`, and `validateAnimationDefinition()` cover working definition → JSON → parsed clip. Round trips preserve exact keys, sparse rows, duration, event payloads, playback, and the presence/absence of Linear metadata at every step of the operation/history sequence. Unsupported values (`smooth`, `stepped`, `bezier`, empty string, null, number) reject through both validation and parsing. Invalid state replacement preserves the held authored snapshot, selection, and history.

Browser checks use the existing download workflow to compare schema-validated authored JSON before/after playback, IK, and facing changes. No new export workflow, dependencies, serialized types, or validation exceptions were added.

## Files changed

- `src/devtools/animation-editor/interpolation.ts`: deterministic unavailable-reason precedence.
- `src/devtools/animation-editor/keyframeClipboard.ts`: canonical copy deduplication and exact group paste timing.
- `src/devtools/animation-editor/keyframeEdits.ts`: optional group timing preservation and duplicate destination validation through the existing batch helper.
- `tests/animationEditorInterpolationHardening.test.ts`: 21 data/workflow regressions.
- `tests/animationEditorInterpolationUI.test.ts`: two inspector reconciliation regressions.
- `tests/animationEditorPreview.test.ts`: two sampling/playback/FPS/IK/facing integration regressions.
- `tests/browser/animationInterpolation.spec.ts`: two new scenarios, each run against development and production builds.
- `README.md`, `docs/animation-editor.md`, `docs/animation-editor-clipboard-verification.md`, this report: behavior, policy changes, and limitations.
- `package.json`, `package-lock.json`: milestone version only; no dependency changes.

The supplied plan is unchanged.

## APIs/types changed

Editor-only `setBonePropertyKeyframes()` options gain `preserveTiming?: boolean`, used by multi-key paste/duplicate. Default batch behavior and single-key collision canonicalization stay compatible. The option removes external collisions before inserting exact group times and rejects duplicate destination identities. No runtime/package API, interpolation mode/type, schema, clipboard shape, or selection shape changes.

## Architecture review

No new evaluator, interpolation math, authored mutation implementation, dependency, `any`, or unsafe cast. Queries use the existing canonical property indexes; paste reuses the existing batch mutation helper and its group insertion path. Authored state lives in immutable document snapshots. UI caches remain keyed by working snapshot/selection identity; added regressions exercise metadata/history/successor invalidation. Engine/editor separation remains intact. Changes are limited to the reproduced defects, regression coverage, version, and documentation.

## Tests

25 added unit cases and four added browser executions. Data coverage uses the requested three rotation keys at 0/0.5/1 seconds and two x keys at 0.2/0.8 seconds on a second bone, with existing Linear interpolation under both smooth and stepped playback. It tests implicit/explicit declaration preservation, cross-clip paste, exact snapshot identity through five-step history, replaced collisions, nearby distinct keys, precision rejection, repeated copy references, singleton/empty tracks, strict validation, source immutability, and serialization throughout. UI tests verify reconciliation after all key operations and successor deletion/history. Preview tests verify runtime sampling before IK, facing isolation, and playback/FPS behavior.

The full unit and browser suites cover the existing Rig Editor, character loading, Animation Editor lifecycle, ruler/tracks/markers, selection/marquee, key create/update/delete, individual/group movement, snapping, clipboard, Undo/Redo, playback, looping, scrub, speed, FPS, validation, source ownership, IK, and facing.

## Manual verification

The browser workflow exercises the requested two-bone key pattern through multi-selection, clip declaration editing, copy/paste, duplicate, nudge/group move, deletion, repeated Undo/Redo, sampling settings, playback/speed/loop, IK, and facing. A second scenario checks singleton/empty properties and surviving marker availability after successor deletion/history. Desktop hardening and mobile interpolation screenshots were generated and visually reviewed. Automated browser verification substitutes existing clip Linear + separate playback modes for the plan's unsupported per-key smooth/stepped modes. A separate hands-on manual pass has not been performed.

## Required command results

- `npm run typecheck`: passed, exit 0.
- `npm run test`: passed, exit 0; 75 files passed, 3 skipped (78 total); 1,258 tests passed, 28 skipped (1,286 total). All 25 added unit cases passed. No existing skip policy changed.
- `npm run build`: passed, exit 0; demo and library production builds, TypeScript declarations, and the Node `/core` smoke check passed.
- `npm run lint`: passed, exit 0.
- `npm run check:version`: passed, exit 0; `0.5.2-6.3` is valid SemVer.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationInterpolation.spec.ts`: passed, exit 0; all 10 development/production interpolation scenarios passed (1.2 minutes).
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test --grep-invert='animationInterpolation.spec.ts'`: passed, exit 0; all 182 remaining development/production browser scenarios passed (14.2 minutes). Together the two configured single-worker runs verify the complete 192-scenario suite.
- Formatting checks for changed files and `git diff --check`: passed, exit 0.

Browser execution required localhost/Chrome access outside the filesystem sandbox; the sandbox attempt failed to bind port 4173. An initial full run was interrupted to try four workers. That parallel attempt exceeded 30-second timeouts in two existing scenarios and was stopped. Both cases, and every remaining scenario, subsequently passed with the repository's configured single worker. No browser timeout, assertion, or production behavior was weakened to obtain the passing results.

## Deferred to v0.5.2.7+

Per-key/per-track interpolation schema/compiler/runtime design, smooth/stepped segment authoring, successful multi-key interpolation edits, and mixed authored modes. The full interpolation milestone requires that separately authorized model extension.

Events/event tracks and authoring; onion skinning and ghost poses; mirrored keyframe operations; IK target authoring and IK baking; advanced curve editing (Bézier curves, custom easing, and tangent handles). No deferred feature was implemented.
