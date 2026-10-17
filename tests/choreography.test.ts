import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import {
  Actor,
  Choreography,
  ChoreographyConflictError,
  type ChoreographyPlan,
  ChoreographySequence,
  type ChoreographyStep,
  Puppet,
} from '../src/engine/runtime.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const fixtures: Actor[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const actor of fixtures.splice(0)) {
    actor.dispose();
    actor.puppet.destroy();
  }
});

function fixture(id: string, scene = puppetScene(), autoUpdate = false): Actor {
  const puppet = new Puppet(scene, {
    autoUpdate,
    rig: { root: 'root', bones: [{ id: 'root' }] },
    animations: ['walk', 'idle', 'bow', 'response'].map((name) => ({
      name,
      duration: 100,
      loop: name === 'walk' || name === 'idle',
      tracks: {},
      events: name === 'bow' ? [{ time: 50, name: 'greeting' }] : [],
    })),
  });
  const actor = new Actor({ id, puppet, locomotion: { walk: 'walk', idle: 'idle' } });
  fixtures.push(actor);
  return actor;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 40; index++) await Promise.resolve();
}

function resources(actor: Actor): number[] {
  return [
    [actor.puppet, 'updateListeners'],
    [actor.puppet.animationPlayer, 'lifecycleListeners'],
    [actor.puppet.animationPlayer, 'pendingWaitDisposers'],
  ].map(([owner, key]) => {
    const value: unknown = Reflect.get(owner as object, key as string);
    assert.instanceOf(value, Set);
    return value.size;
  });
}

test('concurrent walks share scene ticks; barrier waits for both before facing and animation response', async () => {
  const scene = puppetScene();
  const SceneEvents = createRequire(import.meta.url)(
    '../node_modules/phaser/src/events/EventEmitter.js',
  ) as typeof Phaser.Events.EventEmitter;
  const events = new SceneEvents();
  scene.events = events;
  const a = fixture('a', scene, true);
  const b = fixture('b', scene, true).setPosition(300, 0);
  const c = new Choreography([a, b]);
  const seen: string[] = [];
  for (const actor of [a, b]) {
    actor.puppet.onPlaybackLifecycle((event) => {
      if (event.type === 'started') seen.push(`${actor.id}:${event.clip}`);
    });
  }
  const baseline = [resources(a), resources(b)];
  const pending = c.run(
    c.sequence([
      c.parallel([
        c.actor('a', [{ kind: 'walk', x: 50, y: 0, options: { speed: 100 } }]),
        c.actor('b', [{ kind: 'walk', x: 200, y: 0, options: { speed: 100 } }]),
      ]),
      c.parallel([c.actor('a', [{ kind: 'lookAt', target: b }]), c.actor('b', [{ kind: 'lookAt', target: a }])]),
      c.actor('a', [{ kind: 'animation', name: 'bow' }]),
      c.actor('b', [{ kind: 'animation', name: 'response' }]),
    ]),
  );
  assert.deepEqual(seen, ['a:walk', 'b:walk']);
  assert.equal(events.listenerCount('update'), 2, 'only the existing Puppet scene subscriptions');
  events.emit('update', 0, 500);
  await flush();
  assert.deepEqual([a.position.x, b.position.x], [50, 250]);
  assert.deepEqual(seen, ['a:walk', 'b:walk', 'a:idle']);
  events.emit('update', 0, 499);
  await flush();
  assert.equal(seen.length, 3, 'early arrival cannot release the barrier');
  events.emit('update', 0, 1);
  await flush();
  assert.deepEqual([a.position.x, b.position.x], [50, 200]);
  assert.deepEqual([a.facingDirection, b.facingDirection], ['right', 'left']);
  assert.deepEqual(seen.slice(-2), ['b:idle', 'a:bow']);
  events.emit('update', 0, 100);
  await flush();
  assert.equal(seen.at(-1), 'b:response');
  events.emit('update', 0, 100);
  const outcome = await pending;
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.children.length, 4);
  assert.deepEqual(
    outcome.children[0]!.children.map((child) => child.sequenceResult?.status),
    ['completed', 'completed'],
  );
  assert.deepEqual([resources(a), resources(b)], baseline);
});

