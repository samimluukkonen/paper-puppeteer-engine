import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** React presentation hosted by the existing inspector's delegated numeric/history controller. */
export function AlignmentInspector({
  scope,
  width,
  height,
  originX,
  originY,
  scaleX,
  scaleY,
  rotation,
}: {
  scope: 'sprite' | 'attachment';
  width: number;
  height: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}) {
  return (
    <section aria-label="Artwork alignment">
      <h4>Sprite Origin Editing</h4>
      <div className="property">
        <span>Image dimensions (px)</span>
        <strong data-alignment="dimensions">
          {width} × {height}
        </strong>
      </div>
      <div className="property">
        <span>Joint reference (world)</span>
        <strong data-alignment="joint" />
      </div>
      <div className="property">
        <span>Artwork scale / rotation (rad)</span>
        <strong data-alignment="appearance">
          {scaleX}, {scaleY} / {rotation}
        </strong>
      </div>
      {(['X', 'Y'] as const).map((axis) => (
        <label className="property" key={axis}>
          <span>Origin {axis} (px)</span>
          <input
            type="number"
            step="any"
            min="0"
            max={axis === 'X' ? width : height}
            data-scope={scope}
            data-field={`origin${axis}`}
            data-pixels="true"
            defaultValue={axis === 'X' ? originX * width : originY * height}
          />
        </label>
      ))}
      <p>
        Origins are texture-local fractions. Changing the origin keeps the offset and joint fixed; artwork shifts around
        that pivot.
      </p>
      <div className="action-grid">
        <button type="button" data-alignment-action="offset">
          Reset sprite offset
        </button>
        <button type="button" data-alignment-action="origin">
          Reset origin
        </button>
        <button type="button" data-alignment-action="center">
          Center sprite origin
        </button>
      </div>
    </section>
  );
}

export function mountAlignmentInspector(
  host: HTMLElement,
  props: Parameters<typeof AlignmentInspector>[0],
): () => void {
  const root = createRoot(host);
  flushSync(() => root.render(<AlignmentInspector {...props} />));
  // The outer React workspace can dispose this controller during its own cleanup.
  // Release the nested root after that commit, also safe when its host was replaced.
  return () => queueMicrotask(() => root.unmount());
}
