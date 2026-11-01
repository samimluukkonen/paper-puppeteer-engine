# Reusable animation and scene assets — v1.5.6

[Artist walkthrough](reusing-animations-and-scenes.md) · [Release reports](release-notes.md)

## 1. Readiness verdict

v1.5 is ready for the verified reusable-asset workflows within its explicit FK-only, root-motion and mesh policies. The full unit suite, scoped desktop browser scenarios, typecheck, lint, application/library builds and isolated packed consumer checks pass after correcting two stale browser fixtures. Production artwork and motion quality still require artist acceptance; no manual visual verification or complete 764-scenario browser run is claimed.

## 2. Animation Library

The existing library derives rows from character-owned animation documents. Search, compatibility filtering, detached preview, source navigation and independent variations retain that ownership. Shared variants use the owner's rig identity. Copy naming now indexes occupied IDs once instead of repeatedly scanning the library; it still selects the first free suffix. No additional asset registry or document owner was introduced.

## 3. Rig mapping and compatibility

Mappings retain explicit character identities, effective rig revisions, root correspondence, unique targets and direct-parent constraints. Partial mappings warn about omitted tracks; stale or invalid mappings cannot preview. Existing tests cover rest transforms, hierarchies, proportion changes, ambiguity and saved-map round trips. The combined regression saves a reviewed map after appearance authoring and preserves it across recovery/export/import.

## 4. Retargeting mathematics and limits

The existing pure `retargetAnimation` service transfers absolute local FK keys relative to source/target rest transforms: rotation adds the target/source rest offset, translation scales the rest-relative delta under the chosen policy, and animated scale multiplies the target/source rest scale ratio. Sparse channels, duration, looping, curves, angular interpolation and events retain existing evaluator semantics. Hierarchical composition happens in the target runtime. It does not solve identical world trajectories or rotate translations into different parent axes. See [exact policies](animation-retargeting.md).

## 5. Visual workflow

Project Workspace's **Retarget to Another Character** workflow selects source/target and an approved map, reports diagnostics, and compares two ordinary Puppets with one clock. Ground/foot overlays are diagnostics. **Create Animation** registers an independent target clip; ordinary target corrections use existing Undo/Redo. Local browser coverage includes mapping repair, policy invalidation, preview cancellation, real canvas changes, target editing and recovery/export. Reopening captures later source edits; an open session intentionally uses its captured source.

## 6. Character variants and templates

Shared variants retain one rig/animation owner and independent appearance metadata. Independent copies and **New from Template** own copied documents. Existing regressions cover inherited skin mappings, skin-reference protection, image dimensions, mesh weights, multiple appearances and portable materialization. The combined workflow creates another skin, shares it with a variant, and uses that variant in the destination scene without changing the source animation.

## 7. Choreography and scene templates

Existing capture/insertion preserves relative timing, explicit origins, distinct Actor roles, camera keys, fades, audio, dialogue and JSON cues. It rejects missing dependencies and ownership conflicts. Copies receive fresh local IDs with look targets, speakers and voice links remapped together. Shared asset references remain shared. Templates and source scenes retain independent snapshots. Focused **Reusable Choreography** and **Scene Templates** guides reuse actual `sceneReuse` and `scenePlayback` targets; the combined tour remains available.

## 8. Mesh, IK, root motion and seeking

Four runtime transfer cases now explicitly cover identical mesh bindings, different topology with reused vertex IDs, rigid-to-mesh and mesh-to-rigid. Corrections transfer only with matching entire effective rig revisions and complete identity correspondence. Target skinning continues moving finite vertices under retargeted FK. Source/target inputs remain unchanged.

FK-only transfer omits source IK keys and suppresses target IK. Bake source IK first when evaluated source motion is needed. Root displacement stays separate from skeletal/pelvis keys and retains explicit preserve/scale/omit policy. Root-motion actions and scene moves cannot own translation simultaneously. Facing remains external; changed rest reflections are rejected. Event payloads are opaque and require caller review.

