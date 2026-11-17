import type { SnapshotHistory } from '../shared/SnapshotHistory.js';
import {
  cameraKeyOf,
  idOf,
  selectedActionIdsOf,
  type SceneCameraKeySelection,
  type SceneSelection,
} from './SceneSelection.js';

export interface SceneGestureTargets {
  actor: string;
  image: string;
  action: string;
  audio: string;
  /** The scene time the camera drag keys at. */
  camera: number;
  cameraKey: SceneCameraKeySelection;
}
export type SceneGestureKind = keyof SceneGestureTargets;
type GestureHistory = Pick<SnapshotHistory<unknown>, 'beginOperation' | 'endOperation' | 'cancelOperation'>;
type ActiveGesture = {
  [Kind in SceneGestureKind]: { kind: Kind; target: SceneGestureTargets[Kind]; history: GestureHistory };
}[SceneGestureKind];
/** Identifies one begun gesture; a later gesture never matches an earlier token. */
export type SceneGesture = Readonly<ActiveGesture>;

/** Bind each gesture to its starting history, independent of the currently selected scene. */
export class SceneEditorGestures {
  private active: ActiveGesture | null = null;

  constructor(private readonly notify: () => void) {}

  get hasActiveGesture(): boolean {
    return this.active !== null;
  }

  target<Kind extends SceneGestureKind>(kind: Kind): SceneGestureTargets[Kind] | null {
    // The discriminant ties the target type to the requested kind.
    return this.active?.kind === kind ? (this.active.target as SceneGestureTargets[Kind]) : null;
  }

  begin<Kind extends SceneGestureKind>(
    kind: Kind,
    target: SceneGestureTargets[Kind],
    history: GestureHistory,
  ): SceneGesture {
    this.cancel();
    history.beginOperation();
    const gesture = { kind, target, history } as ActiveGesture;
    this.active = gesture;
    return gesture;
  }

  isActive(gesture: SceneGesture): boolean {
    return this.active === gesture;
  }

  end(...kinds: SceneGestureKind[]): void {
    this.finish(false, kinds);
  }

  cancel(...kinds: SceneGestureKind[]): void {
    this.finish(true, kinds);
  }

  /** Finish `gesture` only while it is still the active one; a stale token is inert. */
  release(gesture: SceneGesture, cancel: boolean): void {
    if (this.active === gesture) this.finish(cancel, []);
  }

  /** A selection change cancels the active gesture unless `next` selects the item it drags. */
  keepFor(next: SceneSelection): void {
    if (this.active && !selects(next, this.active)) this.cancel();
  }

  private finish(cancel: boolean, kinds: readonly SceneGestureKind[]): void {
    const active = this.active;
    if (!active || (kinds.length > 0 && !kinds.includes(active.kind))) return;
    this.active = null;
    if (cancel) active.history.cancelOperation();
    else active.history.endOperation();
    this.notify();
  }
}

function selects(selection: SceneSelection, gesture: ActiveGesture): boolean {
  switch (gesture.kind) {
    case 'actor':
      return selection?.kind === 'actor' && selection.id === gesture.target;
    case 'image':
    case 'audio':
      return idOf(selection, gesture.kind) === gesture.target;
    case 'action':
      // The primary (last) action is the one a timeline drag moves.
      return selectedActionIdsOf(selection).at(-1) === gesture.target;
    case 'camera':
      return selection?.kind === 'camera' && selection.key === null;
    case 'cameraKey': {
      const key = cameraKeyOf(selection);
      return key?.property === gesture.target.property && key.id === gesture.target.id;
    }
  }
}
