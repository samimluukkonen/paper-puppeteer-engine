# v1.0.5 — Personal production readiness

[Artist workflow](artist-workflow.md) · [Project Workspace](project-workspace.md) · [Developer integration](runtime-integration.md) · [Recovery](local-autosave.md)

## Verdict and scope

**Automated hardening gates passed; human artist acceptance pending.** The supported character-to-scene workflow, recovery, production export/import and independent runtime checks passed. No open data-loss or normal-export corruption blocker was found in the exercised paths. This report records an internal v1.0.5 milestone, not a public release or unconditional artist acceptance. No npm publication, tag, GitHub release, deployment, accounts or analytics are part of this milestone.

Verification: 2026-10-23, macOS x86_64, Node 24.19.0, installed headless Chrome, desktop only. The implementation milestone is v1.0.5; the package manifest and standalone consumer target 1.0.5. Authored character/rig/skin/animation/project formats stay version 1, scenes version 2. Earlier reports retain their historical evidence and are not substitutes for this pass.

## Release criteria and regression matrix

| Gate             | Required behavior                                                                                                                                     | Automated evidence                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects         | Create/open empty projects, register new and existing characters/scenes, switch retained owners, independent dirty/history state                      | `projectWorkspace`, `editorWorkflow`, local `projectWorkspace` and `personalProductionWorkflow`                                                                      |
| Rig              | Create hierarchy, position joints, import/replace artwork, origins, slots/default skin, author/edit IK, Undo/Redo                                     | `rigBuilding`, `rigIKEditor`, `attachmentManagement`, `rigArtworkAlignment`, local rig/production workflows                                                          |
| Animation        | Create clips, edit bone/IK keys, interpolation, timeline tools, mirroring, onions, IK bake, history and export                                        | Full normal Vitest animation/IK suites; local production, rig IK and release workflows                                                                               |
| Scenes           | Actor placement, movement/animation timing, preview/scrub, scene import/export and independent history                                                | `sceneEditorDocument`, `sceneTimeline`, `sceneRunner`, `sceneLoader`; local scene/production workflows                                                               |
| Recovery         | Refresh at rig/artwork/keys/scene checkpoints; retain binary artwork and previous valid revisions after interruption, corruption or quota failure     | `localAutosave`, local `localAutosave` and four-checkpoint `personalProductionWorkflow`                                                                              |
| Asset integrity  | Block missing images, duplicate IDs, deleted referenced clips, broken IK, missing characters, bad versions and unsafe paths                           | Seven-case matrix calls **both** `buildProjectPackage` and `buildProjectScenePackage`; `projectInspection`, package/format suites                                    |
| Round trip       | Preserve rig/joints/IK, skins/attachments, all clip keys/events, image bytes, scene Actors/timing/references through complete project ZIPs            | `projectWorkspace`, `characterPackage`, `schemaCompatibility`, continuous local workflow semantic comparison                                                         |
| Runtime          | Public packed imports, CharacterLoader/Puppet/IK/events, Actor movement/choreography, exact exported scene playback and disposal without editor/React | `runtimeBoundaries`, `characterRuntimeIntegration`, `ikAnimationRuntime`, `actor`, `choreographyProduction`, `sceneLoader`; packed consumer and local opt-in handoff |
| Lifecycle        | Release owners, subscriptions, pending playback, GameObjects, textures and URLs after switches/seek/replacement/shutdown/unmount                      | Normal controller/scene/loader lifecycle suites; local repeated package previews/scene load; real-Phaser profile cleanup assertions                                  |
| Tooling/docs     | Formatting, lint, types, tests, builds, standalone checks and practical artist/developer instructions                                                 | Command results below; packed documentation link check                                                                                                               |
| Human acceptance | Artist checks real transparent art, pivots, IK and animation quality, exported scene and recovery on their desktop                                    | **Not performed; acceptance pending**                                                                                                                                |

## Fixes and architecture

