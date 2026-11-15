import { z } from 'zod';
import {
  canonicalJson,
  CAMERA_PROPERTIES,
  checkJson,
  assertJsonInputSize,
  parseSceneDefinition,
  sceneDefinitionSchema,
  sceneActionDuration,
  type SceneDefinition,
  type SceneValidationOptions,
} from '../../engine/core.js';
import type { DeepReadonly } from '../../engine/data.js';

const identity = z.string().min(1).max(200).regex(/\S/);
const point = z.strictObject({ x: z.number(), y: z.number() });
export const choreographyPresetSchema = z.strictObject({
  id: identity,
  name: identity,
  positionMode: z.enum(['relative', 'absolute']),
  roles: z
    .array(
      z.strictObject({
        id: identity,
        name: identity,
        rigIdentity: z.string().min(1).max(2048).regex(/\S/),
        /** Explicit source origin; default is the source Actor's authored initial position. */
        origin: point,
      }),
    )
    .min(1)
    .max(128),
  /** Existing scene types only. Actor IDs are authoring roles, times start at zero. */
  scene: sceneDefinitionSchema,
});
export const sceneTemplateSchema = z.strictObject({ id: identity, name: identity, scene: sceneDefinitionSchema });
export const sceneReuseLibrarySchema = z.strictObject({
  version: z.literal(1),
  choreographies: z.array(choreographyPresetSchema).max(128),
  templates: z.array(sceneTemplateSchema).max(128),
});
export type ChoreographyPreset = z.infer<typeof choreographyPresetSchema>;
export type SceneTemplate = z.infer<typeof sceneTemplateSchema>;
export type SceneReuseLibrary = z.infer<typeof sceneReuseLibrarySchema>;
export const emptySceneReuseLibrary = (): SceneReuseLibrary => ({ version: 1, choreographies: [], templates: [] });

/** Structural and reference checks apply equally to project metadata and portable library JSON. */
export function parseSceneReuseLibrary(input: unknown): SceneReuseLibrary {
  const issues: Parameters<typeof checkJson>[2] = [];
  checkJson(input, '', issues);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
  assertJsonInputSize(JSON.stringify(input));
  const library = sceneReuseLibrarySchema.parse(input);
  for (const entries of [library.choreographies, library.templates]) {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      throw new Error('Duplicate reusable asset ID.');
    for (const entry of entries) entry.scene = parseSceneDefinition(entry.scene);
  }
  for (const preset of library.choreographies) {
    if (
      new Set(preset.roles.map((role) => role.id)).size !== preset.roles.length ||
      preset.roles.length !== preset.scene.actors.length ||
      preset.roles.some((role) => !preset.scene.actors.some((actor) => actor.id === role.id))
    )
      throw new Error('Each choreography Actor must have exactly one role.');
  }
  return library;
}

export interface CaptureChoreographyOptions {
  id: string;
  name: string;
  actionIds: readonly string[];
  positionMode?: 'relative' | 'absolute';
  rigIdentity(manifest: string): string;
  origins?: Readonly<Record<string, { x: number; y: number }>>;
  roleNames?: Readonly<Record<string, string>>;
  includeCamera?: boolean;
  includeTransitions?: boolean;
  includeAudioDialogue?: boolean;
}

