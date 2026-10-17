# Feature Guide v0.7.6.6 implementation and verification

## Architecture and editor boundary

The wizard remains frontend-only: immutable `GuideRegistry` definitions, a session-only `GuideController`, guarded `GuideLauncher`, capability facts from `workspaceGuideHost`, and `GuideTargets` for DOM/panel/provider geometry. No guide module is imported by `src/engine`; engine entry points and authored schemas are unchanged. Milestone `0.7.6.6` is packaged as SemVer `0.7.6-6`; the manifest, lockfile, standalone tarball reference and changelog agree. The demo and editor headers read that package version.

Both editors share one Feature Guide catalog. Its Rig Editor and Animation Editor categories show registry descriptions, live availability reasons, disabled launch buttons for unmet prerequisites, and related prerequisite guide links. Launch rechecks context and existing navigation guards. Restart returns to step zero; Choose another guide exits to the catalog without refreshing.

`GuideSpotlight` uses a body portal, native modal Explain mode, a CSS shadow cutout and a measured card. Existing rectangle polling, scroll/resize/visual viewport listeners and card ResizeObserver follow changing targets. Missing targets remove the cutout and retain recovery/navigation controls. Reduced motion disables positional transitions.

## Interactive practice

A discriminated `GuideInteraction` configuration declares Explain or Try It, the practice target, instructions, whether it changes the real project, practice-only prerequisites and optional completion facts. Supported steps always start as explanations; the artist explicitly chooses Try It.

Practice currently supports:

- Selecting a real bone in Create Your First Keyframe. Completion observes `AnimationEditorState.selectedBoneId`.
- Setting the selected bone’s current X value at the playhead through the existing X key button. Completion observes authoritative key presence at that bone/property/time; it does not claim that a generic click created a key.
- Enabling Onion Skinning through its existing checkbox/controller. Completion observes the scene’s actual setting.

Completion never advances automatically. Normal Next/Skip remains optional. Project-change notices appear before key practice; the normal inspector command handles validation, dirty state and one Undo/Redo history entry. The guide does not construct demo data, apply keys itself, mutate rig definitions, replace artwork, bake IK, mirror, delete, or export data.

`guideInteraction.ts` opens access to the real target and guide card only. It preserves preexisting inert branches, makes unrelated branches inert, captures unrelated input, contains Tab/Shift+Tab across target and card, exits on Escape, and stops global editing shortcuts. Control-local native keyboard behavior and existing handlers remain in charge. A child-list observer re-resolves replaced targets. Real element identity survives temporary hiding while visibility is checked before allowing input; this prevents a hidden target from becoming permanently trapped by guide-owned inertness. Geometry providers can optionally expose their existing input element; geometry alone grants no input access. Shipped canvas steps remain Explain mode.

## Catalog review and prerequisites

The existing catalogs retain nine Rig Editor tasks (44 steps): new character, bones, joint positions, artwork import, sprite alignment, slots/attachments, skins, IK constraints, and rig/package export. They remain explanations, including all canvas and destructive/structural actions.

The thirteen Animation Editor tasks (60 steps) cover new clip, first key, bone animation, timeline navigation, key editing, interpolation, onion skinning, mirroring, IK targets, IK baking, events, Rig Tweak and animation export. Only the three practice steps above enable input. No guide assumes a specific character, bone or constraint ID.

Prerequisites include loaded character, valid rig, selected clip, authored bone keys, authored IK keys, authored IK constraints, selected IK target, and artwork. Key practice additionally requires a selected bone. Related guides are offered for character creation, animation creation, first keyframes, artwork import and IK setup. Some prerequisites still require exiting an explanation and performing the task normally; no guide silently fixes data.

Local catalog browser regressions walk the actual current anchors and verify descriptions/geometry, disclosure reveal, missing-target behavior, guarded launch, unchanged authored exports/history, and existing Undo/Redo. The catalogs accurately describe current Linear-only interpolation, separate smooth/stepped sampling, pre-IK ghosts/mirroring, and explicit bake/mirror commit limitations.

## Lifecycle and changed APIs

Each practice activation owns one containment observer and its input/focus listeners. Explain transitions, navigation, restart, exit and React unmount release these resources and guide-owned inert attributes. Existing step observation and card measurement retain their own cleanup. Focus restoration runs after containment cleanup. Scene-owned geometry registrations remain independently disposable. There are no new Phaser objects, editor mutation handlers or runtime dependencies.

Principal changes:

