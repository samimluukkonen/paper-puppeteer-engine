import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorGhostLayer } from '../src/devtools/animation-editor/AnimationEditorGhostLayer.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import type { Bone } from '../src/engine/Bone.js';
import { Puppet } from '../src/engine/Puppet.js';
import type { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

afterEach(() => vi.restoreAllMocks());

interface Ghost {
  container: Phaser.GameObjects.Container;
  bones: Map<string, Bone>;
  renderer: PuppetRenderer;
}

function fixture() {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', x: 10, y: 20, rotation: 0.3, scaleX: 1.4, scaleY: 0.8 },
      { id: 'arm', parent: 'root', y: 25, sprite: { texture: 'arm', x: 2, y: 3, originX: 0.2, originY: 0.1 } },
      { id: 'hand', parent: 'arm', y: 40, rotation: -0.5, scaleY: 1.2 },
      { id: 'leg', parent: 'root', x: -10, y: 50 },
    ],
    slots: [{ id: 'glove', bone: 'hand', x: 3, y: 7, rotation: 0.2, scaleX: 0.8, depth: 13 }],
    attachments: [
      { id: 'blue', texture: 'glove', frame: 'blue', originX: 0.1, originY: 0.8, x: 2, y: 4, rotation: 0.4 },
      { id: 'red', texture: 'glove2', frame: 'red', originX: 0.8, originY: 0.3, scaleX: 1.4, scaleY: 0.7 },
    ],
    skins: [
      { version: 1, name: 'blue', slots: { glove: 'blue' } },
      { version: 1, name: 'red', slots: { glove: 'red' } },
    ],
  });
  const scene = puppetScene();
  Object.assign(scene.textures, { get: () => ({ has: () => true }) });
  const puppet = new Puppet(scene, { rig, skin: 'blue', x: 90, y: 120, scale: 1.5, autoUpdate: false });
  const state = new AnimationEditorState(rig, [
    {
      name: 'move',
      duration: 1000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 10 },
          { time: 1000, x: 100 },
        ],
        arm: [
          { time: 0, rotation: -0.8 },
          { time: 1000, rotation: 0.8 },
        ],
        leg: [
          { time: 0, rotation: 0.5 },
          { time: 1000, rotation: -0.5 },
        ],
      },
      events: [{ time: 600, name: 'event' }],
    },
    { name: 'empty', duration: 50, loop: false, tracks: {} },
  ]);
  state.selectAnimation('move');
  state.setCurrentTime(0.5);
  const preview = new AnimationEditorPreview(state, puppet);
  const layer = new AnimationEditorGhostLayer(scene, state, puppet);
  const ghosts = Reflect.get(layer, 'instances') as Map<string, Ghost>;
  const dispose = () => {
    layer.dispose();
    preview.dispose();
    puppet.destroy();
  };
  return { rig, scene, puppet, state, layer, ghosts, dispose };
}

function matrixClose(actual: Phaser.GameObjects.Image, expected: Phaser.GameObjects.Image) {
  const a = actual.getWorldTransformMatrix();
  const b = expected.getWorldTransformMatrix();
  for (const field of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) assert.approximately(a[field], b[field], 1e-9, field);
}

function reference(scene: Phaser.Scene, rig: Rig, state: AnimationEditorState, time: number) {
  const puppet = new Puppet(scene, { rig, skin: 'blue', x: 90, y: 120, scale: 1.5, autoUpdate: false });
  const pose = state.sampleGhostPose(time)!;
  for (const definition of rig.bones) Object.assign(puppet.getBone(definition.id).pose, pose.get(definition.id));
  puppet.syncPose();
  return puppet;
}

