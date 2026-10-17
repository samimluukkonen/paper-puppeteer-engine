import { faceWorldDirection } from './ActorFacing.js';
import {
  ActorMovement,
  type ActorLocomotion,
  type ActorMoveOptions,
  type ActorMovementResult,
  type ActorWalkOptions,
} from './ActorMovement.js';
import type { Point } from './affineMath.js';
import type { PlayAnimationOptions, PlayAndWaitOptions, WaitForPlaybackOptions } from './AnimationPlayer.js';
import {
  type AnimationActionOptions,
  AnimationStateController,
  type AnimationStateControllerOptions,
  type SetAnimationStateOptions,
} from './AnimationStateController.js';
import type { PlaybackWaitResult } from './PlaybackLifecycle.js';
import type { Puppet } from './Puppet.js';
import { assertFinite, type Facing } from './types.js';

export type ActorPosition = Readonly<Point>;
export type ActorPuppetOwnership = 'borrowed' | 'owned';

export interface ActorOptions {
  /** Host-assigned instance ID, independent of character, animation and playback IDs. */
  readonly id: string;
  readonly puppet: Puppet;
  /** Defaults to borrowed. Only one Actor may own a given Puppet. */
  readonly puppetOwnership?: ActorPuppetOwnership;
  /** Optional existing state policy; constructing it starts initialState. */
  readonly animationStates?: AnimationStateControllerOptions;
  /** Explicit animation IDs used by walkTo(); each request may override this mapping. */
  readonly locomotion?: ActorLocomotion;
}

// Ownership follows the live Puppet, without retaining destroyed instances in a global registry.
const ownedPuppets = new WeakSet<Puppet>();

/** Optional behavior facade. Owns no animation evaluator, position, scene subscription or update loop. */
export class Actor {
  readonly id: string;
  readonly puppet: Puppet;
  readonly puppetOwnership: ActorPuppetOwnership;
  private readonly lifetime = new AbortController();
  private readonly states: AnimationStateController | undefined;
  private readonly movement: ActorMovement;
  /** Frozen default walk/idle mapping; individual walk requests may override it. */
  readonly locomotion: ActorLocomotion | undefined;
  private unsubscribeDestroy: (() => void) | undefined;
  private disposed = false;

