import type { EditorViewportCamera } from '../shared/editorCamera.js';
import { groundGuideHandleHit } from '../shared/groundGuide.js';
import type { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';

type Point = { x: number; y: number };

/** Label-only scene-world gesture. The stage owns DOM capture and cancellation events. */
export class SceneGroundHandle {
  private pointer: number | undefined;
  private offset = 0;
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly workspace: GroundGuideWorkspace) {
    this.unsubscribe = workspace.subscribe(() => {
      if (!workspace.getSnapshot().dragging) this.pointer = undefined;
    });
  }

  get dragging(): boolean {
    return this.pointer !== undefined;
  }

  down(pointer: number, point: Point, camera: EditorViewportCamera): boolean {
    if (this.disposed || this.dragging) return false;
    const { guide } = this.workspace.getSnapshot();
    if (!groundGuideHandleHit(guide, camera, point) || !this.workspace.beginDrag()) return false;
    this.offset = guide.y - point.y;
    this.pointer = pointer;
    return true;
  }

  move(pointer: number, point: Point): void {
    if (this.disposed || pointer !== this.pointer) return;
    if (!Number.isFinite(point.y)) this.cancel();
    else this.workspace.previewDrag(point.y + this.offset);
  }

  up(pointer: number, point: Point): void {
    if (this.disposed || pointer !== this.pointer) return;
    this.move(pointer, point);
    this.pointer = undefined;
    this.workspace.endDrag();
  }

  cancel(): void {
    this.pointer = undefined;
    this.workspace.cancelDrag();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
  }
}