test('six ghosts match sampled affine poses and immediately reuse their pool across counts, spacing, tint and opacity', () => {
  const f = fixture();
  try {
    const settings = { enabled: true, previousCount: 3, nextCount: 3, frameSpacing: 1 };
    f.layer.setSettings(settings);
    assert.equal(f.ghosts.size, 6);
    for (const direction of ['previous', 'next'] as const) {
      for (let distance = 1; distance <= 3; ++distance) {
        const ghost = f.ghosts.get(`${direction}-${distance}`)!;
        const time = 0.5 + ((direction === 'previous' ? -1 : 1) * distance) / 10;
        const expected = reference(f.scene, f.rig, f.state, time);
        try {
          matrixClose(ghost.bones.get('arm')!.sprite!, expected.getBone('arm').sprite!);
          matrixClose(ghost.renderer.getSlotImage('glove')!, expected.getSlotImage('glove')!);
          assert.isTrue(ghost.container.visible);
          assert.isBelow(ghost.container.depth, f.puppet.container.depth);
        } finally {
          expected.destroy();
        }
      }
    }
    const pool = [...f.ghosts.values()];
    const createImage = vi.spyOn(f.scene.add, 'image');
    const createContainer = vi.spyOn(f.scene.add, 'container');
    const sample = vi.spyOn(f.state, 'sampleGhostPoses');
    f.layer.setSettings({ previousOpacity: 0.05, nextOpacity: 0.6, previousTint: 0x123456, nextTint: 0xfedcba });
    assert.equal(sample.mock.calls.length, 0, 'appearance changes reuse pose samples');
    for (const [key, ghost] of f.ghosts) {
      assert.equal(ghost.container.alpha, key.startsWith('previous') ? 0.05 : 0.6);
      assert.equal(
        Reflect.get(ghost.renderer.getSlotImage('glove')!, 'tint'),
        key.startsWith('previous') ? 0x123456 : 0xfedcba,
      );
    }
    for (const [previousCount, nextCount] of [
      [3, 0],
      [0, 3],
      [0, 0],
      [1, 1],
      [3, 3],
    ] as const) {
      f.layer.setSettings({ previousCount, nextCount });
      assert.equal(pool.filter((ghost) => ghost.container.visible).length, previousCount + nextCount);
    }
    for (const spacing of [2, 5, 1]) {
      f.layer.setSettings({ frameSpacing: spacing });
      for (const direction of ['previous', 'next'] as const) {
        const samples = f.state
          .sampleGhostPoses({ ...settings, frameSpacing: spacing })
          .filter((entry) => entry.direction === direction);
        for (let distance = 1; distance <= 3; ++distance) {
          const ghost = f.ghosts.get(`${direction}-${distance}`)!;
          assert.equal(ghost.container.visible, distance <= samples.length);
          if (distance <= samples.length)
            assert.deepEqual(ghost.bones.get('root')!.pose, samples[distance - 1]!.pose.get('root'));
        }
      }
    }
    f.puppet.setSkin('red');
    createImage.mockClear(); // The active Puppet replaces its own selected attachment.
    f.layer.sync();
    for (const ghost of pool) assert.equal(ghost.renderer.getSlotImage('glove')!.texture.key, 'glove2');
    for (let i = 0; i < 10; ++i) f.layer.updateFrame(() => f.state.setCurrentTime(0.5 + i / 100));
    assert.deepEqual([...f.ghosts.values()], pool);
    assert.equal(createContainer.mock.calls.length, 0);
    assert.equal(createImage.mock.calls.length, 0);
    assert.equal(f.puppet.container.alpha, 1);
    f.layer.dispose();
    for (const ghost of pool) assert.isTrue(ghost.container.isDestroyed);
  } finally {
    f.dispose();
  }
});

test('zero counts, hidden preview and boundaries never allocate invisible ghosts', () => {
  const f = fixture();
  try {
    f.layer.setSettings({ enabled: true, previousCount: 0, nextCount: 0 });
    assert.equal(f.ghosts.size, 0);
    f.puppet.container.setVisible(false);
    f.layer.setSettings({ previousCount: 3, nextCount: 3 });
    assert.equal(f.ghosts.size, 0);
    f.state.setCurrentTime(0);
    f.puppet.container.setVisible(true);
    f.layer.sync();
    assert.equal(f.ghosts.size, 3);
    assert.deepEqual([...f.ghosts.keys()], ['next-1', 'next-2', 'next-3']);
    f.state.setCurrentTime(1);
    assert.equal(f.ghosts.size, 6);
    for (const [key, ghost] of f.ghosts) assert.equal(ghost.container.visible, key.startsWith('previous'));
    assert.isFalse(f.state.dirty);
  } finally {
    f.dispose();
  }
});

test('all pooled ghosts follow working key movement, history, interpolation, FPS and animation switches', () => {
  const f = fixture();
  const settings = { enabled: true, previousCount: 3, nextCount: 3, frameSpacing: 1 };
  try {
    f.layer.setSettings(settings);
    const verify = () => {
      const samples = f.state.sampleGhostPoses(settings);
      for (const direction of ['previous', 'next'] as const) {
        const group = samples.filter((entry) => entry.direction === direction);
        for (let distance = 1; distance <= 3; ++distance) {
          const ghost = f.ghosts.get(`${direction}-${distance}`)!;
          assert.equal(ghost.container.visible, distance <= group.length);
          if (distance <= group.length) {
            for (const [id, bone] of ghost.bones) assert.deepEqual(bone.pose, group[distance - 1]!.pose.get(id));
          }
        }
      }
    };
    f.state.setBonePropertyKeyframe('root', 'x', 150, 0.5);
    verify();
    f.state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
    f.state.moveSelectedKeyframe(0.6);
    verify();
    f.state.undo();
    verify();
    f.state.redo();
    verify();
    f.state.setAuthoredPlaybackMode('stepped');
    f.state.setAuthoredFPS(12);
    verify();
    f.state.setAuthoredInterpolation('linear');
    verify();
    f.state.undo();
    verify();
    f.state.selectAnimation('empty');
    verify();
    f.state.selectAnimation('move');
    f.state.setCurrentTime(0.537);
    verify();
    assert.equal(f.ghosts.size, 6);
  } finally {
    f.dispose();
  }
});