test.each(['move', 'walk', 'animation', 'wait'] as const)(
  'group cancellation settles %s branches and prevents later steps',
  async (kind) => {
    const a = fixture('a');
    const b = fixture('b');
    const c = new Choreography([a, b]);
    const cue = vi.fn(() => undefined);
    const steps: ChoreographyStep[] = [
      kind === 'move' || kind === 'walk'
        ? { kind, x: 100, y: 0, options: { speed: 100 } }
        : kind === 'animation'
          ? { kind, name: 'bow' }
          : { kind, duration: 1000 },
      { kind: 'cue', callback: cue },
    ];
    const removals = [a, b].map((actor) => vi.spyOn(actor.disposalSignal, 'removeEventListener'));
    const pending = c.run(
      c.sequence([
        c.parallel([c.actor('a', steps), c.actor('b', steps)]),
        c.actor('a', [{ kind: 'cue', callback: cue }]),
      ]),
    );
    a.puppet.update(25);
    b.puppet.update(25);
    c.cancel();
    c.cancel();
    const outcome = await pending;
    assert.equal(outcome.status, 'cancelled');
    assert.equal(outcome.children.length, 1);
    assert.deepEqual(
      outcome.children[0]!.children.map((child) => child.status),
      ['cancelled', 'cancelled'],
    );
    a.puppet.update(10000);
    b.puppet.update(10000);
    assert.equal(cue.mock.calls.length, 0);
    assert.deepEqual(resources(a), [0, 0, 0]);
    assert.deepEqual(resources(b), [0, 0, 0]);
    assert.deepEqual(
      removals.map((spy) => spy.mock.calls.length),
      [1, 1],
    );
    assert.equal((await new ChoreographySequence(a).wait(0).run()).status, 'completed', 'claim released');
  },
);

test('branch failure cancels nested siblings, preserves original error and waits for cleanup', async () => {
  const a = fixture('a');
  const b = fixture('b');
  const d = fixture('d');
  const c = new Choreography([a, b, d]);
  const failure = new Error('application cue failed');
  const cue = vi.fn(() => undefined);
  const pending = c.run(
    c.sequence([
      c.parallel([
        c.parallel([
          c.actor('b', [{ kind: 'walk', x: 100, y: 0 }]),
          c.actor('d', [{ kind: 'animation', name: 'bow' }]),
        ]),
        c.actor('a', [
          { kind: 'wait', duration: 10 },
          {
            kind: 'cue',
            callback: () => {
              throw failure;
            },
          },
        ]),
      ]),
      c.actor('a', [{ kind: 'cue', callback: cue }]),
    ]),
  );
  a.puppet.update(10);
  const outcome = await pending;
  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') assert.strictEqual(outcome.error, failure);
  assert.equal(outcome.children[0]!.children[1]!.sequenceResult?.completedSteps, 1);
  assert.equal(outcome.children[0]!.children[0]!.children[0]!.status, 'cancelled');
  assert.equal(outcome.children[0]!.children[0]!.children[1]!.status, 'cancelled');
  assert.equal(b.currentAnimation, 'idle');
  assert.equal(d.puppet.getPlaybackStatus()?.status, 'stopped');
  assert.equal(cue.mock.calls.length, 0);
  for (const actor of [a, b, d]) assert.deepEqual(resources(actor), [0, 0, 0]);
});

test.each(['movement', 'animation'] as const)(
  'external %s interruption fails the barrier and preserves replacements',
  async (kind) => {
    const a = fixture('a');
    const b = fixture('b');
    const c = new Choreography([a, b]);
    const cue = vi.fn(() => undefined);
    const step: ChoreographyStep =
      kind === 'movement' ? { kind: 'move', x: 100, y: 0 } : { kind: 'animation', name: 'bow' };
    const pending = c.run(
      c.sequence([
        c.parallel([c.actor('a', [step]), c.actor('b', [{ kind: 'wait', duration: 1000 }])]),
        c.actor('b', [{ kind: 'cue', callback: cue }]),
      ]),
    );
    const replacement = kind === 'movement' ? a.moveTo(200, 0, { speed: 200 }) : a.playAndWait('response');
    assert.equal((await pending).status, 'interrupted');
    a.puppet.update(1000);
    assert.equal((await replacement).status, 'completed');
    assert.equal(cue.mock.calls.length, 0);
    assert.deepEqual(resources(b), [0, 0, 0]);
  },
);

