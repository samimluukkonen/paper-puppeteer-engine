import { throwNotificationErrors } from '../../engine/core.js';
import type { Rig } from '../../engine/data.js';
import { freezeData } from '../shared/editorData.js';
import { Subscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEventRef } from './animationEvents.js';
import type { GraphChannel } from './graphEditor.js';
import type { KeyframeSelectionModifiers } from './keyframeSelection.js';
import type { KeyframeSelection } from './timelineTracks.js';
import type { Milliseconds, Seconds } from './timeUnits.js';

/** One authored mutation: validate and return the next snapshot, or undefined to abort without installing. */
export type AnimationEdit = (working: ReadonlyAnimation, rig: Rig) => ReadonlyAnimation | undefined;

export interface AnimationEditInstallOptions {
  /** Keep the transient transform draft instead of clearing it after install. */
  retainDraft?: boolean;
  /** Replace the keyframe selection after install; the first entry becomes primary. */
  selectedKeys?: readonly KeyframeSelection[];
}

export interface AnimationEditCommitOptions extends AnimationEditInstallOptions {
  /** Seek target applied after the edit computes and before install; defaults to the held time. */
  time?: Seconds;
  /** Pause playback and end scrubbing on commit; the default true matches gesture commits. */
  pause?: boolean;
  /** Session hook run with the computed snapshot before install (selection updates). */
  after?: (next: ReadonlyAnimation) => void;
}

/**
 * The one shared actions shape handed to every command module. The session implements
 * the transaction core; the facade supplies the selection/drag primitives as dependencies.
 *
 * Command modules get transaction operations only: they cannot pause, end scrubbing or
 * install a snapshot directly, so the ordering cannot be restated outside the session.
 * `cancelActiveDrags` and `updateTime*` stay because selection clears and live drag
 * previews need them on their own, outside any transaction.
 */
export interface AnimationEditActions {
  batch<Result>(command: () => Result): Result;
  run<Result>(denied: Result, command: () => Result): Result;
  notify(): void;
  cancelActiveDrags(): boolean;
  stopPlayback(): void;
  beginGesture(): void;
  updateTime(time: Seconds): boolean;
  updateTimeMilliseconds(time: Milliseconds): boolean;
  clearTransformDraft(): boolean;
  commit(edit: AnimationEdit, opts?: AnimationEditCommitOptions): boolean;
  selectKeyframe(key: KeyframeSelection, modifiers?: KeyframeSelectionModifiers): boolean;
  selectEvent(ref: AnimationEventRef): boolean;
  clearBoneSelection(): void;
  clearOtherSelection(): void;
  selectCommittedKey(channel: GraphChannel, time: Seconds): void;
}

/** Facade-owned primitives the session needs; all callbacks are evaluated lazily at call time. */
export interface AnimationEditSessionDeps {
  readonly document: AnimationEditorDocument;
  readonly authoringEnabled: () => boolean;
  readonly working: () => ReadonlyAnimation | null;
  readonly rig: () => Rig | undefined;
  readonly currentTime: () => Seconds;
  readonly cancelActiveDrags: () => boolean;
  readonly pausePlayback: () => void;
  readonly endScrub: () => void;
  readonly updateTime: (time: Seconds) => boolean;
  readonly updateTimeMilliseconds: (time: Milliseconds) => boolean;
  readonly clearTransformDraft: () => boolean;
  readonly setSelectedKeys: (keys: readonly KeyframeSelection[], primary: KeyframeSelection | null) => void;
  readonly reconcileSelection: () => void;
  readonly reconcileRootKey: () => void;
  readonly clearRootSelection: () => void;
  readonly selectKeyframe: (key: KeyframeSelection, modifiers?: KeyframeSelectionModifiers) => boolean;
  readonly selectEvent: (ref: AnimationEventRef) => boolean;
  readonly clearBoneSelection: () => void;
  readonly clearOtherSelection: () => void;
  readonly selectCommittedKey: (channel: GraphChannel, time: Seconds) => void;
  /** Runs at the start of every published notification, e.g. preview reconciliation. */
  readonly reconcilePreviews: () => void;
}

/**
 * Deep edit-transaction module: owns the mutation ordering exactly once —
 * cancel active drags → compute the validated edit → pause → end scrub → seek →
 * install (freeze + one history entry through the document) → batch-notify —
 * plus the shared notification boundary and subscriber list.
 * Pure and DOM-free: every editor capability is an injected dependency.
 */
export class AnimationEditSession implements AnimationEditActions {
  private readonly subscribers = new Subscribers({ label: 'Animation editor listeners failed.', onError: 'collect' });
  private notificationDepth = 0;
  private notificationPending = false;

  constructor(private readonly deps: AnimationEditSessionDeps) {}

