import { afterEach, assert, test, vi } from 'vitest';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { evaluatedFootContacts } from '../src/devtools/shared/footContactGround.js';
import { Actor } from '../src/engine/Actor.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { sceneAssetCatalog } from '../src/engine/SceneAssets.js';
import {
  parseSceneDefinition,
  serializeSceneDefinition,
  parseSceneJson,
  type SceneActionDefinition,
  type SceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { SceneRunner } from '../src/engine/SceneRunner.js';
import { puppetScene } from './helpers/puppetScene.js';
import { assetFixture } from './helpers/scenePackageFixtures.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const animations: AnimationClip[] = [
  { name: 'idle', duration: 1000, loop: true, tracks: {} },
  ...[
    ['sword', 80, 0],
    ['dodge', -40, 0],
    ['jump', 0, -60],
  ].map(([name, x, y]) => ({
    name: String(name),
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 0.5 },
      ],
    },
    rootMotion: {
      translationKeys: [
        { time: 0, x: 10, y: 20 },
        { time: 1000, x: 10 + Number(x), y: 20 + Number(y) },
      ],
    },
    events: [
      { time: 0, name: 'start' },
      { time: 500, name: 'hit' },
      { time: 1000, name: 'end' },
    ],
  })),
];
function clip(
  id = 'step',
  time = 0,
  animation = 'sword',
  patch: Partial<Extract<SceneActionDefinition, { type: 'animation' }>> = {},
): SceneActionDefinition {
  return {
    id,
    actorId: 'a',
    type: 'animation',
    time,
    animation,
    duration: 1000,
    speed: 1,
    loop: false,
    movementSource: 'rootMotion',
    ...patch,
  };
}
function scene(actions: SceneActionDefinition[] = [clip()]): SceneDefinition {
  return parseSceneDefinition({
    version: 2,
    id: 'root-scene',
    name: 'Root scene',
    duration: 5000,
    actors: ['a', 'b'].map((id, index) => ({
      id,
      character: { manifest: 'character.json' },
      position: { x: 100 + index * 200, y: 50 },
      animation: 'idle',
    })),
    actions,
  });
}
const runners: SceneRunner[] = [];
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
});
function fixture(data = scene(), setup?: (actor: Actor, stage: ReturnType<typeof puppetScene>) => void) {
  const events = vi.fn(),
    complete = vi.fn(),
    cue = vi.fn();
  const runner = new SceneRunner(data, {
    onCue: cue,
    createActor: (definition) => {
      const stage = puppetScene();
      const puppet = new Puppet(stage, {
        autoUpdate: false,
        rig: {
          root: 'root',
          bones: [{ id: 'root' }],
          footContactMarkers: [{ id: 'sole', name: 'Sole', boneId: 'root', localX: 0, localY: 0 }],
        },
        animations,
      });
      puppet.onAnimationEvent(events);
      puppet.onAnimationComplete(complete);
      const actor = new Actor({ id: definition.id, puppet, puppetOwnership: 'owned' });
      setup?.(actor, stage);
      return actor;
    },
  });
  runners.push(runner);
  return { runner, events, complete, cue, actor: () => runner.actors.get('a')! };
}

test('sword step retains +80 through idle, while the other Actor and skeletal source remain unchanged', () => {
  const before = structuredClone(animations);
  const { runner, actor, events, complete } = fixture(
    scene([clip(), clip('idle', 1000, 'idle', { movementSource: 'scene' })]),
  );
  runner.play();
  runner.update(500);
  assert.deepEqual(actor().position, { x: 140, y: 50 });
  assert.equal(actor().puppet.getBone('root').pose.rotation, 0.25);
  runner.update(500);
  assert.deepEqual(actor().position, { x: 180, y: 50 });
  runner.update(4000);
  assert.deepEqual(actor().position, { x: 180, y: 50 });
  assert.deepEqual(runner.actors.get('b')!.position, { x: 300, y: 50 });
  assert.equal(events.mock.calls.length, 3);
  assert.equal(complete.mock.calls.length, 2);
  assert.deepEqual(animations, before);
});

