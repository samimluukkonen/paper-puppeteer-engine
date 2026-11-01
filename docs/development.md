# Development, architecture, and package usage

[All guides](../README.md#guides)

## Checks and profiling

Use Node.js **24.22.1 or newer**. [.nvmrc](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/.nvmrc) pins **24.22.1** for `nvm use` and CI. The repository enables `engine-strict` so npm dependency installs reject unsupported Node versions.

Run test commands sequentially with one worker per runner. Do not run suites concurrently or increase worker counts: parallel test execution causes substantial slowdown on this host. Vitest enforces one worker and disables file parallelism in its shared configuration, including `npm test`, watch mode and CI. Keep Playwright at one worker; for direct invocations, use `npx playwright test --workers=1` and `npx vitest run --maxWorkers=1`. Revisit this preference only if the user explicitly changes it.

```bash
npm run typecheck
npm test
npm run check
npm run audit
npm run build
npm run preview
npm run test:package
npm run check:release
```

`check` runs Oxfmt formatting validation, Oxlint linting (including type-aware TypeScript rules), and TypeScript 7's authoritative `tsc --noEmit` check. `npm run check:fix` applies Oxlint's safe fixes, formats with Oxfmt, and checks types. `build` verifies TypeScript and produces **both** the authoring application in `dist/demo` and the reusable ES module plus declarations in `dist/library`. `preview` serves the production authoring application. The existing `build:demo` command and `dist/demo` directory name are retained for build/deployment compatibility. Vitest tests cover rig validation, animation, pure IK math, coordinate adapters, lengths, mix, and pose restoration without requiring a browser; `npm run test:watch` runs them interactively.

`audit` checks all locked dependencies, including development tooling, and fails on advisories of any severity. CI runs it for pull requests and pushes to `master`. A separate workflow can be triggered manually; it audits the lockfile without installing packages or running dependency lifecycle scripts.

`check:release` runs formatting, lint, typecheck, version validation, all normal unit regressions, both builds and the packed consumer checks in sequence. It does not replace the local browser, performance and human acceptance gates in the [release-readiness report](release-readiness.md). The [v1.0.5 report](personal-production-readiness.md) covers the complete project workflow, recovery and standalone scene handoff. Run optional profiles separately from browser tests to avoid competing workloads. Browser checks stay local-only; dependency audit scheduling is unchanged.

### Local browser checks

Browser smoke tests are local-only by project policy. Keep them out of CI and do not propose adding them to CI in improvement reviews unless the user explicitly changes this preference. Run the suite locally against the real rig editor, Phaser canvas, and shipped character assets:

```bash
npx playwright install chromium
npm run test:browser
```

The command builds the authoring application, then runs every scenario against both the Vite development server and the production preview under `/paper-puppeteer-engine/`. Tests cover animation playback, global Home navigation, shortcut typing/modifier/IME guards, repeated animation switching, scrub interruption, facing, skins, IK controls, navigation between authoring views, dragging outside the canvas, inspector focus and per-field undo, exported/original/imported rig reloads plus a page reload, animation replacement confirmations and source revert, and smooth/stepped canvas round trips with facing and fixed-target IK. Character package scenarios also export replacement binaries and rig edits, reload/import ZIPs through CharacterLoader and Puppet, switch runtime skins/facing and repeatedly dispose previews. They verify artwork changes through canvas screenshots and catch browser exceptions and failed local asset requests. To use an installed Chrome (including on macOS versions unsupported by bundled Chromium), run `PLAYWRIGHT_CHANNEL=chrome npm run test:browser`. Failure traces are saved under `test-results/`.

See the [profiling guide](profiling.md) for optional CPU and browser profiles, workload descriptions, and historical measurements. Profiles are local diagnostics and have no timing thresholds.

The [v0.8 Actor/choreography report](release-notes-v0.8.md) records historical production-scene gates and measurements. The former standalone examples application and its optional packed-browser command have been removed. Browser checks for the editor remain local-only.

## Tooling

Use `npm run format` / `npm run format:check` for formatting, and `npm run lint` / `npm run lint:fix` for linting. Oxfmt's root `.oxfmtrc.json` keeps two-space indentation, single quotes in JavaScript/TypeScript, double quotes in CSS, semicolons, trailing commas, 120-column lines, and sorted imports. Side-effect imports retain their order; embedded code snippets and package fields are not reorganized. Oxfmt covers TypeScript, JavaScript, JSON/JSONC, CSS, HTML, Markdown, and YAML. Dependency/build/coverage/browser-test outputs, caches, temporary directories, and the npm lockfile are excluded. `plans/` holds historical and in-progress design notes and is excluded from formatting to avoid rewriting those records.

Oxlint's root `.oxlintrc.json` uses JSON so it works across the project's supported Node versions. `options.typeAware: true` activates the installed `oxlint-tsgolint` backend with TypeScript 7; experimental compiler diagnostics (`typeCheck`) are deliberately omitted. Correctness rules are errors, with explicit checks for floating/misused promises, awaiting non-promises, array `for-in` loops, unnecessary assertions, unsafe arguments/assignments/calls/member access/returns, type-only imports, duplicate/self imports, and unsafe promise patterns. Non-null assertions remain allowed. React hooks and JSX accessibility checks apply to the `.tsx` view components. React owns the workspace UI; Phaser owns canvas rendering and the animation loop.

Unsafe-value and unbound-method rules are errors throughout application code, tests, and scripts; the migration's transitional warning overrides have been removed. Mock callbacks use explicit signatures, dynamic values are narrowed or validated before use, and deliberately invalid fixtures remain `unknown`. Package scripts validate manifest fields with Zod, and browser fixtures validate shipped data before applying their intentional mutations. Narrow, explained inline exceptions preserve Phaser's explicit listener contexts, deliberately borrowed test methods, listener snapshots, aggregate-error contents, arbitrary validation diagnostics, and intentionally invalid test inputs. Unused exceptions are errors. `eslint/preserve-caught-error` and React hook dependency checks remain warning-level rules, with no current findings. Suspicious rules are selected individually rather than enabling noisy assertion/style restrictions across the engine.

Install the recommended `oxc.oxc-vscode` extension for format-on-save and explicit safe fixes on save. Existing character JSON schema associations are retained, and the editor inherits type-aware linting from the root config.

Direct dependency versions are pinned in [package.json](../package.json), and `package-lock.json` locks the resolved dependency graph. React is a development dependency used by the bundled editor applications; it does not become a dependency of the engine package.

The [dependency review](dependency-review.md) records the latest package update, upstream release sources and project-specific compatibility and feature decisions. Import Lucide components from the public `lucide-react/icons/<kebab-case-name>` exports to avoid processing the entire icon catalog.

## Architecture

The [v1.4.1 rig constraints and deformation audit](rig-constraints-and-deformation.md) records current bone identities, effective rest transforms, affine coordinates, FK/IK evaluation order, authoring/history ownership and non-invasive extension points for optional mesh attachments. The [v1.4.3.1 mesh runtime](mesh-attachments.md) extends Rig Editor vertex/topology authoring and native Phaser Mesh2D rendering with validated bone influences and CPU skinning from final FK/IK matrices.

The optional rig [foot contact marker foundation](foot-contact-markers.md) stores bone-local reference points and evaluates them through final local joint transforms and the full Puppet/Actor world affine. Creation and evaluation are renderer independent, and markers remain separate from IK and attachment ground contacts.

The [v0.9.8.3 ground integration](foot-contact-ground-integration.md) reuses these final positions for signed Animation Editor diagnostics, detached contact IK proposals and selected-marker Scene Actor grounding. The [v0.9.8.4 hardening report](foot-contact-readiness.md) records coordinate/reference audits, artist workflow automation, contact guides and lifecycle checks. Previews are view state; only explicit Apply or Snap commands enter animation/scene history. Scene playback/scrubbing projects runtime contacts without consulting the guide for motion.

The [v0.6.2 schema and compatibility guide](schema-compatibility.md) inventories the version-1 authored formats, validation boundaries, deterministic serialization, existing migration behavior and historical fixture coverage.

See the [v0.6.1 runtime API and architecture audit](runtime-api.md) for dependency directions, public/internal/editor contracts, entry points, lifecycle ownership and the minimal consumer example. The package root and `/runtime` share the browser API; `/core`, `/data` and `/serialization` remain renderer independent. The scene character loader lives in the engine, with its old application path retained as a re-export.

The authoring views use React 19.3.1 with TypeScript JSX and Vite's JSX transform. `ui/viewShell.tsx` shares navigation and character identity, and `ui/workspace.css` shares the compact header, command bar, canvas/inspector layout, and narrow-screen drawer styling. `ui/mountView.tsx` initializes Phaser and the editing controllers in a layout effect after React commits their hosts; unmounting releases controllers, observers, and the game before React removes the DOM.

The [Scene Editor](scene-editor.md), [first-scene walkthrough](making-your-first-scene.md), and [v0.9 readiness report](scene-editor-readiness.md) cover an independent React route at `/scene-editor/`. `SceneEditorDocument` owns per-scene immutable snapshots, saved checkpoints, actor commands and bounded gesture history. Its Phaser stage reuses `CharacterLoader`, `loadSceneCharacter`, `Actor` and `Puppet` for independent character instances, visual placement and initial appearance. Definitions/artwork are cached for the page lifetime; runtime instances are released on removal and scene switches. The engine's version-2 scene schemas, validation and serialization remain renderer independent. The action timeline reuses Animation Editor ruler/coordinate/snapping utilities, adds collapsed action properties and validated grouped history, and preserves separate scene and animation data models. Scene transfers preflight character dependencies before installing working copies or downloading canonical JSON/ZIPs. Pure scene package APIs rebase shared assets into the existing character package layout; an optional runtime `SceneLoader` loads JSON or ZIPs without editor dependencies. A separate `SceneRunner` adapts declarations to Actor/Puppet operations with one Phaser delta clock. `SceneEditorPlayback` owns view-only controls and playhead state; same-position and forward seeks reuse valid isolated runtime contexts, suppress gameplay events/cues, and never write document history. Backward or invalidated seeks reconstruct from initial data. The stage retains authored-placement previews separately, and a collapsed runtime inspector exposes selected-time transforms.

The shared [ground reference foundation](ground-reference.md) keeps optional guide settings in browser metadata per character manifest URL or scene ID. Both Phaser editors reuse the world-space overlay, collapsed controls, label dragging and independent guide history. Animation Editor adds optional temporary IK target-Y snapping and an explicit target alignment command. Scene Editor provides feet alignment through scene Undo/Redo and opt-in placement snapping with Shift bypass, using authored sole points on active foot attachments. Preview-world and scene-world coordinates remain distinct, and guide changes never enter authored snapshots, authored history or texture exports. Only explicit editing commands author IK keys or Actor initial transforms; runtime movement never consults the guide. The [v0.9.7 integration report](ground-reference-readiness.md) records the coordinate audit, two ground tutorials, regression coverage and acceptance limits.

The [v0.6.3 shared character workspace](react-editor-workflow-verification.md) mounts both editor views around one scene and one owner per document domain. Header editor-tab navigation retains live rig, skin, image and clip sessions. Independent browser tabs still own independent sessions. The [v1.0.4 unified workflow](unified-editor-workflow.md) documents project identity, independent checkpoints, keyboard behavior and project guide access.

`AnimationEditorRootMotion` owns root selection, displacement preferences and provisional XY drags. `AnimationEditorGraphGestures` owns detached graph curve edits. Both depend on narrow read-only context and action interfaces; `AnimationEditorState` coordinates preview precedence, cross-tool cancellation, selection and batched notifications through the existing document install boundary. Temporary previews never enter exports or history before commit.

`RigStructureCommands` builds hierarchy edits and checks bone/slot dependencies. `RigArtworkCommands` validates attachment and skin edits and skin exports. Both install proposals through `RigEditorState`, which retains the shared snapshot/history boundary, validation, recovery, saved baselines and preview selection.

`SceneCameraCommands`, `SceneArtworkCommands` and `SceneTransitionCommands` build the scene editor's camera-key/cut, artwork/layer and transition proposals. They install changes through `SceneEditorDocument.replaceScene()`; the document retains snapshot, validation, selection and Undo/Redo ownership. `SceneEditorGestures` owns the typed active drag and its originating history operation, and `SceneEditorNotifications` owns authored, selection and presentation revisions with subscriptions for each domain. The existing document methods delegate to these command modules, preserving the view/runtime API and notification order.

`SceneSnapshotParser` owns new edit branches and shares previously validated immutable collections, entries and nested data with history and saved checkpoints. Schema caches are weak and specific to each schema position; mutable and shallow-frozen caller data is always checked and copied. Semantic checks reuse successful results by domain dependencies, including scene duration, Actor references and current character/image/audio catalog values. Actor placement edits retain action validation, while reference or catalog changes invalidate it. Export-size accounting reuses shared immutable branches and still checks every proposal against the complete formatted JSON limit. Public scene parsing and serialization retain full validation and detached output.

The authoring application build emits separate Phaser and React vendor chunks. Changes to application modules retain the vendor chunk hashes, so browsers can reuse cached runtimes across application releases. The library build continues to leave Phaser external for the consuming application to supply.

The engine stays independent of React. Engine and animation editor subscriber notifications use stable listener snapshots and report failures after remaining listeners run; runtime disposal still stops delivery. Rig and animation state, history, import/export, and the existing controller-managed inspector/timeline regions remain in their current modules. Those regions are stable hosts in React components; keep their child content under one owner when migrating additional controls. Layout preferences never enter authored JSON.

The [Feature Guide](feature-guide-architecture.md) adds a frontend-only typed registry, session controller, stable editor anchors, and one DOM/panel/canvas rectangle contract. Both editors share a React selection modal with registry categories, live prerequisite reasons and guarded first-step launch. The [Rig Editor catalog](rig-editor-guides.md) covers twelve implemented tasks with 68 steps. The [Animation Editor catalog](animation-editor-guides.md) covers twenty-six implemented authoring workflows. Guides are short, feature-specific units; a shared modal spotlight and positioned step cards provide Explain tours and optional real-control practice with safe reveal, restart/catalog navigation, prerequisite links, focus restoration, and missing-target fallback. The short [artist guide](feature-guide.md) describes the workflow. Guide state and UI-only reveal preparation stay separate from authored documents, history, and playback.

```text
src/engine/
  CharacterDefinition.ts  Manifest assembly and cross-file validation (no I/O)
  CharacterLoader.ts      Fetches manifest, rig, skins, animations, and poses as JSON
  Pose.ts             Static pose validation, blending, and sparse serialization
  queueCharacterTextures.ts  Queues image files with Phaser's scene loader
  mergeSkins.ts         Shared embedded/standalone skin precedence
  types.ts             JSON-friendly rig and transform definitions
  schemas.ts           Zod schemas for rig, animation and IK definitions
  externalData.ts      Versioned JSON formats, validation and parsing
  Rig.ts               Validation, immutable rig snapshot, indexed definitions, parent-first ordering
  Joint.ts             Renderer-independent bind pose and mutable local pose
  affineMath.ts        Shared joint-to-affine conversion, composition and coordinate inversion
  Bone.ts              Joint backed by a Phaser container and optional image
  AnimationClip.ts      Keyframe types, validation and property-track compilation
  validatedAnimation.ts  Shared immutable animation validation for editor previews and IK authoring queries
  AnimationPlayer.ts    Layer clocks, transitions, events and completion
  AnimationStateController.ts  Named base states and temporary action policy over existing playback
  AnimationLayerEvaluator.ts  Layer sampling, blending, pose buffers and controlled properties
  AnimationPose.ts      Pure clip evaluation and pose blending
  Puppet.ts            Hierarchy, playback API, facing, attachments and lifecycle
  Actor.ts             Optional Puppet facade, instance identity, movement and explicit ownership
  ActorMovement.ts     Delta-driven point-to-point requests and explicitly mapped locomotion
  ChoreographySequence.ts  Optional ordered Actor steps, owned cancellation and update-clock waits
  Choreography.ts       Runtime Actor registry, nested sequential/parallel groups and fail-fast barriers
  PuppetAttachments.ts  Prop wrappers, ancestry checks, detachment and destroy listeners
  PuppetPoseController.ts  Pose overrides, restoration, IK ordering and projection passes
  PuppetDebug.ts       Scene-space joint, pivot and hierarchy overlay
  PuppetRenderer.ts    Independent draw slots with constant-size affine factors
  affineProjection.ts  Two-factor affine decomposition preserving shear and singular scales
  SlotState.ts         Attachment selection and base/partial skin application
  SlotDebug.ts         Scene-space slot position and assignment overlay
  ik/
    types.ts           Targets, constraint definitions and coordinate adapter
    solveTwoBoneIK.ts  Pure law-of-cosines solver and angular blending
    TwoBoneIKConstraint.ts  Chain validation, effective lengths and pose solving
    IKPoseState.ts     Pre-IK rotation restoration between passes
    IKDebug.ts         Independent world-space IK overlay
  index.ts             Public library entry point
  core.ts              Renderer-independent public entry point for Node and asset tooling
  runtime.ts           Explicit public Phaser runtime; index.ts remains its compatibility entry
  data.ts              Type-only shared authored data contracts
  serialization.ts     Versioned validation, parsing and pose serialization
  loadSceneCharacter.ts  Cancellation-aware scene metadata/artwork loading
src/devtools/rig-editor/
  main.tsx             React page bootstrap and lifetime
  editorMarkup.tsx     React workspace shell
  InspectorController.ts  Numeric editing, derived labels, and field undo grouping
  HierarchyController.ts  Cached tree rendering and selection
  ControlsController.ts   Editing, snapping, visibility, and preview controls
  SessionController.ts    Status, validation, history actions, export, reload, and import
  RigWorkspaceController.ts  Rig view controllers over the shared AnimationEditorScene document
  RigEditor.ts         Editor activation and working-rig preview synchronization
  RigEditorInputController.ts  Dragging, keyboard commands, and input listener lifecycle
  RigEditorState.ts    Working rig, validation, bounded history, and serialization
  rigDraftRecovery.ts  Pure legacy/current draft parsing, compatibility and direction validation
src/devtools/animation-editor/
  main.tsx             React animation editor and Phaser lifetime
  AnimationEditorScene.ts  Sample/custom character loading and preview lifecycle
  AnimationEditorState.ts  Authored edit coordination, transform drafts and atomic session notifications
  AnimationEditorDeformationCommands.ts  Provisional mesh corrections, shape keys, compatibility and clipboard commands
  AnimationEditorPreviewCommands.ts  Detached trajectory, cleanup, variation and pose comparison lifetimes
  AnimationEditorSelectionCommands.ts  Selection, navigation and gesture/playback coordination
  AnimationEditorKeyframeCommands.ts  Keyframe transactions, session clipboard, duplication, drag preview and nudges
  keyframeQueries.ts   Authored-property presence, indexed key lookup and adjacent navigation
  keyframeEdits.ts     Immutable single/batch edits, group movement and collision replacement
  keyframeMirroring.ts  Authored current-pose/selected-key mirror proposals using runtime sampling and batch edits
  keyframeRetiming.ts  Pure typed bone/IK proportional retiming and atomic candidate validation
  KeyframeRetimingPanel.tsx  React numerical before/after preview, scale and anchor controls
  KeyframeRetimingController.ts  Cached transient proposals and session/selection invalidation
  keyframeTargets.ts   Shared time tolerance, row matching and target validation
  animationValues.ts   Cached runtime pose sampling for evaluated transform values
  keyframes.ts         Compatibility exports for the keyframe data APIs
  keyframeClipboard.ts  Immutable authored clipboard groups, relative timing and validated paste
  AnimationEditorDocument.ts  Validated animation snapshots, saved baselines, history and export
  AnimationEditorPlayback.ts  Sole continuous editor clock, preview speed/loop and scrub playback intent
  AnimationEditorPlaybackController.ts  Navigation, scrub/play controls, event preflight and post-preview notifications
  AnimationEditorPlaybackCommands.ts  Validated authored playback mode/FPS edits through document history
  AnimationEditorPreview.ts  Runtime sampling of the working copy and puppet synchronization
  AnimationEditorGhostLayer.ts  Render-only neighboring poses sharing engine artwork and affine projection
  MirrorToolsPanel.tsx  React pair configuration, direction, preview and explicit authored actions
  MirrorToolsController.ts  Cached readiness, editor subscription, rig-bound browser pair preferences
  IKBakePanel.tsx       React constraint selection, FPS, bake summary and preview/commit actions
  IKBakeController.ts   Cached validated plans, detached candidate sampling and editor history command adapter
  onionSkinSettings.ts   Frozen scene-only count, spacing, opacity and tint preferences
  OnionSkinControlsController.ts  Native preference inputs and abortable event listener lifecycle
  TimelineController.ts   Session coordination, responsive ruler, tracks and playhead
  TimelineInputController.ts  Pointer capture, gestures, keyboard navigation and cancellation
  TimelineSessionController.ts  Selection, settings, history and status display
  AnimationFileController.ts  Import/export, export reload/source revert and asynchronous request lifetime
  AnimationDraftRecoveryController.ts  Source-bound drafts, import revisions and recovery subscription lifecycle
  timeline.ts          Shared content-time/pixel conversion, clamping and visible-range ruler generation
  timelineSnapping.ts    Shared zoom-aware frame/key/event/playhead resolver, session preferences and marker targets
  timelineNavigation.ts  Pure view-only zoom, pan, fit, follow and time/frame conversion
  TimelineNavigationController.ts  Native scroll/zoom controls, precise jumps and optional playback follow
src/devtools/shared/
  DraftRecovery.ts      Browser drafts, compatible restoration and retained incompatible JSON
  DraftRecoveryControls.ts  Shared recovery feedback, retained-draft downloads and cleanup
  SnapshotHistory.ts   Bounded snapshot history and operation grouping
  editorGame.ts        Shared Phaser rendering and scaling defaults for editor previews
  editorCamera.ts      Reusable screen-space panning and pointer-anchored camera zoom
  package/characterPackage.ts  Detached package snapshots, metadata/image validation and runtime leases
  package/packageZip.ts  Bounded stored ZIP encoding/decoding with path and CRC checks
  package/PackageController.ts  Independent package checkpoints and asynchronous request ownership
  package/PackagePanel.tsx  Shared package download/import and regular Puppet runtime preview
  editorData.ts        Readonly data and editor number rounding
  boneSymmetry.ts      Pure rig-bound bone pairs, automatic candidates, reciprocal lookup and validation
  poseMirroring.ts     Pure bind-relative authored-pose reflection and structured compatibility errors
src/shared/
  characterCatalog.ts  Character identities and picker labels
  characterPreviewSettings.ts  Optional immutable IK settings shared by editors
  paperDollIK.ts        Default arm/leg chains with explicit execution priorities
  domUpdates.ts        Conditional DOM writes for editor playback notifications
  downloadJson.ts       Browser JSON download and temporary URL cleanup
  loadSceneCharacter.ts  Cancelable metadata and artwork loading for a scene session
public/characters/demo-puppet/  Shipped rig, skins, animations, poses, and artwork
docs/                  Focused user and developer guides
src/main.ts            Home redirect to Project Workspace
```

The engine does not import editor code or sample assets. `Rig`, `Joint`, `AnimationPlayer`, the IK solver, and `TwoBoneIKConstraint` do not depend on Phaser. Bone containers provide the joint hierarchy; each image and its attachments have an independent draw slot with two factors representing their composed ancestor transform. This permits global drawing order while preserving rotation, scaling, and shear. `syncPose()` applies the evaluated pose, executes IK, then synchronizes rendering and debug overlays. Debug overlays allocate their Phaser objects only when first enabled and reuse them across toggles; label-side settings made before enabling debug are retained. The puppet's outer container provides placement, scale, and facing independently of animation tracks. Hosts control their own Phaser renderer settings.

Character identities and picker labels live in `src/shared/characterCatalog.ts`; optional preview IK chains live in `src/shared/characterPreviewSettings.ts`, with the bundled arm/leg definitions in `src/shared/paperDollIK.ts`. Both character editors share immutable preview settings. Characters without registered preview settings receive an empty chain list, allowing characters with arbitrary rigs to load. Register preview settings separately when a character needs IK preview.

The [Reusable Animation Library](animation-library.md) derives rows from existing character animation documents, identifies assets by character and stable clip name, and stores only optional artist labels on version-1 clips. Animation Library selection/copy commands reuse the animation document and variations; Scene Editor keeps its current reference and history model. Detached previews use ordinary Puppets with event suppression and explicit preview root motion.

Character definitions lazily cache compiler-owned immutable clips in `compiledAnimations`. Puppets created from the same definition share those clips while retaining independent clocks, event listeners, pose buffers, and disposal. Supplying `animations` explicitly (including an empty array) overrides the character clips and keeps ordinary runtime validation and snapshot ownership.

Editor validation is cached per deeply frozen animation snapshot and rig. Mutable and shallow-frozen inputs are checked on every use. Key edits from a validated immutable source check metadata and changed tracks; shared tracks and events retain their validation only when the rig and duration are unchanged. Duration changes receive full validation. Deep immutability checks reuse verified frozen branches, and preview compilation and property-key indexes reuse unchanged immutable track arrays across snapshots. Each preview keeps independent pose buffers. Inspector and ghost sampling cache at most eight detached sparse poses per immutable animation snapshot and rig, keyed by runtime-quantized time; this reuses stepped neighbors without changing the continuous editor clock. Ghosts compare evaluated transforms before projecting them, so unchanged paused and stepped frames skip affine projection. A shared appearance revision checks source artwork once per synchronization, including direct host changes to sprites and slot mounts; unchanged artwork skips copying across the pool. Root placement and opacity still follow the active puppet. The six-instance ghost pool releases sample references when entries are hidden and destroys its render objects and subscription on scene shutdown. The public `compileClip` entry point continues to validate all supplied clips.

Root-motion authoring uses `RootMotionController` and `RootMotionPanel` for independent Position X/Y timeline rows and initially collapsed controls. `rootMotionEdits` validates sparse edits; `AnimationEditorState` coordinates provisional XY snapshots through document/history. Existing Graph Editor channels share sampling and curve/tangent editing. `AnimationEditorRootHandle` owns the overlay and gesture lifecycle, and `rootMotionCoordinates` inverts camera/puppet affine transforms. Preview placement applies authored offsets before the ordinary pose/IK synchronization; ground stays fixed and Environment Preview camera synchronization is suspended while root editing is enabled. See [visual root-motion authoring](root-motion-authoring.md).

IK selection, numeric drafts and single-key commands are owned by `AnimationEditorIKCommands`; `ikTimeline.ts` builds rows while `ikInspectorSampling.ts` caches read-only target values through the shared engine `IsolatedIKSampler`. The public [IK bake sampler](ik-bake-sampling.md) uses that same detached solver context for whole-animation bone-local snapshots, without a player, events or editor mutations. [IK bone-key generation](ik-bake-generation.md) consumes those snapshots to produce ordinary rotation-key proposals and measure sample-time fidelity through the existing bone evaluator, without applying authored edits. [Atomic IK bake commit](ik-bake-commit.md) validates proposals against current authored data, replaces only generated properties and serializes clip-local constraint suppression through the existing runtime IK layer evaluator. The editor installs one history snapshot through `AnimationEditorState.commitIKBake`. The state facade groups IK command notifications with the existing playback and document installation boundary. `AnimationEditorIKHandles` owns editor-only crosshairs and pointer gestures; explicit camera/puppet affine conversions produce local drafts which `AnimationEditorPreview` overlays on sampled IK channels. Combined X/Y commitment installs one history snapshot. See [visual IK targets](visual-ik-targets.md) for ownership and lifecycle details.

Successful bake commits also return a detached [runtime motion fidelity report](ik-bake-hardening.md). Two isolated solver contexts compare original/committed local joints and world endpoints at generated keys, midpoints and near/exact end. Key disagreement blocks commit; measured between-key drift warns with actual errors. The React controller caches this report with the candidate, invalidating it on authored/options/session changes while clock updates keep using the cached preview. Reports never enter JSON or runtime player state.

Keyframe commands and gestures are owned by `AnimationEditorKeyframeCommands`; `AnimationEditorState` retains the existing public API and coordinates playback, drafts, snapshot installation, and atomic notifications. `AnimationEditorSelectionCommands` coordinates bone, property, key, event, range, and marquee selection with gesture cancellation and playback navigation. The selection model retains transient values, cached track layout, and selection indexes; snapshot installation and history reconcile selection through the command coordinator. `AnimationEditorEventCommands` owns event edits, JSON payload commits, clipboard commands, and drag/nudge state, using the same document, selection, playback clock, clipboard, and snapping preferences. The session still coordinates cancellation between event and keyframe gestures. Single-property edits, moves, and selected deletion share one error-handling and installation boundary. Batch deletion resolves all references against the original animation, copies each changed track once, and validates one result for one history action. Selection indexes use exact canonical bone/property/time identities while preserving first-occurrence order, primary-key rules, and distinct authored times within the lookup tolerance.

`AnimationEditorPlaybackController` coordinates the shared clock with temporary transforms and runtime event delivery. It checks event crossings before advancing and notifies preview subscribers before event listeners. `AnimationEditorPlaybackCommands` owns authored mode/FPS validation and installs edits through the same document/history boundary. The state facade retains gesture cancellation, atomic notification grouping, and the existing public APIs.

`AnimationEditorDeformationCommands` owns mesh correction gestures, shape-key edits, topology diagnostics and clipboard commands. `AnimationEditorPreviewCommands` owns detached trajectory, cleanup, variation and pose comparisons, reconciling their lifetimes before session subscribers run. Both use the existing document installation and atomic notification callbacks; `AnimationEditorState` retains the public facade, selection and shared clock. Worker IK bake snapshots retain slots and mesh attachments for ordinary deformation-track validation while omitting explicit bone lengths to preserve exact effective joint coordinates.

`TimelineInputController` owns pointer capture, scrubbing, dragging, and marquee geometry. It composes `TimelineKeyboardController`, which routes shortcuts and ruler navigation with typing, modifier, IME, repeat, and clipboard-scope guards. Keyboard cancellation uses the pointer owner's gesture lifecycle, and disposing the input controller releases both sets of listeners.

Timeline playback notifications update time-dependent controls and the playhead. Authored rows, filters, inspectors, file controls, and document status refresh when their document, selection, gesture, or layout dependencies change. Animation IDs are immutable cached lists, so clock updates do not rebuild or serialize the selection options.

Saved baselines retain immutable authored snapshots directly. Rig inspector inputs remain mounted for the selected bone or slot across refreshes, history restores and preview-control changes. Authored values update in place while unchanged focused fields retain unfinished text; selecting another object or replacing the session rebuilds the available fields. Rig export serializes its validated file once; delayed clipboard completion retains the captured working snapshot without parsing JSON or marking later edits saved. Animation import and revert reuse validated frozen source snapshots, and subsequent edits replace changed branches while preserving the source.

Browser draft source identities use versioned SHA-256 digests of canonical authored data, keeping stored fingerprints at 74 characters regardless of document size. Runtime rig indexes and derived render order are excluded; authored array order and event payloads remain significant. Hashing is synchronous and works on HTTP development hosts without `crypto.subtle`. Recovery accepts older raw and canonical JSON fingerprints, then replaces a restored draft only after its compact replacement is durable.

Mirroring production regression coverage and the supported transform contract are documented in [mirroring hardening](mirroring-hardening-verification.md). Local `animationMirroring.spec.ts` scenarios cover repeated animation/character/route lifecycle, mirrored onion-skin refresh and identical authored exports with IK/facing enabled or disabled. `MirrorToolsController.unbind()` releases cached session references after failures; React panel cleanup hides its preview independently of application disposal.

Complete character downloads use the existing version-1 formats; see the [artist package workflow](artist-workflow.md) and [production verification report](production-asset-verification.md). `CharacterDefinition.manifest` owns the original relative resource paths. Both scenes expose detached package snapshot adapters, artwork exports retain immutable blobs, and the animation document queries every session clip without changing selection/history. Package checkpoints are independent of individual JSON export checkpoints; existing per-document navigation semantics stay intact. Navigation also protects pending artwork proposals, while compatible rig reload/import retains applied artwork and confirms before canceling proposals.

Runtime package previews lease temporary image URLs and own an independent Phaser game/texture manager. Metadata passes through `CharacterLoader`; `loadSceneCharacter` accepts an already loaded immutable definition and still yields asynchronously before checking the scene's active flag. Preview shutdown cancels texture loads and destroys puppets; game destruction releases the URL lease. Do not serialize runtime blob URLs or private artwork texture keys into a package.

The [runtime integration guide](runtime-integration.md) documents exported package structure, asset loading, coordinates and scene/texture ownership. `npm run test:package` verifies an isolated packed install, public declarations, runtime samples and browser bundling without an examples application.

## Use as a local package

`new Rig(existingRig)` shares its validated immutable skeleton and indexes. Pass a second skin array to create a rig with independently validated, owned skins: `new Rig(existingRig, skins)`. The rig editor uses this to retain authored skins separately from preview skins, and its working copy stays independent of the shared source skeleton. New JSON imports still receive full rig validation.

Build this repository first, then in another Phaser TypeScript project:

```bash
npm install /absolute/path/to/paper-puppeteer-engine
```

```ts
import { Puppet, type RigDefinition, type AnimationClip } from 'paper-puppeteer-engine';
```

`npm pack` validates the package version with `npm run check:version`, then rebuilds the library through the `prepack` hook before creating a tarball. Package versions use SemVer; milestone 0.5.2.3.1 is represented as `0.5.2-3.1`. Run `npm run test:package` to install that tarball into a temporary consumer and verify Node `/core` imports, public TypeScript APIs, and browser bundling. The check reuses installed dependencies offline and removes its temporary files afterward. CI runs it after the build. Core declarations receive a full type check; browser consumer types use the repository's `skipLibCheck` setting for Phaser declarations.

The library includes TypeScript declarations and source maps. Zod is externalized and supplied through the package dependency, so consumers share its validation runtime and error classes. Phaser is externalized and declared as an exact peer dependency so the consumer provides the same Phaser runtime. No package has been published. Engine rendering APIs are browser-based and should be imported in a browser environment.

The package includes the root Markdown guides and verification notes in `docs/`. Research screenshots, diagrams, and measurement files stay in the repository; the layout report links to those hosted artifacts. `test:package` verifies that the main guides are present, local Markdown links resolve inside the installed package, and research assets are excluded from the installed tarball. Links to repository-only source, tests, configuration, and sample assets use hosted repository URLs.

For Node scripts and asset tooling, import the renderer-independent entry point:

```ts
import { CharacterLoader, validateRigDefinition, Joint, AnimationPlayer, solveTwoBoneIK } from 'paper-puppeteer-engine/core';

const character = await CharacterLoader.load('https://example.com/characters/hero/character.json');
const joints = new Map(character.rig.bones.map(bone => [bone.id, new Joint(bone.id, bone)]));
const player = new AnimationPlayer(character.rig, joints);
```

`/core` exports character loading and validation, rig/slot data, pose and animation APIs, and IK without loading Phaser or requiring browser globals. `CharacterLoader.load` accepts an optional fetch implementation for file system or custom I/O. Every library build checks the built `/core` package in plain Node.

For stateless pose tooling, import `compileClip` and `evaluateClip` from `/core`: `compileClip(clip, rig)` validates and prepares an authored clip, and `evaluateClip(compiled, timeMilliseconds)` returns its sparse interpolated pose. `CompiledClip`, `CompiledTrack`, and `PropertyKeyframe` are also exported types. This evaluator uses raw interpolation; use `AnimationPlayer.sample(time, { mode: 'playback' })` for playback-aware previews.

Compiled clips own immutable metadata, property maps, keyframes, playback settings, and JSON event payloads, so they can be shared between compatible players. `AnimationPlayer` takes an independent snapshot of externally assembled compiled clips. Non-JSON runtime event payloads retain reference semantics; listener notifications receive independent metadata and copies of JSON payloads.

Visual rig constraint and default-target editing is documented in the [Rig IK editor guide](rig-ik-editor.md).

IK authoring production coverage is documented in the [IK workflow](ik-animation-authoring.md). Preview and gizmo disposal are idempotent; disposed gizmos ignore late render/input calls, and solver-scale restrictions use current transforms rather than a held status.

The [v1.4.4 mesh deformation animation guide](mesh-deformation-animation.md) documents sparse shape keys, bind-space authoring, evaluation order, topology diagnostics and animation-tool compatibility.

## Scene seek state and checkpoints

`SceneRunner.seek` treats its current owned Actor set, scene clock and next-boundary index as a live checkpoint. Same-position seeks pause without stepping or replaying actions; repeated paused/completed samples still synchronize camera, transition, dialogue and audio presentation. Forward seeks switch animation players into silent preview mode, resume their clocks, and advance only the remaining interval. Playback/movement IDs, event cursors, held poses and root-motion origins stay attached to the existing render objects. Ownership checks reject reuse after interruption. Reentrant seeks from an Actor update or boundary callback reconstruct because some Actors or equal-time actions may not have been processed yet. Initial stopped placement still needs time-zero actions on its first seek.

The regression in `tests/sceneRunner.test.ts` uses 250 cue boundaries: ten repeated samples produce no Puppet updates or Actor allocations, and seeks from 600 to 601 to 625 ms step only 1, 9, 10 and 5 ms for each Actor. Frame-queue tests cover latest-position delivery, release flushing, immediate pause, transport changes, scene replacement and teardown. Root-motion regressions compare forward/backward samples with playback through loops and movement handoffs. These assertions measure work and equivalence without timing thresholds.

Backward seeks still allocate Actors and replay earlier boundaries. Historical checkpoints need a complete runtime restore API: animation layer clocks and unwrapped loop times, event consumption, held/completed state, movement origins and request identity, facing, root-motion baselines and the scheduler's ownership maps. Saving only transforms/poses would make resumed playback disagree with the seek sample. Retaining full live Actor sets per checkpoint would multiply rendering resources and listeners with scene history, so this change keeps just the current live checkpoint.

A deterministic evaluator that retains one Actor set is a possible next architecture. It would need indexed action-prefix state, including facing evaluated against other Actors at each authored boundary, world/local movement transforms and accumulated root-motion windows. Its sampled state must restore runtime event cursors and lifecycle ownership for seamless resume. Neither the existing skeletal pose sampler nor renderer transforms provide that complete state today. Adding such a restore contract and proving equivalence across backward samples, IK, root motion, ties, cancellation and resume is separate from the current incremental optimization.
