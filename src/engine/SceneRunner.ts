import type { Actor } from './Actor.js';
import { evaluateCameraAtTime } from './cameraAnimation.js';
import {
  applyCinematicCamera,
  type CameraViewport,
  type CinematicCameraTarget,
  type CinematicCameraState,
} from './cinematicCamera.js';
import { throwNotificationErrors } from './notifications.js';
import { getOwnershipRevision } from './ownershipRevision.js';
import { freezeData, type DeepReadonly } from './readonlyData.js';
import { SceneAudioController, type SceneAudioOptions } from './SceneAudioController.js';
import {
  parseSceneDefinition,
  sceneActionDuration,
  type SceneActionDefinition,
  type SceneActorDefinition,
  type SceneDefinition,
} from './SceneDefinition.js';
import { getDialogueAtTime, type SceneDialogueTarget } from './sceneDialogue.js';
import { sceneActorDepth, sceneLayer } from './sceneLayers.js';
import {
  CLEAR_SCENE_TRANSITION,
  evaluateTransitionAtTime,
  type SceneTransitionState,
  type SceneTransitionTarget,
} from './sceneTransitions.js';
import { assertFinite } from './types.js';

export type SceneRunnerStatus =
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'disposed'
  | 'failed';
export interface SceneCue {
  readonly name: string;
  readonly actorId: string;
  readonly actionId: string;
  readonly time: number;
  readonly payload?: unknown;
}
export interface SceneRunnerOptions {
  /** Optional exclusive audio owner. Call runner.audio.unlock() from a user gesture before play. */
  readonly audio?: SceneAudioOptions;
  /** Return a fresh, exclusively owned Actor with autoUpdate:false, no state policy,
   * gameplay lifecycle/update listeners, queued commands, or procedural IK target providers. The runner
   * disposes these isolated contexts on seek/restart. Shared character assets are fine.
   */
  readonly createActor: (definition: DeepReadonly<SceneActorDefinition>, depth: number) => Actor;
  /** Only delivered by actual playback, never by snapshot reconstruction. */
  readonly onCue?: (cue: SceneCue) => void;
  /** Optional host camera, evaluated on the Actor clock. Viewport is read again after resize. */
  readonly camera?: { readonly target: CinematicCameraTarget; readonly viewport?: () => CameraViewport };
  /** Render-only sample notification after clock commands, including seeks and stop. */
  readonly onCamera?: (state: Readonly<CinematicCameraState>) => void;
  /** Host-owned overlay; cleared on disposal/failure/cancel. Never dispatches scene cues. */
  readonly transitionOverlay?: SceneTransitionTarget;
  readonly onTransition?: (state: SceneTransitionState) => void;
  /** Host-owned render target. Receives deterministic samples on playback and seek;
   * cleared on stop/cancel/failure/disposal. Never use it for gameplay side effects.
   */
  readonly dialoguePresentation?: SceneDialogueTarget;
}

/** Declarative scene adapter over the v0.8 Actor runtime. Owns one millisecond clock;
 * action boundaries, rather than Promise continuations, determine scheduling order.
 * Arbitrary choreography scripts/callbacks are deliberately not a seeking input.
 */
export class SceneRunner {
  readonly definition: DeepReadonly<SceneDefinition>;
  readonly audio: SceneAudioController | undefined;
  private instances = new Map<string, Actor>();
  private releases: (() => void)[] = [];
  private readonly actions: DeepReadonly<SceneActionDefinition>[];
  private readonly boundaries: number[];
  private readonly starts = new Map<number, DeepReadonly<SceneActionDefinition>[]>();
  private readonly ends = new Map<number, DeepReadonly<SceneActionDefinition>[]>();
  private nextBoundary = 1;
  private readonly activeAnimations = new Map<string, number>();
  private readonly rootMotionActors = new Set<string>();
  private readonly ownedAnimations = new Map<string, number>();
  private readonly activeMoves = new Map<string, { actionId: string; requestId: number }>();
  private checkedOwnershipRevision = -1;
  private generation = 0;
  private ownCommand = false;
  private started = false;
  private stepping = false;
  private seeking = false;
  private cursor = 0;
  private rate = 1;
  private state: SceneRunnerStatus = 'stopped';
  private failure: unknown;

