import { afterEach, assert, test, vi } from 'vitest';
import { OnionSkinControlsController } from '../src/devtools/animation-editor/OnionSkinControlsController.js';
import {
  DEFAULT_ONION_SKIN_SETTINGS,
  type OnionSkinSettings,
  updateOnionSkinSettings,
} from '../src/devtools/animation-editor/onionSkinSettings.js';
import { stubRigEditorDom } from './helpers/rigEditorDom.js';

afterEach(() => vi.unstubAllGlobals());

test('native controls initialize preferences, update immediately, normalize values and release their listeners', async () => {
  const element = stubRigEditorDom();
  let settings = DEFAULT_ONION_SKIN_SETTINGS;
  const setOnionSkinSettings = vi.fn((patch: Partial<OnionSkinSettings>) => {
    settings = updateOnionSkinSettings(settings, patch);
  });
  const controller = new OnionSkinControlsController(document.querySelector('#editor-app')!, {
    getOnionSkinSettings: () => settings,
    setOnionSkinSettings,
  });
  const enable = element('#animation-onion-skinning');
  assert.isFalse(enable.checked);
  assert.equal(element('#animation-onion-previous-opacity').value, '0.22');
  assert.equal(element('#animation-onion-previous-color').value, '#65a9ed');
  assert.equal(setOnionSkinSettings.mock.calls.length, 0);
  enable.checked = true;
  await enable.dispatch('change');
  assert.isTrue(settings.enabled);
  for (const [id, value, key, expected] of [
    ['previous-count', '3', 'previousCount', 3],
    ['next-count', '0', 'nextCount', 0],
    ['spacing', '5', 'frameSpacing', 5],
    ['previous-opacity', '0.05', 'previousOpacity', 0.05],
    ['next-opacity', '0.6', 'nextOpacity', 0.6],
    ['previous-color', '#123456', 'previousTint', 0x123456],
    ['next-color', '#abcdef', 'nextTint', 0xabcdef],
    ['previous-count', '99', 'previousCount', 3],
  ] as const) {
    const input = element(`#animation-onion-${id}`);
    input.value = value;
    await input.dispatch('input');
    assert.equal(settings[key], expected);
  }
  const count = element('#animation-onion-previous-count');
  count.value = '';
  await count.dispatch('input');
  assert.equal(count.value, '', 'allow replacing a numeric value while typing');
  await count.dispatch('change');
  assert.equal(count.value, '3');
  const before = settings;
  element('#animation-onion-next-color').value = 'invalid';
  await element('#animation-onion-next-color').dispatch('input');
  assert.strictEqual(settings, before);
  controller.dispose();
  controller.dispose();
  setOnionSkinSettings.mockClear();
  count.value = '1';
  await count.dispatch('input');
  await enable.dispatch('change');
  assert.equal(setOnionSkinSettings.mock.calls.length, 0);
});
