import type { Point } from '../../engine/data.js';
import { editorWorldViewport, type EditorViewportCamera } from '../shared/editorCamera.js';
import { roundEditorNumber } from '../shared/editorData.js';

/** DOM pixels -> Phaser viewport pixels -> world units, including FIT scaling and camera zoom/pan. */
export function stagePoint(
  client: Point,
  bounds: { left: number; top: number; width: number; height: number },
  viewport: EditorViewportCamera & { readonly x?: number; readonly y?: number },
): Point {
  const view = editorWorldViewport(viewport);
  if (!view || bounds.width <= 0 || bounds.height <= 0) return { x: NaN, y: NaN };
  // Use current camera properties: Phaser's cached matrix may still describe the previous frame.
  return {
    x: view.left + (((client.x - bounds.left) / bounds.width) * viewport.width - (viewport.x ?? 0)) / viewport.zoom,
    y: view.top + (((client.y - bounds.top) / bounds.height) * viewport.height - (viewport.y ?? 0)) / viewport.zoom,
  };
}

export function draggedPosition(start: Point, origin: Point, current: Point, axis: 'x' | 'y' | 'both'): Point {
  return {
    x: roundEditorNumber(origin.x + (axis === 'y' ? 0 : current.x - start.x)),
    y: roundEditorNumber(origin.y + (axis === 'x' ? 0 : current.y - start.y)),
  };
}
