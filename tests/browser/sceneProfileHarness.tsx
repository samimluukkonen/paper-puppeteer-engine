import Phaser from 'phaser';
import { Profiler } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SceneCharacterRegistry } from '../../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../../src/devtools/scene-editor/SceneEditorPlayback.js';
import { SceneTimeline } from '../../src/devtools/scene-editor/SceneTimeline.js';
import { Actor } from '../../src/engine/Actor.js';
import { evaluateCameraAtTime } from '../../src/engine/cameraAnimation.js';
import { CharacterLoader } from '../../src/engine/CharacterLoader.js';
import { CharacterTextureBudget } from '../../src/engine/characterTextureLimits.js';
import { applyCinematicCamera } from '../../src/engine/cinematicCamera.js';
import { loadSceneCharacter } from '../../src/engine/loadSceneCharacter.js';
import { encodePackageZip } from '../../src/engine/packageZip.js';
import { Puppet } from '../../src/engine/Puppet.js';
import type { SceneDefinition } from '../../src/engine/SceneDefinition.js';
import { SceneImageLayer } from '../../src/engine/SceneImageLayer.js';
import { buildScenePackage } from '../../src/engine/ScenePackage.js';
import type { SceneRunnerOptions } from '../../src/engine/SceneRunner.js';
import '../../src/devtools/scene-editor/style.css';

