import type { SnapshotHistory } from '../shared/SnapshotHistory.js';

export interface SceneGestureTargets {
  actor: string;
  image: string;
  action: string;
  audio: string;
  camera: number;
  cameraKey: true;
}
type GestureKind = keyof SceneGestureTargets;
type GestureHistory = Pick<SnapshotHistory<unknown>, 'beginOperation' | 'endOperation' | 'cancelOperation'>;
type ActiveGesture = {
  [Kind in GestureKind]: { kind: Kind; target: SceneGestureTargets[Kind]; history: GestureHistory };
}[GestureKind];

/** Bind each gesture to its starting history, independent of the currently selected scene. */
export class SceneEditorGestures {
  private active: ActiveGesture | null = null;

  constructor(private readonly notify: () => void) {}

  get hasActiveGesture(): boolean {
    return this.active !== null;
  }

  target<Kind extends GestureKind>(kind: Kind): SceneGestureTargets[Kind] | null {
    // The discriminant ties the target type to the requested kind.
    return this.active?.kind === kind ? (this.active.target as SceneGestureTargets[Kind]) : null;
  }

  begin<Kind extends GestureKind>(kind: Kind, target: SceneGestureTargets[Kind], history: GestureHistory): void {
    this.cancel();
    history.beginOperation();
    this.active = { kind, target, history } as ActiveGesture;
  }

  end(...kinds: GestureKind[]): void {
    this.finish(false, kinds);
  }

  cancel(...kinds: GestureKind[]): void {
    this.finish(true, kinds);
  }

  private finish(cancel: boolean, kinds: readonly GestureKind[]): void {
    const active = this.active;
    if (!active || (kinds.length > 0 && !kinds.includes(active.kind))) return;
    this.active = null;
    if (cancel) active.history.cancelOperation();
    else active.history.endOperation();
    this.notify();
  }
}
