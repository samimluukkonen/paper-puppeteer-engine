import { assert, test } from 'vitest';
import { panCamera, zoomCameraAt } from '../src/devtools/shared/editorCamera.js';

function camera(zoom: number) {
  return {
    scrollX: 30,
    scrollY: -20,
    width: 760,
    height: 640,
    zoom,
    setZoom(value: number) {
      this.zoom = value;
      return this;
    },
  };
}

test.each([0.5, 1, 2])('camera panning follows a screen drag at zoom %s', (zoom) => {
  const view = camera(zoom);
  panCamera(view, 20, -10);
  assert.equal(view.scrollX, 30 - 20 / zoom);
  assert.equal(view.scrollY, -20 + 10 / zoom);
});

test.each([
  { zoom: 1, delta: -200 },
  { zoom: 2, delta: 200 },
  { zoom: 3, delta: -10_000 },
  { zoom: 0.5, delta: 10_000 },
])('zooming retains the world point under the pointer, including limits ($zoom, $delta)', ({ zoom, delta }) => {
  const view = camera(zoom);
  const x = 123;
  const y = 456;
  // Phaser zooms around the viewport center, before applying the camera scroll.
  const world = () => ({
    x: view.scrollX + view.width / 2 + (x - view.width / 2) / view.zoom,
    y: view.scrollY + view.height / 2 + (y - view.height / 2) / view.zoom,
  });
  const before = world();
  zoomCameraAt(view, x, y, delta);
  assert.closeTo(world().x, before.x, 1e-10);
  assert.closeTo(world().y, before.y, 1e-10);
  assert.isAtLeast(view.zoom, 0.35);
  assert.isAtMost(view.zoom, 4);
  if (delta === -10_000) assert.equal(view.zoom, 4);
  if (delta === 10_000) assert.equal(view.zoom, 0.35);
});
