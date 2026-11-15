import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { worldToLocal } from '../src/devtools/rig-editor/coordinates.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Vector2: class {
        constructor(
          public x: number,
          public y: number,
        ) {}
      },
    },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture() {
  const scene = puppetScene();
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      ...Array.from({ length: 32 }, (_, index) => ({
        id: `bone${index}`,
        parent: 'root',
        x: index * 4,
        y: 20,
      })),
    ],
  });
  const puppet = new Puppet(scene, { rig, autoUpdate: false });
  const state = new RigEditorState(rig);
  state.visibility.boneNames = true;
  const camera = {
    x: 0,
    y: 0,
    width: 760,
    height: 640,
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    originX: 0.5,
    originY: 0.5,
    matrixCombined: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    getWorldPoint(x: number, y: number) {
      return worldToLocal({ x, y }, this.matrixCombined)!;
    },
  };
  scene.cameras = { main: camera } as unknown as Phaser.Cameras.Scene2D.CameraManager;
  let graphicsCount = 0;
  let draws = 0;
  let textUpdates = 0;
  const labels: Phaser.GameObjects.Text[] = [];
  const graphics = scene.add.graphics.bind(scene.add);
  scene.add.graphics = () => {
    const marker = ++graphicsCount === 2;
    return Object.assign(graphics(), {
      setScrollFactor() {
        return this;
      },
      clear() {
        if (marker) ++draws;
        return this;
      },
    });
  };
  const text = scene.add.text.bind(scene.add);
  scene.add.text = (...args) => {
    const label = Object.assign(text(...args), {
      setScrollFactor() {
        return this;
      },
      setText() {
        ++textUpdates;
        return this;
      },
      setColor() {
        return this;
      },
    });
    labels.push(label);
    return label;
  };
  const overlay = new RigEditorOverlay(scene, puppet, state, []);
  return {
    state,
    camera,
    puppet,
    overlay,
    labels,
    get draws() {
      return draws;
    },
    get textUpdates() {
      return textUpdates;
    },
  };
}

test('idle editor frames retain marker geometry and labels without redrawing', () => {
  const current = fixture();
  current.overlay.draw();
  for (let frame = 0; frame < 120; ++frame) current.overlay.draw();
  assert.equal(current.draws, 1);
  assert.equal(current.textUpdates, current.state.rig.bones.length);
  assert.equal(current.labels.length, current.state.rig.bones.length);
});

const changes: [string, (current: ReturnType<typeof fixture>) => void][] = [
  ['authored data', ({ state }) => state.editBone('root', 'x', 42)],
  ['selection', ({ state }) => state.selectBone('root')],
  [
    'edit mode',
    ({ state }) => {
      state.editMode = 'sprite';
    },
  ],
  [
    'grid',
    ({ state }) => {
      state.gridSnap = 5;
    },
  ],
  [
    'IK preview',
    ({ state }) => {
      state.ikPreview = true;
    },
  ],
  [
    'puppet position',
    ({ puppet }) => {
      puppet.container.x = 12;
    },
  ],
  [
    'puppet scale',
    ({ puppet }) => {
      puppet.container.scaleX = -1;
    },
  ],
  ...(['artwork', 'bones', 'boneNames', 'boneLengths', 'slots', 'spriteOrigins', 'ik'] as const).map(
    (key): [string, (current: ReturnType<typeof fixture>) => void] => [
      `visibility ${key}`,
      ({ state }) => {
        state.visibility[key] = !state.visibility[key];
      },
    ],
  ),
  ...(['x', 'y', 'width', 'height', 'scrollX', 'scrollY', 'zoom', 'originX', 'originY'] as const).map(
    (key): [string, (current: ReturnType<typeof fixture>) => void] => [
      `camera ${key}`,
      ({ camera }) => {
        camera[key] += 1;
      },
    ],
  ),
  ...(['a', 'b', 'c', 'd', 'tx', 'ty'] as const).map((key): [string, (current: ReturnType<typeof fixture>) => void] => [
    `camera matrix ${key}`,
    ({ camera }) => {
      camera.matrixCombined[key] += 0.25;
    },
  ]),
];

test.each(changes)('%s redraws the overlay once and then resumes caching', (_name, change) => {
  const current = fixture();
  current.overlay.draw();
  change(current);
  current.overlay.draw();
  assert.equal(current.draws, 2);
  current.overlay.draw();
  assert.equal(current.draws, 2);
});

test('invalidation projects changed preview joints without an authored data change', () => {
  const current = fixture();
  current.overlay.draw();
  const label = current.labels[1]!;
  const before = label.x;
  current.puppet.getBone('bone0').pose.x = 42;
  current.puppet.posePipeline.syncPose();
  current.overlay.invalidate();
  current.overlay.draw();
  assert.equal(label.x - before, 42);
  assert.equal(current.draws, 2);
  current.overlay.draw();
  assert.equal(current.draws, 2);
});

test('a camera matrix refresh after scrolling updates labels on the following frame', () => {
  const current = fixture();
  current.overlay.draw();
  const before = current.labels[0]!.x;
  current.camera.scrollX = 20;
  current.overlay.draw();
  assert.equal(current.labels[0]!.x, before, 'the camera matrix has not refreshed yet');
  current.camera.matrixCombined.tx = -20;
  current.overlay.draw();
  assert.equal(current.labels[0]!.x, before - 20);
  assert.equal(current.draws, 3);
});

test.skipIf(import.meta.env.VITE_PROFILE !== '1')('idle overlay CPU profile (cached versus forced redraw)', () => {
  const current = fixture();
  const measure = (redraw: boolean): number => {
    const frame = () => {
      if (redraw) current.overlay.invalidate();
      current.overlay.draw();
    };
    for (let index = 0; index < 1000; ++index) frame();
    const samples: number[] = [];
    for (let batch = 0; batch < 7; ++batch) {
      const start = performance.now();
      for (let index = 0; index < 2000; ++index) frame();
      samples.push(((performance.now() - start) * 1000) / 2000);
    }
    samples.sort((a, b) => a - b);
    return samples[3]!;
  };
  const redraw = measure(true);
  const cached = measure(false);
  console.log(
    `Idle overlay (33 joints): forced redraw ${redraw.toFixed(2)} us/frame; cached ${cached.toFixed(2)} us/frame.`,
  );
});
