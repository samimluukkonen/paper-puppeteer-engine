import { assert, expect, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { AnimationPreviewPreferencesBinding } from '../src/devtools/animation-editor/AnimationPreviewPreferences.js';
import { createNewCharacter } from '../src/devtools/animation-editor/characterDocuments.js';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import { MotionPreviewController } from '../src/devtools/animation-editor/MotionPreviewController.js';
import { buildCharacterDraft } from '../src/devtools/project/editorDrafts.js';
import { parseProjectDefinition } from '../src/devtools/project/ProjectDefinition.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { animationPreviewPreferencesSchema } from '../src/devtools/shared/animationPreviewPreferences.js';
import { GroundGuideWorkspace } from '../src/devtools/shared/GroundGuideWorkspace.js';
import { buildCharacterPackage, type PackageSnapshot } from '../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

function fixture() {
  const character = createNewCharacter({ id: 'hero', name: 'Hero' });
  const state = new AnimationEditorState(
    character.rig.rig,
    ['cut', 'jump', 'idle'].map((name) => ({
      name,
      duration: 1000,
      loop: true,
      tracks: {},
    })),
  );
  state.selectAnimation('cut');
  const motion = new MotionPreviewController();
  motion.bind(state);
  const environment = new EnvironmentPreviewController();
  const ground = new GroundGuideWorkspace('animation-preview-world', () => ({
    getItem: () => null,
    setItem: () => {},
  }));
  ground.bind('hero');
  const changed = vi.fn();
  const binding = new AnimationPreviewPreferencesBinding(environment, motion, ground, undefined, changed);
  const packageSnapshot = (): PackageSnapshot => ({
    definition: character.definition,
    rig: character.definition.rigFile!,
    skins: character.definition.standaloneSkins,
    animations: state.packageAnimations(),
    replacements: [],
  });
  const configure = () => {
    const image = artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>;
    environment.images.register('../images/floor.png', image, 'Floor');
    environment.update({ enabled: true, image: '../images/floor.png', x: 380, y: 435, scale: 2 });
    environment.updateCamera({ mode: 'follow', x: 400, y: 410, zoom: 0.75 });
    ground.update({ enabled: true, y: 450 });
    motion.update({
      enabled: true,
      positionKeys: [
        { time: 0, offsetX: 0, offsetY: 0 },
        { time: 500, offsetX: 45, offsetY: -80 },
      ],
    });
    state.setPreviewLoop(true);
  };
  const dispose = () => {
    binding.dispose();
    motion.dispose();
    environment.dispose();
  };
  return { character, state, motion, environment, ground, changed, binding, configure, packageSnapshot, dispose };
}

test('shared settings and per-clip motion/loop survive project ZIPs with identical production character packages', async () => {
  const f = fixture();
  try {
    const before = await buildCharacterPackage(f.packageSnapshot());
    const original = f.state.workingAnimation;
    const history = f.state.historyLength;
    f.configure();
    const cut = f.motion.getSnapshot().settings;
    f.state.selectAnimation('jump');
    assert.isFalse(f.motion.getSnapshot().settings.enabled);
    assert.isFalse(f.state.previewLoop);
    f.motion.update({
      enabled: true,
      interpolation: 'stepped',
      positionKeys: [{ time: 0, offsetX: -80, offsetY: -100 }],
    });
    f.state.selectAnimation('idle');
    assert.isFalse(f.motion.getSnapshot().settings.enabled);
    assert.isFalse(f.state.previewLoop);
    f.state.selectAnimation('cut');
    assert.deepEqual(f.motion.getSnapshot().settings, cut);
    assert.isTrue(f.state.previewLoop);
    assert.strictEqual(f.state.workingAnimation, original);
    assert.equal(f.state.historyLength, history);
    assert.deepEqual(await buildCharacterPackage(f.packageSnapshot()), before);
    const project = new ProjectWorkspace('Film');
    await project.addCharacter(before);
    project.scenes.images.register('../images/floor.png', f.environment.images.read('../images/floor.png'));
    const metadataHistory = project.history.canUndo;
    project.setAnimationPreviewPreferences('hero', f.binding.preferences);
    assert.equal(project.history.canUndo, metadataHistory);
    const archive = await buildProjectPackage(project);
    project.markExported(archive.metadata, archive.characters, archive.scenes);
    assert.isFalse(project.hasUnsavedChanges);
    const restored = await importProjectPackage(decodePackageZip(encodePackageZip(archive.files)));
    assert.deepEqual(restored.animationPreviewPreferences('hero'), f.binding.preferences);
    assert.deepEqual(
      restored.scenes.images.read('../images/floor.png'),
      f.environment.images.read('../images/floor.png'),
    );
    assert.deepEqual(restored.captureCharacter('hero').animations, project.captureCharacter('hero').animations);
    assert.isEmpty(restored.definition.scenes);
    project.rename('Renamed');
    project.undo();
    assert.deepEqual(project.animationPreviewPreferences('hero'), f.binding.preferences);
    const revision = project.autosaveRevision;
    project.setAnimationPreviewPreferences('hero', {
      ...f.binding.preferences,
      camera: { ...f.binding.preferences.camera, mode: 'fixed' },
    });
    assert.notEqual(project.autosaveRevision, revision);
    assert.isTrue(project.dirty);
    assert.isFalse(project.characterDirty('hero'));
  } finally {
    f.dispose();
  }
});

test('standalone local draft capture includes preview-only edits and detached image bytes for project recovery', async () => {
  const f = fixture();
  try {
    assert.isFalse(f.binding.dirty);
    f.configure();
    assert.isTrue(f.binding.dirty);
    const saved = f.binding.preferences;
    const pending = buildCharacterDraft(f.packageSnapshot(), 'draft-project', undefined, {
      preferences: saved,
      images: f.environment.images,
    });
    f.environment.clear();
    f.motion.reset();
    const restored = await importProjectPackage(await pending);
    assert.deepEqual(restored.animationPreviewPreferences('hero'), saved);
    assert.isTrue(restored.scenes.images.has('../images/floor.png'));
    const other = fixture();
    try {
      const binding = new AnimationPreviewPreferencesBinding(
        other.environment,
        other.motion,
        other.ground,
        restored.animationPreviewPreferences('hero'),
        other.changed,
      );
      assert.deepEqual(binding.preferences, saved);
      assert.isTrue(other.state.previewLoop);
      assert.isFalse(other.ground.getSnapshot().canUndo);
      binding.dispose();
    } finally {
      other.dispose();
    }
  } finally {
    f.dispose();
  }
});

test('playback and repeated seeks cause no preference writes; teardown releases all subscriptions', () => {
  const f = fixture();
  try {
    f.configure();
    f.changed.mockClear();
    const animation = f.state.workingAnimation;
    const history = f.state.historyLength;
    f.state.play();
    for (let index = 0; index < 100; index++) f.state.advancePlayback(0.01);
    f.state.pause();
    for (const time of [0.5, 0, 0.8, 0.2, 0.5]) f.state.setCurrentTime(time);
    assert.equal(f.changed.mock.calls.length, 0);
    assert.strictEqual(f.state.workingAnimation, animation);
    assert.equal(f.state.historyLength, history);
    f.binding.dispose();
    f.environment.update({ x: 120 });
    f.motion.reset();
    f.ground.update({ y: 500 });
    assert.equal(f.changed.mock.calls.length, 0);
  } finally {
    f.dispose();
  }
});

test('project image cleanup retains preview references, and clearing configuration preserves shared assets', async () => {
  const f = fixture();
  try {
    f.configure();
    const project = new ProjectWorkspace('Film');
    await project.addCharacter(await buildCharacterPackage(f.packageSnapshot()));
    project.scenes.images.register('../images/floor.png', f.environment.images.read('../images/floor.png'));
    project.setAnimationPreviewPreferences('hero', f.binding.preferences);
    assert.equal(project.scenes.cleanupImages(), 0);
    f.environment.clear();
    project.setAnimationPreviewPreferences('hero', f.binding.preferences);
    assert.isTrue(project.scenes.images.has('../images/floor.png'));
    assert.isTrue(
      (await importProjectPackage((await buildProjectPackage(project)).files)).scenes.images.has('../images/floor.png'),
    );
  } finally {
    f.dispose();
  }
});

test('a missing optional background resource preserves character animations and repairable preferences', async () => {
  const f = fixture();
  try {
    f.configure();
    const project = new ProjectWorkspace('Film');
    await project.addCharacter(await buildCharacterPackage(f.packageSnapshot()));
    project.scenes.images.register('../images/floor.png', f.environment.images.read('../images/floor.png'));
    project.setAnimationPreviewPreferences('hero', f.binding.preferences);
    const archive = await buildProjectPackage(project);
    const files = new Map(archive.files);
    files.delete('images/floor.png');
    const restored = await importProjectPackage(files);
    assert.isFalse(restored.scenes.images.has('../images/floor.png'));
    assert.equal(restored.animationPreviewPreferences('hero')?.environment.image, '../images/floor.png');
    assert.deepEqual(restored.captureCharacter('hero').animations, project.captureCharacter('hero').animations);
    // Missing references remain portable and can be replaced later without requiring the old bytes.
    await buildProjectPackage(restored);
  } finally {
    f.dispose();
  }
});

test('preview schema rejects transient URLs and invalid trajectories while legacy projects need no preferences', () => {
  const f = fixture();
  try {
    const preferences = f.binding.preferences;
    for (const image of ['blob:temporary', 'data:image/png;base64,abc', 'https://example.test/floor.png'])
      assert.isFalse(
        animationPreviewPreferencesSchema.safeParse({
          ...preferences,
          environment: { ...preferences.environment, image },
        }).success,
      );
    for (const positionKeys of [
      [
        { time: 0, offsetX: 0, offsetY: 0 },
        { time: 0, offsetX: 5, offsetY: 0 },
      ],
      [{ time: -1, offsetX: 0, offsetY: 0 }],
      [{ time: 0, offsetX: Infinity, offsetY: 0 }],
    ])
      assert.isFalse(
        animationPreviewPreferencesSchema.safeParse({
          ...preferences,
          animations: {
            cut: {
              loop: false,
              motion: { ...f.motion.getSnapshot().settings, positionKeys },
            },
          },
        }).success,
      );
    // Animation IDs follow the runtime identifier contract, including long imported names.
    assert.isTrue(
      animationPreviewPreferencesSchema.safeParse({
        ...preferences,
        animations: {
          ['cut'.repeat(100)]: { loop: false, motion: f.motion.getSnapshot().settings },
        },
      }).success,
    );
    const unchanged = f.motion.getSnapshot().settings;
    assert.isFalse(
      f.motion.update({
        positionKeys: Array.from({ length: 10001 }, (_, time) => ({
          time,
          offsetX: 0,
          offsetY: 0,
        })),
      }),
    );
    assert.strictEqual(f.motion.getSnapshot().settings, unchanged);
    expect(
      parseProjectDefinition({ version: 1, id: 'legacy', name: 'Legacy', characters: [], scenes: [] })
        .editorPreferences,
    ).toBeUndefined();
  } finally {
    f.dispose();
  }
});

test('exclusive modes and root loop behavior survive clip switches and metadata restoration, including legacy preferences', () => {
  const f = fixture();
  try {
    const original = f.state.workingAnimation;
    f.state.setWorldDisplacementView('none', 'continuous');
    const saved = animationPreviewPreferencesSchema.parse(f.binding.preferences);
    f.state.selectAnimation('jump');
    assert.equal(f.state.worldDisplacementMode, 'authored');
    assert.equal(f.state.rootLoopMode, 'reset');
    f.state.selectAnimation('cut');
    assert.equal(f.state.worldDisplacementMode, 'none');
    assert.equal(f.state.rootLoopMode, 'continuous');
    f.motion.restorePreferences(saved.animations);
    assert.equal(f.state.worldDisplacementMode, 'none');
    assert.equal(f.state.rootLoopMode, 'continuous');
    f.motion.restorePreferences({
      cut: {
        loop: true,
        motion: {
          enabled: true,
          positionKeys: [{ time: 0, offsetX: 50, offsetY: -10 }],
          interpolation: 'linear',
          showTrajectory: true,
        },
      },
    });
    assert.equal(
      f.state.worldDisplacementMode,
      'preview',
      'legacy enabled trajectories never add authored root travel',
    );
    assert.equal(f.state.rootLoopMode, 'reset');
    assert.isTrue(f.state.previewLoop);
    const capture = f.motion.capturePreferences();
    f.state.play();
    f.state.advancePlayback(3.5);
    assert.deepEqual(f.motion.capturePreferences(), capture, 'frame-clock updates do not edit saved preferences');
    assert.strictEqual(f.state.workingAnimation, original);
    assert.equal(f.state.historyLength, 0);
  } finally {
    f.dispose();
  }
});
