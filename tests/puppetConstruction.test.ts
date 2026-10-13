import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import * as animationClip from '../src/engine/AnimationClip.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { IKDebug } from '../src/engine/ik/IKDebug.js';
import { Puppet, type PuppetOptions } from '../src/engine/Puppet.js';
import { PuppetDebug } from '../src/engine/PuppetDebug.js';
import { Rig } from '../src/engine/Rig.js';
import { SlotDebug } from '../src/engine/SlotDebug.js';
import { SlotState } from '../src/engine/SlotState.js';
import type { Facing } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.restoreAllMocks());

test('deep puppet skeletons are destroyed without recursive container teardown', () => {
  const bones = Array.from({ length: 12_000 }, (_, index) => ({
    id: `bone-${index}`,
    ...(index === 0 ? {} : { parent: `bone-${index - 1}` }),
  }));
  const puppet = new Puppet(puppetScene(), { rig: { root: 'bone-0', bones }, autoUpdate: false });
  const containers = bones.map(({ id }) => puppet.getBone(id).container);
  assert.doesNotThrow(() => puppet.destroy());
  assert.isTrue(puppet.container.isDestroyed);
  assert.isTrue(containers.every((container) => container.isDestroyed));
  assert.doesNotThrow(() => puppet.destroy());
});

test('a failing overlay cleanup does not retain skeletons or player state', () => {
  vi.spyOn(PuppetDebug.prototype, 'update').mockImplementation(() => {});
  const puppet = new Puppet(puppetScene(), {
    rig: { root: 'root', bones: [{ id: 'root' }, { id: 'child', parent: 'root' }] },
    debug: true,
    autoUpdate: false,
  });
  const child = puppet.getBone('child').container;
  const failure = new Error('Overlay cleanup failed');
  vi.spyOn(PuppetDebug.prototype, 'destroy').mockImplementation(() => {
    throw failure;
  });
  assert.throws(() => puppet.destroy(), failure.message);
  assert.isTrue(puppet.container.isDestroyed);
  assert.isTrue(child.isDestroyed);
  assert.isTrue(puppet.animationPlayer.isDisposed);
  assert.throws(() => puppet.getBone('child'), /Unknown bone/);
});

const rig = new Rig({
  root: 'root',
  bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }, { id: 'hand', parent: 'arm' }],
});
const animation = { name: 'idle', duration: 100, loop: true, tracks: {} };
const pose = { version: 1 as const, name: 'rest', bones: {} };
const ik = { name: 'armIK', rootBone: 'root', middleBone: 'arm', endBone: 'hand' };

test('unchanged slot selections skip artwork work and debug redraws; a changed slot renders independently', () => {
  const scene = puppetScene();
  const update = vi.spyOn(SlotDebug.prototype, 'update').mockImplementation(() => {});
  const puppet = new Puppet(scene, {
    rig: {
      root: 'root',
      bones: [{ id: 'root' }],
      slots: [
        { id: 'hand', bone: 'root' },
        { id: 'empty', bone: 'root' },
      ],
      attachments: [
        { id: 'open', texture: 'open' },
        { id: 'grip', texture: 'grip' },
      ],
      skins: [{ version: 1, name: 'default', slots: { hand: 'open' } }],
    },
    skin: 'default',
    slotDebug: true,
    autoUpdate: false,
  });
  const image = vi.spyOn(scene.add, 'image');
  const read = vi.spyOn(SlotState.prototype, 'getAttachment');
  update.mockClear();
  puppet.setAttachment('hand', 'open').clearAttachment('empty');
  assert.equal(read.mock.calls.length, 0, 'unchanged assignments do not scan any slots');
  puppet.setSkin('default').applySkin('default');
  assert.equal(image.mock.calls.length, 0);
  assert.equal(update.mock.calls.length, 0);
  read.mockClear();
  puppet.setAttachment('hand', 'grip');
  assert.equal(read.mock.calls.length, 1, 'a changed assignment visits only its slot');
  assert.equal(image.mock.calls.length, 1);
  assert.equal(update.mock.calls.length, 1);
  puppet.clearAttachment('hand');
  assert.equal(update.mock.calls.length, 2);
  assert.throws(() => puppet.clearAttachment('missing'), /Unknown slot/);
  assert.throws(() => puppet.setAttachment('hand', 'missing'), /Unknown attachment/);
  puppet.destroy();
});