test('cancellation while waiting preserves host movement, playback layers and other Actors', async () => {
  const a = fixture('a');
  const b = fixture('b');
  const other = fixture('other');
  const c = new Choreography([a, b]);
  const movement = a.moveTo(100, 0, { speed: 100 });
  a.play('idle');
  b.puppet.play('response', { layer: 'overlay' });
  const overlay = b.puppet.waitForPlayback({ layer: 'overlay' });
  const unrelated = new ChoreographySequence(other).moveTo(100, 0, { speed: 100 }).run();
  const pending = c.run(
    c.parallel([c.actor('a', [{ kind: 'wait', duration: 1000 }]), c.actor('b', [{ kind: 'animation', name: 'bow' }])]),
  );
  c.cancel();
  assert.equal((await pending).status, 'cancelled');
  for (const actor of [a, b, other]) actor.puppet.update(1000);
  assert.equal((await movement).status, 'completed');
  assert.equal((await overlay).status, 'completed');
  assert.equal((await unrelated).status, 'completed');
  assert.equal(a.currentAnimation, 'idle');
});

test.each(['dispose', 'destroy'] as const)('Actor %s stops the group without further clock updates', async (method) => {
  const a = fixture('a');
  const b = fixture('b');
  const c = new Choreography([a, b]);
  const pending = c.run(
    c.parallel([c.actor('a', [{ kind: 'wait', duration: 1000 }]), c.actor('b', [{ kind: 'walk', x: 100, y: 0 }])]),
  );
  if (method === 'dispose') a.dispose();
  else a.puppet.destroy();
  const outcome = await pending;
  assert.equal(outcome.status, 'disposed');
  assert.deepEqual(
    outcome.children.map((child) => child.status),
    ['disposed', 'cancelled'],
  );
  assert.deepEqual(resources(a), [0, 0, 0]);
  assert.deepEqual(resources(b), [0, 0, 0]);
});

test('registry rejects duplicate, missing and disposed Actors; failed preflight has no side effects', async () => {
  const a = fixture('a');
  const duplicate = fixture('a');
  const b = fixture('b');
  const c = new Choreography([a]).register(b);
  assert.strictEqual(c.getActor('a'), a);
  assert.throws(() => c.register(a), /Duplicate/);
  assert.throws(() => c.register(duplicate), /Duplicate/);
  assert.throws(() => c.getActor('missing'), /Missing/);
  const cue = vi.fn(() => undefined);
  const pending = c.run(c.sequence([c.actor('a', [{ kind: 'cue', callback: cue }]), c.actor('missing', [])]));
  assert.equal((await pending).status, 'failed');
  assert.equal(cue.mock.calls.length, 0);
  assert.throws(() => c.register(duplicate), /closed/);
  b.dispose();
  assert.throws(() => new Choreography([b]), /disposed/);
  const disposed = new Choreography([a]);
  a.dispose();
  assert.equal((await disposed.run(disposed.actor('a', []))).status, 'disposed');
});

test.each(['same', 'nested', 'alias'] as const)(
  'parallel %s Actor conflict is rejected before actions start',
  async (kind) => {
    const a = fixture('a');
    const alias = new Actor({ id: 'alias', puppet: a.puppet });
    fixtures.push(alias);
    const c = new Choreography([a, alias]);
    const cue = vi.fn(() => undefined);
    const leaf = c.actor('a', [
      { kind: 'cue', callback: cue },
      { kind: 'move', x: 100, y: 0 },
    ]);
    const branch = c.actor(kind === 'alias' ? 'alias' : 'a', [{ kind: 'animation', name: 'bow' }]);
    const outcome = await c.run(c.parallel([leaf, kind === 'nested' ? c.sequence([branch]) : branch]));
    assert.equal(outcome.status, 'failed');
    if (outcome.status === 'failed') assert.instanceOf(outcome.error, ChoreographyConflictError);
    assert.equal(cue.mock.calls.length, 0);
    assert.deepEqual(a.position, { x: 0, y: 0 });
    assert.isUndefined(a.currentAnimation);
  },
);