/** Development-only local diagnostic. Real Phaser objects/artwork; host clocks are advanced explicitly. */
export async function profileScene() {
  console.info('scene-profile: boot');
  const host = document.createElement('div');
  const timeline = document.createElement('div');
  host.style.cssText = 'width:1000px;height:700px';
  timeline.style.cssText = 'width:1400px;height:350px';
  document.body.append(host, timeline);
  const stage = new Phaser.Scene('SceneProfile');
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 1000,
    height: 700,
    audio: { noAudio: true },
    scene: [stage],
  });
  const boot = performance.now();
  while (!stage?.sys.isActive()) {
    if (performance.now() - boot > 15000) throw new Error('Profile Phaser scene did not boot.');
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const manifest = '../characters/demo-puppet/character.json';
  const definition = await CharacterLoader.load(new URL(manifest, location.href).href);
  console.info('scene-profile: metadata loaded');
  await loadSceneCharacter(stage, manifest, { definition });
  console.info('scene-profile: artwork loaded');
  const surface = new OffscreenCanvas(2048, 1024);
  const drawing = surface.getContext('2d')!;
  drawing.fillStyle = '#337755';
  drawing.fillRect(0, 0, surface.width, surface.height);
  const png = new Uint8Array(await (await surface.convertToBlob()).arrayBuffer());
  // Reuse a live-allocation budget across workloads to catch retired artwork charges.
  const artworkBudget = new CharacterTextureBudget({ maxTotalImagePixels: surface.width * surface.height * 3 });
  const root = createRoot(timeline);
  const source = JSON.stringify(definition);
  const shutdownListeners = stage.events.listenerCount('shutdown');
  const results = [];
  try {
    for (const [actors, markers] of [
      [2, 0],
      [5, 0],
      [5, 500],
    ] as const) {
      console.info(`scene-profile: ${actors} Actors, ${markers} markers`);
      const doc = new SceneEditorDocument();
      const playback = new SceneEditorPlayback();
      const registry = new SceneCharacterRegistry(async () => definition);
      await registry.load(manifest);
      const data: SceneDefinition = {
        version: 2,
        id: 'profile',
        name: 'Profile',
        duration: 10000,
        actors: Array.from({ length: actors }, (_, i) => ({
          id: `actor-${i}`,
          character: { manifest },
          position: { x: i * 100, y: 0 },
          animation: 'idle',
        })),
        actions: Array.from({ length: actors }, (_, i) => [
          {
            id: `clip-${i}`,
            actorId: `actor-${i}`,
            type: 'animation' as const,
            time: 0,
            duration: 10000,
            animation: 'walk',
            loop: true,
            speed: 1,
          },
          {
            id: `move-${i}`,
            actorId: `actor-${i}`,
            type: 'move' as const,
            time: 0,
            duration: 10000,
            destination: { x: i * 100 + 100, y: 40 },
          },
        ]).flat(),
      };
      for (let i = 0; i < markers; i++)
        data.actions.push({
          id: `cue-${i}`,
          actorId: `actor-${i % actors}`,
          type: 'cue',
          time: i * 4,
          name: 'profile',
        });
      doc.importJson(JSON.stringify(data));
      data.layers = [
        { id: 'background', name: 'Sky', visible: true, parallax: 0 },
        { id: 'mountains', name: 'Mountains', visible: true, parallax: 0.2 },
        { id: 'actors', name: 'Actors', visible: true, parallax: 1 },
        { id: 'foreground', name: 'Trees', visible: true, parallax: 1.2 },
      ];
      data.images = ['background', 'mountains', 'foreground'].map((layerId, i) => ({
        id: `image-${i}`,
        image: `images/image-${i}.png`,
        layerId,
        position: { x: i * 50, y: 0 },
        scale: { x: 1, y: 1 },
        visible: true,
        order: 0,
      }));
      data.cameraTracks = {
        x: [
          { id: 'x-start', time: 0, value: 0 },
          { id: 'x-end', time: 10000, value: 300 },
        ],
        zoom: [
          { id: 'z-start', time: 0, value: 1 },
          { id: 'z-end', time: 10000, value: 2 },
        ],
      };
      doc.importJson(JSON.stringify(data));
      const textureBaseline = Object.keys(stage.textures.list).length;
      const artwork = new SceneImageLayer(
        stage,
        () => Promise.resolve(png),
        () => {},
        artworkBudget,
      );
      artwork.sync(data.images, data.layers);
      await artwork.ready();
      let depthSortRequests = 0;
      const queueDepthSort = stage.children.queueDepthSort.bind(stage.children);
      stage.children.queueDepthSort = () => {
        depthSortRequests++;
        queueDepthSort();
      };
      const syncCamera = () => {
        const camera = evaluateCameraAtTime(doc.workingScene!, playback.time);
        applyCinematicCamera(stage.cameras.main, camera, { x: 0, y: 0, width: 1000, height: 700 });
        artwork.sync(doc.workingScene!.images, doc.workingScene!.layers, camera);
      };
      let created = 0;
      let disposed = 0;
      const createActor: SceneRunnerOptions['createActor'] = (data, depth) => {
        const puppet = new Puppet(stage, {
          definition,
          autoUpdate: false,
          depth,
          ik: (definition.rig.ik ?? []).map((ik) => ({ ...ik, enabled: true, target: { x: 60, y: 80 } })),
        });
        const actor = new Actor({ id: data.id, puppet, puppetOwnership: 'owned' });
        created++;
        actor.disposalSignal.addEventListener('abort', () => disposed++, { once: true });
        return actor;
      };
      playback.sync(doc.workingScene, true, createActor);
      const releaseDocument = doc.subscribe(() => playback.sync(doc.workingScene, true, createActor));
      let commits = 0;
      let renderMs = 0;
      const uiSource = (
        <Profiler
          id="timeline"
          onRender={(_id, _phase, duration) => {
            commits++;
            renderMs += duration;
          }}
        >
          <SceneTimeline scene={doc.workingScene!} document={doc} registry={registry} playback={playback} />
        </Profiler>
      );
      try {
        flushSync(() => root.render(uiSource));
        flushSync(() => playback.play());
        commits = 0;
        renderMs = 0;
        const trackObserver = new MutationObserver(() => {});
        for (const row of timeline.querySelectorAll('.scene-track-row'))
          trackObserver.observe(row, { subtree: true, childList: true, attributes: true, characterData: true });
        const start = performance.now();
        depthSortRequests = 0;
        for (let frame = 0; frame < 60; frame++) {
          flushSync(() => playback.update(1000 / 60));
          syncCamera();
        }
        const frameDepthSortRequests = depthSortRequests;
        const framesMs = performance.now() - start;
        const frameTrackMutations = trackObserver.takeRecords().length;
        trackObserver.disconnect();
        if (frameTrackMutations) throw new Error('Clock updates mutated authored timeline rows.');
        const seeks = [];
        for (const time of [7500, 1000, 5000, 0, 9500]) {
          const start = performance.now();
          flushSync(() => playback.seek(time));
          syncCamera();
          seeks.push(performance.now() - start);
        }
        const editsStart = performance.now();
        for (let i = 0; i < 60; i++) {
          flushSync(() => {
            doc.setCameraKey(i * 100, { x: i * 5, y: 0, zoom: 1 + i / 100 });
            root.render(
              <SceneTimeline scene={doc.workingScene!} document={doc} registry={registry} playback={playback} />,
            );
          });
          syncCamera();
        }
        const cameraEditsMs = performance.now() - editsStart;
        const exportStart = performance.now();
        const archive = encodePackageZip(
          await buildScenePackage(doc.workingScene!, {
            baseUrl: location.href,
            loadImage: () => Promise.resolve(png),
          }),
        );
        const exportMs = performance.now() - exportStart;
        results.push({
          actors,
          actions: data.actions.length,
          bones: definition.rig.bones.length,
          ik: definition.rig.ik?.length ?? 0,
          imageDimensions: '2048 × 1024',
          imageTextures: 3,
          cameraEdits: 60,
          cameraEditsMs,
          exportMs,
          zipBytes: archive.byteLength,
          frameDepthSortRequests,
          frameTrackMutations,
          frames: 60,
          framesMs,
          commits,
          renderMs,
          seeksMs: seeks,
          created,
          disposedBeforeCleanup: disposed,
        });
      } finally {
        flushSync(() => root.render(null));
        releaseDocument();
        playback.dispose();
        registry.dispose();
        artwork.dispose();
        stage.children.queueDepthSort = queueDepthSort;
      }
      if (Object.keys(stage.textures.list).length !== textureBaseline)
        throw new Error('Profile leaked artwork textures.');
      if (created !== disposed) throw new Error(`Leaked Actors: created ${created}, disposed ${disposed}`);
      if (stage.children.list.length || stage.events.listenerCount('shutdown') !== shutdownListeners)
        throw new Error('Profile leaked GameObjects or shutdown listeners.');
      if (JSON.stringify(definition) !== source) throw new Error('Profile changed source character data.');
      console.info('scene-profile: workload complete');
    }
    return results;
  } finally {
    root.unmount();
    game.destroy(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    host.remove();
    timeline.remove();
  }
}
