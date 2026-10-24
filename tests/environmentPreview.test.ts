import { afterEach, assert, test, vi } from 'vitest';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import { SceneImageRegistry } from '../src/devtools/scene-editor/SceneImageRegistry.js';
import {
  DEFAULT_ENVIRONMENT_PREVIEW,
  environmentPreviewImages,
  updateEnvironmentPreview,
} from '../src/devtools/shared/environmentPreview.js';
import { GroundGuideWorkspace } from '../src/devtools/shared/GroundGuideWorkspace.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

const bytes = () => new Uint8Array(artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('settings reject invalid transforms and adapt only visible enabled artwork to world coordinates', () => {
  const settings = updateEnvironmentPreview(DEFAULT_ENVIRONMENT_PREVIEW, {
    enabled: true,
    image: '../images/forest.png',
    x: -40,
    y: 435,
    scale: 2,
  });
  assert.deepEqual(updateEnvironmentPreview(settings, { x: NaN, y: Infinity, scale: 0 }), settings);
  assert.equal(updateEnvironmentPreview(settings, { scale: -2 }).scale, 2);
  assert.deepEqual(environmentPreviewImages(settings)[0]?.position, { x: -40, y: 435 });
  assert.deepEqual(environmentPreviewImages(settings)[0]?.scale, { x: 2, y: 2 });
  for (const patch of [{ enabled: false }, { visible: false }, { image: null }])
    assert.isEmpty(environmentPreviewImages(updateEnvironmentPreview(settings, patch)));
  assert.isFrozen(settings);
});

test('background selection, transforms, floor alignment and reset share binary assets and leave the ground unchanged', () => {
  const images = new SceneImageRegistry();
  images.register('../images/floor.png', bytes(), 'Floor');
  const controller = new EnvironmentPreviewController(images);
  const ground = new GroundGuideWorkspace('animation-preview-world', () => ({
    getItem: () => null,
    setItem: () => {},
  }));
  ground.bind('hero');
  ground.update({ enabled: true, y: 500 });
  const guide = ground.getSnapshot();
  controller.update({ enabled: true, image: '../images/floor.png', x: 380, scale: 4 });
  controller.alignBottom(guide.guide.y);
  assert.equal(controller.getSnapshot().settings.y, 498); // Fixture is one pixel tall.
  assert.strictEqual(ground.getSnapshot(), guide);
  controller.resetTransform();
  assert.equal(controller.getSnapshot().settings.x, 0);
  assert.equal(controller.getSnapshot().settings.scale, 1);
  controller.clear();
  assert.isNull(controller.getSnapshot().settings.image);
  assert.isTrue(images.has('../images/floor.png'));
  controller.reset();
  assert.deepEqual(controller.getSnapshot().settings, DEFAULT_ENVIRONMENT_PREVIEW);
  controller.dispose();
});

test('PNG import uses the existing guarded registry, deduplicates content and disposes decoding URLs', async () => {
  class Image {
    src = '';
    naturalWidth = 1;
    naturalHeight = 1;
    decode = () => Promise.resolve();
  }
  vi.stubGlobal('Image', Image);
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const images = new SceneImageRegistry();
  const controller = new EnvironmentPreviewController(images);
  await controller.import(new File([bytes()], 'floor.png', { type: 'image/png' }));
  const reference = controller.getSnapshot().settings.image!;
  assert.match(reference, /^\.\.\/images\/[0-9a-f]+\.png$/);
  assert.deepEqual(images.read(reference), bytes());
  assert.isFalse(controller.getSnapshot().busy);
  assert.equal(revoke.mock.calls.length, 1);
  await controller.import(new File([bytes()], 'same-floor.png', { type: 'image/png' }));
  assert.equal(images.entries.length, 1);
  assert.equal(controller.getSnapshot().settings.image, reference);
  await controller.import(new File(['bad'], 'bad.png', { type: 'image/png' }));
  assert.match(controller.getSnapshot().message, /not a valid PNG/);
  assert.equal(controller.getSnapshot().settings.image, reference);
  controller.dispose();
});

test.each(['clear', 'dispose'] as const)(
  '%s cancels a pending image import without installing late assets',
  async (action) => {
    const controller = new EnvironmentPreviewController();
    let finish!: (data: ArrayBuffer) => void;
    const file = new File([bytes()], 'floor.png', { type: 'image/png' });
    vi.spyOn(file, 'slice').mockReturnValue({
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    } as Blob);
    const pending = controller.import(file);
    controller[action]();
    finish(bytes().buffer);
    await pending;
    assert.isNull(controller.getSnapshot().settings.image);
    assert.isEmpty(controller.images.entries);
    controller.dispose();
  },
);

test('project character artwork enters the same registry and late project discovery cannot repopulate a disposed editor', async () => {
  const images = new SceneImageRegistry();
  const controller = new EnvironmentPreviewController(images);
  const choice = { id: 'hero:floor', name: 'Hero floor', bytes: bytes(), width: 1, height: 1 };
  await controller.loadProjectImages(() => Promise.resolve([choice]));
  assert.equal(images.entries.length, 0);
  assert.isNull(controller.getSnapshot().settings.image);
  await controller.selectProjectImage(choice.id);
  assert.equal(images.entries.length, 1);
  assert.isTrue(images.has(controller.getSnapshot().settings.image!));
  const notify = vi.fn();
  controller.subscribe(notify);
  let finish!: (choices: (typeof choice)[]) => void;
  const pending = controller.loadProjectImages(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  controller.dispose();
  const count = notify.mock.calls.length;
  finish([choice]);
  await pending;
  images.register('../images/another.png', bytes());
  assert.equal(notify.mock.calls.length, count);
});

test('disposing releases standalone binary ownership while preserving a shared project library', () => {
  const standalone = new EnvironmentPreviewController();
  standalone.images.register('../images/local.png', bytes());
  standalone.dispose();
  assert.isEmpty(standalone.images.entries);
  const project = new SceneImageRegistry();
  const controller = new EnvironmentPreviewController(project);
  project.register('../images/shared.png', bytes());
  controller.dispose();
  assert.isTrue(project.has('../images/shared.png'));
});
