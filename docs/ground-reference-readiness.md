# v0.9.7 ground reference integration report

[Ground reference guide](ground-reference.md) · [Development checks](development.md#checks-and-profiling)

This report covers plan `v0.9.7.4`. Ground rendering, persistence, IK authoring and Actor-origin alignment already existed in `v0.9.7.1–3`; this phase audits those paths, adds two five-step Feature Guide tutorials, adds tooltips and extends integration regressions. No runtime engine, evaluator, physics or authored schema changes are introduced.

## Readiness and acceptance boundary

Implementation and automated regression gates pass, including 38 local browser scenarios across development and production. Browser workflows use real desktop React controls, Phaser canvas and shipped assets, followed by the screenshot review recorded below. Manual artist acceptance remains pending: these checks are not a separate human practice session, and the fifteen-step human workflow in the plan is not claimed as manually completed.

## Animation Editor integration and IK behavior

The collapsed Ground reference section supports visibility, finite numeric Y, label dragging, reset, temporary drag snapping and independent guide Undo/Redo. Empty characters, rigs without IK and clips without keys can use the visual reference. Playback, scrubbing, facing, onion skins and camera zoom do not move the reference in world space.

Explicit **Align IK target Y to guide** calls `AnimationEditorScene.alignSelectedIKTargetToGround()`, converts through the full Puppet container inverse and commits X/Y keys through existing `commitIKTarget()` authoring. It preserves requested world X, bone tracks, events, duration and influence. Root motion is evaluated by the existing pose/IK path. Disabled/baked constraints, fixed-target ownership, missing selections, active guide/IK drags and singular transforms refuse the command. Target placement does not promise solved sole contact: reach, influence and the authored IK end offset still matter.

## Scene Editor integration and Actor behavior

The collapsed Scene ground section shares visibility, numeric Y, reset, dragging and independent guide history. Explicit **Align Actor Origin to Ground** calls `SceneEditorDocument.alignSelectedActorOriginToGround()` and edits only the selected initial position Y. Other Actors, X, actions and movement destinations are retained. Preview mode disables the UI command. Optional **Snap to Ground** constrains origin placement drags; Shift bypasses it. No snapping runs during runtime movement, playback or seeking.

There is no shared rig contact marker. The UI deliberately labels origin alignment instead of guessing a foot, lowest artwork pixel or humanoid bone. Differently sized, scaled, facing, jumping, flying and non-humanoid characters can therefore use the visual line without forced contact placement. Opt-in origin snapping remains an explicit placement choice.

## Coordinate systems

Animation ground Y is fixed **preview-world** Y, default `435`, outside the Puppet container. Scene ground Y is **scene-world** Y, default `0`, outside Actor instances. Camera zoom/pan affects projection only. [The coordinate audit](ground-reference.md#coordinate-ownership) documents the full affine conversions and why neither root Y nor a scalar guide Y can be copied directly between editors. Existing IK projection tests include facing, scale, rotation/shear, offsets, root motion, negative values and singular inverses.

## Persistence and Undo/Redo

`GroundGuideWorkspace` stores only `{ version: 1, guide: { enabled, y, snapEnabled } }` in localStorage, keyed by coordinate domain plus resolved character manifest URL or scene ID. It serializes no Phaser objects, handles, DOM nodes or authored transforms. Switching clips shares character metadata; switching characters/scenes preserves independent entries. Reopening or same-browser re-import restores the matching identity. Failed storage retains session settings and reports a status message.

Guide movement, numeric edits, show/hide, snapping toggles and reset use independent bounded guide history; they never dirty rig, animation or scene documents and do not clear authored Redo. Live drags persist once on release; Escape, focus loss, switching and teardown cancel drafts. Explicit IK commits and Actor alignment use the existing authored histories. Redo restores the authored coordinates from the original command, even after moving the guide.

Animation draft recovery restores clip edits independently of persisted ground preferences. Scene authored drafts are in-memory only. Canonical animation/character/scene JSON and ZIP formats do not carry guide metadata to another browser. Same-browser scene import restores metadata by scene ID; changing manifest URL creates a distinct character guide identity. This preserves the chosen metadata format rather than adding runtime schema fields.

## Feature Guide and controls

`animation-ground-reference` (**Using Ground Reference**) and `scene-ground-reference` (**Aligning Actors to Ground**) each contain five explanation steps using the existing catalog, launcher, spotlight, reveal and cleanup paths. The Animation Editor tutorial needs a valid loaded rig, with no clip or IK prerequisite. The Scene Editor tutorial needs a scene, with no Actor-selection prerequisite. Conditional alignment remains explained through its real disabled control.

Shared controls expose domain-specific visibility/Y/reset anchors; the two panels expose their explicit alignment anchors. Existing preview, Actor-list and playback anchors complete the tours. Tooltips distinguish visual preferences from authored transform changes and identify the guide as having no physics-floor behavior. The wizard does not author data or write metadata when revealing controls.

## Rendering and lifecycle

`GroundGuideOverlay` retains one Graphics and one Text object. Its geometry signature skips drawing when only playback, scrubbing, selection or snapping preferences change. Pan/zoom/resize or a visible line change updates geometry. A 120-frame regression verifies object reuse and redraws only after camera changes. Existing tests cover hidden/offscreen guides, bounded dashed-line work, fixed pixel widths, current camera bounds and idempotent disposal. Editor handle subscriptions and pointer/focus listeners are separately released on teardown.

## Files and APIs changed in this phase

- `src/devtools/shared/guides/animationGuides.ts`, `sceneGuides.ts`, `anchors.ts`: two five-step definitions and eight domain-specific control anchors.
- `src/devtools/shared/GroundGuideControls.tsx`: real-control anchors and visual-reference/reset tooltips; existing styling and collapsed defaults retained.
- `src/devtools/animation-editor/AnimationGroundPanel.tsx`, `src/devtools/scene-editor/SceneGroundPanel.tsx`: explicit alignment anchors and authored-edit tooltips.
- Unit/integration tests: `animationDraftRecoveryController`, `animationGroundGuide`, `sceneGroundGuide`, `groundGuide`, `animationGuides`, `sceneGuides`, `guideRegistry`.
- Local desktop browser tests: `animationGroundGuide.spec.ts`, `animationGuides.spec.ts`, `sceneGuides.spec.ts`.
- Ground usage/readiness, development/catalog documentation and `CHANGELOG.md`.

Public engine APIs and authored serialization formats are unchanged.

## Regression matrix

| Domain           | Coverage and boundary                                                                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rig Editor       | Full unit suite covers joint edits, IK constraints, artwork/attachments, package export and schema compatibility. Local production-authoring workflow covers sprites, rig, skin, artwork replacement and portable ZIP export.                                                                                                       |
| Animation Editor | Full unit suite covers keys, IK targets/baking, playback, scrubbing, mirroring, onion skins and Undo/Redo. Ground browser workflow adds real label drag/cancel, guide history, zoom/facing, clip switching, explicit target alignment, export/re-import and reload. Catalog browser traversal checks both existing and empty clips. |
| Scene Editor     | Unit ground tests cover empty/multiple Actors, scaled/facing/offset origins, movement/seeks, authored/history isolation, import and cleanup. Local browser ground and editor workflows cover positioning, clips, movement, playback, scrubbing, exports and scene switching.                                                        |
| Runtime          | Full unit suite covers Puppet/Actor movement, SceneRunner and choreography; plain-Node built-entry checks cover loading, validation, asynchronous animation, IK and disposal. Local demo and scene-playback scenarios exercise real Phaser runtime behavior. Guides remain editor-only.                                             |

Existing skipped tests retain their reported skip status; passing checks do not imply those tests executed.

## Automated command results

| Command                                                                                                                                                                                                                                                                                                 | Result                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                                                                                                                                                     | Exit 0; strict TypeScript passed, also within `build` and `check`.                                                                                    |
| `npm run test`                                                                                                                                                                                                                                                                                          | Exit 0; 187 files passed, 5 skipped; 3,259 tests passed, 56 skipped (192 files / 3,315 tests total).                                                  |
| `npm run build`                                                                                                                                                                                                                                                                                         | Exit 0; demo, library, declarations and plain-Node entry-point checks passed. Existing nonblocking `lucide-react` module-level `use client` warnings. |
| `npm run check`                                                                                                                                                                                                                                                                                         | Exit 0; formatting, lint and strict typecheck passed after correcting documentation formatting and a test spy's unsafe inferred value.                |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGroundGuide.spec.ts tests/browser/groundGuide.spec.ts tests/browser/animationGuides.spec.ts tests/browser/sceneGuides.spec.ts tests/browser/releaseWorkflow.spec.ts tests/browser/sceneEditor.spec.ts tests/browser/demo.spec.ts` | Exit 0; 38 desktop scenarios passed across development and production in 9.9 minutes.                                                                 |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGuides.spec.ts tests/browser/sceneGuides.spec.ts --project=production --grep 'existing=true\|scene catalog' --output=test-results/ground-final`                                                                                   | Exit 0; 2 production rechecks passed in 1.4 minutes, including unchanged guide localStorage and screenshots of every ground tutorial step.            |
| `git diff --check`                                                                                                                                                                                                                                                                                      | Exit 0.                                                                                                                                               |

The initial sandboxed Playwright attempt exited 1 because Vite could not bind `127.0.0.1:4173` (`EPERM`). The browser run uses approved local server access. No browser setup or test execution was added to CI.

## Actual manual verification

Agent visual inspection performed:

- `animation-ground-reference-contact.png`, development, 1440 × 1000: reviewed the contact tutorial card, the highlighted actual preview, leg/IK artwork and the expanded Ground reference section. The card leaves the preview unobscured; the tour leaves the unchecked guide unchanged.
- `scene-ground-alignment.png`, development, 1600 × 1400: reviewed the amber dashed line and draggable label, numeric Y `125`, both differently sized characters, movement/animation clips and the origin-fallback explanation. Both feet remain below the origin guide, consistent with the documented fallback.

- `animation-ground-reference-enable.png` and `animation-ground-reference-align.png`, final production run, 1440 × 1000: reviewed spotlight placement on the actual checkbox and disabled alignment button, legible instructions and clear separation between guide preferences and authored keys.
- `scene-ground-reference-position.png` and `scene-ground-reference-snap.png`, final production run, 1600 × 1400: reviewed numeric-input and origin-alignment highlights, card placement beside the inspector, negative-coordinate guidance and the missing-contact-marker explanation.

These are screenshot inspections, not manual interaction through the fifteen-step workflow. Automated workflows perform enable/drag/numeric edits, IK key alignment with Undo/Redo and export/re-import, two-character scene origin alignment with Undo/Redo, playback/scrubbing and same-browser reload persistence. No human artist practice session or cross-browser/device acceptance is claimed. Desktop views only; browser checks remain local-only.

## Remaining limitations

- Ground preferences stay in the same browser origin and identity; they are excluded from portable authored JSON/ZIPs.
- Actor alignment targets the explicitly labelled origin. Reliable automatic sole alignment is unavailable without a contact marker.
- Requested IK targets can differ from solved contact because of reach, influence and end offsets.
- Camera support remains the editors' existing unrotated, uniformly zoomed camera contract.
- No physics floor, gravity, collisions, terrain, footsteps, contact solver or new evaluator is added.
- A separate human artist run of the plan's fifteen-step workflow remains outstanding.