test.each(['scene', undefined] as const)(
  'scene-controlled/legacy source %s permits parallel move without adding root travel',
  (movementSource) => {
    const action = clip();
    assert.equal(action.type, 'animation');
    if (action.type !== 'animation') return;
    delete action.movementSource;
    if (movementSource) action.movementSource = movementSource;
    const { runner, actor } = fixture(
      scene([
        action,
        { id: 'move', actorId: 'a', type: 'move', time: 0, duration: 1000, destination: { x: 220, y: 70 } },
      ]),
    );
    runner.play();
    runner.update(1000);
    assert.deepEqual(actor().position, { x: 220, y: 70 });
  },
);

test('adjacent root clips and move handoffs capture fresh origins; two Actors travel independently', () => {
  const { runner, actor } = fixture(
    scene([
      { id: 'move', actorId: 'a', type: 'move', time: 0, duration: 1000, destination: { x: 200, y: 50 } },
      clip('sword', 1000),
      clip('dodge', 2000, 'dodge'),
      clip('jump', 3000, 'jump'),
      clip('other', 1000, 'jump', { actorId: 'b' }),
      { id: 'arrival', actorId: 'a', type: 'move', time: 4000, duration: 1000, destination: { x: 10, y: 20 } },
    ]),
  );
  runner.play();
  runner.update(3000);
  assert.deepEqual(actor().position, { x: 240, y: 50 });
  runner.update(1000);
  assert.deepEqual(actor().position, { x: 240, y: -10 });
  assert.deepEqual(runner.actors.get('b')!.position, { x: 300, y: -10 });
  runner.update(1000);
  assert.deepEqual(actor().position, { x: 10, y: 20 });
});

test.each(['left', 'right'] as const)(
  'clip-start %s facing and nonuniform scale/rotation/ancestor transform apply exactly once',
  (facing) => {
    const data = scene([clip('sword'), clip('jump', 1000, 'jump')]);
    data.actors[0]!.facing = facing;
    const { runner, actor } = fixture(data, (actor, stage) => {
      const container = actor.puppet.container;
      const parent = stage.add.container(20, 30).setScale(3, 4).setRotation(0.2);
      parent.add(container);
      container.setScale(2, 3).setRotation(Math.PI / 2);
    });
    runner.play();
    const expected = actor().puppet.container.getWorldTransformMatrix().transformPoint(80, 0);
    runner.update(1000);
    assert.closeTo(actor().worldPosition.x, expected.x, 1e-8);
    assert.closeTo(actor().worldPosition.y, expected.y, 1e-8);
    runner.update(1000);
    assert.closeTo(actor().position.x, 280, 1e-8);
    assert.closeTo(actor().position.y, facing === 'left' ? -110 : 210, 1e-8);
  },
);

test('finite windows accumulate looping cycles and speed, truncate clips and hold non-loop endpoints', () => {
  const { runner, actor } = fixture(
    scene([
      clip('loop', 0, 'sword', { loop: true, duration: 1250, speed: 2 }),
      clip('short', 1250, 'dodge', { duration: 250 }),
      clip('hold', 1500, 'sword', { duration: 2000 }),
    ]),
  );
  runner.play();
  for (const delta of [499, 1, 500, 250]) runner.update(delta);
  assert.deepEqual(actor().position, { x: 300, y: 50 });
  runner.update(250);
  assert.deepEqual(actor().position, { x: 290, y: 50 });
  runner.update(2000);
  assert.deepEqual(actor().position, { x: 370, y: 50 });
  runner.update(1500);
  assert.deepEqual(actor().position, { x: 370, y: 50 });
});

