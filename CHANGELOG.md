# Changelog

Versions use package SemVer; for example, milestone `0.5.2.8.3` is packaged as `0.5.2-8.3`.

## Unreleased

- Publish completed Animation Editor commands in one state notification.
- Share pending import and export guards between the editors.
- Group overlapping collapsed timeline summaries by pixel position and add `npm run profile:timeline` for local browser measurements.
- Share responsive inspector behavior across the demo and both editors.

## 0.5.4-4

The v0.5.4.4 [React mirroring tools](docs/react-mirroring-tools.md) expose bone-pair configuration, all three copy directions, current-pose and selected-key commands, and a violet read-only pose overlay in the Animation Editor. Validated browser preferences restore pairs for the same rig without entering authored JSON. React subscribes to authoritative editor selection, cached readiness reports actionable mapping/transform errors, and existing commands retain atomic history and destination selection. Mirror previews share the render-only artwork projection with onion skins while retaining separate resources and following facing/skin changes. M toggles preview; the Help dialog documents the workflow.

## 0.5.4-3

The v0.5.4.3 [mirrored keyframe authoring](docs/mirrored-keyframe-authoring.md) adds explicit current-pose and selected-key commands for left-to-right, right-to-left and snapshot-based swap. Existing runtime evaluation supplies pre-IK context, while sparse property projection preserves selected properties, exact times, duration and clip interpolation/playback metadata. Batch replacement reuses group collision semantics and validation, with one document/history transaction and coherent destination selection. React mirror controls and automated generation remain deferred.

## 0.5.4-2

The v0.5.4.2 [pose mirroring core](docs/pose-mirroring.md) adds pure left-to-right, right-to-left and snapshot-based swap operations using the existing bone symmetry mapping. Bind-relative affine reflection respects resolved rest offsets, rotations, scale and corresponding parent frames. Unsupported hierarchy, singular scales, animated scale-sign changes and unrepresentable shear return structured atomic failures. Authored pre-IK data, unpaired bones, centerline motion, artwork and attachments retain their existing ownership; keyframe writing and React controls remain deferred.

## 0.5.4-1

The v0.5.4.1 [bone symmetry mapping foundation](docs/bone-symmetry-mapping.md) adds immutable editor-only left/right pairs, an indexed bidirectional lookup, optional token-aware automatic candidates, manual overrides, and structured validation. Mappings belong to one rig session and survive animation changes without entering authored JSON, dirty tracking or history. Ambiguous names stay unpaired, and hierarchy compatibility problems produce warnings. Pose/keyframe mirroring, visual mapping tools and persistence remain deferred.

## 0.5.3-4

The v0.5.3.4 [onion-skin production hardening](docs/animation-editor-onion-skinning-verification.md) completes the v0.5.3 onion-skin milestone. An eight-time runtime pose cache reuses held stepped neighbors, and hidden pool entries release obsolete pose references. Expanded regressions compare ghosts against runtime playback through authoring transactions, import/export, transforms, events and scene cleanup. Artist documentation explains FPS, boundaries, authored-pose IK limitations and an arm-swing workflow; the settings panel identifies ghosts as read-only authored poses.

## 0.5.3-3

The v0.5.3.3 [multi-ghost artist controls](docs/onion-skin-controls.md) extend onion skinning to zero through three poses per direction, spaced by one through five authored frames. A compact native panel adds independent counts, opacity sliders and color inputs. Frozen scene preferences stay outside animation JSON, dirty tracking and history. A lazy six-instance render pool reuses artwork and poses, follows working edits and playback immediately, and preserves the authoritative active preview.

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
