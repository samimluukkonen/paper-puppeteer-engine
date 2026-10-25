import { z } from 'zod';
import { audioAssetDefinitionSchema, type AudioAssetDefinition } from './AudioAsset.js';
import { canonicalJson } from './authoredSerialization.js';
import { CAMERA_PROPERTIES, cameraTracksSchema } from './cameraAnimation.js';
import { cinematicCameraSchema, CINEMATIC_CAMERA_MIN_ZOOM, CINEMATIC_CAMERA_MAX_ZOOM } from './cinematicCamera.js';
import { inspectVersion, shapeIssues, type ValidationResult } from './externalData.js';
import { checkJson } from './jsonData.js';
import { assertJsonInputSize } from './jsonInput.js';
import { sceneAudioClipSchema, sceneAudioTrackSchema } from './sceneAudio.js';
import { sceneTransitionSchema } from './sceneTransitions.js';
import { DEFAULT_SCENE_WORKLOAD_LIMITS } from './sceneWorkloadLimits.js';
import { identifierSchema } from './schemas.js';
import type { ValidationIssue } from './validation.js';

export const SCENE_FORMAT_VERSION = 2;
const sceneIdentifier = identifierSchema.regex(/\S/, 'Must contain a non-whitespace character.');

/** Leading parent segments support scenes stored beside a characters directory. Reject
 * encoded aliases, internal traversal and URL credentials before URL normalization. */
function safeSceneManifest(value: string): boolean {
  let path = value;
  if (/^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      path = value.slice(value.indexOf('/', value.indexOf('//') + 2));
    } catch {
      return false;
    }
    path = path.replace(/^\//, '');
  } else {
    path = path.replace(/^(?:\.\.\/)+/, '');
  }
  return (
    !/[\s%\\:?#]/.test(path) &&
    !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

/** Stable manifest paths relative to the scene JSON, or permanent HTTP(S) URLs. No temporary URLs. */
export const sceneCharacterReferenceSchema = z.strictObject({
  manifest: z
    .string()
    .regex(
      /^(?:https?:\/\/[^\s?#\\]+|(?!(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/\/))[^\s:?#\\]+)\.json$/,
      'Use a stable character manifest JSON path or HTTP(S) URL without a query or fragment.',
    )
    .refine(safeSceneManifest, 'Use a safe manifest path without encoded aliases or internal traversal.'),
});

/** Image paths resolve relative to the scene JSON, with the same confined leading-parent policy. */
export const sceneImageReferenceSchema = z
  .string()
  .regex(/\.(?:png|webp)$/i)
  .refine(safeSceneManifest, 'Use a stable PNG/WebP path without aliases, queries or traversal.');
/** Back-to-front array order. Reserved background/actors bands keep legacy scenes predictable. */
export const sceneLayerDefinitionSchema = z.strictObject({
  id: sceneIdentifier,
  name: sceneIdentifier,
  visible: z.boolean(),
  parallax: z.number().nonnegative(),
});
export type SceneLayerDefinition = z.infer<typeof sceneLayerDefinitionSchema>;

export const sceneImageDefinitionSchema = z.strictObject({
  id: sceneIdentifier,
  image: sceneImageReferenceSchema,
  layerId: sceneIdentifier.exactOptional(),
  position: z.strictObject({ x: z.number(), y: z.number() }),
  scale: z.strictObject({ x: z.number().positive(), y: z.number().positive() }),
  visible: z.boolean(),
  order: z.number().int().min(0).max(255),
  opacity: z.number().min(0).max(1).exactOptional(),
});
export type SceneImageDefinition = z.infer<typeof sceneImageDefinitionSchema>;

export const sceneActorDefinitionSchema = z.strictObject({
  id: sceneIdentifier,
  character: sceneCharacterReferenceSchema,
  position: z.strictObject({ x: z.number(), y: z.number() }),
  facing: z.enum(['left', 'right']).exactOptional(),
  animation: sceneIdentifier.exactOptional(),
  skin: sceneIdentifier.exactOptional(),
});

const actionTiming = {
  id: sceneIdentifier,
  actorId: sceneIdentifier,
  /** Milliseconds; editor labels display seconds. */
  time: z.number().nonnegative(),
};
const pointSchema = z.strictObject({ x: z.number(), y: z.number() });

/** Authored declarations only. All clips have an explicit finite ownership window. */
export const sceneActionDefinitionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...actionTiming,
    type: z.literal('animation'),
    animation: sceneIdentifier,
    duration: z.number().positive(),
    loop: z.boolean(),
    speed: z.number().positive(),
    /** Omitted in legacy scenes: translation remains owned by scene movement actions. */
    movementSource: z.enum(['scene', 'rootMotion']).exactOptional(),
  }),
  z.strictObject({
    ...actionTiming,
    type: z.literal('move'),
    destination: pointSchema,
    duration: z.number().positive(),
  }),
  z.strictObject({
    ...actionTiming,
    type: z.literal('face'),
    target: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('direction'), facing: z.enum(['left', 'right']) }),
      z.strictObject({ type: z.literal('actor'), actorId: sceneIdentifier }),
      z.strictObject({ type: z.literal('point'), ...pointSchema.shape }),
    ]),
  }),
  z.strictObject({ ...actionTiming, type: z.literal('wait'), duration: z.number().positive() }),
  z.strictObject({
    ...actionTiming,
    type: z.literal('cue'),
    name: sceneIdentifier,
    payload: z.unknown().exactOptional(),
  }),
]);

