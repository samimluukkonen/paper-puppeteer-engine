# Changelog

Versions use package SemVer; for example, milestone `0.5.2.8.3` is packaged as `0.5.2-8.3`.

## Unreleased

- Require PNG-header checks before decoding character artwork by default; trusted alternative formats can opt out with `requirePng: false`.

- Publish completed Animation Editor commands in one state notification.
- Share pending import and export guards between the editors.
- Group overlapping collapsed timeline summaries by pixel position and add `npm run profile:timeline` for local browser measurements.
- Share responsive inspector behavior across the demo and both editors.

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
