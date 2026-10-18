import { z } from 'zod';
import { canonicalJson } from './authoredSerialization.js';
import { inspectVersion, shapeIssues, type ValidationResult } from './externalData.js';
import { checkJson } from './jsonData.js';
import { assertJsonInputSize } from './jsonInput.js';
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

export const sceneDefinitionSchema = z.strictObject({
  version: z.literal(SCENE_FORMAT_VERSION),
  id: sceneIdentifier,
  name: sceneIdentifier,
  /** Milliseconds, matching Actor, animation and choreography runtime APIs. */
  duration: z.number().positive(),
  actors: z.array(sceneActorDefinitionSchema),
  actions: z.array(sceneActionDefinitionSchema),
});

export type SceneDefinition = z.infer<typeof sceneDefinitionSchema>;
export type SceneActorDefinition = z.infer<typeof sceneActorDefinitionSchema>;
export type SceneActionDefinition = z.infer<typeof sceneActionDefinitionSchema>;
export type SceneCharacterReference = z.infer<typeof sceneCharacterReferenceSchema>;

/** Optional host asset catalog, keyed by exactly the manifest references used in the document. */
export interface SceneCharacterAssets {
  readonly animations: readonly string[];
  readonly skins: readonly string[];
}
export interface SceneValidationOptions {
  readonly characters?: ReadonlyMap<string, SceneCharacterAssets>;
}

export class SceneValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Invalid scene definition:\n${issues.map(({ path, message }) => `${path ?? ''}: ${message}`).join('\n')}`);
    this.name = 'SceneValidationError';
  }
}

function inspectSceneDefinition(input: unknown, options: SceneValidationOptions): ValidationResult<SceneDefinition> {
  const issues: ValidationIssue[] = [];
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
  const actors = new Map<string, SceneActorDefinition>();
  for (const [index, actor] of scene.actors.entries()) {
    const path = `actors[${index}]`;
    if (actors.has(actor.id)) report(`${path}.id`, `Duplicate actor ID "${actor.id}".`);
    actors.set(actor.id, actor);
    const assets = options.characters?.get(actor.character.manifest);
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
    if (!Number.isFinite(end) || end > scene.duration)
      report(`${path}.duration`, 'Action end must stay within the scene duration.');
    const assets = actor && options.characters?.get(actor.character.manifest);
    if (assets && action.type === 'animation' && !assets.animations.includes(action.animation))
      report(`${path}.animation`, `Unknown animation "${action.animation}".`);
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
    if (channel) {
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
