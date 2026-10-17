# Feature Guide architecture

[Development guide](development.md#architecture)

The v0.7.6.1 foundation lives in `src/devtools/shared/guides/`. Guides teach individual features, such as Editing Joint Positions or Timeline Navigation. They remain short and independent; there is no application-wide tutorial, persisted completion tracking, database, or telemetry.

The v0.7.6.1 milestone provides the model, registry, targeting contract, and session controller. v0.7.6.2 adds the React feature selection modal and guarded editor navigation described below. The reusable React spotlight, instructional cards, and complete tutorial content belong to later v0.7.6 milestones.

## Feature selection and launch

The shared character workspace header exposes **Feature Guide** in both editors, including before character loading succeeds. `ui/FeatureGuide.tsx` owns one native modal outside the retained editor shells. Rig Editor and Animation Editor category buttons work with Tab and Enter/Space; native dialog behavior contains focus and closes on Escape. Closing restores focus to the opening button, or to the destination editor's Feature Guide button after a cross-editor launch. Inspector sections remain collapsed.

Feature titles, descriptions and rows come directly from `GuideRegistry`; the modal does not maintain a second catalog. Unavailable entries retain visible prerequisite reasons and disabled Start buttons. Empty categories and failed character loads have explicit messages. An active session is identified by title with an Exit guide action before another guide can start; step instruction cards remain deferred.

`workspaceGuideHost.ts` reads current rig validation, selected animation, authored IK constraints and UI tool availability into capability facts. State subscriptions, rig inspector changes and load failures refresh these facts. Guides that teach resource creation can omit the resource prerequisite. Optional IK/tool prerequisites use the same registry checks as the initial guides.

`GuideLauncher` revalidates live context and first-step prerequisites on every launch, asks the existing `WorkspaceNavigation` binding to navigate, refreshes context again, and starts the existing controller at step zero. The modal closes only after success; failures show an accessible message. Programmatic navigation and header links share mode switching and URL/history bookkeeping, including deployment bases and character query parameters. Committed rig/animation/artwork edits retain their live owners and histories. Mode changes that would discard uncommitted animation previews are unavailable for guide launch, without offering a discard confirmation. Ordinary navigation retains its existing guard. No guide launch reloads the page or synthesizes clicks on editor controls.

## Application boundaries

Both editor routes mount the same React character workspace in `animation-editor/main.tsx`. `WorkspaceNavigation.ts` handles navigation between editor views while retaining their live document owners. React owns shell layout and disclosure panels; existing controllers own inspector and timeline host contents. `mountView.tsx` creates the Phaser scene/controllers after React commits their hosts and disposes them before unmounting. The selection UI follows the native help/file dialog conventions in `Workspace.tsx` and editor markup.

Guide definitions and state are frontend-only. They are not engine exports, rig/animation JSON, draft recovery data, or document history. The controller accepts a `GuideContext` containing the active editor and capability facts only. It never receives document references, authoring commands, gameplay callbacks, or playback owners. The workspace adapter supplies those facts while retaining the existing document lifecycle.

## Model and registry

Import the internal frontend API from `src/devtools/shared/guides/index.ts`:

- `GuideDefinition`: ID, feature title/description, editor, category, optional prerequisites, and ordered steps.
- `GuideStep`: ID, title/description, stable target ID, optional prerequisites, and optional `reveal-target` preparation.
- `GuideContext`: active editor and capabilities (`character`, `valid-rig`, `animation`, `ik-constraints`, or `tool:<id>`).
- `GuideRegistry`: validates nonempty/unique guide and step IDs, nonempty steps, and target IDs; owns deeply frozen copies of definitions.
- `getAllGuides()`, `getGuidesForEditor(editor)`, and `getGuideById(id)`: access the shared catalog. `guideRegistry.getGuideStep(guideId, stepId)` returns an individual step. Missing lookups return `undefined`.
- `getGuideAvailability(guide, context, step?)`: checks declared prerequisites and returns `{ available: true }` or `{ available: false, reason }`.

Add feature definitions centrally in `definitions.ts`, outside React markup. The two short initial definitions exercise both editor paths and anchors; they are architecture examples, not complete editing tutorials. Future guides that teach creation of a missing resource should omit that resource's prerequisite. Additional IK/tool requirements use capability facts without passing authoring objects into the guide system.

Catalog availability is independent of the current editor, allowing the selection modal to show both editor categories. The controller's `getAvailability(id)` checks the guide and first step; subsequent step requirements are checked on entry. Starting additionally requires the correct editor. The launcher uses existing navigation and unsaved-change guards before starting; the guide controller never navigates by itself.

## Controller

Create one `GuideController(context)` per guide UI lifetime. It can receive a separate `GuideRegistry` for tests or alternative frontend catalogs. Its stable `subscribe` and cached `getSnapshot` functions work directly with React's existing external-store pattern:

```tsx
const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
```

`start(id)`, `next()`, `previous()`, `exit()`, and `finish()` return `{ ok: true }` or `{ ok: false, reason }`. Invalid commands preserve the current snapshot. Only one guide may be active; starting another requires finishing or exiting the first. Next/Previous stop at boundaries; Next does not implicitly finish. Finish requires the last available step. Exit always works for an active guide, even after its prerequisites disappear.

Snapshots contain context, status (`idle`, `active`, `exited`, or `finished`), current guide/step, zero-based step index, and availability. Inactive states clear guide/step/index references. `reset()` returns to idle without persisting completion. `setContext(context)` copies new capability facts, publishes changes even while inactive, and rechecks active availability without resetting progress. Hosts should call it when editor/resource availability changes, including character replacement. Context and snapshots are immutable; unchanged context and rejected navigation preserve snapshot identity. Subscribers receive a stable listener snapshot and remaining listeners still run if one throws, matching existing editor notification conventions.

Navigation does not run UI preparation. The future guide view explicitly calls `prepareCurrentStep(targets)` after mounting the correct editor. Only a declared `reveal-target` request invokes `targets.reveal(targetId)`; it cannot synthesize clicks, change edit modes, select bones, author data, or play animation. Missing targets return a reason without changing guide progress, so the later UI can offer fallback/skip/exit behavior.

## Stable targets and geometry

`GUIDE_TARGETS` in `anchors.ts` shares stable IDs between definitions and React `data-guide-id` attributes. Initial anchors cover the rig hierarchy, selection details and canvas host, plus the animation timeline, tracks and current-time field. Inspector sections still start collapsed. Existing component styles, DOM IDs, and controller-owned child regions retain their ownership.

`new GuideTargets(editorRoot)` implements `GuideTargetResolver`:

- `resolve(id)` measures a matching DOM control or whole panel, or invokes a registered geometry provider. Missing, ambiguous, hidden, inert, unrendered, invalid, or throwing targets return `null`.
- `reveal(id)` opens disclosure ancestors and scrolls a DOM target into view. Inspector targets request the existing `workspace:reveal-inspector` event via a `data-guide-inspector` host. It refuses to unhide an inactive editor. React drawer changes may require a subsequent render before measurement succeeds.
- `registerGeometry(id, { getRectangle, reveal? })` registers optional editor/Phaser geometry and returns an idempotent cleanup function. Duplicate geometry IDs reject. An explicit provider owns its ID, including its temporarily missing state, until cleanup; it never silently falls back to a DOM element.

All rectangles use `{ x, y, width, height }` in **viewport CSS pixels**, matching `getBoundingClientRect()`. Providers must convert Phaser world/camera/canvas coordinates to that space themselves, accounting for canvas placement, CSS scaling, camera transforms, and device pixel ratios as needed. The resolver never queries arbitrary Phaser GameObjects through DOM selectors. It measures afresh on each call and owns no observers, animation loop, or global listeners. Later spotlight rendering will subscribe to layout changes and call this same interface.

Geometry providers and reveal adapters are trusted frontend code under the same UI-only contract. Do not pass an authoring or runtime command as a reveal callback. Call each geometry cleanup on provider/scene disposal and unsubscribe React consumers on unmount; no global guide controller or progress store is introduced.

## Verification

`guideRegistry.test.ts`, `guideController.test.ts`, and `guideTargets.test.ts` cover registry validation/lookup/order, prerequisite reasons, controller lifecycle/boundaries/reset, missing references, context changes, subscriber cleanup, immutable snapshots, DOM/panel/canvas geometry, safe reveal, and geometry cleanup. Real rig and animation sessions verify authored data, dirty flags, histories, playback time/state, and authored event delivery remain isolated from guide navigation and preparation.

`guideLauncher.test.ts` additionally covers live workspace availability, missing/optional resources, first-step checks, guarded launch order, canceled navigation and preservation of unsaved documents. `tests/browser/featureGuide.spec.ts` covers modal opening/closing, registry rows, category keyboard controls, focus containment/restoration, cross-editor launch, preview protection and failed character loads against both local development and production builds.

Run `npm run typecheck`, `npm run test`, and `npm run build`. Browser smoke tests remain local-only; this milestone adds no browser/CI installation or progress infrastructure.
