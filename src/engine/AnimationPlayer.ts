import type { AnimationClip, AnimationEvent, AnimationPlaybackMode, CompiledClip } from './AnimationClip.js';
import { compileClip, ownCompiledClip } from './AnimationClip.js';
import { type AnimationLayer, AnimationLayerEvaluator, type AnimationState } from './AnimationLayerEvaluator.js';
import { dispatchAnimationEvents } from './animationNotifications.js';
import type { AnimationPose } from './AnimationPose.js';
import type { AnimationQueueRequest, QueueAnimationOptions } from './AnimationQueue.js';
import {
  advanceAnimationTime,
  assertAnimationEventBudget,
  collectAnimationEvents,
  collectAnimationStartEvents,
  countAnimationEvents,
  countAnimationStartEvents,
  wrapAnimationTime,
} from './animationTimeline.js';
import type { IKAnimationPose } from './ik/AnimationIKPose.js';
import type { Joint } from './Joint.js';
import { dispatchListeners, throwNotificationErrors } from './notifications.js';
import type {
  PlaybackLifecycleEvent,
  PlaybackLifecycleOptions,
  PlaybackOutcome,
  PlaybackStatus,
  PlaybackWaitResult,
} from './PlaybackLifecycle.js';
import type { Rig } from './Rig.js';
import { assertFinite } from './types.js';

export interface PlayAnimationOptions extends QueueAnimationOptions {
  restart?: boolean;
  layer?: string;
  /** Override looping for this playback instance without changing the registered clip. */
  loop?: boolean;
}

export interface PlayAndWaitOptions extends PlayAnimationOptions {
  /** Abort releases this wait; playback continues unless stopOnAbort is enabled. */
  signal?: AbortSignal;
  /** Opt in to stopping only the newly selected instance on abort or a start failure.
   * Replacements, other layers and pending queue requests retain ownership. Defaults to false.
   */
  stopOnAbort?: boolean;
}

export interface WaitForPlaybackOptions {
  layer?: string;
  /** Abort releases only this wait. An already-aborted signal takes precedence over validation. */
  signal?: AbortSignal;
}

export interface SampleAnimationOptions {
  /** Raw interpolation by default; playback respects clip overrides and the player's playback mode. */
  mode?: 'raw' | 'playback';
}

export interface FiredAnimationEvent extends AnimationEvent {
  clip: string;
  layer: string;
}

export interface AnimationCompletion {
  clip: string;
  layer: string;
}

type PlaybackListener = (event: PlaybackLifecycleEvent) => void;
type PlaybackNotification =
  | {
      kind: 'lifecycle';
      event: PlaybackLifecycleEvent;
      listeners?: ReadonlySet<PlaybackListener>;
      completionPhase?: 'immediate' | 'settled';
    }
  | { kind: 'events'; events: readonly FiredAnimationEvent[] }
  | { kind: 'complete'; event: AnimationCompletion }
  | {
      kind: 'queue';
      playbackId: number | undefined;
      revision: number;
      preparePose: (() => void) | undefined;
      synchronizePose: (() => void) | undefined;
    };

function validateSpeed(speed: number): void {
  assertFinite(speed, 'Animation speed');
  if (speed < 0) throw new Error('Animation speed cannot be negative.');
}

/** Evaluates authored poses and layers. Puppet applies IK after this player writes the pose. */
export class AnimationPlayer {
  private readonly clips = new Map<string, CompiledClip>();
  private readonly layers = new Map<string, AnimationLayer>([
    ['base', { weight: 1, transition: undefined, stopped: false }],
  ]);
  private readonly eventListeners = new Set<(event: FiredAnimationEvent) => void>();
  private readonly completionListeners = new Set<(event: AnimationCompletion) => void>();
  private readonly lifecycleListeners = new Set<PlaybackListener>();
  private readonly settledCompletionListeners = new Set<PlaybackListener>();
  private disposalListeners: Set<PlaybackListener> | undefined;
  private readonly pendingWaitDisposers = new Set<() => void>();
  private readonly notifications: PlaybackNotification[] = [];
  private notifying = false;
  private notifyingLifecycle = false;
  private nextPlaybackId = 1;
  private readonly pendingQueue: AnimationQueueRequest[] = [];
  private queueRevision = 0;
  private readonly poseEvaluator: AnimationLayerEvaluator;
  private playback: AnimationPlaybackMode = { mode: 'smooth' };
  private speed = 1;
  private paused = false;
  private disposed = false;

