# Runtime animation controller — v0.7.5

Historical verification report: the standalone `examples/` application has since been removed. Its commands and results below describe the recorded release, rather than the current checkout. See the [runtime integration guide](runtime-integration.md) for current usage.

[All guides](../README.md#guides)

This milestone hardens v0.7 with production regression coverage, a packed standalone example and measured CPU diagnostics. The controller remains optional: existing `puppet.play('idle')` consumers keep the same clocks, blending, authored events and pose/IK pipeline. No authored schema, editor workflow, dependency or CI policy changes are required.

## Public API review

Import browser APIs from `paper-puppeteer-engine/runtime` or the package root. `/core` exports `AnimationPlayer`, `AnimationStateController` and the same playback types without Phaser or React. Runtime modules never import editor code. `/data` and `/serialization` retain their existing contracts.

| API                                                               | Contract                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `puppet.play(name, options?): this`                               | Immediate selection; restart by default.                                                               |
| `puppet.hasAnimation(name): boolean`                              | Discover whether a registered clip exists.                                                             |
| `puppet.getPlaybackStatus(layer?): PlaybackStatus \| undefined`   | Detached current/held instance snapshot; default layer is `base`.                                      |
| `puppet.isPlaybackStopped(layer?): boolean`                       | Explicit channel freeze, independently of an already committed completion.                             |
| `puppet.onPlaybackLifecycle(listener, options?): () => void`      | Removable instance notifications; optional settled completion phase.                                   |
| `puppet.queue(name, options?): this`                              | Append finite base playback; idle starts immediately.                                                  |
| `puppet.getQueue(): readonly AnimationQueueRequest[]`             | Frozen, detached pending requests, excluding active playback.                                          |
| `puppet.clearQueue(): this`                                       | Remove pending requests.                                                                               |
| `puppet.stopQueue(): this`                                        | Remove pending requests and freeze base playback/fade.                                                 |
| `puppet.replaceQueue(requests): this`                             | Validate all requests, then replace base playback/FIFO; empty means stop.                              |
| `puppet.playAndWait(name, options?): Promise<PlaybackWaitResult>` | Play and observe that exact finite instance.                                                           |
| `puppet.waitForPlayback(options?): Promise<PlaybackWaitResult>`   | Observe the current instance without changing ownership.                                               |
| `new AnimationStateController(host, options)`                     | Validate configuration, subscribe and select the initial state. Host can be Puppet or AnimationPlayer. |
| `controller.setState(id, options?): this`                         | Select a persistent state; matching owned requests are idempotent.                                     |
| `controller.playAction(id, options?): this`                       | Play a named state once, then return after unclaimed natural completion.                               |
| `controller.currentState/currentAction/isActive/isDisposed`       | Persistent intent, temporary action and ownership/lifetime queries.                                    |
| `controller.dispose(): void`                                      | Unsubscribe, cancel automatic returns and release configuration and host references.                   |

AnimationPlayer uses `void` returns for playback commands and its existing `pause()`, `resume()`, `setSpeed()` and `dispose()` names. Puppet keeps chainable `pauseAnimation()`, `resumeAnimation()`, `setAnimationSpeed()` and `destroy()`. Both use the same implementation; no competing controller clock or queue was added.

`PlayAnimationOptions` types `restart`, `layer`, `loop`, `fadeDuration` and `speed`. Queue options intentionally expose only `fadeDuration` and `speed`. State configuration types persistent states, default/pair fades and instance-local loop overrides; action options add `returnTo`. Wait options type `signal` and, for observing current playback, `layer`. Unknown clips/states, invalid durations/speeds and invalid loop/restart/layer values produce errors before playback/queue mutation. Async validation rejects its promise. The new restart/layer guards also cover JavaScript callers bypassing TypeScript.

The existing exported types remain additive: `PlaybackInstanceId`, `PlaybackOutcome`, `PlaybackState`, `PlaybackStatus`, `PlaybackLifecycleEvent`, `PlaybackLifecycleOptions`, `PlaybackWaitResult`, `PlayAnimationOptions`, `PlayAndWaitOptions`, `WaitForPlaybackOptions`, `QueueAnimationOptions`, `AnimationQueueRequest`, `AnimationStateHost`, `AnimationStateDefinition`, `AnimationStateControllerOptions`, `SetAnimationStateOptions` and `AnimationActionOptions`.

## Basic playback, queues and states

These clip names exist in the [standalone character](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/e7576543a5f07cdfff5c23a95c5c3e63ffd9e7f4/examples/standalone/public/character/character.json):

```ts
puppet.play('idle');
puppet.play('walk', { fadeDuration: 150 });

// Stop the indefinite base loop before appending finite requests.
puppet.stopQueue();
puppet.queue('attack');
puppet.queue('recover', { fadeDuration: 100 });
```

Create the controller when named-state policy should take ownership of the base channel:

```ts
const controller = new AnimationStateController(puppet, {
  initialState: 'idle',
  defaultFadeDuration: 150,
  states: {
    idle: { animation: 'idle' },
    walking: { animation: 'walk' },
    running: { animation: 'run' },
    attack: { animation: 'attack' },
  },
});
controller.setState('walking');
controller.playAction('attack'); // Returns to walking after natural completion.
```

Pair transition durations override destination-state fade options, then the controller default. Explicit action fade options override those defaults. `setState(currentState)` preserves an active temporary action and pending requests; `{ restart: true }` explicitly takes control. A finite persistent state holds its completed pose. Controllers never automatically reclaim direct playback or a drained queue.

## Deterministic interaction matrix

| Operation                              | Base/queue/state precedence                                                                                                      | Other layers                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Direct `play()` / `playAndWait()`      | New base identity interrupts the old active instance, clears pending FIFO and releases state ownership.                          | Selected overlay IDs, masks and weights survive. |
| `play(..., { restart: false })`        | Matching selection retains its ID, clock, options and terminal status; a direct base call still clears pending FIFO.             | Other layers survive.                            |
| `queue()`                              | FIFO follows finite completion, after authored/immediate lifecycle/legacy callbacks. Requests behind an active loop reject.      | Unchanged.                                       |
| `replaceQueue()`                       | Fully validated replacement takes control; invalid input preserves everything.                                                   | Unchanged.                                       |
| State/action request starting playback | Ordinary base play takes precedence and clears pending FIFO.                                                                     | Unchanged.                                       |
| Action completion                      | A pending FIFO successor or callback-selected playback wins before automatic return. Stop also cancels return.                   | Unchanged.                                       |
| `clearQueue()`                         | Active playback and eligible action return remain.                                                                               | Unchanged.                                       |
| `waitForPlayback()` / abort            | Observes one exact identity; never takes control. Abort releases only that wait.                                                 | Independent per-layer waits.                     |
| `stopQueue()`                          | Stops base and its fade, removes FIFO, cancels action return.                                                                    | Continue advancing.                              |
| `stop()`                               | Stops all selected layers and fades; removes FIFO.                                                                               | Explicitly frozen, with held pose.               |
| `clearLayer(name)`                     | Base cannot be cleared through this API.                                                                                         | Only the named overlay is removed.               |
| Pause / speed                          | Global pause holds all clocks/fades; speed multiplies clip clocks. Zero speed holds clip time while real-time fades can advance. | Same clock rules.                                |
| `destroy()` / scene shutdown           | Active outcomes become disposed; waits settle; queued requests and notifications are released.                                   | All resources are released.                      |

Each instance has one terminal outcome. A clip reaching its endpoint remains `completed` even if an endpoint callback stops or destroys the host. Queue advancement starts its successor at time zero; a large update does not carry leftover delta into subsequent requests. Fade time is milliseconds of update time, independent of animation speed. Completion can precede a longer visual fade. Pause freezes that fade; base stop freezes it without freezing overlays.

Looping clips do not complete. Queues reject authored looping clips; use finite authored action/recovery clips. State actions force an instance-local `loop: false`. `playAndWait(name, { loop: false })` can observe one pass of an authored loop. A matching `restart: false` retains the selected instance's actual looping flag. Finite repeat counts remain unsupported.

## Lifecycle, authored events and async results

```ts
async function attackThenIdle(signal: AbortSignal): Promise<void> {
  const release = puppet.onPlaybackLifecycle((event) => {
    console.log(event.playbackId, event.layer, event.clip, event.type);
  });
  try {
    const result = await puppet.playAndWait('attack', { signal });
    if (result.status !== 'completed') {
      // interrupted, stopped, disposed, or cancelled: do not continue the sequence.
      console.info('Attack ended:', result.status);
      return;
    }
    // Completion callbacks/queues may already have selected newer playback.
    if (puppet.getPlaybackStatus()?.playbackId !== result.playback.playbackId) return;
    puppet.play('idle', { fadeDuration: 150 });
  } finally {
    release();
  }
}
```

The host's normal update loop drives playback while awaiting. AbortSignal cancellation returns `cancelled` without stopping the clip, clearing FIFO or cancelling an action's automatic return. An already-aborted signal skips validation/playback. Committed terminal outcomes take precedence over later cancellation. Validation/listener failures during start reject; callers should handle rejection as well as non-completed results. Scene cleanup should abort outstanding application operations and dispose the controller before destroying the puppet.

Lifecycle stays separate from `onAnimationEvent()` authored markers. Playback selection synchronizes rendering/IK before `started`, then time-zero markers. Updates deliver authored markers in existing timeline/loop order, immediate lifecycle completion, legacy `{ clip, layer }` completion, queue advancement, then settled lifecycle completion. The controller uses the settled phase to decide returns. Promises resume after synchronous notification processing. Callback replacements retain their own identity; compare IDs before acting on an old result.

Outgoing fade sources are visual samples after interruption, so they deliver neither authored markers nor completion. Active overlays retain their independent authored events and lifecycle. Listener exceptions are aggregated after remaining delivery; disposal suppresses stale ordinary notifications and drains pending waits from their committed outcomes.

## Crossfades, layers, IK and authoring compatibility

New deterministic regressions check numeric idle→walk, walk→run, attack→idle, FIFO successor and one-shot→persistent blends with partial masks and a weighted upper-body overlay. Outgoing identities terminate at replacement, while overlay identity, clock and pose remain. A base stop freezes only base/fade; global stop intentionally freezes all layers. Interrupted fades reuse existing pose snapshots and blending.

The exported-character integration checks state, queue and async selections against ordinary direct playback across authored hand-IK and baked clips. It compares every bone pose and retains the same constraint object and manual target. Existing suites cover leg IK, foot planting, weapon/grip constraints, animated targets, bake generation/commit, skins, facing and attachment projection. No state/queue code resets rig definitions or replaces solvers.

Full regression coverage includes CharacterLoader, package ZIP export/import, historical fixtures, stable serialization, Rig Editor, Animation Editor, New Animation, mirroring, onion skins, IK target authoring/baking, sprite replacement and Rig-Tweak mode. Automated local browser tests exercise the real editors and Phaser canvas. No manual visual acceptance is claimed.

## Cleanup and performance

`tests/runtimeControllerHardening.test.ts` uses explicit update deltas with no sleeps. It exercises callback replacement races, 100 controller/action/FIFO/cancel/wait cycles and twenty exported-character reload/shutdown cycles. Completed, interrupted, stopped, cancelled and disposed waits release lifecycle/abort handlers; assertions check zero pending wait disposers and scene listeners after cleanup. A disposed controller now also drops its host reference. Steady controller playback evaluates and synchronizes exactly once per update, with zero new render images/containers over 120 frames.

Dispose controllers explicitly as part of the owner's lifetime. A host with only terminal selections emits no new disposed playback outcome; in that case it still clears all host listeners, but cannot notify the controller through a new terminal event. Controller `dispose()` handles this case and leaves host playback/FIFO untouched. Shared textures remain owned by the scene/application, as before.

Run the optional CPU diagnostic separately from browser tests or other heavy checks:

```sh
VITE_PROFILE=1 npx vitest run tests/runtimeController.profile.test.ts --reporter=verbose
```

It uses the 16-bone shipped character with actual Puppet projection and IK, 100 warmup batches and seven measured batches of 300 updates. State workload changes state every update; queues rebuild after attack/recover completion; crossfades switch every ten updates; IK adds fixed arm/leg targets; async repeatedly starts and completes an attack then awaits its result. The harness awaits each batch; the async workload additionally includes a result await and assertion per Puppet. Construction/loading is outside the timed section. Timings exclude browser/DOM/GPU costs and impose no CI thresholds.

One local Node v24.19.0, macOS x86_64 run on 2026-10-16, with browser suites stopped, measured these warmed medians. A batch updates every Puppet once:

| Workload                         | One Puppet, ms/batch | Twenty Puppets, ms/batch |
| -------------------------------- | -------------------: | -----------------------: |
| Steady playback                  |               0.0363 |                   0.4703 |
| State change every update        |               0.1254 |                   2.2807 |
| FIFO playback/rebuild            |               0.0250 |                   0.4477 |
| Repeated crossfades              |               0.0486 |                   0.9454 |
| Fixed arm/leg IK targets         |               0.0364 |                   0.7981 |
| Start, complete and await attack |               0.0729 |                   1.5760 |

Continuous interrupted fades are the most expensive measured workload. These are observations from distinct warmed workloads and vary with hardware and runtime warmup. No browser frame-rate, heap-allocation or leak-proof claim follows from these CPU timings. The steady-update regression separately verifies one evaluation/synchronization and bounded renderer object creation.

## Verification and readiness

Verification date: 2026-10-16, Node v24.19.0. The runtime/API implementation, compatibility regressions, package integration and measured diagnostics pass. No release-blocking runtime regression was observed in completed checks. Readiness is qualified by the incomplete exhaustive browser catalog described below; no manual artistic acceptance is claimed.

| Command                             | Result                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                 | Passed, exit 0.                                                                                                                                                                 |
| `npm run test`                      | Passed, exit 0: 151 files passed, 4 skipped; 2,669 tests passed, 44 skipped (2,713 total). Skips are opt-in profiles, including the twelve new measured workloads.              |
| `npm run build`                     | Passed, exit 0: demo (2,233 modules), library (60 modules), declarations and plain Node core/import/async/IK/disposal checks.                                                   |
| `npm run lint`                      | Passed, exit 0.                                                                                                                                                                 |
| `npm run format:check`              | Passed, exit 0.                                                                                                                                                                 |
| `npm run check`                     | Passed, exit 0: formatting, lint and typecheck.                                                                                                                                 |
| `npm run check:version`             | Passed, exit 0: package, lockfile, standalone tarball and changelog agree on 0.7.5.                                                                                             |
| `npm run test:package`              | Passed, exit 0: actual prepack/install, documentation links, public declarations, Node compatibility, runtime isolation, standalone Node tests and standalone production build. |
| Standalone `npm run test`           | Passed, exit 0: both installed-package Node tests.                                                                                                                              |
| Standalone `npm run build`          | Passed, exit 0: TypeScript and Vite build against installed 0.7.5 tarball.                                                                                                      |
| Profile command above               | Passed, exit 0: twelve workloads; measurements above.                                                                                                                           |
| Editor release smoke command below  | Passed, exit 0: 22 tests across development and production, 3.6 minutes.                                                                                                        |
| Editor serial recheck command below | Passed, exit 0: six tests across development and production, 45.9 seconds.                                                                                                      |
| Standalone browser command below    | Passed, exit 0: all four tests, including the exact editor-export handoff; 13.2 seconds, no skipped cases.                                                                      |
| `git diff --check`                  | Passed, exit 0.                                                                                                                                                                 |

Exact local editor smoke command:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:browser -- \
  tests/browser/releaseWorkflow.spec.ts \
  tests/browser/animationRigTweak.spec.ts \
  tests/browser/newAnimation.spec.ts \
  tests/browser/animationBoneAuthoring.spec.ts \
  --workers=1 --timeout=90000
```

The editor-loading assertion and cases interrupted during parallel testing were rechecked serially:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:browser -- \
  tests/browser/animationEditor.spec.ts \
  tests/browser/animationClipboard.spec.ts \
  tests/browser/animationEvents.spec.ts \
  --grep 'unsaved animation settings|duplicate shortcut uses one authored frame|event draft commits before acquiring' \
  --workers=1 --timeout=90000
```

The development release-workflow test's exact ZIP was extracted into `/tmp/ppe-075-release-character`, then tested from `examples/standalone` with Node 24 on PATH:

```sh
PPE_WORKFLOW_CHARACTER_DIR=/tmp/ppe-075-release-character \
  PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

The default `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` was attempted: a long bone-authoring workflow exceeded its default 30-second timeout; the interrupted run recorded eight passes, one timeout, one interrupted case and 384 unrun cases. An attempted four-worker rerun hit a five-second editor-loading assertion timeout and was interrupted after seven passes; three other cases were interrupted and 383 did not run. The serial six-case recheck passed that loading assertion and the interrupted clipboard/event cases on both server modes. The serial 22-case smoke run above includes the previously timed-out workflow, which passed on both server modes. The entire 394-case catalog was **not** completed or reported as passing. Initial sandbox restrictions on localhost server binding were resolved by running the browser commands with the required local-process permission. Browser tests remain local-only; no CI browser steps or audit scheduling were added.

## Files, scope and next milestone

Runtime changes are confined to `AnimationPlayer.ts` argument guards and `AnimationStateController.ts` host-reference cleanup. New hardening/profile tests and exported consumer integration cover production interactions. The standalone application, three finite/locomotion clip assets, exporter fixture, packed Node/browser tests, package version/lockfile and developer guides form the milestone implementation.

| Area                   | Changed files                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime                | `src/engine/AnimationPlayer.ts`, `src/engine/AnimationStateController.ts`                                                                                                |
| Regression/diagnostics | `tests/runtimeControllerHardening.test.ts`, `tests/runtimeController.profile.test.ts`, `tests/characterRuntimeIntegration.test.ts`, `tests/helpers/consumerCharacter.ts` |
| Standalone application | `examples/standalone/src/main.ts`, `index.html`, `package.json`, `README.md`, `test/character.test.mjs`, `test/runtime.spec.ts`                                          |
| Standalone character   | `examples/standalone/public/character/character.json`, `animations/attack.json`, `animations/recover.json`, `animations/run.json`                                        |
| Package/guides         | `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, this report, `docs/animation-states.md`, `docs/runtime-integration.md`, `docs/profiling.md`            |

Limits remain explicit: base-only state controller/FIFO, no pending-request promises or finite repeat counts, no rollback of playback already committed before a callback error, and CPU profiles without GPU or heap-retention measurements. Multiple controllers can explicitly compete for a host; applications should assign one owner per base channel. Automated checks do not replace artistic review of character motion.

Future v0.8 recommendations: evaluate demand for finite repeat counts and observing queued requests before extending the public API; profile representative production characters before changing allocation/evaluation paths; keep scene lifetime and texture ownership explicit. Actor navigation, `walkTo()`/`lookAt()` choreography, multi-character sequencing, scene editors, physics, ragdolls and deformation remain outside this milestone.
