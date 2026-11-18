import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { EventInspectorController } from '../src/devtools/animation-editor/EventInspectorController.js';
import { Rig } from '../src/engine/Rig.js';
import { stubRigEditorDom } from './helpers/rigEditorDom.js';

afterEach(() => vi.unstubAllGlobals());

test('event field drafts commit once on blur; invalid JSON is retained for correction and disposal removes handlers', async () => {
  const query = stubRigEditorDom();
  const state = new AnimationEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }), [
    { name: 'move', duration: 1000, loop: false, tracks: {}, events: [{ time: 250, name: 'event' }] },
  ]);
  state.selectAnimation('move');
  state.events.selectAnimationEvent(state.events.eventTimelineTrack.markers[0]!.ref);
  const controller = new EventInspectorController(query('#editor-app') as unknown as HTMLElement, () => state);
  const unsubscribe = state.subscribe(() => controller.render(state));
  controller.render(state);
  const name = query('#animation-event-name');
  const data = query('#animation-event-data');
  name.value = 'edited';
  await name.dispatch('input');
  assert.equal(state.historyLength, 0);
  assert.equal(state.events.selectedEventData!.name, 'event');
  await name.dispatch('blur');
  await name.dispatch('blur');
  assert.equal(state.historyLength, 1);
  assert.equal(state.events.selectedEventData!.name, 'edited');
  data.value = '{invalid';
  await data.dispatch('blur');
  assert.equal(data.value, '{invalid');
  assert.equal(state.historyLength, 1);
  assert.include(query('#animation-event-error').textContent, 'valid JSON');
  data.value = '{"safe":[1,null]}';
  await data.dispatch('blur');
  assert.deepEqual(state.events.selectedEventData!.data, { safe: [1, null] });
  assert.equal(state.historyLength, 2);
  query('#animation-event-time').value = '';
  await query('#animation-event-time').dispatch('blur');
  assert.equal(state.events.selectedEventData!.time, 250);
  state.undo();
  assert.equal(data.value, '');
  state.redo();
  assert.include(data.value, 'safe');
  controller.dispose();
  name.value = 'after disposal';
  await name.dispatch('blur');
  assert.equal(state.events.selectedEventData!.name, 'edited');
  unsubscribe();
});