test.each(['debug', 'ikDebug', 'slotDebug'] as const)('the %s constructor option creates only its overlay', (flag) => {
  const scene = puppetScene();
  const graphics = vi.spyOn(scene.add, 'graphics');
  const depths: number[] = [];
  for (const view of [PuppetDebug, IKDebug, SlotDebug])
    vi.spyOn(view.prototype, 'update').mockImplementation(function (this: PuppetDebug | IKDebug | SlotDebug) {
      depths.push(this.container.depth);
    });
  const puppet = new Puppet(scene, { rig, [flag]: true, autoUpdate: false, depth: 10 });
  assert.equal(graphics.mock.calls.length, 1);
  assert.equal(puppet.isDebug, flag === 'debug');
  assert.equal(puppet.isIKDebug, flag === 'ikDebug');
  assert.equal(puppet.isSlotDebug, flag === 'slotDebug');
  assert.deepEqual(depths, [flag === 'debug' ? 11 : flag === 'ikDebug' ? 12 : 13]);
  puppet.destroy();
});

test('debug overlays allocate only on first enable, retain label settings, and cannot outlive the puppet', () => {
  const scene = puppetScene();
  const text = vi.spyOn(scene.add, 'text');
  const graphics = vi.spyOn(scene.add, 'graphics');
  for (const view of [PuppetDebug, IKDebug, SlotDebug]) vi.spyOn(view.prototype, 'update').mockImplementation(() => {});
  const labelSide = vi.spyOn(PuppetDebug.prototype, 'setLabelSide');
  const destroy = [PuppetDebug, IKDebug, SlotDebug].map((view) => vi.spyOn(view.prototype, 'destroy'));
  const puppet = new Puppet(scene, {
    rig: { root: rig.root, bones: rig.bones, slots: [{ id: 'item', bone: 'hand' }] },
    autoUpdate: false,
    depth: 10,
  });
  puppet.setDebugLabelSide('hand', 'left').setDebugLabelSide('arm', 'right').setDebugLabelSide('arm');
  assert.throws(() => puppet.setDebugLabelSide('missing'), /Unknown bone/);
  assert.throws(() => puppet.setDebugLabelSide('hand', 'up' as Facing), /Invalid label side/);
  puppet.setDebug(false).setIKDebug(false).setSlotDebug(false);
  puppet.update(16);
  puppet.refreshDebugViews();
  assert.equal(text.mock.calls.length, 0);
  assert.equal(graphics.mock.calls.length, 0);
  assert.isFalse(puppet.isDebug);
  assert.isFalse(puppet.isIKDebug);
  assert.isFalse(puppet.isSlotDebug);

  puppet.setDebug(true);
  assert.equal(text.mock.calls.length, rig.bones.length);
  assert.deepEqual(labelSide.mock.calls, [['hand', 'left']]);
  puppet.setSlotDebug(true).setIKDebug(true);
  assert.equal(text.mock.calls.length, rig.bones.length + 1);
  assert.equal(graphics.mock.calls.length, 3);
  assert.isTrue(puppet.isDebug);
  assert.isTrue(puppet.isIKDebug);
  assert.isTrue(puppet.isSlotDebug);
  puppet.setDebug(false).setIKDebug(false).setSlotDebug(false);
  assert.isFalse(puppet.isDebug);
  assert.isFalse(puppet.isIKDebug);
  assert.isFalse(puppet.isSlotDebug);
  puppet.setDebug(true).setIKDebug(true).setSlotDebug(true);
  assert.equal(text.mock.calls.length, rig.bones.length + 1);
  assert.equal(graphics.mock.calls.length, 3);
  puppet.destroy();
  puppet.destroy();
  for (const release of destroy) assert.equal(release.mock.calls.length, 1);
  puppet.setDebug(true).setIKDebug(true).setSlotDebug(true);
  assert.equal(text.mock.calls.length, rig.bones.length + 1);
  assert.equal(graphics.mock.calls.length, 3);
});