export const sceneAudioAssetSchema = audioAssetDefinitionSchema.extend({
  path: z
    .string()
    .regex(/\.(?:wav|mp3|ogg)$/i)
    .refine(safeSceneManifest, 'Use a stable audio path without aliases or internal traversal.'),
});

export const sceneDefinitionSchema = z.strictObject({
  version: z.literal(SCENE_FORMAT_VERSION),
  id: sceneIdentifier,
  name: sceneIdentifier,
  /** Milliseconds, matching Actor, animation and choreography runtime APIs. */
  duration: z.number().positive(),
  audioAssets: z.array(sceneAudioAssetSchema).max(128).exactOptional(),
  audioTracks: z.array(sceneAudioTrackSchema).max(128).exactOptional(),
  audioClips: z.array(sceneAudioClipSchema).max(4000).exactOptional(),
  camera: cinematicCameraSchema.exactOptional(),
  cameraTracks: cameraTracksSchema.exactOptional(),
  transitions: z.array(sceneTransitionSchema).max(1000).exactOptional(),
  layers: z.array(sceneLayerDefinitionSchema).min(2).max(64).exactOptional(),
  images: z.array(sceneImageDefinitionSchema).max(256).exactOptional(),
  actors: z.array(sceneActorDefinitionSchema).max(DEFAULT_SCENE_WORKLOAD_LIMITS.maxActors),
  actions: z.array(sceneActionDefinitionSchema).max(DEFAULT_SCENE_WORKLOAD_LIMITS.maxActions),
});

export type SceneDefinition = z.infer<typeof sceneDefinitionSchema>;
export type SceneActorDefinition = z.infer<typeof sceneActorDefinitionSchema>;
export type SceneActionDefinition = z.infer<typeof sceneActionDefinitionSchema>;
export type SceneCharacterReference = z.infer<typeof sceneCharacterReferenceSchema>;

/** Optional host asset catalog, keyed by exactly the manifest references used in the document. */
export interface SceneCharacterAssets {
  readonly animations: readonly string[];
  readonly skins: readonly string[];
  readonly rootMotionAnimations?: readonly string[];
}
export interface SceneValidationOptions {
  readonly characters?: ReadonlyMap<string, SceneCharacterAssets>;
  /** Editors may validate against metadata as it becomes available without blocking scene opening. */
  readonly getCharacterAssets?: (manifest: string) => SceneCharacterAssets | undefined;
  readonly images?: ReadonlySet<string>;
  /** Supplied project catalog is authoritative for existence and decoded duration. */
  readonly getAudioAssets?: () => readonly AudioAssetDefinition[];
}

