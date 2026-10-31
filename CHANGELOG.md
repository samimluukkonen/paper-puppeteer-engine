# Changelog

Versions use package SemVer; for example, milestone `0.5.2.8.3` is packaged as `0.5.2-8.3`.

## Unreleased

- Preserve immutable scene branches across edits, drags and undo snapshots; validate affected domains incrementally while keeping asset-catalog and export-size checks current.

- Block project Undo/Redo when restoring membership would orphan scene audio clips, preserving assets and history until the scene references are undone.

- Preserve mesh deformation tracks during worker IK baking by retaining attachment and slot validation data alongside exact logical joints.

- Use the shared scene artwork limits during dependency resolution and bound encoded scene audio to 100 MiB across streamed and host-provided assets, cancelling overflowing reads before retaining their bytes.

- Reuse bone indexes and ancestor bind matrices within mesh validation and skin binding, avoiding repeated full-rig traversal while keeping mutable coordinate queries fresh.

- Extract mesh deformation commands and detached trajectory, cleanup, variation and pose previews from AnimationEditorState, preserving the existing selection, notification, clock and document-history boundaries.

- Reclaim Scene Editor timeline space with shared collapsible Actions, Camera, Transitions, Dialogue, Audio and View tabs. Start tool panels collapsed, keep compact playback and playhead controls visible, retain mounted settings and reveal controls for Feature Guides.

- Organize the Scene Editor inspector into shared wrapping tabs for Scene, Actors, Camera, Artwork, Dialogue, Audio and Transitions. Keep sections collapsed initially, retain drafts across tabs and reveal the relevant group for selections and Feature Guides.

- Reclaim vertical timeline space with a compact shared tab bar alongside playback and time controls. Start Tracks & keys, View and Snapping panels collapsed; preserve mounted controls, preferences, shortcuts and Feature Guide reveal.

- Replace Animation Editor inspector disclosures with shared wrapping, keyboard-accessible tabs. Start on Bones, preserve mounted panels and drafts across tabs and Rig Tweak mode, and reveal the relevant tab for selections and Feature Guides.

- Replace Rig Editor inspector disclosures with shared keyboard-accessible tabs that wrap onto multiple rows. Keep panels mounted, show the selected Hierarchy contents on first load, and reveal the relevant tab for Feature Guides.

- Upgrade lucide-react to 1.61.0, oxlint-tsgolint to 7.0.2005 and Vite to 8.3.5, keeping direct dependency versions pinned and the npm lockfile synchronized.

- Add a trash button beside each scene audio track. Remove empty tracks immediately; confirm removing populated tracks and their clips, preserve source assets and sibling tracks, stop removed playback voices, and restore the whole removal with one Undo. Update the audio guide and cover cancellation, history and playback cleanup.

- Give Scene Editor inspector sections the shared Animation Editor panel styling, with complete borders, shaded headers, distinct content backgrounds and spacing between sections. Keep layer fields readable at the minimum inspector width.

- Group Add Actor inside the Scene actors inspector section alongside the actor list, and keep its Feature Guide reveal and project/standalone workflows working with the initially collapsed section.

- Highlight key controls, shortcuts and concepts throughout Feature Guide steps with semibold warm yellow text that stands out clearly against the dark cards.

- Require Node.js 24.22.1 or newer for npm installs, matching the local development and CI pin.

- Extract camera-key/cut, artwork/layer and transition commands from SceneEditorDocument into focused modules while retaining one document validation and history owner.

- Share error-isolated subscriber delivery across project, scene and local recovery owners so UI callback failures cannot interrupt edits, asset loading or autosave.

- Enforce one Vitest worker and sequential test files in the shared configuration for default local and CI commands.

- Release owned Actors and transition resources when SceneRunner initialization callbacks fail, preserving both initialization and cleanup errors.

- Give restored scene images fresh resource/decode requests and ignore cancelled obsolete results, preventing rapid removal/Undo from leaving artwork stuck in an error state.

- Preflight the complete expanded project resource budget before copying imported character binaries, and enforce the same 100 MiB budget on exports.

- Sort Feature Guide entries alphabetically in every editor category and add shared title/description search, result counts and clear/no-results feedback in Project Workspace and the editors.

- Show a shared dark loading screen before view scripts load, including the home redirect and embedded project editors. Match the editor theme, respect reduced motion and dismiss it when the workspace shell is ready.

- Share compact icon-labelled Project/Edit, Character package and Local draft tabs across Project Workspace and the Rig, Animation and Scene editors, with keyboard navigation, collapsible controls and automatic Feature Guide tab reveal. Preserve mounted controls and draft state while reclaiming vertical workspace. Render recovery dialogs outside hidden tab panels so reload always offers a visible, dismissible recovery dialog.

- Remove Engine Demo and its controls, runtime presentation and dedicated tests. Open Project Workspace at the app home address and keep the sample characters available in the editors.

- Remove the standalone examples project and its version/build/browser checks. Generate character packages directly in runtime integration tests.

- Extract retained project editor contexts, runtime leases and preview teardown into a dedicated controller. Cancel opening work on workspace disposal, release late leases, and finish remaining cleanup after individual preview failures.

- Share bounded response streaming, request deadlines and cancellation across character metadata, scene resources and package artwork. Release readers promptly even when custom fetch or stream cancellation stalls, and cancel late response bodies.

- Preserve custom character manifest paths through project export/import, rebase standalone scene ZIPs independently, and reject physical metadata collisions before a download can overwrite a resource.

- Cache compact per-scene fingerprints for project checkpoints and both project/standalone autosave revisions, allowing multiple individually valid scenes to exceed 10 MiB in aggregate without disabling recovery.

- Load guarded static WebP artwork in character and scene editors. Release failed character opening state so project export/autosave can continue, and recreate failed hosts on the next opening.

- Validate expanded project character file counts and byte totals before copying imported binaries, preventing physical-file aliases from multiplying allocations past package limits.

- Process Project Workspace ZIP imports and exports in the shared package worker, with transfer deadlines and cancellation on workspace teardown. Record export checkpoints only after the worker finishes and the download starts.

- Deduplicate equivalent scene recovery character packages across manifest aliases and retained scenes. Give distinct same-ID packages collision-free IDs in the detached recovery copy, preserving every Actor dependency and original source document.

- Cancel autosave package preparation on discard, suspension and disposal; time out stalled draft builds and artwork requests while preserving the previous draft and allowing retry.

- Bound scene actors, actions, per-instance bone/slot allocation and aggregate artwork bytes/pixels before constructing runtime previews. Share texture guards across scene character loads and validate scene ZIP texture totals.

- Add one-click retained-draft cleanup in Animation Editor, Rig Editor and Rig Tweak, including declined recovery candidates, to prevent repeated restore prompts on later visits. Use red danger styling for cleanup and green for retained-draft downloads.

- Require PNG-header checks before decoding character artwork by default; trusted alternative formats can opt out with `requirePng: false`.

- Publish completed Animation Editor commands in one state notification.
- Share pending import and export guards between the editors.
- Group overlapping collapsed timeline summaries by pixel position and add `npm run profile:timeline` for local browser measurements.
- Share responsive inspector behavior across the demo and both editors.

## 1.5.3-2

- Add Retarget to Another Character to the Project Animation Library, with source/target selection, validated saved mappings and the existing Bone Mapping Editor, supported root/local/pelvis translation policies and actionable IK, missing-track, orientation, proportion and mesh diagnostics.
- Compare isolated source and target Puppets with one playback clock, scrubbing, speed, equal world scale, root travel, ground reference and authored foot contact markers. Regenerate from the unchanged source, invalidate obsolete previews and dispose cancelled/replaced runtime resources.
- Create an independent UUID-named target animation through the existing editor document owner, preserving source assets, scene Actors and clip histories. Validate before registration and include new documents in normal autosave/recovery and project export/import.
- Add a visual retargeting Feature Guide and workflow documentation, plus regression and local browser coverage. Synchronize package and lockfile metadata at 1.5.3-2.

## 1.5.3-1

- Add a pure, renderer-independent `retargetAnimation` API with current explicit bone-map validation, rest-relative local FK rotation/translation/scale conversion, preserved sparse keys and interpolation curves, deterministic output and independently editable results.
- Separate local, caller-identified pelvis and Actor root-motion translation policies; derive proportional scaling from effective rig geometry, handle degenerate lengths without division and report unusually different proportions. Reject singular or changed rest reflections explicitly.
- Use conservative FK-only transfer: report omitted source IK data, suppress target constraints and require source IK baking when evaluated IK motion is needed. Preserve corrective mesh tracks only with verified identical effective rig revisions and complete identity correspondence; report other omissions and leave target skinning available.
- Preserve animation metadata, playback, duration and detached JSON events, flag application-specific payload references, export the service/types through the public engine entry points, and add the retargeting guide and regression tests.

## 1.5.2

- Add pure rig compatibility analysis with exact/shared, explicitly mappable, partial and incompatible levels, effective rest/hierarchy/orientation/proportion diagnostics and separate IK, foot-marker, skin and mesh checks. Bone correspondence does not enable retargeting or cross-rig deformation transfer.
- Add versioned data-only rig bone mappings with stable character-owned rig identities, SHA-256 revision fingerprints, strict ID/uniqueness/parent validation and explicit stale-map review.
- Add a compact, initially collapsed Project Workspace comparison editor with shared rig selectors, ambiguity-preserving suggestions, manual correspondence editing, validation, approval, saved-map review/removal and project Undo/Redo, autosave and ZIP persistence.
- Add a read-only Project Feature Guide, a rig compatibility guide and regression coverage for structure, renamed IDs, ambiguity, IK/mesh differences, stale maps and backward-compatible project persistence. Publish the renderer-independent APIs through core and synchronize package metadata at 1.5.2.

## 1.5.1

- Add read-only Animation Library Feature Guides in Project Workspace and Animation Editor, covering search, optional labels, rig compatibility, preview, shared references, independent copies, scene reuse and saving; update the variation guide for display-name metadata.

- Add a shared searchable Animation Library in Project Workspace, Animation Editor and Scene Editor selection workflows, with optional display names, descriptions and tags on existing clip documents, source locations, duration and explicit rig compatibility.
- Preview through the existing editor/Environment Preview canvas or an isolated CharacterLoader/Puppet runtime with Play/Pause, Stop/Restart and view-only looping, preserving skeletal animation, IK, root motion and mesh deformation without authoring keys.
- Reference existing compatible character-owned clips by their stable IDs, or create independently editable deep copies through Animation Variations. Keep scene timing, movement ownership, animation events, dependency warnings, metadata Undo/Redo, local recovery and package references intact.
- Retain version-1 character/animation packages and add library ownership documentation and regression coverage for search/filter, missing/incompatible rigs, preview isolation, copying, persistence and scene references.

## 1.4.6

- Add optional final-pose mesh diagnostics in Rig and Animation Editors: triangle/vertex overlays, bone influence names and advisory counts for collapse, inversion, nonfinite output and excessive edge stretch. Keep diagnostics off initially, independent of authoring/history and hidden during ordinary preview unless explicitly enabled; never repair artistic deformation automatically.
- Add a short **Creating a Mesh Attachment** Feature Guide using existing stable controls; retain the detailed geometry, weight painting and correction tours, and explain deformation diagnostics without enabling them or authoring data during navigation.
- Add production regressions for small, medium and maximum-size meshes, independent mixed characters, hair/cape/clothing attachment isolation, deterministic correction seeking, malformed topology and cleanup. Add optional sequential CPU and native WebGL profiling with resource counts and no machine-dependent thresholds. Update the project recovery browser check to reveal artwork through the shared inspector tabs.
- Publish **Getting Started with Mesh Deformation** and a v1.4 production readiness/regression report, including verification evidence, measured workload boundaries, compatibility, package/recovery ownership and deferred features. Synchronize package/lockfile metadata at `1.4.6`.