  get authoringEnabled(): boolean {
    return this.deps.authoringEnabled();
  }
  get working(): ReadonlyAnimation | null {
    return this.deps.working();
  }
  get rig(): Rig | undefined {
    return this.deps.rig();
  }
  get currentTime(): Seconds {
    return this.deps.currentTime();
  }

  subscribe(listener: () => void): () => void {
    return this.subscribers.subscribe(listener);
  }

  /** Nested commands publish the complete document, selection and clock together. */
  batch<Result>(command: () => Result): Result {
    ++this.notificationDepth;
    try {
      return command();
    } finally {
      --this.notificationDepth;
      if (this.notificationDepth === 0 && this.notificationPending) {
        this.notificationPending = false;
        this.notify();
      }
    }
  }

  /**
   * The one authoring guard: return `denied` while authoring is disabled, otherwise run the
   * command inside one notification batch. Cancels and other always-allowed paths use `batch`.
   */
  run<Result>(denied: Result, command: () => Result): Result {
    if (!this.deps.authoringEnabled()) return denied;
    return this.batch(command);
  }

  notify(): void {
    if (this.notificationDepth > 0) {
      this.notificationPending = true;
      return;
    }
    this.deps.reconcilePreviews();
    // Collected, not reported: editor commands rethrow listener failures so playback can merge them with
    // animation-event failures into one AggregateError.
    throwNotificationErrors(this.subscribers.notify(), 'Animation editor listeners failed.');
  }

  cancelActiveDrags(): boolean {
    return this.deps.cancelActiveDrags();
  }
  /** Stop the editor clock for authoring: pause playback, then release any scrub. */
  stopPlayback(): void {
    this.deps.pausePlayback();
    this.deps.endScrub();
  }
  /**
   * Gesture/navigation boundary: cancel active drags, then stop the clock. Runs inside the
   * caller's batch; the caller publishes its own notification after changing state.
   */
  beginGesture(): void {
    this.cancelActiveDrags();
    this.stopPlayback();
  }
  updateTime(time: Seconds): boolean {
    return this.deps.updateTime(time);
  }
  updateTimeMilliseconds(time: Milliseconds): boolean {
    return this.deps.updateTimeMilliseconds(time);
  }
  clearTransformDraft(): boolean {
    return this.deps.clearTransformDraft();
  }

  selectKeyframe(key: KeyframeSelection, modifiers?: KeyframeSelectionModifiers): boolean {
    return this.batch(() => {
      this.deps.clearRootSelection();
      return this.deps.selectKeyframe(key, modifiers);
    });
  }
  selectEvent(ref: AnimationEventRef): boolean {
    return this.batch(() => {
      this.deps.clearRootSelection();
      return this.deps.selectEvent(ref);
    });
  }
  clearBoneSelection(): void {
    this.deps.clearBoneSelection();
  }
  clearOtherSelection(): void {
    this.deps.clearOtherSelection();
  }
  selectCommittedKey(channel: GraphChannel, time: Seconds): void {
    this.deps.selectCommittedKey(channel, time);
  }

  /**
   * The single mutation-transaction ordering. Guard → batch → cancel active drags →
   * compute the validated edit (abort or report preserves authored state) → pause/end scrub →
   * seek → after-hook → install (freeze + one history entry + reconcile) → one notification.
   */
  commit(edit: AnimationEdit, opts: AnimationEditCommitOptions = {}): boolean {
    if (!this.deps.authoringEnabled()) return false;
    return this.batch(() => {
      const working = this.deps.working();
      const rig = this.deps.rig();
      if (!working || !rig) return false;
      this.cancelActiveDrags();
      let next: ReadonlyAnimation | undefined;
      try {
        next = edit(working, rig);
      } catch (error) {
        this.deps.document.reportError(error);
        this.notify();
        return false;
      }
      if (next === undefined) return false;
      if (opts.pause ?? true) this.stopPlayback();
      if (opts.time !== undefined) this.updateTime(opts.time);
      opts.after?.(next);
      return this.installCore(next, opts);
    });
  }

  /** Install after `commit` guarded and cancelled drags; owns freeze, history, reconcile and notify. */
  private installCore(next: ReadonlyAnimation, opts: AnimationEditInstallOptions): boolean {
    if (!this.deps.document.install(freezeData(next))) {
      this.notify();
      return false;
    }
    if (!opts.retainDraft) this.clearTransformDraft();
    this.updateTime(this.currentTime);
    if (opts.selectedKeys) this.deps.setSelectedKeys(opts.selectedKeys, opts.selectedKeys[0] ?? null);
    this.deps.reconcileRootKey();
    this.deps.reconcileSelection();
    this.notify();
    return true;
  }
}
