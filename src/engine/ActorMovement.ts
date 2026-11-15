import { faceWorldDirection } from './ActorFacing.js';
import type { Point } from './affineMath.js';
import { AnimationStateController } from './AnimationStateController.js';
import { invalidateOwnership } from './ownershipRevision.js';
import type { Puppet } from './Puppet.js';
import { assertFinite } from './types.js';

/** Animation IDs, never global conventions or state IDs. Both clips must be registered. */
export interface ActorLocomotion {
  readonly walk: string;
  readonly idle: string;
  /** Existing runtime crossfade duration in milliseconds. Defaults to zero. */
  readonly fadeDuration?: number;
}

export interface ActorMoveOptions {
  /** World units per second, strictly positive. Defaults to 120. */
  readonly speed?: number;
  /** Aborting stops this movement, including its owned locomotion. */
  readonly signal?: AbortSignal;
}

export interface ActorWalkOptions extends ActorMoveOptions {
  /** Overrides the Actor's mapping for this request. */
  readonly locomotion?: ActorLocomotion;
  /** Orient toward horizontal world travel. Defaults to false; vertical/stationary travel preserves facing. */
  readonly faceMovement?: boolean;
}

export type ActorMovementOutcome = 'completed' | 'interrupted' | 'cancelled' | 'disposed';

/** Synchronous ownership snapshot, independent of Promise continuation timing. */
export interface ActorMovementStatus {
  readonly requestId: number;
  readonly status: 'moving' | ActorMovementOutcome;
}

export interface ActorMovementSnapshot {
  /** All points use the same parent coordinates as Actor.position. */
  readonly start: Readonly<Point>;
  readonly destination: Readonly<Point>;
  readonly position: Readonly<Point>;
  readonly speed: number;
}

export type ActorMovementResult =
  | { readonly status: ActorMovementOutcome; readonly movement: ActorMovementSnapshot }
  | { readonly status: 'cancelled'; readonly movement?: never };

interface MovementRequest {
  readonly requestId: number;
  readonly start: Readonly<Point>;
  readonly destination: Readonly<Point>;
  readonly speed: number;
  readonly resolve: (result: ActorMovementResult) => void;
  readonly locomotion: ActorLocomotion | undefined;
  readonly faceMovement: boolean;
  controller?: AnimationStateController;
  unsubscribeUpdate?: () => void;
  unsubscribeAbort?: () => void;
  releaseTranslation?: () => void;
}

function point(x: number, y: number): Readonly<Point> {
  assertFinite(x, 'Movement x');
  assertFinite(y, 'Movement y');
  return Object.freeze({ x, y });
}

/** Internal movement policy; Puppet owns the only update loop and position. */
export class ActorMovement {
  private current: MovementRequest | undefined;
  private nextRequestId = 1;
  private latest: ActorMovementStatus | undefined;

  get status(): ActorMovementStatus | undefined {
    return this.latest;
  }

  constructor(private readonly puppet: Puppet) {}

  async start(
    x: number,
    y: number,
    options: ActorWalkOptions,
    locomotion?: ActorLocomotion,
  ): Promise<ActorMovementResult> {
    if (options.signal?.aborted) return { status: 'cancelled' };
    const destination = point(x, y);
    const speed = options.speed === undefined ? 120 : options.speed;
    assertFinite(speed, 'Movement speed');
    if (speed <= 0) throw new Error('Movement speed must be positive.');
    if (options.faceMovement !== undefined && typeof options.faceMovement !== 'boolean')
      throw new Error('faceMovement must be a boolean.');
    this.distance(destination);
    if (locomotion) {
      for (const name of [locomotion.walk, locomotion.idle]) {
        if (typeof name !== 'string' || !name.trim() || !this.puppet.hasAnimation(name))
          throw new Error(`Unknown locomotion animation "${name}".`);
      }
      assertFinite(locomotion.fadeDuration ?? 0, 'Locomotion fade duration');
      if ((locomotion.fadeDuration ?? 0) < 0) throw new Error('Locomotion fade duration cannot be negative.');
      locomotion = Object.freeze({ ...locomotion });
    }

    const previousLocomotion = this.current?.controller?.isActive ? this.current.locomotion : undefined;
    const releaseTranslation = this.puppet.claimMovementTranslation(this);
    // A walking replacement suppresses the intermediate idle start.
    try {
      this.finish('interrupted', false);
    } catch (error) {
      releaseTranslation();
      throw error;
    }
    const start = this.position();
    return new Promise<ActorMovementResult>((resolve, reject) => {
      const request: MovementRequest = {
        requestId: this.nextRequestId++,
        start,
        destination,
        speed,
        resolve,
        locomotion,
        faceMovement: !!locomotion && options.faceMovement === true,
        releaseTranslation,
      };
      this.current = request;
      this.latest = Object.freeze({ requestId: request.requestId, status: 'moving' });
      invalidateOwnership();
      request.unsubscribeUpdate = this.puppet.onUpdate((delta) => this.update(request, delta));
      if (options.signal) {
        const signal = options.signal;
        const abort = (): void => {
          if (this.current === request) this.finish('cancelled');
        };
        signal.addEventListener('abort', abort, { once: true });
        request.unsubscribeAbort = () => signal.removeEventListener('abort', abort);
      }
      try {
        if ((!locomotion || (start.x === x && start.y === y)) && previousLocomotion) {
          this.puppet.play(previousLocomotion.idle, {
            loop: true,
            restart: true,
            fadeDuration: previousLocomotion.fadeDuration ?? 0,
          });
          if (this.current !== request) return;
        }
        if (start.x === x && start.y === y) {
          this.finish('completed');
          return;
        }
        if (locomotion) {
          this.faceDestination(request);
          if (this.current !== request) return;
          const controller = this.startLocomotion(request, locomotion);
          request.controller = controller;
          // Starting animation can synchronously abort, dispose, or replace the movement.
          if (this.current !== request) {
            try {
              if (!this.current?.locomotion && controller.isActive) controller.setState('idle');
            } finally {
              controller.dispose();
            }
          }
        }
      } catch (error) {
        if (this.current === request) {
          this.release(request);
          this.current = undefined;
          this.latest = Object.freeze({ requestId: request.requestId, status: 'cancelled' });
          invalidateOwnership();
        }
        reject(error);
      }
    });
  }