## 1.4.5

- Add a nine-step **Mesh Characters Across Editors** Feature Guide in Project Workspace, with real-control spotlights, live project prerequisites and read-only navigation. Cover mesh skins, artwork compatibility, animation/ghost limits, scene Actors, root travel, validation and portable saving; update existing mesh and onion-skin tours.

- Audit mesh deformation across Rig, Animation, Environment Preview, Scene, Actor/choreography, standalone loading, Project Workspace and package/recovery paths; document shared rendering, replacement combinations, ownership and current onion-skin limits.
- Reject rig edits, imports, recovery and Undo/Redo that newly invalidate live deformation attachment/vertex references, using existing snapshot rollback and animation owners. Preserve repairable drafts and stable-ID geometry edits.
- Keep runtime catalog changes compatible with registered deformation tracks and refresh masked shape evaluation from current weights. Validate newly registered animations against the current catalog and reject introducing meshes on Canvas before installation.
- Reject mesh artwork replacements with different image dimensions before applying them, including inactive skin attachments. Add mesh bind/slot/weight and deformation-track dependency edges plus image-dimension diagnostics to Project inspection.
- Cover authored mesh handoff through character/project/scene packages, recovery, multiple Actors, mixed skins, root motion/facing/scale, direct seeks, ghost sampling, catalog edits and shared texture disposal. Extend built and packed standalone consumer checks with mesh serialization and weighted evaluation. Synchronize package/lockfile metadata at `1.4.5`.

## 1.4.4

- Add a nine-step **Animating Mesh Deformation** Feature Guide with live mesh/animation prerequisites, setup links, real-control spotlights and read-only navigation. Explain neutral shapes, bind-space corrections, timeline timing, topology compatibility and portable saving.

- Add optional sparse mesh deformation shape keys keyed by attachment and stable vertex IDs, with linear, stepped and Bézier interpolation. Apply attachment-local corrections to immutable bind vertices before final FK/IK skinning and Puppet/Actor placement; reuse playback timing, layer weights and fades.
- Add Edit Mesh Deformation with a labeled bind-space correction view, square multi-select vertex handles, numeric offsets, neutral keys and per-mesh timeline rows. Support temporary drag previews, atomic Undo/Redo, key movement, duplication, deletion and timeline copy/paste.
- Preserve correction data through JSON/package exports, pose/bone tools and IK baking; scale correction times in Animation Variations. Flag incompatible topology, reject invalid references and explicitly describe unsupported mesh mirroring/Graph Editor operations.
- Add runtime/editor parity, sparse interpolation, transform, topology, serialization, history and local browser workflow coverage. Document schema, evaluation order and compatibility in the mesh deformation guide.

## 1.4.3-2

Add **Paint Bone Weights** to Rig Editor's mesh tools: hierarchy-based influence selection, screen-space radius and strength, paint/erase, per-vertex numeric weights, normalization/reset and a gray/blue/orange vertex heatmap with selected-vertex outlines. Sweep distance-based brushes across existing vertices with linear falloff, frozen pose projections and one strength application per stroke. Preserve other influence ratios; deterministically retain the strongest bones at the chosen one-to-four influence limit, report dropped influences and use a documented valid fallback instead of zero-total weights.

Reuse snapshot history for one Undo per stroke, Escape/blur cancellation, numeric edits, reset and explicit mesh-dependent bone removal. Add a render-only test bend and existing clip sampling to deformation preview without authoring rig transforms or animation keys. Interpolate normalized weights on subdivision, including partially painted legacy meshes, and preserve weights on surviving vertices. Report mesh bone/bind dependencies and offer atomic reassignment, merged influences and explicit rebind during bone removal. Cover brush math, influence limits, selection, history, topology, bone dependencies, import/export and live runtime parity; add a local desktop browser painting workflow and artist documentation. Synchronize package/lockfile metadata at `1.4.3-2`.

Add a nine-step **Painting Bone Weights** Feature Guide with live selected-mesh/Paint-mode prerequisites and a link to Editing Mesh Geometry. Spotlight brush, hierarchy influence, numeric, normalization/limit and deformation-preview controls; explain stroke history, safe topology and saving. Preserve painted weights, settings, selections, poses and history, and cover availability, navigation, UI-only reveal and real desktop spotlights.

## 1.4.3-1

Add CPU linear blend skinning for textured mesh attachments using the runtime renderer's authoritative final FK/IK matrices. Cache inverse authored bind points, evaluate from immutable geometry and update existing Mesh2D buffers in place. Preserve slot affines, draw order, opacity, skins, rigid sprites, root motion, Actor placement, facing and reflected/nonuniform scale; render-only previews evaluate their own poses.

Support up to four finite, nonnegative, normalized bone influences per vertex, validate bone references and expose explicit normalization and renderer-independent binding/deformation helpers. New meshes receive one valid influence (the selected slot bone in Rig Editor); older unweighted meshes follow their assigned slot bone. Subdivision interpolates and normalizes the strongest four weights deterministically.

Reject Canvas mesh characters with an explicit WebGL-required diagnostic before allocating runtime objects. Map top-left mesh UVs through texture-source upload orientation, including texture swaps and previews. Diagnose singular weighted mesh mounts; keep borrowed textures and release mesh bindings with attachment/preview/Puppet disposal. Document skinning math, coordinates and supported backends, add analytical and runtime regressions, and synchronize package/lockfile metadata at `1.4.3-1`.

## 1.4.2-2

Carry the originating inspector tab with mesh and attachment slot selections so native dropdown blur cannot redirect to Selection details. Keep the request bound to the exact selection object, distinguish same-ID bones/slots and preserve later canvas auto-reveal. Cover focused/blurred selection, repeated slot switching and rigid/mesh controls.

Add an eight-step Editing Mesh Geometry Feature Guide with live whole-image/mesh prerequisites, stable inspector anchors and UI-only reveal. Explain conversion/skin ownership, vertex editing, subdivision and UV interpolation, safe deletion, history and export/reload. Cover empty, rigid and authored-mesh availability plus guide navigation and preservation in unit and local browser regressions.

Add visual mesh geometry authoring to Rig Editor: explicit sprite attachment conversion, an Edit Mesh Geometry mode, cyan diamond vertex handles, edge selection, numeric local X/Y fields, triangle inspection and actionable validation feedback. Preserve rigid source definitions and other skin assignments; default-skin conversion creates and selects a separate mesh skin variant.

Provide atomic shared-edge subdivision with averaged UVs and stable vertex IDs, and connected-fan deletion with local ear-clipping triangulation. Retain authored UVs on vertex movement. Reuse viewport affine conversion, camera zoom/pan and snapshot history: one drag is one Undo, Escape/blur cancels, and invalid proposals leave the last valid geometry intact. Fix simultaneous attachment/skin installation so snapshots include the full conversion.

Render authored meshes through Phaser 4.2.1 Mesh2D in existing slot mounts, preserving transforms, depth, opacity, visibility, pixel-art texture policy and render-only preview geometry. Keep the rigid image API and add `Puppet.getSlotMesh`; release geometry while retaining host-owned textures. Preserve character/project/scene packaging and add geometry, history, viewport, rendering, cleanup and local desktop browser regressions. Document artist workflow and WebGL/whole-image/bind limits; synchronize package and lockfile metadata at `1.4.2-2`.

## 1.4.2-1

Add a mesh developer quick start and artist troubleshooting for imported meshes, blank previews, protected rest transforms and artwork replacement limits. Link the guidance from the guide index and character/artist documentation; retain existing Feature Guide tours until mesh editor controls exist.

Add an optional versioned mesh attachment format alongside legacy rigid sprites, retaining texture keys, slot/skin IDs, ordering and character/project packaging. Include stable vertex IDs, attachment-local bind positions, normalized UVs, indexed triangles, image dimensions and explicit authored rest snapshots. Reject invalid topology, overlapping interiors, unsupported versions and stale/singular binds; roll back editor rest edits that invalidate bound meshes.

Provide pure rectangle creation, topology replacement for future subdivision, vertex lookup, bounds and image/UV/attachment/bind/bone coordinate utilities through the renderer-independent API. Document coordinate conventions, limits, migration and future weight references in the [mesh attachment foundation](docs/mesh-attachments.md). Mesh slots retain selection but remain unrendered in this data-only milestone. Verify geometry, mixed rigs, immutability, legacy compatibility and deterministic character/project ZIP round trips. Synchronize package and lockfile version metadata at `1.4.2-1`.

## 1.4.1

Expand the existing IK Constraints Feature Guide to eight steps with dedicated bend-direction and solver-diagnostics guidance, plus explicit enabled/preview/influence, validation and numeric commit/cancel instructions. Keep reveal-only navigation and update the artist/catalog documentation and guide step-count regression.

Improve the existing Rig Editor and shared Rig Tweak constraint workflow with labelled start/middle/end joints, a facing-aware signed bend arrow, and visible solver reachability, disabled/inactive and transform diagnostics. Show the actual clockwise default for legacy omitted bend settings, preserve one authored bend field, and retain validated atomic edits, history and existing solver behavior. Keep live overlay feedback synchronized with runtime target/transform changes. Use shared primary/destructive button styling for constraint commands.

Document the actual post-v1.2.6 baseline, bone identities, effective bind/rest transforms, coordinate systems, deterministic FK/animation/IK/render ordering, authoring/persistence ownership and proposed optional mesh data/compiler/evaluator/Phaser boundaries in the [constraint and deformation audit](docs/rig-constraints-and-deformation.md). Add authoring, bend/history, invalid-chain feedback, bind stability, serialization and local browser regressions; update the artist guide and existing Feature Guide. Keep all current formats and rigid rendering, with no mesh implementation or automatic conversion. Update package and lockfile version metadata to `1.4.1`.

## 1.3.6

Harden the integrated audio/dialogue cinematic workflow with a local desktop regression that authors layered artwork, two Actors, walking and root-motion attack clips, music, ambience, overlapping effects, Unicode subtitles, camera keys/cuts, fades and cues. Verify Undo/Redo, binary autosave/recovery, project export/reimport and standalone Phaser playback with a user-action audio unlock and complete voice/buffer/context cleanup.

Finish all audio resource cleanup even when an adapter's stop or buffer disposal throws; retain cleanup errors while releasing other buffers and closing the backend. Correct stale subtitle inspector guidance. Add four focused Scene Feature Guides using the existing registry and anchors: Importing Audio, Audio Timeline, Creating Dialogue, and Audio and Scene Timing. Extend empty/populated guide preservation tests and publish [Creating an Audiovisual Scene](docs/creating-an-audiovisual-scene.md).