export function captureChoreography(
  input: DeepReadonly<SceneDefinition>,
  options: CaptureChoreographyOptions,
): ChoreographyPreset {
  const source = parseSceneDefinition(input);
  const selected = new Set(options.actionIds);
  const actions = source.actions.filter((action) => selected.has(action.id));
  if (!actions.length || actions.length !== selected.size) throw new Error('Select existing timeline actions to save.');
  const start = Math.min(...actions.map((action) => action.time));
  const end = Math.max(start + 1, ...actions.map((action) => action.time + sceneActionDuration(action)));
  const inside = (entry: { time: number; duration?: number }) =>
    entry.time >= start && entry.time + (entry.duration ?? 0) <= end;
  const dialogue = options.includeAudioDialogue ? (source.dialogue ?? []).filter(inside) : [];
  const audioClips = options.includeAudioDialogue ? (source.audioClips ?? []).filter(inside) : [];
  // Voice references are a dependency closure, never silently dropped or left dangling.
  for (const line of dialogue) {
    if (!line.voiceClipId || audioClips.some((clip) => clip.id === line.voiceClipId)) continue;
    throw new Error(`Voice clip for dialogue "${line.id}" crosses the selected range. Expand the action selection.`);
  }
  const actorIds = new Set(
    actions.flatMap((action) => [
      action.actorId,
      ...(action.type === 'face' && action.target.type === 'actor' ? [action.target.actorId] : []),
    ]),
  );
  for (const line of dialogue) if (line.actorId) actorIds.add(line.actorId);
  const roles = source.actors
    .filter((actor) => actorIds.has(actor.id))
    .map((actor, index) => ({
      id: `role-${index + 1}`,
      name: options.roleNames?.[actor.id] ?? actor.id,
      rigIdentity: options.rigIdentity(actor.character.manifest),
      origin: { ...(options.origins?.[actor.id] ?? actor.position) },
    }));
  const mapping = new Map(
    source.actors.filter((actor) => actorIds.has(actor.id)).map((actor, index) => [actor.id, roles[index]!.id]),
  );
  const scene: SceneDefinition = {
    version: 2,
    id: options.id,
    name: options.name,
    duration: end - start,
    actors: source.actors
      .filter((actor) => actorIds.has(actor.id))
      .map((actor) => ({
        id: mapping.get(actor.id)!,
        character: actor.character,
        position: roles.find((role) => role.id === mapping.get(actor.id))!.origin,
      })),
    actions: actions.map((action) => ({
      ...action,
      actorId: mapping.get(action.actorId)!,
      time: action.time - start,
      ...(action.type === 'face' && action.target.type === 'actor'
        ? { target: { type: 'actor' as const, actorId: mapping.get(action.target.actorId)! } }
        : {}),
    })),
  };
  if (options.includeCamera && source.cameraTracks) {
    scene.cameraTracks = {};
    for (const property of CAMERA_PROPERTIES)
      scene.cameraTracks[property] = (source.cameraTracks[property] ?? [])
        .filter(inside)
        .map((key) => ({ ...key, time: key.time - start }));
  }
  if (options.includeTransitions)
    scene.transitions = (source.transitions ?? [])
      .filter(inside)
      .map((entry) => ({ ...entry, time: entry.time - start }));
  if (options.includeAudioDialogue) {
    scene.audioClips = audioClips.map((clip) => ({ ...clip, time: clip.time - start }));
    scene.audioTracks = (source.audioTracks ?? []).filter((track) =>
      audioClips.some((clip) => clip.trackId === track.id),
    );
    scene.audioAssets = (source.audioAssets ?? []).filter((asset) =>
      audioClips.some((clip) => clip.assetId === asset.id),
    );
    scene.dialogue = dialogue.map((line) => ({
      ...line,
      time: line.time - start,
      ...(line.actorId ? { actorId: mapping.get(line.actorId)! } : {}),
    }));
  }
  return parseSceneReuseLibrary({
    version: 1,
    choreographies: [
      { id: options.id, name: options.name, roles, positionMode: options.positionMode ?? 'relative', scene },
    ],
    templates: [],
  }).choreographies[0]!;
}

