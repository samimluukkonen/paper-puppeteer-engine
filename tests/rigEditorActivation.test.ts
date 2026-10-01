import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import type { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';

vi.mock('phaser', () => ({ default: { Scenes: { Events: { UPDATE: 'update' } } } }));
vi.mock('../src/devtools/rig-editor/RigEditorOverlay.js', () => ({
  RigEditorOverlay: class {
    draw() {}
    destroy() {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('editor activation reuses IK constraints and balances overlay and listener lifetimes', () => {
  const browser = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('window', browser);
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'arm', parent: 'root', y: 20 }, { id: 'hand', parent: 'arm', y: 20 }],
  });
  const bones = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const puppet = {
    rig,
    ikConstraints: new Map<string, TwoBoneIKConstraint>(),
    bones,
    addIK: vi.fn(Puppet.prototype.addIK),
    getIK: Puppet.prototype.getIK,
    resetToBindPose: vi.fn().mockReturnThis(),
    setFacing: vi.fn().mockReturnThis(),
  };
  const input = { on: vi.fn(), off: vi.fn() };
  const events = { on: vi.fn(), off: vi.fn() };
  const destroyOverlay = vi.spyOn(RigEditorOverlay.prototype, 'destroy');
  const chains = [{ name: 'armIK', rootBone: 'root', middleBone: 'arm', endBone: 'hand' }];
  const editor = new RigEditor(
    { input, events } as unknown as Phaser.Scene,
    puppet as unknown as Puppet,
    vi.fn(),
    undefined,
    chains,
  );

  editor.enable();
  const constraint = puppet.getIK('armIK');
  assert.isFalse(constraint.enabled);
  constraint.setTarget(12, 34);
  constraint.mix = 0.5;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    editor.enable();
    constraint.enabled = true;
    editor.disable();
    editor.disable();
    assert.equal(destroyOverlay.mock.calls.length, cycle + 1);
    editor.enable();
    assert.strictEqual(puppet.getIK('armIK'), constraint);
    assert.isFalse(constraint.enabled);
    assert.deepEqual(constraint.target, { x: 12, y: 34 });
    assert.equal(constraint.mix, 0.5);
  }
  editor.disable();
  assert.equal(puppet.addIK.mock.calls.length, 1);
  assert.equal(puppet.resetToBindPose.mock.calls.length, 4);
  assert.deepEqual(input.off.mock.calls, input.on.mock.calls);
  assert.deepEqual(events.off.mock.calls, events.on.mock.calls);
  assert.deepEqual(browser.removeEventListener.mock.calls, browser.addEventListener.mock.calls);
  assert.equal(destroyOverlay.mock.calls.length, 4);
});