Extend the local scene profiler with a three-minute music source, six concurrent audio clips, dialogue, rapid scrubbing, repeated play/stop and audio resource counters alongside Actors, camera animation and large artwork. Extend the project diagnostic with audiovisual scenes and original/imported audio byte comparisons; measure export/import and IndexedDB autosave/recovery. Update older production-workflow browser checks to reveal inspector tabs explicitly. See the [v1.3 integration report](docs/audiovisual-scene-readiness.md) for measured results, verification and remaining limits. Keep browser checks local-only and preserve scene-format-2 compatibility.

## 1.3.5

Display deterministic dialogue in Scene Editor and standalone Phaser scene playback. Export a pure active-dialogue evaluator with speaker metadata, a React-free default subtitle overlay and a small host-owned custom presentation target. Keep multiline text wrapped inside the cinematic output safe area, stable through camera movement and letterboxing, and above cinematic fades. Clear subtitles on stop, scene switching and runtime teardown.

Reuse the existing scene cue dispatcher and audio scheduler. Preserve silent forward/backward seeking, exact half-open dialogue boundaries, fresh cue passes on restart, large-delta cue crossings and one audio owner even when dialogue and cues reference authored clips. Add a complete two-Actor sword/dialogue/music/camera/fade sample, runtime/audio/lifecycle regressions, local desktop canvas and standalone consumer verification, and update the [dialogue playback guide](docs/scene-dialogue.md) and package version metadata.

## 1.3.4

Add a nine-step **Dialogue & Subtitle Authoring** Feature Guide to the shared Scene catalog. Reveal real creation, timeline, text, speaker, timing, voice-reference, history and saving controls, with helpful empty states and no Actor or dialogue prerequisites beyond an open scene. Preserve authored data, selection, playback/preview and history; cover the tour with unit and local desktop browser regressions.

Add timed dialogue/subtitle authoring to Scene Editor with a dedicated Dialogue track and initially collapsed inspector. Author multiline Unicode plain text, narration, scene-local Actor speakers, explicit labels, start/duration and optional voice-clip metadata; select, duplicate into the next fitting gap, delete and Undo/Redo through the existing scene document. Preserve speaker links on Actor renames and give actionable reference errors before removing speaking Actors or referenced audio clips.

Extend scene-format-2 with optional `dialogue` data and public schemas/types plus a pure active-line evaluator. Reject overlapping half-open intervals, invalid references and out-of-scene bounds atomically while keeping adjacent lines and legacy scenes compatible. Preserve dialogue through canonical JSON, project/standalone ZIPs and autosave/recovery; include speakers/voice assets in project inspection and dialogue edges in shared timeline snapping. Keep subtitle playback UI deferred. Update version metadata and the [dialogue authoring guide](docs/scene-dialogue.md); add unit/integration and local desktop browser regressions.

## 1.3.3

Add a nine-step **Audio Playback & Synchronization** Feature Guide to the shared Scene catalog, covering scene clips, browser unlock/retry, play/pause, silent seeking, speed/pitch, preview mute, restart/stop and portable saving. Reveal real controls with no audio or Actor prerequisites beyond an open scene, preserve authored data, selection, playhead, speed, mute, preview and history, and verify tours never unlock browser audio or start sound. Add focused unit and local desktop browser coverage alongside the Visual Audio Timeline tour.

Play overlapping scene music, ambience and effects from the authoritative SceneRunner clock using a reusable audio controller and the existing Web Audio asset loader. Export a pure active-clip evaluator, respect source offsets, finite loop windows, volume and multiplicative fades, and reconcile drift above 80 ms with bounded resynchronization. Support playback speed through Web Audio rate changes, including their pitch effect.

Keep passive seeking silent and resume only currently active clips from their correct offsets. Stop owned voices on pause, stop, restart, completion, cancellation, scene/project switching and disposal. Add visible audio status, gesture-driven Play/Enable audio, retryable loading/decode failures and preview mute; pause hidden editor pages. Reuse hosted and ZIP audio resolution for standalone SceneLoader consumers without React. Update version metadata, authoring guidance and runtime documentation; add deterministic backend/lifecycle and local desktop browser regressions. See the [audio playback guide](docs/scene-audio-playback.md) for timing limits and verification.

## 1.3.2

Add a nine-step **Visual Audio Timeline** Feature Guide to the shared Scene catalog. Reveal asset selection, track organization, clip placement, overlap/snapping, non-destructive trims, volume/finite loops, fades, duplication/deletion/history and portable saving. Support empty scenes and selected clips without requiring Actors or audio, preserve authored data, selection, playback/preview and Undo/Redo, and add unit and local desktop browser coverage.

Add visual audio clips to Scene Editor's existing timeline, sharing its ruler, clock, coordinate utilities, snapping, selection and grouped scene Undo/Redo. Support multiple Music, Ambience, Sound Effects and Voice tracks, overlapping clips, asset/track selection, movement, non-destructive trims at either edge, duplication and deletion, volume, bounded loops and fade properties in a collapsed inspector. Preserve playback position while authoring audio.

Extend scene-format-2 with optional audio assets, tracks and clips; validate stable identities, references, media trim bounds, volume, fades and finite scene bounds without changing legacy scenes or silently changing scene duration. Include scene audio in dependency inspection/removal guards, JSON, project and standalone ZIP exports, imports and autosave/recovery. Isolate imported binaries by content and preserve conflicting standalone asset identities through recovery aliases. Export the pure audio model/schemas and trim helper, regenerate the scene schema and add unit/integration and local desktop browser coverage. Document authoring and trim/loop/fade semantics in the [scene audio timeline guide](docs/scene-audio-timeline.md). Defer waveform visualization and synchronized playback (v1.3.3).

## 1.3.1

Add optional typed audio registrations to the existing project asset system, with music, ambience, sound effect and voice categories, stable IDs, portable paths and decoded duration. Project Workspace imports content-checked, browser-decodable WAV/MP3/OGG files and provides collapsed counted categories, rename, category changes, removal with project Undo/Redo, Play/Stop and audition volume.

Introduce a reusable Web Audio loader with ID resolution, content-based decode reuse, retryable failures, bounded decoded resources, cancellation and disposal. Integrate audio binaries with project validation/dependency guards, ZIP packaging and existing autosave/recovery. Keep legacy projects compatible and defer scene audio timelines and synchronization to v1.3.2. Add unit/integration and local browser regressions, public runtime/data APIs and the [audio asset guide](docs/audio-assets.md).

Add a Project Workspace category to the shared Feature Guide catalog and a seven-step Importing and Managing Audio tour. Reveal import, categories, audition volume, asset management, Undo and export controls without changing authored assets or starting playback; require an open project, with no character, scene or audio prerequisites. Restore focus to Feature Guide after returning from the catalog and exiting a tour.

Make audio names plain labels and use one row-level Play/Stop button, including cancellation while loading. Use filled, spaced transport icons and add trash icons to character, scene and audio Remove buttons throughout Project Workspace. Update the audio guide to explain both row-level Stop and the global Stop preview control.

## 1.2.6

Harden the integrated cinematic workflow with a complete layered-artwork/two-Actor regression through camera keys, cuts, fades, Undo/Redo, browser autosave recovery, project export/reimport and standalone Phaser scene-package playback. Verify repeated arbitrary seeks, camera/parallax/fade sampling, silent passive seeking and runtime texture/object cleanup. Update the legacy action-timeline browser test to check Actor lanes independently of camera and transition rows. Keep legacy scene defaults and the existing scene-format-2 APIs.

Keep Camera Key Edit mode and inspector checkboxes compact. Release private artwork byte/pixel reservations on removal, decode failure and disposal, preventing false memory-limit errors after repeated scene changes. Charge independent renderers separately and roll back rejected complete-image reservations. Avoid redundant artwork texture assignments and display-list depth sorts during camera sampling. Extend the local scene profiler with three large parallax images, camera pans/zooms, frequent camera-key edits and scene ZIP export; retain Actor, texture and listener leak checks.

Add focused Scene Feature Guides for background artwork, layers, parallax, framing, camera editing, camera keys, cuts and fades by reusing existing stable anchors and reveal-only steps. Publish [Creating Your First Cinematic Scene](docs/creating-your-first-cinematic-scene.md), including editor/audience camera separation, portable saving, optional Phaser pixel-art settings and deferred features. Record verification and performance in the [v1.2 integration report](docs/cinematic-scene-readiness.md).

## 1.2.5

Add a nine-step **Cinematic Cuts, Fades & Transitions** Feature Guide to the shared Scene catalog. Reveal cut capture, shot framing, fade creation, timing, direction/color, transition tracks, holds/conflicts, deterministic preview and saving, including guidance for empty scenes. Preserve authored data, selection, playback, preview and Undo/Redo; add unit and local desktop browser coverage.

Add **Set Camera Cut** using existing stepped camera channels, with time-zero baselines, exact-boundary seeking and one scene history entry. Show cut markers alongside a compact Transitions track. Add selectable fade-in/out effects with stable IDs and collapsed start/duration/type/color controls, deletion and Undo/Redo. Retain Actor instances and playback time during fade edits.

Evaluate fades from the millisecond scene clock, holding their final opacity until the next fade; reject overlapping intervals, invalid colors/timing and scene-boundary violations. Render the output-frame overlay above backgrounds, Actors and foreground artwork, below editor guides, with cleanup on cancellation/disposal. Preserve optional transitions in scene-format-2 JSON, portable ZIPs, project documents and recovery. Integrate standalone SceneLoader playback and export the pure evaluator, types and host-owned overlay. Update schema and camera documentation; cover cuts, fades, seeking, history, persistence, runtime and desktop browser authoring locally.

## 1.2.4

Add a nine-step **Camera Timeline & Keyframes** guide to the shared Scene catalog. Highlight real capture, mode, time, value, track, property and curve controls with empty-key guidance, plus camera preview and portable saving. Preserve authored keys/curves, selection, edit mode, playhead, preview and history; add unit and local desktop browser coverage.

Add optional sparse Cinematic Camera X/Y/zoom keyframe tracks to Scene Editor's existing timeline, sharing its ruler, snapping, playhead and grouped scene Undo/Redo. Add explicit Set Camera Key and Camera Key Edit mode, diamond selection/dragging, numeric time/value edits, duplication, deletion and outgoing Linear, Stepped, eased preset and bounded Bézier controls. Keep navigation independent and inspectors collapsed initially.

Evaluate camera tracks deterministically on the existing millisecond scene clock through the character property sampler. Preserve Actor instances/time during camera edits and synchronize audience framing and layer parallax during playback, direct seeking, pause/restart and export/reload. Keep static/legacy scene defaults virtual, validate bounded zoom and monotonic curves, preserve tracks in JSON/project/recovery/portable packages, export the evaluator and types, and update the scene schema and [camera guide](docs/cinematic-camera.md). Add unit and local desktop browser regressions; browser tests remain local-only.

## 1.2.3

Add an eight-step **Cinematic Camera** Feature Guide to the shared Scene catalog, covering frame selection and dragging, center coordinates, zoom/reset, Actor framing, audience preview, independent navigation and saving/runtime handoff. Reveal real controls with empty-scene guidance while preserving authored data, selection, history, playhead and preview mode. Add unit and local desktop browser coverage.

