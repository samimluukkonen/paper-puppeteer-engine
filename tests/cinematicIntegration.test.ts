import { assert, test } from 'vitest';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  importProjectPackage,
  packageHostedCharacter,
} from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { evaluateCameraAtTime } from '../src/engine/cameraAnimation.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { encodePackageZip, decodePackageZip } from '../src/engine/packageZip.js';
import { parallaxPosition } from '../src/engine/sceneLayers.js';
import { validateScenePackage } from '../src/engine/ScenePackage.js';
import { evaluateTransitionAtTime } from '../src/engine/sceneTransitions.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

test('complete cinematic project survives history, scene/project switching, recovery payload and portable export', async () => {
  const assets = artworkFixture();
  const character = await CharacterLoader.load(
    new URL('characters/hero/character.json', assets.baseUrl).href,
    assets.fetcher,
  );
  const project = new ProjectWorkspace('Cinematic film', 'cinematic-film');
  await project.addCharacter(await packageHostedCharacter(character, assets.fetcher));
  project.createScene({ id: 'opening', duration: 6000 });
  const doc = project.scenes;
  const png = assets.documents['images/paper.png'] as Uint8Array<ArrayBuffer>;
  const reference = await doc.images.add(png, 'background.png');
  for (let i = 0; i < 3; i++) assert.isTrue(doc.addImage(reference));
  assert.isTrue(doc.addLayer());
  assert.isTrue(doc.updateLayer('layer-1', { name: 'Mountains', parallax: 0.2 }));
  assert.isTrue(doc.assignImageLayer('image-2', 'layer-1'));
  assert.isTrue(doc.reorderLayer('layer-1', -1));
  assert.isTrue(doc.addLayer());
  assert.isTrue(doc.updateLayer('layer-2', { name: 'Foreground', parallax: 1.2 }));
  assert.isTrue(doc.assignImageLayer('image-3', 'layer-2'));
  for (let i = 0; i < 2; i++) assert.isTrue(doc.addActor(project.characterReference('hero'), { x: i * 100, y: 0 }));
  assert.isTrue(
    doc.addAction({ type: 'move', actorId: 'actor-1', time: 0, duration: 6000, destination: { x: 200, y: 30 } }),
  );
  assert.isTrue(
    doc.addAction({
      type: 'animation',
      actorId: 'actor-2',
      time: 0,
      duration: 6000,
      animation: 'wave',
      loop: true,
      speed: 1,
    }),
  );
  assert.isTrue(doc.setCameraKey(0, { x: 0, y: 0, zoom: 1 }));
  assert.isTrue(doc.setCameraKey(2000, { x: 100, y: 40, zoom: 1.5 }));
  assert.isTrue(doc.setCameraCut(3000, { x: -100, y: 20, zoom: 2 }));
  assert.isTrue(doc.addTransition({ time: 0, duration: 1000, type: 'fade-in', color: '#000000' }));
  const beforeFade = doc.workingScene;
  assert.isTrue(doc.addTransition({ time: 5000, duration: 1000, type: 'fade-out', color: '#123456' }));
  const authored = doc.workingScene;
  assert.isTrue(doc.undo());
  assert.deepEqual(doc.workingScene, beforeFade);
  assert.isTrue(doc.redo());
  assert.deepEqual(doc.workingScene, authored);
  const revision = project.autosaveRevision;
  project.createScene({ id: 'next' });
  assert.isTrue(doc.selectScene('opening'));
  assert.deepEqual(doc.workingScene, authored);
  const captured = await buildProjectPackage(project);
  // Autosave uses the same full binary package payload; local persistence is covered in browser tests.
  const recovered = await importProjectPackage(decodePackageZip(encodePackageZip(captured.files)));
  assert.deepEqual(recovered.scenes.scene('opening'), authored);
  assert.deepEqual(recovered.scenes.images.read(reference), png);
  assert.isTrue(project.autosaveRevision !== revision); // Added a retained scene.
  const otherProject = new ProjectWorkspace('Other project');
  otherProject.createScene({ id: 'other' });
  assert.isUndefined(otherProject.scenes.scene('opening'));
  assert.deepEqual(project.scenes.scene('opening'), authored);
  const portable = await validateScenePackage(
    await buildProjectScenePackage(recovered, recovered.scenes.scene('opening')!),
  );
  assert.equal(portable.images!.size, 1); // Three elements share one image binary.
  for (const field of ['layers', 'camera', 'cameraTracks', 'transitions', 'actions'] as const)
    assert.deepEqual(portable.definition[field], authored![field]);
  assert.deepEqual(
    portable.definition.actors.map((actor) => actor.id),
    ['actor-1', 'actor-2'],
  );
  assert.notMatch(new TextDecoder().decode(captured.files.get('project.json')), /blob:|file:|\/Users\//);
  for (const time of [6000, 1000, 2999.999, 3000, 3000.001, 5500, 0, 1000]) {
    const camera = evaluateCameraAtTime(authored!, time);
    assert.deepEqual(evaluateCameraAtTime(portable.definition, time), camera);
    assert.deepEqual(evaluateTransitionAtTime(portable.definition, time), evaluateTransitionAtTime(authored!, time));
    assert.deepEqual(parallaxPosition({ x: 10, y: 20 }, 0.2, camera), {
      x: 10 + 0.8 * camera.x,
      y: 20 + 0.8 * camera.y,
    });
  }
});