The new combined regression loads a standalone expanded scene, unlocks an injected audio backend, samples forward/backward/repeated times and compares Actor poses, positions, foot contacts and camera state. Passive seeking delivers no animation events, cues or audio voices. Ordinary playback reaches the same state and delivers its scene cue and audio exactly once.

## 9. Persistence and runtime handoff

The combined regression carries the new corrected clip, saved map, variant, choreography, template, original image bytes and audio reference through `buildProjectDraft` recovery, project ZIP encode/decode and import. Dependency removal is blocked. It then builds and validates a standalone scene package and runs it with ordinary `SceneRunner`/`Actor`/`Puppet`, without an editor asset resolver.

The packed consumer check additionally reloads serialized retargeted data into the installed `/core` `AnimationPlayer`, verifies sampled FK/root displacement and passive/eventful playback behavior in plain Node. Project ZIPs remain editor archives; standalone scene packages expand reusable data and materialize variant characters. Downloads do not overwrite imported source files. Existing browser regressions exercise actual IndexedDB persistence/recovery.

## 10. Performance findings

Local CPU observations on 1 November 2026; diagnostics have no timing thresholds. Run the profile separately from other suites:

```bash
VITE_PROFILE=1 npx vitest run tests/reusableAssets.profile.test.ts --maxWorkers=1 --reporter=verbose
```

| Workload                                               | Observed milliseconds |
| ------------------------------------------------------ | --------------------: |
| Filter 10,000 derived library rows, 20 times           |                 39.43 |
| Find a copy name among 10,000 occupied suffixes        |                  8.62 |
| Retarget 2,001 keys to four proportion variants        |                141.63 |
| Switch between two animation documents 100 times       |              1,390.79 |
| Eight 144-vertex mesh Actors, 20 seeks                 |                237.31 |
| Insert ten eight-Actor choreographies                  |                 22.03 |
| Export/import two mesh characters and a 2,001-key clip |                133.92 |

The library workload uses synthetic derived rows, not a 10,000-animation project archive. Mesh/scene timings use affine renderer doubles and exclude DOM, GPU, texture loading and normal frame pacing. Four rig variants have independently rebuilt valid bind snapshots. They are performance fixtures, not artistic retargeting acceptance. Animation switching measures two retained documents, not repeated renderer creation.

A separate five-sample Node comparison of 10,000 colliding variation IDs measured 2,012–2,110 ms before and 5.6–9.8 ms after the Set lookup change. This measured quadratic naming path was optimized; other workloads retain the established architecture. Timings are observations on this host, not guarantees or CI budgets.

## 11. Files and APIs changed

- `src/devtools/shared/animationLibraryData.ts`: internal `independentAnimationName` implementation; signature and naming behavior unchanged.
- `src/devtools/shared/guides/sceneGuides.ts`: focused guides and shared ownership/seeking explanations; no wizard rebuild or new view/header.
- `tests/reusableAssetsIntegration.test.ts`: complete cross-workflow/runtime regression.
- `tests/animationRetargetWorkflow.test.ts`, `tests/animationLibrary.test.ts`, `tests/sceneGuides.test.ts`, `tests/browser/sceneReuse.spec.ts`: mesh matrix, naming, guide and local UI coverage. `tests/browser/animationRetargeting.spec.ts` reopens the collapsed library after navigation; `tests/browser/projectWorkspace.spec.ts` checks rejected missing-animation authoring atomically instead of expecting an invalid reference to be accepted.
- `tests/reusableAssets.profile.test.ts`: opt-in local CPU workloads.
- `scripts/check-core.mjs`, `scripts/check-package.mjs`: installed retargeted evaluator and packaged artist guide checks.
- Artist/Feature Guide/profiling/release documentation, changelog, package and lockfile: version 1.5.6.

Public runtime APIs and authored format versions are unchanged.

## 12. Automated regressions

The full unit suite covers Rig Editor bones/joints, IK, geometry/weights, skins, foot markers and shared dependencies; Animation Editor keys, graph curves, root motion, IK, mirroring, poses, variations, retargeting and corrective keys; Scene Editor Actors, choreography, camera/cuts/fades, audio/dialogue and deterministic seeking; Project Workspace references, validation, drafts and import/export. New tests join these existing regressions instead of duplicating their implementations.