Add an authored Cinematic Camera with scene-pixel center coordinates, bounded zoom and a fixed 1000 × 700 (10:7) output frame. Keep editor navigation independent; add frame selection/dragging, collapsed camera controls, Reset Camera and rendered-bounds Actor framing with an origin fallback. Preview through the camera with clean artwork by default, optional editor overlays, preserved playback and exact navigation restoration. Persist initial camera state through scene history, JSON, project/recovery and portable packages without rewriting legacy scenes. Reuse Phaser cameras and parallax compensation; expose explicit runtime camera application with aspect-preserving viewport fitting. Update the scene schema and [camera guide](docs/cinematic-camera.md); add unit and local desktop browser regressions.

## 1.2.2

Hide the focus outline on programmatically focused Feature Guide titles while retaining title announcements, modal focus handling and visible keyboard focus on guide controls.

Center the shared Feature Guide on the full header using equal-width side columns, keeping its position independent of project context and right-side navigation size.

Add an eight-step **Backgrounds, Layers and Parallax** Feature Guide in the shared Scene catalog, covering PNG/WebP import, project image reuse, placement, layer ordering/locks, parallax preview and portable saving. Reveal real controls with empty-selection guidance while preserving artwork, selection, history and playback.

Add Scene Layers with stable identities, foreground-first hierarchy controls, rename/reorder, image reassignment and ordering, visibility, editor-only artwork locks and safe layer removal into Background. Keep Actors in one movable band with intact Puppet containers. Reuse scene history, recovery and project/standalone packaging with backward-compatible scene-format-2 defaults.

Add per-artwork-layer parallax using Phaser scroll factors at runtime and separate view-only preview camera scroll in Scene Editor. Keep authored transforms and choreography independent of camera navigation, hit-test displayed artwork at every zoom, and retain ground guides and selection handles above artwork. Add unit and local desktop browser regressions; update the scene schema and [layer guide](docs/scene-layers.md).

## 1.2.1

Add independent Scene Artwork with local PNG/static WebP import and existing project image selection. Place images behind Actors with world-space dragging, a corner scale handle, numeric transforms, visibility, replacement, reset and removal. Keep inspector sections collapsed and group canvas gestures into one Undo/Redo operation with Escape cancellation. Artwork edits preserve Actor data, runtime instances and playback time.

Extend scene format 2 with optional image elements and project format 1 with an image registry. Reuse guarded image decoding, package paths and ZIP services; deduplicate project binaries with character artwork, retain Undo/Redo asset dependencies, recover artwork through autosave and include images in standalone scene packages and runtime loading. Reject missing references, invalid transforms, image/path collisions and unsupported or corrupt artwork before browser production exports. Update the scene JSON Schema, release metadata and [artwork guide](docs/scene-artwork.md); add data, lifecycle and local desktop browser regressions. Parallax, camera animation and advanced layers remain deferred.

## 1.1.7-6

Complete root-motion hardening with Creating Root Motion, Root Motion vs Pelvis Animation and Using Root Motion Feature Guides using existing controls without authoring data. Show optional post-IK world X/Y foot diagnostics and explain that ground proximity does not identify planted contacts. Clarify that bone mirroring preserves root curves and Motion Diagnostics ignores them.

Add pending root-graph/handle autosave recovery, tool preservation, world-contact and authored-export-to-scene-runtime regressions, plus installed core-consumer root playback checks. Add optional sequential CPU profiles for normal/root playback, dense keys, graph edits, scrubbing and multiple looping characters. Document the complete artist workflow, coordinate chain, movement ownership, lifecycle/loop contracts and deferred capabilities in the [hardening report](docs/root-motion-hardening.md). Retain the higher package/lockfile version `1.2.6`.

## 1.1.7-5

Add explicit Scene-controlled or Animation root motion movement sources to animation clips, with evaluated read-only displacement and disabled rootless selections in the collapsed inspector. Default omitted fields to scene movement without rewriting legacy files. Reject overlapping translation owners for an Actor, including moves and root-motion clips; retain the existing animation-channel conflicts and allow adjacent windows and independent Actors.

Reuse runtime root evaluation and Puppet transforms for facing/scale-aware travel, finite continuous loops, truncation, final-position holds and fresh origins at clip handoffs. Reconstruct arbitrary seeks through the existing boundary evaluator with root application enabled and gameplay events suppressed. Preserve cancellation/interruption positions, skeletal/IK channels, scene cameras/layers/ground, character root data and movement policy through JSON/project/portable packages. Enable the existing typed root-motion option in finite choreography animation steps with unchanged parallel Actor claims. Add unit and local desktop browser regressions and the [scene root-motion guide](docs/scene-root-motion.md). Retain package and lockfile version `1.2.6`.

## 1.1.7-4

Match Rig Editor background dragging in Animation Editor: left drag moves only the preview character placement, including during root editing; middle drag pans the camera. Retain placement across clip/view changes and rig rebuilds without changing keys, history or exports, and move preview trajectory guides with that placement.

Integrate authored root travel with the existing stationary Environment Preview background, ground and foot markers. Add mutually exclusive Authored Root Motion, Preview-Only Displacement and No World Displacement modes; share absolute world displacement between Puppet placement and fixed/follow cameras. Match runtime start-normalized coordinates and facing/scale/rotation, preserve deterministic silent scrubbing, and offer reset or continuous authored loops without frame accumulation. Retain per-clip mode/loop preferences in project metadata and recovery, including legacy trajectory migration.

Add explicit Preview Copy to Root Motion and Apply Copy with replacement feedback, detached playback/scrub comparison, affine/interpolation conversion, one Undo/Redo transaction and retained preview points. Reject nonzero trajectory starts, singular transforms and stale placement/proposals. Update guides and documentation, cover root/IK/marker/camera/loop/source immutability and conversion regressions, and keep browser checks local-only. Preserve the higher package/lockfile version 1.2.6.

## 1.1.7-3

Add dedicated Root Motion Position X/Y timeline rows, numeric key creation/editing/retiming/deletion/duplication, and root channels in the existing Graph Editor with outgoing interpolation and Bézier tangents. Preserve skeletal, pelvis and IK tracks and animation format 1. Preview authored offsets through the puppet's placement/facing/scale transform over fixed ground; retain shared scrubbing, stepped samples and clip-local looping.

Add Edit Root Motion with an independent purple square origin handle, an optional sampled trajectory and key/selection markers. Convert camera/world coordinates back through the puppet's affine placement, pause the environment camera during root editing, commit one history snapshot per XY or graph drag, and cancel gestures with Escape or session/lifecycle changes. Add the Visual Root Motion Feature Guide, [artist walkthrough and architecture notes](docs/root-motion-authoring.md), unit regressions and a local desktop browser workflow. Retain the higher package/lockfile version 1.2.6.

## 1.1.7-2

Add renderer-independent absolute local/elapsed root-motion evaluation and unwrapped-time deltas, with continuous net-cycle accumulation, playback quantization and finite/cycle-bound checks. Opt into base Actor/Puppet translation per play or queue request with `rootMotion: 'apply'`; preserve the default ignore policy, skeletal/IK channels and existing version-1 data. Apply absolute displacement once through the starting facing/scale/rotation transform before IK synchronization.

Define pause, stop, restart, cancellation, completion, queue and incoming-only crossfade semantics without undoing applied travel. Reject conflicts with moveTo/walkTo and manual Actor placement, retain pure deterministic sampling, and document authored reset limitations and standalone application hosts in the [root-motion guide](docs/root-motion.md). Add runtime, loop, lifecycle, transform, IK, ownership and compatibility regressions. Retain package/lockfile version 1.2.6.

## 1.1.7-1

Add optional authored X/Y root-motion tracks with independently timed sparse channels and existing linear, stepped and bounded Bézier property curves. Validate strict structures, finite values, duration bounds, ordering, duplicate times and curve ownership; include root keys in external import workload limits. Preserve root motion in deterministic animation JSON, character/project packages, compiled immutable snapshots and whole-clip variation timing. Retain animation format 1 and the higher package/lockfile version 1.2.6.

Expose pure raw-offset and start-normalized displacement samplers without changing Actor placement or skeletal/IK playback. Document the actual transform hierarchy, canonical facing convention, start/end/loop semantics and preview separation in the [root-motion guide](docs/root-motion.md). Add data, curve, compatibility, ownership, playback and package round-trip regressions. Runtime application, editor controls and Environment Preview integration remain deferred.

## 1.1.6-4

Persist Environment Preview as optional project editor preferences: shared character background placement, visibility, ground and default camera, with per-animation trajectories, displacement mode and Loop preview. Include preferences and real PNG/WebP assets in project ZIPs and complete standalone/project local recovery drafts. Keep animation JSON, character ZIPs, animation Undo/Redo and scene choreography unchanged; preserve the higher package/lockfile version `1.2.6`.

Protect preview backgrounds during Scene Editor image cleanup, retain shared assets when clearing/resetting a preview, reject temporary image URLs in portable preferences, and recover characters with an actionable missing-background state when optional preview artwork is unavailable. Update existing Feature Guides and saving instructions. Add persistence, asset ownership, source-isolation, loop and subscription regressions plus local desktop browser refresh/recovery/export/reimport checks. See the [integration report](docs/animation-environment-readiness.md) for validation and remaining limitations.

## 1.1.6-3

Extend the existing **Environment Preview** Feature Guide to ten steps with fixed/follow camera selection, world center/zoom/reset, shared playback and loop reset, deterministic silent scrubbing and session-only viewport restoration. Reveal the real collapsed camera controls without changing settings, playback, history or authored data; cover empty and configured previews with unit and local desktop browser regressions.

Synchronize Environment Preview's fixed/follow camera with the Animation Editor's existing pose/displacement clock, including stepped sampling, exact endpoints, play/pause, speed, restart and silent forward/backward seeks. Add collapsed, session-only camera center/zoom/reset controls, retain native pan/wheel navigation and restore the ordinary viewport on disable, Rig/Rig Tweak and shutdown. Keep backgrounds and ground in world space, preserve facing/IK/contact visualization, allow travel beyond image bounds and explicitly reset displacement on each loop; continuous travel remains unavailable. Cover deterministic camera/pose/contact sampling, looping, cleanup and unchanged animation data with unit and local desktop sword-cut, jump and walk browser regressions. Preserve the higher package/lockfile version `1.2.6`.

## 1.1.6-2

Add a seven-step **Preview Displacement** Feature Guide to the shared Animation catalog, covering additive opt-in, point timing and world coordinates, segment interpolation, synchronized playback, the trajectory overlay, reset and session-only saving. Reveal existing controls for empty and configured trajectories without changing settings, authored data, playhead or history; add prerequisite and local desktop guide coverage.

Add optional motion-agnostic Animation Editor preview displacement with clip-specific, session-only time/X/Y points, linear or stepped interpolation, reset and an optional world trajectory overlay. Default to As Authored; deliberate additive opt-in preserves skeletal root motion, facing, scale and IK. Evaluate offsets deterministically from the existing pose sample time, including stepped playback and exact endpoints, and apply them only to the preview Puppet's outer world container. Keep animation data, scene Actors, history, recovery and exports unchanged. Cover trajectories, seeking, playback, transforms, validation and lifecycle with unit and local desktop browser regressions; document the [motion preview workflow and architecture](docs/motion-preview.md).

## 1.1.6-1

Add a seven-step Environment Preview Feature Guide to the shared Animation catalog, covering image import/selection, world transforms, shared ground alignment, viewport navigation, reset and session/project saving. Reveal existing controls without changing preview settings, authored data or history; cover guide prerequisites, targets and local desktop navigation.