export class SceneValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Invalid scene definition:\n${issues.map(({ path, message }) => `${path ?? ''}: ${message}`).join('\n')}`);
    this.name = 'SceneValidationError';
  }
}

function inspectSceneDefinition(input: unknown, options: SceneValidationOptions): ValidationResult<SceneDefinition> {
  const issues: ValidationIssue[] = [];
  // Bound raw collections before walking/cloning entries or allocating schema issues.
  if (input !== null && typeof input === 'object') {
    for (const [field, limit] of [
      ['audioAssets', 128],
      ['audioTracks', 128],
      ['audioClips', 4000],
      ['layers', 64],
      ['images', 256],
      ['transitions', 1000],
      ['actors', DEFAULT_SCENE_WORKLOAD_LIMITS.maxActors],
      ['actions', DEFAULT_SCENE_WORKLOAD_LIMITS.maxActions],
    ] as const) {
      const entries: unknown = Object.getOwnPropertyDescriptor(input, field)?.value;
      if (Array.isArray(entries) && entries.length > limit)
        issues.push({ severity: 'error', path: field, message: `Scene exceeds the ${limit}-${field} limit.` });
    }
    if (issues.length) return { issues };
  }
  checkJson(input, '', issues);
  if (issues.length) return { issues };
  const { issues: versionIssues, versionError } = inspectVersion(input, SCENE_FORMAT_VERSION, 'scene');
  issues.push(...versionIssues);
  const result = sceneDefinitionSchema.safeParse(input);
  if (!result.success) {
    issues.push(...shapeIssues(result.error).filter(({ path }) => path !== 'version' || !versionIssues.length));
    return { issues, versionError };
  }
  // Payloads use the same unknown + checkJson contract as animation events. Own them deeply.
  const scene = structuredClone(result.data);
  const report = (path: string, message: string): void => {
    issues.push({ severity: 'error', path, message });
  };
  const assetCache = new Map<string, SceneCharacterAssets | undefined>();
  const characterAssets = (manifest: string): SceneCharacterAssets | undefined => {
    if (!assetCache.has(manifest))
      assetCache.set(manifest, options.characters?.get(manifest) ?? options.getCharacterAssets?.(manifest));
    return assetCache.get(manifest);
  };
  for (const property of CAMERA_PROPERTIES) {
    const keys = scene.cameraTracks?.[property] ?? [];
    const ids = new Set<string>();
    for (const [index, key] of keys.entries()) {
      const path = `cameraTracks.${property}[${index}]`;
      if (ids.has(key.id)) report(`${path}.id`, 'Camera key IDs must be unique within a channel.');
      ids.add(key.id);
      if (key.time > scene.duration) report(`${path}.time`, 'Camera keys must stay within scene duration.');
      if (index > 0 && key.time <= keys[index - 1]!.time)
        report(`${path}.time`, 'Camera keys must have strictly increasing times.');
      if (property === 'zoom' && (key.value < CINEMATIC_CAMERA_MIN_ZOOM || key.value > CINEMATIC_CAMERA_MAX_ZOOM))
        report(`${path}.value`, 'Camera zoom keys must stay between 0.1 and 8.');
      if (key.curve?.mode === 'bezier' && key.curve.control1.x > key.curve.control2.x)
        report(`${path}.curve`, 'Bézier time handles must be monotonic.');
    }
  }
  const audioIds = new Set<string>();
  for (const [index, asset] of (scene.audioAssets ?? []).entries()) {
    if (audioIds.has(asset.id)) report(`audioAssets[${index}].id`, 'Audio asset IDs must be unique.');
    audioIds.add(asset.id);
  }
  const audioCatalog = new Map(
    (options.getAudioAssets?.() ?? scene.audioAssets ?? []).map((asset) => [asset.id, asset]),
  );
  const audioTrackIds = new Set<string>();
  for (const [index, track] of (scene.audioTracks ?? []).entries()) {
    if (audioTrackIds.has(track.id)) report(`audioTracks[${index}].id`, 'Audio track IDs must be unique.');
    audioTrackIds.add(track.id);
  }
  const audioClipIds = new Set<string>();
  for (const [index, clip] of (scene.audioClips ?? []).entries()) {
    const path = `audioClips[${index}]`;
    if (audioClipIds.has(clip.id)) report(`${path}.id`, 'Audio clip IDs must be unique.');
    audioClipIds.add(clip.id);
    const asset = audioCatalog.get(clip.assetId);
    if (!asset) report(`${path}.assetId`, `Missing audio asset "${clip.assetId}". Import or replace it before saving.`);
    if (!audioIds.has(clip.assetId)) report(`${path}.assetId`, 'Missing scene audio asset reference.');
    const reference = scene.audioAssets?.find((entry) => entry.id === clip.assetId);
    if (
      asset &&
      reference &&
      options.getAudioAssets &&
      reference.path.replace(/^(?:\.\.\/)+/, '') !== asset.path.replace(/^(?:\.\.\/)+/, '')
    )
      report(`${path}.assetId`, 'Scene audio path differs from its project registration.');
    if (!audioTrackIds.has(clip.trackId)) report(`${path}.trackId`, 'Choose an existing audio track.');
    const end = clip.time + clip.duration;
    if (!Number.isFinite(end) || end <= clip.time || end > scene.duration)
      report(`${path}.duration`, 'Audio clip end must advance time and stay within scene duration.');
    for (const field of ['fadeIn', 'fadeOut'] as const)
      if ((clip[field] ?? 0) > clip.duration) report(`${path}.${field}`, 'Fade duration cannot exceed clip duration.');
    const mediaDuration = asset?.durationSeconds === undefined ? undefined : asset.durationSeconds * 1000;
    if (!Number.isFinite(clip.sourceOffset + clip.duration))
      report(`${path}.sourceOffset`, 'Source range must be finite.');
    if (mediaDuration !== undefined) {
      if (clip.sourceOffset >= mediaDuration)
        report(`${path}.sourceOffset`, 'Source offset must be before the media end.');
      if (!clip.loop && clip.sourceOffset + clip.duration > mediaDuration + 0.000001)
        report(`${path}.duration`, 'Non-looping trim range exceeds the media duration.');
    }
  }
  const transitionIds = new Set<string>();
  const transitions = (scene.transitions ?? []).map((transition, index) => ({ transition, index }));
  transitions.sort((a, b) => a.transition.time - b.transition.time);
  let previousEnd = -1;
  for (const { transition, index } of transitions) {
    const path = `transitions[${index}]`;
    if (transitionIds.has(transition.id)) report(`${path}.id`, 'Transition IDs must be unique.');
    transitionIds.add(transition.id);
    const end = transition.time + transition.duration;
    if (end <= transition.time) report(`${path}.duration`, 'Transition duration must advance scene time.');
    if (!Number.isFinite(end) || end > scene.duration)
      report(`${path}.duration`, 'Transition end must stay within scene duration.');
    if (transition.time < previousEnd)
      report(`${path}.time`, 'Fade intervals must not overlap. Move or shorten this fade.');
    previousEnd = Math.max(previousEnd, end);
  }
  const layerIds = new Set<string>();
  for (const [index, layer] of (scene.layers ?? []).entries()) {
    if (layerIds.has(layer.id)) report(`layers[${index}].id`, `Duplicate layer ID "${layer.id}".`);
    layerIds.add(layer.id);
    if (layer.id === 'actors' && layer.parallax !== 1)
      report(`layers[${index}].parallax`, 'The Actors band uses normal world scrolling (1).');
  }
  if (scene.layers) {
    for (const id of ['background', 'actors'])
      if (!layerIds.has(id)) report('layers', `Missing reserved "${id}" layer.`);
  } else {
    layerIds.add('background');
    layerIds.add('actors');
  }
  const imageIds = new Set<string>();
  for (const [index, image] of (scene.images ?? []).entries()) {
    if (imageIds.has(image.id)) report(`images[${index}].id`, `Duplicate image element ID "${image.id}".`);
    imageIds.add(image.id);
    if (!layerIds.has(image.layerId ?? 'background') || image.layerId === 'actors')
      report(`images[${index}].layerId`, 'Choose an existing artwork layer; the Actors band contains only Puppets.');
    if (options.images && !options.images.has(image.image))
      report(`images[${index}].image`, `Missing image "${image.image}". Import or replace it before export.`);
  }
  const actors = new Map<string, SceneActorDefinition>();
  for (const [index, actor] of scene.actors.entries()) {
    const path = `actors[${index}]`;
    if (actors.has(actor.id)) report(`${path}.id`, `Duplicate actor ID "${actor.id}".`);
    actors.set(actor.id, actor);
    const assets = characterAssets(actor.character.manifest);
    if (options.characters && !assets)
      report(`${path}.character.manifest`, `Unknown character "${actor.character.manifest}".`);
    if (assets && actor.animation !== undefined && !assets.animations.includes(actor.animation))
      report(`${path}.animation`, `Unknown animation "${actor.animation}".`);
    if (assets && actor.skin !== undefined && !assets.skins.includes(actor.skin))
      report(`${path}.skin`, `Unknown skin "${actor.skin}".`);
  }
  const identities = new Set<string>();
  const ownership = new Map<string, { action: SceneActionDefinition; index: number }[]>();
  for (const [index, action] of scene.actions.entries()) {
    const path = `actions[${index}]`;
    if (identities.has(action.id)) report(`${path}.id`, `Duplicate action ID "${action.id}".`);
    identities.add(action.id);
    const actor = actors.get(action.actorId);
    if (!actor) report(`${path}.actorId`, `Unknown actor "${action.actorId}".`);
    if (action.time > scene.duration) report(`${path}.time`, 'Action time must stay within the scene duration.');
    const end = action.time + sceneActionDuration(action);
    if (sceneActionDuration(action) > 0 && end <= action.time)
      report(`${path}.duration`, 'Action duration must advance scene time.');
    if (!Number.isFinite(end) || end > scene.duration)
      report(`${path}.duration`, 'Action end must stay within the scene duration.');
    const assets = actor && characterAssets(actor.character.manifest);
    if (assets && action.type === 'animation' && !assets.animations.includes(action.animation))
      report(`${path}.animation`, `Unknown animation "${action.animation}".`);
    if (action.type === 'animation') {
      const elapsed = action.duration * action.speed;
      if (!Number.isFinite(elapsed) || elapsed <= 0)
        report(`${path}.speed`, 'Scaled animation duration must be finite and positive.');
      if (action.movementSource === 'rootMotion' && assets && !assets.rootMotionAnimations?.includes(action.animation))
        report(`${path}.movementSource`, `Animation "${action.animation}" has no root-motion translation keys.`);
    }
    if (action.type === 'face' && action.target.type === 'actor') {
      if (!actors.has(action.target.actorId))
        report(`${path}.target.actorId`, `Unknown target actor "${action.target.actorId}".`);
      if (action.target.actorId === action.actorId) report(`${path}.target.actorId`, 'An actor cannot look at itself.');
    }
    const channel =
      action.type === 'animation'
        ? 'animation'
        : action.type === 'move'
          ? 'position'
          : action.type === 'face'
            ? 'facing'
            : null;
    const channels = channel ? [channel] : [];
    if (action.type === 'animation' && action.movementSource === 'rootMotion') channels.push('position');
    for (const channel of channels) {
      const key = JSON.stringify([action.actorId, channel]);
      const group = ownership.get(key) ?? [];
      group.push({ action, index });
      ownership.set(key, group);
    }
  }
  // Half-open intervals allow adjacent clips. Equal-time facing markers are ambiguous.
  for (const group of ownership.values()) {
    group.sort((a, b) => a.action.time - b.action.time || a.index - b.index);
    let previous: (typeof group)[number] | undefined;
    for (const current of group) {
      if (
        previous &&
        (current.action.time < previous.action.time + sceneActionDuration(previous.action) ||
          (current.action.type === 'face' && current.action.time === previous.action.time))
      )
        report(
          `actions[${current.index}].time`,
          `Conflicting ${current.action.type} ownership with action "${previous.action.id}".`,
        );
      if (
        !previous ||
        current.action.time + sceneActionDuration(current.action) >=
          previous.action.time + sceneActionDuration(previous.action)
      )
        previous = current;
    }
  }
  return issues.length ? { issues, versionError } : { issues, data: scene };
}

/** Structural validation needs no asset loading; a supplied catalog also checks asset existence. */
export function validateSceneDefinition(input: unknown, options: SceneValidationOptions = {}) {
  return inspectSceneDefinition(input, options).issues;
}

/** Parse an unknown JSON value into detached authored data. Unknown versions are rejected. */
export function parseSceneDefinition(input: unknown, options: SceneValidationOptions = {}): SceneDefinition {
  const result = inspectSceneDefinition(input, options);
  if (!result.data) throw result.versionError ?? new SceneValidationError(result.issues);
  return result.data;
}

export function serializeSceneDefinition(input: unknown, options: SceneValidationOptions = {}): string {
  const scene = parseSceneDefinition(input, options);
  return canonicalJson(scene);
}

export function parseSceneJson(json: string, options: SceneValidationOptions = {}): SceneDefinition {
  assertJsonInputSize(json);
  const input: unknown = JSON.parse(json);
  return parseSceneDefinition(input, options);
}

/** New drafts need no rig, character or existing scene JSON. */
export function createEmptyScene(options: { id: string; name?: string; duration?: number }): SceneDefinition {
  return parseSceneDefinition({
    version: SCENE_FORMAT_VERSION,
    id: options.id,
    name: options.name ?? 'Untitled Scene',
    duration: options.duration ?? 10000,
    actors: [],
    actions: [],
  });
}

/** Markers own no interval; wait is scheduling metadata and owns no Actor channel. */
export function sceneActionDuration(
  action: Pick<SceneActionDefinition, 'type'> & { readonly duration?: number },
): number {
  return action.type === 'face' || action.type === 'cue' ? 0 : (action.duration ?? 0);
}