  constructor(
    private readonly rig: Rig,
    private joints: ReadonlyMap<string, Joint>,
    compiledClips: readonly CompiledClip[] = [],
  ) {
    // Reuse compiled tracks, but check their references against this player's rig.
    for (const clip of compiledClips) {
      if (this.clips.has(clip.name)) throw new Error(`Animation "${clip.name}" is already registered.`);
      for (const track of clip.tracks) {
        if (!rig.hasBone(track.bone))
          throw new Error(`Animation "${clip.name}" references unknown bone "${track.bone}".`);
      }
      for (const track of clip.ikTracks ?? []) {
        if (!rig.ik?.some((constraint) => constraint.name === track.constraint))
          throw new Error(`Animation "${clip.name}" references unknown IK "${track.constraint}".`);
      }
      for (const name of clip.disabledIKConstraints ?? []) {
        if (!rig.ik?.some((constraint) => constraint.name === name))
          throw new Error(`Animation "${clip.name}" references unknown IK "${name}".`);
      }
      this.clips.set(clip.name, ownCompiledClip(clip));
    }
    this.poseEvaluator = new AnimationLayerEvaluator(rig, joints);
  }

  /** Immutable puppet-local target channels, including layer/fade ownership weights. */
  get ikAnimation(): IKAnimationPose {
    return this.poseEvaluator.ikEvaluator.current;
  }

  get currentAnimation(): string | undefined {
    return this.layers.get('base')?.state?.clip.name;
  }
  get elapsedTime(): number {
    return this.layers.get('base')?.state?.time ?? 0;
  }
  /** Duration in milliseconds of the active base clip, or zero when none is selected. */
  get duration(): number {
    return this.layers.get('base')?.state?.clip.duration ?? 0;
  }
  get isPlaying(): boolean {
    return this.layers.get('base')?.state?.playing ?? false;
  }
  get isPaused(): boolean {
    return this.paused;
  }
  get isDisposed(): boolean {
    return this.disposed;
  }
  get playbackSpeed(): number {
    return this.speed;
  }
  /** Clip-specific speed multiplier of the active base animation, or 1 when none is selected. */
  get currentAnimationSpeed(): number {
    return this.layers.get('base')?.state?.speed ?? 1;
  }
  get playbackMode(): AnimationPlaybackMode {
    return { ...this.playback };
  }
  get transition(): { from: string; to: string; progress: number } | undefined {
    const layer = this.layers.get('base');
    const transition = layer?.transition;
    if (!transition || !layer?.state) return undefined;
    return {
      from: transition.source instanceof Map ? 'previous pose' : transition.source.clip.name,
      to: layer.state.clip.name,
      progress: this.poseEvaluator.transitionWeight(layer.state, transition, this.playback),
    };
  }

  getLayerAnimation(name: string): string | undefined {
    return this.layers.get(name)?.state?.clip.name;
  }
  getLayerWeight(name: string): number {
    return this.layers.get(name)?.weight ?? 0;
  }

  /** Current or held terminal playback for a layer; absent before play, after clear, or after disposal. */
  getPlaybackStatus(layer = 'base'): PlaybackStatus | undefined {
    const state = this.layers.get(layer)?.state;
    return state ? this.playbackStatus(state, layer) : undefined;
  }

  /** Explicit channel freeze, including a stop requested after its instance already completed. */
  isPlaybackStopped(layer = 'base'): boolean {
    return this.layers.get(layer)?.stopped ?? false;
  }