`LocalAutosave.dispose()` used to release only once. `LocalDraftStore.save()` hashes artwork before acquiring its Web Lock/IndexedDB transaction, so a save already hashing could acquire ownership **after** disposal released it. Autosave now releases again after in-flight I/O settles during disposal as well as suspension, skips late source reads/notifications, and refuses to restart a disposed owner. Deferred-hash tests assert another owner is no longer blocked; teardown during package reads performs no save, delivers no late notifications and leaves no timers.

Project metadata/registration remains in `ProjectWorkspace`; retained shared character sessions own `RigEditorState`, `AnimationEditorDocument`, skins and applied artwork. `SceneEditorDocument` owns scene snapshots/history. Package capture detaches every authored domain synchronously before binary reads. Autosave writes complete portable project files with real Blobs and SHA-256 digests in one IndexedDB transaction; two revisions per key and ten keys remain the existing limits. Export checkpoints and per-document histories stay independent of local persistence.

The runtime dependency direction remains engine → renderer-independent data/math, with Phaser adapters for rendering and asset loading. `CharacterLoader` loads metadata, `loadSceneCharacter` loads Phaser artwork, `Puppet` owns animation/IK, `Actor` owns movement/facing, and `Choreography`/`SceneRunner` coordinate playback. Public entry points do not import React or editor modules. Runtime scene ZIPs and complete editor project ZIPs have different manifests; the guides now explain the correct handoff.

The Project page now uses the same `ViewHeader` as the demo and all three editors, with a shared Feature Guide button and catalog. The Project catalog includes asset selection and launches the selected tour in its retained editor only after live prerequisite checks. Standalone-only character-creation controls are explicitly unavailable in project editors, with directions to Project Workspace instead. A compact local-save row places Recovery drafts and a Draft actions menu on the right, with retry/resume and discard inside the menu. Recovery/save controls appear below headers; empty recovery controls are hidden and update after persistence/focus. A 480 px GitHub-style recovery dialog uses shared title/body/footer spacing and a single grouped saved-draft summary. Named import buttons replace redundant native file-picker rows. Character libraries use collapsed categories with counts, individual readable asset rows, animation/skin details and contained image previews. Preview URLs exist only while their image category is open. Project settings use consistent form spacing, and create/add/remove actions use the shared semantic colors. The [GitHub/Primer style guide](style-guide.md) is linked from `AGENTS.md`. Local desktop regressions compare all five headers, active navigation/version, empty/populated/discarded recovery states, dialog sizing and action spacing; screenshots were visually inspected.

Accepting recovery from a standalone editor now carries a consumed-once same-tab intent to Project Workspace and restores the selected revision without a second confirmation. Normal fresh startup still offers recovery; invalid data or live ownership conflicts remain visible and preserve stored drafts. Version checks additionally cover the standalone lockfile, and the package, both lockfiles and installation examples are synchronized to **1.0.5**. Packaged recovery-guide links now use repository URLs for editor/test files omitted from the runtime package.

## Recovery and validation findings

The continuous browser workflow refreshes while editing the project rig, after importing/assigning artwork, after authoring bone and IK keys, and during scene editing. Each checkpoint waits for **Local draft saved**, explicitly restores the draft, and checks the recovered authored state. Exported image bytes are compared with the exact imported PNG.

Recovery storage tests abort real IndexedDB transactions, inject quota failure, corrupt envelopes/versions/timestamps and test live-tab ownership. A new UI test damages the newest snapshot's Blob while retaining its original digest, verifies recovery rejects it, then selects and exports the previous valid project through the real recovery dialog. Invalid/corrupt snapshots are retained for explicit selection/discard; failed writes do not delete either valid revision. Unload before a successful save can still lose the debounce/in-flight edits, and clearing browser site data clears drafts. Export ZIPs for durable disk copies.

The seven production-export mutations reject through both project and scoped scene APIs, leave metadata checkpoints/history and working scene identity intact, and verify the prior exported archive remains independently importable. Existing lower-level validators retain authority over image decoding, budgets, path collisions and references. Empty/partly authored drafts remain supported where valid; no automatic repair or invented capabilities were introduced.