test('arbitrary direct seeks reconstruct completed and partial travel without events; resume consumes each remaining event once', () => {
  const data = scene([
    clip('loop', 0, 'sword', { loop: true, duration: 2500 }),
    clip('back', 2500, 'dodge'),
    { id: 'cue', type: 'cue', actorId: 'a', time: 3000, name: 'cue' },
  ]);
  const { runner, actor, events, complete, cue } = fixture(data);
  const baseline = fixture(data);
  for (const time of [5000, 2750, 0, 1000, 2499, 2500, 3000, 500, 3000]) {
    baseline.runner.restart();
    baseline.runner.update(time);
    runner.seek(time);
    assert.deepEqual(actor().position, baseline.actor().position);
    assert.deepEqual(actor().puppet.getBone('root').pose, baseline.actor().puppet.getBone('root').pose);
  }
  assert.equal(events.mock.calls.length, 0);
  assert.equal(complete.mock.calls.length, 0);
  assert.equal(cue.mock.calls.length, 0);
  runner.play();
  runner.update(2000);
  assert.equal(events.mock.calls.length, 1); // only the dodge endpoint remains
  assert.equal(complete.mock.calls.length, 1);
  assert.equal(cue.mock.calls.length, 0);
});

test.each(['cancel', 'replace'] as const)(
  '%s during a root clip preserves current travel and stops scene ownership',
  (operation) => {
    const { runner, actor } = fixture();
    runner.play();
    runner.update(375);
    const position = actor().position;
    if (operation === 'cancel') runner.cancel();
    else actor().play('idle');
    assert.equal(runner.status, operation === 'cancel' ? 'cancelled' : 'interrupted');
    runner.update(4000);
    assert.deepEqual(actor().position, position);
  },
);

test('overlapping translation/animation owners reject, adjacency and separate Actors remain valid', () => {
  const movement: SceneActionDefinition = {
    id: 'move',
    actorId: 'a',
    type: 'move',
    time: 500,
    duration: 1000,
    destination: { x: 0, y: 0 },
  };
  for (const action of [movement, clip('other', 500), clip('scene', 500, 'idle', { movementSource: 'scene' })])
    assert.throws(() => scene([clip(), action]), /Conflicting/);
  assert.doesNotThrow(() => scene([clip(), { ...movement, time: 1000 }]));
  assert.doesNotThrow(() => scene([clip(), { ...movement, actorId: 'b' }]));
  const document = new SceneEditorDocument();
  document.importJson(serializeSceneDefinition(scene()));
  const before = document.workingScene;
  assert.isFalse(document.addAction(movement));
  assert.strictEqual(document.workingScene, before);
});

test('invalid policies, timing, unbounded looping and rootless selections fail before playback or callbacks', () => {
  for (const patch of [
    { movementSource: 'blend' },
    { speed: Infinity },
    { speed: Number.MAX_VALUE },
    { duration: Infinity },
    { loop: 'forever' },
  ])
    assert.throws(() => parseSceneDefinition({ ...scene(), actions: [{ ...clip(), ...patch }] }));
  assert.throws(() => fixture(scene([clip('missing', 0, 'idle')])), /no root-motion/);
  const characters = new Map([
    ['character.json', { animations: ['sword', 'idle'], skins: [], rootMotionAnimations: ['sword'] }],
  ]);
  assert.throws(() => parseSceneDefinition(scene([clip('missing', 0, 'idle')]), { characters }), /no root-motion/);
  const document = new SceneEditorDocument({ characters });
  document.importJson(serializeSceneDefinition(scene()));
  const before = document.workingScene;
  assert.isFalse(document.updateAction('step', clip('step', 0, 'idle')));
  assert.strictEqual(document.workingScene, before);
  assert.deepEqual(parseSceneJson(serializeSceneDefinition(scene())), scene());
});

test('portable scene exports retain root tracks, policy, evaluated travel and asset validation', async () => {
  const assets = assetFixture();
  assets.documents['animations/wave.json'] = { ...animations[1], version: 1, name: 'wave' };
  const data = scene([clip('step', 0, 'wave')]);
  for (const actor of data.actors) {
    actor.character.manifest = 'characters/hero/character.json';
    actor.animation = 'wave';
  }
  const files = await buildScenePackage(data, assets);
  const resolved = await validateScenePackage(files);
  const definition = [...resolved.characters.values()][0]!;
  assert.deepEqual(definition.animations[0]!.rootMotion, animations[1]!.rootMotion);
  assert.deepEqual(
    parseSceneDefinition(resolved.definition, { characters: sceneAssetCatalog(resolved.characters) }).actions,
    data.actions,
  );
  const runner = new SceneRunner(resolved.definition, {
    createActor: (data) =>
      new Actor({
        id: data.id,
        puppetOwnership: 'owned',
        puppet: new Puppet(puppetScene(), { autoUpdate: false, definition }),
      }),
  });
  runners.push(runner);
  runner.seek(4000);
  assert.deepEqual(runner.actors.get('a')!.position, { x: 180, y: 50 });
  assert.deepEqual(runner.actors.get('b')!.position, { x: 300, y: 50 });
});