Add optional Environment Preview to Animation Editor for arbitrary clips, with project PNG/static WebP selection and import, visibility, world-space image position/uniform scale, resets and bottom-edge alignment to the existing ground guide. Reuse the authoritative Puppet, playback/evaluator, editor camera, project image registry and scene image texture lifecycle. Keep environment settings session-only and separate from authored data; retain imported project binaries in portable project exports. Cover mode toggles, imports, transforms, guide alignment, missing images, animation continuity, navigation and cleanup.

## 1.1.5

Integrate and harden advanced animation authoring across Pose Library, Graph Editor, variations, diagnostics, cleanup, recovery and Scene Editor. Release variation preview clocks when previewing a library pose, restore authored motion on playback, and synchronize cleanup IK inspector sampling with the canvas. Remove measured per-clock pose compatibility scans and redundant linear diagnostic samples while retaining runtime evaluation and cleanup tolerance checks. Add read-only Bézier handle, diagnostics and cleanup Feature Guides with stable controls, cross-tool/runtime/package/lifecycle regressions, a complete local desktop project workflow and optional performance diagnostics. Update the [artist workflow](docs/advanced-animation-workflow.md) and [internal v1.1 readiness assessment](docs/advanced-animation-readiness.md). Authored formats and public runtime APIs remain compatible; no publishing or CI browser changes.

Flush the last committed animation JSON draft even while a separate field/graph preview is pending, preserving legitimate edits on immediate refresh. Keep shared desktop headers inside the viewport. Harden local browser baselines against paint timing and CSS preview fitting, explicitly initiate drags before fixture panning, and align regression expectations with pose inventory, retained recovery drafts, static WebP support and deployment-base navigation.

## 1.1.4

Add [Motion Cleanup & Diagnostics](docs/motion-diagnostics.md) to Animation Editor’s Tools menu, with manual configurable possible-issue detection through the runtime property sampler, actual key spacing and shortest-path rotation. Inspect findings through shared timeline selection. Conservatively propose linear interior property removals, protect events, nonlinear/stepped motion, IK chains/ancestors and baked metadata, and verify combined deviation against the original. Add selectable candidates, numerical error reports, a pose-only before/after canvas scrub preview, cancellation and explicit Apply as one revalidated Undo/Redo transaction. Cache reports outside playback and bound dense-channel cleanup work. Defer contact-drift inference without authored contact intervals. Add unit and local desktop browser regressions; authored formats and public runtime APIs stay unchanged.

## 1.1.3

Add a seven-step **Create an Animation Variation** tour to the shared Feature Guide catalog, covering source selection, unique IDs, time scaling, preview/cancel, New / Unsaved documents, independent editing/history and export/Scene Editor references. Highlight the real toolbar action and existing workspace controls without opening dialogs or changing authored data. Extend guide immutability and local desktop browser coverage.

Add **Create Variation** to the Animation Editor toolbar with a source-pinned React dialog, unique name/ID suggestions and duplicate-ID validation. Copy the current authored working snapshot into the existing document owner, preserving bone/IK tracks, per-property curves, events/payloads, playback settings and baked IK suppression with independent frozen JSON branches. Select each new clip as New / Unsaved with its own history, retaining earlier source edits and history. Offer whole-clip time scaling for duration, bone/IK keys and events, plus a temporary pose-only canvas scrub preview with cancel/Escape and stale-source cleanup. Reuse JSON, character/project ZIP, autosave and Scene Editor references without changing authored formats or runtime APIs. Add copy-isolation, lifecycle, authoring, IK bake, queue/state and package round-trip regressions and a local desktop browser workflow.

## 1.1.2-2

Add the visual [Animation Graph Editor](docs/graph-editor.md), sharing the timeline's bone/IK track selection, key selection, playhead, authored document and Undo/Redo. Display supported numeric property curves using the runtime sampler, frame quantization and continuous shortest-path degree rotation. Add SVG keys/axes/playhead, bounded Bézier tangent dragging, Auto/Linear/Stepped/Bézier segment controls, precision key/handle inputs, handle reset, collision-safe time/value movement, deletion, frame snapping, zoom/pan and resize handling. Validate provisional snapshots before live Phaser/inspector preview, commit one history entry per drag and cancel on Escape/navigation/teardown. Preserve existing version-1 serialization and old animations; add unit/lifecycle and local desktop browser regressions. Add a seven-step Graph Editor tour to the shared Feature Guide with real-control anchors, graph/timeline view reveal, empty-selection guidance and read-only preparation; update the interpolation tour for property curves.

## 1.1.2-1

Add the animation curve foundation: optional per-property outgoing linear, stepped and bounded cubic Bézier controls in version-1 bone/IK keys. Validate finite normalized handles, monotonic time, keyed-property ownership and strictly ordered timelines. Reuse the runtime property sampler for playback, previews, layers, crossfades and IK baking, preserving linear defaults, smooth/stepped sampling and shortest-path radian rotation. Export `sampleProperty` and curve types for future Graph Editor previews. Preserve controls through deterministic serialization, key edits, clipboard, movement, retiming, selected-key mirroring and history; remove replaced rotation controls during IK bake commits. Regenerate the animation JSON Schema, document coordinates and compatibility, and add curve and integration regressions. Visual Graph Editor work remains deferred.

## 1.1.1

Add a seven-step Pose Library tour to the shared Animation Editor Feature Guide catalog, with real-control highlights for full/partial capture, browsing, preview/cancel, Apply, library editing/history and persistence. Keep guide navigation read-only for both poses and animation keys.

Add the [Advanced Pose Library](docs/pose-library.md) to Animation Editor's Tools menu: save full or selected-bone FK poses, browse/search/select, rename, confirmed deletion, non-destructive preview/cancel and explicit Apply Pose at the playhead. Apply sparse values through the existing batched keyframe API as one animation Undo/Redo transaction; retain unrelated bones, tracks and animated IK targets. Keep library edits in a separate bounded document history and previews outside authored data. Extend version-1 poses with optional stable IDs and character/rig/FK provenance, rejecting incompatible hierarchy, bind transforms and IK configurations. Preserve legacy presets and source assets. Carry current poses through character/project ZIPs, autosave, checkpoints, validation, dependency inspection and counted project asset libraries. Add unit and local desktop browser workflow regressions; browser checks remain local-only. Correct existing animation-free status assertions and local-save-aware desktop geometry checks; refit the rig preview default on layout reset after wrapped controls changed its cached width.

## 1.0.5

Harden the [personal production workflow](docs/personal-production-readiness.md) with an automated new-project/artwork/rig/IK/animation/scene workflow, four refresh/recovery checkpoints, semantic project round trips and an opt-in exact-scene ZIP handoff to the independently packed standalone runtime. Release storage ownership after in-flight artwork hashing settles during editor teardown, and prevent disposed autosave owners from restarting timers. Add previous-valid-revision recovery after binary corruption and measured local project autosave/import/export diagnostics. Correct artist recovery and scene/runtime handoff documentation; record readiness gates, regression evidence, cleanup findings and remaining human acceptance limits. Use one shared GitHub/Primer header across all pages, document the style guide, hide empty recovery access, use a quiet local-save row with a Draft actions menu, share one Feature Guide catalog across Project and editors, style a compact recovery dialog, and carry accepted recovery across routes without a second confirmation. Group character asset libraries into counted categories with contained image previews and readable rows; correct project settings padding and create/remove action colors; add labelled project toolbar icons with shared alignment. Synchronize package/lockfiles/standalone references at 1.0.5 and repair packaged documentation links. Authored formats and public runtime APIs stay unchanged. Browser verification remains local-only; no publishing, tags, releases or deployment.

## 1.0.4

Unify [editor workflow and status](docs/unified-editor-workflow.md) with project/document identity, explicit checkpoint wording, per-scene project indicators and a Project Workspace entry into the existing Rig, Animation and Scene Feature Guides. Standardize history and export shortcuts, guard native fields/modals/tutorials, add scene keyboard playback and dependency-safe deletion, and cancel gestures before deselection. Keep guide cards and spotlights on the same measured layout without crossing highlighted controls. Improve empty-state guidance and actionable recovery/export/preview feedback while retaining document owners, independent selections/history, collapsed inspectors and the animator's desktop style. Add unit and local desktop browser workflow regressions; browser checks remain local-only.

## 1.0.3

Add [project asset integrity and dependency inspection](docs/project-asset-integrity.md), reusing the existing character, rig, animation, IK, skin, scene and package validators. Show real draft/production diagnostics with editor navigation and debounced, cached checks after authored changes. Block project and scoped scene exports with broken required dependencies while retaining final exporter checks and diagnostics. List scene/Actor/clip and artwork dependents before shared replacements, protect referenced skin renames, and preserve existing deletion/history guards. Add source-immutability, invalid-reference, export-blocking, shared-replacement, panel and 120-character/120-scene cache/performance regressions plus local desktop browser coverage. No automatic repairs or authored format changes.

## 1.0.2

Add complete [local autosave and crash recovery](docs/local-autosave.md) across the Project Workspace and standalone rig, animation and scene editors. Store validated portable project snapshots and actual artwork Blobs in atomic IndexedDB transactions, with debounced committed edits, two retained revisions and explicit recovery/discard controls. Keep local-save status separate from export checkpoints; preserve prior drafts on failed writes and exports. Detect competing tab/session writers with browser locks and expiring transactional leases. Add unit and local desktop browser coverage for recovery, binary artwork, interrupted writes, quota failures, retention, project switching and incompatible/corrupt snapshots.

## 1.0.1

Add the desktop [Project Workspace](docs/project-workspace.md) at `/project/`: empty project/character/scene creation, existing character and scene registration, explicit scene dependency mapping, asset libraries, project settings and metadata Undo/Redo. Retain the existing character editors and scene document owners across asset/project navigation, with separate metadata/document export checkpoints and dependency-safe removal/history. Reuse character/scene validators and stored ZIP packaging for portable project import/export, shared binary artwork and stable authored IDs. Isolate runtime texture aliases and keep temporary URLs out of authored packages. Add unit compatibility, source-isolation, import/export and local desktop browser regressions. Project autosave and crash recovery remain deferred to v1.0.2; character version 1 and scene version 2 stay unchanged.

## 0.9.8-4

Harden the [foot contact workflow](docs/foot-contact-readiness.md) across all three editors. Add Creating Foot Contact Markers, Aligning Feet to Ground and Grounding Characters through the existing Feature Guide and stable control anchors. Explain manual marker realignment after artwork/skin proportion changes and stable marker IDs. Keep hidden diagnostic controls idle, limit live text updates to ten per second while preserving frame-current canvas positions, and clear stale Actor contact selections/measurements after removal, character replacement and history transitions. Extend package, artwork, mirroring, IK, baked IK, lifecycle and local desktop artist-workflow regressions. Preserve existing authored formats, animation tracks and document ownership; record the coordinate/reference audit and actual verification limits.

## 0.9.8-3

Integrate rig foot contacts with Animation Editor and Scene Editor grounding. Add optional post-FK/IK marker overlays, explicit contact/constraint selection, signed ground distances and configurable tolerance. Preview contact IK alignment on detached solver joints and a tinted overlay, then explicitly apply verified X/Y target keys as one animation Undo/Redo edit. Report limited/clamped results with residual error and reject stale proposals or external IK ownership. Scene grounding and opt-in placement snapping use the chosen evaluated rig contact, including facing and scale, and author only initial Actor Y; retain the labeled legacy attachment-contact fallback for rigs without markers. Contacts follow scene playback/scrubbing without constraining choreography. Add unit/integration and local desktop browser regressions, plus [workflow and transform documentation](docs/foot-contact-ground-integration.md). Milestone `0.9.8.3` uses SemVer heading `0.9.8-3`.

