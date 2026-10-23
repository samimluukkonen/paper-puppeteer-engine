# Animation Editor guided tutorials

[Development guide](development.md#architecture) · [Feature Guide architecture](feature-guide-architecture.md)

The catalog contains seventeen selectable tasks with 84 steps. Open **Feature Guide → Animation Editor**. Steps start as explanations; v0.7.6.6 adds optional **Try It** for bone selection, the X key button and onion skinning. See [Using Feature Guide](feature-guide.md). Next, Back, Finish, restart and Exit never perform the described actions. Inspector disclosures start collapsed and open only when a step reveals them.

| Guide                      | Steps | Prerequisites beyond a loaded, valid rig                                 |
| -------------------------- | ----: | ------------------------------------------------------------------------ |
| Aligning Feet to Ground    |     5 | Selected clip; explains missing markers and optional existing foot IK    |
| Using Ground Reference     |     5 | None; IK alignment is optional and explained through its actual control  |
| Create a New Animation     |     5 | None; no JSON or existing clip required                                  |
| Create Your First Keyframe |     5 | Selected clip, including an empty clip                                   |
| Animate a Bone             |     6 | Selected clip                                                            |
| Timeline Navigation        |     6 | Selected clip                                                            |
| Keyframe Editing           |     4 | Selected clip with authored bone property keys                           |
| Interpolation              |     4 | Selected clip                                                            |
| Graph Editor               |     7 | Selected clip; no bone/IK selection or existing keys required            |
| Onion Skinning             |     4 | Selected clip                                                            |
| Pose Library               |     7 | Selected clip; no saved poses or bone selection required                 |
| Mirrored Animation         |     4 | Selected clip; teaches mapping actual bone IDs                           |
| IK Target Animation        |     5 | Selected clip, rig IK constraint and a selected IK target                |
| IK Baking                  |     5 | Selected clip, rig IK constraint and authored IK position/influence keys |
| Animation Events           |     4 | Selected clip; no existing events required                               |
| Rig-Tweak Mode             |     4 | None; explains entering the mode without entering it for the artist      |
| Exporting Animations       |     4 | Selected clip                                                            |

IK tasks use the `ik` registry category; the other fifteen use `animation`. Availability reasons tell the artist how to meet missing prerequisites. The target tutorial requires selecting a constraint before launch because its inspector is conditional. No guide assumes a particular bone or constraint name, creates sample content, infers pairs automatically, or selects an authoring target. Clip/selection/rig changes refresh availability. Authored-key facts are cached by immutable clip identity so playback does not repeatedly scan keyframes.

## Target contract

`animationGuides.ts` supplies the catalog; `anchors.ts` shares IDs with React markup. All steps use UI-only `reveal-target` preparation through the existing `GuideTargets` resolver and spotlight observation lifetime.

| Area         | Stable `data-guide-id` anchors                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session      | `animation-new`, `animation-selection`, `animation-settings`, `animation-editor-mode`                                                                                                                    |
| Inspector    | `animation-bones`, `animation-properties`, `animation-x-key`, `animation-interpolation`, `animation-ik-inspector`                                                                                        |
| Timeline     | `animation-timeline`, `animation-tracks`, `animation-ruler`, `animation-current-time`, `animation-playback`, `animation-zoom`, `animation-track-navigation`, `animation-key-editing`, `animation-events` |
| Graph        | `animation-graph-toggle`, `animation-graph-property`, `animation-graph-canvas`, `animation-graph-interpolation`, `animation-graph-tangents`, `animation-graph-keys`, `animation-graph-navigation`        |
| Preview      | `animation-canvas`, `animation-onion`, `animation-onion-settings`, `animation-ik-options`                                                                                                                |
| Tools        | `animation-mirror`, `animation-mirror-pairs`, `animation-mirror-direction`, `animation-mirror-actions`, `animation-bake`, `animation-bake-actions`                                                       |
| Pose library | `animation-pose-save`, `animation-pose-browse`, `animation-pose-actions`, `animation-pose-apply`, `animation-pose-history`                                                                               |
| Ground       | `animation-ground-visible`, `animation-ground-y`, `animation-ground-align`, `animation-ground-reset`                                                                                                     |
| Saving       | `animation-validation`, `animation-export`, existing `rig-character-package` on the active package panel                                                                                                 |

Selection details is a stable disclosure host: instructions explain selecting a bone or event to see its conditional fields. The IK inspector is anchored to the actual selected constraint panel. New-animation dialog instructions spotlight its launch button; the tour does not open or submit a modal form. Rig-Tweak tool instructions point to the mode selector and preview because the tour does not switch into Rig Tweak. Canvas operations spotlight the real preview host with coordinate/interaction guidance, without guessed joint positions.

The existing resolver remeasures real DOM rectangles, clips against scroll containers, opens disclosure ancestors and scrolls targets into view. Action anchors also scroll long mirror/bake panels to the relevant buttons. Unrelated floating animation menus and tool panels close so they cannot obscure the next target; ordinary inspector disclosures remain open. The spotlight follows layout through animation frames, scrolling and resizing. Zoomed/scrolled timeline rulers, expanded tracks, React inspector changes and a moved Phaser preview therefore use current viewport geometry. Missing or inactive targets show a fallback instead of retaining stale coordinates. Explain mode uses native modal protection; optional practice adds scoped input containment with cleanup on each transition.

The Graph Editor tour uses stable anchors for its view switch, property selector, SVG plot, interpolation selector, tangent precision, key precision and navigation controls. `graphGuideTargets.ts` registers view-aware providers with the existing resolver: graph steps reveal the graph; timeline-only steps reveal the timeline. The adapter delegates DOM geometry, clipping, disclosure opening and scrolling to the shared resolver and unregisters providers on editor teardown. Preparation preserves selection, drafts, playhead, authored data and history, including when no bone or IK constraint is selected. Disabled controls stay visible with instructions for selecting a track and adding keys after the tour. No curve or sample keys are created automatically.

## Current feature limits taught by the catalog

- Clip interpolation supports Default (Linear) and explicit Linear. Graph Editor edits outgoing property overrides with Auto, Linear, Stepped and Bézier, including normalized tangent controls. Key details remains read-only. Smooth/Stepped and FPS control sampling separately.
- Bone groups support timeline marker dragging, clipboard and duplication. Graph Editor supports individual bone/IK key time/value dragging and precision edits, rejecting neighbor collisions. IK timeline keys support single selection, nudging and deletion; group clipboard and timeline marker dragging remain unavailable.
- Onion ghosts and mirroring use authored bone poses before IK. Mirror mapping and previews stay separate from explicit commit buttons.
- Pose Library captures full or selected-bone FK values before IK. Preview is temporary; Apply writes keys as one animation edit. Library edits have separate history, exact compatible-rig checks, and character/project ZIP and autosave persistence. The tour reveals controls without saving, previewing, applying, renaming or deleting a pose.
- Baking samples the entire clip to bone rotation keys and deactivates baked constraints for that clip. Fixed-target preview must be off; constraints and sampling options can still be rejected by the normal bake panel.
- JSON export contains committed data. Character ZIP export includes the manifest entry for newly created clips. Downloads do not write project files.

## Verification

`tests/graphGuideTargets.test.ts` covers graph/timeline view reveal, tangent disclosure, missing/inactive targets, registration cleanup and remount. `tests/browser/animationGraphGuide.spec.ts` covers the seven real-control steps with empty/unselected and keyed/selected clips, draft/selection/time/history preservation, Back/Finish/Escape/focus, switching to a timeline tour and missing-animation reasons.

`tests/animationGuides.test.ts` checks catalog categories, declared targets, step bounds, missing/empty/existing clips, arbitrary rig IDs, optional IK prerequisites, live clip changes and read-only navigation. It checks every exit position plus Back/Finish, immutable documents, history, dirty flags, selections, playhead, playback and temporary drafts. `tests/guideSpotlightLifecycle.test.ts` checks modal closure, focus restoration, target-observer teardown and ResizeObserver disconnection. Shared resolver tests also cover closing unrelated floating menus without closing the target or its ancestors.

Local-only `tests/browser/animationGuides.spec.ts` walks every available guide against the shipped representative rig with existing/empty clips. It checks actual anchor availability, spotlight geometry, card overlap, focus restoration, Escape, no downloads, preserved JSON and Undo/Redo. A layout scenario exercises zoom, scroll, expanded tracks, clip switching, inspector reveal, desktop resizing, moved preview geometry and leaving the React workspace. Existing feature-picker tests now account for optional IK prerequisites and creation guides without clips.

Screenshots from the existing-clip walkthrough are saved under the Playwright test output directory for visual review. Browser tests are local-only; no browser setup or smoke-test CI changes are included.

### Recorded command results — 2026-10-17

| Command                                                                                                                  | Result                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                      | Exit 0; no TypeScript diagnostics                                                              |
| `npm run test`                                                                                                           | Exit 0; 166 test files passed, 4 skipped; 2,829 tests passed, 44 skipped                       |
| `npm run build`                                                                                                          | Exit 0; demo and library builds passed, including the plain-Node core/serialization/data check |
| `npm run check`                                                                                                          | Exit 0; formatting, lint and type checking passed                                              |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGuides.spec.ts tests/browser/featureGuide.spec.ts` | Exit 0; 22 passed across development and production (9.3 minutes)                              |

Visual review covered representative screenshots from all thirteen guides on `demo-puppet` at a 1440 × 1000 desktop viewport. Instructions matched the current UI, cards left highlighted controls clear, and long mirror panels scrolled to their action buttons. The browser walkthrough also checked Back, Finish, Escape, focus restoration and unchanged animation JSON/history. This was automated traversal plus screenshot review; a separate human artist practice session was not performed. Dialog forms and conditional selection fields are explained without the tour submitting forms or selecting authoring data.
