import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { localToWorld } from '../src/engine/affineMath.js';
import type { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
vi.mock('../src/devtools/rig-editor/RigEditorOverlay.js', () => ({
  RigEditorOverlay: class {
    invalidate() {}
    draw() {}
    destroy() {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each(['right', 'left'] as const)(
  'IK preview pins transformed offsets without moving the %s-facing pose',
  (facing) => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const chain = {
      name: 'armIK',
      rootBone: 'root',
      middleBone: 'arm',
      endBone: 'hand',
      endOffset: { x: 0, y: 10 },
      bendDirection: 1 as const,
    };
    const rig = new Rig({
      root: 'root',
      bones: [
        { id: 'root', rotation: 0.3 },
        { id: 'arm', parent: 'root', y: 20, rotation: 0.4 },
        { id: 'hand', parent: 'arm', y: 20, rotation: 0.2, scaleY: 1.2 },
      ],
      ik: [chain],
    });
    const scene = puppetScene();
    Reflect.set(scene, 'input', { on() {}, off() {} });
    const puppet = new Puppet(scene, { rig, x: 10, y: 30, scale: 1.7, autoUpdate: false });
    const editor = new RigEditor(scene, puppet, () => {}, undefined, [{ ...chain, endOffset: { x: 0, y: 0 } }]);
    const endpoint = () => localToWorld(chain.endOffset, puppet.getBone('hand').container.getWorldTransformMatrix());
    try {
      editor.enable();
      puppet.setFacing(facing);
      const before = endpoint();
      const poses = rig.bones.map(({ id }) => ({ ...puppet.getBone(id).pose }));
      editor.setIKPreview(true);
      assert.deepEqual(puppet.getIK(chain.name).target, before);
      for (const [index, { id }] of rig.bones.entries()) {
        assert.closeTo(puppet.getBone(id).pose.rotation, poses[index]!.rotation, 1e-8);
      }
      assert.closeTo(endpoint().x, before.x, 1e-8);
      assert.closeTo(endpoint().y, before.y, 1e-8);
      assert.isFalse(editor.state.dirty);
      assert.equal(editor.state.historyLength, 0);
      editor.disable();
      puppet.getIK(chain.name).target = undefined;
      editor.enable();
      const restoredEndpoint = endpoint();
      assert.closeTo(puppet.getIK(chain.name).target!.x, restoredEndpoint.x, 1e-8);
      assert.closeTo(puppet.getIK(chain.name).target!.y, restoredEndpoint.y, 1e-8);
    } finally {
      editor.disable();
      puppet.destroy();
    }
  },
);

test('activation reuses authored IK from the real Puppet without registering it twice', () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const chain = { name: 'armIK', rootBone: 'root', middleBone: 'arm', endBone: 'hand', mix: 0.4 };
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'arm', parent: 'root', y: 20 }, { id: 'hand', parent: 'arm', y: 20 }],
    ik: [chain],
  });
  const scene = puppetScene();
  Reflect.set(scene, 'input', { on() {}, off() {} });
  const puppet = new Puppet(scene, { rig, autoUpdate: false });
  const constraint = puppet.getIK(chain.name);
  const add = vi.spyOn(puppet, 'addIK');
  const editor = new RigEditor(scene, puppet, () => {}, undefined, [{ ...chain, mix: 1 }]);
  for (let cycle = 0; cycle < 2; ++cycle) {
    editor.enable();
    assert.strictEqual(puppet.getIK(chain.name), constraint);
    assert.equal(constraint.mix, 0.4);
    assert.isFalse(constraint.enabled);
    editor.disable();
  }
  assert.equal(add.mock.calls.length, 0);
  assert.deepEqual(editor.exportRig(false).ik, [chain]);
  puppet.destroy();
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
    container: {
      x: 380,
      y: 435,
      getWorldTransformMatrix() {
        return { tx: this.x, ty: this.y };
      },
      setPosition(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    },
    ikConstraints: new Map<string, TwoBoneIKConstraint>(),
    bones,
    // oxlint-disable-next-line typescript/unbound-method -- The test deliberately reuses this method with an explicit fixture receiver.
    addIK: vi.fn(Puppet.prototype.addIK),
    // oxlint-disable-next-line typescript/unbound-method -- The test deliberately reuses this method with an explicit fixture receiver.
    getIK: Puppet.prototype.getIK,
    getBone: (id: string) => bones.get(id)!,
    preparePose: vi.fn(),
    syncPose: vi.fn(),
    setRenderOrder: vi.fn(),
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

  const exported = editor.exportJson(false);
  editor.moveCharacter(420, 455);
  assert.deepEqual(constraint.target, { x: 52, y: 54 }, 'pinned targets follow the character translation');
  assert.equal(editor.exportJson(false), exported);
  assert.isFalse(editor.state.dirty);
  assert.equal(editor.state.historyLength, 0);
});

test.each([false, true])('activation restores edited state and IK preview (%s) without changing history', (preview) => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'arm', parent: 'root', y: 20 }, { id: 'hand', parent: 'arm', y: 20 }],
  });
  const bones = new Map(
    rig.bones.map((bone) => [
      bone.id,
      Object.assign(new Joint(bone.id, bone), {
        container: {
          getWorldTransformMatrix: () => ({ a: 1, b: 0, c: 0, d: 1, tx: bones.get('root')!.pose.x, ty: 40 }),
        },
      }),
    ]),
  );
  const puppet = {
    rig,
    bones,
    ikConstraints: new Map<string, TwoBoneIKConstraint>(),
    // oxlint-disable-next-line typescript/unbound-method -- The test deliberately reuses this method with an explicit fixture receiver.
    addIK: Puppet.prototype.addIK,
    // oxlint-disable-next-line typescript/unbound-method -- The test deliberately reuses this method with an explicit fixture receiver.
    getIK: Puppet.prototype.getIK,
    getBone: (id: string) => bones.get(id)!,
    resetToBindPose() {
      for (const bone of bones.values()) bone.reset();
      return this;
    },
    setFacing() {
      return this;
    },
    preparePose() {},
    syncPose() {},
    setRenderOrder: vi.fn(),
  };
  const state = new RigEditorState(rig);
  state.editBone('root', 'x', 42);
  state.ikPreview = preview;
  state.visibility.ik = preview;
  const scene = { input: { on() {}, off() {} }, events: { on() {}, off() {} } };
  const onChange = vi.fn();
  const editor = new RigEditor(scene as unknown as Phaser.Scene, puppet as unknown as Puppet, onChange, state, [
    { name: 'armIK', rootBone: 'root', middleBone: 'arm', endBone: 'hand' },
  ]);
  editor.enable();
  const constraint = puppet.getIK('armIK');
  assert.equal(bones.get('root')!.pose.x, 42);
  assert.equal(constraint.enabled, preview);
  if (preview) {
    assert.deepEqual(constraint.target, { x: 42, y: 40 });
    constraint.setTarget(12, 34);
  }
  editor.disable();
  editor.enable();
  assert.equal(bones.get('root')!.pose.x, 42);
  assert.equal(constraint.enabled, preview);
  if (preview) assert.deepEqual(constraint.target, { x: 12, y: 34 });
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  assert.equal(onChange.mock.calls.length, 0, 'activation happens before the scene installs the new editor');
  editor.disable();
});
