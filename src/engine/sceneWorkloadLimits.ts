import type { CharacterDefinition } from './CharacterDefinition.js';
import type { CharacterMetadataBudget } from './CharacterLoader.js';
import { countJsonBytes, JsonInputLimitError } from './jsonInput.js';
import { JsonWorkloadBudget } from './jsonWorkloadLimits.js';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneDefinition } from './SceneDefinition.js';

/** Scene-wide limits supplement the per-character budgets, before runtime allocation. */
export const DEFAULT_SCENE_WORKLOAD_LIMITS = Object.freeze({
  maxActors: 256,
  maxActions: 10_000,
  maxTotalBones: 32_768,
  maxTotalSlots: 32_768,
  maxTotalJsonBytes: 100 * 1024 * 1024,
  maxTotalKeyframes: 250_000,
  maxTotalEvents: 25_000,
  maxTotalMeshVertices: 65_536,
  maxTotalMeshTriangles: 65_536,
  maxTotalMeshInfluences: 131_072,
  maxTotalIKConstraints: 4096,
  maxTotalIKBoneOperations: 1_048_576,
  maxTotalImageBytes: 100 * 1024 * 1024,
  maxTotalImagePixels: 128 * 1024 * 1024,
  maxTotalAudioBytes: 100 * 1024 * 1024,
});

/** Raw metadata is charged while streaming and before schema parsing/cloning.
 * Each resolver owns this budget; character instances share the retained metadata.
 */
export class SceneMetadataBudget implements CharacterMetadataBudget {
  private bytes = 0;
  private currentBytes = 0;
  private keyframes = 0;
  private events = 0;
  private animations = this.animationBudget();

  private animationBudget(): JsonWorkloadBudget {
    return new JsonWorkloadBudget({
      maxKeyframes: DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalKeyframes,
      maxEvents: DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalEvents,
    });
  }

  countBytes(bytes: number): void {
    this.bytes += bytes;
    this.currentBytes += bytes;
    if (this.bytes > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalJsonBytes)
      throw new JsonInputLimitError(
        `Scene character JSON exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalJsonBytes}-byte total limit.`,
      );
  }

  checkAnimation(input: unknown): void {
    this.animations.checkAnimation(input);
    this.checkAnimationTotals(this.animations.keyframeCount, this.animations.eventCount);
  }

  private checkAnimationTotals(keyframes: number, events: number): void {
    if (this.keyframes + keyframes > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalKeyframes)
      throw new JsonInputLimitError(
        `Scene exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalKeyframes}-keyframe total limit.`,
      );
    if (this.events + events > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalEvents)
      throw new JsonInputLimitError(
        `Scene exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalEvents}-event total limit.`,
      );
  }

  /** Host caches bypass the streaming reader. Reserve their retained workload too,
   * so a later streamed character cannot spend the same budget again.
   */
  completeCharacter(character: CharacterDefinition): void {
    const workload = characterWorkload(character);
    this.countBytes(Math.max(0, workload.jsonBytes - this.currentBytes));
    const keyframes = Math.max(workload.keyframes, this.animations.keyframeCount);
    const events = Math.max(workload.events, this.animations.eventCount);
    this.checkAnimationTotals(keyframes, events);
    this.keyframes += keyframes;
    this.events += events;
    this.currentBytes = 0;
    this.animations = this.animationBudget();
  }
}

interface CharacterWorkload {
  jsonBytes: number;
  keyframes: number;
  events: number;
  meshVertices: number;
  meshTriangles: number;
  meshInfluences: number;
}

// Immutable definitions are revisited on every editor sync. Never rescan their JSON/vertices per frame.
const workloads = new WeakMap<CharacterDefinition, CharacterWorkload>();

