import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { DemoInput } from '../src/demo/DemoInput.js';
import type { DemoPoseAuthoring } from '../src/demo/DemoPoseAuthoring.js';
import type { DemoPresenter } from '../src/demo/DemoPresenter.js';
import type { DemoScene } from '../src/demo/DemoScene.js';

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

function fixture() {
  const keys = { Q: { isDown: false }, E: { isDown: false } };
  const keyboard = {
    ...emitter(),
    addCapture: vi.fn(),
    addKey: (key: keyof typeof keys) => keys[key],
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
  };
  const authoring = { active: false };
  const presentation = { handTarget: { x: 0, y: 0 } };
  const bind = () =>
    new DemoInput(scene as unknown as DemoScene, authoring as DemoPoseAuthoring, presentation as DemoPresenter);
  return { scene, authoring, presentation, keys, keyboard, bind };
}

test('input uses world coordinates, changes bracket/R actions with pose mode, and reads held Q/E keys', () => {
  const { scene, authoring, presentation, keys, keyboard, bind } = fixture();
  const input = bind();
  scene.input.emit('pointermove', { worldX: 123, worldY: 456 } as Phaser.Input.Pointer);
  assert.deepEqual(presentation.handTarget, { x: 123, y: 456 });
  keyboard.emit('keydown-ONE');
  assert.deepEqual(scene.play.mock.lastCall, ['idle']);
  keyboard.emit('keydown-OPEN_BRACKET');
  assert.deepEqual(scene.adjustSpeed.mock.lastCall, [-0.25]);
  keyboard.emit('keydown-R');
  assert.strictEqual(scene.restart.mock.calls.length, 1);

  authoring.active = true;
  keyboard.emit('keydown-CLOSED_BRACKET');
  assert.deepEqual(scene.selectBone.mock.lastCall, [1]);
  keyboard.emit('keydown-R');
  assert.strictEqual(scene.resetBind.mock.calls.length, 1);
  const event = { key: 'ArrowRight', shiftKey: true, altKey: true, preventDefault: vi.fn() };
  keyboard.emit('keydown', event);
  assert.deepEqual(scene.adjustSelected.mock.lastCall, ['x', 5]);
  assert.strictEqual(event.preventDefault.mock.calls.length, 1);
  keys.Q.isDown = true;
  assert.strictEqual(input.katanaTurn(500), -0.5);
  keys.E.isDown = true;
  assert.strictEqual(input.katanaTurn(500), 0);
});

test('shutdown removes demo listeners and rebinding triggers each control only once', () => {
  const { scene, keyboard, bind } = fixture();
  const unrelated = vi.fn();
  keyboard.on('keydown-ONE', unrelated);
  bind();
  scene.events.emit('shutdown');
  keyboard.emit('keydown-ONE');
  assert.strictEqual(scene.play.mock.calls.length, 0);
  assert.strictEqual(unrelated.mock.calls.length, 1);
  bind();
  keyboard.emit('keydown-ONE');
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