test('independent contexts and single-Actor sequences share exclusive claims and release them', async () => {
  const a = fixture('a');
  const c = new Choreography([a]);
  const owner = new ChoreographySequence(a).moveTo(100, 0, { speed: 100 });
  const pending = owner.run();
  const conflict = await c.run(c.actor('a', [{ kind: 'animation', name: 'bow' }]));
  assert.equal(conflict.status, 'failed');
  if (conflict.status === 'failed') assert.instanceOf(conflict.error, ChoreographyConflictError);
  a.puppet.update(1000);
  assert.equal((await pending).status, 'completed');
  const next = new Choreography([a]);
  const nextPending = next.run(next.actor('a', [{ kind: 'wait', duration: 10 }]));
  const reverse = await new ChoreographySequence(a).playAnimation('bow').run();
  assert.equal(reverse.status, 'failed');
  if (reverse.status === 'failed') assert.instanceOf(reverse.error, ChoreographyConflictError);
  a.puppet.update(10);
  assert.equal((await nextPending).status, 'completed');
  assert.deepEqual(resources(a), [0, 0, 0]);
});

test('invalid future branches are preflighted and cyclic plans fail without running cues', async () => {
  const a = fixture('a');
  const b = fixture('b');
  const c = new Choreography([a, b]);
  const cue = vi.fn(() => undefined);
  const outcome = await c.run(
    c.sequence([
      c.actor('a', [{ kind: 'cue', callback: cue }]),
      c.actor('b', [{ kind: 'animation', name: 'missing' }]),
    ]),
  );
  assert.equal(outcome.status, 'failed');
  assert.equal(cue.mock.calls.length, 0);
  const cycle: { kind: 'sequence'; children: ChoreographyPlan[] } = { kind: 'sequence', children: [] };
  cycle.children.push(cycle);
  assert.equal((await new Choreography().run(cycle)).status, 'failed');
});

test.each([
  null,
  { kind: 'actor', actorId: 'a', steps: null },
  { kind: 'actor', actorId: 'missing', steps: [] },
  { kind: 'parallel', children: null },
  { kind: 'sequence', children: [null] },
  { kind: 'unknown', children: [] },
])('malformed raw plan returns failed: %j', async (input) => {
  const a = fixture('a');
  const c = new Choreography([a]);
  assert.equal((await c.run(input as unknown as ChoreographyPlan)).status, 'failed');
  assert.deepEqual(resources(a), [0, 0, 0]);
});

test('raw plans snapshot future actions before earlier cues can modify them', async () => {
  const a = fixture('a');
  const c = new Choreography([a]);
  const future = { kind: 'move' as const, x: 100, y: 0, options: { speed: 100 } };
  const pending = c.run({
    kind: 'sequence',
    children: [
      c.actor('a', [
        {
          kind: 'cue',
          callback: () => {
            future.x = 200;
            future.options.speed = 1;
          },
        },
      ]),
      { kind: 'actor', actorId: 'a', steps: [future] },
    ],
  });
  await flush();
  a.puppet.update(1000);
  assert.equal((await pending).status, 'completed');
  assert.equal(a.position.x, 100);
});

test('cancelling a root Actor leaf before context settlement wins over an unobserved result', async () => {
  const a = fixture('a');
  const c = new Choreography([a]);
  const pending = c.run(c.actor('a', []));
  c.cancel();
  assert.equal((await pending).status, 'cancelled');
  const next = new Choreography([a]);
  const nextPending = next.run(
    next.actor('a', [
      {
        kind: 'cue',
        callback: () => {
          next.cancel();
          throw new Error('after cancellation');
        },
      },
    ]),
  );
  assert.equal((await nextPending).status, 'cancelled');
  assert.deepEqual(resources(a), [0, 0, 0]);
});

