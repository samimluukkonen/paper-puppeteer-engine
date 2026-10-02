import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import * as animationClip from '../src/engine/AnimationClip.js';
import { Puppet, type PuppetOptions } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.restoreAllMocks());

const rig = new Rig({
  root: 'root',
  bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }, { id: 'hand', parent: 'arm' }],
});
const animation = { name: 'idle', duration: 100, loop: true, tracks: {} };
const pose = { version: 1 as const, name: 'rest', bones: {} };
const ik = { name: 'armIK', rootBone: 'root', middleBone: 'arm', endBone: 'hand' };
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
