import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { DemoInput } from '../src/demo/DemoInput.js';
import type { DemoPoseAuthoring } from '../src/demo/DemoPoseAuthoring.js';
import type { DemoPresenter } from '../src/demo/DemoPresenter.js';
import type { DemoScene } from '../src/demo/DemoScene.js';
import { createDemoCommands } from '../src/demo/demoCommands.js';

function emitter() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(handler);
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
    once(event: string, handler: (...args: unknown[]) => void) {
      const once = (...args: unknown[]) => {
        this.off(event, once);
        handler(...args);
      };
      this.on(event, once);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const target = new EventTarget();
  const document = { activeElement: null as unknown };
  vi.stubGlobal('window', target);
  vi.stubGlobal('document', document);
  const press = (code: string, properties: Record<string, unknown> = {}) => {
    const event = new Event('keydown', { cancelable: true });
    for (const [key, value] of Object.entries({ code, key: code, ...properties }))
      Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  const keys = { Q: { isDown: false, ctrlKey: false }, E: { isDown: false, ctrlKey: false } };
  const keyboard = {
    ...emitter(),
    addKey: vi.fn((key: keyof typeof keys, _capture?: boolean) => keys[key]),
  };
  const scene = {
    input: { ...emitter(), keyboard: keyboard as typeof keyboard | undefined },
    events: emitter(),
    play: vi.fn(),
    crossfade: vi.fn(),
    adjustSpeed: vi.fn(),
    selectBone: vi.fn(),
    adjustSelected: vi.fn(),
    resetBind: vi.fn(),
    restart: vi.fn(),
    face: vi.fn(),
    togglePlayback: vi.fn(),
  };
  const authoring = { active: false };
  const presentation = { handTarget: { x: 0, y: 0 } };
  const bind = () =>
    new DemoInput(scene as unknown as DemoScene, authoring as DemoPoseAuthoring, presentation as DemoPresenter);
  return { scene, authoring, presentation, keys, keyboard, bind, press, document };
}

test('input uses world coordinates, changes bracket/R actions with pose mode, and reads held Q/E keys', () => {
  const { scene, authoring, presentation, keys, bind, press } = fixture();
  const input = bind();
  scene.input.emit('pointermove', { worldX: 123, worldY: 456 } as Phaser.Input.Pointer);
  assert.deepEqual(presentation.handTarget, { x: 123, y: 456 });
  press('Digit1');
  assert.deepEqual(scene.play.mock.lastCall, ['idle']);
  press('BracketLeft');
  assert.deepEqual(scene.adjustSpeed.mock.lastCall, [-0.25]);
  press('KeyR');
  assert.strictEqual(scene.restart.mock.calls.length, 1);

  authoring.active = true;
  press('BracketRight');
  assert.deepEqual(scene.selectBone.mock.lastCall, [1]);
  press('KeyR');
  assert.strictEqual(scene.resetBind.mock.calls.length, 1);
  const event = press('ArrowRight', { shiftKey: true, altKey: true });
  assert.deepEqual(scene.adjustSelected.mock.lastCall, ['x', 5]);
  assert.isTrue(event.defaultPrevented);
  keys.Q.isDown = true;
  assert.strictEqual(input.katanaTurn(500), -0.5);
  keys.E.isDown = true;
  assert.strictEqual(input.katanaTurn(500), 0);
});

test('shortcuts preserve form input, modifiers, composition, repeated toggles, and native Space activation', () => {
  const { scene, authoring, bind, press } = fixture();
  bind();
  for (const properties of [
    { target: { tagName: 'SELECT' } },
    { target: { tagName: 'INPUT' } },
    { target: { isContentEditable: true } },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { isComposing: true },
    { defaultPrevented: true },
    { repeat: true },
  ])
    press('KeyA', properties);
  assert.equal(scene.face.mock.calls.length, 0);
  press('KeyA');
  assert.deepEqual(scene.face.mock.lastCall, ['left']);
  const nativeSpace = press('Space', { target: { closest: () => ({}) } });
  assert.isFalse(nativeSpace.defaultPrevented);
  assert.equal(scene.togglePlayback.mock.calls.length, 0);
  assert.isTrue(press('Space').defaultPrevented);
  assert.equal(scene.togglePlayback.mock.calls.length, 1);
  authoring.active = true;
  press('ArrowRight', { target: { tagName: 'SELECT' } });
  press('ArrowRight', { ctrlKey: true });
  assert.equal(scene.adjustSelected.mock.calls.length, 0);
  press('ArrowRight', { altKey: true, shiftKey: true, repeat: true });
  assert.deepEqual(scene.adjustSelected.mock.lastCall, ['x', 5]);
});

test('held rotation does not capture keys or rotate while typing or using browser modifiers', () => {
  const { keys, keyboard, bind, document } = fixture();
  const input = bind();
  assert.deepEqual(keyboard.addKey.mock.calls, [
    ['Q', false],
    ['E', false],
  ]);
  keys.Q.isDown = true;
  document.activeElement = { tagName: 'SELECT' };
  assert.equal(input.katanaTurn(1000), 0);
  document.activeElement = null;
  keys.Q.ctrlKey = true;
  assert.equal(input.katanaTurn(1000), 0);
  keys.Q.ctrlKey = false;
  assert.equal(input.katanaTurn(1000), -1);
});

test('shutdown removes demo listeners and rebinding triggers each control only once', () => {
  const { scene, keyboard, bind, press } = fixture();
  const unrelated = vi.fn();
  keyboard.on('keydown-ONE', unrelated);
  bind();
  scene.events.emit('shutdown');
  press('Digit1');
  assert.strictEqual(scene.play.mock.calls.length, 0);
  keyboard.emit('keydown-ONE');
  assert.strictEqual(unrelated.mock.calls.length, 1);
  bind();
  press('Digit1');
  assert.strictEqual(scene.play.mock.calls.length, 1);
  scene.events.emit('shutdown');
  const onPointer = vi.fn();
  scene.input.on('pointermove', onPointer);
  scene.input.emit('pointermove', { worldX: 0, worldY: 0 });
  assert.strictEqual(onPointer.mock.calls.length, 1);
});

test('pointer input works when keyboard support is disabled', () => {
  const { scene, presentation, bind } = fixture();
  scene.input.keyboard = undefined;
  const input = bind();
  scene.input.emit('pointermove', { worldX: 10, worldY: 20 });
  assert.deepEqual(presentation.handTarget, { x: 10, y: 20 });
  assert.strictEqual(input.katanaTurn(500), 0);
});

test('buttons retain their actions when keyboard shortcuts switch to pose editing', () => {
  const { scene, authoring, bind, press } = fixture();
  const commands = createDemoCommands(scene as unknown as DemoScene);
  bind();
  authoring.active = true;
  commands.slower!.run();
  commands.faster!.run();
  commands.restart!.run();
  assert.deepEqual(scene.adjustSpeed.mock.calls, [[-0.25], [0.25]]);
  assert.equal(scene.restart.mock.calls.length, 1);
  assert.equal(scene.selectBone.mock.calls.length, 0);
  press('BracketLeft');
  press('BracketRight');
  press('KeyR');
  assert.deepEqual(scene.selectBone.mock.calls, [[-1], [1]]);
  assert.equal(scene.adjustSpeed.mock.calls.length, 2);
  assert.equal(scene.resetBind.mock.calls.length, 1);
});

test('every demo button resolves a command and keyboard shortcuts have one binding each', () => {
  const { scene } = fixture();
  const commands = createDemoCommands(scene as unknown as DemoScene);
  const markup = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const buttons = [...markup.matchAll(/<button[^>]*data-action="([^"]+)"/g)];
  assert.isAbove(buttons.length, 0);
  for (const [, action] of buttons) assert.isFunction(commands[action!]!.run, `Missing command for ${action}`);
  const keys = Object.values(commands).flatMap((command) => (command.code ? [command.code] : []));
  assert.equal(new Set(keys).size, keys.length);
});
