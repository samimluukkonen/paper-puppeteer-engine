# Release notes and milestone reports

[Current onboarding](../README.md) · [Changelog](../CHANGELOG.md)

These historical summaries were moved from the README. Version numbers, completion statements and verification results describe their recorded milestones. Use the README and linked workflow guides for current installation, authoring and runtime integration.

## Release reports

- [v1.5.6 reusable animation and scene assets](reusable-assets-readiness.md)

- [v0.6 Production Authoring release notes](release-notes-v0.6.md) and [release gates](release-readiness.md)
- [v0.8 Actor and choreography release report](release-notes-v0.8.md)
- [v0.9 Scene Editor readiness](scene-editor-readiness.md)
- [v1.0.5 personal production readiness](personal-production-readiness.md)
- [v1.1 advanced animation readiness](advanced-animation-readiness.md)
- [v1.2 cinematic integration report](cinematic-scene-readiness.md)
- [v1.3 audiovisual integration report](audiovisual-scene-readiness.md)
- [Mesh production readiness](mesh-production-readiness.md)

## Authoring milestones (v0.5)

The completed v0.5.5 [IK authoring workflow](ik-animation-authoring.md) covers reaching, influence, supported timeline operations, serialization, compatibility and production verification.

The completed v0.5.6 [IK Baking workflow](react-ik-baking.md) selects rig constraints, controls sampling FPS, previews the proposed baked animation while scrubbing, and reports actual key counts before a single undoable bake. [Production fidelity checks](ik-bake-hardening.md) compare key-time and between-key runtime motion, including endpoint positions, with measured low-FPS feedback. It reuses [atomic IK bake commit](ik-bake-commit.md), [bone-key generation](ik-bake-generation.md), and [isolated sampling](ik-bake-sampling.md).

The completed v0.5.7 [Animation Editor workflow](animation-editor.md#production-animation-workflow) combines track filtering, zoom/navigation, advanced snapping, proportional retiming, bone/IK authoring, mirroring, baking and events. See [UX and production verification](animation-editor-ux-verification.md) for command guards, history/lifecycle regressions and dense-workload measurements.

The v0.5.8.1 [sprite import and replacement foundation](sprite-replacement.md) adds local PNG/WebP validation, original/replacement comparison, Phaser preview, explicit Apply/Cancel and original-artwork reversion in both editors. Pending binary assets stay in session memory, separate from authored JSON.

The v0.5.8.2 [visual artwork alignment](visual-artwork-alignment.md) adds explicit joint, artwork offset, sprite origin and slot transform modes; exact pixel pivots, joint references, undoable alignment helpers, facing and read-only animation bone poses. Artwork drag proposals stay separate from authored rig data until release.

The v0.5.8.3 [Animation Editor Rig-Tweak Mode](animation-rig-tweak.md) reuses rig joint/artwork/slot tools at the paused animation pose. Rig and animation histories, dirty states and exports remain independent; rig changes reevaluate the animation and IK without creating keys.

The v0.5.8.6 [production asset workflow](artist-workflow.md) exports complete validated character ZIPs with replacement image binaries and reloads them through `CharacterLoader` and `Puppet`. Package checkpoints track rig, skin, animation and artwork changes independently of individual file downloads.

The v0.5.8.5 [Safe Sprite Replacement & Hot Reload](sprite-replacement.md) adds explicit shared/individual artwork scopes, dimension and pivot policies, transactional preview refresh and independent artwork Undo/Redo. Stable attachment IDs, skins, slots, rig transforms and existing animations remain intact.

The v0.5.7.2 [timeline navigation and zoom](timeline-navigation.md) adds pointer-anchored zoom, horizontal panning, fit/center commands, precise seconds/frame input and optional playhead follow. Navigation preserves authored data and selection.

The v0.5.7.1 [timeline track search and filtering](timeline-track-filtering.md) finds bones, properties, IK targets and events, preserves ancestor context, and reveals hidden selections. Visibility and expansion controls preserve authored data, history and exports.

The v0.5.5.4 [visual IK target controls](visual-ik-targets.md) let artists drag hand and foot targets in the preview, cancel with Escape, and commit both coordinates with Set Target Key. Temporary previews stay outside exported JSON and document history.

The v0.5.4 [mirrored animation tools](mirroring-hardening-verification.md) combine [bone pairing](bone-symmetry-mapping.md), [bind-relative pose reflection](pose-mirroring.md), [sparse keyframe authoring](mirrored-keyframe-authoring.md), and [React controls](react-mirroring-tools.md). Browser-local pair preferences and a read-only overlay support artist review before atomic, undoable commits. The completed hardening phase covers asymmetric rigs, lifecycle cleanup, runtime/serialization regressions and an [artist walkthrough](animation-editor.md#mirror-a-left-arm-movement).

## Runtime and editor integration (v0.6)

v0.6.3 unifies the [React editor production workflow](react-editor-workflow-verification.md): shared character ownership, retained clip sessions, independent dirty domains and safe editor navigation.

v0.6.2 hardens [schema compatibility and serialization](schema-compatibility.md), retaining version-1 authored formats and verifying real v0.4.3 assets, canonical exports, cross-file references and safe package paths.

v0.6.1 stabilizes the [runtime architecture and public API](runtime-api.md), with explicit `/runtime`, `/data` and `/serialization` entry points alongside the existing root and `/core` imports. Character scene loading is available from the runtime, and ownership/cleanup contracts are documented.

## Feature Guide and runtime controllers (v0.7)

Milestone v0.7.6.6 (package `0.7.6-6`) completes the [Feature Guide](feature-guide.md), with Rig Editor and Animation Editor tutorials, optional practice using real controls, prerequisite recovery and restart/navigation. See the [implementation and verification report](feature-guide-verification.md).

v0.7.5 completes [runtime controller production hardening](runtime-controller-readiness.md), with a playback interaction matrix, standalone controls, crossfade/layer/IK regressions, cleanup stress tests and measured CPU profiles. v0.7.4 adds [async animation playback](async-animation.md): await exact playback instances with typed outcomes, wait-only cancellation and disposal cleanup. v0.7.3 adds [named animation states](animation-states.md): reusable runtime state definitions, idempotent requests, configurable crossfades and temporary actions that return to a persistent state. It builds on v0.7.2 [animation queues](animation-queues.md) and [runtime playback lifecycle and completion](playback-lifecycle.md). The [v0.6 release gates and regression results](release-readiness.md) retain the earlier production authoring assessment.

## Actors, choreography and foot contacts (v0.8–v0.9)

The v0.8 [Actor and choreography layer](choreography-production.md) supports direct movement, walk animation, spatial facing and synchronized sequential/parallel scenes with cancellation and ownership. See the [v0.8 release report](release-notes-v0.8.md) for verification and limitations.

The v0.9.8 [foot contact workflow and readiness report](foot-contact-readiness.md) covers bone-local marker authoring, explicit IK alignment, Actor grounding, exports and compatibility.

## Additional milestone verification

- [v0.5.3 onion-skin production verification](animation-editor-onion-skinning-verification.md)
- [Runtime controller readiness](runtime-controller-readiness.md)

See the [changelog](../CHANGELOG.md) for the complete version history and verification notes.
