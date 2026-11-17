import { assert, test, vi } from 'vitest';
import {
  AnimationEditorDocument,
  type ReadonlyAnimation,
} from '../src/devtools/animation-editor/AnimationEditorDocument.js';
import {
  AnimationEditSession,
  type AnimationEditActions,
  type AnimationEditSessionDeps,
} from '../src/devtools/animation-editor/AnimationEditSession.js';
import { setBonePropertyKeyframe } from '../src/devtools/animation-editor/keyframeEdits.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import type { Rig } from '../src/engine/Rig.js';
import { Rig as RigClass } from '../src/engine/Rig.js';

function rig(): Rig {
  return new RigClass({
    root: 'root',
    bones: [
      { id: 'root', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      { id: 'child', parent: 'root', x: 10, y: 5, rotation: 0, scaleX: 1, scaleY: 1 },
    ],
  });
}

function clip(): AnimationClip {
  return {
    name: 'move',
    duration: 1000,
    loop: false,
    tracks: { root: [{ time: 0, x: 1 }] },
  };
}

/** Recording mock dependencies: every step appends its name to `calls`. */
function mockDeps(options: { authoring?: boolean; working?: ReadonlyAnimation | null } = {}) {
  const calls: string[] = [];
  const working = ('working' in options ? options.working : { name: 'move' }) as ReadonlyAnimation | null;
  const authoring = options.authoring ?? true;
  const updateTimeSpy = vi.fn((_time: number) => {
    calls.push('updateTime');
    return true;
  });
  const deps: AnimationEditSessionDeps = {
    document: {
      install: vi.fn(() => {
        calls.push('install');
        return true;
      }),
      reportError: vi.fn((error: unknown) => {
        calls.push(`reportError:${error instanceof Error ? error.message : String(error)}`);
      }),
    } as unknown as AnimationEditorDocument,
    authoringEnabled: () => {
      calls.push('authoringEnabled');
      return authoring;
    },
    working: () => working,
    rig: () => rig(),
    currentTime: () => 0.5,
    cancelActiveDrags: () => {
      calls.push('cancelActiveDrags');
      return true;
    },
    pausePlayback: () => {
      calls.push('pause');
    },
    endScrub: () => {
      calls.push('endScrub');
    },
    updateTime: updateTimeSpy,
    updateTimeMilliseconds: () => {
      calls.push('updateTimeMilliseconds');
      return true;
    },
    clearTransformDraft: () => {
      calls.push('clearTransformDraft');
      return false;
    },
    setSelectedKeys: () => {
      calls.push('setSelectedKeys');
    },
    reconcileSelection: () => {
      calls.push('reconcileSelection');
    },
    reconcileRootKey: () => {
      calls.push('reconcileRootKey');
    },
    clearRootSelection: () => {
      calls.push('clearRootSelection');
    },
    selectKeyframe: () => {
      calls.push('selectKeyframe');
      return true;
    },
    selectEvent: () => {
      calls.push('selectEvent');
      return true;
    },
    clearBoneSelection: () => {
      calls.push('clearBoneSelection');
    },
    clearOtherSelection: () => {
      calls.push('clearOtherSelection');
    },
    selectCommittedKey: () => {
      calls.push('selectCommittedKey');
    },
    reconcilePreviews: () => {
      calls.push('beforeNotify');
    },
  };
  return { deps, calls, updateTimeSpy };
}

/** Session wired to a real validated document, so history entries are observable. */
function documentSession() {
  const rigInstance = rig();
  const document = new AnimationEditorDocument(rigInstance, [clip()]);
  document.selectAnimation('move');
  const calls: string[] = [];
  const deps: AnimationEditSessionDeps = {
    document,
    authoringEnabled: () => true,
    working: () => document.workingAnimation,
    rig: () => document.rig,
    currentTime: () => 0,
    cancelActiveDrags: () => {
      calls.push('cancelActiveDrags');
      return false;
    },
    pausePlayback: () => {
      calls.push('pause');
    },
    endScrub: () => {
      calls.push('endScrub');
    },
    updateTime: () => {
      calls.push('updateTime');
      return false;
    },
    updateTimeMilliseconds: () => false,
    clearTransformDraft: () => false,
    setSelectedKeys: () => {
      calls.push('setSelectedKeys');
    },
    reconcileSelection: () => {
      calls.push('reconcileSelection');
    },
    reconcileRootKey: () => {
      calls.push('reconcileRootKey');
    },
    clearRootSelection: () => {},
    selectKeyframe: () => true,
    selectEvent: () => true,
    clearBoneSelection: () => {},
    clearOtherSelection: () => {},
    selectCommittedKey: () => {},
    reconcilePreviews: () => {
      calls.push('beforeNotify');
    },
  };
  return { session: new AnimationEditSession(deps), document, rig: rigInstance, calls };
}

test('commit runs the transaction steps in exactly one order and notifies once', () => {
  const { deps, calls } = mockDeps();
  const session = new AnimationEditSession(deps);
  const listener = vi.fn();
  session.subscribe(listener);
  const next = { name: 'move', extra: true } as unknown as ReadonlyAnimation;
  const edit = vi.fn(() => {
    calls.push('edit');
    return next;
  });
  assert.isTrue(session.commit(edit, { time: 0.25 }));
  assert.deepEqual(calls, [
    'authoringEnabled',
    'cancelActiveDrags',
    'edit',
    'pause',
    'endScrub',
    'updateTime',
    'install',
    'clearTransformDraft',
    'updateTime',
    'reconcileRootKey',
    'reconcileSelection',
    'beforeNotify',
  ]);
  assert.equal(listener.mock.calls.length, 1, 'one batched notification per commit');
  assert.strictEqual((deps.document.install as ReturnType<typeof vi.fn>).mock.calls[0]![0], next);
});

test('commit freezes the installed snapshot before the document records history', () => {
  const { session, document } = documentSession();
  const next = session.commit((working, rig) => setBonePropertyKeyframe(working, rig, 'root', 'x', 0, 5));
  assert.isTrue(next);
  const installed = document.workingAnimation!;
  assert.isTrue(Object.isFrozen(installed));
  assert.isTrue(Object.isFrozen(installed.tracks));
});

test('one history entry per successful commit, none for aborts or failures', () => {
  const { session, document, rig: rigInstance } = documentSession();
  assert.equal(document.historyLength, 0);
  assert.isTrue(session.commit((working, r) => setBonePropertyKeyframe(working, r, 'root', 'x', 0, 5)));
  assert.equal(document.historyLength, 1);
  assert.isTrue(session.commit((working, r) => setBonePropertyKeyframe(working, r, 'root', 'x', 500, 7)));
  assert.equal(document.historyLength, 2);
  // Aborted edits install nothing.
  assert.isFalse(session.commit(() => undefined));
  assert.equal(document.historyLength, 2);
  // Failed edits report and install nothing.
  assert.isFalse(
    session.commit(() => {
      throw new Error('invalid edit');
    }),
  );
  assert.equal(document.historyLength, 2);
  assert.match(document.validationIssues[0]!.message, /invalid edit/);
  // An unchanged snapshot installs without consuming history.
  const held = document.workingAnimation!;
  assert.isTrue(session.commit((working) => working));
  assert.equal(document.historyLength, 2);
  assert.strictEqual(document.workingAnimation, held);
  assert.isTrue(rigInstance.hasBone('root'));
});

test('commit cancels active drags before installing and reports the cancellation order', () => {
  const { session, document, calls } = documentSession();
  assert.isTrue(session.commit((working, r) => setBonePropertyKeyframe(working, r, 'root', 'y', 0, 3)));
  assert.deepEqual(calls.slice(0, 2), ['cancelActiveDrags', 'pause'], 'drag cancellation precedes playback pause');
  assert.isBelow(calls.indexOf('cancelActiveDrags'), calls.indexOf('reconcileSelection'));
  assert.isTrue(document.dirty);
});

test('authoring guard blocks commits without touching any dependency', () => {
  const { deps, calls } = mockDeps({ authoring: false });

  const session = new AnimationEditSession(deps);
  const listener = vi.fn();
  session.subscribe(listener);
  assert.isFalse(session.commit(() => ({}) as unknown as ReadonlyAnimation));
  assert.isFalse(session.install({} as unknown as ReadonlyAnimation));
  assert.deepEqual(calls, ['authoringEnabled', 'authoringEnabled']);
  assert.equal(listener.mock.calls.length, 0);
});

test('missing working clip or rig aborts before cancelling drags or installing', () => {
  const { deps, calls } = mockDeps({ working: null });
  const session = new AnimationEditSession(deps);
  assert.isFalse(session.commit(() => ({}) as unknown as ReadonlyAnimation));
  assert.deepEqual(calls, ['authoringEnabled']);
});

test('pause:false skips playback pause and scrub end but still installs and notifies', () => {
  const { deps, calls } = mockDeps();
  const session = new AnimationEditSession(deps);
  const listener = vi.fn();
  session.subscribe(listener);
  assert.isTrue(session.commit(() => ({}) as unknown as ReadonlyAnimation, { pause: false }));
  assert.deepEqual(calls, [
    'authoringEnabled',
    'cancelActiveDrags',
    'install',
    'clearTransformDraft',
    'updateTime',
    'reconcileRootKey',
    'reconcileSelection',
    'beforeNotify',
  ]);
  assert.equal(listener.mock.calls.length, 1);
});

test('opts.time seeks before install and selectedKeys replace the selection after install', () => {
  const { deps, calls, updateTimeSpy } = mockDeps();
  const session = new AnimationEditSession(deps);
  const keys = [{ boneId: 'root', property: 'x' as const, time: 0.5 }];
  assert.isTrue(session.commit(() => ({}) as unknown as ReadonlyAnimation, { time: 0.75, selectedKeys: keys }));
  assert.equal(updateTimeSpy.mock.calls[0]![0], 0.75);
  assert.isBelow(calls.indexOf('updateTime'), calls.indexOf('install'));
  assert.isBelow(calls.indexOf('install'), calls.indexOf('setSelectedKeys'));
  assert.equal(calls.filter((c) => c === 'setSelectedKeys').length, 1);
});

test('install failure notifies once and returns false without reconciling selection', () => {
  const { deps, calls } = mockDeps();
  (deps.document.install as ReturnType<typeof vi.fn>).mockImplementation(() => {
    calls.push('install');
    return false;
  });
  const session = new AnimationEditSession(deps);
  const listener = vi.fn();
  session.subscribe(listener);
  assert.isFalse(session.install({} as unknown as ReadonlyAnimation));
  assert.deepEqual(calls, ['authoringEnabled', 'cancelActiveDrags', 'install', 'beforeNotify']);
  assert.equal(listener.mock.calls.length, 1);
});

test('nested batches publish a single notification after the outermost command', () => {
  const { deps } = mockDeps();
  const session = new AnimationEditSession(deps);
  const listener = vi.fn();
  session.subscribe(listener);
  session.batch(() => {
    session.notify();
    session.batch(() => session.notify());
    assert.equal(listener.mock.calls.length, 0);
  });
  assert.equal(listener.mock.calls.length, 1);
});

test('selectKeyframe clears the root selection inside one batched boundary', () => {
  const { deps, calls } = mockDeps();
  const session = new AnimationEditSession(deps);
  const key = { boneId: 'root', property: 'x' as const, time: 0 };
  assert.isTrue(session.selectKeyframe(key));
  assert.deepEqual(calls, ['clearRootSelection', 'selectKeyframe']);
});

test('stopPlayback pauses before ending the scrub and never cancels drags or notifies', () => {
  const { deps, calls } = mockDeps();
  const session = new AnimationEditSession(deps);
  const listener = vi.fn();
  session.subscribe(listener);
  session.stopPlayback();
  assert.deepEqual(calls, ['pause', 'endScrub']);
  assert.equal(listener.mock.calls.length, 0);
});

test('beginGesture cancels active drags before stopping the clock and leaves notification to the caller', () => {
  const { deps, calls } = mockDeps();
  const session = new AnimationEditSession(deps);
  const listener = vi.fn();
  session.subscribe(listener);
  session.beginGesture();
  assert.deepEqual(calls, ['cancelActiveDrags', 'pause', 'endScrub']);
  assert.equal(listener.mock.calls.length, 0);
});

test('commit stops the clock through the same pause-then-end-scrub step as gestures', () => {
  const { deps, calls } = mockDeps();
  const session = new AnimationEditSession(deps);
  session.commit((working) => ({ ...working }));
  const pause = calls.indexOf('pause');
  assert.isAbove(pause, calls.indexOf('cancelActiveDrags'));
  assert.equal(calls[pause + 1], 'endScrub');
  assert.isBelow(pause, calls.indexOf('install'));
});

test('command modules reach only transaction operations through AnimationEditActions', () => {
  const { deps, calls } = mockDeps();
  const actions: AnimationEditActions = new AnimationEditSession(deps);
  // Compile-time guard (npm run typecheck): the raw steps are not on the shared shape.
  // @ts-expect-error pause is reachable only through stopPlayback, beginGesture or commit.
  assert.isUndefined(actions.pause);
  // @ts-expect-error endScrub is reachable only through stopPlayback, beginGesture or commit.
  assert.isUndefined(actions.endScrub);
  // @ts-expect-error command modules install through commit.
  assert.isFunction(actions.install);
  actions.beginGesture();
  assert.deepEqual(calls, ['cancelActiveDrags', 'pause', 'endScrub']);
});