  onPlaybackLifecycle(listener: PlaybackListener, options: PlaybackLifecycleOptions = {}): () => void {
    this.assertActive();
    if (
      options.completionPhase !== undefined &&
      options.completionPhase !== 'immediate' &&
      options.completionPhase !== 'settled'
    )
      throw new Error('Unsupported lifecycle completion phase.');
    this.lifecycleListeners.add(listener);
    if (options.completionPhase === 'settled') this.settledCompletionListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
      this.settledCompletionListeners.delete(listener);
      this.disposalListeners?.delete(listener);
    };
  }

  addAnimation(clip: AnimationClip): void {
    this.assertActive();
    if (this.clips.has(clip.name)) throw new Error(`Animation "${clip.name}" is already registered.`);
    this.clips.set(clip.name, compileClip(clip, this.rig));
  }

  hasAnimation(name: string): boolean {
    return this.clips.has(name);
  }

  /** Restart the clip unless restart:false keeps it active. Host hooks prepare after validation
   * and synchronize the evaluated pose before time-zero events are delivered.
   */
  play(name: string, options: PlayAnimationOptions = {}, preparePose?: () => void, synchronizePose?: () => void): void {
    this.playAnimation(name, options, preparePose, synchronizePose);
  }

  /** Play and await this exact finite instance. Validation errors reject the promise. */
  playAndWait(
    name: string,
    options: PlayAndWaitOptions = {},
    preparePose?: () => void,
    synchronizePose?: () => void,
  ): Promise<PlaybackWaitResult> {
    return this.waitForSelection(
      (select) => {
        if (options.stopOnAbort !== undefined && typeof options.stopOnAbort !== 'boolean')
          throw new Error('stopOnAbort must be a boolean.');
        if (options.stopOnAbort && options.restart === false)
          throw new Error('Owned playback waits require a fresh instance; omit restart:false.');
        this.playAnimation(name, options, preparePose, synchronizePose, false, select);
      },
      options.signal,
      options.stopOnAbort === true,
    );
  }

  /** Await the selected instance, including a held terminal outcome; never follows replacements. */
  waitForPlayback(options: WaitForPlaybackOptions = {}): Promise<PlaybackWaitResult> {
    return this.waitForSelection((select) => {
      this.assertActive();
      const layer = options.layer ?? 'base';
      const state = this.layers.get(layer)?.state;
      if (!state) throw new Error(`No animation playback selected on layer "${layer}".`);
      select(state, layer);
    }, options.signal);
  }

  private assertWaitable(clip: CompiledClip): void {
    if (clip.loop)
      throw new Error(
        `Cannot await indefinitely looping animation "${clip.name}"; use playAndWait with { loop: false } or play() instead.`,
      );
  }

  private waitForSelection(
    start: (select: (state: AnimationState, layer: string) => void) => void,
    signal?: AbortSignal,
    stopOnAbort = false,
  ): Promise<PlaybackWaitResult> {
    return new Promise((resolve, reject) => {
      let selected: { state: AnimationState; layer: string } | undefined;
      let settled = false;
      let releaseLifecycle: (() => void) | undefined;
      const cleanup = (): void => {
        releaseLifecycle?.();
        releaseLifecycle = undefined;
        signal?.removeEventListener('abort', abort);
        this.pendingWaitDisposers.delete(dispose);
      };
      const finish = (status: PlaybackOutcome | 'cancelled', playback?: PlaybackStatus): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (status === 'cancelled') resolve(playback ? { status, playback } : { status });
        else if (playback) resolve({ status, playback });
      };
      const snapshot = (): PlaybackStatus | undefined =>
        selected ? this.playbackStatus(selected.state, selected.layer) : undefined;
      const stopOwnedSelection = (): void => {
        if (!stopOnAbort || !selected || this.disposed || selected.state.outcome) return;
        const layer = this.layers.get(selected.layer);
        if (layer?.state !== selected.state) return;
        const lifecycle: PlaybackLifecycleEvent[] = [];
        this.finishPlayback(selected.state, selected.layer, 'stopped', lifecycle);
        layer.stopped = true;
        this.dispatchNotifications([], [], lifecycle);
      };
      const abort = (): void => {
        if (settled) return;
        const outcome = selected?.state.outcome ?? 'cancelled';
        const playback = snapshot();
        // Release the wait before stopping, so its own stopped notification cannot win cancellation.
        settled = true;
        cleanup();
        try {
          stopOwnedSelection();
          if (outcome === 'cancelled') resolve(playback ? { status: outcome, playback } : { status: outcome });
          else if (playback) resolve({ status: outcome, playback });
        } catch (error) {
          reject(error);
        }
      };
      // Disposal can suppress queued terminal notifications (e.g. from an end-marker callback).
      // Read the same instance's committed lifecycle outcome before player cleanup drops it.
      const dispose = (): void => finish(selected!.state.outcome!, snapshot());
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      try {
        start((state, layer) => {
          if (!state.outcome) this.assertWaitable(state.clip);
          selected = { state, layer };
          if (settled) return;
          if (state.outcome) {
            finish(state.outcome, snapshot());
            return;
          }
          releaseLifecycle = this.onPlaybackLifecycle((event) => {
            if (event.playbackId !== state.playbackId) return;
            if (
              event.type === 'completed' ||
              event.type === 'interrupted' ||
              event.type === 'stopped' ||
              event.type === 'disposed'
            ) {
              const { type, ...playback } = event;
              finish(type, playback);
            }
          });
          this.pendingWaitDisposers.add(dispose);
        });
        // Pose preparation may abort before the instance is selected.
        if (signal?.aborted) stopOwnedSelection();
      } catch (error) {
        settled = true;
        cleanup();
        try {
          stopOwnedSelection();
          reject(error);
        } catch (stopError) {
          reject(new AggregateError([error, stopError], 'Playback start and owned cleanup failed.', { cause: error }));
        }
      }
    });
  }

  private playAnimation(
    name: string,
    options: PlayAnimationOptions = {},
    preparePose?: () => void,
    synchronizePose?: () => void,
    fromQueue = false,
    select?: (state: AnimationState, layer: string) => void,
  ): void {
    this.assertActive();
    const registered = this.clips.get(name);
    if (!registered) throw new Error(`Unknown animation "${name}".`);
    if (options.loop !== undefined && typeof options.loop !== 'boolean')
      throw new Error('Animation loop must be a boolean.');
    // Only metadata varies; the existing evaluator still consumes the shared compiled tracks.
    const clip =
      options.loop === undefined || options.loop === registered.loop
        ? registered
        : Object.freeze({ ...registered, loop: options.loop });
    const layerName = options.layer ?? 'base';
    if (typeof layerName !== 'string' || !layerName.trim()) throw new Error('Layer name must be a nonempty string.');
    if (options.restart !== undefined && typeof options.restart !== 'boolean')
      throw new Error('Animation restart must be a boolean.');
    const fade = options.fadeDuration ?? 0;
    assertFinite(fade, 'Fade duration');
    if (fade < 0) throw new Error('Fade duration cannot be negative.');
    const speed = options.speed ?? 1;
    validateSpeed(speed);
    if (options.restart === false && this.layers.get(layerName)?.state?.clip.name === name) {
      select?.(this.layers.get(layerName)!.state!, layerName);
      if (layerName === 'base' && !fromQueue) this.discardQueue();
      synchronizePose?.();
      return;
    }
    if (select) this.assertWaitable(clip);
    const events = collectAnimationStartEvents(clip, layerName);
    if (layerName === 'base' && !fromQueue) this.discardQueue();
    preparePose?.();
    const layer = this.getOrCreateLayer(layerName);
    let source: AnimationState | AnimationPose | undefined;
    const ikSource =
      fade > 0 && layer.transition ? this.poseEvaluator.ikEvaluator.snapshotLayer(layerName, this.layers) : undefined;
    if (fade > 0) {
      if (layer.state)
        source = layer.transition
          ? this.poseEvaluator.evaluateLayer(
              layer,
              this.poseEvaluator.underlyingPose(layerName, this.layers, this.playback),
              this.playback,
              true,
            )
          : { ...layer.state };
      else if (layerName !== 'base') source = new Map();
    }
    if (layerName !== 'base' && !source) this.poseEvaluator.resetLayerProperties(layer);
    const lifecycle: PlaybackLifecycleEvent[] = [];
    // The outgoing clock may survive as a visual fade source, but its playback ends now.
    if (layer.state) this.finishPlayback(layer.state, layerName, 'interrupted', lifecycle);
    layer.state = { playbackId: this.nextPlaybackId++, clip, time: 0, speed, playing: true };
    lifecycle.push({ ...this.playbackStatus(layer.state, layerName), type: 'started' });
    layer.transition = source ? { source, elapsed: 0, duration: fade, ...(ikSource ? { ikSource } : {}) } : undefined;
    layer.stopped = false;
    select?.(layer.state, layerName);
    this.poseEvaluator.invalidate();
    if (layerName === 'base' && !source) this.resetPose();
    this.applyCurrentPose();
    synchronizePose?.();
    this.dispatchNotifications(events, [], lifecycle);
  }

  /** Append a nonlooping base request. Idle playback starts synchronously, including while paused. */
  queue(
    name: string,
    options: QueueAnimationOptions = {},
    preparePose?: () => void,
    synchronizePose?: () => void,
  ): void {
    this.assertActive();
    const request = this.validateQueueRequest({ name, options });
    const active = this.layers.get('base')?.state;
    if (active?.playing && active.clip.loop)
      throw new Error('Cannot queue behind an indefinitely looping base animation; replace or stop it first.');
    this.pendingQueue.push(request);
    if (!active?.playing) {
      this.notifications.push(this.queueNotification(active?.playbackId, preparePose, synchronizePose));
      this.flushNotifications();
    }
  }

  /** Detached, frozen pending requests; the active selection is available through playback status. */
  getQueue(): readonly AnimationQueueRequest[] {
    return Object.freeze([...this.pendingQueue]);
  }

  /** Discard pending requests and leave active playback untouched. */
  clearQueue(): void {
    this.assertActive();
    this.discardQueue();
  }

  /** Discard pending requests and freeze only the base channel, retaining its held pose/fade. */
  stopQueue(): void {
    this.assertActive();
    this.discardQueue();
    const layer = this.layers.get('base');
    const lifecycle: PlaybackLifecycleEvent[] = [];
    if (layer?.state) this.finishPlayback(layer.state, 'base', 'stopped', lifecycle);
    if (layer) layer.stopped = true;
    this.dispatchNotifications([], [], lifecycle);
  }

  /** Validate the entire replacement before interrupting the base; an empty replacement stops it. */
  replaceQueue(
    requests: readonly AnimationQueueRequest[],
    preparePose?: () => void,
    synchronizePose?: () => void,
  ): void {
    this.assertActive();
    const input = requests;
    if (!Array.isArray(requests)) throw new Error('Animation queue requests must be an array.');
    const validated: AnimationQueueRequest[] = [];
    for (const request of input) validated.push(this.validateQueueRequest(request));
    const first = validated.shift();
    if (!first) {
      this.stopQueue();
      return;
    }
    this.discardQueue();
    for (const request of validated) this.pendingQueue.push(request);
    this.playAnimation(first.name, first.options, preparePose, synchronizePose, true);
  }

  private validateQueueRequest(request: AnimationQueueRequest): AnimationQueueRequest {
    if (!request || typeof request !== 'object') throw new Error('Invalid animation queue request.');
    for (const key of Object.keys(request)) {
      if (key !== 'name' && key !== 'options') throw new Error(`Unsupported queue request field "${key}".`);
    }
    const clip = this.clips.get(request.name);
    if (!clip) throw new Error(`Unknown animation "${request.name}".`);
    if (clip.loop) throw new Error(`Cannot queue indefinitely looping animation "${request.name}".`);
    const options = request.options === undefined ? {} : request.options;
    if (typeof options !== 'object' || options === null || Array.isArray(options))
      throw new Error('Invalid animation queue options.');
    for (const key of Object.keys(options)) {
      if (key !== 'fadeDuration' && key !== 'speed') throw new Error(`Unsupported queue option "${key}".`);
    }
    const fadeDuration = options.fadeDuration === undefined ? 0 : options.fadeDuration;
    assertFinite(fadeDuration, 'Fade duration');
    if (fadeDuration < 0) throw new Error('Fade duration cannot be negative.');
    const speed = options.speed === undefined ? 1 : options.speed;
    validateSpeed(speed);
    assertAnimationEventBudget(countAnimationStartEvents(clip), 'start');
    return Object.freeze({ name: clip.name, options: Object.freeze({ fadeDuration, speed }) });
  }

  private discardQueue(): void {
    this.pendingQueue.length = 0;
    this.queueRevision++;
  }

  private queueNotification(
    playbackId: number | undefined,
    preparePose?: () => void,
    synchronizePose?: () => void,
  ): PlaybackNotification {
    return { kind: 'queue', playbackId, revision: this.queueRevision, preparePose, synchronizePose };
  }

  private advanceQueue(notification: Extract<PlaybackNotification, { kind: 'queue' }>): void {
    if (this.disposed || notification.revision !== this.queueRevision) return;
    const state = this.layers.get('base')?.state;
    if (state?.playbackId !== notification.playbackId || state?.playing) return;
    const next = this.pendingQueue.shift();
    if (next) this.playAnimation(next.name, next.options, notification.preparePose, notification.synchronizePose, true);
  }

  stop(): void {
    this.assertActive();
    this.discardQueue();
    const lifecycle: PlaybackLifecycleEvent[] = [];
    for (const [name, layer] of this.layers) {
      if (layer.state) this.finishPlayback(layer.state, name, 'stopped', lifecycle);
      layer.stopped = true;
    }
    this.dispatchNotifications([], [], lifecycle);
  }
  /** Restart every selected layer together, preserving speeds, masks, weights, and pause state. */
  restart(preparePose?: () => void, synchronizePose?: () => void): void {
    this.assertActive();
    if (![...this.layers.values()].some((layer) => layer.state)) {
      this.discardQueue();
      synchronizePose?.();
      return;
    }
    // Restart is one notification boundary, including every selected layer.
    let eventCount = 0;
    for (const layer of this.layers.values()) {
      if (layer.state) eventCount += countAnimationStartEvents(layer.state.clip);
      assertAnimationEventBudget(eventCount, 'restart');
    }
    this.discardQueue();
    preparePose?.();
    this.resetPose();
    const events: FiredAnimationEvent[] = [];
    const lifecycle: PlaybackLifecycleEvent[] = [];
    for (const [name, layer] of this.layers) {
      if (!layer.state) continue;
      const { clip, speed } = layer.state;
      this.finishPlayback(layer.state, name, 'interrupted', lifecycle);
      layer.state = { playbackId: this.nextPlaybackId++, clip, time: 0, speed, playing: true };
      lifecycle.push({ ...this.playbackStatus(layer.state, name), type: 'started' });
      layer.transition = undefined;
      layer.stopped = false;
      for (const event of collectAnimationStartEvents(layer.state.clip, name)) events.push(event);
    }
    this.poseEvaluator.invalidate();
    this.applyCurrentPose();
    synchronizePose?.();
    this.dispatchNotifications(events, [], lifecycle);
  }
  pause(): void {
    this.assertActive();
    if (this.paused) return;
    this.paused = true;
    this.notifyPauseChange('paused');
  }
  resume(): void {
    this.assertActive();
    if (!this.paused) return;
    this.paused = false;
    this.notifyPauseChange('resumed');
  }
  setSpeed(speed: number): void {
    this.assertActive();
    validateSpeed(speed);
    this.speed = speed;
  }

  setPlaybackMode(mode: AnimationPlaybackMode, preparePose?: () => void): void {
    this.assertActive();
    if (mode.mode === 'stepped') {
      assertFinite(mode.fps, 'Animation FPS');
      if (mode.fps <= 0) throw new Error('Animation FPS must be greater than zero.');
    } else if (mode.mode !== 'smooth') throw new Error('Unsupported playback mode.');
    preparePose?.();
    this.playback = { ...mode };
    this.applyCurrentPose();
  }

  setLayerMask(name: string, bones: readonly string[], preparePose?: () => void): void {
    this.assertActive();
    if (!name) throw new Error('Layer name cannot be empty.');
    if (name === 'base') throw new Error('The base layer cannot have a bone mask.');
    for (const id of bones) this.rig.getBone(id);
    preparePose?.();
    const layer = this.getOrCreateLayer(name);
    this.poseEvaluator.resetLayerProperties(layer);
    layer.mask = new Set(bones);
    this.poseEvaluator.invalidate();
    this.applyCurrentPose();
  }

  setLayerWeight(name: string, weight: number, preparePose?: () => void): void {
    this.assertActive();
    if (!name) throw new Error('Layer name cannot be empty.');
    if (name === 'base') throw new Error('The base layer weight is fixed at 1.');
    assertFinite(weight, 'Layer weight');
    if (weight < 0 || weight > 1) throw new Error('Layer weight must be between 0 and 1.');
    preparePose?.();
    const layer = this.getOrCreateLayer(name);
    if (weight === 0 && layer.weight > 0) this.poseEvaluator.resetLayerProperties(layer);
    layer.weight = weight;
    this.poseEvaluator.invalidate();
    this.applyCurrentPose();
  }

  clearLayer(name: string, preparePose?: () => void, synchronizePose?: () => void): void {
    this.assertActive();
    if (!name) throw new Error('Layer name cannot be empty.');
    if (name === 'base') throw new Error('The base layer cannot be cleared.');
    preparePose?.();
    const layer = this.layers.get(name);
    const lifecycle: PlaybackLifecycleEvent[] = [];
    if (layer?.state) this.finishPlayback(layer.state, name, 'stopped', lifecycle);
    if (layer) this.poseEvaluator.resetLayerProperties(layer);
    this.layers.delete(name);
    this.poseEvaluator.invalidate();
    this.applyCurrentPose();
    synchronizePose?.();
    this.dispatchNotifications([], [], lifecycle);
  }

  /** Remove clip and layer state without changing registered clips. */
  clearAllLayers(): void {
    this.assertActive();
    this.discardQueue();
    const lifecycle: PlaybackLifecycleEvent[] = [];
    for (const [name, layer] of this.layers) {
      if (layer.state) this.finishPlayback(layer.state, name, 'stopped', lifecycle);
    }
    this.layers.clear();
    this.layers.set('base', { weight: 1, transition: undefined, stopped: false });
    this.poseEvaluator.ikEvaluator.clear();
    this.poseEvaluator.invalidate();
    this.dispatchNotifications([], [], lifecycle);
  }

  onAnimationEvent(listener: (event: FiredAnimationEvent) => void): () => void {
    this.assertActive();
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onAnimationComplete(listener: (event: AnimationCompletion) => void): () => void {
    this.assertActive();
    this.completionListeners.add(listener);
    return () => this.completionListeners.delete(listener);
  }

  resetPose(): void {
    this.assertActive();
    for (const joint of this.joints.values()) joint.reset();
    this.poseEvaluator.ikEvaluator.clear();
  }

  /** Advance playback and return whether this call evaluated the authored pose.
   * The optional preparation callback runs after validation, before clocks or poses change.
   * Paused or stopped playback does not invoke it.
   * The synchronization callback runs after evaluation and before notifications.
   */
  update(delta: number, preparePose?: () => void, synchronizePose?: () => void): boolean {
    if (this.disposed) return false;
    assertFinite(delta, 'Animation delta');
    if (delta < 0) throw new Error('Animation delta cannot be negative.');
    if (this.paused) return false;
    let advancing = false;
    for (const layer of this.layers.values()) {
      if (layer.state?.playing || (layer.transition && !layer.stopped)) {
        advancing = true;
        break;
      }
    }
    if (!advancing) return false;
    // Validate every clock and the total catch-up work before mutating any layer.
    let eventCount = 0;
    for (const layer of this.layers.values()) {
      const state = layer.state;
      if (state?.playing) {
        const end = advanceAnimationTime(state, delta, this.speed);
        eventCount += countAnimationEvents(state.clip, state.time, end);
        assertAnimationEventBudget(eventCount);
      }
      const source = layer.transition?.source;
      if (!layer.stopped && source && !(source instanceof Map) && source.playing)
        advanceAnimationTime(source, delta, this.speed);
    }
    preparePose?.();
    const events: FiredAnimationEvent[] = [];
    const completions: PlaybackLifecycleEvent[] = [];
    for (const [name, layer] of this.layers) {
      if (!layer.state) continue;
      const state = layer.state;
      if (state.playing) this.advance(state, delta, name, events, completions);
      if (layer.transition && !layer.stopped) {
        const source = layer.transition.source;
        if (!(source instanceof Map) && source.playing) this.advance(source, delta);
        layer.transition.elapsed = Math.min(layer.transition.duration, layer.transition.elapsed + delta);
      }
    }
    this.applyCurrentPose();
    try {
      synchronizePose?.();
    } finally {
      for (const layer of this.layers.values()) {
        if (layer.transition && layer.transition.elapsed >= layer.transition.duration) {
          layer.transition = undefined;
          this.poseEvaluator.invalidate();
        }
      }
    }
    this.dispatchNotifications(events, completions, [], preparePose, synchronizePose);
    return true;
  }

  /** Sample only the base clip, clamping time without moving clocks or firing events.
   * Reset properties owned by fades/layers to bind values; retain untracked manual edits.
   */
  sample(time: number, options: SampleAnimationOptions = {}, preparePose?: () => void): void {
    this.assertActive();
    assertFinite(time, 'Sample time');
    const state = this.layers.get('base')?.state;
    if (!state) return;
    preparePose?.();
    this.poseEvaluator.sample(state, time, options.mode === 'playback', this.layers, this.playback);
  }

  /** Reapply the held authored pose; useful before external per-frame adjustments. */
  applyCurrentPose(): void {
    this.assertActive();
    this.poseEvaluator.applyCurrentPose(this.layers, this.playback);
  }

  private advance(
    state: AnimationState,
    delta: number,
    layer?: string,
    events?: FiredAnimationEvent[],
    completions?: PlaybackLifecycleEvent[],
  ): void {
    const previous = state.time;
    const end = advanceAnimationTime(state, delta, this.speed);
    if (end === previous) return;
    if (layer && events) {
      for (const event of collectAnimationEvents(state.clip, previous, end, layer)) events.push(event);
    }
    state.time = state.clip.loop ? wrapAnimationTime(state.clip, end) : end;
    if (!state.clip.loop && end >= state.clip.duration) {
      state.playing = false;
      if (layer && completions) this.finishPlayback(state, layer, 'completed', completions);
    }
  }

  private playbackStatus(state: AnimationState, layer: string): PlaybackStatus {
    return {
      playbackId: state.playbackId,
      clip: state.clip.name,
      layer,
      status: state.outcome ?? (this.paused ? 'paused' : 'playing'),
      elapsedTime: state.time,
      duration: state.clip.duration,
      loop: state.clip.loop,
    };
  }

  private finishPlayback(
    state: AnimationState,
    layer: string,
    outcome: PlaybackOutcome,
    events: PlaybackLifecycleEvent[],
  ): void {
    if (state.outcome) return;
    state.outcome = outcome;
    state.playing = false;
    events.push({ ...this.playbackStatus(state, layer), type: outcome });
  }

  private notifyPauseChange(type: 'paused' | 'resumed'): void {
    const lifecycle: PlaybackLifecycleEvent[] = [];
    for (const [name, layer] of this.layers) {
      if (layer.state && !layer.state.outcome) lifecycle.push({ ...this.playbackStatus(layer.state, name), type });
    }
    this.dispatchNotifications([], [], lifecycle);
  }

  /** Queue lifecycle-driven requests, while retaining synchronous nested authored/legacy callbacks. */
  private dispatchNotifications(
    events: readonly FiredAnimationEvent[],
    completions: readonly PlaybackLifecycleEvent[],
    lifecycle: readonly PlaybackLifecycleEvent[] = [],
    preparePose?: () => void,
    synchronizePose?: () => void,
  ): void {
    const notifications: PlaybackNotification[] = [];
    for (const event of lifecycle) notifications.push({ kind: 'lifecycle', event });
    if (events.length) notifications.push({ kind: 'events', events });
    for (const event of completions) {
      notifications.push({ kind: 'lifecycle', event, completionPhase: 'immediate' });
      // Keep the legacy completion payload and its ordering after authored events.
      notifications.push({ kind: 'complete', event: { clip: event.clip, layer: event.layer } });
    }
    const baseCompletion = completions.find((event) => event.layer === 'base');
    if (baseCompletion)
      notifications.push(this.queueNotification(baseCompletion.playbackId, preparePose, synchronizePose));
    for (const event of completions) notifications.push({ kind: 'lifecycle', event, completionPhase: 'settled' });
    if (this.notifying && !this.notifyingLifecycle) {
      throwNotificationErrors(this.deliverNotifications(notifications), 'Animation listeners failed.');
      return;
    }
    for (const notification of notifications) this.notifications.push(notification);
    this.flushNotifications();
  }

  /** Stable snapshots, isolated payloads, and error aggregation also cover reentrant requests. */
  private flushNotifications(): void {
    if (this.notifying) return;
    this.notifying = true;
    let errors: unknown[];
    try {
      errors = this.deliverNotifications(this.notifications);
    } finally {
      this.notifying = false;
      this.disposalListeners?.clear();
      this.disposalListeners = undefined;
    }
    throwNotificationErrors(errors, 'Animation listeners failed.');
  }

  private deliverNotifications(notifications: PlaybackNotification[]): unknown[] {
    const errors: unknown[] = [];
    let notification: PlaybackNotification | undefined;
    while ((notification = notifications.shift())) {
      const wasNotifyingLifecycle = this.notifyingLifecycle;
      this.notifyingLifecycle = notification.kind === 'lifecycle' || notification.kind === 'queue';
      try {
        if (notification.kind === 'queue') {
          try {
            this.advanceQueue(notification);
          } catch (error) {
            errors.push(error);
          }
        } else if (notification.kind === 'events') {
          errors.push(...dispatchAnimationEvents(notification.events, this.eventListeners, () => !this.disposed));
        } else if (notification.kind === 'complete') {
          const { event } = notification;
          errors.push(
            ...dispatchListeners(
              this.completionListeners,
              (listener) => listener({ ...event }),
              () => !this.disposed,
            ),
          );
        } else {
          const { event, completionPhase } = notification;
          const listeners =
            notification.listeners ??
            (completionPhase === 'settled'
              ? this.settledCompletionListeners
              : completionPhase === 'immediate'
                ? new Set(
                    [...this.lifecycleListeners].filter((listener) => !this.settledCompletionListeners.has(listener)),
                  )
                : this.lifecycleListeners);
          errors.push(
            ...dispatchListeners(
              listeners,
              (listener) => listener({ ...event }),
              () => event.type === 'disposed' || !this.disposed,
            ),
          );
        }
      } finally {
        this.notifyingLifecycle = wasNotifyingLifecycle;
      }
    }
    return errors;
  }

  /** Release listeners, clips, layers, and joint references without changing the host's held pose. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.discardQueue();
    const lifecycle: PlaybackLifecycleEvent[] = [];
    for (const [name, layer] of this.layers) {
      if (layer.state) this.finishPlayback(layer.state, name, 'disposed', lifecycle);
    }
    for (const disposeWait of this.pendingWaitDisposers) disposeWait();
    // Cancel pending notifications from the old host. Only disposal delivery survives cleanup.
    this.notifications.length = 0;
    const listeners = new Set(this.lifecycleListeners);
    this.disposalListeners = listeners;
    for (const event of lifecycle) this.notifications.push({ kind: 'lifecycle', event, listeners });
    this.lifecycleListeners.clear();
    this.settledCompletionListeners.clear();
    this.eventListeners.clear();
    this.completionListeners.clear();
    this.clips.clear();
    this.layers.clear();
    this.poseEvaluator.dispose();
    this.joints = new Map();
    this.playback = { mode: 'smooth' };
    this.speed = 1;
    this.paused = false;
    this.flushNotifications();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('AnimationPlayer has been disposed.');
  }

  private getOrCreateLayer(name: string): AnimationLayer {
    let layer = this.layers.get(name);
    if (!layer) {
      layer = { weight: 1, transition: undefined, stopped: false };
      this.layers.set(name, layer);
    }
    return layer;
  }
}