function characterWorkload(character: CharacterDefinition): CharacterWorkload {
  const cached = workloads.get(character);
  if (cached) return cached;
  const metadata = new JsonWorkloadBudget({
    maxKeyframes: DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalKeyframes,
    maxEvents: DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalEvents,
  });
  for (const clip of character.animations) metadata.checkAnimation(clip);
  const result: CharacterWorkload = {
    jsonBytes: 0,
    keyframes: metadata.keyframeCount,
    events: metadata.eventCount,
    meshVertices: 0,
    meshTriangles: 0,
    meshInfluences: 0,
  };
  for (const document of [
    character.manifest,
    character.rigFile ?? character.rig,
    ...character.standaloneSkins,
    ...character.animations,
    ...character.poses,
  ]) {
    if (document === undefined) continue;
    const remaining = DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalJsonBytes - result.jsonBytes;
    if (remaining <= 0) throw new Error('Scene character JSON exceeds the byte total limit.');
    try {
      result.jsonBytes += countJsonBytes(document, remaining);
    } catch (error) {
      if (!(error instanceof JsonInputLimitError)) throw error;
      throw new Error('Scene character JSON exceeds the byte total limit.', { cause: error });
    }
  }
  // Include every alternative mesh, even if initially hidden. One attachment can be
  // mounted in several slots; skin changes must never bypass the preflight estimate.
  const mounts = new Map<string, Set<string>>();
  for (const skin of character.rig.skins) {
    for (const [slot, attachment] of Object.entries(skin.slots)) {
      if (attachment === null) continue;
      let slots = mounts.get(attachment);
      if (!slots) mounts.set(attachment, (slots = new Set()));
      slots.add(slot);
    }
  }
  for (const mesh of character.rig.attachments) {
    if (mesh.type !== 'mesh') continue;
    const copies = Math.max(1, mounts.get(mesh.id)?.size ?? 0);
    result.meshVertices += copies * mesh.vertices.length;
    result.meshTriangles += (copies * mesh.triangles.length) / 3;
    // Legacy unweighted vertices still compile one rigid slot-bone influence each.
    result.meshInfluences += copies * mesh.vertices.reduce((sum, vertex) => sum + (vertex.influences?.length ?? 1), 0);
  }
  workloads.set(character, result);
  return result;
}

/** Count every instance, including Actors sharing one immutable character definition.
 * Metadata counts each referenced package once, including host-cached definitions.
 * Partial editor catalogs count loaded definitions and are rechecked as assets arrive.
 */
export function assertSceneInstanceBudget(
  scene: DeepReadonly<SceneDefinition>,
  characters: ReadonlyMap<string, CharacterDefinition>,
): void {
  let bones = 0;
  let slots = 0;
  let vertices = 0;
  let triangles = 0;
  let influences = 0;
  let constraints = 0;
  let ikBoneOperations = 0;
  let jsonBytes = 0;
  let keyframes = 0;
  let events = 0;
  const references = new Set<string>();
  for (const actor of scene.actors) {
    const character = characters.get(actor.character.manifest);
    if (!character) continue;
    bones += character.rig.bones.length;
    slots += character.rig.slots.length;
    if (bones > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalBones)
      throw new Error(`Scene exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalBones}-bone instance limit.`);
    if (slots > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalSlots)
      throw new Error(`Scene exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalSlots}-slot instance limit.`);
    const workload = characterWorkload(character);
    if (!references.has(actor.character.manifest)) {
      references.add(actor.character.manifest);
      jsonBytes += workload.jsonBytes;
      if (jsonBytes > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalJsonBytes)
        throw new Error('Scene character JSON exceeds the byte total limit.');
      keyframes += workload.keyframes;
      events += workload.events;
      if (keyframes > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalKeyframes)
        throw new Error(`Scene exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalKeyframes}-keyframe total limit.`);
      if (events > DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalEvents)
        throw new Error(`Scene exceeds the ${DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalEvents}-event total limit.`);
    }
    vertices += workload.meshVertices;
    triangles += workload.meshTriangles;
    influences += workload.meshInfluences;
    constraints += character.rig.ik?.length ?? 0;
    // Each ordered IK constraint can force another full FK pass, even for shared rigs.
    ikBoneOperations += (character.rig.ik?.length ?? 0) * character.rig.bones.length;
    for (const [count, limit, label] of [
      [vertices, DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalMeshVertices, 'mesh vertex'],
      [triangles, DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalMeshTriangles, 'mesh triangle'],
      [influences, DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalMeshInfluences, 'mesh influence'],
      [constraints, DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalIKConstraints, 'IK constraint'],
      [ikBoneOperations, DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalIKBoneOperations, 'IK bone operation'],
    ] as const)
      if (count > limit) throw new Error(`Scene exceeds the ${limit}-${label} instance limit.`);
  }
}