## Artist workflow and round trip

The new local `personalProductionWorkflow` follows existing controls: New Project → New Character → bones/joints → PNG library import → slot/attachment/default skin/origin → IK creation → New Animation → bone keys → moving IK target → Undo/Redo/playback → character ZIP → register existing character → New Scene → Actor → concurrent movement/animation → cue → preview/scrub → scene package → project ZIP → Import Project.

It compares re-exported/re-imported metadata, rigs (including joints/IK/attachments), skins, animations/keyframes, exact image bytes, scene Actors, action times and asset references. Archive byte identity is not required. Existing tests separately cover events, multiple scenes/skins/clips, both shipped characters, inactive sessions and independent histories. No absent UI capability is simulated as if an artist had used it.

The exact generated scene ZIP is retained at `test-results/personalProductionWorkflow-*/production.scene.zip`. `PPE_PRODUCTION_SCENE_ZIP` opts the standalone test into loading that artifact three times, seeking with silent cues, observing canvas motion, running choreography to completion with one cue per run, and removing its canvas on disposal. The standalone imports only the independently packed runtime. Character animation events, direct IK and pending-playback cleanup also have dedicated runtime/standalone coverage.

## Performance baseline

Measurements are local diagnostics, not timing gates, FPS promises or heap/GPU certification. Run profiles sequentially without test workloads. `profile:project` measures five distinct 16-bone characters sharing shipped PNG artwork, an extra 256-key clip per character, three five-Actor scenes, 80 archive entries and a 246,972-byte ZIP. It includes binary hashing/IndexedDB persistence and validates authored equivalence after opening/recovery. `profile:scene` measures real Phaser two/five-Actor playback and seeking; `profile:timeline -- --workflow` measures dense authoring and artwork decoding.

All three profiles completed sequentially on 2026-10-23 against local Vite development servers, after the browser suite stopped. No timing thresholds were applied.

| Project operation                                      | Three observations (ms) | Median (ms) |
| ------------------------------------------------------ | ----------------------- | ----------: |
| Complete project ZIP export                            | 344.0, 339.6, 341.2     |       341.2 |
| ZIP decode/import                                      | 301.6, 291.8, 288.9     |       291.8 |
| Package construction + binary hashing + IndexedDB save | 346.1, 326.7, 330.3     |       330.3 |
| Digest-checked recovery/import                         | 308.5, 322.3, 468.9     |       322.3 |

The first workspace shell opened in **1,316.2 ms**. Shipped character metadata loaded in **41.1 ms**, and fetching/packaging its artwork took **79.3 ms**; the latter excludes texture decoding. The autosave measurement excludes the normal debounce delay.

| Real Phaser scene workload      | 60 explicit updates, total ms | Five seek observations (ms)    |
| ------------------------------- | ----------------------------: | ------------------------------ |
| 2 Actors, 4 actions             |                          89.2 | 7.0, 5.7, 5.1, 4.7, 5.2        |
| 5 Actors, 10 actions            |                         142.0 | 8.9, 8.6, 9.2, 6.9, 7.6        |
| 5 Actors, 10 actions + 500 cues |                         200.6 | 178.8, 86.3, 163.4, 5.9, 164.0 |

Each Actor used a 16-bone character with two authored IK constraints. Every workload passed Actor disposal, empty GameObject list, unchanged shutdown-listener and source-data assertions. Explicit update totals measure CPU/UI work, not rendered FPS.

The dense editor used **32 bones, 12,288 bone-property keys, 768 IK-property keys and 128 events**, with three fresh-page samples. Medians: expand root properties **27.0 ms**, select 64 keys **154.5 ms**, filter **278.4 ms**, zoom **52.2 ms**, ruler-key scrubbing **3.3 ms** (90 observations, range 2.5–9.3), and pointer-to-next-frame **10.0 ms** (33 observations, range 4.4–27.0). Headless RAF intervals had medians **20.6 ms** normally and **21.3 ms** with onions; authored track mutations were **zero** in all playback samples. These intervals are browser observations, not display/GPU certification.

