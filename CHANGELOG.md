# Changelog

Versions use package SemVer; for example, milestone `0.5.2.8.3` is packaged as `0.5.2-8.3`.

## Unreleased

- Require PNG-header checks before decoding character artwork by default; trusted alternative formats can opt out with `requirePng: false`.

- Publish completed Animation Editor commands in one state notification.
- Share pending import and export guards between the editors.
- Group overlapping collapsed timeline summaries by pixel position and add `npm run profile:timeline` for local browser measurements.
- Share responsive inspector behavior across the demo and both editors.

## 0.5.8-3

The v0.5.8.3 [Animation Editor Rig-Tweak Mode](docs/animation-rig-tweak.md) adds explicit Animation/Rig Tweak authoring modes at a preserved, paused playhead. The existing Rig Editor supplies joint, artwork offset/origin, slot, hierarchy, inspector, validation, history and file tools. One rig working copy projects updated bind data through detached animation sampling and existing runtime IK; animation keys and history remain unchanged. Separate rig/animation statuses, export/revert paths, navigation protection and shared source-bound browser rig drafts keep ownership clear across editor routes. Same-topology rig imports retain animation sessions; topology/artwork replacement belongs to the Rig Editor. Package version is `0.5.8-3`.

## 0.5.8-2

The v0.5.8.2 [visual artwork alignment](docs/visual-artwork-alignment.md) separates joint, artwork offset, sprite origin and slot transform canvas operations and keyboard nudges. The React inspector shows current image dimensions, pixel/normalized pivots, joint references and artwork transform settings, with undoable offset/origin reset and origin centering. Phaser draws selected bounds and joint/pivot guides; artwork drag proposals remain render-only until one release commit. Escape and lifecycle interruptions cancel gestures while preserving redo. Facing and existing animation bone pose/time previews stay outside authored data; animation keys, IK keys, events and timing are untouched. Artwork offsets/origins serialize at full precision. Unit and local Chrome regressions cover transforms, replacement dimensions, history and export/reload. Package version is `0.5.8-2`.

## 0.5.8-1

The v0.5.8.1 [sprite import and replacement foundation](docs/sprite-replacement.md) adds a shared React artwork panel to both editors. Local static PNG/WebP imports validate headers, dimensions, size and browser decoding before private Phaser textures are installed. Original/temporary/preview/applied artwork stays separate from rig and animation documents, history, drafts and JSON exports. Cancel restores the previous working artwork; Revert restores original textures. Pending asset changes independently protect navigation. Texture ownership, decode cancellation, rig reloads, attachment changes and hidden preview cleanup are covered by regressions. Source-file writes, dimension migration, atlas replacement and production asset packaging remain deferred. Package version is `0.5.8-1`.

## 0.5.7-5

The v0.5.7.5 [Animation Editor UX and production hardening](docs/animation-editor-ux-verification.md) completes v0.5.7. Toolbar and keyboard deletion share typed bone/IK/event dispatch; Escape clears IK-key selection and tool dismissal retains background selection. Context commands provide actionable disabled explanations. Empty IK inspectors skip clock work, immutable authored-property queries reuse indexes, and fitting no longer builds selection arrays every playback frame. Failed scene adapters release obsolete timeline, bone hierarchy and workspace subscriptions. Combined regressions cover atomic history, hidden selection, immutable data and export → CharacterLoader → Puppet playback. Artist workflow/help and a local 32-bone dense browser profile document controls and measured responsiveness limits. Package version is `0.5.7-5`.

## 0.5.7-4

The v0.5.7.4 [bulk keyframe retiming](docs/keyframe-retiming.md) adds proportional compression/expansion around the earliest selected time or current playhead. Tools → Retime selected keys shows actual selection counts and a read-only numerical proposal before one atomic Undo/Redo commit. Typed bone groups and IK channels preserve authored values, interpolation, FPS, duration and events. Bounds overflow and unrepresentable destinations reject the whole operation; external property collisions reuse group-move replacement. Unit and local browser regressions cover timing, selection, immutable sources, failure atomicity and exported playback. Package version is `0.5.7-4`.

## 0.5.7-3

