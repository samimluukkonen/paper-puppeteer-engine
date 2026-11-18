import type Phaser from 'phaser';
import { throwNotificationErrors, sceneActorDepth, sceneLayer, assertSceneInstanceBudget } from '../../engine/core.js';
import type { CharacterDefinition, DeepReadonly, SceneActorDefinition } from '../../engine/data.js';
import { Actor, Puppet } from '../../engine/runtime.js';
import { evaluatedFootContacts } from '../shared/footContactGround.js';
import { actorGroundOffset } from './actorGrounding.js';
import type { ActorGroundContact, ReadonlyScene } from './SceneEditorDocument.js';

type ActorData = DeepReadonly<SceneActorDefinition>;
interface PreviewEntry {
  actor: Actor;
  data: ActorData;
  definition: CharacterDefinition;
}

/** Reconcile authored placement through the existing runtime. Each entry exclusively owns one Puppet. */
export class SceneActorPreview {
  readonly instances = new Map<string, PreviewEntry>();
  private sceneId: string | undefined;
  constructor(private readonly scene: Phaser.Scene) {}

  /** Return IDs whose grounding may have changed, excluding depth/visibility-only edits. */
  sync(document: ReadonlyScene, definitions: ReadonlyMap<string, CharacterDefinition>): ReadonlySet<string> {
    assertSceneInstanceBudget(document, definitions);
    const changed = new Set<string>();
    if (this.sceneId !== document.id) this.dispose();
    this.sceneId = document.id;
    const actors = new Map(document.actors.map((actor) => [actor.id, actor]));
    for (const [id, entry] of this.instances) {
      const data = actors.get(id);
      if (
        !data ||
        data.character.manifest !== entry.data.character.manifest ||
        definitions.get(data.character.manifest) !== entry.definition
      ) {
        entry.actor.dispose();
        this.instances.delete(id);
        changed.add(id);
      }
    }
    const errors: string[] = [];
    const visible = sceneLayer(document, 'actors').visible;
    const baseDepth = sceneActorDepth(document, 0);
    document.actors.forEach((data, index) => {
      try {
        const definition = definitions.get(data.character.manifest);
        if (!definition) return;
        let entry = this.instances.get(data.id);
        const appearanceChanged = !entry || entry.data.skin !== data.skin || entry.data.animation !== data.animation;
        const facingChanged = !entry || (entry.data.facing ?? 'right') !== (data.facing ?? 'right');
        const positionChanged =
          !entry || entry.data.position.x !== data.position.x || entry.data.position.y !== data.position.y;
        if (appearanceChanged) {
          if (data.animation !== undefined && !definition.animations.some((clip) => clip.name === data.animation))
            throw new Error(`Actor "${data.id}": unknown animation "${data.animation}".`);
          if (data.skin !== undefined && !definition.rig.skins.some((skin) => skin.name === data.skin))
            throw new Error(`Actor "${data.id}": unknown skin "${data.skin}".`);
        }
        if (!entry) {
          const puppet = new Puppet(this.scene, { definition, autoUpdate: false });
          puppet.setPreviewMode(true);
          try {
            entry = { actor: new Actor({ id: data.id, puppet, puppetOwnership: 'owned' }), data, definition };
            this.instances.set(data.id, entry);
            this.appearance(entry.actor, data, definition);
          } catch (error) {
            puppet.destroy();
            this.instances.delete(data.id);
            throw error;
          }
        } else if (appearanceChanged) {
          this.appearance(entry.actor, data, definition);
        }
        if (facingChanged) entry.actor.setFacing(data.facing ?? 'right');
        if (positionChanged) entry.actor.setPosition(data.position.x, data.position.y);
        if (appearanceChanged || facingChanged || positionChanged) changed.add(data.id);
        const container = entry.actor.puppet.container;
        const depth = baseDepth + (document.layers ? index / 257 : index);
        // Phaser queues a display-list sort even for an unchanged depth.
        if (container.depth !== depth) container.setDepth(depth);
        if (container.visible !== visible) container.setVisible(visible);
        entry.data = data;
      } catch (error) {
        this.instances.get(data.id)?.actor.dispose();
        this.instances.delete(data.id);
        errors.push(error instanceof Error ? error.message : String(error));
      }
    });
    if (errors.length) throw new Error(errors.join('\n'));
    return changed;
  }
  private appearance(actor: Actor, data: ActorData, definition: CharacterDefinition): void {
    actor.stop();
    actor.puppet.resetToBindPose();
    actor.setSkin(data.skin ?? definition.defaultSkin);
    if (data.animation !== undefined) {
      actor.play(data.animation, { restart: true, fadeDuration: 0 }).pauseAnimation();
      actor.puppet.sampleAnimation(0);
    }
  }
  groundOffsets(ids?: ReadonlySet<string>): ReadonlyMap<string, number> {
    const offsets = new Map<string, number>();
    for (const [id, { actor }] of this.instances) {
      if (ids && !ids.has(id)) continue;
      const offset = actorGroundOffset(actor.puppet);
      if (offset !== undefined) offsets.set(id, offset);
    }
    return offsets;
  }
  /** All rig contacts are retained, including unavailable ones, so they never fall back silently. */
  groundContacts(ids?: ReadonlySet<string>): ReadonlyMap<string, readonly ActorGroundContact[]> {
    return new Map(
      [...this.instances]
        .filter(([id]) => !ids || ids.has(id))
        .map(([id, { actor }]) => {
          const points = new Map(evaluatedFootContacts(actor.puppet).map((contact) => [contact.id, contact.world]));
          return [
            id,
            (actor.puppet.rig.footContactMarkers ?? []).map((marker) => ({
              id: marker.id,
              name: marker.name,
              offset: points.has(marker.id) ? points.get(marker.id)!.y - actor.position.y : undefined,
            })),
          ];
        }),
    );
  }
  dispose(): void {
    const previous = [...this.instances.values()];
    this.instances.clear();
    this.sceneId = undefined;
    const errors: unknown[] = [];
    for (const entry of previous) {
      try {
        entry.actor.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    throwNotificationErrors(errors, 'Scene placement preview disposal failed.');
  }
}