  constructor(options: ActorOptions) {
    if (typeof options.id !== 'string' || !options.id.trim()) throw new Error('Actor ID must be a nonempty string.');
    const ownership = options.puppetOwnership ?? 'borrowed';
    if (ownership !== 'borrowed' && ownership !== 'owned') throw new Error('Invalid Actor Puppet ownership.');
    const puppet = options.puppet;
    if (!puppet || puppet.isDestroyed || puppet.animationPlayer.isDisposed)
      throw new Error('Actor requires a live Puppet.');
    if (ownership === 'owned' && ownedPuppets.has(puppet)) throw new Error('Puppet already has an owning Actor.');
    this.id = options.id;
    this.puppet = puppet;
    this.puppetOwnership = ownership;
    this.movement = new ActorMovement(puppet);
    this.locomotion = options.locomotion ? Object.freeze({ ...options.locomotion }) : undefined;
    if (ownership === 'owned') ownedPuppets.add(puppet);
    try {
      this.states = options.animationStates ? new AnimationStateController(puppet, options.animationStates) : undefined;
      // State initialization can invoke host callbacks, including destruction.
      this.assertActive();
      this.unsubscribeDestroy = puppet.onDestroy(() => this.dispose());
    } catch (error) {
      this.states?.dispose();
      if (ownership === 'owned') ownedPuppets.delete(puppet);
      // Failed construction never takes ownership of the host's Puppet.
      throw error;
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Observe Actor disposal without taking ownership of its Puppet. */
  get disposalSignal(): AbortSignal {
    return this.lifetime.signal;
  }

  /** Detached snapshot in the Puppet container's parent coordinates (scene coordinates by default). */
  get position(): ActorPosition {
    this.assertActive();
    return Object.freeze({ x: this.puppet.container.x, y: this.puppet.container.y });
  }

  /** Frozen scene/world position, including all enclosing Phaser container transforms. */
  get worldPosition(): ActorPosition {
    this.assertActive();
    const { tx: x, ty: y } = this.puppet.container.getWorldTransformMatrix();
    assertFinite(x, 'Actor world x');
    assertFinite(y, 'Actor world y');
    return Object.freeze({ x, y });
  }

  setPosition(x: number, y: number): this {
    this.assertActive();
    assertFinite(x, 'Actor x');
    assertFinite(y, 'Actor y');
    this.puppet.container.setPosition(x, y);
    // World-space IK targets and debug views must observe the new outer transform immediately.
    this.puppet.syncPose();
    return this;
  }

  /** Direct movement in position's parent coordinates, measured in world units per second. */
  async moveTo(x: number, y: number, options: ActorMoveOptions = {}): Promise<ActorMovementResult> {
    this.assertActive();
    return this.movement.start(x, y, options);
  }

  /** Movement plus explicitly mapped base locomotion. External animation changes retain precedence. */
  async walkTo(x: number, y: number, options: ActorWalkOptions = {}): Promise<ActorMovementResult> {
    this.assertActive();
    if (options.signal?.aborted) return { status: 'cancelled' };
    const locomotion = options.locomotion ?? this.locomotion;
    if (!locomotion) throw new Error('walkTo requires a locomotion mapping with walk and idle animation IDs.');
    return this.movement.start(x, y, options, locomotion);
  }

  /** Stop movement and restore idle only while this request still owns locomotion. */
  cancelMovement(): this {
    this.assertActive();
    this.movement.cancel();
    return this;
  }

  get currentAnimation(): string | undefined {
    this.assertActive();
    return this.puppet.currentAnimation;
  }

  get isPlaying(): boolean {
    this.assertActive();
    return this.puppet.isPlaying;
  }

  play(name: string, options?: PlayAnimationOptions): this {
    this.assertActive();
    this.puppet.play(name, options);
    return this;
  }

  /** Same instance outcomes as Puppet. Abort cancels only this wait unless stopOnAbort is enabled. */
  async playAndWait(name: string, options: PlayAndWaitOptions = {}): Promise<PlaybackWaitResult> {
    this.assertActive();
    return this.puppet.playAndWait(name, { ...options, signal: this.waitSignal(options.signal) });
  }

  async waitForPlayback(options: WaitForPlaybackOptions = {}): Promise<PlaybackWaitResult> {
    this.assertActive();
    return this.puppet.waitForPlayback({ ...options, signal: this.waitSignal(options.signal) });
  }

  stop(): this {
    this.assertActive();
    this.puppet.stop();
    return this;
  }

  pauseAnimation(): this {
    this.assertActive();
    this.puppet.pauseAnimation();
    return this;
  }

  resumeAnimation(): this {
    this.assertActive();
    this.puppet.resumeAnimation();
    return this;
  }

  get currentState(): string {
    return this.requireStates().currentState;
  }

  setState(id: string, options?: SetAnimationStateOptions): this {
    this.requireStates().setState(id, options);
    return this;
  }

  playAction(id: string, options?: AnimationActionOptions): this {
    this.requireStates().playAction(id, options);
    return this;
  }

  setFacing(facing: Facing): this {
    this.assertActive();
    this.puppet.setFacing(facing);
    return this;
  }

  get facingDirection(): Facing {
    this.assertActive();
    return this.puppet.facingDirection;
  }

  faceLeft(): this {
    return this.setFacing('left');
  }

  faceRight(): this {
    return this.setFacing('right');
  }

  /** One-time horizontal targeting in world coordinates. Self and stale Actor targets are ignored. */
  lookAt(target: ActorPosition | Actor): this {
    this.assertActive();
    if (
      target instanceof Actor &&
      (target === this || target.disposed || target.puppet.isDestroyed || target.puppet.animationPlayer.isDisposed)
    )
      return this;
    const position = target instanceof Actor ? target.worldPosition : target;
    assertFinite(position.x, 'Look target x');
    assertFinite(position.y, 'Look target y');
    faceWorldDirection(this.puppet, position.x - this.worldPosition.x);
    return this;
  }

  setSkin(name: string): this {
    this.assertActive();
    this.puppet.setSkin(name);
    return this;
  }

  applySkin(name: string): this {
    this.assertActive();
    this.puppet.applySkin(name);
    return this;
  }

  setAttachment(slot: string, attachment: string): this {
    this.assertActive();
    this.puppet.setAttachment(slot, attachment);
    return this;
  }

  clearAttachment(slot: string): this {
    this.assertActive();
    this.puppet.clearAttachment(slot);
    return this;
  }

  /** Release movement, state policy and waits; destroy owned Puppets once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeDestroy?.();
    this.unsubscribeDestroy = undefined;
    this.states?.dispose();
    try {
      try {
        this.movement.dispose();
      } finally {
        if (this.puppetOwnership === 'owned') {
          ownedPuppets.delete(this.puppet);
          if (!this.puppet.isDestroyed) this.puppet.destroy();
        }
      }
    } finally {
      // Puppet disposal settles its waits first. Borrowed live playback yields wait-only cancellation.
      this.lifetime.abort();
    }
  }

  private waitSignal(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
  }

  private requireStates(): AnimationStateController {
    this.assertActive();
    if (!this.states) throw new Error('Actor has no animationStates configuration.');
    return this.states;
  }

  private assertActive(): void {
    if (this.disposed || this.puppet.isDestroyed || this.puppet.animationPlayer.isDisposed)
      throw new Error('Actor has been disposed or its Puppet is no longer live.');
  }
}
