import { z } from 'zod';
import { throwNotificationErrors } from '../../engine/notifications.js';
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
}

/** Per-document browser metadata, separate from authored JSON, dirty state and undo history.
 * The identity is a character manifest URL (animation) or scene ID (scene editor).
 */
export class GroundGuideWorkspace {
  private readonly entries = new Map<string, GroundGuideSnapshot>();
  private readonly listeners = new Set<() => void>();
  private snapshot: GroundGuideSnapshot;

  constructor(
    readonly space: GroundGuideSpace,
    private readonly storage: () => GuideStorage = () => window.localStorage,
  ) {
    this.snapshot = Object.freeze({ workspaceId: null, guide: defaultGroundGuide(space), persistenceMessage: '' });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): GroundGuideSnapshot => this.snapshot;

  private key(id: string): string {
    return `paper-puppeteer:ground-guide:v1:${this.space}:${encodeURIComponent(id)}`;
  }

  private install(snapshot: GroundGuideSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    if (snapshot.workspaceId !== null) this.entries.set(snapshot.workspaceId, this.snapshot);
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
    const retained = workspaceId === null ? undefined : this.entries.get(workspaceId);
    if (retained) {
      this.install(retained);
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

  update(patch: Partial<GroundGuide>): void {
    const { workspaceId, guide: previous } = this.snapshot;
    if (workspaceId === null) return;
    const guide = updateGroundGuide(previous, patch);
    if (guide.enabled === previous.enabled && guide.y === previous.y && guide.snapEnabled === previous.snapEnabled)
      return;
    let persistenceMessage = '';
    try {
      this.storage().setItem(this.key(workspaceId), JSON.stringify({ version: 1, guide }));
    } catch {
      persistenceMessage = 'Ground settings could not be saved. Changes will be kept for this session.';
    }
    this.install({ workspaceId, guide, persistenceMessage });
  }

  resetY(): void {
    this.update({ y: defaultGroundGuide(this.space).y });
  }
}
