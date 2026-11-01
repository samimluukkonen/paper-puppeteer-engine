import { notifySubscribers } from '../shared/subscriberNotifications.js';

export type SceneRevision = 'authored' | 'selection' | 'presentation';
interface SceneRevisionSource {
  readonly id: string;
}

/** Own revision snapshots and subscriptions; callers publish only after updating their owned state. */
export class SceneEditorNotifications {
  private revision = 0;
  private readonly revisions: Record<SceneRevision, number> = { authored: 0, selection: 0, presentation: 0 };
  private scene: SceneRevisionSource | null = null;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.revision;
  readonly getAuthoredSnapshot = (): number => this.revisions.authored;
  readonly getSelectionSnapshot = (): number => this.revisions.selection;
  readonly getPresentationSnapshot = (): number => this.revisions.presentation;

  subscribeRevision(kind: SceneRevision, listener: () => void): () => void {
    let revision = this.revisions[kind];
    return this.subscribe(() => {
      if (revision === this.revisions[kind]) return;
      // Consume before calling back: stage measurements can publish reentrantly.
      revision = this.revisions[kind];
      listener();
    });
  }

  publish(scene: SceneRevisionSource | null, kind?: 'selection' | 'presentation'): void {
    const authoredChanged = scene !== this.scene;
    if (scene?.id !== this.scene?.id) this.revisions.selection++;
    if (authoredChanged) {
      this.scene = scene;
      this.revisions.authored++;
    }
    if (kind === 'selection') this.revisions.selection++;
    else if (kind === 'presentation' || !authoredChanged) this.revisions.presentation++;
    this.revision++;
    notifySubscribers(this.listeners, 'Scene document subscribers failed.');
  }
}