  cancel(): void {
    this.finish('cancelled');
  }

  dispose(): void {
    this.finish('disposed');
  }

  private startLocomotion(request: MovementRequest, mapping: ActorLocomotion): AnimationStateController {
    let playbackId: number | undefined;
    const unsubscribe = this.puppet.onPlaybackLifecycle((event) => {
      if (event.type === 'started' && event.layer === 'base' && event.clip === mapping.walk && playbackId === undefined)
        playbackId = event.playbackId;
    });
    try {
      return new AnimationStateController(this.puppet, {
        initialState: 'walking',
        states: {
          walking: { animation: mapping.walk, loop: true },
          idle: { animation: mapping.idle, loop: true },
        },
        defaultFadeDuration: mapping.fadeDuration ?? 0,
      });
    } catch (error) {
      // A host callback can throw after playback commits, before the constructor returns its controller.
      if (this.current === request) {
        this.current = undefined;
        this.latest = Object.freeze({ requestId: request.requestId, status: 'cancelled' });
        invalidateOwnership();
        this.release(request);
        if (
          playbackId !== undefined &&
          this.puppet.getPlaybackStatus()?.playbackId === playbackId &&
          !this.puppet.isDestroyed &&
          !this.puppet.posePipeline.player.isDisposed
        ) {
          try {
            this.puppet.play(mapping.idle, { loop: true, restart: true, fadeDuration: mapping.fadeDuration ?? 0 });
          } catch (restoreError) {
            throw new AggregateError([error, restoreError], 'Locomotion start and idle restoration failed.', {
              cause: restoreError,
            });
          }
        }
      }
      throw error;
    } finally {
      unsubscribe();
    }
  }

  private position(): Readonly<Point> {
    return point(this.puppet.container.x, this.puppet.container.y);
  }

  private faceDestination(request: MovementRequest): void {
    if (!request.faceMovement) return;
    const dx = request.destination.x - this.puppet.container.x;
    const dy = request.destination.y - this.puppet.container.y;
    const parent = this.puppet.container.parentContainer;
    const matrix = parent?.getWorldTransformMatrix();
    faceWorldDirection(this.puppet, matrix ? matrix.a * dx + matrix.c * dy : dx);
  }

  /** Measure in world units even when the outer container has a scaled/rotated parent. */
  private distance(destination: Readonly<Point>): number {
    const x = this.puppet.container.x;
    const y = this.puppet.container.y;
    let dx = destination.x - x;
    let dy = destination.y - y;
    const parent = this.puppet.container.parentContainer;
    if (parent) {
      const matrix = parent.getWorldTransformMatrix();
      const worldX = matrix.a * dx + matrix.c * dy;
      dy = matrix.b * dx + matrix.d * dy;
      dx = worldX;
    }
    const distance = Math.hypot(dx, dy);
    assertFinite(distance, 'Movement distance');
    if (distance === 0 && (x !== destination.x || y !== destination.y))
      throw new Error('Movement direction is collapsed by the parent transform.');
    return distance;
  }

  private update(request: MovementRequest, delta: number): void {
    if (this.current !== request) return;
    try {
      const distance = this.distance(request.destination);
      const fraction = distance === 0 ? 1 : Math.min((request.speed * (delta / 1000)) / distance, 1);
      if (distance > 0 && fraction > 0) this.faceDestination(request);
      if (this.current !== request) return;
      const x = this.puppet.container.x;
      const y = this.puppet.container.y;
      const destination = request.destination;
      this.puppet.container.setPosition(
        fraction === 1 ? destination.x : x + (destination.x - x) * fraction,
        fraction === 1 ? destination.y : y + (destination.y - y) * fraction,
      );
      this.puppet.posePipeline.syncPose();
      if (fraction === 1 && this.current === request) this.finish('completed');
    } catch (error) {
      if (this.current === request) this.finish('cancelled');
      throw error;
    }
  }

  private release(request: MovementRequest): void {
    request.releaseTranslation?.();
    request.unsubscribeUpdate?.();
    request.unsubscribeAbort?.();
    request.controller?.dispose();
  }

  private finish(status: ActorMovementOutcome, restore = true): void {
    const request = this.current;
    if (!request) return;
    this.current = undefined;
    this.latest = Object.freeze({ requestId: request.requestId, status });
    if (status !== 'completed') invalidateOwnership();
    const ownsPlayback = request.controller?.isActive;
    const result = Object.freeze({
      status,
      movement: Object.freeze({
        start: request.start,
        destination: request.destination,
        position: Object.freeze({ x: this.puppet.container.x, y: this.puppet.container.y }),
        speed: request.speed,
      }),
    });
    // Release subscriptions before invoking any animation callbacks.
    this.release(request);
    try {
      if (restore && ownsPlayback && !this.puppet.isDestroyed && !this.puppet.posePipeline.player.isDisposed) {
        // Reuse the runtime's crossfade and identity policy; never restart walk from update().
        this.puppet.play(request.locomotion!.idle, {
          loop: true,
          restart: true,
          fadeDuration: request.locomotion!.fadeDuration ?? 0,
        });
      }
    } finally {
      request.resolve(result);
    }
  }
}