## 0.9.8-2

Add visual [Rig Editor foot contact markers](docs/foot-contact-markers.md): collapsed React controls, bone selection, generated stable IDs, names, local coordinate fields, selectable Phaser crosshairs and direct dragging through nested transforms, scale, facing and camera navigation. Share rig Undo/Redo and recovery, cancel drags with Escape, guard persisted marker references, and preserve animation data. Reuse the ground reference line and draggable tag with collapsed visibility/height controls in Rig Editor, independently of authored rig and animation history. Add editor and local desktop browser regressions covering authoring, transforms, history, serialization, ground dragging and cleanup. Milestone `0.9.8.2` uses the changelog's SemVer form `0.9.8-2`.

## 0.9.8-1

Add the [foot contact marker foundation](docs/foot-contact-markers.md): optional rig markers with stable IDs, names, bone references and finite bone-local coordinates, validated creation defaults and pure post-IK world position evaluation through bone hierarchies, scale, facing and Puppet/Actor transforms. Preserve markers through runtime/editor exports, history and recovery; guard referenced bones against deletion or renaming. Add 20 regressions covering validation, transforms, IK, JSON round trips, compatibility and immutability. Existing rigs retain format version 1, and animation and ground-alignment behavior remain unchanged. Milestone `0.9.8.1` uses the changelog's SemVer form `0.9.8-1`.

## 0.9.7-4

Audit and harden [ground reference integration](docs/ground-reference-readiness.md) across both editors. Add five-step Using Ground Reference and Aligning Actors to Ground tutorials through the existing Feature Guide, stable React control anchors and tooltips distinguishing guide preferences from authored edits. Document full coordinate conversion, browser-only persistence and safe Actor-origin fallback. Extend recovery, overlay reuse, tutorial isolation and authored IK export/re-import regressions; preserve collapsed inspectors and editor/runtime history boundaries.

## 0.9.7-3

Complete Scene Editor [ground reference integration](docs/ground-reference.md) with scene-world label dragging, numeric controls, separate guide Undo/Redo, opt-in Actor-origin drag snapping and Shift bypass. Add explicit “Align Actor Origin to Ground” through authored scene Undo/Redo; rigs have no reliable foot-contact marker, so the fallback is labelled clearly. Preserve scene-ID browser metadata, camera alignment, playback/scrubbing and authored movement paths. Add coordinate, multi-rig/skin/scale, persistence, lifecycle and local desktop browser regressions. Authored scene/character formats remain unchanged. Milestone `0.9.7.3` uses the changelog's SemVer form `0.9.7-3`.

## 0.9.7-2

Integrate the [ground reference](docs/ground-reference.md) into Animation Editor with collapsed controls, numeric/reset settings, a dedicated world-space drag label, Escape cancellation and separate bounded guide Undo/Redo. Keep one browser preference per character across clips. Add optional IK drag draft snapping and explicit “Align IK target Y to guide” key authoring through the existing atomic XY API. Preserve world X through full affine transforms and explain missing sole-contact metadata. Guide edits leave authored animation data and history unchanged; foot planting is unchanged. Include unit, lifecycle and local desktop browser regressions. Milestone `0.9.7.2` uses the changelog's SemVer form `0.9.7-2`.

## 0.9.7-1

Add the [ground reference foundation](docs/ground-reference.md): separate preview/scene world settings, per-workspace browser persistence, reusable Phaser overlay and collapsed React controls. Scene Editor exposes the shared controls; dedicated Animation Editor controls and snapping remain deferred. Authored formats and history are unchanged. Milestone `0.9.7.1` uses the changelog's SemVer form `0.9.7-1`.

## 0.9.6

Harden Scene Editor placement previews and teardown: suppress initial-pose gameplay events, use explicit hard cuts, and release all owned Actors even when one cleanup fails. Collapse inspector disclosures when a same-ID import installs a fresh document. Isolate playback controls and playhead subscriptions from authored timeline rows, and avoid frame subscriptions in the collapsed runtime inspector. Add eight Scene Editor tours to the existing Feature Guide, a complete two-package artist workflow and optional exact-ZIP standalone handoff, rapid-seek/lifecycle regressions, and a local real-Phaser scene profile. Add [Making Your First Scene](docs/making-your-first-scene.md) and the [v0.9 readiness report](docs/scene-editor-readiness.md). Scene format version 2 and character format version 1 remain unchanged.

## 0.9.5

Add dependency-checked Scene Editor validation, paste/file import, clipboard export and scene ZIP downloads. Reuse canonical version-2 scene serialization and the existing stored ZIP format; package each required character once and rebase shared hosted assets into safe archive paths. Add renderer-independent dependency/package APIs and an optional runtime `SceneLoader` over `SceneRunner`, with isolated ZIP texture keys, cancellation and disposal. Add a standalone authored-scene page, JSON/ZIP playback equivalence, import isolation, path and package regressions, and local desktop browser coverage. Scene and character format versions remain unchanged. See the [scene guide](docs/scene-editor.md).

## 0.9.4

Add `SceneRunner` over the existing Actor/Puppet runtime with one delta-driven scene clock, exact authored action boundaries, concurrent movement, animation windows, facing and named cues. Add Scene Editor Play/Pause, Restart, Stop, speed, deterministic scrubbing and a collapsed runtime inspector. Seeking rebuilds isolated runtime instances from the initial snapshot, suppresses animation gameplay events and scene cues, and leaves scene data, character clips, saved state and Undo untouched. Detect interruption synchronously, settle waits on cancellation/disposal, and ignore obsolete requests after restart. Include a two-character encounter with bow/response clips, runtime regressions and local desktop browser coverage. Authored formats remain unchanged. See the [scene guide](docs/scene-editor.md).

## 0.9.3

Add the visual Scene Editor timeline with Actor tracks, ruler/playhead, horizontal zoom/scroll, shared snapping, selection, drag/resize, duplicate/delete and collapsed React action properties. Scene format version 2 requires stable action IDs and explicit finite clip durations, with typed animation, movement, facing targets, wait and generic JSON cue declarations. Reject overlapping position/base-animation ownership and equal-time facing changes atomically; allow independent Actors and position-only movement alongside animation. Reuse snapshot history so one drag is one Undo; cancellation preserves Redo. Add a read-only future destination stage marker, timing/conflict/serialization/source-isolation tests and local desktop browser coverage. Scene playback remains deferred. Version-1 scene actions require explicit migration; character formats and Actor/Puppet APIs stay unchanged. See the [scene guide](docs/scene-editor.md).

## 0.9.2

Add the visual Scene Editor stage with existing Phaser/Puppet rendering, independent Actor instances, package selection and permanent custom manifest references. Add stage-coordinate dragging, axis handles, zoom/pan, an optional grid, collapsed actor inspectors, initial facing/skin/animation settings, duplication, removal and array-based preview depth. Group each drag into one undo transaction with Escape cancellation. Update action references on actor renames and require explicit removal of referenced actions. Cache character definitions/artwork for the page lifetime and dispose runtime instances on removal, scene switches and shutdown. Add placement, source-isolation, coordinate, resource-lifecycle and local desktop browser coverage. Timeline authoring and scene playback remain deferred; authored formats stay at version 1.

## 0.9.1

Add the React [Scene Editor foundation](docs/scene-editor.md) at `/scene-editor/`: create, open, select, inspect, download, revert and undo/redo independent scene documents without loading a character. Introduce renderer-independent version-1 scene schemas, typed animation/facing action declarations, stable scene-local actor IDs and character manifest references, optional asset-catalog validation, bounded parsing and deterministic serialization. Preserve imported actors/actions while keeping stage placement, timeline editing and runtime playback deferred. Add document isolation, validation, history, checkpoint and local desktop browser regressions. Existing Actor/Puppet APIs and character formats remain unchanged.

## 0.8.6

Complete v0.8 Actor/choreography production hardening: add a reusable two-character scene using the actual exported standalone package, with concurrent walks, barrier, facing, finite responses, idle return and cleanup on every exit. Add repeated-scene, queue/state/crossfade, event, live/baked IK, skin, transform and consumer browser regressions. Validate direct walk facing options consistently, remove temporary frozen movement points from frame updates and release completed sequence cue/target references and freeze pre-run cancellation/disposal results. Add optional measured one/two/twelve-Actor CPU profiles, the [production guide](docs/choreography-production.md) and [v0.8 release report](docs/release-notes-v0.8.md). Public Puppet APIs and version-1 authored formats remain compatible. No publishing, tags or remote release is part of this change.

## 0.8.5

Add optional runtime `Choreography` contexts with a lightweight Actor registry, lazy typed Actor actions, nested sequential/parallel composition and successful-outcome synchronization barriers. Reuse `ChoreographySequence` for every Actor leaf. Fail-fast coordination cancels owned siblings and waits for cleanup while preserving the first unsuccessful outcome. Preflight parallel Actor/Puppet conflicts; share exclusive active-sequence claims across contexts and standalone sequences through `ChoreographyConflictError`. Preserve direct host operations and existing clocks, animation events and Puppet lifecycle. Add deterministic multi-Actor, interruption, cancellation, disposal, registry, conflict, event and cleanup regressions, public declaration/consumer checks and the expanded [choreography guide](docs/choreography-sequences.md). Authored formats remain version 1; the shipped-character sample, wider integration/performance audit and final v0.8 readiness report remain deferred to v0.8.6.

## 0.8.4

Add the optional runtime [ChoreographySequence](docs/choreography-sequences.md) with typed move, walk, look, face, finite animation, update-clock wait and synchronous cue steps. Single-run sequences preflight commands, await successful completion, preserve interruption details and stop on cancellation, disposal or failure. Movement uses request-local abort signals; opt-in `playAndWait(..., { stopOnAbort: true })` stops only its fresh selected instance while preserving replacement playback, unrelated layers and pending queue requests. Actor exposes its existing disposal signal and immutable default locomotion mapping. Add deterministic sequencing, timing, pause, ownership, reentrancy, validation and cleanup regressions; authored formats remain version 1. Multi-Actor parallel groups, barriers and conflict coordination remain deferred to v0.8.5.

## 0.8.3

Add Actor `faceLeft()`, `faceRight()`, `facingDirection`, world-position snapshots and one-time `lookAt(point | actor)` through Puppet's existing left/right mirror. Targeting uses horizontal world positions, accounts for enclosing transforms, preserves facing for ties and ignores self/disposed Actor targets. Opt-in `walkTo(..., { faceMovement: true })` follows actual world travel without redundant facing changes. Regressions cover transformed coordinates, stationary movement, stale/invalid targets, IK, weapon mounts, slots, hierarchy and authored-data preservation. Update [Actor documentation](docs/actors.md); authored formats remain version 1. Continuous tracking and head-only/360-degree facing remain deferred.

## 0.8.2

