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

  /** Detached snapshot in the Puppet container's parent coordinates (scene coordinates by default). */
  get position(): ActorPosition {
    this.assertActive();
    return Object.freeze({ x: this.puppet.container.x, y: this.puppet.container.y });
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

  /** Same instance outcomes as Puppet. Abort cancels only this wait. */
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

  /** Release state policy and waits. Borrowed playback continues; owned Puppets are destroyed once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeDestroy?.();
    this.unsubscribeDestroy = undefined;
    this.states?.dispose();
    try {
      if (this.puppetOwnership === 'owned') {
        ownedPuppets.delete(this.puppet);
        if (!this.puppet.isDestroyed) this.puppet.destroy();
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
