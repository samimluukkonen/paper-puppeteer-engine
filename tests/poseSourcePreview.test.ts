import { assert, test, vi } from 'vitest';
import type { IKAnimationValues } from '../src/engine/ik/AnimationIKPose.js';
import type { MeshDeformationPose } from '../src/engine/meshDeformation.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rigDefinition = {
  root: 'root',
  bones: [{ id: 'root' }, { id: 'arm', parent: 'root', y: 10 }, { id: 'hand', parent: 'arm', y: 20 }],
  ik: [{ name: 'arm', rootBone: 'root', middleBone: 'arm', endBone: 'hand', target: { x: 65, y: 20 }, mix: 1 }],
} as const;

function fixture(ikEnabled = false) {
  const rig = new Rig(rigDefinition);
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  puppet.getIK('arm').enabled = ikEnabled;
  puppet.update(0);
  return puppet;
}

test('attachPoseSource projects a sampled pose once and keeps direct edits until re-attached or detached', () => {
  const puppet = fixture();
  try {
    const armPose = { x: 5, y: 6, rotation: 0.5, scaleX: 1, scaleY: 1 };
    const detach = puppet.attachPoseSource({ pose: new Map([['arm', armPose]]) });
    puppet.posePipeline.syncPose();
    assert.deepEqual({ ...puppet.getBone('arm').pose }, armPose, 'the source pose is projected onto the bone');
    assert.approximately(puppet.getBone('arm').container.x, 5, 1e-12, 'and rendered');

    puppet.getBone('arm').pose.x = 99;
    puppet.posePipeline.syncPose();
    assert.equal(puppet.getBone('arm').pose.x, 99, 'later syncs keep direct edits while the source is attached');

    const reattach = puppet.attachPoseSource({ pose: new Map([['arm', { ...armPose, x: 7 }]]) });
    puppet.posePipeline.syncPose();
    assert.equal(puppet.getBone('arm').pose.x, 7, 'a newly attached source projects again');

    reattach();
    detach();
    detach(); // idempotent
    puppet.getBone('arm').pose.x = 42;
    puppet.posePipeline.syncPose();
    assert.equal(puppet.getBone('arm').pose.x, 42, 'detached sources never project again');
  } finally {
    puppet.destroy();
  }
});

test('pose-source IK channels stay live and detaching restores the runtime channels', () => {
  const puppet = fixture(true);
  try {
    assert.deepEqual(puppet.getIK('arm').resolvedTarget, { x: 65, y: 20 });
    const ik = new Map<string, IKAnimationValues>();
    const detach = puppet.attachPoseSource({ ikAnimation: ik });
    puppet.update(16);
    ik.set('arm', { x: { value: 30, weight: 1 }, y: { value: 10, weight: 1 } });
    puppet.update(16);
    assert.deepEqual(puppet.getIK('arm').resolvedTarget, { x: 30, y: 10 }, 'attached source channels are read live');
    detach();
    puppet.update(16);
    assert.deepEqual(puppet.getIK('arm').resolvedTarget, { x: 65, y: 20 }, 'detaching restores the runtime player');
  } finally {
    puppet.destroy();
  }
});

test('rendering prefers a source live deformation channel over its public snapshot', () => {
  const puppet = fixture();
  try {
    const snapshot: MeshDeformationPose = new Map();
    const live: MeshDeformationPose = new Map();
    const detach = puppet.attachPoseSource({ meshDeformation: snapshot, getMeshDeformationForRendering: () => live });
    assert.strictEqual(puppet.posePipeline.getMeshDeformationForRendering(), live, 'rendering reads live channels');
    assert.strictEqual(puppet.meshDeformation, snapshot, 'public reads keep the snapshot');
    detach();
    const fallback = puppet.attachPoseSource({
      meshDeformation: snapshot,
      getMeshDeformationForRendering: () => undefined,
    });
    assert.strictEqual(
      puppet.posePipeline.getMeshDeformationForRendering(),
      snapshot,
      'absent live channels fall back',
    );
    fallback();
  } finally {
    puppet.destroy();
  }
});

test('a stale detach never clears a newer source', () => {
  const puppet = fixture(true);
  try {
    const stale = new Map<string, IKAnimationValues>();
    const fresh = new Map<string, IKAnimationValues>();
    const detachStale = puppet.attachPoseSource({ ikAnimation: stale });
    puppet.attachPoseSource({ ikAnimation: fresh });
    detachStale();
    fresh.set('arm', { x: { value: 30, weight: 1 }, y: { value: 10, weight: 1 } });
    puppet.update(16);
    assert.deepEqual(puppet.getIK('arm').resolvedTarget, { x: 30, y: 10 }, 'the newer source stays attached');
  } finally {
    puppet.destroy();
  }
});

test('attachPoseSource and editPose reject use after destroy', () => {
  const puppet = fixture();
  puppet.destroy();
  assert.throws(() => puppet.attachPoseSource({}), /destroyed/);
  assert.throws(() => puppet.editPose(), /destroyed/);
});

test('editPose restores the pre-IK pose before the edit and solves IK against the edited pose', () => {
  const puppet = fixture(true);
  try {
    assert.isAbove(Math.abs(puppet.getBone('root').pose.rotation), 1e-6, 'IK has rotated the chain root');
    const constraint = puppet.getIK('arm');
    let observed: number | undefined;
    constraint.setTargetProvider(() => {
      observed = puppet.getBone('arm').pose.rotation;
      return { x: 20, y: 15 };
    });
    let duringEdit: number | undefined;
    puppet.editPose(() => {
      duringEdit = puppet.getBone('root').pose.rotation;
      puppet.getBone('arm').pose.rotation = 0.3;
    });
    assert.approximately(duringEdit!, 0, 1e-12, 'the edit sees the restored pre-IK pose');
    assert.approximately(observed!, 0.3, 1e-12, 'IK solves against the edited pose');
    assert.equal(constraint.status, 'solved');
  } finally {
    puppet.destroy();
  }
});

test('editPose still syncs when the edit throws and rethrows the error', () => {
  const puppet = fixture(true);
  try {
    const solvedRoot = puppet.getBone('root').pose.rotation;
    assert.throws(
      () =>
        puppet.editPose(() => {
          throw new Error('edit failed');
        }),
      /edit failed/,
    );
    assert.approximately(puppet.getBone('root').pose.rotation, solvedRoot, 1e-12, 'IK is re-solved after the failure');
  } finally {
    puppet.destroy();
  }
});

test('editPose with no edit re-syncs a dirty pose', () => {
  const puppet = fixture();
  try {
    puppet.getBone('arm').pose.rotation = 0.4;
    puppet.editPose();
    assert.approximately(puppet.getBone('arm').container.rotation, 0.4, 1e-12, 'the direct edit is rendered');
  } finally {
    puppet.destroy();
  }
});
