# Scene root motion

[All guides](../README.md#guides) · [Runtime root motion](root-motion.md) · [Scene Editor](scene-editor.md)

Select an animation action on an Actor's timeline and expand **Action properties · animation**. **Movement source** offers **Scene-controlled** (the default) or **Animation root motion**. Apply action properties to commit the choice; Undo/Redo includes it. The inspector starts collapsed and shows the evaluated, read-only animation-local X/Y displacement over the full action window, including speed, clip playback quantization and continuous loop cycles. Author root keys in Animation Editor. Rootless animations disable the root-motion option; replacing an animation retains the movement choice and requires fixing an invalid selection before Apply.

An Actor starting at X=100 with a +80 sword step, facing right at scale 1, finishes at X=180. A following idle holds X=180. Facing left reverses horizontal travel. The existing Puppet runtime captures the Actor's facing, nonuniform scale and rotation at each clip start, transforms local displacement into parent coordinates, then applies parent transforms normally. Changes to facing/scale during a clip do not redirect its captured trajectory; the next clip captures the new transform. At equal action times, the existing source-array ordering determines whether a facing marker executes before or after a clip begins.

## Ownership and boundaries

Scene-controlled clips ignore authored root translation and can run alongside scene move actions. Root-motion clips own Actor translation for their entire explicit window, including any final-pose hold. Their half-open intervals cannot overlap a move action or another root-motion clip on the same Actor. Animation clips also retain the existing exclusive animation channel. Validation rejects conflicts atomically, including property edits, duplication, dragging and imports; it never moves another action to make room. Adjacent clips and separate Actors are allowed. No blending or automatic reset is implied.

SceneRunner uses `Actor.play` with `rootMotion: 'apply'` only for opted-in clips and `'ignore'` otherwise. `AnimationPlayer` uses the authoritative elapsed evaluator and the existing Puppet transform application before skeletal/IK synchronization and notifications. It does not modify bone, pelvis or IK data. A completed/truncated clip retains current placement; the next root clip captures that resulting position as its fresh origin. A move following root motion begins there and follows its existing absolute destination. Runtime root motion rejects concurrent `moveTo`/`walkTo` requests; existing scene cancellation and external animation replacement stop scene ownership and retain already applied travel. Stop returns to authored scene placement; cancel preserves current placement.

## Timing and seeking

Every scene clip has a positive finite duration and speed. Non-looping animation holds its endpoint if its window is longer than the animation, or truncates at the window end. Looping clips accumulate net cycle displacement plus the current cycle's partial displacement until the explicit window ends. Scene speed scales the shared scene clock; animation speed scales root and skeletal clocks together. Infinite windows and alternate/reset looping policies are unsupported. Authored reversals and reset keys remain visible as authored.

Forward seeking retains the current isolated Actors, root-motion origins and accumulated travel, processing only newly crossed action boundaries through time T. Same-position seeks retain the existing sample. Backward or invalidated seeks reconstruct from initial data. Completed actions and the partial active action contribute the same placement as normal playback, within floating-point precision. Silent evaluation applies root translation but suppresses animation events, legacy completion callbacks and scene cues; lifecycle bookkeeping remains internal to the isolated runtime. Resuming consumes only events after T, once. No external choreography callbacks are replayed.

Fixed cameras, cinematic camera keys, image layers, parallax, ground references and foot contacts keep their existing world coordinate system. Only the Puppet's outer Actor transform moves; the world origin and background transforms stay independent. Foot contact diagnostics continue to project the final pose through that outer transform.

## Files and scripted choreography

Scene format 2 adds optional animation-action `movementSource: 'scene' | 'rootMotion'`. Omission behaves as scene-controlled and remains omitted on round trips. Animation format 1 and its root keys are unchanged. Loaded character catalogs, runtime preflight, project validation and scene package validation reject opted-in clips with no root keys. Structural validation without loaded metadata checks policy, timing and ownership; missing animation data is checked when assets become available. Scene/project ZIPs include the existing full character animation files and preserve movement source. The higher package/lockfile version 1.2.6 is retained.

Finite scripted choreography steps also accept their existing typed `options.rootMotion` policy:

```ts
const sequence = new ChoreographySequence(actor)
  .playAnimation('sword', { rootMotion: 'apply' })
  .playAnimation('idle');
```

Each step forces fresh, finite base playback and awaits completion. Subsequent movement starts from its resulting placement; cancellation preserves partial travel. Existing parallel Actor/Puppet claims reject two branches controlling the same Actor before either starts. Independent Actors may run concurrently. Scripted choreography remains runtime-only and is not an input to declarative scene seeking.

## Verification

`tests/sceneRootMotion.test.ts` covers the sword example, backward/vertical movement, independent Actors, scene-controlled legacy clips, transforms, handoffs, loops, holds/truncation, cancellation/replacement, arbitrary seeks, event suppression, atomic validation and portable package round trips. `tests/choreographySequence.test.ts` covers root-step handoff, cancellation and parallel conflict preflight. `tests/browser/sceneRootMotion.spec.ts` exercises the desktop inspector, history, actual playback, two Actors, rejected movement, repeated scrubs, JSON reload and the rootless state. Browser checks remain local-only.

Verified locally on 2026-10-25, with test runners executed sequentially using one worker:

| Command                                                                                           | Result                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                               | Passed (exit 0).                                                                                                                                                                                          |
| `npm test -- --maxWorkers=1`                                                                      | 211 files passed, 6 skipped; 3,706 tests passed, 47 skipped (exit 0).                                                                                                                                     |
| `npm test -- --maxWorkers=1 tests/sceneRootMotion.test.ts tests/choreographySequence.test.ts`     | 79 tests passed (exit 0), including the two camera/contact and project integration tests added after the full run.                                                                                        |
| `npm run build`                                                                                   | App, library, declarations and renderer-independent entry-point checks passed (exit 0). Two Lucide `use client` bundling warnings remain.                                                                 |
| `npm run schemas:generate`                                                                        | Passed (exit 0); scene schema includes optional movement source.                                                                                                                                          |
| `npm run check`                                                                                   | Formatting, lint and type checking passed (exit 0).                                                                                                                                                       |
| `npm run check:version`                                                                           | Passed (exit 0); package/lockfile/changelog agree on 1.2.6.                                                                                                                                               |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneRootMotion.spec.ts --workers=1` | Both development and production desktop workflows passed (2 tests, exit 0). Used installed Chrome because bundled Chromium is absent; localhost servers require execution outside the filesystem sandbox. |

The browser workflow creates two Actors, changes the sword action to root motion, verifies X=100 → 180 followed by an idle hold and a stationary second Actor, rejects an overlapping move, scrubs repeatedly and exports/reloads JSON. Its screenshot is stored locally under `test-results/sceneRootMotion-*/scene-root-motion.png`. ZIP and project reload behavior is covered by the integration tests.

Changed implementation files are `SceneDefinition.ts` and `schemas/scene.schema.json` (authored policy, timing and ownership), `AnimationPlayer.ts` and `SceneRunner.ts` (existing runtime application and silent scene reconstruction), `choreographySteps.ts` (scripted opt-in), `SceneAssets.ts` (loaded root metadata), `SceneActionInspector.tsx` and scene-editor `main.tsx` (controls and loaded validation), and project `ProjectWorkspace.ts` / `projectInspection.ts` (working-copy validation). Regressions live in `sceneRootMotion.test.ts`, `choreographySequence.test.ts` and browser `sceneRootMotion.spec.ts`. Documentation, README and the changelog record the workflow; package and lockfile metadata remain at their higher existing version.