test('external movement interrupts the scene even during a root clip endpoint hold', async () => {
  const { runner, actor } = fixture(scene([clip('hold', 0, 'sword', { duration: 2000 })]));
  runner.play();
  runner.update(1250);
  const movement = actor().moveTo(500, 50);
  runner.update(250);
  assert.equal(runner.status, 'interrupted');
  assert.deepEqual(actor().position, { x: 180, y: 50 });
  actor().cancelMovement();
  assert.equal((await movement).status, 'cancelled');
});

test('root travel moves foot contacts through fixed or keyed cameras without changing artwork or world references', () => {
  const data = scene();
  data.camera = { x: 0, y: 0, zoom: 1 };
  data.layers = [
    { id: 'background', name: 'Background', visible: true, parallax: 0.5 },
    { id: 'actors', name: 'Actors', visible: true, parallax: 1 },
  ];
  data.images = [
    { id: 'backdrop', image: 'forest.png', position: { x: 10, y: 20 }, scale: { x: 1, y: 1 }, visible: true, order: 0 },
  ];
  const initial = structuredClone(data);
  const fixed = fixture(data);
  fixed.runner.seek(500);
  assert.deepEqual(evaluatedFootContacts(fixed.actor().puppet)[0]!.world, { x: 140, y: 50 });
  assert.deepEqual(fixed.runner.cinematicCamera, data.camera);
  data.cameraTracks = {
    x: [
      { id: 'start', time: 0, value: 0 },
      { id: 'end', time: 1000, value: 100 },
    ],
  };
  const keyed = fixture(data);
  keyed.runner.seek(500);
  assert.deepEqual(keyed.runner.cinematicCamera, { x: 50, y: 0, zoom: 1 });
  assert.deepEqual(keyed.actor().position, fixed.actor().position);
  assert.deepEqual(keyed.runner.definition.images, initial.images);
  assert.deepEqual(keyed.runner.definition.layers, initial.layers);
});

test('project package round trips movement source and root data and validates replacement against live character metadata', async () => {
  const assets = assetFixture();
  assets.documents['animations/wave.json'] = { ...animations[1], version: 1, name: 'wave' };
  const encoder = new TextEncoder();
  const files = new Map(
    Object.entries(assets.documents).map(([path, data]) => [path, encoder.encode(JSON.stringify(data))]),
  );
  const project = new ProjectWorkspace('Root motion');
  const id = await project.addCharacter(files);
  const data = scene([clip('step', 0, 'wave')]);
  for (const actor of data.actors) {
    actor.character.manifest = project.definition.characters[0]!.manifest;
    actor.animation = 'wave';
  }
  project.addScene(data);
  assert.equal(project.inspect('export').issues.filter((issue) => issue.severity === 'error').length, 0);
  const restored = await importProjectPackage((await buildProjectPackage(project)).files);
  assert.deepEqual(restored.scenes.scene(data.id)!.actions, data.actions);
  assert.deepEqual(restored.character(id).definition.animations[0]!.rootMotion, animations[1]!.rootMotion);
  const entry = restored.character(id);
  const original = restored.captureCharacter(id);
  entry.capture = () => ({ ...original, animations: [{ name: 'wave', duration: 1000, loop: false, tracks: {} }] });
  assert.throws(() => restored.validateScene(restored.scenes.scene(data.id)), /no root-motion/);
  assert.isFalse(restored.scenes.updateAction('step', clip('step', 0, 'wave', { speed: 2 })));
});