Add deterministic Actor `moveTo()` / `walkTo()` and `cancelMovement()` using Puppet's existing millisecond updates. Movement measures world-space speed, clamps arrival, keeps the Puppet container authoritative, and settles typed completed/interrupted/cancelled/disposed outcomes with request snapshots. Explicit Actor/per-request walk and idle animation mappings reuse `AnimationStateController` and runtime crossfades; newer playback owners retain precedence while movement continues. Add `Puppet.onUpdate()`, public movement types, deterministic movement/ownership/cleanup regressions and updated [Actor documentation](docs/actors.md). Facing helpers and spatial targeting remain deferred to v0.8.3; authored formats remain version 1.

## 0.8.1

Add the optional runtime [Actor foundation](docs/actors.md): host-assigned instance identity, position snapshots and updates backed by the existing Puppet container, delegated playback/async/state/appearance APIs, and explicit borrowed or owned Puppet lifecycle. Actor reuses `AnimationStateController` and playback outcomes, cancels its own borrowed waits on disposal, and destroys owned Puppets once. Add `Puppet.onDestroy()` for reliable idle and scene-shutdown cleanup, public root/runtime exports, lifecycle/ownership/spatial regressions and dependency-boundary coverage. Movement and locomotion coordination remain deferred to v0.8.2; authored formats remain version 1.

## 0.7.6-6

Complete the Feature Guide with typed Explain/Try It steps, explicit real-control practice for selecting a bone, setting its current X key and enabling onion skinning, authoritative state-based completion without automatic advancement, protected background input and keyboard focus, restart/catalog navigation and prerequisite guide links. Normal key validation, dirty state and Undo/Redo handle intentional practice edits; guide navigation stays non-destructive. Add the short [artist guide](docs/feature-guide.md), lifecycle/state regressions and local desktop browser practice coverage. The nine Rig Editor and thirteen Animation Editor guides retain their implemented feature scope; canvas, mirroring and baking remain explanations. Milestone `0.7.6.6` is packaged as SemVer `0.7.6-6`; the production runtime and authored formats are unchanged.

## 0.7.6.5

Add thirteen selectable [Animation Editor tutorials](docs/animation-editor-guides.md) covering clip creation, bone keys, playback/timeline navigation, key editing, interpolation, onion skins, mirroring, IK targets/baking, events, Rig Tweak and export. Stable control/panel/preview anchors use the existing spotlight resolver. Live prerequisites distinguish missing clips, bone keys, selected IK targets and authored IK keys without adding sample data or changing selection. Tours remain explanation-only; inspector sections start collapsed. Unit and local desktop browser regressions check navigation, geometry and preserved documents/history. Package version remains `0.7.5`; animation functionality and authored formats are unchanged.

## 0.7.6.4

Add nine selectable [Rig Editor tutorials](docs/rig-editor-guides.md), with 44 steps covering new characters, bones, joint positions, image import/replacement, sprite alignment, slots/attachments, skins, IK defaults and rig/character export. Stable React control anchors and the existing preview-panel target follow the real UI. Live artwork and IK prerequisites explain unavailable tasks on root-only drafts. Tours reveal disclosures and scroll controls without authoring or exporting; inspector sections still start collapsed. Unit and local desktop browser coverage checks the catalog, every target, navigation, failed loads and retained documents/history. Package version remains `0.7.5`.

## 0.7.6.3

Add a shared guided-tour spotlight above React and Phaser with a dimmed rectangular cutout, positioned explanation card, Back/Next/Finish/Exit and Escape. Safe reveal expands only the targeted disclosures and scrolls controls into view. Live DOM/panel/provider measurements follow layout, scroll, resize and zoom; missing targets offer Skip/Exit. Explanation-only modal interaction protects editor data, contains keyboard focus and restores it on exit. Reduced-motion support, observer/listener/frame cleanup, unit coverage and local browser regressions accompany the overlay. Interactive guided practice remains deferred.

## 0.7.6.2

Add the v0.7.6.2 React Feature Guide selection modal to the shared character workspace header in both editors. Editor categories and feature rows come from the existing registry, with live prerequisite reasons, guarded navigation, first-step activation, and native dialog keyboard/focus handling. Guide launches retain unsaved documents and block mode changes that would discard uncommitted previews. Unit and local browser regressions cover selection, availability, navigation, empty states, and focus; spotlight rendering and instruction cards remain deferred.

## 0.7.6.1

Establish the v0.7.6.1 [Feature Guide architecture](docs/feature-guide-architecture.md): a typed feature-specific registry, React-compatible session controller, prerequisite/status checks, stable editor anchors, explicit UI-only preparation, and shared DOM/panel/optional Phaser geometry targeting. Regression coverage verifies registry/navigation boundaries, target cleanup, and isolation from authored rig/animation data, dirty state, history, playback, and events. Selection UI, spotlight rendering, and complete tutorial content remain deferred to later v0.7.6 milestones.

## 0.7.5

Runtime controller production hardening adds deterministic crossfade/overlay, callback precedence, exported IK/baked clip, cancellation and repeated scene-shutdown regressions. Disposed state controllers release their host reference; malformed play restart/layer values reject before changing playback or queues. The standalone packed consumer demonstrates direct playback, FIFO requests, named states, temporary actions and safely handled async results using valid attack/recover/run clips. Local CPU profiles and the [v0.7 readiness report](docs/runtime-controller-readiness.md) record measured performance, API contracts, cleanup, authoring/data regression coverage and verification results. Existing Puppet APIs and version-1 authored formats remain compatible; controller features remain opt-in.

## 0.7.4

Async animation adds `playAndWait(name, options?)` and `waitForPlayback(options?)` to Puppet and the renderer-independent AnimationPlayer. Promises bind to exact playback instances and return typed lifecycle outcomes: completed, interrupted, stopped or disposed, plus wait-only cancellation. AbortSignal cancellation removes listeners without stopping playback or changing queue/controller policy; an already-aborted signal skips playback entirely. Indefinite loops reject with an actionable error; `loop: false` awaits one pass. Completion remains tied to the clip endpoint, and disposal drains waits even when callback-driven destruction suppresses queued notifications. Queue advancement and state-action returns reuse their existing lifecycle handling. Public types are exported through `/core`, `/runtime` and the package root. See the [async API and verification](docs/async-animation.md). Package version is `0.7.4`; authored formats remain version 1. Future queue-request promises, event waits, finite repeats and gameplay scheduling remain deferred.

## 0.7.3

AnimationStateController adds reusable named base-animation states, idempotent state requests, explicit restarts, millisecond pair/default fades and one-shot actions with a persistent return state. It delegates to Puppet or the renderer-independent AnimationPlayer without an evaluator, update loop or queue of its own. Direct base playback and pending FIFO requests relinquish controller ownership until an explicit state request; overlay layers, masks, IK, skins and attachments retain existing behavior. Instance-local `play({ loop })` overrides preserve registered animation data, and `hasAnimation(name)` enables configuration validation. `isPlaybackStopped(layer?)` distinguishes an explicitly frozen channel from a held completion. Opt-in settled lifecycle completion runs after authored/legacy callbacks and queue advancement so callbacks can take control before an action returns. Disposal releases subscriptions and pending returns without stopping host playback. See the [state controller API and verification](docs/animation-states.md). Package version is `0.7.3`; authored formats remain version 1. Graph editors, gameplay logic, rule expressions and multi-actor coordination remain deferred.

## 0.7.2

Animation queues add `queue(name, options?)`, `getQueue()`, `clearQueue()`, `stopQueue()` and `replaceQueue(requests)` to Puppet and the renderer-independent AnimationPlayer. Typed, immutable pending requests reference registered clip names and support existing speed and fade options. FIFO advancement uses playback lifecycle completion after authored, lifecycle and legacy completion callbacks; queued fades begin at completion and excess update delta is not carried to the successor. Infinite queued loops and requests behind an active base loop reject explicitly. Successful base play/restart/stop/clear operations discard pending requests, while overlay operations remain independent; base-only queue cancellation preserves unrelated layers. Validation and playback identity/revision guards prevent failed requests or callback interruptions from reviving stale queues. Disposal releases pending requests. See the [API contract and verification](docs/animation-queues.md). Package version is `0.7.2`; authored formats remain version 1. State machines, promises, pre-end blending and per-layer queues remain deferred.

## 0.7.1

Playback lifecycle and completion adds `getPlaybackStatus(layer?)` and removable `onPlaybackLifecycle` subscriptions to Puppet and the renderer-independent AnimationPlayer. Each start/restart receives a player-local playback ID; typed snapshots distinguish playing/paused status and completed, interrupted, stopped and disposed outcomes. Replacements interrupt immediately while outgoing clocks continue driving existing visual crossfades. Pause/resume, layer clearing, explicit stop and destruction preserve terminal outcomes. Notification boundaries preserve authored marker ordering and legacy completion payloads, isolate listener payloads, and finish delivery despite listener failures; Puppet cleanup completes even when a disposal listener throws. Runtime lifecycle state stays out of authored JSON and React. Zero-duration clips retain the shared schema's existing rejection contract. See the [API contract and verification](docs/playback-lifecycle.md). Queues, state machines and promise-based playback remain deferred. Package version is `0.7.1`; no publication or CI browser step.

## 0.6.6-4.3

Both editors' IK inspector sections are collapsible, and collapsible inspector panels start closed. Inspector sections and rig-selection guidance have more vertical spacing. Clicking an already selected bone in the rig hierarchy clears its selection without authoring a change.

Reselecting the active animation now retains its latest working snapshot and history, including recovered new clips, instead of falling back to an older saved snapshot.

The v0.6.6.4.3 [IK authoring integration](docs/ik-authoring-integration.md) brings the shared visual constraint panel to Animation Editor's Rig Tweak mode, with immediate target discovery and separate rig/animation histories and dirty states. Compatible rig JSON reload/import now accepts authored IK additions and settings while live references protect deletion, IDs and chain/endpoint changes; rename and import errors identify affected animations, baked metadata and host owners. Imported constraints cannot take reserved host IDs. Preview rebuilds retain external world targets, providers, enabled state and explicit influence ownership; preview toggles leave those owners intact and character movement translates only editor-pinned targets. Root-only character authoring through animation, baking, ZIP export, CharacterLoader reload, runtime facing/disabled constraints and cleanup has automated integration coverage, with local React/Phaser workflows for new and existing characters. The [artist guide](docs/artist-workflow.md#creating-ik-on-a-new-character) adds both IK tutorials and explains static, animated, runtime and baked targets. Package version remains `0.7.5`; authored formats remain version 1, and browser tests remain local-only. Atomic reference migration and editable ZIP import remain deferred.

## 0.6.6-4.2

The v0.6.6.4.2 [visual rig IK editor](docs/rig-ik-editor.md) adds a padded React constraint panel, more spacious skeleton guidance and a guided creation form using actual connected bone IDs. Artists can configure default targets, influence, bend, enabled state, priority and end-effector offsets without editing JSON. Editor-only Phaser crosshairs, endpoint links and selected-chain highlights stay synchronized with numeric controls. Target dragging handles camera zoom/pan, puppet placement, scale, rotation, facing and enclosing containers through existing coordinate utilities, with one Undo/Redo entry per completed gesture and Escape/lifecycle cancellation. Requested unreachable targets remain authored while the existing solver previews its defined behavior. Live dependencies protect chain edits and deletion; runtime/provider ownership protects target gestures. Rig defaults remain separate from animation targets, keyframes, drafts and history. Unit, shared-workspace and local browser regressions cover creation, validation, synchronization, preview, export/reload, empty states and cleanup. Package version remains `0.7.5`; authored formats remain version 1, and browser tests remain local-only.

