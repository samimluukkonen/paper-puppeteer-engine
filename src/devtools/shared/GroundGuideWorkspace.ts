import { z } from 'zod';
import { throwNotificationErrors } from '../../engine/core.js';
import {
  defaultGroundGuide,
  groundGuideSchema,
  updateGroundGuide,
  type GroundGuide,
  type GroundGuideSpace,
} from './groundGuide.js';

const storedGuideSchema = z.strictObject({ version: z.literal(1), guide: groundGuideSchema });
type GuideStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface GroundGuideSnapshot {
  readonly workspaceId: string | null;
  readonly guide: GroundGuide;
  readonly persistenceMessage: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dragging: boolean;
}

/** Per-document browser metadata, separate from authored JSON, dirty state and animation/scene undo history.
 * The identity is a character manifest URL (animation) or scene ID (scene editor).
 */
export class GroundGuideWorkspace {
  private readonly entries = new Map<string, GroundGuideSnapshot>();
  private readonly listeners = new Set<() => void>();
  private snapshot: GroundGuideSnapshot;
  private readonly histories = new Map<string, { undo: GroundGuide[]; redo: GroundGuide[] }>();
  private dragStart: GroundGuide | undefined;

  constructor(
    readonly space: GroundGuideSpace,
    private readonly storage: () => GuideStorage = () => window.localStorage,
    readonly historyEnabled = space === 'animation-preview-world',
  ) {
    this.snapshot = Object.freeze({
      workspaceId: null,
      guide: defaultGroundGuide(space),
      persistenceMessage: '',
      canUndo: false,
      canRedo: false,
      dragging: false,
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): GroundGuideSnapshot => this.snapshot;

  private key(id: string): string {
    return `paper-puppeteer:ground-guide:v1:${this.space}:${encodeURIComponent(id)}`;
  }

  private install(snapshot: Pick<GroundGuideSnapshot, 'workspaceId' | 'guide' | 'persistenceMessage'>): void {
    const history = snapshot.workspaceId === null ? undefined : this.histories.get(snapshot.workspaceId);
    this.snapshot = Object.freeze({
      ...snapshot,
      canUndo: !!history?.undo.length,
      canRedo: !!history?.redo.length,
      dragging: !!this.dragStart,
    });
    if (snapshot.workspaceId !== null) this.entries.set(snapshot.workspaceId, this.snapshot);
    this.notify();
  }

  private notify(): void {
    const errors: unknown[] = [];
    // oxlint-disable-next-line unicorn/no-useless-spread -- Changes during notification apply to the next delivery.
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        errors.push(error);
      }
    }
    throwNotificationErrors(errors, 'Ground guide notification failed.');
  }

  /** Rebinding never writes preferences, resets camera placement or changes authored data. */
  bind(workspaceId: string | null): void {
    if (workspaceId === this.snapshot.workspaceId) return;
    this.cancelDrag();
    const retained = workspaceId === null ? undefined : this.entries.get(workspaceId);
    if (retained) {
      this.snapshot = retained;
      this.notify();
      return;
    }
    let guide = defaultGroundGuide(this.space);
    let persistenceMessage = '';
    if (workspaceId !== null) {
      try {
        const text = this.storage().getItem(this.key(workspaceId));
        if (text !== null) {
          const stored = storedGuideSchema.safeParse(JSON.parse(text));
          if (stored.success) guide = Object.freeze(stored.data.guide);
          else persistenceMessage = 'Saved ground settings are invalid. Using defaults.';
        }
      } catch {
        persistenceMessage = 'Ground settings could not be read. Changes will be kept for this session.';
      }
    }
    this.install({ workspaceId, guide, persistenceMessage });
  }

  /** Release session state when its document can no longer be restored. */
  forget(workspaceId: string): void {
    if (this.snapshot.workspaceId === workspaceId) this.bind(null);
    this.entries.delete(workspaceId);
    this.histories.delete(workspaceId);
  }

  /** Install portable project preferences without recording a user edit or writing browser-specific metadata. */
  restore(guide: GroundGuide): void {
    this.cancelDrag();
    const validated = Object.freeze(groundGuideSchema.parse(guide));
    if (this.snapshot.workspaceId !== null) this.histories.delete(this.snapshot.workspaceId);
    this.install({ ...this.snapshot, guide: validated, persistenceMessage: '' });
  }

  update(patch: Partial<GroundGuide>): void {
    this.cancelDrag();
    const { workspaceId, guide: previous } = this.snapshot;
    if (workspaceId === null) return;
    const guide = updateGroundGuide(previous, patch);
    if (guide.enabled === previous.enabled && guide.y === previous.y && guide.snapEnabled === previous.snapEnabled)
      return;
    this.record(previous);
    this.persist(guide);
  }

  private persist(guide: GroundGuide): void {
    const { workspaceId } = this.snapshot;
    if (workspaceId === null) return;
    let persistenceMessage = '';
    try {
      this.storage().setItem(this.key(workspaceId), JSON.stringify({ version: 1, guide }));
    } catch {
      persistenceMessage = 'Ground settings could not be saved. Changes will be kept for this session.';
    }
    this.install({ workspaceId, guide, persistenceMessage });
  }

  private history() {
    const id = this.snapshot.workspaceId;
    if (!this.historyEnabled || id === null) return undefined;
    let history = this.histories.get(id);
    if (!history) {
      history = { undo: [], redo: [] };
      this.histories.set(id, history);
    }
    return history;
  }

  private record(previous: GroundGuide): void {
    const history = this.history();
    if (!history) return;
    history.undo.push(previous);
    if (history.undo.length > 100) history.undo.shift();
    history.redo.length = 0;
  }

  undo(): void {
    this.cancelDrag();
    const history = this.history();
    const guide = history?.undo.pop();
    if (!guide || !history) return;
    history.redo.push(this.snapshot.guide);
    this.persist(guide);
  }

  redo(): void {
    this.cancelDrag();
    const history = this.history();
    const guide = history?.redo.pop();
    if (!guide || !history) return;
    history.undo.push(this.snapshot.guide);
    this.persist(guide);
  }

  /** Live metadata drafts notify the inspector, but persist only once on release. */
  beginDrag(): boolean {
    if (this.dragStart || this.snapshot.workspaceId === null || !this.snapshot.guide.enabled) return false;
    this.dragStart = this.snapshot.guide;
    this.install(this.snapshot);
    return true;
  }

  previewDrag(y: number): void {
    if (!this.dragStart || !Number.isFinite(y)) return;
    this.install({ ...this.snapshot, guide: updateGroundGuide(this.snapshot.guide, { y }) });
  }

  endDrag(): void {
    const previous = this.dragStart;
    if (!previous) return;
    this.dragStart = undefined;
    if (previous.y !== this.snapshot.guide.y) {
      this.record(previous);
      this.persist(this.snapshot.guide);
    } else this.install(this.snapshot);
  }

  cancelDrag(): void {
    const guide = this.dragStart;
    if (!guide) return;
    this.dragStart = undefined;
    this.install({ ...this.snapshot, guide });
  }

  resetY(): void {
    this.update({ y: defaultGroundGuide(this.space).y });
  }
}
