# Root motion: data, evaluation and runtime application

[All guides](../README.md#guides)

## Existing transform hierarchy

Inspection for v1.1.7-1 found Environment Preview implemented through v1.1.6-4, alongside later scene camera/layer features. The package is already at 1.2.6 and retains that version.

```text
Scene / optional enclosing Phaser containers
└─ Puppet.container ← Actor.position, placement, rotation, scale and facing
   └─ Rig.root bone container ← ordinary bone-local Joint.pose
      └─ child bone containers (including a pelvis, if the rig has one)
         └─ artwork / attachments / bone-local foot contact markers
```

`Actor` is a facade over a Puppet, without a separate transform or evaluator. `Actor.position` uses the outer container's parent coordinates; `Actor.worldPosition` includes enclosing transforms. The rig explicitly names `Rig.root`; array order does not define it. A pelvis is an ordinary named bone and can itself be the skeleton root in a particular rig, but neither role identifies the Actor origin. Foot contacts are bone-local reference points transformed through the hierarchy, independent of all those origins.

`AnimationClip` is the runtime authored contract; version-1 `AnimationJsonDefinition` adds file version metadata. `tracks` animate sparse bone-local transforms, and `ikTracks` animate Puppet-local targets/mix. The Animation timeline and Graph Editor address those bone/IK channels through the same property sampler. They now expose dedicated root-motion channels; see [visual root-motion authoring](root-motion-authoring.md).

Scene placement, choreography and `ActorMovement` explicitly move the Puppet's outer container. Skeletal pose evaluation does not. Facing-left sets the outer container's X scale negative. Editor pose/selected-key mirroring rewrites skeletal values using symmetry mappings; it is distinct from facing and leaves authored root motion alone.

Environment Preview uses the same Puppet with separate world-pixel preview trajectories and editor camera settings, persisted as project editor preferences. Those values are not authored animation motion and are never converted automatically.

## Data and coordinates

An animation may contain `rootMotion: { translationKeys: [...] }`. Each sparse row has a millisecond `time`, optional finite `x` and `y` (at least one required), and optional outgoing `curves` for keyed X/Y properties. Curves reuse the existing linear default, stepped and bounded cubic Bézier schema and sampler. X and Y may be keyed at different times. An empty array is valid. Rotation and scale are excluded.

Keys use the existing bone/IK identity convention: strictly increasing unique row times, with a channel identified by property and time. A row can hold both channels at one time; separate duplicate-time rows are rejected. There are no new key IDs. Dedicated timeline, inspector and Graph Editor controls author these channels.

Values are absolute animation-local offsets, in the same units as the unscaled Puppet: positive X points right in the canonical right-facing character, positive Y points down. They are independent of pelvis, root-bone and IK coordinates. Displacement is evaluated from an initial placement, never added every frame.

Explicit runtime application transforms displacement through the outer container's starting linear transform, including nonuniform scale, rotation and facing. Parent-coordinate placement is `startingPosition + startingLinearTransform * displacement`; enclosing Phaser transforms then map that placement into world coordinates. Translation is assigned once from that origin. Facing is applied once through the captured transform; the sampler does not negate X. Bone mirroring does not mirror this track. A future operation that deliberately mirrors root-motion values would author their X signs once, with no additional playback mirror flag.

The playback's local linear transform and parent-coordinate origin remain fixed until a fresh playback or restart. Changing facing, scale or rotation during playback changes artwork but does not redirect the captured trajectory; start a new playback to capture a new direction. Moving/transforming an enclosing container still moves the entire character and its trajectory. Reparenting or directly changing the outer container's position during active application is outside this ownership contract.

## Start, end and looping

`sampleRootMotion(clip, time)` returns the raw X/Y offset, holding each channel's first/last value outside its keyed range; an unkeyed channel is zero. Time clamps to `[0, duration]`. It does not quantize or wrap time.

`evaluateRootMotion(clip, time)` returns `sample(time) - sample(0)`. This explicit evaluation-time normalization preserves serialized values and guarantees zero displacement at clip start, including nonzero first keys or a single key. Net displacement is `evaluateRootMotion(clip, clip.duration)`. An absent/empty track has zero initial value, displacement and net travel. A single keyed value is constant and therefore contributes zero normalized travel.

Both functions reject nonfinite sample times. If subtracting two finite extreme offsets produces an unrepresentable displacement, evaluation throws instead of returning infinity.

The duration remains the animation duration; root keys cannot extend it. `evaluateRootMotionAtTime` is an explicit local-time alias of `evaluateRootMotion`: exact duration retains the endpoint even for looping clips, and values above duration clamp.

`evaluateRootMotionAtElapsedTime(clip, elapsedMilliseconds, options?)` consumes **unwrapped elapsed time**, clamping negative elapsed time to zero. With `options.loop ?? clip.loop ?? false`, continuous looping evaluates:

```text
cycles = floor(elapsed / duration)
localTime = elapsed % duration
displacement = cycles * (sample(duration) - sample(0)) + (sample(localTime) - sample(0))
```

For a one-second clip with net X travel 40, three cycles give X travel 120. Exact boundaries use the accumulated net travel plus local zero; there is no extra end/start displacement. Large deltas cross multiple cycles in constant work without replaying frames. Nonlooping evaluation clamps to the endpoint. Unsafe cycle counts and unrepresentable travel reject explicitly.

`getRootMotionDelta(clip, previousElapsed, currentElapsed, options?)` subtracts those absolute samples. Both arguments must be unwrapped elapsed times: a crossing from 900 ms to 1100 ms is **not** 900 ms to 100 ms. Backward differences are supported for tools. Sampling is deterministic regardless of prior samples and never mutates an Actor, Puppet, animation, clock or pose.

Raw interpolation is the default. Pass `{ playback: { mode: 'stepped', fps: 10 } }` to quantize local time using the same numeric playback helper as skeletal/IK evaluation; an authored `clip.playback` override takes precedence when playback sampling is requested. Nonlooping endpoints and complete-cycle net travel retain the exact authored endpoint. Root motion never blends velocities during crossfades.

**Authored reset limitation:** continuous mode uses the authored net displacement, not the furthest forward offset. A clip that travels X=0 → 40 and resets to 0 at its end has zero net cycle travel. Its reversal or stepped reset remains visible, including an authored endpoint discontinuity. This API cannot infer whether a backward segment is intentional; it does not hide/reset/extract that motion. Author a compatible accumulating displacement track for continuous locomotion.

## Explicit runtime application

```ts
actor.play('walk'); // Default: root motion does not own translation.
actor.play('walk', { rootMotion: 'apply' });

// Same policy through Puppet and existing finite queues/waits:
puppet.queue('step', { rootMotion: 'apply', fadeDuration: 100 });
const result = await actor.playAndWait('jump', { rootMotion: 'apply', loop: false });
```

`RootMotionPolicy` is `'ignore' | 'apply'`. Every fresh play/queue request defaults independently to ignore. Only the base layer may apply; overlays reject apply. Missing root tracks evaluate to zero even with apply enabled. `restart: false` retains the selected instance's original policy, clock and starting transform; use a fresh play to change policy.

The existing Puppet update loop owns application, including automatic scene updates and manual `puppet.update(deltaMilliseconds)`. It uses absolute elapsed displacement from the captured placement rather than adding sampled offsets each frame. It sets the same outer `container.setPosition` transform used by Actor, before the authored pose/IK/render synchronization and event/completion callbacks. Bone and pelvis tracks remain untouched; Puppet-local animated IK moves with the character and runtime world targets use the new Actor placement. Do not also apply deltas in `onUpdate`, a host ticker or a Scene movement controller.

Active or paused root-motion playback exclusively owns translation. `moveTo`/`walkTo` reject until it stops, completes or is replaced by ignore playback. Starting apply playback rejects while a move/walk request owns translation; cancel or complete that request first. `Actor.setPosition` also rejects active root motion. These failures preserve the previous playback or movement. Translation leases are shared across Actor facades over one Puppet and released on replacement, completion, cancellation, failure and disposal. Pending queued apply requests check conflicts when they start; a start conflict throws through the ordinary update/queue error boundary without cancelling an independent movement request.

| Playback operation         | Translation behavior                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause / resume, speed zero | Hold placement and ownership; resume the same clock and baseline. Global and per-clip speed advance both root and skeletal time.                                                                                 |
| Stop / stopQueue / clear   | Keep already applied travel; release playback ownership. Resume does not restart a stopped instance.                                                                                                             |
| Restart / fresh play       | Keep current position, capture it as the new origin, reset elapsed time and preserve policy on restart. Pause state is preserved by restart.                                                                     |
| Completion                 | Apply the endpoint before completion listeners/waits/queue advancement; hold that position afterward.                                                                                                            |
| Queue transition           | Capture the completed endpoint for the incoming request. Existing queue scheduling starts the next clip at zero and discards frame overshoot; it does not subdivide the delta across requests.                   |
| Crossfade / interruption   | Outgoing movement ends immediately. Only the incoming base clip applies displacement from the current placement, at full weight; skeletal/IK fading remains unchanged. Ignore incoming playback holds placement. |
| Abort a wait               | Existing wait-only cancellation leaves playback running. `stopOnAbort: true` stops the owned instance and keeps applied travel.                                                                                  |
| Disposal                   | Settle existing waits and release movement leases/listeners. Borrowed Actor disposal preserves Puppet-owned playback, matching existing ownership semantics.                                                     |

## Deterministic seeking and standalone use

`AnimationPlayer.unwrappedElapsedTime` exposes total elapsed base time; existing `elapsedTime` and lifecycle status retain their wrapped local-time semantics. `player.sampleRootMotion(T)` evaluates the selected clip's effective loop override and playback quantization without changing clocks, placement, poses or events. `player.sample` / `puppet.sampleAnimation` continue sampling skeletal/IK data only. Isolated preview mode suppresses automatic root-motion application as well as authored events by default. Scene reconstruction explicitly uses `setPreviewMode(true, { applyRootMotion: true })` to keep translation on the runtime path while suppressing events. Pure skeletal sample calls remain placement-free in either mode.

Scene Editor uses the existing `SceneRunner` boundary evaluator to rebuild isolated Actors from authored placement, then advance validated declarations to the requested scene time. Completed root-motion clips contribute their final displacement and each new clip captures a fresh origin. This reconstruction never accumulates from the previously displayed frame or dispatches gameplay callbacks. See [Scene root motion](scene-root-motion.md) for ownership, timing, inspector controls and portable saving.

Pure evaluators and types are exported through `/core`, `/runtime` and the root entry with no React/editor imports. A standalone `new AnimationPlayer(rig, joints, compiledClips, application)` may opt into application by supplying one `RootMotionApplication` host: `validate()` checks translation conflicts, `begin()` captures starting placement, and `apply(absoluteDisplacement)` assigns from that baseline. Omitting the host retains ordinary skeletal playback and sampling; attempting apply rejects explicitly. The Phaser Puppet supplies this host automatically.

## Compatibility and ownership

The optional extension retains animation file version 1, following the existing curve/IK extension policy. Legacy files retain their omissions. Validation checks strict nested structures, finite coordinates/times, duration bounds, unique ascending times, supported curves, keyed-property ownership and monotonic Bézier time handles. JSON Schema describes shapes; the shared semantic validator checks ordering and duration relationships.

Authored motion belongs to the animation. Compilation retains an independent frozen root-motion snapshot; pure sampling shares the property interpolation infrastructure. Actor/Puppet consume it only with explicit apply playback. Skeletal/IK evaluation and scene movement do not consume it automatically. Animation Editor offers mutually exclusive authored root motion, preview-only displacement and no world displacement modes, with reset or continuous authored loop travel. No bone, pelvis, IK or Scene movement is extracted or converted. Preview settings remain separate.

Animation JSON export, character packages and project assets preserve this track deterministically through their existing validation boundaries. Whole-clip variations scale root key times with duration; ordinary bone/IK edits preserve them. There is no React state, camera state or Phaser object in root-motion data.

Animation Editor timeline/Graph Editor controls and its fixed-world preview are implemented in [v1.1.7-3](root-motion-authoring.md). Scene clip ownership, collision/physics/pathfinding, root rotation/scaling, extraction and foot locking remain deferred. The package and lockfile remain at their higher 1.2.6 version.

## Runtime implementation (v1.1.7-2)

`src/engine/rootMotion.ts` and `core.ts` add elapsed/local/delta APIs, playback options and the host contract. `AnimationPlayer.ts`, `AnimationQueue.ts` and `AnimationLayerEvaluator.ts` retain unwrapped instance clocks and typed per-request policy alongside the existing local pose/event clocks. `Puppet.ts` captures/applies placement and shares translation ownership with `ActorMovement.ts`; `Actor.ts` guards explicit placement. `tests/rootMotionRuntime.test.ts` covers runtime evaluation, loops, frame stepping, lifecycle/waits/queues, transforms, IK, seeking, preview suppression and compatibility.

Verification completed sequentially, with one worker for each test run:

| Command                                                         | Result                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                             | Passed, including the final build's type check.                                                                           |
| `npx vitest run tests/rootMotionRuntime.test.ts --maxWorkers=1` | All 28 new runtime regressions passed.                                                                                    |
| `npm run test -- --maxWorkers=1`                                | 3,653 tests passed, 47 skipped; 209 files passed, six skipped; 129.20 seconds.                                            |
| `npm run lint`, `npm run format:check`, `npm run check:version` | Passed; package/lockfile/changelog retain 1.2.6.                                                                          |
| `npm run build`                                                 | Application, ES library, declarations and Node entry checks passed. Existing Lucide `use client` bundler warnings remain. |
| `git diff --check`                                              | Passed.                                                                                                                   |

## Data model verification (v1.1.7-1)

| Files                                                                                              | Change                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/rootMotion.ts`, `core.ts`, `data.ts`                                                   | Root-motion types, property names and pure `sampleRootMotion` / `evaluateRootMotion` exports.                                                                                  |
| `src/engine/AnimationClip.ts`                                                                      | Optional authored/compiled root-motion data and detached frozen compiled ownership.                                                                                            |
| `src/engine/schemas.ts`, `validation.ts`, `jsonWorkloadLimits.ts`, `schemas/animation.schema.json` | Shared shape, scalar, timeline, curve and import-budget validation.                                                                                                            |
| `src/devtools/animation-editor/animationSerialization.ts`, `animationVariation.ts`                 | Deterministic export and whole-clip time scaling. Existing generic character/project serializers retain the new optional branch.                                               |
| `tests/rootMotion.test.ts`                                                                         | 53 regressions covering sampling, invalid input, ownership, mirroring/facing, unchanged runtime placement/poses/IK, editor preservation and character/project ZIP round trips. |

All commands below completed with exit 0. Test runners ran sequentially with one worker.

| Exact command                                                                                                                                                                                  | Result                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                                            | Passed; also passed through the final `check` and `build` commands.                                                       |
| `npx vitest run tests/rootMotion.test.ts tests/animationCurves.test.ts tests/animationSerialization.test.ts tests/animationVariation.test.ts tests/schemaCompatibility.test.ts --maxWorkers=1` | 142 tests passed across five files.                                                                                       |
| `npm run test -- --maxWorkers=1`                                                                                                                                                               | 3,625 tests passed, 47 skipped; 208 files passed, six skipped; 142.58 seconds.                                            |
| `npm run check`                                                                                                                                                                                | Formatting, lint and TypeScript passed.                                                                                   |
| `npm run schemas:generate`                                                                                                                                                                     | Generated schemas and formatting completed.                                                                               |
| `npm run check:version`                                                                                                                                                                        | Package, lockfile and changelog agree on 1.2.6.                                                                           |
| `npm run build`                                                                                                                                                                                | Application, ES library, declarations and Node entry checks passed. Existing Lucide `use client` bundler warnings remain. |
| `git diff --check`                                                                                                                                                                             | Passed.                                                                                                                   |
