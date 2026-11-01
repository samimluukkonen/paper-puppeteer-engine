import { z } from 'zod';
import { canonicalJson } from './authoredSerialization.js';
import { shapeIssues } from './externalData.js';
import { checkJson } from './jsonData.js';
import { assertJsonInputSize } from './jsonInput.js';
import { validateSceneDefinition, type SceneValidationOptions } from './SceneDefinition.js';
import type { ValidationIssue } from './validation.js';

export const STORY_FORMAT_VERSION = 1;
const identity = z.string().min(1).max(200).regex(/\S/);

/** Array position is the sole ordering authority. References never embed scene documents. */
export const storyEntryTransitionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('cut') }),
  z.strictObject({
    type: z.literal('fade'),
    /** Total fade time; half before handoff, half after. Loading extends the opaque midpoint. */
    duration: z.number().positive().max(60_000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
]);
export type StoryEntryTransition = z.infer<typeof storyEntryTransitionSchema>;
export const storySceneEntrySchema = z.strictObject({
  id: identity,
  sceneAssetId: identity,
  /** Arrival transition. Omitted means a direct cut, including the first entry. */
  transition: storyEntryTransitionSchema.exactOptional(),
});
export const storyDefinitionSchema = z.strictObject({
  version: z.literal(STORY_FORMAT_VERSION),
  id: identity,
  name: identity,
  description: z.string().max(10000).exactOptional(),
  scenes: z.array(storySceneEntrySchema).max(4000),
});
export type StorySceneEntry = z.infer<typeof storySceneEntrySchema>;
export type StoryDefinition = z.infer<typeof storyDefinitionSchema>;
export interface StoryValidationOptions {
  /** Project scene asset IDs, not paths or runtime instance IDs. */
  readonly scenes?: ReadonlyMap<string, unknown>;
  readonly sceneOptions?: SceneValidationOptions;
  /** Empty stories are valid saved drafts, but cannot start playback. */
  readonly requirePlayable?: boolean;
}

export class StoryValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Invalid story definition:\n${issues.map(({ path, message }) => `${path ?? ''}: ${message}`).join('\n')}`);
    this.name = 'StoryValidationError';
  }
}

export function validateStoryDefinition(input: unknown, options: StoryValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  checkJson(input, '', issues);
  if (issues.length) return issues;
  const parsed = storyDefinitionSchema.safeParse(input);
  if (!parsed.success) return shapeIssues(parsed.error);
  const story = parsed.data;
  if (!story.scenes.length)
    issues.push({
      severity: options.requirePlayable ? 'error' : 'warning',
      path: 'scenes',
      message: 'Empty story is an editable draft and cannot be played.',
    });
  const ids = new Set<string>();
  const checked = new Set<string>();
  for (const [index, entry] of story.scenes.entries()) {
    const path = `scenes[${index}]`;
    const id = entry.id.toLowerCase();
    if (ids.has(id))
      issues.push({ severity: 'error', path: `${path}.id`, message: `Duplicate story entry ID "${entry.id}".` });
    ids.add(id);
    if (!options.scenes || checked.has(entry.sceneAssetId)) continue;
    checked.add(entry.sceneAssetId);
    const scene = options.scenes.get(entry.sceneAssetId);
    if (!scene) {
      issues.push({
        severity: 'error',
        path: `${path}.sceneAssetId`,
        message: `Missing scene asset "${entry.sceneAssetId}".`,
      });
      continue;
    }
    for (const issue of validateSceneDefinition(scene, options.sceneOptions))
      issues.push({
        ...issue,
        path: `${path}.sceneAssetId`,
        message: `Scene "${entry.sceneAssetId}" (${issue.path ?? ''}): ${issue.message}`,
      });
    if (typeof scene === 'object' && 'id' in scene && scene.id !== entry.sceneAssetId)
      issues.push({
        severity: 'error',
        path: `${path}.sceneAssetId`,
        message: `Scene asset "${entry.sceneAssetId}" has a different document ID.`,
      });
  }
  return issues;
}

export function parseStoryDefinition(input: unknown, options: StoryValidationOptions = {}): StoryDefinition {
  const issues = validateStoryDefinition(input, options);
  if (issues.some(({ severity }) => severity === 'error')) throw new StoryValidationError(issues);
  const story = storyDefinitionSchema.parse(input);
  assertJsonInputSize(JSON.stringify(story));
  return story;
}

export function serializeStoryDefinition(input: unknown, options: StoryValidationOptions = {}): string {
  return canonicalJson(parseStoryDefinition(input, options));
}

export function parseStoryJson(json: string, options: StoryValidationOptions = {}): StoryDefinition {
  assertJsonInputSize(json);
  return parseStoryDefinition(JSON.parse(json) as unknown, options);
}