test('projects complete neighboring poses through the real renderer, preserving nested affine transforms and pivots', () => {
  const f = fixture();
  try {
    f.layer.setEnabled(true);
    assert.equal(f.ghosts.size, 2);
    for (const [direction, time] of [
      ['previous', 0.4],
      ['next', 0.6],
    ] as const) {
      const ghost = f.ghosts.get(`${direction}-1`)!;
      const expected = reference(f.scene, f.rig, f.state, time);
      try {
        matrixClose(ghost.bones.get('arm')!.sprite!, expected.getBone('arm').sprite!);
        matrixClose(ghost.renderer.getSlotImage('glove')!, expected.getSlotImage('glove')!);
        assert.equal(ghost.bones.get('arm')!.sprite!.originX, 0.2);
        assert.equal(ghost.renderer.getSlotImage('glove')!.originY, 0.8);
        assert.isBelow(ghost.container.depth, f.puppet.container.depth);
        assert.equal(ghost.container.alpha, 0.22);
        assert.isTrue(ghost.container.visible);
      } finally {
        expected.destroy();
      }
    }
    assert.equal(f.puppet.container.alpha, 1);
    assert.notEqual(
      f.ghosts.get('previous-1')!.bones.get('leg')!.pose.rotation,
      f.ghosts.get('next-1')!.bones.get('leg')!.pose.rotation,
    );
    assert.isUndefined(f.ghosts.get('previous-1')!.renderer.getSlotImage('glove')!.input);
  } finally {
    f.dispose();
  }
});

test('follows skin/frame, visibility, attachment layout, depth, placement and facing without allocating new objects', () => {
  const f = fixture();
  try {
    f.layer.setEnabled(true);
    const ghost = f.ghosts.get('previous-1')!;
    const image = ghost.renderer.getSlotImage('glove')!;
    const createImage = vi.spyOn(f.scene.add, 'image');
    const createContainer = vi.spyOn(f.scene.add, 'container');
    f.puppet.setSkin('red');
    createImage.mockClear();
    f.puppet.setFacing('left');
    f.puppet.container.setPosition(-5, 13).setRotation(0.8).setScale(-2, 0.7).setDepth(40);
    f.puppet.setSlotTransform('glove', { x: 17, rotation: -0.4, scaleY: 1.7 });
    f.puppet.setRenderOrder(['hand', 'leg', 'arm', 'root']);
    f.puppet.setSlotDepth('glove', 45);
    f.layer.sync();
    assert.strictEqual(ghost.renderer.getSlotImage('glove'), image);
    assert.equal(image.texture.key, 'glove2');
    assert.equal(image.frame.name, 'red');
    assert.equal(image.originX, 0.8);
    assert.equal(image.scaleX, 1.4);
    assert.equal(ghost.renderer.getSlotMount('glove').x, 17);
    assert.equal(ghost.renderer.getSlotMount('glove').scaleY, 1.7);
    assert.equal(ghost.renderer.getSlotMount('glove').parentContainer.parentContainer.depth, 45);
    assert.deepEqual(ghost.renderer.getOrder(), f.puppet.getRenderOrder());
    assert.equal(ghost.container.x, -5);
    assert.equal(ghost.container.scaleX, -2);
    assert.equal(ghost.container.scaleY, 0.7);
    assert.approximately(ghost.container.rotation, 0.8, 1e-12);
    assert.equal(ghost.container.depth, 38);
    assert.equal(Reflect.get(image, 'tint'), 0x65a9ed);
    assert.equal(Reflect.get(f.ghosts.get('next-1')!.renderer.getSlotImage('glove')!, 'tint'), 0xf0a15d);
    const parent = f.scene.add.container(25, 35).setRotation(-0.2).setScale(0.7, 1.4);
    parent.add(f.puppet.container);
    f.layer.sync();
    assert.strictEqual(ghost.container.parentContainer, parent);
    createContainer.mockClear();
    f.puppet.getSlotImage('glove')!.setVisible(false).setAlpha(0.6).setTexture('glove2', 'other');
    f.puppet.getBone('arm').container.setVisible(false);
    f.layer.sync();
    assert.isFalse(image.visible);
    assert.equal(image.alpha, 0.6);
    assert.equal(image.frame.name, 'other');
    assert.isFalse(ghost.bones.get('arm')!.container.visible);
    f.puppet.clearSlotDepth('glove');
    f.layer.sync();
    assert.equal(ghost.renderer.getSlotMount('glove').parentContainer.parentContainer.depth, 13);
    for (let i = 0; i < 20; ++i) f.layer.sync();
    assert.equal(createImage.mock.calls.length, 0);
    assert.equal(createContainer.mock.calls.length, 0);
    f.puppet.clearAttachment('glove');
    f.layer.sync();
    assert.isTrue(image.isDestroyed);
    assert.isUndefined(ghost.renderer.getSlotImage('glove'));
    f.puppet.setAttachment('glove', 'blue');
    f.layer.sync();
    assert.equal(ghost.renderer.getSlotImage('glove')!.texture.key, 'glove');
  } finally {
    f.dispose();
  }
});

