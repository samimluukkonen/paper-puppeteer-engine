import { z } from 'zod';
import { canonicalJson } from './authoredSerialization.js';
import { inspectVersion, shapeIssues, type ValidationResult } from './externalData.js';
import { checkJson } from './jsonData.js';
import { assertJsonInputSize } from './jsonInput.js';
import { identifierSchema } from './schemas.js';
import type { ValidationIssue } from './validation.js';

export const SCENE_FORMAT_VERSION = 1;
const sceneIdentifier = identifierSchema.regex(/\S/, 'Must contain a non-whitespace character.');

/** Stable manifest paths relative to the scene JSON, or permanent HTTP(S) URLs. No temporary URLs. */
export const sceneCharacterReferenceSchema = z.strictObject({
  manifest: z
    .string()
    .regex(
      /^(?:https?:\/\/[^\s?#\\]+|(?!(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/\/))[^\s:?#\\]+)\.json$/,
      'Use a stable character manifest JSON path or HTTP(S) URL without a query or fragment.',
    ),
});

export const sceneActorDefinitionSchema = z.strictObject({
  id: sceneIdentifier,
  character: sceneCharacterReferenceSchema,
  position: z.strictObject({ x: z.number(), y: z.number() }),
  facing: z.enum(['left', 'right']).exactOptional(),
  animation: sceneIdentifier.exactOptional(),
  skin: sceneIdentifier.exactOptional(),
});

/** Scheduled declarations only. Runtime adapters will interpret these in a later milestone. */
export const sceneActionDefinitionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('animation'),
    actorId: sceneIdentifier,
    time: z.number().nonnegative(),
    animation: sceneIdentifier,
  }),
  z.strictObject({
    type: z.literal('face'),
    actorId: sceneIdentifier,
    time: z.number().nonnegative(),
    facing: z.enum(['left', 'right']),
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
  const scene = result.data;
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
  for (const [index, action] of scene.actions.entries()) {
    const path = `actions[${index}]`;
    const actor = actors.get(action.actorId);
    if (!actor) report(`${path}.actorId`, `Unknown actor "${action.actorId}".`);
    if (action.time > scene.duration) report(`${path}.time`, 'Action time must stay within the scene duration.');
    const assets = actor && options.characters?.get(actor.character.manifest);
    if (assets && action.type === 'animation' && !assets.animations.includes(action.animation))
      report(`${path}.animation`, `Unknown animation "${action.animation}".`);
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
