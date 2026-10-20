import Phaser from 'phaser';
import { Profiler } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SceneCharacterRegistry } from '../../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../../src/devtools/scene-editor/SceneEditorPlayback.js';
import { SceneTimeline } from '../../src/devtools/scene-editor/SceneTimeline.js';
import { Actor } from '../../src/engine/Actor.js';
import { CharacterLoader } from '../../src/engine/CharacterLoader.js';
import { loadSceneCharacter } from '../../src/engine/loadSceneCharacter.js';
import { Puppet } from '../../src/engine/Puppet.js';
import type { SceneDefinition } from '../../src/engine/SceneDefinition.js';
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
      let created = 0;
      let disposed = 0;
      playback.sync(doc.workingScene, true, (data, depth) => {
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
      });
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
        const start = performance.now();
        for (let frame = 0; frame < 60; frame++) flushSync(() => playback.update(1000 / 60));
        const framesMs = performance.now() - start;
        const seeks = [];
        for (const time of [7500, 1000, 5000, 0, 9500]) {
          const start = performance.now();
          flushSync(() => playback.seek(time));
          seeks.push(performance.now() - start);
        }
        results.push({
          actors,
          actions: data.actions.length,
          bones: definition.rig.bones.length,
          ik: definition.rig.ik?.length ?? 0,
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
        playback.dispose();
        registry.dispose();
      }
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