Skin switching had a **11.7 ms** median (nine observations, 10.8–64.4). Validating/decoding a generated 256 × 256 PNG and displaying its replacement proposal took **63.0, 65.0 and 70.0 ms**; actual preview/apply completion took **142.4, 133.8 and 142.1 ms**. The existing profile initially selected the newer Import new artwork input instead of Import sprite. It now selects the labelled replacement control in the visible inspector and waits for real policy/preview/apply completion. This corrects the diagnostic, without changing artwork behavior.

Dense filtering and five-Actor seeking with 500 cues show noticeable latency in these synthetic workloads. They are recorded as non-blocking performance limits and useful v1.1 investigation targets; no speculative runtime optimization was added.

## Resource cleanup findings and limits

Deferred I/O ownership after autosave teardown is the verified lifecycle defect fixed here. Existing deterministic tests cover repeated characters/Puppets, clip/scene switches, subscriber release, pending waits/abort, source replacement, seek reconstruction, package URL/texture leases and React/controller teardown. The standalone exact-artifact test repeatedly reloads the same authored scene; the real-Phaser profile checks created/disposed Actor counts, empty GameObject lists and unchanged shutdown-listener baselines after each workload.

These checks detect owned-resource regressions in the exercised paths. They do not establish zero retained process heap, GPU allocation or browser-driver leaks over an unlimited session. No speculative optimization was made.

## Files and APIs changed

- Production behavior: `src/devtools/shared/autosave/LocalAutosave.ts` (`start`, `flush`, `dispose`); no public runtime or authored format changes.
- Regressions: `tests/localAutosave.test.ts`, `tests/projectInspection.test.ts`, local `tests/browser/localAutosave.spec.ts`, new `personalProductionWorkflow.spec.ts` and `projectStyle.spec.ts`, guide capability coverage, corrected visual/foot-contact browser harnesses, and standalone `test/scene.spec.ts` with the optional exact artifact environment variable.
- Diagnostics: new `projectProfileHarness.ts`, `profile-project-workflow.mjs`, `profile:project` script and existing profile launcher integration and corrected dense-editor replacement-control targeting/completion checks.
- Shared UI: `ViewHeader`, `FeatureGuideCatalog`, the Project guide bridge, `ProjectAssetLibrary`, Project view/styles, Rig/Animation header slots, recovery controls/store notifications and shared dialog CSS. Guide capability facts prevent standalone-only creation tours inside project editors.
- Versioning: root/standalone manifests and lockfiles, `check-version.mjs`, tarball installation examples.
- Documentation: this report, GitHub/Primer style guide and `AGENTS.md` link, project/artist/first-character/artwork guides, runtime integration, recovery, profiling, development, README, historical report forward link and Changelog **1.0.5**.

## Commands and actual verification

| Command                                                            | Result                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                    | Passed formatting, lint and strict TypeScript.                                                                                                                                                                                          |
| `npm run test`                                                     | **194 files passed, 5 skipped; 3,400 tests passed, 56 skipped**; 29.92 s.                                                                                                                                                               |
| `npm run build`                                                    | Passed demo/library builds, declarations and Node/core boundaries. Existing lucide-react directive warnings remain non-blocking.                                                                                                        |
| Local desktop Playwright matrix below                              | 70 cases: 65 passed, 1 intentional production skip, 4 harness failures; 19.3 min. Corrected cases passed in the focused rerun below, giving **69 unique passing cases** across both environments.                                       |
| Focused Playwright rerun below                                     | **6 passed**, development and production; 1.8 min.                                                                                                                                                                                      |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:project`                | Passed; three real package/persistence samples and authored equivalence.                                                                                                                                                                |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:scene`                  | Passed; three real-Phaser workloads and cleanup assertions.                                                                                                                                                                             |
| `PLAYWRIGHT_CHANNEL=chrome npm run profile:timeline -- --workflow` | Passed after correcting the diagnostic's replacement-input selector and completion waits; three dense-editor samples.                                                                                                                   |
| Packed standalone consumer + exact production scene                | Passed: 3 Node tests, declarations/import boundaries and standalone test/build; **6 browser tests passed, 2 optional older-artifact cases skipped** (1.0 min). Exact current scene passed three load/seek/play/dispose cycles (29.8 s). |

