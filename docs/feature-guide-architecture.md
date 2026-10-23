# Feature Guide architecture

[Development guide](development.md#architecture)

The v0.7.6.1 foundation lives in `src/devtools/shared/guides/`. Guides teach individual features, such as Editing Joint Positions or Timeline Navigation. They remain short and independent; there is no application-wide tutorial, persisted completion tracking, database, or telemetry.

The v0.7.6.1 milestone provides the model, registry, targeting contract, and session controller. v0.7.6.2 adds the React feature selection modal and guarded editor navigation described below. v0.7.6.3 adds the shared spotlight and step cards. v0.7.6.4 adds the nine task-focused [Rig Editor tutorials](rig-editor-guides.md). v0.7.6.5 adds thirteen [Animation Editor tutorials](animation-editor-guides.md). v0.7.6.6 adds optional interactive practice, prerequisite links and restart/catalog navigation. See the short [artist guide](feature-guide.md).

## Feature selection and launch

The shared character workspace header exposes **Feature Guide** in both editors, including before character loading succeeds. `ui/FeatureGuide.tsx` owns one native modal outside the retained editor shells. Rig Editor and Animation Editor category buttons work with Tab and Enter/Space; native dialog behavior contains focus and closes on Escape. Closing restores focus to the opening button. Launch transfers focus to the guide card; exit/finish restores the opening control or the destination editor's Feature Guide button. Inspector sections start collapsed; only active guide targets request expansion.

Feature titles, descriptions and rows come directly from `GuideRegistry`; the modal does not maintain a second catalog. Unavailable entries retain visible prerequisite reasons and disabled Start buttons. Empty categories and failed character loads have explicit messages. An active session opens the step overlay with an immediate Exit action before another guide can start.

`workspaceGuideHost.ts` reads current rig validation, selected animation, authored sprite/attachment presence, IK constraints and UI tool availability into capability facts. State subscriptions, rig inspector changes and load failures refresh these facts. Guides that teach resource creation can omit the resource prerequisite. Optional IK/tool prerequisites use the same registry checks as the initial guides.

`GuideLauncher` revalidates live context and first-step prerequisites on every launch, asks the existing `WorkspaceNavigation` binding to navigate, refreshes context again, and starts the existing controller at step zero. The modal closes only after success; failures show an accessible message. Programmatic navigation and header links share mode switching and URL/history bookkeeping, including deployment bases and character query parameters. Committed rig/animation/artwork edits retain their live owners and histories. Mode changes that would discard uncommitted animation previews are unavailable for guide launch, without offering a discard confirmation. Ordinary navigation retains its existing guard. No guide launch reloads the page or synthesizes clicks on editor controls.

`ui/FeatureGuideCatalog.tsx` shares the category buttons, registry cards, availability feedback and start controls with Project Workspace. `ProjectFeatureGuide` adds only the project asset selector. It passes the requested guide ID through the same-origin `ProjectEditorContext.bindGuide` bridge; the retained editor waits for its character/scene context, then calls the normal `GuideLauncher.launch` prerequisite and navigation checks. Project catalog rendering never grants launch permission. The character-creation tour declares `tool:new-character`; project hosts omit that capability because character creation belongs to Project Workspace.

## Application boundaries

Both editor routes mount the same React character workspace in `animation-editor/main.tsx`. `WorkspaceNavigation.ts` handles navigation between editor views while retaining their live document owners. React owns shell layout and disclosure panels; existing controllers own inspector and timeline host contents. `mountView.tsx` creates the Phaser scene/controllers after React commits their hosts and disposes them before unmounting. The selection UI follows the native help/file dialog conventions in `Workspace.tsx` and editor markup.

Guide definitions and state are frontend-only. They are not engine exports, rig/animation JSON, draft recovery data, or document history. The controller accepts a `GuideContext` containing the active editor and capability facts only. It never receives document references, authoring commands, gameplay callbacks, or playback owners. The workspace adapter supplies those facts while retaining the existing document lifecycle.

## Model and registry

Import the internal frontend API from `src/devtools/shared/guides/index.ts`:

- `GuideDefinition`: ID, feature title/description, editor, category, optional prerequisites, and ordered steps.
- `GuideStep`: ID, title/description, stable target ID, optional prerequisites, and optional `reveal-target` preparation, and a typed Explain/Try It configuration. Practice declares its real target, instruction, project-change notice, prerequisites and optional completion capability.
- `GuideContext`: active editor and capabilities (`character`, `valid-rig`, `animation`, `ik-constraints`, `rig-artwork`, `bone-keyframes`, `ik-keyframes`, or `tool:<id>`).
- `GuideRegistry`: validates nonempty/unique guide and step IDs, nonempty steps, and target IDs; owns deeply frozen copies of definitions.
- `getAllGuides()`, `getGuidesForEditor(editor)`, and `getGuideById(id)`: access the shared catalog. `guideRegistry.getGuideStep(guideId, stepId)` returns an individual step. Missing lookups return `undefined`.
- `getGuideAvailability(guide, context, step?)`: checks declared prerequisites and returns `{ available: true }` or `{ available: false, reason }`.

Register feature definitions centrally in `definitions.ts`, outside React markup. `rigGuides.ts` supplies the nine Rig Editor tasks; `animationGuides.ts` supplies sixteen Animation Editor tasks, including Pose Library, Using Ground Reference and Aligning Feet to Ground; `sceneGuides.ts` supplies nine Scene Editor tasks, including Aligning Actors to Ground. Future guides that teach creation of a missing resource should omit that resource's prerequisite. Additional IK/tool requirements use capability facts without passing authoring objects into the guide system.

Catalog availability is independent of the current editor, allowing the selection modal to show both editor categories. The controller's `getAvailability(id)` checks the guide and first step; subsequent step requirements are checked on entry. Starting additionally requires the correct editor. The launcher uses existing navigation and unsaved-change guards before starting; the guide controller never navigates by itself.

## Controller

Create one `GuideController(context)` per guide UI lifetime. It can receive a separate `GuideRegistry` for tests or alternative frontend catalogs. Its stable `subscribe` and cached `getSnapshot` functions work directly with React's existing external-store pattern:

```tsx
const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
```

`start(id)`, `next()`, `previous()`, `restart()`, `exit()`, and `finish()` return `{ ok: true }` or `{ ok: false, reason }`. Invalid commands preserve the current snapshot. Only one guide may be active; starting another requires finishing or exiting the first. Next/Previous stop at boundaries; Next does not implicitly finish. Finish requires the last available step. Exit always works for an active guide, even after its prerequisites disappear.

Snapshots contain context, status (`idle`, `active`, `exited`, or `finished`), current guide/step, zero-based step index, and availability. Inactive states clear guide/step/index references. `reset()` returns to idle without persisting completion. `setContext(context)` copies new capability facts, publishes changes even while inactive, and rechecks active availability without resetting progress. Hosts should call it when editor/resource availability changes, including character replacement. Context and snapshots are immutable; unchanged context and rejected navigation preserve snapshot identity. Subscribers receive a stable listener snapshot and remaining listeners still run if one throws, matching existing editor notification conventions.

Controller navigation does not run UI preparation. `prepareCurrentStep(targets)` remains available for explicit `reveal-target` hints. The spotlight also calls safe `targets.reveal(targetId)` on entry and once per target disappearance, then re-resolves after layout commits. Reveal cannot synthesize clicks, select bones, author data, or play animation. Missing geometry leaves progress intact and exposes Skip/Exit (Skip / Finish on the last step). If prerequisites disappear, the card explains the reason and Exit remains available.

## Stable targets and geometry

`GUIDE_TARGETS` in `anchors.ts` shares stable IDs between definitions and React `data-guide-id` attributes. Initial anchors cover the rig hierarchy, selection details and canvas host, plus the animation timeline, tracks and current-time field. Inspector sections still start collapsed. Existing component styles, DOM IDs, and controller-owned child regions retain their ownership.

`new GuideTargets(editorRoot)` implements `GuideTargetResolver`:

- `resolve(id)` measures a matching DOM control or whole panel, or invokes a registered geometry provider. Missing, ambiguous, hidden, inert, unrendered, invalid, or throwing targets return `null`. DOM measurements are clipped to scroll-container bounds.
- `resolveElement(id)` returns the unique real element identity even while hidden, so interaction containment can retain its path during recovery. Visibility and current geometry are checked separately. Geometry providers may opt in with `getElement()`; a rectangle alone never enables a canvas.
- `reveal(id)` opens disclosure ancestors and scrolls a DOM target into view. Inspector targets request the existing `workspace:reveal-inspector` event via a `data-guide-inspector` host. It refuses to unhide an inactive editor. React drawer changes may require a subsequent render before measurement succeeds.
- `registerGeometry(id, { getRectangle, reveal?, getElement? })` registers optional editor/Phaser geometry and returns an idempotent cleanup function. Duplicate geometry IDs reject. An explicit provider owns its ID, including its temporarily missing state, until cleanup; it never silently falls back to a DOM element.

All rectangles use `{ x, y, width, height }` in **viewport CSS pixels**, matching `getBoundingClientRect()`. Providers must convert Phaser world/camera/canvas coordinates to that space themselves, accounting for canvas placement, CSS scaling, camera transforms, and device pixel ratios as needed. The resolver never queries arbitrary Phaser GameObjects through DOM selectors. It measures afresh on each call and owns no observers, animation loop, or global listeners. The active spotlight observes this same interface.

Geometry providers and reveal adapters are trusted frontend code under the same UI-only contract. Do not pass an authoring or runtime command as a reveal callback. Call each geometry cleanup on provider/scene disposal and unsubscribe React consumers on unmount; no global guide controller or progress store is introduced.

## Spotlight, positioning, and interaction

`ui/GuideSpotlight.tsx` renders a full-viewport native modal through a body portal. The browser top layer keeps it above React and Phaser; a transparent dialog and backdrop expose the real target through a rounded rectangular CSS shadow cutout with a visible border. The editor's styles are untouched. The card shows the guide/step titles, step count, explanation, Back, Next/Finish, and Exit. Pure positioning helpers pad/clip the spotlight and choose right, left, below, or above placement to minimize overlap, clamped to the viewport. Large panels may require some overlap.

Steps start in **Explain** mode. Native modal inertness blocks editor input, including the highlighted area. Supported steps offer an explicit **Try It** button; choosing it switches the same dialog to nonmodal presentation with a pointer-transparent host. `guideInteraction.ts` makes unrelated DOM branches inert while preserving preexisting inert attributes, captures input outside the real target/card, contains Tab focus across both, intercepts Escape, and stops global editor keyboard shortcuts. It re-resolves target identity and reconciles branches after DOM replacement through a child-list observer. Missing/hidden targets lose input access immediately and remain recoverable. No synthetic input or alternate Phaser editing handlers exist.

Practice completion observes capability facts from `workspaceGuideHost`: selected bone, current selected-bone X-key presence at the playhead, and the scene’s actual onion-skin setting. The existing onion preference controller refreshes guide facts after changing the setting. A generic click is never evidence of authored success. Completion text describes current state (which may already be satisfied), and never advances automatically. Next always remains optional when the guide prerequisites hold. Selected-bone prerequisites apply only to key practice, so the explanation remains available without selection.

Try It currently covers bone selection and committing the current X value in Create Your First Keyframe, and enabling Onion Skinning. Only explicit key practice changes authored data, through the existing BoneInspectorController and AnimationEditorState transaction; its notice precedes opt-in. Undo/Redo remains the standard editor history after exit. Rig tutorials and all canvas/bake/mirror/import/export steps remain explanations. The guide cannot write rig data, replace artwork, bake IK, mirror, or delete data.

Restart resets the current guide to step zero and Explain mode; Choose another guide exits and opens the catalog. Missing prerequisites keep visible reasons and offer a related guide’s category when configured. These operations do not undo intentional practice. Progress remains session-only with no persistence.

`observeGuideTarget.ts` owns a short-lived animation-frame loop for the active step, which also follows moving Phaser geometry and CSS transforms without requiring DOM canvas objects. It publishes only changed rectangles/viewport sizes. Resize, captured nested scroll, and visual viewport resize/scroll trigger fresh measurements for layout and browser zoom changes. A card ResizeObserver updates placement when text or card size changes. Step transitions remove the old listeners and cancel its frame; exit/unmount also disconnects the card observer and restores focus. Geometry-provider registrations retain their separate scene-owned cleanup contract. Spotlight and card movement use short CSS transitions, disabled with `prefers-reduced-motion`.

## Verification

`guideRegistry.test.ts`, `guideController.test.ts`, and `guideTargets.test.ts` cover registry validation/lookup/order, prerequisite reasons, controller lifecycle/boundaries/reset, missing references, context changes, subscriber cleanup, immutable snapshots, DOM/panel/canvas geometry, safe reveal, and geometry cleanup. Real rig and animation sessions verify authored data, dirty flags, histories, playback time/state, and authored event delivery remain isolated from guide navigation and preparation.

`guideLauncher.test.ts` additionally covers live workspace availability, missing/optional resources, first-step checks, guarded launch order, canceled navigation and preservation of unsaved documents. `tests/browser/featureGuide.spec.ts` covers modal opening/closing, registry rows, category keyboard controls, focus containment/restoration, cross-editor launch, preview protection and failed character loads against both local development and production builds.

`guidePositioning.test.ts` covers viewport clipping, missing/offscreen geometry, placement flips and edge bounds. `observeGuideTarget.test.ts` covers live canvas-provider rectangles, resize/scroll/zoom events, bounded safe reveal, recovery, deduplicated updates and complete listener/frame cleanup. Local browser scenarios additionally cover actual highlights, disclosure reveal, pointer/keyboard blocking, step focus, Back/Next/Finish/Escape, missing-target Skip/Exit, desktop placement, scroll/layout zoom, reduced motion, and retained unsaved edits.

Run `npm run typecheck`, `npm run test`, and `npm run build`. Browser smoke tests remain local-only; this milestone adds no browser/CI installation or progress infrastructure.

`guidePractice.test.ts` exercises authoritative completion, manual advancement, intentional key transactions, Undo/Redo, non-destructive restart and prerequisite lookup. `guideSpotlightLifecycle.test.ts` exercises React effect teardown. Local `guidePractice.spec.ts` exercises native mouse/keyboard practice, protected controls, hidden/replaced target recovery, repeat start/restart/catalog/exit, focus restoration and ordinary editor input after cleanup. Browser checks remain local-only.
