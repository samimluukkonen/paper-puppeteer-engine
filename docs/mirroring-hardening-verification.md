# Mirroring hardening and regression

[All guides](../README.md#guides)

Milestone v0.5.4.5, package `0.5.4-5`, completes the v0.5.4 mirrored animation tools phase. Artist instructions and a left-arm walkthrough are in [the Animation Editor guide](animation-editor.md#mirror-a-left-arm-movement).

## Implemented hardening

Current-pose authoring now reflects only source bones that contribute requested properties. An unanimated pair with an unsupported bind transform no longer blocks an unrelated sparse edit. Explicit property requests still validate the requested transforms. All mapping and hierarchy checks remain mandatory, and selected-key authoring still validates every selected source/time before one batch installation.

`MirrorToolsController.unbind()` releases the editor subscription, mapping, cached proposal/pose dependencies, pair drafts and preview, and publishes disabled readiness. `dispose()` clears listeners and performs the same cleanup idempotently. Failed scene loads unbind mirror controls. React panel effect cleanup removes the shortcut listener and hides preview, including when a panel unmounts independently of the application. `hidePreview()` is an idempotent controller action. Rebinding restores validated preferences against the new rig instance; old state notifications cannot affect the new panel.

## Mapping and mathematics

Editor-only immutable mappings belong to one `Rig` instance. Token-aware inference produces candidates from side-aware bone names, manual assignments take precedence, and a reciprocal index resolves partners. Validation checks missing bones, self/duplicate/reversed pairs, multiple partners, rig identity, lookup agreement and corresponding parent branches. Centerline/unpaired bones remain untouched. Browser persistence uses character/path identity plus a fingerprint of bone definitions; no mapping data enters animation or rig JSON.

For source/target parent bind linear frames `B_s`, `B_t`, character-space reflection `F = diag(-1, 1)`, and local bind/pose linear matrices `L_s`, `L_t`, `P_s`:

```text
C = inverse(B_t) F B_s
D = P_s inverse(L_s)
P_t = C D inverse(C) L_t
translation_t = bindTranslation_t + C (translation_s - bindTranslation_s)
```

Decomposition preserves destination bind axis signs and rejects nonorthogonal local axes rather than approximating shear. Reflection is bind-relative; parent animation is not applied a second time. Unpaired ancestor motion carries the character's bind reflection axis. Swap always reads both sides from the original snapshot.

Supported configurations include corresponding nested arm/leg branches, rotated parents, unequal bone lengths/rest offsets/rest rotations, finite transforms, nonzero uniform scale, existing signed bind axes with stable signs, and representable nonuniform scales. Artwork sizes and attachments are independent of joint math. Missing counterparts are safe unpaired bones; trying to author from them fails with feedback.

Unsupported configurations are ancestor pairing, mismatched parent branches, singular bind/parent frames, zero animated scales, changes of scale-axis sign, unrepresentable local shear and numerical overflow. Diagnostics block the complete requested operation. Canonical rotations preserve orientation modulo `2π`, not winding counts. Full supported pose round trips compare floats with tolerance; one-way copying restores the copied source side, not the overwritten destination. Sparse key selections retain their requested properties even when rotated/asymmetric frames couple X/Y or scale axes; omitted properties can prevent exact geometric reflection/involution. Mirroring a few sampled keys does not promise a continuous reflection between them on an arbitrary asymmetric rig.

## Authoring, collisions and history

Current pose uses normal runtime playback sampling at the held playhead before drafts/IK; selected keys use raw authored sampling at each exact key time. Only authored source properties (current pose) or selected properties (keys) are written. No unrelated translation/scale keys are synthesized. Duration, source times, playback settings, events and implicit/explicit clip-level linear interpolation survive. Smooth/stepped are playback timing modes; the format has no per-key interpolation or mixed curve types. Mixed-property selections are supported.

Batch edits replace existing destination property keys within the shared `1e-6` ms tolerance and retain sibling properties. Distinct group times survive; duplicate references cannot introduce duplicate destination keys. Proposal validation precedes installation. Each changed commit creates one history snapshot and notification, pauses playback and selects destination keys. Undo restores exact destination data; Redo installs the same committed snapshot. No-op and failed proposals create no authored history. Clipboard, movement, interpolation declaration edits and subsequent mirrors use the same document/history machinery and saved dirty checkpoints.

## Runtime and rendering integration

React subscribes to cached readiness via `useSyncExternalStore`; authoritative selection/time/document data remain in `AnimationEditorState`. Preview is a detached proposed pose in a separate violet render-only overlay. It does not apply to active joints, advance clocks, dispatch events or edit JSON. Closing/unmounting/invalidating the panel, unbinding or committing hides it; scene shutdown destroys its render resources.

Authoring reads evaluated animation data, then the existing active preview applies ordinary procedural arm/leg IK and rendering. Mirroring never reads corrected Puppet joints or alters target providers. Ghosts remain authored poses before IK, use the current working snapshot, and refresh previous/next poses immediately after a commit and Undo/Redo. Repeated mirror/onion toggles share no mutable pose state. Facing follows the outer container and does not change mappings, authored values, interpolation, skins, slots or attachments. Mirror sampling/preview/commit preserve events and payloads; normal playback retains event crossings, looping and restart behavior.

Export/import uses the existing animation format and canonical serialization precision. The exported file loads through `CharacterLoader` and the regular runtime compiler/evaluator, without editor metadata or an editor-specific playback path.

## Files and APIs

- `keyframeMirroring.ts`: restrict current-pose transform validation to sources contributing keys; public proposal signatures unchanged.
- `MirrorToolsController.ts`: add `hidePreview()` and `unbind()`, release cached rig/animation references and reset readiness on disposal.
- `MirrorToolsPanel.tsx`: clear preview on React effect cleanup.
- `main.tsx`: unbind mirror controls on scene failure.
- `boneSymmetry.ts`: make ancestor-pair feedback describe the current supported hierarchy.
- `mirroringHardening.test.ts`, `mirrorPanelLifecycle.test.ts`, `mirrorTools.test.ts`, `animationEditorScene.test.ts`, local `browser/animationMirroring.spec.ts`: add workflow/lifecycle regressions.
- Package/lock version, README, changelog, artist/development and mirror guides: document completion, limitations and verification.

No engine API, file schema, Rig Editor functionality or CI browser steps changed.

## Automated and browser verification

New regressions cover all six nested humanoid pairs; asymmetric lengths/offsets and missing counterparts; copy-back and double swap; orientation winding; unanimated singular sparse tracks; smooth/stepped metadata; mixed-property clipboard/movement/interpolation/history stress; source immutability; atomic replacement through Undo/Redo; normal runtime playback, speed, loops, scrub and event payloads; JSON stability and `CharacterLoader`; mocked React effect cleanup, preview cleanup, changed-rig rebinding and released cache references; scene-level arm/leg IK, facing and current/previous/next refresh through repeated toggles and history.

The full Vitest suite supplies broader regression coverage for Rig Editor bone/joint/sprite/slot edits and export/history, Animation Editor timeline/selection/marquee/group movement/snapping/clipboard/events/import/export, and runtime layers/crossfades/IK/skins/character loading. Local browser scenarios exercise actual React/Phaser controls and canvas changes. Browser smoke tests remain local-only.

Verification on October 11, 2026:

| Command                 | Result                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | PASS — exit 0                                                                                       |
| `npm run test`          | PASS — exit 0; 102 files passed, 3 skipped; 1,637 tests passed, 28 optional profiling tests skipped |
| `npm run build`         | PASS — exit 0; demo/library bundles, declarations and plain Node `/core` check                      |
| `npm run check`         | PASS — formatting, lint and typecheck                                                               |
| `npm run check:version` | PASS — `0.5.4-5` is valid SemVer                                                                    |
| `git diff --check`      | PASS                                                                                                |

This phase adds 19 unit/scene regressions plus two local browser scenarios per deployment. One full-suite run overlapping browser checks hit the existing sketch rear-grip five-second timeout, also recorded in earlier mirror milestones. The subsequent standalone full-suite run passed with its existing timeout and implementation unchanged. The panel teardown tests exercise the React effect contract with mocked hooks; local browser tests exercise actual React/Phaser controls.

A single-worker installed-Chrome run selected 24 cases across development and production from `animationMirroring.spec.ts`, `animationGroupMovement.spec.ts`, `animationProductionWorkflow.spec.ts`, `demo.spec.ts` and `rigEditor.spec.ts`. It passed 22 cases. The development character/route case exceeded a five-second loading assertion; the new lifecycle loading assertions now allow 15 seconds. The existing production multi-reload Rig Editor case exceeded its 30-second overall deadline. No Rig Editor source or test assertions changed.

The affected scenarios then passed in both deployments (four cases, exit 0, 2.2 minutes) using:

```bash
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/animationMirroring.spec.ts tests/browser/rigEditor.spec.ts \
  --grep 'repeated animation|exported, original' --timeout=60000 \
  --output=/private/tmp/ppe-mirror-lifecycle-final --reporter=line
```

Together these runs verify all 24 selected cases, including all ten mirror cases, timeline marquee/group collision/history, smooth/stepped canvas export/reload with facing and IK, demo playback/skin/IK controls, Rig Editor canvas drag, numeric field history and exported/original/imported rig reloads. The normal browser fixture checks completed cases for browser exceptions and failed local assets. Earlier new mirror test setup was corrected to reselect keys after a stationary ruler click, which intentionally clears selection; the corrected commit/export cases passed on both deployments.

Visual inspection reviewed a Swap-preview canvas and the committed mirrored pose with onion skins. The violet preview and neighboring artwork are visible alongside the opaque active puppet. A human artist interaction session and the complete browser suite were not performed. Artifacts are under `/private/tmp/ppe-mirror-final` and `/private/tmp/ppe-mirror-lifecycle-final`; browser checks and browser installation remain local-only.

## Deferred features

Sprite import/replacement, Animation Editor joint editing, IK-target authoring/mirroring, IK baking, cross-rig retargeting, automatic animation generation, event mirroring, artwork/weapon switching, scene choreography, physics and mesh deformation remain outside this phase. Advanced/per-key interpolation remains outside the current format.
