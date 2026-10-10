# React mirroring tools

[All guides](../README.md#guides)

Milestone v0.5.4.4, package version `0.5.4-4`, adds the Animation Editor's **Mirror tools** panel. It reuses the existing [bone mapping](bone-symmetry-mapping.md), [pose reflection](pose-mirroring.md), and [authored commands](mirrored-keyframe-authoring.md).

## Artist workflow

1. Open **Mirror tools** in the command bar and expand **Configure Bone Pairs**. Review the inferred left/right assignments. The dropdowns use actual rig IDs; the mapping never depends on a particular character. Edit or remove a pair, or add a pair and choose both bones. **Use inferred pairs** replaces manual assignments with fresh inference.
2. Choose **Left → Right**, **Right → Left**, or **Swap**. Read the source/destination message. These sides describe the rig, independently of preview facing. A one-way operation never becomes Swap automatically.
3. Select a source bone for current-pose copying, or leave bone selection empty to copy all mapped source bones. Current-pose copying writes only properties already authored on the source tracks. Temporary transform drafts and final IK output are excluded.
4. Use **Preview Mirrored Pose** to inspect the violet overlay before committing. M toggles preview while the workspace has focus; typing, modifiers, IME, repeat and dialogs retain their normal behavior. Escape within Mirror tools, closing the panel, a commit, or invalid readiness hides the overlay.
5. **Mirror Current Pose** authors values at the continuous playhead. **Mirror Selected Keys** copies only selected transform properties at their exact authored times; every selected key must be on the chosen source side and paired. The disabled explanation identifies unpaired/wrong-side keys, missing tracks or unsupported transforms. Select both sides and choose Swap to exchange their selected values from the original snapshot.
6. A successful changed commit pauses playback, selects destination keys, updates the inspector and timeline, and creates one history operation. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z restore/reapply it. Existing destination property collisions are replaced using the established group-edit policy, while unrelated properties remain intact.

The existing format supports clip-level linear interpolation only. Mirroring preserves its implicit/explicit declaration, playback settings, duration, events and exact source times. It adds no interpolation format.

## Configuration and persistence

`MirrorToolsController` owns direction and pair drafts, with React consuming a stable cached snapshot through `useSyncExternalStore`. Selected bones, selected/primary keys, current time and document snapshots remain exclusively in `AnimationEditorState`. Valid pair drafts are installed through `state.setSymmetryMapping`; invalid drafts remain visible and disable all mirror actions without using an older mapping silently. Hierarchy warnings also block mirroring because the existing pose math treats those relationships as incompatible.

Pair preferences follow the existing browser-local editor persistence convention. The `paper-puppeteer:mirror-pairs:` storage namespace scopes preferences by editor path and character identity. Each version 1 record contains a canonical fingerprint of the loaded bone definitions and strict validated left/right pairs. Reopening the same rig revalidates and rebinds the stored pairs to its new `Rig` instance. Different, malformed or incompatible records fall back to inferred candidates with visible feedback. Storage failures retain working session preferences and display that limitation. Direction and incomplete/invalid drafts are session-only. Another tab's writes are picked up on reopening; there is no live cross-tab synchronization.

Opening the panel, inspecting/editing pairs, changing direction and previewing do not change authored JSON, dirty state or history. No production rig or animation schema changes were made.

## Preview and lifecycle

The controller shares pure mirror-value sampling with the authored commands. Readiness checks validate source/destination scope and transform representability without constructing edited tracks or validating a proposed animation on each clock update. Only a commit builds the edited animation snapshot. When preview is enabled, the controller copies the sampled destination property values onto the detached current pose. This matches sparse commit scope and avoids a stepped-playback trap: evaluating a proposed clip at a quantized earlier time could skip the newly proposed continuous-time key. The preview represents the proposed authored values before playback quantization of future committed keys.

`AnimationEditorScene.setMirrorPreview(pose | null)` accepts the detached complete pose. The scene lazily creates one `AnimationPoseOverlay`, sharing the existing temporal-ghost renderer implementation while maintaining a distinct mirror instance and sample. Violet artwork sits above the active puppet at 35% opacity; temporal ghosts keep their original depth and settings. No extra Puppet, animation player, controller, scene, IK solver or event dispatcher is constructed. Appearance synchronization follows skins, frames, slots, visibility, root placement and facing. Unchanged pose samples skip transform projection.

The overlay never applies values to the active puppet or modifies the clock/document. Hiding it releases its sample references, and scene failure/shutdown destroys render resources. Controller rebinding releases the previous editor subscription. `unbind()` releases cached mapping/animation/pose dependencies and publishes disabled readiness after a failed load; disposal performs the same cleanup and clears listeners. React panel unmount removes the shortcut listener and hides preview through idempotent `hidePreview()`. See the [v0.5.4.5 hardening regression](mirroring-hardening-verification.md).

## Verification

`tests/mirrorTools.test.ts` covers React markup/readiness, directions, inference, invalid drafts, persistence and fresh-rig rebinding, immutable/event-silent preview, continuous stepped preview, command invocation, source ownership, one history action, destination selection, clip interpolation, Undo/Redo, editor synchronization, unsupported transforms, subscription cleanup and storage failure. `tests/animationEditorScene.test.ts` covers independent overlay allocation, reuse, facing, temporal-ghost coexistence and shutdown. Existing ghost-layer tests retain artwork/skin/projection coverage for the shared renderer.

Local browser checks in `tests/browser/animationMirroring.spec.ts` exercise real React/Phaser pair editing, invalid configuration, persisted manual overrides, all preview directions, M/Escape, onion skins, facing, current-pose/selected-key commits, timeline/inspector synchronization, source-preserving export and Undo/Redo on development and production pages. Browser checks stay local-only:

```bash
npm run build
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationMirroring.spec.ts
```

No sprite replacement, rig joint editing, mirrored IK targets/events, animation generation, advanced retargeting, choreography or mesh deformation is included.

Verification on October 11, 2026:

- `npm run typecheck`: passed.
- `npm run test`: passed; 1,618 tests passed and 28 optional profiling tests skipped across 100 passing and three skipped files.
- `npm run build`: passed, including demo/library bundles, declarations and the plain Node `/core` check.
- `npm run lint`, `npm run format:check`, `npm run check:version` and `git diff --check`: passed.
- Local installed-Chrome mirroring suite: all six scenarios passed across development and production, with no browser exceptions or failed local asset requests.
- Visual inspection of left-to-right, right-to-left and Swap canvas snapshots confirmed the violet overlay remains visible alongside onion skins.

All requested mirroring UI work is implemented. The exclusions listed above remain outside this milestone.