test('disabled layers allocate nothing; toggles/boundaries/selection hide and reuse resources, disposal releases them', () => {
  const f = fixture();
  try {
    const sample = vi.spyOn(f.state, 'sampleGhostPoses');
    const createImage = vi.spyOn(f.scene.add, 'image');
    f.layer.sync();
    assert.equal(f.ghosts.size, 0);
    assert.equal(sample.mock.calls.length, 0);
    assert.equal(createImage.mock.calls.length, 0);
    f.layer.setEnabled(true);
    const previous = f.ghosts.get('previous-1')!;
    const next = f.ghosts.get('next-1')!;
    const images = [previous.renderer.getSlotImage('glove')!, next.renderer.getSlotImage('glove')!];
    f.layer.setEnabled(false);
    assert.isFalse(previous.container.visible);
    assert.isFalse(next.container.visible);
    sample.mockClear();
    f.state.setCurrentTime(0.75);
    f.layer.sync();
    assert.equal(sample.mock.calls.length, 0);
    f.layer.setEnabled(true);
    assert.strictEqual(f.ghosts.get('previous-1'), previous);
    assert.strictEqual(f.ghosts.get('next-1'), next);
    f.state.setCurrentTime(0);
    assert.isFalse(previous.container.visible);
    assert.isTrue(next.container.visible);
    f.state.setCurrentTime(1);
    assert.isTrue(previous.container.visible);
    assert.isFalse(next.container.visible);
    f.state.selectAnimation('empty');
    assert.isFalse(previous.container.visible);
    assert.isFalse(next.container.visible);
    f.state.selectAnimation(null);
    assert.isFalse(previous.container.visible);
    f.state.selectAnimation('move');
    assert.isTrue(next.container.visible);
    f.layer.dispose();
    f.layer.dispose();
    assert.isTrue(previous.container.isDestroyed);
    assert.isTrue(next.container.isDestroyed);
    for (const image of images) assert.isTrue(image.isDestroyed);
    sample.mockClear();
    f.state.setCurrentTime(0.5);
    f.layer.setEnabled(true);
    f.layer.sync();
    assert.equal(f.ghosts.size, 0);
    assert.equal(sample.mock.calls.length, 0);
    assert.isFalse(f.state.dirty);
  } finally {
    f.dispose();
  }
});

test('scrubs/playback/working edits refresh authored ghosts while idle selection reuses sampling', () => {
  const f = fixture();
  try {
    f.layer.setEnabled(true);
    const ghost = f.ghosts.get('previous-1')!;
    const sample = vi.spyOn(f.state, 'sampleGhostPoses');
    f.state.selectBone('leg');
    f.layer.sync();
    assert.equal(sample.mock.calls.length, 0);
    f.state.beginScrub();
    f.state.setCurrentTime(0.7);
    f.state.endScrub();
    assert.approximately(ghost.bones.get('root')!.pose.x, 64, 1e-10);
    f.state.play();
    f.state.advancePlayback(0.05);
    f.state.pause();
    assert.approximately(ghost.bones.get('root')!.pose.x, 68.5, 1e-10);
    f.state.setBonePropertyKeyframe('root', 'x', 200, 0.65);
    assert.approximately(ghost.bones.get('root')!.pose.x, 200, 1e-10);
    f.state.undo();
    assert.approximately(ghost.bones.get('root')!.pose.x, 68.5, 1e-10);
    f.state.setAuthoredPlaybackMode('stepped');
    f.state.setAuthoredFPS(5);
    const expected = f.state.sampleGhostPoses().find((entry) => entry.direction === 'previous')!;
    assert.deepEqual(ghost.bones.get('root')!.pose, expected.pose.get('root'));
    f.state.setAuthoredInterpolation('linear');
    assert.deepEqual(ghost.bones.get('root')!.pose, f.state.sampleGhostPoses()[0]!.pose.get('root'));
  } finally {
    f.dispose();
  }
});