```bash
PLAYWRIGHT_CHANNEL=chrome ./node_modules/.bin/playwright test \
  tests/browser/projectStyle.spec.ts \
  tests/browser/personalProductionWorkflow.spec.ts \
  tests/browser/localAutosave.spec.ts \
  tests/browser/projectWorkspace.spec.ts \
  tests/browser/rigBuilding.spec.ts \
  tests/browser/rigIKEditor.spec.ts \
  tests/browser/releaseWorkflow.spec.ts \
  tests/browser/animationProductionWorkflow.spec.ts \
  tests/browser/sceneEditor.spec.ts \
  tests/browser/sceneTransfer.spec.ts \
  tests/browser/editorWorkflow.spec.ts \
  tests/browser/characterPackage.spec.ts \
  tests/browser/footContactProductionWorkflow.spec.ts

PLAYWRIGHT_CHANNEL=chrome ./node_modules/.bin/playwright test \
  tests/browser/animationProductionWorkflow.spec.ts \
  tests/browser/footContactProductionWorkflow.spec.ts \
  --grep 'rendered poses|artist contact workflow'

PPE_PACKAGE_BROWSER=1 \
PPE_PRODUCTION_SCENE_ZIP=/tmp/ppe-105-production.scene.zip \
PLAYWRIGHT_CHANNEL=chrome npm run test:package
```

The two development screenshot failures came from three rounded-panel corner pixels differing by one color level; decoded character pixels matched. Pose comparisons now exclude only the panel's corner clipping and retain exact image equality. The other two failures attempted to edit a separate Scene workspace behind its startup recovery prompt. That workflow now explicitly cancels recovery, keeping the saved character draft, before importing its exported assets. All six affected/rechecked cases passed. The direct source-module IndexedDB harness intentionally skips production; the real production recovery workflows passed.

Automated browser work is not human manual acceptance. The assistant inspected desktop screenshots of the shared catalog, compact draft bar/recovery dialog, contained thumbnails and padded settings. No human manual authoring or artist visual-quality acceptance session is claimed. Current local copies of the production ZIPs and reviewed screenshots are in `test-results/v1.0.5-production-artifacts/`; rerunning the continuous workflow regenerates its own output artifacts.

## Known issues and v1.1 priorities

**Blocking defects:** no open data corruption/loss or normal production-export blocker was found in the exercised paths. Automated gates passed. Human artist acceptance is pending, so this report does not declare unconditional v1.0 readiness.

**Non-blocking usability/operational limits:** local save/export/document checkpoint labels have different meanings; downloads cannot prove a disk file was retained. Recovery restarts editing history, keeps only two complete revisions per key and can require an older revision after corruption. Browser storage quota/clearing and unsaved debounce windows remain explicit limits. Atlas/animated images and arbitrary third-party ZIP encodings are unsupported. Dense filtering and seeks through 500-cue scenes have the measured latency above. Package, lockfiles, standalone tarball references and the changelog use 1.0.5.

**Deferred features:** physics/ragdolls, mesh deformation, automatic rigging/artwork, advanced retargeting, generalized image editing and distribution/account infrastructure. None is required by the supported personal workflow.

Recommended v1.1 work: first complete artist acceptance using real project artwork; profile the measured dense-filter and 500-cue seek latency before changing their implementation; fix measured usability problems from that session; investigate any repeatable long-session memory/resource growth using retained-heap/GPU tools; expand workload-specific performance evidence only where production projects expose a problem. Keep browser tests local and dependency audits manual or push/PR triggered.
