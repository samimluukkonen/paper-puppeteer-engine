import {
  Actor,
  Choreography,
  type ChoreographyCoordinationResult,
  loadSceneCharacter,
  Puppet,
} from 'paper-puppeteer-engine/runtime';
import type Phaser from 'phaser';

export interface ScriptedSceneOptions {
  /** Two exported character manifests. The same package may supply distinct instances. */
  readonly urls: readonly [string, string];
  /** These defaults exist in public/character; replace them for other exports. */
  readonly animations?: Readonly<{ idle: string; walk: string; action: string; response: string }>;
}

export interface ScriptedScene {
  readonly actors: readonly [Actor, Actor];
  readonly choreography: Choreography;
  /** Single run; returns both Actors to idle, then disposes all owned resources on every exit. */
  run(): Promise<ChoreographyCoordinationResult>;
  /** Also safe before run, during a walk, after shutdown, or after completion. */
  dispose(): void;
}

/** Reusable desktop scene using only the public runtime. Phaser supplies the only clock. */
export async function createScriptedScene(
  scene: Phaser.Scene,
  options: ScriptedSceneOptions,
): Promise<ScriptedScene | undefined> {
  // Serial loads also support two instances sharing cached texture keys.
  const first = await loadSceneCharacter(scene, options.urls[0]);
  if (!first) return;
  const second = await loadSceneCharacter(scene, options.urls[1]);
  if (!second) return;
  const clips = options.animations ?? { idle: 'idle', walk: 'walk', action: 'attack', response: 'recover' };
  // Preflight before constructing any objects or starting visible playback.
  for (const [definition, names] of [
    [first, [clips.idle, clips.walk, clips.action]],
    [second, [clips.idle, clips.walk, clips.response]],
  ] as const)
    for (const name of names)
      if (!definition.animations.some((clip) => clip.name === name))
        throw new Error(`Scripted scene requires animation "${name}" on "${definition.id}".`);

  const puppets: Puppet[] = [];
  const actors: Actor[] = [];
  const choreography = new Choreography();
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    scene.events.off('shutdown', dispose);
    // Finish every cleanup even when a host notification throws.
    const errors: unknown[] = [];
    for (const release of [
      () => choreography.dispose(),
      ...actors.map((actor) => () => actor.dispose()),
      ...puppets.map((puppet) => () => puppet.destroy()),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Scripted scene cleanup failed.');
  };
  try {
    for (const [index, definition] of [first, second].entries()) {
      const puppet = new Puppet(scene, { definition, x: index === 0 ? 140 : 620, y: 380 });
      puppets.push(puppet); // Includes a Puppet whose Actor construction fails.
      const actor = new Actor({
        id: index === 0 ? 'a' : 'b',
        puppet,
        puppetOwnership: 'owned',
        locomotion: { walk: clips.walk, idle: clips.idle, fadeDuration: 120 },
        animationStates: { initialState: 'rest', states: { rest: { animation: clips.idle, loop: true } } },
      });
      actors.push(actor);
      choreography.register(actor);
    }
    const pair = Object.freeze([actors[0]!, actors[1]!] as const);
    const [a, b] = pair;
    const plan = choreography.sequence([
      choreography.parallel([
        choreography.actor(a.id, [{ kind: 'walk', x: 300, y: 380, options: { speed: 160, faceMovement: true } }]),
        choreography.actor(b.id, [{ kind: 'walk', x: 460, y: 380, options: { speed: 120, faceMovement: true } }]),
      ]),
      choreography.parallel([
        choreography.actor(a.id, [{ kind: 'lookAt', target: b }]),
        choreography.actor(b.id, [{ kind: 'lookAt', target: a }]),
      ]),
      choreography.actor(a.id, [{ kind: 'animation', name: clips.action, options: { fadeDuration: 120 } }]),
      choreography.actor(b.id, [{ kind: 'animation', name: clips.response, options: { fadeDuration: 120 } }]),
      choreography.parallel(
        pair.map((actor) =>
          choreography.actor(actor.id, [
            {
              kind: 'cue',
              callback: (current) => {
                current.setState('rest');
              },
            },
          ]),
        ),
      ),
      // Keep the final idle pose visible briefly; this wait follows the scene clock too.
      choreography.actor(a.id, [{ kind: 'wait', duration: 200 }]),
    ]);
    scene.events.once('shutdown', dispose);
    let pending: Promise<ChoreographyCoordinationResult> | undefined;
    return Object.freeze({
      actors: pair,
      choreography,
      run: () => {
        pending ??= choreography.run(plan).finally(dispose);
        return pending;
      },
      dispose,
    });
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Scripted scene setup and cleanup failed.', {
        cause: cleanupError,
      });
    }
    throw error;
  }
  // Loaded textures are shared, host-owned resources. Destroy the game or remove them only
  // after every user of those keys has finished; never remove them from an individual Actor.
}