test.each(['bone', 'attachment'])('%s assets validate textures and frames before allocating objects', (owner) => {
  for (const frame of ['missing', 0]) {
    const sprite = { texture: 'atlas', frame };
    const assetRig = new Rig({
      root: 'root',
      bones: [{ id: 'root', ...(owner === 'bone' ? { sprite } : {}) }],
      attachments: owner === 'attachment' ? [{ id: 'item', ...sprite }] : [],
    });
    const scene = puppetScene();
    const allocate = vi.spyOn(scene.add, 'container');
    const has = vi.fn(() => false);
    scene.textures.get = vi.fn(() => ({ has })) as unknown as typeof scene.textures.get;
    assert.throws(() => new Puppet(scene, { rig: assetRig }), new RegExp(`Missing frame.*${owner}`));
    assert.deepEqual(has.mock.calls, [[String(frame)]]);
    assert.equal(allocate.mock.calls.length, 0);
    has.mockClear();
    scene.textures.exists = () => false;
    assert.throws(() => new Puppet(scene, { rig: assetRig }), new RegExp(`Missing texture.*${owner}`));
    assert.equal(has.mock.calls.length, 0);
    assert.equal(allocate.mock.calls.length, 0);
    scene.textures.exists = () => true;
    has.mockImplementation(() => true);
    new Puppet(scene, { rig: assetRig, autoUpdate: false }).destroy();
  }
});
const cases: { name: string; options: PuppetOptions; error: RegExp }[] = [
  { name: 'invalid animation', options: { rig, animations: [{ ...animation, duration: 0 }] }, error: /duration/ },
  {
    name: 'unknown animation bone',
    options: { rig, animations: [{ ...animation, tracks: { missing: [{ time: 0, x: 1 }] } }] },
    error: /Unknown bone/,
  },
  { name: 'duplicate animation', options: { rig, animations: [animation, animation] }, error: /already registered/ },
  { name: 'invalid pose', options: { rig, poses: [{ ...pose, bones: { missing: { x: 1 } } }] }, error: /Unknown bone/ },
  { name: 'duplicate pose', options: { rig, poses: [pose, pose] }, error: /already registered/ },
  { name: 'unknown skin', options: { rig, skin: 'missing' }, error: /Unknown skin/ },
  { name: 'invalid IK mix', options: { rig, ik: [{ ...ik, mix: 2 }] }, error: /mix/ },
  { name: 'unknown IK bone', options: { rig, ik: [{ ...ik, endBone: 'missing' }] }, error: /Unknown bone/ },
  {
    name: 'disconnected IK bones',
    options: { rig, ik: [{ ...ik, middleBone: 'hand', endBone: 'arm' }] },
    error: /directly connected/,
  },
  { name: 'duplicate IK', options: { rig, ik: [ik, ik] }, error: /already registered/ },
  { name: 'invalid facing', options: { rig, facing: 'up' as 'right' }, error: /Invalid facing/ },
];

test.each(cases)('$name fails before allocating scene objects or registering listeners', ({ options, error }) => {
  const add = { container: vi.fn(), image: vi.fn(), graphics: vi.fn(), text: vi.fn() };
  const events = { on: vi.fn(), once: vi.fn() };
  const scene = { add, events, textures: { exists: () => true } } as unknown as Phaser.Scene;
  assert.throws(() => new Puppet(scene, options), error);
  for (const allocate of Object.values(add)) assert.equal(allocate.mock.calls.length, 0);
  assert.equal(events.on.mock.calls.length, 0);
  assert.equal(events.once.mock.calls.length, 0);
});