  constructor(
    input: unknown,
    private readonly options: SceneRunnerOptions,
  ) {
    this.definition = freezeData(parseSceneDefinition(input));
    this.audio = options.audio ? new SceneAudioController(this.definition, options.audio) : undefined;
    this.actions = [...this.definition.actions].sort((a, b) => a.time - b.time);
    this.boundaries = [
      ...new Set([
        0,
        this.definition.duration,
        ...this.actions.flatMap((action) => [action.time, action.time + sceneActionDuration(action)]),
      ]),
    ].sort((a, b) => a - b);
    for (const action of this.actions) {
      const starts = this.starts.get(action.time) ?? [];
      starts.push(action);
      this.starts.set(action.time, starts);
      if (sceneActionDuration(action) > 0) {
        const time = action.time + sceneActionDuration(action);
        const ends = this.ends.get(time) ?? [];
        ends.push(action);
        this.ends.set(time, ends);
      }
    }
    try {
      this.rebuild(false);
      for (const actor of this.instances.values()) actor.pauseAnimation();
      this.syncCamera();
    } catch (error) {
      // A failed constructor cannot return a disposable owner to the host.
      try {
        this.dispose();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Scene initialization and cleanup failed.', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }
  get actors(): ReadonlyMap<string, Actor> {
    return this.instances;
  }
  get time(): number {
    return this.cursor;
  }
  get cinematicCamera() {
    return evaluateCameraAtTime(this.definition, this.cursor);
  }
  get transition() {
    return evaluateTransitionAtTime(this.definition, this.cursor);
  }
  get dialogue() {
    return ['stopped', 'disposed', 'failed', 'cancelled', 'interrupted'].includes(this.state)
      ? undefined
      : getDialogueAtTime(this.definition, this.cursor);
  }
  /** Hosts without an attached camera can apply the same clock sample explicitly. */
  applyCamera(camera: CinematicCameraTarget, viewport?: CameraViewport): CameraViewport {
    return applyCinematicCamera(camera, this.cinematicCamera, viewport);
  }
  private syncCamera(): void {
    this.audio?.sync(this.cursor, this.state === 'playing', this.rate);
    const camera = this.options.camera;
    if (camera) this.applyCamera(camera.target, camera.viewport?.());
    this.options.onCamera?.(this.cinematicCamera);
    const transition = ['disposed', 'failed', 'cancelled', 'interrupted'].includes(this.state)
      ? CLEAR_SCENE_TRANSITION
      : this.transition;
    this.options.transitionOverlay?.setTransition(transition);
    this.options.onTransition?.(transition);
    this.options.dialoguePresentation?.setDialogue(this.dialogue);
  }
  get status(): SceneRunnerStatus {
    return this.state;
  }
  get error(): unknown {
    return this.failure;
  }
  get speed(): number {
    return this.rate;
  }
  set speed(value: number) {
    assertFinite(value, 'Scene speed');
    if (value <= 0) throw new Error('Scene speed must be positive.');
    this.rate = value;
    this.audio?.sync(this.cursor, this.state === 'playing', this.rate);
  }

  play(): void {
    this.assertActive();
    if (this.state === 'playing') return;
    if (this.state !== 'paused' || !this.started) {
      this.restart();
      return;
    }
    this.state = 'playing';
    for (const actor of this.instances.values()) {
      actor.puppet.animationPlayer.setPreviewMode(false);
      actor.resumeAnimation();
    }
    this.audio?.sync(this.cursor, true, this.rate);
  }
  pause(): void {
    this.assertActive();
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio?.stop();
    if (!this.stepping) for (const actor of this.instances.values()) actor.pauseAnimation();
  }
  restart(): void {
    this.assertActive();
    this.execute(() => {
      this.rebuild(true);
      this.state = 'playing';
      this.started = true;
      this.atBoundary(false);
    });
  }
  /** Return to authored initial placement/pose, before time-zero actions. */
  stop(): void {
    this.assertActive();
    this.execute(() => {
      this.rebuild(false);
      this.state = 'stopped';
      for (const actor of this.instances.values()) actor.pauseAnimation();
    });
  }
  cancel(): void {
    this.assertActive();
    this.halt('cancelled');
  }
  /** A seek always pauses. Recreate from initial data and simulate only validated
   * declarations in a fresh context, with animation gameplay events and cues disabled.
   * On resume, events at/before the seek position are already consumed.
   */
  seek(milliseconds: number): void {
    this.assertActive();
    assertFinite(milliseconds, 'Scene seek time');
    const target = Math.max(0, Math.min(this.definition.duration, milliseconds));
    this.execute(() => {
      this.seeking = true;
      try {
        this.rebuild(false);
        this.started = true;
        this.state = 'paused';
        this.atBoundary(true);
        this.advance(target, true);
        for (const actor of this.instances.values()) actor.pauseAnimation();
      } finally {
        this.seeking = false;
      }
    });
  }
  /** Called once by the host Phaser update. Never consumes browser wall time. */
  update(deltaMilliseconds: number): void {
    this.assertActive();
    assertFinite(deltaMilliseconds, 'Scene delta');
    if (deltaMilliseconds < 0) throw new Error('Scene delta cannot be negative.');
    if (this.state !== 'playing') return;
    const delta = deltaMilliseconds * this.rate;
    assertFinite(delta, 'Scaled scene delta');
    this.execute(() => this.advance(Math.min(this.definition.duration, this.cursor + delta), false));
  }
  dispose(): void {
    if (this.state === 'disposed' && !this.instances.size) return;
    this.state = 'disposed';
    try {
      this.release();
    } finally {
      try {
        this.audio?.dispose();
      } finally {
        try {
          this.options.transitionOverlay?.setTransition(CLEAR_SCENE_TRANSITION);
          this.options.onTransition?.(CLEAR_SCENE_TRANSITION);
        } finally {
          this.options.dialoguePresentation?.setDialogue(undefined);
        }
      }
    }
  }

  private execute(operation: () => void): void {
    try {
      operation();
      this.syncCamera();
    } catch (error) {
      this.failure = error;
      try {
        this.halt('failed');
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Scene execution and cleanup failed.', { cause: cleanupError });
      }
      throw error;
    }
  }
  private release(): void {
    this.checkedOwnershipRevision = -1;
    const errors: unknown[] = [];
    try {
      this.audio?.stop();
    } catch (error) {
      errors.push(error);
    }
    this.generation++;
    for (const release of this.releases.splice(0)) release();
    this.activeAnimations.clear();
    this.rootMotionActors.clear();
    this.ownedAnimations.clear();
    this.activeMoves.clear();
    const previous = this.instances;
    this.instances = new Map();
    for (const actor of previous.values()) {
      try {
        actor.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    throwNotificationErrors(errors, 'Scene Actor disposal failed.');
  }
  private rebuild(runtime: boolean): void {
    this.release();
    this.cursor = 0;
    this.nextBoundary = 1;
    this.started = false;
    this.failure = undefined;
    try {
      this.definition.actors.forEach((data, depth) => {
        const actor = this.options.createActor(data, sceneActorDepth(this.definition, depth));
        if (actor.isDisposed || actor.id !== data.id || actor.puppetOwnership !== 'owned') {
          actor.dispose();
          throw new Error(`Scene Actor "${data.id}" must be a fresh, live, owned instance with the authored ID.`);
        }
        this.instances.set(data.id, actor);
        actor.puppet.container.setVisible(sceneLayer(this.definition, 'actors').visible);
        actor.puppet.animationPlayer.setPreviewMode(!runtime, { applyRootMotion: true });
        actor.setPosition(data.position.x, data.position.y).setFacing(data.facing ?? 'right');
        if (data.skin !== undefined) actor.setSkin(data.skin);
        if (data.animation !== undefined) actor.play(data.animation, { restart: true, fadeDuration: 0 });
        const initial = actor.puppet.getPlaybackStatus();
        if (initial) this.ownedAnimations.set(actor.id, initial.playbackId);
        const generation = this.generation;
        const disposed = (): void => {
          if (generation === this.generation) this.halt('disposed');
        };
        actor.disposalSignal.addEventListener('abort', disposed, { once: true });
        this.releases.push(() => actor.disposalSignal.removeEventListener('abort', disposed));
        this.releases.push(
          actor.puppet.onPlaybackLifecycle((event) => {
            if (
              !this.ownCommand &&
              generation === this.generation &&
              this.activeAnimations.get(data.id) === event.playbackId &&
              (event.type === 'interrupted' || event.type === 'stopped')
            )
              this.halt('interrupted');
          }),
        );
      });
      // Preflight all animation references before scheduling any action/cue.
      for (const action of this.actions) {
        if (action.type === 'animation' && !this.instances.get(action.actorId)!.puppet.hasAnimation(action.animation))
          throw new Error(`Action "${action.id}": unknown animation "${action.animation}".`);
        if (
          action.type === 'animation' &&
          action.movementSource === 'rootMotion' &&
          !this.instances.get(action.actorId)!.puppet.animationPlayer.hasRootMotion(action.animation)
        )
          throw new Error(
            `Action "${action.id}": animation "${action.animation}" has no root-motion translation keys.`,
          );
      }
    } catch (error) {
      this.release();
      throw error;
    }
  }
  private halt(status: SceneRunnerStatus): void {
    this.state = status;
    this.generation++;
    const animations = new Map(this.ownedAnimations);
    const moves = new Map(this.activeMoves);
    this.activeAnimations.clear();
    this.rootMotionActors.clear();
    this.ownedAnimations.clear();
    this.activeMoves.clear();
    this.ownCommand = true;
    const errors: unknown[] = [];
    try {
      this.audio?.stop();
    } catch (error) {
      errors.push(error);
    }
    try {
      for (const actor of this.instances.values()) {
        if (!actor.isDisposed) {
          try {
            if (moves.get(actor.id)?.requestId === actor.movementStatus?.requestId) actor.cancelMovement();
          } catch (error) {
            errors.push(error);
          }
          try {
            if (animations.get(actor.id) === actor.puppet.getPlaybackStatus()?.playbackId) actor.stop();
          } catch (error) {
            errors.push(error);
          }
        }
      }
    } finally {
      this.ownCommand = false;
    }
    if (status !== 'completed') {
      try {
        this.options.dialoguePresentation?.setDialogue(undefined);
      } catch (error) {
        errors.push(error);
      }
      try {
        this.options.transitionOverlay?.setTransition(CLEAR_SCENE_TRANSITION);
        this.options.onTransition?.(CLEAR_SCENE_TRANSITION);
      } catch (error) {
        errors.push(error);
      }
    }
    throwNotificationErrors(errors, 'Scene cancellation failed.');
  }
  private advance(target: number, seeking: boolean): void {
    this.checkOwnership();
    if (!seeking && this.state !== 'playing') return;
    const generation = this.generation;
    while (this.nextBoundary < this.boundaries.length) {
      const boundary = this.boundaries[this.nextBoundary]!;
      if (boundary > target) break;
      this.nextBoundary++;
      this.step(boundary - this.cursor);
      if (generation !== this.generation) return;
      this.atBoundary(seeking);
      if (generation !== this.generation) return;
      if (this.cursor === this.definition.duration) {
        this.halt('completed');
        return;
      }
      if (!seeking && this.state !== 'playing') return;
    }
    if (this.cursor < target) this.step(target - this.cursor);
    if (generation === this.generation && this.cursor === this.definition.duration) this.halt('completed');
  }
  private step(delta: number): void {
    this.cursor += delta;
    const generation = this.generation;
    this.stepping = true;
    try {
      for (const actor of this.instances.values()) {
        actor.puppet.update(delta);
        if (generation !== this.generation) return;
        this.checkOwnership();
        if (generation !== this.generation) return;
      }
    } finally {
      this.stepping = false;
      if (this.state === 'paused' && !this.seeking) for (const actor of this.instances.values()) actor.pauseAnimation();
    }
  }
  private checkOwnership(): void {
    const revision = getOwnershipRevision();
    if (revision === this.checkedOwnershipRevision) return;
    this.checkedOwnershipRevision = revision;
    // Non-looping animations may finish before their authored window. Preserve the scene's
    // exclusive translation window even while the runtime holds that completed endpoint.
    for (const id of this.rootMotionActors) {
      if (this.instances.get(id)!.movementStatus?.status === 'moving') {
        this.halt('interrupted');
        return;
      }
    }
    for (const [id, request] of this.activeMoves) {
      const status = this.instances.get(id)!.movementStatus;
      if (status?.requestId !== request.requestId || (status.status !== 'moving' && status.status !== 'completed')) {
        this.halt(status?.status === 'disposed' ? 'disposed' : 'interrupted');
        return;
      }
    }
    for (const [id, playbackId] of this.activeAnimations) {
      const puppet = this.instances.get(id)!.puppet;
      const status = puppet.getPlaybackStatus();
      if (
        status?.playbackId !== playbackId ||
        puppet.animationPlayer.isPlaybackStopped() ||
        (status.status === 'paused' && this.state === 'playing')
      ) {
        this.halt('interrupted');
        return;
      }
    }
  }
  private atBoundary(seeking: boolean): void {
    // Authored actions can change the ownership being checked without a runtime command.
    this.checkedOwnershipRevision = -1;
    this.ownCommand = true;
    const generation = this.generation;
    try {
      // Finish old ownership before starting adjacent clips. Holds retain the last pose.
      for (const action of this.ends.get(this.cursor) ?? []) {
        const actor = this.instances.get(action.actorId)!;
        if (action.type === 'animation' && this.activeAnimations.has(actor.id)) {
          this.activeAnimations.delete(actor.id);
          this.rootMotionActors.delete(actor.id);
          actor.stop();
        }
        if (action.type === 'move' && this.activeMoves.get(actor.id)?.actionId === action.id) {
          this.activeMoves.delete(actor.id);
          // Clamp arrival to exact authored coordinates after runtime movement rounding.
          actor.setPosition(action.destination.x, action.destination.y);
          actor.puppet.update(0);
        }
      }
      for (const action of this.starts.get(this.cursor) ?? []) {
        const actor = this.instances.get(action.actorId)!;
        switch (action.type) {
          case 'animation': {
            let selectedId: number | undefined;
            const unsubscribe = actor.puppet.onPlaybackLifecycle((event) => {
              if (event.type === 'started' && event.layer === 'base' && selectedId === undefined)
                selectedId = event.playbackId;
            });
            try {
              actor.play(action.animation, {
                loop: action.loop,
                speed: action.speed,
                restart: true,
                fadeDuration: 0,
                rootMotion: action.movementSource === 'rootMotion' ? 'apply' : 'ignore',
              });
            } finally {
              unsubscribe();
            }
            if (generation !== this.generation) return;
            if (
              actor.puppet.getPlaybackStatus()?.playbackId !== selectedId ||
              actor.puppet.getPlaybackStatus()?.status === 'stopped'
            ) {
              this.halt('interrupted');
              return;
            }
            this.activeAnimations.set(actor.id, actor.puppet.getPlaybackStatus()!.playbackId);
            if (action.movementSource === 'rootMotion') this.rootMotionActors.add(actor.id);
            this.ownedAnimations.set(actor.id, actor.puppet.getPlaybackStatus()!.playbackId);
            break;
          }
          case 'move': {
            const start = actor.worldPosition;
            const parent = actor.puppet.container.parentContainer;
            const destination = parent
              ? parent.getWorldTransformMatrix().transformPoint(action.destination.x, action.destination.y)
              : action.destination;
            const speed = (Math.hypot(destination.x - start.x, destination.y - start.y) * 1000) / action.duration;
            assertFinite(speed, 'Scene movement speed');
            const pending = actor.moveTo(action.destination.x, action.destination.y, { speed: speed || 1 });
            this.activeMoves.set(actor.id, { actionId: action.id, requestId: actor.movementStatus?.requestId ?? -1 });
            void pending
              .then((result) => {
                if (
                  generation === this.generation &&
                  this.activeMoves.get(actor.id)?.actionId === action.id &&
                  result.status !== 'completed'
                )
                  this.halt(result.status === 'disposed' ? 'disposed' : 'interrupted');
              })
              .catch((error: unknown) => {
                if (generation === this.generation) {
                  this.failure = error;
                  this.halt('failed');
                }
              });
            break;
          }
          case 'face':
            if (action.target.type === 'direction') actor.setFacing(action.target.facing);
            else
              actor.lookAt(action.target.type === 'actor' ? this.instances.get(action.target.actorId)! : action.target);
            break;
          case 'cue':
            if (!seeking)
              this.options.onCue?.(
                Object.freeze({
                  name: action.name,
                  actorId: actor.id,
                  actionId: action.id,
                  time: this.cursor,
                  ...('payload' in action && { payload: structuredClone(action.payload) }),
                }),
              );
            break;
          case 'wait':
            break; // Absolute timeline interval; no Actor channel is claimed.
        }
        if (generation !== this.generation) return;
      }
    } finally {
      this.ownCommand = false;
    }
  }
  private assertActive(): void {
    if (this.state === 'disposed') throw new Error('Scene runner has been disposed.');
  }
}
