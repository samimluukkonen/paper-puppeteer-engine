# Mesh production hardening — v1.4.6

[All guides](../README.md#guides) · [Artist quick start](getting-started-mesh-deformation.md) · [Integration audit](mesh-integration.md)

## Overall v1.4 readiness

The implemented v1.4 authoring and runtime paths pass the automated release and targeted local browser gates below. No unresolved data-loss or rendering blocker was identified in those checks. A hands-on artist acceptance session with real production artwork remains outstanding, so this report does not claim completion of that manual gate. Existing rigid characters remain supported without conversion; optional meshes use the same authoring, playback, packaging and recovery owners.

## Architecture and authoring

Constraints remain rig-owned two-bone IK definitions with authored rest transforms and animation channels. The visual mesh editor creates optional whole-image attachments with stable vertex IDs, clockwise indexed triangles, normalized UVs and a versioned bind snapshot. It rejects invalid topology atomically; subdivision retains IDs and interpolates UVs/weights. Skeleton/rest changes are guarded after binding. Meshes and constraint editing introduce no second document/history subsystem.

Weight painting is vertex-based, uses up to four normalized influences, and commits each brush stroke as one history operation. Numeric weights, Normalize and Reset are explicit actions. Selected-bone colors, percentages and influence names remain available in Paint mode. Runtime skinning compiles inverse bind points and blends final FK/IK matrices on the CPU into retained XYUV buffers. Actor placement, global facing, root travel and camera transforms apply outside this calculation.

Correction keys are sparse attachment-local bind-space vertex offsets keyed by stable IDs. They sample deterministically, apply before skinning, and remain independent of base geometry, UVs and weights. New vertices start neutral; missing animated IDs block export and live rig changes until explicitly resolved. Animation Variations retime shape keys; bone mirroring, Pose Library and IK baking preserve them. Graph Editor does not edit shape channels.

## New diagnostics and Feature Guides

**Show mesh diagnostics** defaults off in Rig Editor's Mesh geometry tab and Animation Editor's Mesh Deformation tab. It displays final rendered triangles and vertex handles, warning counts and influence bone IDs. Cyan is ordinary topology, yellow is an edge longer than 3× its authored length and red is collapse (<=1% remaining area), inversion or nonfinite output. The public pure `inspectMeshDeformation(mesh, xyuv)` helper is exported from `/core`; it returns triangle indexes and advisory kinds. It expects schema-validated topology and a matching rendered attachment-local XYUV buffer.

Inspection excludes global facing/camera/Actor placement and never modifies data. Nonuniform posed mount scaling affects local stretch ratios; these hints are not a physical strain or UV-seam solver. No per-frame inspection occurs while disabled. The optional overlay owns a Graphics object and releases it on editor disable, load failure or scene shutdown. Existing editable geometry/weight handles appear only in their respective edit modes; turn those modes off for clean preview.

**Creating a Mesh Attachment** provides five short steps with existing stable anchors. **Painting Bone Weights**, **Animating Mesh Deformation** and **Mesh Characters Across Editors** cover subsequent work. Tours reveal controls without converting, painting, authoring keys, exporting or changing history.

## Cross-editor, export and recovery behavior

Rig, Animation, Environment Preview, Scene Actors, choreography and standalone runtime share the same skinning path. Each Actor owns independent geometry and borrows textures. Slot depth, alpha, visibility, skins and facing retain rigid-sprite behavior. Environment Preview surrounds the existing Puppet rather than creating another evaluator. Onion skins evaluate sampled corrections/FK before IK at the current preview placement; bake IK to inspect solved ghosts.

Rig/animation/character/scene/project serializers retain authored mesh data, never sampled buffers. Project validation includes mesh bone/slot/texture/vertex dependencies and image dimensions. Runtime catalog updates validate registered correction references transactionally. Recovery retains rig geometry, weights, bind snapshots, skins and animation corrections through existing draft owners. Missing artwork can remain a draft warning but blocks production export. Malformed data is rejected before document replacement and does not repair/delete sibling characters or animations.

## Regression matrix

| Area                                                                                  | Automated evidence                                                                                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rig bones/joints, FK/IK, constraints                                                  | `rigEditor*`, `rigBuilding`, `rigIK*`, `ik*` suites                                                                                                |
| Rigid attachments, skins, contacts                                                    | `attachmentManagement`, `slots`, `puppetAttachments`, `footContact*`, shipped demo/sketch animation suites                                         |
| Geometry, bind transforms, weights                                                    | `meshAttachments`, `meshEditing`, `meshSkinning`, `meshWeightPainting`                                                                             |
| Deformation keys, stable IDs, seek determinism                                        | `meshDeformation`, `meshIntegration`, `meshProduction`                                                                                             |
| Timeline, Graph Editor, root motion, mirroring, onion skins, Pose Library, Variations | Existing animation authoring, graph, root-motion, mirroring, ghost sampling, pose and variation suites                                             |
| Scene placement/movement/root travel/camera/backgrounds/transitions                   | Existing scene/Actor/choreography/cinematic suites plus `meshIntegration`                                                                          |
| Workspace validation, packages, recovery, missing assets                              | Existing project, draft, autosave, package and schema suites plus `meshIntegration`                                                                |
| Size and isolation                                                                    | New `meshProduction`: 4/144/1,024 vertices, three independent mixed instances; hair/cape/sleeve attachment isolation; malformed topology rejection |
| Diagnostics                                                                           | New `meshDiagnostics`, `meshDiagnosticsOverlay`; browser mesh editor/animation/runtime checks                                                      |
| Runtime parity and cleanup                                                            | Built `/core` and packed consumer checks; `meshIntegration`, `meshSkinning`, `meshProduction` and native WebGL checks                              |

The flexible-sleeve workflow is covered in parts by local browser `meshEditor`, `animationMeshDeformation`, `meshRuntime`, `meshHandoffGuide`, and the existing project/scene production workflow tests. This is not a claim that a person completed all 27 steps as one continuous session.

## Performance measurements

Local Node 24.22.1 CPU measurements (median of five 200-update batches after 100 warmups; milliseconds per workload update):

| Vertices/triangles per mesh | Instances | Vertex updates | Seek + IK/skinning | Playback + IK/skinning | XYUV payload |
| --------------------------- | --------: | -------------: | -----------------: | ---------------------: | -----------: |
| 4 / 2                       |         1 |         0.0011 |             0.0373 |                 0.0541 |        128 B |
| 4 / 2                       |         8 |         0.0036 |             0.1671 |                 0.4377 |      1,024 B |
| 144 / 242                   |         1 |         0.0450 |             0.1116 |                 0.0712 |      4,608 B |
| 144 / 242                   |         8 |         0.1006 |             0.4774 |                 0.6963 |     36,864 B |
| 1,024 / 1,922               |         1 |         0.0799 |             0.2070 |                 0.2459 |     32,768 B |
| 1,024 / 1,922               |         8 |         0.5771 |             2.3437 |                 1.9317 |    262,144 B |

These CPU-only profiles use affine scene doubles and one mesh plus one rigid slot per Puppet; they do not measure Phaser drawing or full scene reconstruction. Values include JIT/host variation and are not directly comparable across runs.

Local headless Chrome / production-preview measurements (median after dropping five warmup samples; milliseconds):

| Vertices per mesh | Instances | Phaser render submission | Seek + IK/skinning | Playback + IK/skinning | SceneRunner playback |
| ----------------- | --------: | -----------------------: | -----------------: | ---------------------: | -------------------: |
| 4                 |         1 |                      0.3 |                0.2 |                    0.2 |                  0.1 |
| 4                 |         8 |                      1.2 |                0.6 |                    0.7 |                  0.4 |
| 144               |         1 |                      0.2 |                0.2 |                    0.2 |                 0.0* |
| 144               |         8 |                      1.1 |                0.7 |                    1.2 |                  0.4 |
| 1,024             |         1 |                      0.4 |                0.4 |                    0.4 |                  0.2 |
| 1,024             |         8 |                      1.9 |                2.6 |                    2.0 |                  1.6 |

`0.0*` means below the observable timer resolution for that sample, not zero work. Every workload retained its XYUV buffers, released all character GameObjects and kept the shared texture count unchanged after disposal. SceneRunner samples use real owned Actors with looping attack actions. The render samples use actual WebGL drawing; they measure CPU submission rather than GPU completion. Seek/playback samples measure the runtime evaluator, excluding timeline layout/React work. These independent medians are not an end-to-end frame-rate promise. No measured bottleneck required a renderer rewrite or new GPU infrastructure.

Workloads cover 4/144/1,024 vertices with one/eight mixed rigid-and-mesh characters. CPU profiles separate reusable-buffer vertex updates, deterministic seek with IK/skinning, and playback with IK/skinning. Native browser profiles measure Phaser render submission CPU time, seek/playback, retained buffers and resource cleanup. Render submission does not measure GPU completion; XYUV numeric payload estimates exclude JavaScript object overhead, bind caches and textures.

Run the optional profiles sequentially:

```bash
VITE_PROFILE=1 npx vitest run tests/meshProduction.profile.test.ts --maxWorkers=1 --silent=false
VITE_PROFILE=1 PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/meshRuntime.spec.ts --grep 'local mesh CPU' --project=production --workers=1
```

These are local diagnostics with no timing thresholds. No GPU infrastructure or speculative optimization was added.

## Files and APIs changed

- `src/engine/meshDiagnostics.ts`, `core.ts`: pure advisory inspection and typed triangle diagnostics; no format/schema changes.
- `src/devtools/shared/MeshDiagnosticsOverlay.ts`: optional read-only final-pose overlay and resource ownership.
- Rig `RigEditor`, `AttachmentController`, `MeshGeometryPanel`: view-only toggle and lifecycle integration.
- Animation `AnimationEditorScene`, `AnimationEditorState`, `MeshDeformationController`, `MeshDeformationPanel`: view-only toggle, live sampling and lifecycle integration.
- Shared `rigGuides`, `animationGuides`: creation tutorial and diagnostic guidance.
- `scripts/check-core.mjs`: exercise the new diagnostic API through built and packed `/core` in plain Node.
- `tests/browser/localAutosave.spec.ts`: replace a stale artwork disclosure selector with the shared inspector-tab reveal helper.
- `tests/meshDiagnostics*`, `meshProduction*`, `helpers/productionMesh`, browser mesh/editor/guide fixtures: regression and profiling evidence.
- `README.md`, artist guide, this report, changelog and package/lockfile metadata: documentation and release bookkeeping.

## Exact verification results

Verified locally on 2026-10-29 with Node 24.22.1. Test commands ran sequentially with one worker per runner. Browser checks remain local-only; the full browser catalog was not run.

| Check                                                                | Result                                                                                                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check:release`                                              | PASS: formatting, lint, typecheck, version/changelog/lockfile consistency, normal tests, both builds, built `/core` consumer and packed isolated consumer                               |
| Normal Vitest run                                                    | 229 files passed, 8 skipped; **3,970 tests passed, 59 skipped**; 143.67 s                                                                                                               |
| Build and standalone consumers                                       | Authoring app, ES modules/declarations, Node loading/serialization/skinning/seeking/diagnostics/disposal, packed package documentation links, public types and browser isolation passed |
| Mesh/guide browser selection, development + production               | 29 passed, 2 optional-profile skips, 1 guide interrupted by a development-server reload; that guide passed in the stable-source rerun                                                   |
| Stable-source guide/diagnostics/sketch/scene selection, both builds  | 8 passed; the two recovery cases exposed an obsolete disclosure selector in the test                                                                                                    |
| Recovery with corrected selector, fresh browser process, both builds | **2 passed**, including artwork/rig/animation/scene recovery and exact project export/import                                                                                            |
| Unique authoring/compatibility browser cases                         | **36 passed** across development and production after the documented reruns                                                                                                             |
| Optional Node mesh CPU profile                                       | **6 workloads passed** with a dedicated 30 s diagnostic timeout and no timing thresholds                                                                                                |
| Optional native WebGL profile, production                            | **1 test passed**, covering six workloads with stable buffers and complete character resource cleanup                                                                                   |

The default bundled Chromium executable was absent, so local browser runs used installed Chrome with `PLAYWRIGHT_CHANNEL=chrome`. Local servers required sandbox escalation to bind localhost. Initial fixture failures were corrected before the passing release run. The broad guide run was interrupted when a source edit triggered Vite reload; its stable-source rerun passed. Recovery initially timed out because the test clicked a removed disclosure summary; the shared tab helper fixed it, and both fresh-process cases passed. No application workaround or recovery-data change was needed. Builds retain the existing non-fatal Lucide `use client` bundler notices.

Commands for the browser evidence:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/meshEditor.spec.ts tests/browser/animationMeshDeformation.spec.ts tests/browser/meshRuntime.spec.ts tests/browser/meshHandoffGuide.spec.ts tests/browser/rigGuides.spec.ts --workers=1
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/rigGuides.spec.ts tests/browser/characterSelection.spec.ts tests/browser/sceneEditor.spec.ts tests/browser/localAutosave.spec.ts tests/browser/animationMeshDeformation.spec.ts --grep 'existing=true|sketch loads all parts|two-character encounter|refresh recovers artwork|posed mesh diagnostics' --workers=1
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/localAutosave.spec.ts --grep 'refresh recovers artwork' --workers=1
```

The optional profile commands appear above. All static checks were also repeated after the final browser fixture and report edits.

## Actual manual verification

No hands-on artist session has been performed. I inspected the automatically captured desktop sleeve-correction screenshot: the shared header, correction controls and textured bent sleeve were visible. This visual review is separate from the automated canvas assertions and does not establish manual completion of the 27-step production scenario. Long hair/cape/clothing tests exercise authored geometry and isolation; they do not establish visual quality for real production artwork.

## Known limitations and v1.5 priorities

Deferred features: cloth simulation, soft-body physics, mesh collision, automatic weight generation, advanced mesh retargeting, multi-resolution meshes, GPU-only optimization and complex shape-key libraries. Whole-image WebGL meshes are supported; atlases and Canvas meshes are unavailable. Linear blend skinning can collapse extreme bends. Rest-transform changes require deliberate recreation/rebinding; no general-purpose visual rebind tool is introduced here.

Recommended v1.5 priorities are a real artist acceptance pass using project artwork, an explicit visual rebind workflow preserving stable IDs, and further workload profiling on the intended machines. Add richer correction authoring or optimization only when those sessions identify a concrete need. Keep browser smoke checks local and dependency audits manual or push/PR triggered.
