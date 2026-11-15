import { assert, test, vi } from 'vitest';
import { type AnimationClip, compileClip } from '../src/engine/AnimationClip.js';
import type { IKAnimationValues } from '../src/engine/ik/AnimationIKPose.js';
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

const swing: AnimationClip = {
  name: 'swing',
  duration: 1000,
  loop: false,
  tracks: {
    arm: [
      { time: 0, rotation: 0 },
      { time: 1000, rotation: 1 },
    ],
  },
};

function fixture(ikEnabled = false) {
  const rig = new Rig(rigDefinition);
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  puppet.getIK('arm').enabled = ikEnabled;
  puppet.update(0);
  return puppet;
}

test('previewClip owns prepare → sample → project without moving runtime clocks or firing events', () => {
  const puppet = fixture();
  const events = vi.fn();
  puppet.onAnimationEvent(events);
  try {
    puppet.previewClip(swing, 500);
    assert.approximately(puppet.getBone('arm').pose.rotation, 0.5, 1e-12, 'sampled pose lands on the bone');
    assert.approximately(puppet.getBone('arm').container.rotation, 0.5, 1e-12, 'rendering is projected');
    assert.equal(puppet.animationPlayer.elapsedTime, 0, 'the runtime clock never advances');
    assert.isUndefined(puppet.currentAnimation);
    assert.equal(events.mock.calls.length, 0, 'previews never dispatch gameplay events');

    puppet.previewClip(compileClip({ ...swing, name: 'swing-compiled' }, puppet.rig), 250);
    assert.approximately(puppet.getBone('arm').pose.rotation, 0.25, 1e-12, 'compiled clips preview too');

    assert.throws(() => puppet.previewClip(swing, Number.NaN), /finite/);
  } finally {
    puppet.destroy();
  }
});

test('previewClip restores the runtime pose on the next update while playback is active', () => {
  const puppet = fixture();
  try {
    puppet.addAnimation({ name: 'idle', duration: 1000, loop: true, tracks: { arm: [{ time: 0, rotation: 0.2 }] } });
    puppet.play('idle');
    puppet.update(100);
    assert.approximately(puppet.getBone('arm').pose.rotation, 0.2, 1e-12);
    puppet.previewClip(swing, 500);
    assert.approximately(puppet.getBone('arm').pose.rotation, 0.5, 1e-12);
    puppet.update(16);
    assert.approximately(
      puppet.getBone('arm').pose.rotation,
      0.2,
      1e-12,
      'runtime playback re-evaluates after a preview',
    );
    assert.approximately(puppet.animationPlayer.elapsedTime, 116, 1e-12);
  } finally {
    puppet.destroy();
  }
});

test('previewClip solves IK against the freshly sampled pose (prepare → sample → project order)', () => {
  const puppet = fixture(true);
  try {
    const constraint = puppet.getIK('arm');
    let observed: number | undefined;
    constraint.setTargetProvider(() => {
      observed = puppet.getBone('arm').pose.rotation;
      return { x: 20, y: 15 };
    });
    puppet.previewClip(swing, 500);
    assert.approximately(observed!, 0.5, 1e-12, 'the IK provider observes the previewed pose before solving');
    assert.equal(constraint.status, 'solved');
  } finally {
    puppet.destroy();
  }
});

test('attachPoseSource projects a sampled pose once and keeps direct edits until re-attached or detached', () => {
  const puppet = fixture();
  try {
    const armPose = { x: 5, y: 6, rotation: 0.5, scaleX: 1, scaleY: 1 };
    const detach = puppet.attachPoseSource({ pose: new Map([['arm', armPose]]) });
    puppet.syncPose();
    assert.deepEqual({ ...puppet.getBone('arm').pose }, armPose, 'the source pose is projected onto the bone');
    assert.approximately(puppet.getBone('arm').container.x, 5, 1e-12, 'and rendered');

    puppet.getBone('arm').pose.x = 99;
    puppet.syncPose();
    assert.equal(puppet.getBone('arm').pose.x, 99, 'later syncs keep direct edits while the source is attached');

    const reattach = puppet.attachPoseSource({ pose: new Map([['arm', { ...armPose, x: 7 }]]) });
    puppet.syncPose();
    assert.equal(puppet.getBone('arm').pose.x, 7, 'a newly attached source projects again');

    reattach();
    detach();
    detach(); // idempotent
    puppet.getBone('arm').pose.x = 42;
    puppet.syncPose();
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

test('attachPoseSource and previewClip reject use after destroy', () => {
  const puppet = fixture();
  puppet.destroy();
  assert.throws(() => puppet.attachPoseSource({}), /destroyed/);
  assert.throws(() => puppet.previewClip(swing, 0), /destroyed/);
});
