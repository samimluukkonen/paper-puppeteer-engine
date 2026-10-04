import { EventEmitter } from 'node:events';
import { afterEach, assert, test, vi } from 'vitest';
import { DemoPresenter } from '../src/demo/DemoPresenter.js';
import { DemoScene, type DemoState } from '../src/demo/DemoScene.js';
import { demoIK } from '../src/demo/demoIK.js';
import { Puppet } from '../src/engine/Puppet.js';
import { loadSceneCharacter } from '../src/shared/loadSceneCharacter.js';
import { demoAnimations, demoRig } from './helpers/demoCharacter.js';
import { demoPuppetScene } from './helpers/demoPuppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      events = new EventEmitter();
      sys = { isActive: () => true };
      add = { text: vi.fn() };
    },
    Scenes: { Events: { SHUTDOWN: 'shutdown', UPDATE: 'update' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Math: {
      Vector2: class {
        constructor(
          public x: number,
          public y: number,
        ) {}
      },
    },
  },
}));
vi.mock('../src/shared/loadSceneCharacter.js', () => ({ loadSceneCharacter: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

function commandFixture() {
  const notifications: DemoState[] = [];
  const scene = new DemoScene((state) => {
    for (const { id } of scene.puppet!.rig.bones) {
      const bone = scene.puppet!.getBone(id);
      assert.equal(bone.pose.x, bone.container.x);
      assert.equal(bone.pose.y, bone.container.y);
      assert.approximately(Math.sin(bone.pose.rotation), Math.sin(bone.container.rotation), 1e-12);
    }
    notifications.push(state);
  });
  const display = demoPuppetScene();
  const puppet = new Puppet(display, {
    rig: demoRig,
    skin: 'default',
    animations: demoAnimations,
    ik: demoIK,
    x: 380,
    y: 362,
    scale: 1.08,
    autoUpdate: false,
  });
  scene.puppet = puppet;
  const presenter = new DemoPresenter(display, puppet);
  Reflect.set(scene, 'presentation', presenter);
  return { scene, puppet, presenter, notifications };
}

test('demo commands present once before reporting playback, facing, layers and IK state', () => {
  const { scene, puppet, presenter, notifications } = commandFixture();
  const present = vi.spyOn(presenter, 'update');
  const commands: [() => void, Partial<DemoState>][] = [
    [() => scene.play('walk'), { animation: 'walk', handIK: false }],
    [() => scene.crossfade('idle'), { animation: 'idle' }],
    [() => scene.toggleStepped(), { playback: 'stepped' }],
    [() => scene.setSteppedFPS(12), { fps: 12 }],
    [() => scene.toggleHandIK(), { handIK: true }],
    [() => scene.toggleFootIK(), { footIK: true }],
    [() => scene.face('left'), { facing: 'left' }],
    [() => scene.restart(), { playing: true }],
    [() => scene.togglePlayback(), { playing: false }],
    [() => scene.togglePlayback(), { playing: true }],
    [() => scene.toggleUpperBody(), { upperBody: true }],
    [() => scene.toggleProp(), { katanaVisible: false }],
    [() => scene.play('sword'), { animation: 'sword', handIK: true }],
  ];
  try {
    for (const [command, expected] of commands) {
      notifications.length = 0;
      present.mockClear();
      command();
      assert.equal(present.mock.calls.length, 1);
      assert.equal(notifications.length, 1);
      assert.include(notifications[0]!, expected);
    }
  } finally {
    puppet.destroy();
  }
});

test('rejected FPS commands preserve the UI setting and do not present a partial update', () => {
  const { scene, puppet, presenter, notifications } = commandFixture();
  const present = vi.spyOn(presenter, 'update');
  try {
    scene.setSteppedFPS(12);
    notifications.length = 0;
    present.mockClear();
    assert.throws(() => scene.setSteppedFPS(-1), /FPS/);
    assert.equal(present.mock.calls.length, 0);
    assert.equal(notifications.length, 0);
    scene.toggleDebug();
    assert.equal(notifications[0]!.fps, 12);
  } finally {
    puppet.destroy();
  }
});

test('time-zero animation events cannot notify the UI before a command finishes presentation', () => {
  const { scene, puppet, notifications } = commandFixture();
  try {
    scene.play('sword');
    notifications.length = 0;
    puppet.addAnimation({
      name: 'marked',
      duration: 100,
      loop: false,
      tracks: {},
      events: [{ time: 0, name: 'start' }],
    });
    puppet.onAnimationEvent((event) => {
      Reflect.set(scene, 'lastEvent', event.name);
      Reflect.get(scene, 'notify').call(scene);
    });
    scene.play('marked');
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.handIK, false);
    assert.equal(notifications[0]!.lastEvent, 'start');
  } finally {
    puppet.destroy();
  }
});

test('shutdown releases demo references and updates wait for the replacement puppet', () => {
  vi.mocked(loadSceneCharacter).mockImplementation(() => new Promise(() => {}));
  const scene = new DemoScene(vi.fn());
  scene.create();
  const update = vi.fn(() => {
    throw new Error('Destroyed puppet was updated');
  });
  scene.puppet = { animationPlayer: { update } } as unknown as Puppet;
  Object.assign(scene, { presentation: {}, authoring: { active: true }, controls: {} });
  scene.events.emit('shutdown');
  assert.isUndefined(scene.puppet);
  for (const key of ['presentation', 'authoring', 'controls']) assert.isUndefined(Reflect.get(scene, key));
  scene.create();
  assert.doesNotThrow(() => scene.update(0, 16));
  assert.equal(update.mock.calls.length, 0);
});

test('a character load failure after shutdown does not create scene objects', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(loadSceneCharacter).mockImplementation(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  const scene = new DemoScene(vi.fn());
  const text = vi.spyOn(scene.add, 'text');
  scene.create();
  scene.events.emit('shutdown');
  vi.spyOn(scene.sys, 'isActive').mockReturnValue(false);
  reject(new Error('Late failure'));
  await Promise.resolve();
  assert.equal(text.mock.calls.length, 0);
});
