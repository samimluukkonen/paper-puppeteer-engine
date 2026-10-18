import type Phaser from 'phaser';
import { Actor } from '../../engine/Actor.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { Puppet } from '../../engine/Puppet.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { SceneActorDefinition } from '../../engine/SceneDefinition.js';
import type { ReadonlyScene } from './SceneEditorDocument.js';

type ActorData = DeepReadonly<SceneActorDefinition>;
interface PreviewEntry {
  actor: Actor;
  data: ActorData;
}

/** Reconcile authored placement through the existing runtime. Each entry exclusively owns one Puppet. */
export class SceneActorPreview {
  readonly instances = new Map<string, PreviewEntry>();
  private sceneId: string | undefined;
  constructor(private readonly scene: Phaser.Scene) {}

  sync(document: ReadonlyScene, definitions: ReadonlyMap<string, CharacterDefinition>): void {
    if (this.sceneId !== document.id) this.dispose();
    this.sceneId = document.id;
    for (const [id, entry] of this.instances) {
      const data = document.actors.find((actor) => actor.id === id);
      if (!data || data.character.manifest !== entry.data.character.manifest) {
        entry.actor.dispose();
        this.instances.delete(id);
      }
    }
    const errors: string[] = [];
    document.actors.forEach((data, depth) => {
      try {
        const definition = definitions.get(data.character.manifest);
        if (!definition) return;
        if (data.animation !== undefined && !definition.animations.some((clip) => clip.name === data.animation))
          throw new Error(`Actor "${data.id}": unknown animation "${data.animation}".`);
        if (data.skin !== undefined && !definition.rig.skins.some((skin) => skin.name === data.skin))
          throw new Error(`Actor "${data.id}": unknown skin "${data.skin}".`);
        let entry = this.instances.get(data.id);
        if (!entry) {
          const puppet = new Puppet(this.scene, { definition, autoUpdate: false });
          try {
            entry = { actor: new Actor({ id: data.id, puppet, puppetOwnership: 'owned' }), data };
            this.instances.set(data.id, entry);
            this.appearance(entry.actor, data, definition);
          } catch (error) {
            puppet.destroy();
            this.instances.delete(data.id);
            throw error;
          }
        } else if (entry.data.skin !== data.skin || entry.data.animation !== data.animation) {
          this.appearance(entry.actor, data, definition);
        }
        entry.actor.setFacing(data.facing ?? 'right').setPosition(data.position.x, data.position.y);
        entry.actor.puppet.container.setDepth(depth);
        entry.data = data;
      } catch (error) {
        this.instances.get(data.id)?.actor.dispose();
        this.instances.delete(data.id);
        errors.push(error instanceof Error ? error.message : String(error));
      }
    });
    if (errors.length) throw new Error(errors.join('\n'));
  }
  private appearance(actor: Actor, data: ActorData, definition: CharacterDefinition): void {
    actor.stop();
    actor.puppet.resetToBindPose();
    actor.setSkin(data.skin ?? definition.defaultSkin);
    if (data.animation !== undefined) {
      actor.play(data.animation).pauseAnimation();
      actor.puppet.sampleAnimation(0);
    }
  }
  dispose(): void {
    for (const entry of this.instances.values()) entry.actor.dispose();
    this.instances.clear();
    this.sceneId = undefined;
  }
}