/** IDs are fresh even when the destination is empty or a caller injects a repeated UUID. */
function idFactory(source: DeepReadonly<SceneDefinition>, destination?: DeepReadonly<SceneDefinition>) {
  const used = new Set<string>();
  for (const scene of [source, destination]) {
    if (!scene) continue;
    used.add(scene.id);
    for (const entries of [
      scene.actors,
      scene.actions,
      scene.images ?? [],
      scene.layers ?? [],
      scene.audioTracks ?? [],
      scene.audioClips ?? [],
      scene.dialogue ?? [],
      scene.transitions ?? [],
      ...CAMERA_PROPERTIES.map((property) => scene.cameraTracks?.[property] ?? []),
    ])
      for (const entry of entries) used.add(entry.id);
  }
  let index = 0;
  const prefix = crypto.randomUUID();
  return () => {
    let id: string;
    do {
      id = `copy-${prefix}-${++index}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

export interface InsertChoreographyOptions {
  time: number;
  actors: Readonly<Record<string, string>>;
  /** Absolute destination origins; defaults to the mapped Actor's authored initial placement. */
  origins?: Readonly<Record<string, { x: number; y: number }>>;
  rigIdentity(manifest: string): string;
  validation?: SceneValidationOptions;
}

/** Pure, detached proposal. Existing validators reject duration, asset and ownership conflicts. */
export function insertChoreography(
  destination: DeepReadonly<SceneDefinition>,
  input: DeepReadonly<ChoreographyPreset>,
  options: InsertChoreographyOptions,
): SceneDefinition {
  const preset = parseSceneReuseLibrary({ version: 1, choreographies: [input], templates: [] }).choreographies[0]!;
  const result = parseSceneDefinition(destination);
  if (!Number.isFinite(options.time) || options.time < 0 || options.time + preset.scene.duration > result.duration)
    throw new Error('Choreography must fit within scene duration. Extend the scene or choose an earlier time.');
  const mapped = new Map(
    preset.roles.map((role) => {
      const actor = result.actors.find((actor) => actor.id === options.actors[role.id]);
      if (!actor) throw new Error(`Assign an Actor to role "${role.name}".`);
      const hasAnimation = preset.scene.actions.some(
        (action) => action.actorId === role.id && action.type === 'animation',
      );
      if (
        hasAnimation &&
        !(
          options.validation?.characters?.get(actor.character.manifest) ??
          options.validation?.getCharacterAssets?.(actor.character.manifest)
        )
      )
        throw new Error(
          `Animation metadata is unavailable for role "${role.name}". Load the mapped character before inserting.`,
        );
      if (hasAnimation && role.rigIdentity !== options.rigIdentity(actor.character.manifest))
        throw new Error(
          `Role "${role.name}" has an incompatible rig. Use Animation Library / Retarget to Another Character, then save a compatible preset.`,
        );
      return [role.id, actor] as const;
    }),
  );
  if (new Set([...mapped.values()].map((actor) => actor.id)).size !== preset.roles.length)
    throw new Error('Assign a different Actor to each role.');
  const fresh = idFactory(preset.scene, result);
  const shifted = (roleId: string, point: { x: number; y: number }) => {
    if (preset.positionMode === 'absolute') return { ...point };
    const origin = preset.roles.find((role) => role.id === roleId)!.origin;
    const target = options.origins?.[roleId] ?? mapped.get(roleId)!.position;
    return { x: target.x + point.x - origin.x, y: target.y + point.y - origin.y };
  };
  result.actions.push(
    ...preset.scene.actions.map((action) => ({
      ...action,
      id: fresh(),
      actorId: mapped.get(action.actorId)!.id,
      time: action.time + options.time,
      ...(action.type === 'move' ? { destination: shifted(action.actorId, action.destination) } : {}),
      ...(action.type === 'face'
        ? {
            target:
              action.target.type === 'actor'
                ? { type: 'actor' as const, actorId: mapped.get(action.target.actorId)!.id }
                : action.target.type === 'point'
                  ? { type: 'point' as const, ...shifted(action.actorId, action.target) }
                  : action.target,
          }
        : {}),
    })),
  );
  if (preset.scene.cameraTracks) {
    result.cameraTracks ??= {};
    for (const property of CAMERA_PROPERTIES) {
      const keys = preset.scene.cameraTracks[property] ?? [];
      const existing = result.cameraTracks[property] ?? [];
      if (keys.length) {
        const from = options.time + keys[0]!.time;
        const to = options.time + keys.at(-1)!.time;
        if (
          existing.some((key) => key.time >= from && key.time <= to) ||
          (existing.some((key) => key.time < from) && existing.some((key) => key.time > to))
        )
          throw new Error(`Camera ${property} collides with an existing camera interval.`);
        result.cameraTracks[property] = [
          ...existing,
          ...keys.map((key) => ({ ...key, id: fresh(), time: key.time + options.time })),
        ].sort((a, b) => a.time - b.time);
      }
    }
  }
  if (preset.scene.transitions?.length)
    result.transitions = [
      ...(result.transitions ?? []),
      ...preset.scene.transitions.map((entry) => ({ ...entry, id: fresh(), time: entry.time + options.time })),
    ];
  const tracks = new Map((preset.scene.audioTracks ?? []).map((track) => [track.id, fresh()]));
  const voices = new Map((preset.scene.audioClips ?? []).map((clip) => [clip.id, fresh()]));
  if (tracks.size)
    result.audioTracks = [
      ...(result.audioTracks ?? []),
      ...preset.scene.audioTracks!.map((track) => ({ ...track, id: tracks.get(track.id)! })),
    ];
  for (const asset of preset.scene.audioAssets ?? []) {
    const existing = result.audioAssets?.find((entry) => entry.id === asset.id);
    if (existing && canonicalJson(existing) !== canonicalJson(asset))
      throw new Error(`Audio asset "${asset.id}" differs from the preset reference.`);
    if (!existing) result.audioAssets = [...(result.audioAssets ?? []), asset];
  }
  if (voices.size)
    result.audioClips = [
      ...(result.audioClips ?? []),
      ...preset.scene.audioClips!.map((clip) => ({
        ...clip,
        id: voices.get(clip.id)!,
        trackId: tracks.get(clip.trackId)!,
        time: clip.time + options.time,
      })),
    ];
  if (preset.scene.dialogue?.length)
    result.dialogue = [
      ...(result.dialogue ?? []),
      ...preset.scene.dialogue.map((line) => ({
        ...line,
        id: fresh(),
        time: line.time + options.time,
        ...(line.actorId ? { actorId: mapped.get(line.actorId)!.id } : {}),
        ...(line.voiceClipId ? { voiceClipId: voices.get(line.voiceClipId)! } : {}),
      })),
    ].sort((a, b) => a.time - b.time);
  return parseSceneDefinition(result, options.validation);
}

export function captureSceneTemplate(
  input: DeepReadonly<SceneDefinition>,
  options: { id: string; name: string; actors: boolean; timeline: boolean; audioDialogue: boolean },
): SceneTemplate {
  const scene = parseSceneDefinition(input);
  if (!options.actors) scene.actors = [];
  if (!options.timeline || !options.actors) scene.actions = [];
  if (!options.timeline) {
    delete scene.cameraTracks;
    delete scene.transitions;
  }
  if (!options.audioDialogue) {
    delete scene.audioAssets;
    delete scene.audioTracks;
    delete scene.audioClips;
    delete scene.dialogue;
  } else if (!options.actors && scene.dialogue)
    scene.dialogue = scene.dialogue.map((line) => {
      const { actorId, ...rest } = line;
      return { ...rest, ...(actorId && !line.speakerName ? { speakerName: actorId } : {}) };
    });
  return parseSceneReuseLibrary({
    version: 1,
    choreographies: [],
    templates: [{ id: options.id, name: options.name, scene }],
  }).templates[0]!;
}

export function createSceneFromTemplate(
  input: DeepReadonly<SceneTemplate>,
  identity: { id: string; name: string },
  validation: SceneValidationOptions = {},
): SceneDefinition {
  const template = parseSceneReuseLibrary({ version: 1, choreographies: [], templates: [input] }).templates[0]!;
  const scene = template.scene;
  if (identity.id === scene.id) throw new Error('Choose a new scene ID, different from the template source.');
  const fresh = idFactory(scene);
  const remap = (entries: readonly { id: string }[]) => new Map(entries.map((entry) => [entry.id, fresh()]));
  const actors = remap(scene.actors),
    tracks = remap(scene.audioTracks ?? []),
    clips = remap(scene.audioClips ?? []);
  const layers = new Map(
    (scene.layers ?? []).map((layer) => [layer.id, ['background', 'actors'].includes(layer.id) ? layer.id : fresh()]),
  );
  scene.id = identity.id;
  scene.name = identity.name;
  scene.actors = scene.actors.map((actor) => ({ ...actor, id: actors.get(actor.id)! }));
  scene.actions = scene.actions.map((action) => ({
    ...action,
    id: fresh(),
    actorId: actors.get(action.actorId)!,
    ...(action.type === 'face' && action.target.type === 'actor'
      ? { target: { type: 'actor' as const, actorId: actors.get(action.target.actorId)! } }
      : {}),
  }));
  if (scene.layers) scene.layers = scene.layers.map((layer) => ({ ...layer, id: layers.get(layer.id)! }));
  if (scene.images)
    scene.images = scene.images.map((image) => ({
      ...image,
      id: fresh(),
      ...(image.layerId ? { layerId: layers.get(image.layerId)! } : {}),
    }));
  if (scene.audioTracks)
    scene.audioTracks = scene.audioTracks.map((track) => ({ ...track, id: tracks.get(track.id)! }));
  if (scene.audioClips)
    scene.audioClips = scene.audioClips.map((clip) => ({
      ...clip,
      id: clips.get(clip.id)!,
      trackId: tracks.get(clip.trackId)!,
    }));
  if (scene.dialogue)
    scene.dialogue = scene.dialogue.map((line) => ({
      ...line,
      id: fresh(),
      ...(line.actorId ? { actorId: actors.get(line.actorId)! } : {}),
      ...(line.voiceClipId ? { voiceClipId: clips.get(line.voiceClipId)! } : {}),
    }));
  if (scene.transitions) scene.transitions = scene.transitions.map((entry) => ({ ...entry, id: fresh() }));
  for (const property of CAMERA_PROPERTIES)
    if (scene.cameraTracks?.[property])
      scene.cameraTracks[property] = scene.cameraTracks[property].map((key) => ({ ...key, id: fresh() }));
  return parseSceneDefinition(scene, validation);
}