## 13. Actual manual verification

No human/manual visual or listening verification was performed. Local Playwright tests are automated desktop UI/canvas checks. The combined sword-cut fixture uses a small synthetic FK/IK/mesh rig and a hidden-slot alternate skin, not production samurai artwork. Review a real sword-cut/bow/reaction shot, feet, silhouette, alternate artwork and audio in the artist workflow before declaring artistic production acceptance. No mobile verification or browser CI changes are included.

## 14. Documentation

[Reusing Animations and Scenes](reusing-animations-and-scenes.md) explains the actual UI, ownership decisions, rig compatibility, bone mapping, transfer policies, mesh/IK/root limitations, variants, presets/templates, recovery, portable handoff and troubleshooting. Existing detailed [Animation Library](animation-library.md), [retargeting](animation-retargeting.md), [variants](character-variants.md) and [reusable scenes](reusable-scenes.md) guides remain the deeper references.

## 15. Exact command results

| Command                                  | Result                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                          | Passed: formatting, lint and typecheck                                                                              |
| `npm run typecheck`                      | Passed                                                                                                              |
| `npm test`                               | Passed: 247 files passed, 9 skipped; 4,279 tests passed, 60 skipped                                                 |
| `npm run build`                          | Passed: application, library, declarations and extended Node consumer assertions                                    |
| `npm run check:version`                  | Passed: 1.5.6 package, lockfile and changelog agree                                                                 |
| Scoped Playwright command below          | Initial run: 32 passed, 3 failed, 3 skipped; two stale fixture assumptions corrected                                |
| Corrected-files Playwright command below | Passed: 10 tests across development and production                                                                  |
| `npm run test:package`                   | Passed: isolated package install, docs/links, Node APIs, public declarations, runtime example and browser isolation |
| Profile command in section 10            | Passed: one opt-in workload                                                                                         |

The scoped desktop command was:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationLibrary.spec.ts tests/browser/animationLibraryGuide.spec.ts tests/browser/animationRetargeting.spec.ts tests/browser/characterVariants.spec.ts tests/browser/sceneReuse.spec.ts tests/browser/projectWorkspace.spec.ts tests/browser/localAutosave.spec.ts --workers=1
```

After correcting the library disclosure assumption and the invalid-dependency fixture, both affected files were rerun:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationRetargeting.spec.ts tests/browser/projectWorkspace.spec.ts --workers=1
```

Together these cover 35 passing desktop scenarios with three intentional production skips for direct Vite-source IndexedDB harnesses. No failure remains in those scenarios. Both new guides passed in development and production. The first sandboxed browser launch failed to bind localhost with `EPERM`; the local-server/browser retry succeeded. An initial unfiltered 764-scenario run was stopped after eight passes (one scenario interrupted, 755 not run) to scope browser verification to the changed workflows. The full browser catalog was not completed; broader regression coverage comes from the full unit suite. All runners used one worker and ran sequentially.

## 16. Known limitations

There is no automatic foot locking, physics correction, anatomical inference, arbitrary hierarchy conversion, mapped IK target transfer or cross-bind vertex remapping. Source IK requires baking; rest orientation/proportion differences require target corrections. Reusable choreography does not silently retarget clips. Partial camera/audio/dialogue items outside the capture interval are excluded; crossing voice dependencies require a larger selection. Scene copies share underlying assets until those assets are copied. Standalone reuse libraries require a separate JSON download. Retained scene runtimes need reopening after shared asset changes. Backward seeking may reconstruct Actors, so cost grows with preceding actions and rig/mesh complexity.

## 17. Recommended v1.6 priorities

1. Validate real production shots and add regressions from observed artist failures, especially contact, rest orientation and alternate artwork.
2. Improve actionable revision/ownership feedback for shared edits and stale mappings within the existing workflows.
3. Profile representative long films before optimizing seeking/checkpoints or larger asset browsing. Use measured workloads to choose improvements.

These priorities preserve the linear cinematic scope; they do not add gameplay, branching, live inheritance or collaboration.
