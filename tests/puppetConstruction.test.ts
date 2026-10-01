import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { Puppet, type PuppetOptions } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';

vi.mock('phaser', () => ({ default: {} }));

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