## 0.6.6-4.1

The v0.6.6.4.1 [IK constraint authoring foundation](docs/ik-constraint-authoring.md) adds typed creation, selection, configuration and deletion APIs for existing characters and New Character drafts. Constraints retain stable `name` IDs and use the existing two-bone solver, chain settings and priority order. Optional puppet-local default targets initialize at the current end contact point, including endpoint offsets and effective bone lengths; runtime targets/providers and animation channels retain precedence. Complete candidate validation rejects invalid chains, duplicate IDs and unsupported values. Live animation IK tracks, baked suppression metadata and specialized host references block unsafe deletion or chain changes, including through rig history, reset and recovery. Animation restoration also rejects references missing from the current rig. Each authored command uses the immutable working copy and one Undo/Redo entry; previews rebind around changed constraints. Version-1 JSON round trips preserve exact IK values and compatibility with targetless rigs. Unit and shared-scene regressions cover authoring, dependencies, history, serialization and runtime ownership. React authoring controls and draggable rig handles remain deferred.

## 0.6.6-3

The v0.6.6.3 [first-character workflow](docs/creating-your-first-character.md) covers building a skeleton, importing and aligning artwork, assigning the default skin, creating animations and exporting a portable character ZIP using the existing shared workspace and version-1 formats. Actionable draft-readiness guidance identifies incomplete content, and animation-free runtime previews show a disabled animation selector. Generated package metadata is validated before fetching source images, and duplicate standalone skin names are rejected before manifest assembly. New-character ZIP round trips through CharacterLoader and Puppet verify independent dirty states and Undo/Redo, source immutability, repeated preview cleanup and both shipped characters. The [verification report](docs/first-character-verification.md) records passing unit, build, packed-consumer and local browser checks. Image/history persistence and editable ZIP import remain deferred; browser tests remain local-only.

## 0.6.6-2

The v0.6.6.2 [rig-building workflow](docs/rig-building.md) lets artists build a character from the root-only workspace without editing JSON. React skeleton controls add arbitrary child bones and slots, rename bones, reparent joints and safely remove unreferenced structure. Hierarchy validation rejects duplicate IDs, invalid parents, cycles and invalid transforms; dependent slots, artwork, IK and animation tracks are retained and reported before destructive changes. Phaser previews rebuild around structural edits while preserving shared rig/animation documents, histories, playheads, facing and imported artwork. Existing PNG/WebP import, attachment assignment, default skins, joint dragging, origins/offsets and render-depth tools work on newly created structure. Structural Undo/Redo and version-2 browser recovery retain hierarchy and zero-length directions; serialization compares stable IDs to preserve untouched numeric precision after deletion. Unit and local browser regressions cover creation, validation, cancellation, recovery, existing-character compatibility and complete ZIP export. Engine-authored formats remain version 1; browser tests remain local-only.

## 0.6.6-1

The v0.6.6.1 [new character workspace](docs/new-character-workspaces.md) adds **+ New Character** to the shared header, including before a character loads. The React dialog validates a name and unique editable ID, then opens an independent unsaved Rig Editor draft with one root bone, an empty default skin, and no artwork or animations. Centralized creation reuses existing schemas, document owners, Undo/Redo, JSON draft recovery and unsaved navigation protection without copying or modifying either shipped example. Draft identities remain available in the same browser tab. Artists can import their first PNG/WebP into the artwork library and export a complete validated character ZIP; empty drafts require no dummy assets. Unit and local browser coverage verify isolation, invalid inputs, duplicate IDs, switching, transactional failures, first-image import and package round trips. Bone/slot creation and artwork assignment onto new structure remain deferred to v0.6.6.2. Authored formats remain version 1; browser tests remain local-only.

## 0.6.5

Final v0.6 production-authoring hardening restores browser draft autosaves for full-Rig-Editor numeric edits and adds explicit [release gates and verification results](docs/release-readiness.md), [v0.6 release notes](docs/release-notes-v0.6.md), and a sequential `npm run check:release` command for existing non-browser checks. Regression coverage exercises ten complete ZIP/load/re-export cycles with byte-identical images and metadata, rejected loads alongside live playback, and repeated single/multiple-puppet lifecycles with scene-listener and object cleanup assertions. A local browser workflow combines artwork, joints, skins, animation keys, mirroring, onion skinning, IK authoring/baking, Rig Tweak and runtime ZIP preview. Runtime ZIP preview and standalone skin switching now reset to the default before applying sparse overrides, retaining unlisted body parts as the editor does. macOS Control-click retains multi-key selection when a native context-menu event follows the toggle. The Animation Editor preview minimum now fits compact desktop heights alongside package controls. Browser sampling and drag checks avoid redundant keypress deadlines and exact subpixel string assumptions. Clip-switching regression expectations follow retained per-clip sessions. Package and standalone tarball versions are `0.6.5`; authored formats remain version `1`, public entry points remain compatible, and no publication or remote release was performed. Browser tests remain local-only. See the readiness report for the verdict, exact command results and verification gaps.

## 0.6.4

Character packaging and runtime integration retains the existing version-1 exporter, paths, identifiers and public runtime. Pre-preview validation and ZIP encoding share complete file-layout checks, including case-insensitive duplicates and file/directory collisions. Shared image aliases are fetched, budgeted and decoded once. A standalone Phaser/Vite consumer imports the installed `/runtime` API and demonstrates loading, idle/walk/sword playback, events, authored/baked IK, skins and cleanup. Packed-package verification runs the consumer's actual test/build commands. Editor export → ZIP → relocated CharacterLoader → Puppet integration compares authored motion/events, replacement binaries, appearances and disposal; optional local browser coverage checks the production consumer under a nested base path. The [artist guide](docs/artist-workflow.md) and [developer integration guide](docs/runtime-integration.md) cover authoring and production ownership. Package version is `0.6.4`; no authored format change, new runtime dependency, publication or CI browser step.

## 0.6.3

React editor production workflow shares one character scene, rig document, artwork controller and skin catalog across Rig Editor, Animation Editor and Rig Tweak. Editor tabs and browser history retain committed work; clip navigation retains pending snapshots, checkpoints, history, playheads and key selections. Package status remains visible with independent Rig, Animations, Assets and Skins indicators, including inactive clips and changes made during artwork proposals. Uncommitted animation previews offer cancel/discard on mode changes; character changes and external navigation retain browser guards. Compatible rig imports retain live animation references and replacement images; unsupported topology changes report an error without replacing the workspace. Shared JSON draft controls and namespaced rig-tweak hosts prevent competing recovery owners or duplicate DOM IDs. Unit and local browser workflow/lifecycle coverage and local dense-workflow/appearance profiling are documented in the [verification report](docs/react-editor-workflow-verification.md). Package version is `0.6.3`; authored formats and CI browser policy remain unchanged.

## 0.6.2

Schema and compatibility hardening retains all version-1 authored formats. Validated canonical rig, animation, skin and manifest serializers are available from `/serialization`; package metadata and standalone skin exports use deterministic object ordering. Rig fallback field ordering is locale independent. Character validation rejects reused metadata paths and metadata/image collisions and includes source filenames in nested diagnostics. Package loading validates authored paths before URL normalization through the optional loader `pathPolicy`, preserving general runtime URL behavior. A focused fixture suite covers minimal/complete characters and unchanged v0.4.3 JSON, 20 serialization cycles, events, skins, IK/baked IK runtime equivalence, transactional failures and deterministic existing draft compatibility. The [format inventory and compatibility policy](docs/schema-compatibility.md) document defaults, references, migration behavior and validation commands. No authored format migration, new dependency or CI browser step. Package version is `0.6.2`.

## 0.6.1

Architecture and public API stabilization adds explicit `/runtime`, type-only `/data`, and renderer-independent `/serialization` entry points, retaining the root and every `/core` export. The cancellation-aware scene character loader moves into the engine with a compatibility re-export at its former path. The [architecture audit and API guide](docs/runtime-api.md) document dependency directions, editor application entries, public/internal contracts and texture/prop/subscription ownership. Puppet cleanup disposes IK constraints and releases target callbacks and captured joints; resolved IK targets enforce their readonly contract. Rig exports use a typed detached clone. Source dependency tests enforce runtime/editor isolation and absence of value cycles; the minimal runtime example and isolated packed consumer verify loading, playback, crossfades, skins, events, cleanup and compatible imports. No JSON format change, new dependency, npm publication or CI browser step. Package version is `0.6.1`.

## 0.5.8-7

The v0.5.8.7 [Create Animation from Scratch](docs/new-animation-verification.md) adds **+ New Animation** to the Animation Editor, including characters with no animation files. The React dialog validates a unique name/ID, duration, FPS and loop preference, then creates an empty version-1 animation using the rig's bind-pose fallback. New documents retain independent Undo/Redo, working copies and **New / Unsaved** status across clip switches, with existing navigation and replacement protection. JSON export/import and character ZIP export include new clips and register their manifest paths automatically. Unit and local browser coverage verify empty timelines, authoring, failure atomicity and CharacterLoader/Puppet playback.

## 0.5.8-6

The v0.5.8.6 [production asset workflow](docs/artist-workflow.md) completes v0.5.8 with transactional character ZIP downloads in both editors. Existing manifest, rig, skin, animation and pose formats retain relative paths and stable IDs; binaries include shared/individual sprite replacements and exact origin/offset migration. Package checkpoints remain separate from source files and per-document history. ZIP validation rejects missing resources, unsafe/colliding paths, duplicate IDs, incompatible frames, unsupported versions and corrupt entries. Reload/import opens an isolated `CharacterLoader` → `Puppet` runtime preview with animations, skins and facing. Pending image proposals protect navigation and rig reload/import. Unit and local browser coverage exercise round trips, runtime motion, failures and repeated preview disposal. No new dependency or CI browser steps. Package version is `0.5.8-6`.

## 0.5.8-5

The v0.5.8.5 [Safe Sprite Replacement & Hot Reload](docs/sprite-replacement.md) adds explicit shared/individual artwork scopes using stable bone and attachment IDs, dimension comparison and previewed normalized/pixel/manual pivot policies. Current catalog and frame preflight, transactional texture registration/installation/preview refresh and independent bounded artwork Undo/Redo preserve rig, skins, render order, facing, IK and animation data. Inactive textures are released after all retained previews refresh; undo resources remain session-local and recreate textures lazily. Unit motion regressions cover idle, walk, attack, IK, baked IK and mirrored playback; local browser scenarios cover both editors. Package version is `0.5.8-5`.

## 0.5.8-4

The v0.5.8.4 [Visual Attachment & Skin Management](docs/visual-attachment-skins.md) adds a shared React slot/attachment/skin panel with immediate appearance previews, stable attachment IDs, sparse overrides, explicit clearing/inheritance, skin creation/renaming and attachment deletion diagnostics. Manifest skin documents keep their existing precedence and separate downloads/dirty baselines. Rig history and source-bound drafts cover catalog and standalone skin edits independently of animation history. In-place runtime catalog installation retains puppet joints, slot mounts, depth, facing, playback and IK; validation reports missing textures and invalid frames. Unit and local browser regressions cover authoring, immutability, export/reload and preserved animation. Package version is `0.5.8-4`.

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
