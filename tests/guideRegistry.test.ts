import { assert, test } from 'vitest';
import {
  getAllGuides,
  getGuideAvailability,
  getGuideById,
  getGuidesForEditor,
  GuideRegistry,
  guideRegistry,
  type GuideContext,
  type GuideDefinition,
} from '../src/devtools/shared/guides/index.js';

const context: GuideContext = { editor: 'rig', capabilities: ['character', 'valid-rig'] };
const example = (): GuideDefinition => structuredClone(getGuideById('rig-joint-editing')!);

test('central registry has unique feature IDs, editor categories, and stable ordered steps', () => {
  const all = getAllGuides();
  assert.equal(new Set(all.map(({ id }) => id)).size, all.length);
  assert.deepEqual(
    getGuidesForEditor('rig').map(({ id }) => id),
    [
      'rig-new-character',
      'rig-creating-bones',
      'rig-joint-editing',
      'rig-importing-artwork',
      'rig-aligning-sprites',
      'rig-slots-attachments',
      'rig-skins',
      'rig-ik-constraints',
      'rig-exporting',
    ],
  );
  assert.deepEqual(
    getGuidesForEditor('animation').map(({ id }) => id),
    [
      'animation-new',
      'animation-first-keyframe',
      'animation-animate-bone',
      'animation-timeline-navigation',
      'animation-keyframe-editing',
      'animation-interpolation',
      'animation-onion-skinning',
      'animation-mirroring',
      'animation-ik-targets',
      'animation-ik-baking',
      'animation-events',
      'animation-rig-tweak',
      'animation-exporting',
    ],
  );
  const guide = getGuideById('rig-joint-editing')!;
  assert.strictEqual(guide, getGuidesForEditor('rig')[2]);
  assert.equal(guide.category, 'rigging');
  assert.deepEqual(
    guide.steps.map(({ id }) => id),
    ['hierarchy', 'tool', 'bind-pose', 'preview', 'joint-properties', 'history'],
  );
  assert.strictEqual(guideRegistry.getGuideStep(guide.id, 'joint-properties'), guide.steps[4]);
  assert.isUndefined(getGuideById('missing'));
  assert.isUndefined(guideRegistry.getGuideStep('missing', 'hierarchy'));
  assert.isUndefined(guideRegistry.getGuideStep(guide.id, 'missing'));
});

test('registry owns deeply immutable copies without freezing caller data', () => {
  const input = example();
  const registry = new GuideRegistry([input]);
  assert.isFalse(Object.isFrozen(input));
  Object.assign(input, { title: 'Changed', steps: [] });
  const guide = registry.getAllGuides()[0]!;
  assert.equal(guide.title, 'Editing Joint Positions');
  assert.lengthOf(guide.steps, 6);
  for (const value of [
    registry.getAllGuides(),
    registry.getGuidesForEditor('rig'),
    guide,
    guide.steps,
    guide.steps[0],
    guide.prerequisites?.[0],
  ]) {
    assert.isTrue(Object.isFrozen(value));
  }
});

test('invalid IDs, duplicate IDs, empty guides, and broken step targets reject at registration', () => {
  const guide = example();
  assert.throws(() => new GuideRegistry([guide, guide]), /duplicate guide ID/);
  assert.throws(() => new GuideRegistry([{ ...guide, id: ' ' }]), /guide ID/);
  assert.throws(() => new GuideRegistry([{ ...guide, steps: [] }]), /no steps/);
  assert.throws(
    () => new GuideRegistry([{ ...guide, steps: [guide.steps[0]!, guide.steps[0]!] }]),
    /duplicate step ID/,
  );
  assert.throws(() => new GuideRegistry([{ ...guide, steps: [{ ...guide.steps[0]!, id: '' }] }]), /step ID/);
  assert.throws(() => new GuideRegistry([{ ...guide, steps: [{ ...guide.steps[0]!, targetId: '' }] }]), /no target/);
  assert.deepEqual(new GuideRegistry([]).getAllGuides(), []);
});

test('availability reports missing character, rig, animation, IK, and tool requirements with reasons', () => {
  const rig = example();
  assert.deepEqual(getGuideAvailability(rig, { ...context, capabilities: [] }), {
    available: false,
    reason: 'Load or create a character first.',
  });
  assert.deepEqual(getGuideAvailability(rig, { ...context, capabilities: ['character'] }), {
    available: false,
    reason: 'A valid rig is needed to inspect joint positions.',
  });
  assert.deepEqual(getGuideAvailability(rig, context), { available: true });
  const animation = getGuideById('animation-timeline-navigation')!;
  assert.deepEqual(getGuideAvailability(animation, context), {
    available: false,
    reason: 'Create or select an animation first.',
  });
  const step = {
    ...rig.steps[0]!,
    prerequisites: [
      { capability: 'ik-constraints' as const, reason: 'Add an IK constraint first.' },
      { capability: 'tool:ik-panel' as const, reason: 'The IK panel is unavailable.' },
    ],
  };
  assert.deepEqual(getGuideAvailability(rig, context, step), {
    available: false,
    reason: 'Add an IK constraint first.',
  });
  assert.deepEqual(
    getGuideAvailability(rig, { ...context, capabilities: [...context.capabilities, 'ik-constraints'] }, step),
    {
      available: false,
      reason: 'The IK panel is unavailable.',
    },
  );
  assert.deepEqual(
    getGuideAvailability(
      rig,
      { ...context, capabilities: [...context.capabilities, 'ik-constraints', 'tool:ik-panel'] },
      step,
    ),
    { available: true },
  );
  // A future "create character" guide can omit prerequisites and work in an empty workspace.
  assert.deepEqual(getGuideAvailability({ ...rig, prerequisites: [] }, { ...context, capabilities: [] }), {
    available: true,
  });
});
