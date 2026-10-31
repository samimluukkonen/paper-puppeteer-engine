import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { AnimationGroundPanel } from '../src/devtools/animation-editor/AnimationGroundPanel.js';
import {
  footContactConstraints,
  planFootContactAlignment,
} from '../src/devtools/animation-editor/footContactAlignment.js';
import { FootContactGroundController } from '../src/devtools/animation-editor/FootContactGroundController.js';
import { IKInspectorController } from '../src/devtools/animation-editor/IKInspectorController.js';
import { getCompiledPreviewClip } from '../src/devtools/animation-editor/previewClip.js';
import { SceneActorPreview } from '../src/devtools/scene-editor/SceneActorPreview.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { SceneGroundPanel } from '../src/devtools/scene-editor/SceneGroundPanel.js';
import { contactGroundDistance, evaluatedFootContacts } from '../src/devtools/shared/footContactGround.js';
import { GroundGuideWorkspace } from '../src/devtools/shared/GroundGuideWorkspace.js';
import { Actor } from '../src/engine/Actor.js';
import { localToWorld, type Affine } from '../src/engine/affineMath.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { CharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { getFootContactWorldPosition } from '../src/engine/footContactMarkers.js';
import { setIKPropertyKeyframe } from '../src/engine/ik/animationKeyframes.js';
import { IsolatedIKSampler } from '../src/engine/ik/IsolatedIKSampler.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import type { RigDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function rigData(): RigDefinition {
  return {
    root: 'body',
    bones: [
      { id: 'body', x: 3, y: -4 },
      { id: 'upper', parent: 'body' },
      { id: 'lower', parent: 'upper', y: 50 },
      { id: 'foot', parent: 'lower', y: 50 },
      { id: 'toe', parent: 'foot', x: 5, y: 2, rotation: 0.2 },
    ],
    ik: [{ name: 'leg', rootBone: 'upper', middleBone: 'lower', endBone: 'foot', endOffset: { x: 2, y: 7 } }],
    footContactMarkers: [
      { id: 'sole', name: 'Main sole', boneId: 'foot', localX: 8, localY: 14 },
      { id: 'toe-contact', name: 'Toe', boneId: 'toe', localX: 2, localY: 1 },
      { id: 'third', name: 'Additional contact', boneId: 'body', localX: 0, localY: 0 },
    ],
  };
}
function animation(): AnimationClip {
  return {
    name: 'walk',
    duration: 1000,
    loop: true,
    tracks: {
      body: [
        { time: 0, x: 3, y: -4 },
        { time: 1000, x: 12, y: 3 },
      ],
      foot: [
        { time: 0, rotation: 0.1 },
        { time: 1000, rotation: -0.2 },
      ],
    },
    ikTracks: {
      leg: [
        { time: 0, x: 30, y: 70 },
        { time: 1000, x: 40, y: 65 },
      ],
    },
    events: [{ time: 250, name: 'step' }],
  };
}
const identity: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function animationFixture() {
  const rig = new Rig(rigData());
  const state = new AnimationEditorState(rig, [animation(), { ...animation(), name: 'other' }]);
  state.selectAnimation('walk');
  const puppet = new Puppet(puppetScene(), { rig, x: 300, y: 400, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  const guide = new GroundGuideWorkspace('animation-preview-world', () => ({ getItem: () => null, setItem: () => {} }));
  guide.bind('test');
  const contacts = new FootContactGroundController();
  contacts.bind(state, guide);
  contacts.sync(puppet);
  contacts.selectMarker('sole');
  contacts.selectConstraint('leg');
  guide.update({ enabled: true, y: evaluatedFootContacts(puppet)[0]!.world.y - 8 });
  contacts.sync(puppet);
  return {
    rig,
    state,
    puppet,
    preview,
    guide,
    contacts,
    dispose: () => {
      contacts.unbind();
      preview.dispose();
      puppet.destroy();
    },
  };
}

test('ground distances use downward world Y and a configurable nonzero tolerance', () => {
  assert.deepEqual(contactGroundDistance({ x: 999, y: 9.6 }, 10), {
    distance: -0.40000000000000036,
    relation: 'on ground',
  });
  assert.equal(contactGroundDistance({ x: 0, y: 9.6 }, 10, 0.1).relation, 'above ground');
  assert.equal(contactGroundDistance({ x: 0, y: 11 }, 10).relation, 'below ground');
});

test.each(['left', 'right'] as const)(
  'diagnostics follow FK, animated IK, root motion, playback/scrubs and %s facing',
  (facing) => {
    const f = animationFixture();
    try {
      const source = f.state.workingAnimation;
      const rigBefore = JSON.stringify(f.rig);
      const groundY = f.guide.getSnapshot().guide.y;
      f.puppet.setFacing(facing);
      f.puppet.container.setScale(facing === 'left' ? -1.7 : 1.7, 1.2).setRotation(0.3);
      let priorY = NaN;
      for (const time of [0, 0.5, 1, 0.2]) {
        f.state.setCurrentTime(time);
        f.contacts.sync(f.puppet);
        for (const contact of f.contacts.contacts) {
          const marker = f.rig.footContactMarkers!.find((entry) => entry.id === contact.id)!;
          const actual = f.puppet
            .getBone(marker.boneId)
            .container.getWorldTransformMatrix()
            .transformPoint(marker.localX, marker.localY);
          assert.closeTo(contact.world.x, actual.x, 1e-8);
          assert.closeTo(contact.world.y, actual.y, 1e-8);
        }
        assert.notEqual(f.contacts.contacts[0]!.world.y, priorY);
        priorY = f.contacts.contacts[0]!.world.y;
        assert.equal(f.guide.getSnapshot().guide.y, groundY);
      }
      f.state.play();
      f.state.advancePlayback(0.25);
      f.contacts.sync(f.puppet);
      assert.isAbove(f.contacts.contacts.length, 0);
      f.guide.update({ y: -10 });
      f.contacts.setVisible(false);
      f.contacts.sync(f.puppet);
      assert.isEmpty(f.contacts.contacts);
      assert.strictEqual(f.state.workingAnimation, source);
      assert.equal(f.state.historyLength, 0);
      assert.equal(JSON.stringify(f.rig), rigBefore);
    } finally {
      f.dispose();
    }
  },
);

test.each(['sole', 'toe-contact'])(
  'alignment uses explicit %s with post-IK verification, target offset and full outer inverse',
  (markerId) => {
    const rig = new Rig(rigData());
    const clip = animation();
    const source = JSON.stringify(clip);
    const matrix = { a: -1.8, b: -0.4, c: -0.2, d: 1.4, tx: 300, ty: -20 };
    const initial = new IsolatedIKSampler(rig).sample(getCompiledPreviewClip(clip, rig), 500);
    const marker = rig.footContactMarkers!.find((entry) => entry.id === markerId)!;
    const point = getFootContactWorldPosition(marker, rig, initial.pose, matrix)!;
    const ground = point.y - 10;
    const plan = planFootContactAlignment(clip, rig, 500, markerId, 'leg', matrix, ground, 0.001);
    assert.isTrue(plan.success);
    assert.closeTo(plan.contact.y, ground, 0.001);
    assert.closeTo(localToWorld(plan.target, matrix).x, localToWorld(plan.originalTarget, matrix).x, 1e-8);
    assert.notEqual(plan.target.y, ground);
    assert.equal(JSON.stringify(clip), source);
  },
);

test('unreachable, inactive and unsupported IK report residuals; missing/unrelated constraints are never fabricated', () => {
  const rig = new Rig(rigData());
  const clip = animation();
  const plan = planFootContactAlignment(clip, rig, 0, 'sole', 'leg', identity, 1000);
  assert.isFalse(plan.success);
  assert.equal(plan.status, 'clamped');
  assert.isAbove(Math.abs(plan.residual), 500);
  assert.isEmpty(footContactConstraints(rig, rig.footContactMarkers![2]!));
  assert.throws(() => planFootContactAlignment(clip, rig, 0, 'third', 'leg', identity, 50), /manual posing/);
  assert.throws(() => planFootContactAlignment(clip, rig, 0, 'sole', 'made-up', identity, 50), /existing foot IK/);
  const inactive = new Rig({ ...rigData(), ik: rigData().ik!.map((ik) => ({ ...ik, mix: 0 })) });
  assert.equal(planFootContactAlignment(clip, inactive, 0, 'sole', 'leg', identity, 50).status, 'inactive');
  const unsupported = new Rig({
    ...rigData(),
    bones: rigData().bones.map((bone) => (bone.id === 'upper' ? { ...bone, scaleX: 2 } : bone)),
  });
  assert.equal(planFootContactAlignment(clip, unsupported, 0, 'sole', 'leg', identity, 50).status, 'unsupported-scale');
  assert.throws(() => planFootContactAlignment(clip, rig, 0, 'sole', 'leg', { ...identity, d: 0 }, 0), /singular/);
});

test('an initially clamped request can be brought back within reach using the evaluated endpoint', () => {
  const rig = new Rig(rigData());
  const clip = { ...animation(), ikTracks: { leg: [{ time: 0, x: 3, y: 1000 }] } };
  const plan = planFootContactAlignment(clip, rig, 0, 'sole', 'leg', identity, 75, 0.001);
  assert.isTrue(plan.success);
  assert.closeTo(plan.contact.y, 75, 0.001);
});

test('marker edits in the shared rig workspace are visible without rebuilding the live skeleton', () => {
  const f = animationFixture();
  try {
    const next = new Rig({
      ...rigData(),
      footContactMarkers: [{ id: 'new-contact', name: 'New sole', boneId: 'foot', localX: 5, localY: 20 }],
    });
    f.state.updatePreviewRig(next);
    f.contacts.sync(f.puppet);
    assert.deepEqual(
      f.contacts.contacts.map((contact) => contact.id),
      ['new-contact'],
    );
    assert.equal(f.contacts.markerId, '');
    assert.equal(f.puppet.rig.footContactMarkers![0]!.id, 'sole');
    assert.equal(f.state.historyLength, 0);
  } finally {
    f.dispose();
  }
});

test('partial influence and stepped playback are evaluated as committed key data', () => {
  const rig = new Rig({ ...rigData(), ik: rigData().ik!.map((ik) => ({ ...ik, mix: 0.7 })) });
  const clip = animation();
  const pose = new IsolatedIKSampler(rig).sample(getCompiledPreviewClip(clip, rig), 500).pose;
  const ground = getFootContactWorldPosition(rig.footContactMarkers![0]!, rig, pose)!.y - 5;
  assert.isTrue(planFootContactAlignment(clip, rig, 500, 'sole', 'leg', identity, ground, 0.001).success);
  const stepped = { ...animation(), playback: { mode: 'stepped' as const, fps: 10 } };
  const steppedRig = new Rig(rigData());
  const plan = planFootContactAlignment(stepped, steppedRig, 550, 'sole', 'leg', identity, 65);
  const candidate = setIKPropertyKeyframe(
    setIKPropertyKeyframe(stepped, steppedRig, 'leg', 'x', 550, plan.target.x),
    steppedRig,
    'leg',
    'y',
    550,
    plan.target.y,
  );
  const sample = new IsolatedIKSampler(steppedRig).sample(getCompiledPreviewClip(candidate, steppedRig), 550);
  assert.equal(sample.time, 500);
  const actual = getFootContactWorldPosition(steppedRig.footContactMarkers![0]!, steppedRig, sample.pose)!;
  assert.closeTo(actual.y - 65, plan.residual, 1e-9);
  assert.equal(plan.success, Math.abs(actual.y - 65) <= plan.tolerance);
});

test('preview/cancel preserve original pose and data; Apply is one normal IK XY edit with Undo/Redo', () => {
  const f = animationFixture();
  try {
    const source = f.state.workingAnimation!;
    const pose = [...f.rig.bones].map(({ id }) => ({ ...f.puppet.getBone(id).pose }));
    assert.isTrue(f.contacts.preview());
    assert.isTrue(f.contacts.plan?.success);
    const proposal = f.contacts.plan;
    f.contacts.sync(f.puppet);
    assert.strictEqual(f.contacts.plan, proposal);
    assert.strictEqual(f.state.workingAnimation, source);
    assert.deepEqual(
      f.rig.bones.map(({ id }) => f.puppet.getBone(id).pose),
      pose,
    );
    assert.equal(f.state.historyLength, 0);
    f.contacts.cancel();
    assert.isNull(f.contacts.plan);
    assert.isTrue(f.contacts.preview());
    assert.isTrue(f.contacts.apply());
    const committed = f.state.workingAnimation!;
    assert.strictEqual(committed.tracks, source.tracks);
    assert.strictEqual(committed.events, source.events);
    assert.equal(f.state.historyLength, 1);
    assert.closeTo(evaluatedFootContacts(f.puppet)[0]!.world.y, f.guide.getSnapshot().guide.y, f.contacts.tolerance);
    f.state.undo();
    assert.strictEqual(f.state.workingAnimation, source);
    f.state.redo();
    assert.strictEqual(f.state.workingAnimation, committed);
  } finally {
    f.dispose();
  }
});

test('proposals invalidate on ground, clip, time, facing and drafts; runtime owners and unreachable results cannot commit', () => {
  const f = animationFixture();
  try {
    for (const change of [
      () => f.guide.update({ y: f.guide.getSnapshot().guide.y + 1 }),
      () => f.state.setCurrentTime(0.2),
      () => {
        f.puppet.setFacing('left');
        f.contacts.sync(f.puppet);
      },
      () => f.state.selectAnimation('other'),
    ]) {
      assert.isTrue(f.contacts.preview());
      change();
      assert.isNull(f.contacts.plan);
      assert.isFalse(f.contacts.apply());
    }
    f.contacts.preview();
    f.puppet.getIK('leg').setTargetProvider(() => ({ x: 0, y: 0 }));
    assert.isFalse(f.contacts.apply());
    assert.include(f.contacts.disabledReason, 'runtime');
    f.puppet.getIK('leg').setTargetProvider(undefined);
    f.guide.update({ y: 5000 });
    assert.isTrue(f.contacts.preview());
    assert.isFalse(f.contacts.plan!.success);
    assert.include(f.contacts.feedback, 'residual');
    assert.isFalse(f.contacts.apply());
    f.contacts.selectMarker('third');
    assert.include(f.contacts.disabledReason, 'manual posing');
    f.contacts.selectMarker('sole');
    f.contacts.selectConstraint('leg');
    f.state.selectIKConstraint('leg');
    f.state.setTemporaryIKProperty('y', 30);
    assert.include(f.contacts.disabledReason, 'temporary');
    assert.equal(f.state.historyLength, 0);
  } finally {
    f.dispose();
  }
});

function character(markers = true, offset = 0) {
  const data = rigData();
  return CharacterDefinition.fromData({
    manifest: {
      version: 1,
      id: `character-${offset}`,
      rig: 'rig.json',
      textures: {},
      skins: { basic: 'skin.json' },
      defaultSkin: 'basic',
      animations: ['walk.json'],
    },
    rig: {
      version: 1,
      ...data,
      bones: data.bones.map((bone) => (bone.id === 'body' ? { ...bone, y: offset } : bone)),
      footContactMarkers: markers ? data.footContactMarkers! : [],
    },
    skins: { 'skin.json': { version: 1, name: 'basic', slots: {} } },
    animations: { 'walk.json': { version: 1, ...animation() } },
  });
}
function sceneFixture() {
  const document = new SceneEditorDocument();
  document.importJson(
    JSON.stringify({
      ...createEmptyScene({ id: 'scene', duration: 1000 }),
      actors: [
        { id: 'a', character: { manifest: 'a/character.json' }, position: { x: 10, y: 20 }, animation: 'walk' },
        { id: 'b', character: { manifest: 'b/character.json' }, position: { x: 150, y: -10 }, facing: 'left' },
      ],
      actions: [{ id: 'move', actorId: 'a', type: 'move', time: 0, duration: 1000, destination: { x: 200, y: 50 } }],
    }),
  );
  const definitions = new Map([
    ['a/character.json', character()],
    ['b/character.json', character(true, -50)],
  ]);
  const preview = new SceneActorPreview(puppetScene());
  preview.sync(document.workingScene!, definitions);
  const sync = () => {
    preview.sync(document.workingScene!, definitions);
    document.setActorGroundOffsets(preview.groundOffsets());
    document.setActorGroundContacts(preview.groundContacts());
  };
  sync();
  document.groundGuide.update({ enabled: true, y: 200 });
  return { document, definitions, preview, sync };
}

test('scene uses the explicitly selected evaluated marker with facing/scale and preserves choreography, rigs and animations', () => {
  const f = sceneFixture();
  try {
    const original = f.document.workingScene!;
    const characters = JSON.stringify([...f.definitions]);
    for (const [index, id] of ['a', 'b'].entries()) {
      const actor = f.preview.instances.get(id)!.actor;
      const scale = index === 0 ? 0.75 : 2;
      actor.puppet.container.setScale(index === 0 ? scale : -scale, scale);
      actor.puppet.container.setRotation(0.2);
      f.sync();
      f.document.selectActor(id);
      assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
      f.document.selectFootContact('sole');
      assert.isTrue(f.document.alignSelectedActorFeetToGround());
      f.sync();
      const sole = evaluatedFootContacts(actor.puppet).find((entry) => entry.id === 'sole')!;
      assert.closeTo(sole.world.y, 200, 1e-8);
      assert.notEqual(actor.position.y, 200);
      assert.equal(actor.position.x, original.actors[index]!.position.x);
      assert.notEqual(evaluatedFootContacts(actor.puppet)[1]!.world.y, 200);
      assert.equal(actor.puppet.container.scaleY, scale);
    }
    assert.deepEqual(f.document.workingScene!.actions, original.actions);
    assert.equal(JSON.stringify([...f.definitions]), characters);
    const aligned = f.document.workingScene!;
    f.document.undo();
    f.sync();
    assert.deepEqual(f.document.workingScene!.actors[1]!.position, original.actors[1]!.position);
    f.document.redo();
    f.sync();
    assert.strictEqual(f.document.workingScene, aligned);
    f.document.selectActor('a');
    f.document.selectFootContact('toe-contact');
    assert.isTrue(f.document.alignSelectedActorFeetToGround());
    f.sync();
    assert.closeTo(evaluatedFootContacts(f.preview.instances.get('a')!.actor.puppet)[1]!.world.y, 200, 1e-8);
  } finally {
    f.preview.dispose();
  }
});

test('scene placement snapping uses the selected marker, supports Shift bypass and keeps one drag Undo entry', () => {
  const f = sceneFixture();
  try {
    f.document.selectActor('a');
    f.document.selectFootContact('toe-contact');
    const original = f.document.workingScene!;
    f.document.groundGuide.update({ snapEnabled: true });
    assert.strictEqual(f.document.workingScene, original);
    assert.isFalse(f.document.canUndo);
    assert.isTrue(f.document.beginActorDrag('a'));
    f.document.moveActorDrag({ x: 50, y: 999 });
    f.sync();
    f.document.moveActorDrag({ x: 70, y: 888 });
    f.sync();
    f.document.endActorDrag();
    assert.closeTo(evaluatedFootContacts(f.preview.instances.get('a')!.actor.puppet)[1]!.world.y, 200, 1e-8);
    assert.equal(f.document.workingScene!.actors[0]!.position.x, 70);
    f.document.undo();
    f.sync();
    assert.strictEqual(f.document.workingScene, original);
    assert.isFalse(f.document.canUndo);
    f.document.beginActorDrag('a');
    f.document.moveActorDrag({ x: 60, y: -50 }, { bypassGround: true });
    f.document.endActorDrag();
    f.sync();
    assert.equal(f.document.workingScene!.actors[0]!.position.y, -50);
    f.document.beginActorDrag('a');
    f.document.moveActorDrag({ x: 100, y: 0 });
    f.document.cancelActorDrag();
    assert.equal(f.document.workingScene!.actors[0]!.position.y, -50);
  } finally {
    f.preview.dispose();
  }
});

test('scene playback and bidirectional seeks show current evaluated contacts without authoring or enforcing grounding', () => {
  const f = sceneFixture();
  const playback = new SceneEditorPlayback();
  const release = playback.subscribe(() => f.document.setGroundPreviewing(playback.previewing));
  try {
    f.document.selectActor('a');
    f.document.selectFootContact('sole');
    f.document.alignSelectedActorFeetToGround();
    f.sync();
    const source = f.document.workingScene!;
    const bytes = f.document.exportJson();
    const createActor = (data: { id: string; character: { manifest: string } }) =>
      new Actor({
        id: data.id,
        puppet: new Puppet(puppetScene(), {
          definition: f.definitions.get(data.character.manifest)!,
          autoUpdate: false,
        }),
        puppetOwnership: 'owned',
      });
    playback.sync(source, true, createActor);
    const positions = [];
    for (const time of [600, 200, 600]) {
      playback.seek(time);
      assert.equal(playback.error, '');
      const contacts = evaluatedFootContacts(playback.actors!.get('a')!.puppet);
      positions.push(contacts[0]!.world);
      assert.isFalse(f.document.alignSelectedActorFeetToGround());
      assert.strictEqual(f.document.workingScene, source);
    }
    // Incremental movement partitions the same travel into different floating-point steps.
    assert.closeTo(positions[0]!.x, positions[2]!.x, 1e-9);
    assert.closeTo(positions[0]!.y, positions[2]!.y, 1e-9);
    assert.notDeepEqual(positions[0], positions[1]);
    playback.play();
    playback.update(100);
    assert.equal(f.document.exportJson(), bytes);
    playback.stop();
    assert.isTrue(f.document.canAlignSelectedActorFeetToGround);
  } finally {
    release();
    playback.dispose();
    f.preview.dispose();
  }
});

test('marker selection never falls through to legacy contacts; no-marker rigs retain the labeled existing fallback', () => {
  const f = sceneFixture();
  try {
    f.document.selectActor('a');
    f.document.setActorGroundOffsets(new Map([['a', 99]]));
    const source = f.document.workingScene;
    f.document.selectFootContact('absent');
    assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
    f.document.selectFootContact('sole');
    f.document.setActorGroundContacts(new Map([['a', [{ id: 'sole', name: 'Sole', offset: undefined }]]]));
    assert.isFalse(f.document.alignSelectedActorFeetToGround());
    assert.strictEqual(f.document.workingScene, source);
    f.document.setActorGroundContacts(new Map([['a', []]]));
    const markup = renderToStaticMarkup(
      createElement(SceneGroundPanel, { document: f.document, playback: new SceneEditorPlayback() }),
    );
    assert.include(markup, 'Legacy fallback');
    assert.notInclude(markup, 'open=""');
    assert.isTrue(f.document.alignSelectedActorFeetToGround());
    assert.equal(f.document.workingScene!.actors[0]!.position.y, 101);
    f.document.undo();
    assert.strictEqual(f.document.workingScene, source);
  } finally {
    f.preview.dispose();
  }
});

test('animation marker controls start collapsed and support all arbitrary contacts and an explicit preview/apply workflow', () => {
  const f = animationFixture();
  const ikInspector = new IKInspectorController();
  try {
    const markup = renderToStaticMarkup(
      createElement(AnimationGroundPanel, {
        workspace: f.guide,
        ikInspector,
        alignTarget: () => {},
        contacts: f.contacts,
      }),
    );
    assert.notInclude(markup, 'open=""');
    assert.include(markup, 'Additional contact');
    assert.include(markup, 'Align Selected Foot Contact to Ground');
    assert.include(markup, 'Apply IK target keys');
  } finally {
    ikInspector.dispose();
    f.dispose();
  }
});

test('contact diagnostics throttle playback renders, flush the final sample and stay idle while hidden', () => {
  const f = animationFixture();
  const notify = vi.fn();
  const release = f.contacts.subscribe(notify);
  try {
    f.contacts.setVisible(false);
    f.contacts.sync(f.puppet, undefined, 0);
    notify.mockClear();
    for (let frame = 1; frame <= 60; frame++) {
      f.state.setCurrentTime(frame / 100);
      f.contacts.sync(f.puppet, undefined, frame * 16);
    }
    assert.equal(notify.mock.calls.length, 0, 'hidden controls do not publish every playhead change');
    f.contacts.setVisible(true);
    notify.mockClear();
    for (let frame = 1; frame <= 60; frame++) {
      f.state.setCurrentTime(frame / 100);
      f.contacts.sync(f.puppet, undefined, 1000 + frame * 16);
      assert.deepEqual(f.contacts.contacts, evaluatedFootContacts(f.puppet), 'canvas always gets the current pose');
    }
    assert.isAtMost(notify.mock.calls.length, 10);
    const notifications = notify.mock.calls.length;
    f.contacts.sync(f.puppet, undefined, 2100);
    assert.equal(notify.mock.calls.length, notifications + 1, 'final pending text sample is published');
    f.contacts.sync(f.puppet, undefined, 2200);
    assert.equal(notify.mock.calls.length, notifications + 1, 'unchanged contacts stay idle');
    f.contacts.unbind();
    notify.mockClear();
    f.state.setCurrentTime(0.8);
    f.guide.update({ y: -200 });
    assert.equal(notify.mock.calls.length, 0, 'unbind releases both document and guide listeners');
    assert.isEmpty(f.contacts.contacts);
    assert.isNull(f.contacts.plan);
  } finally {
    release();
    f.dispose();
  }
});

test('hidden contacts skip world-context and ownership checks until shown, while hidden proposals still invalidate', () => {
  const f = animationFixture();
  const matrix = vi.spyOn(f.puppet.container, 'getWorldTransformMatrix');
  const ownership = vi.spyOn(f.puppet.getIK('leg'), 'targetOwnership', 'get');
  const getIK = vi.spyOn(f.puppet, 'getIK');
  try {
    f.contacts.setVisible(false);
    matrix.mockClear();
    ownership.mockClear();
    getIK.mockClear();
    for (let frame = 1; frame <= 60; frame++) {
      f.state.setCurrentTime(frame / 100);
      // Preview evaluation has its own world-coordinate work; only measure contact synchronization.
      matrix.mockClear();
      f.contacts.sync(f.puppet, undefined, frame * 16);
      assert.equal(matrix.mock.calls.length, 0);
    }
    assert.equal(ownership.mock.calls.length, 0);
    assert.equal(getIK.mock.calls.length, 0);
    const provider = vi.fn(() => undefined);
    f.puppet.getIK('leg').setTargetProvider(provider);
    f.contacts.setVisible(true);
    assert.include(f.contacts.disabledReason, 'runtime');
    assert.equal(provider.mock.calls.length, 0);
    f.puppet.getIK('leg').setTargetProvider(undefined);
    f.contacts.sync(f.puppet);
    assert.deepEqual(f.contacts.contacts, evaluatedFootContacts(f.puppet));
    f.contacts.setVisible(false);
    assert.isFalse(f.contacts.needsSync);
    assert.isTrue(f.contacts.preview(), 'explicit alignment works with markers hidden');
    const plan = f.contacts.plan;
    assert.isTrue(f.contacts.needsSync);
    f.contacts.sync(f.puppet);
    assert.strictEqual(f.contacts.plan, plan, 'unchanged hidden proposals survive synchronization');
    f.puppet.getIK('leg').mix = 1;
    f.contacts.sync(f.puppet);
    assert.isNull(f.contacts.plan, 'same-value runtime ownership overrides invalidate proposals');
    assert.isFalse(f.contacts.apply());
  } finally {
    matrix.mockRestore();
    ownership.mockRestore();
    getIK.mockRestore();
    f.dispose();
  }
});

test('scene contact selections reset on import and cannot silently use another marker', () => {
  const f = sceneFixture();
  try {
    f.document.selectActor('a');
    f.document.selectFootContact('sole');
    const json = f.document.exportJson();
    assert.notInclude(json, 'sole', 'grounding selections are view state, not persisted marker references');
    f.document.importJson(json);
    f.sync();
    f.document.selectActor('a');
    assert.equal(f.document.selectedFootContactId, '');
    assert.isFalse(f.document.alignSelectedActorFeetToGround());
    f.document.selectFootContact('sole');
    f.document.setActorGroundContacts(new Map([['a', [{ id: 'different', name: 'Other', offset: 50 }]]]));
    const source = f.document.workingScene;
    assert.isFalse(f.document.alignSelectedActorFeetToGround());
    assert.strictEqual(f.document.workingScene, source);
    f.document.selectFootContact('');
    assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
  } finally {
    f.preview.dispose();
  }
});

test('Actor removal, ID reuse and character replacement discard stale contact selections and measurements', () => {
  const f = sceneFixture();
  try {
    f.document.selectActor('b');
    f.document.selectFootContact('sole');
    f.document.removeActor('b');
    f.document.undo();
    f.document.selectActor('b');
    assert.equal(f.document.selectedFootContactId, '');
    assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
    f.sync();
    f.document.selectFootContact('sole');
    f.document.updateActor('b', { character: { manifest: 'a/character.json' } });
    assert.equal(f.document.selectedFootContactId, '');
    assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
    f.sync();
    f.document.selectFootContact('sole');
    f.document.undo();
    assert.equal(f.document.selectedFootContactId, '');
    assert.isFalse(f.document.canAlignSelectedActorFeetToGround);
  } finally {
    f.preview.dispose();
  }
});