test('ghost rendering leaves active pose, IK, events, clock, history and authored JSON untouched', () => {
  const f = fixture();
  try {
    f.puppet.addIK({ name: 'arm', rootBone: 'root', middleBone: 'arm', endBone: 'hand' });
    f.puppet.setIKTarget('arm', 40, 100);
    f.puppet.syncPose();
    const poses = f.rig.bones.map((bone) => ({ ...f.puppet.getBone(bone.id).pose }));
    const authored = JSON.stringify(f.state.workingAnimation);
    const clock = f.state.currentTime;
    const events = vi.fn();
    const unsubscribe = f.state.onAnimationEvent(events);
    const prepare = vi.spyOn(f.puppet, 'preparePose');
    const sync = vi.spyOn(f.puppet, 'syncPose');
    try {
      f.layer.setSettings({ enabled: true, previousCount: 3, nextCount: 3 });
      for (let i = 0; i < 10; ++i) f.layer.sync();
      f.layer.setSettings({
        previousCount: 0,
        frameSpacing: 5,
        previousOpacity: 0.05,
        nextOpacity: 0.6,
        previousTint: 0,
        nextTint: 0xffffff,
      });
      f.layer.setSettings({ previousCount: 3, frameSpacing: 1 });
      f.layer.setEnabled(false);
      assert.deepEqual(
        f.rig.bones.map((bone) => f.puppet.getBone(bone.id).pose),
        poses,
      );
      assert.equal(JSON.stringify(f.state.workingAnimation), authored);
      assert.equal(f.state.currentTime, clock);
      assert.isFalse(f.state.dirty);
      assert.isFalse(f.state.canUndo);
      assert.equal(prepare.mock.calls.length, 0);
      assert.equal(sync.mock.calls.length, 0);
      assert.equal(events.mock.calls.length, 0);
      assert.deepEqual(f.ghosts.get('previous-1')!.bones.get('arm')!.pose, f.state.sampleGhostPose(0.4)!.get('arm'));
    } finally {
      unsubscribe();
    }
  } finally {
    f.dispose();
  }
});

test('scene frames project each ghost once while paused edits still refresh immediately', () => {
  const f = fixture();
  try {
    f.layer.setSettings({ enabled: true, previousCount: 3, nextCount: 3 });
    const allSyncs = [...f.ghosts.values()].map((ghost) => vi.spyOn(ghost.renderer, 'sync'));
    const previous = f.ghosts.get('previous-1')!;
    const next = f.ghosts.get('next-1')!;
    const previousSync = vi.spyOn(previous.renderer, 'sync');
    const nextSync = vi.spyOn(next.renderer, 'sync');
    f.state.play();
    previousSync.mockClear();
    nextSync.mockClear();
    for (const spy of allSyncs) spy.mockClear();
    f.layer.updateFrame(() => {
      f.state.advancePlayback(0.05);
      f.puppet.setSkin('red');
    });
    assert.equal(previousSync.mock.calls.length, 1);
    assert.equal(nextSync.mock.calls.length, 1);
    for (const spy of allSyncs) assert.equal(spy.mock.calls.length, 1);
    assert.approximately(previous.bones.get('root')!.pose.x, 50.5, 1e-10);
    assert.equal(previous.renderer.getSlotImage('glove')!.texture.key, 'glove2');

    f.state.pause();
    previousSync.mockClear();
    f.state.setCurrentTime(0.7);
    assert.equal(previousSync.mock.calls.length, 1);
    assert.approximately(previous.bones.get('root')!.pose.x, 64, 1e-10);
    f.layer.updateFrame(() => f.puppet.container.setPosition(20, 30));
    assert.equal(previous.container.x, 20);
    assert.equal(previous.container.y, 30);

    const failure = new Error('frame failed');
    assert.throws(
      () =>
        f.layer.updateFrame(() => {
          throw failure;
        }),
      'frame failed',
    );
    previousSync.mockClear();
    f.state.setCurrentTime(0.5);
    assert.equal(previousSync.mock.calls.length, 1);
  } finally {
    f.dispose();
  }
});