The v0.5.7.3 [advanced timeline snapping and guides](docs/timeline-snapping.md) adds independent editor-only frame, keyframe, event and captured-playhead targets through one shared resolver. An 8-pixel zoom-aware threshold and documented nearest-first tie priorities keep alignment deterministic. Bone/event drags show a temporary guide, exclude moving source identities, preserve group spacing and retain transactional collision/history behavior. Shift bypasses snapping even with a stationary pointer; supported IK key movements share the resolver. Unit and local browser regressions cover target modes, geometry, clean preferences, cancellation, source immutability and Undo/Redo. Package version is `0.5.7-3`.

## 0.5.7-2

The v0.5.7.2 [timeline navigation and zoom](docs/timeline-navigation.md) extends the existing shared timeline coordinates with bounded 1×–128× zoom, pointer-anchored Ctrl/Cmd-wheel zoom, native/Shift-wheel horizontal panning, fit animation/selection and center-playhead commands, continuous time input, zero-based authored frame input, optional playback edge-follow and guarded keyboard navigation. Hidden selected keys participate in fitting. Resize preserves the center time; visible-range ruler ticks keep long clips readable without rebuilding offscreen ticks. Unit/controller and local browser regressions cover navigation, editing alignment, selection preservation and immutable authored snapshots/history/exports. Package version is `0.5.7-2`.

## 0.5.7-1

The v0.5.7.1 [timeline track search and filtering](docs/timeline-track-filtering.md) adds case-insensitive bone/property/IK/Events search, keyed/selected-target filters, independent IK/event visibility, ancestor context, and Expand All/Collapse All/Expand Selected. Search expansion restores manual preferences when cleared. Hidden bone, property, key, IK and event selections persist; Reveal Selection restores visibility and deletion shows total/hidden key counts. Cached pure visibility derivation reuses existing rows and clock updates; additive marquee selection excludes hidden rows while clipboard, deletion and group commands retain their complete selected scope. Unit and local browser regressions cover filtering, playback, preview picking, history and immutable exports. Package version is `0.5.7-1`.

## 0.5.6-5

The v0.5.6.5 [IK baking production hardening](docs/ik-bake-hardening.md) completes v0.5.6. Public `compareIKBakeMotion` and successful commit reports distinguish generated-key agreement from midpoint/near-end interpolation drift, including complete selected joint transforms and end-effector world distances. The React panel displays measured errors and low-FPS feedback; incompatible stepped sample grids report the authored FPS. Regressions add 8/10/12/60 FPS, influence/target edge cases, facing/nonuniform placement, ordinary baked-key editing/history, onion skins, bone mirroring, events and canonical JSON/CharacterLoader compatibility. Artist guidance documents reaching, tolerances and mixed baked/IK transition limits. Package version is `0.5.6-5`.

## 0.5.6-4

The v0.5.6.4 [React IK Baking workflow](docs/react-ik-baking.md) adds explicit rig constraint selection, sampling FPS, linear output, actual affected-bone/generated/replaced-key summaries, and validation feedback before commit. A detached baked-pose overlay follows the existing playhead and retains unselected IK and authored playback settings. Baking uses the existing atomic state command, pauses playback and creates one Undo/Redo operation. Options, document/session changes, panel unmount and scene shutdown clear previews; runtime providers/overrides and overlapping driven chains block baking. Partial ranges, reduction, solver configuration, mirrored baking and retargeting remain deferred.

## 0.5.6-3

The v0.5.6.3 [atomic IK bake commit](docs/ik-bake-commit.md) adds public `commitIKBake` and the editor state command. Whole-clip transactions validate current source/rig fidelity, replace only generated bone properties, remove selected IK tracks and serialize clip-local `disabledIKConstraints`. Runtime suppression follows existing masks, weights and fades and skips selected constraints even with runtime target/mix ownership. Unrelated animation data, playback/FPS and rig constraints remain intact. One history entry restores exact original/baked snapshots through Undo/Redo and saved-checkpoint dirty semantics. React Bake UI, partial ranges and key reduction remain deferred.

## 0.5.6-2

The v0.5.6.2 [IK bone-key generation](docs/ik-bake-generation.md) adds pure `generateBakedBoneKeys` proposals using ordinary local-radian rotation tracks, with affected-property counts and authored replacement details. Existing frame grids, linear interpolation and stepped/smooth playback remain authoritative. `compareIKBakeFidelity` measures complete selected local poses at sample times with explicit translation, rotation and scale tolerances; invalid values, conflicting ownership and inaccurate proposals fail. Generation preserves source/working data, IK and history. Commit, IK deactivation, Bake UI and simplification remain deferred.