test('authored event reacts through the existing dispatcher and can cancel the whole group', async () => {
  const a = fixture('a');
  const b = fixture('b');
  const c = new Choreography([a, b]);
  const seen: string[] = [];
  const unsubscribe = a.puppet.onAnimationEvent((event) => {
    seen.push(event.name);
    c.cancel();
  });
  const pending = c.run(
    c.parallel([c.actor('a', [{ kind: 'animation', name: 'bow' }]), c.actor('b', [{ kind: 'move', x: 100, y: 0 }])]),
  );
  a.puppet.update(50);
  assert.equal((await pending).status, 'cancelled');
  a.puppet.update(1000);
  assert.deepEqual(seen, ['greeting']);
  unsubscribe();
  assert.deepEqual(resources(a), [0, 0, 0]);
});

test.each(['cancel', 'dispose'] as const)(
  '%s during synchronous start prevents other parallel branches starting',
  async (method) => {
    const a = fixture('a');
    const b = fixture('b');
    const c = new Choreography([a, b]);
    const cue = vi.fn(() => undefined);
    const pending = c.run(
      c.parallel([
        c.actor('a', [
          {
            kind: 'cue',
            callback: () => {
              c[method]();
            },
          },
        ]),
        c.actor('b', [{ kind: 'cue', callback: cue }]),
      ]),
    );
    assert.equal((await pending).status, method === 'cancel' ? 'cancelled' : 'disposed');
    assert.equal(cue.mock.calls.length, 0);
    assert.isFalse(a.isDisposed);
    assert.isFalse(b.isDisposed);
  },
);

test('single-run reentrancy, immutable results, empty groups and cancellation before run', async () => {
  const a = fixture('a');
  const c = new Choreography([a]);
  let reentrant: ReturnType<Choreography['run']> | undefined;
  const plan = c.sequence([
    c.parallel([]),
    c.actor('a', [
      {
        kind: 'cue',
        callback: () => {
          reentrant = c.run(plan);
        },
      },
    ]),
    c.actor('a', [{ kind: 'wait', duration: 0 }]),
  ]);
  const pending = c.run(plan);
  const outcome = await pending;
  assert.strictEqual(reentrant, pending);
  assert.strictEqual(c.run(c.parallel([])), pending);
  assert.equal(outcome.status, 'completed');
  assert.isTrue(Object.isFrozen(outcome));
  assert.isTrue(Object.isFrozen(outcome.children));
  c.dispose();
  assert.throws(() => c.getActor('a'), /Missing/);
  assert.isFalse(a.isDisposed);
  for (const method of ['cancel', 'dispose'] as const) {
    const stopped = new Choreography([a]);
    stopped[method]();
    assert.equal(
      (await stopped.run(stopped.actor('a', [{ kind: 'animation', name: 'bow' }]))).status,
      method === 'cancel' ? 'cancelled' : 'disposed',
    );
  }
});

test.each([[1000], [250, 250, 500], [13, 87, 300, 600]])(
  'deterministic updates %j reach exact destinations with no wall clock',
  async (...deltas: number[]) => {
    const a = fixture('a');
    const b = fixture('b');
    const c = new Choreography([a, b]);
    const options = { speed: 100 };
    const action = c.actor('a', [{ kind: 'move', x: 100, y: 0, options }]);
    options.speed = 1;
    const pending = c.run(c.parallel([action, c.actor('b', [{ kind: 'move', x: -50, y: 0, options: { speed: 50 } }])]));
    await flush();
    assert.deepEqual([a.position.x, b.position.x], [0, 0]);
    for (const delta of deltas) {
      a.puppet.update(delta);
      b.puppet.update(delta);
      await flush();
    }
    assert.equal((await pending).status, 'completed');
    assert.deepEqual([a.position.x, b.position.x], [100, -50]);
  },
);