- `guides/types.ts`, `registry.ts`, `index.ts`: typed interaction/prerequisite contracts and practice-target validation.
- `GuideController.restart()`, `GuideLauncher.getPrerequisiteGuide()`: non-destructive restart and catalog recovery.
- `GuideTargetResolver.resolveElement()` / `GuideGeometryProvider.getElement()`: real target identity separate from visible geometry.
- `workspaceGuideHost`: selected-bone, selected-X-key and onion-enabled facts.
- `BoneInspectorController`: a stable X-key anchor, with the existing command unchanged.
- `OnionSkinControlsController` and workspace `main.tsx`: guide-fact refresh after the normal preference action.
- `FeatureGuide.tsx`, `GuideSpotlight.tsx`, `guideInteraction.ts`, `guideSpotlight.css`: practice, recovery, navigation and scoped input lifetime.

## Automated verification

`guidePractice.test.ts` covers authoritative completion, no automatic advancement, intentional key edits, normal history/Undo/Redo, lost prerequisites, non-destructive restart and prerequisite lookup. `guideTargets.test.ts` adds real identity, hidden/replaced target and geometry-only access cases. `guideSpotlightLifecycle.test.ts` exercises React Explain/Try It effect teardown and focus restoration. Existing controller/registry, rig/animation state, target observation and positioning regressions remain in the normal suite.

Local `guidePractice.spec.ts` exercises real pointer/keyboard selection and key commitment, protected unrelated controls, editor shortcut blocking, focus, Undo/Redo after exit, onion preferences, hidden/replaced targets, desktop resize, repeated Explain/practice/restart/catalog/exit, and unrestricted input after cleanup. Existing Feature Guide, Rig Guide and Animation Guide browser suites exercise catalog-wide geometry and non-destructive navigation.

Final command results:

After correcting package metadata to `0.7.6-6`, `npm run check:version`, `npm run check`, `npm run build` and `npm run test:package` were rerun and passed. The version check confirms agreement between the manifest, both lockfile version fields, the standalone tarball dependency and the changelog.

| Command                     | Result                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`         | Passed; also passed within `check` and `build`.                                                                                          |
| `npm run check`             | Passed formatting, Oxlint and strict TypeScript checks.                                                                                  |
| `npm run test`              | Passed: 167 files, 2,834 tests; 4 files / 44 tests skipped by the existing suite.                                                        |
| `npm run build`             | Passed demo, library, declarations and Node entry-point checks. Vite emitted two non-fatal lucide-react `use client` directive warnings. |
| `npm run test:package`      | Passed isolated package documentation/link checks, public declarations, Node imports, standalone tests and build.                        |
| Local browser command below | Passed: 56 scenarios across development and production in 22.8 minutes.                                                                  |
| `git diff --check`          | Passed.                                                                                                                                  |

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/guidePractice.spec.ts \
  tests/browser/featureGuide.spec.ts \
  tests/browser/rigGuides.spec.ts \
  tests/browser/animationGuides.spec.ts \
  tests/browser/animationBoneAuthoring.spec.ts \
  tests/browser/animationClipboard.spec.ts \
  --timeout=120000
```

The browser command used the installed Chrome, the repository’s single worker and a longer local timeout; repository timeout/CI settings were not changed. Full 450-scenario browser attempts were stopped after default 30-second deadlines expired in existing authoring scenarios. Those timed-out authoring/clipboard cases passed in the focused run above. The remaining browser scenarios were not verified in this milestone; the full Vitest engine/editor regressions and packed consumer checks passed.

## Manual verification and limitations

A generated first-keyframe inspector screenshot was visually inspected for readable text, visible navigation and non-overlapping placement. No human manual browser acceptance or screen-reader session was performed. Browser behavior described as exercised refers to the local Playwright automation, not a manual session.

Practice is deliberately limited to the three supported steps. Canvas editing, structural rig actions, modal forms, mirroring and baking remain explanations. Success reports current state, including when the state was already satisfied. No automatic advancement or local completed-guide persistence is implemented. Only desktop views are in scope. Browser checks remain local-only; no CI browser installation, smoke tests or scheduled dependency audits were added.

## Documentation

[Using Feature Guide](feature-guide.md) explains opening the catalog, categories, spotlight meanings, Explain/Try It, Back/Next/Finish/Exit, restart, prerequisite recovery and real-project edits. The [architecture](feature-guide-architecture.md), [Animation Editor catalog](animation-editor-guides.md), development overview, README and changelog reflect the finished behavior.