test('construction compiles each initial clip once before scene allocation and reuses it for playback', () => {
  const scene = puppetScene();
  const compile = vi.spyOn(animationClip, 'compileClip');
  const allocate = vi.spyOn(scene.add, 'container');
  const clips = [
    {
      ...animation,
      name: 'move',
      tracks: {
        arm: [
          { time: 0, x: 20 },
          { time: 100, x: 40 },
        ],
      },
    },
    { ...animation, name: 'hold', tracks: { arm: [{ time: 0, x: 60 }] } },
  ];
  const puppet = new Puppet(scene, { rig, animations: clips, autoUpdate: false });
  assert.equal(compile.mock.calls.length, clips.length);
  for (const callOrder of compile.mock.invocationCallOrder)
    assert.isBelow(callOrder, allocate.mock.invocationCallOrder[0]!);
  // Playback owns compiled data even if the original authored data is subsequently edited.
  clips[0]!.tracks.arm[0]!.x = -100;
  puppet.play('move').update(50);
  assert.equal(puppet.getBone('arm').pose.x, 30);
  puppet.play('hold');
  assert.equal(puppet.getBone('arm').pose.x, 60);
  assert.equal(compile.mock.calls.length, clips.length);
  assert.throws(() => puppet.addAnimation(clips[0]!), /already registered/);
  puppet.addAnimation({ ...animation, name: 'later' });
  assert.equal(compile.mock.calls.length, clips.length + 1);
  puppet.play('later');
  assert.equal(puppet.currentAnimation, 'later');
  puppet.destroy();
});

test('puppets share a character compilation while retaining independent playback, events, and lifecycle', () => {
  const compile = vi.spyOn(animationClip, 'compileClip');
  const character = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'shared',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: ['move.json'],
      textures: {},
    },
    rig: { version: 1, root: rig.root, bones: rig.bones },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
    animations: {
      'move.json': {
        version: 1,
        name: 'move',
        duration: 100,
        loop: false,
        tracks: {
          arm: [
            { time: 0, x: 20 },
            { time: 100, x: 40 },
          ],
        },
        events: [{ time: 50, name: 'half', data: { value: 1 } }],
      },
    },
  });
  assert.equal(compile.mock.calls.length, 0, 'metadata assembly remains lazy');
  const first = new Puppet(puppetScene(), { definition: character, autoUpdate: false });
  const second = new Puppet(puppetScene(), { definition: character, autoUpdate: false });
  assert.equal(compile.mock.calls.length, 1);
  assert.strictEqual(character.compiledAnimations, character.compiledAnimations);
  assert.isTrue(Object.isFrozen(character.compiledAnimations));
  assert.isTrue(Object.isFrozen(character.compiledAnimations[0]!.events[0]!.data));
  const firstEvents: unknown[] = [];
  const secondEvents: unknown[] = [];
  first.onAnimationEvent((event) => {
    firstEvents.push(event);
    (event.data as { value: number }).value = 99;
  });
  second.onAnimationEvent((event) => secondEvents.push(event.data));
  first.play('move').update(50);
  second.play('move').update(25);
  assert.equal(first.getBone('arm').pose.x, 30);
  assert.equal(second.getBone('arm').pose.x, 25);
  assert.equal(second.animationPlayer.elapsedTime, 25);
  assert.equal(firstEvents.length, 1);
  assert.equal(secondEvents.length, 0);
  first.destroy();
  second.update(25);
  assert.equal(second.getBone('arm').pose.x, 30);
  assert.deepEqual(secondEvents, [{ value: 1 }]);
  const override = new Puppet(puppetScene(), {
    definition: character,
    animations: [{ ...animation, name: 'custom' }],
    autoUpdate: false,
  });
  assert.equal(compile.mock.calls.length, 2);
  override.play('custom');
  assert.throws(() => override.play('move'), /Unknown animation/);
  const empty = new Puppet(puppetScene(), { definition: character, animations: [], autoUpdate: false });
  assert.equal(compile.mock.calls.length, 2);
  assert.throws(() => empty.play('move'), /Unknown animation/);
  const independent = CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: 'empty',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: [],
      textures: {},
    },
    rig: { version: 1, root: rig.root, bones: rig.bones },
    skins: { 'skin.json': { version: 1, name: 'default', slots: {} } },
  });
  assert.notStrictEqual(independent.compiledAnimations, character.compiledAnimations);
  second.destroy();
  override.destroy();
  empty.destroy();
});