## 0.5.6-1

The v0.5.6.1 [IK bake sampling foundation](docs/ik-bake-sampling.md) adds isolated whole-animation sampling through the existing bone/IK evaluators and two-bone solver. Samples preserve complete solved bone-local transforms, exact endpoints, authored FPS and stepped playback. Structured atomic failures report competing bone ownership, unsupported transforms and runtime dependencies. Inspector sampling shares the isolated context; deterministic runtime comparisons and editor regressions verify source/working data, clocks, events, history and live poses remain unchanged. Key generation, IK deactivation, Bake UI and partial ranges remain deferred.

## 0.5.5-5

The v0.5.5.5 [IK authoring hardening](docs/ik-animation-authoring.md) completes v0.5.5. Preview and gizmo teardown are idempotent; stale preview cleanup cannot release a replacement preview. Gizmos report unsupported internal chain scales and singular chain/parent transforms using current transforms. Production regressions cover both authored arm rotations with zero/partial/full influence, loop/event timing, large deltas and speeds, immutable JSON round trips through CharacterLoader/Puppet, failed imports, legacy rigs, bone mirroring, six read-only ghosts, bounded render allocation and subscription cleanup. Artist documentation and editor Help explain reaching, interpolation and influence, coordinates, precedence, and explicit typed timeline limitations. IK baking, direct target mirroring and generic IK batch commands remain deferred.

## 0.5.5-4

The v0.5.5.4 [visual IK targets](docs/visual-ik-targets.md) add editor-only Phaser crosshairs, live target dragging with explicit puppet-local conversion, and a Set Target Key command which commits X/Y together in one Undo/Redo action. Escape restores the pre-drag preview; release retains temporary values outside authored/exported data. Camera zoom/pan, facing, scale, influence, unreachable targets, ownership-disabled states, and React/Phaser lifecycle are covered by unit and local browser tests. The Demo Puppet exposes its existing right leg chain for foot authoring; Random paperdoll sketch exposes both arm and leg chains. Mirrored IK targets and baking remain deferred.

## 0.5.5-3

The v0.5.5.3 [React IK timeline and inspector](docs/react-ik-authoring.md) expose real rig constraint tracks and independent puppet-local X/Y and mix keys through the existing timeline. Typed constraint selection isolates bone editing; explicit numeric commits pause playback, update the existing preview solver and record one working-copy history entry. Sparse deletion, single-key selection, snapped keyboard movement, source immutability and React subscription lifecycle are tested. The demo rig includes `rightArmIK`. IK group selection, marker dragging, clipboard/duplicate commands, visual target handles, mirroring and baking remain deferred.

## 0.5.5-2

The v0.5.5.2 [runtime IK evaluation](docs/ik-animation-runtime.md) compiles sparse puppet-local target and mix channels through the existing interpolation system. Playback and editor scrubbing share target sampling, stepped timing, crossfades, interrupted fades, layer weights and root-bone masks. Runtime world targets, explicit mix overrides and late-bound weapon providers retain deterministic ownership. The existing analytical solver, priority order and pre-IK pose restoration remain authoritative; source animations and bind poses stay immutable. Visual authoring, gizmos, mirroring UI and baking remain deferred.

## 0.5.5-1

The v0.5.5.1 [IK animation data model](docs/ik-animation-data.md) adds optional rig IK definitions and constraint-name keyed sparse puppet-local target x/y and solver mix channels. Pure authoring APIs reuse bone-key time matching and movement collision rules. Strict validation, generated JSON schemas, deterministic animation serialization, rig editor preservation, draft identity, and compatibility/immutability tests cover the additive version-1 fields. Animated IK evaluation and visual authoring remain deferred.

## 0.5.4-5

The v0.5.4.5 [mirroring hardening phase](docs/mirroring-hardening-verification.md) completes v0.5.4. Sparse current-pose authoring ignores unanimated incompatible transforms while retaining mapping validation. Mirror controls release cached session data on unbind/disposal, hide previews on panel unmount, and disable actions after failed loads. Expanded humanoid, asymmetric, round-trip, playback/event, clipboard/history, serialization/CharacterLoader and scene IK/onion/facing regressions accompany an artist left-arm walkthrough and explicit transform limitations.

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
