import type { Point } from '../../engine/affineMath.js';
import { roundEditorNumber } from '../shared/editorData.js';

/** DOM pixels -> Phaser viewport pixels -> world units, including FIT scaling and camera zoom/pan. */
export function stagePoint(
  client: Point,
  bounds: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number; getWorldPoint(x: number, y: number): Point },
): Point {
  return viewport.getWorldPoint(
    ((client.x - bounds.left) / bounds.width) * viewport.width,
    ((client.y - bounds.top) / bounds.height) * viewport.height,
  );
}

export function draggedPosition(start: Point, origin: Point, current: Point, axis: 'x' | 'y' | 'both'): Point {
  return {
    x: roundEditorNumber(origin.x + (axis === 'y' ? 0 : current.x - start.x)),
    y: roundEditorNumber(origin.y + (axis === 'x' ? 0 : current.y - start.y)),
  };
}
