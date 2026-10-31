import { z } from 'zod';
import { equalJsonData } from '../../engine/equalJsonData.js';
import { inspectVersion, shapeIssues } from '../../engine/externalData.js';
import { checkJson } from '../../engine/jsonData.js';
import { freezeData, type DeepReadonly } from '../../engine/readonlyData.js';
import {
  checkSceneCollectionLimits,
  checkSceneDefinitionDomains,
  createSceneDefinitionSchema,
  SCENE_FORMAT_VERSION,
  SceneValidationCache,
  SceneValidationError,
  type SceneDefinition,
  type SceneValidationOptions,
} from '../../engine/SceneDefinition.js';
import type { ValidationIssue } from '../../engine/validation.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';

const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';

/** Document-local, weak ownership indexes never trust caller freezes or retain obsolete snapshots. */
export class SceneSnapshotParser {
  private readonly owned = new WeakSet<object>();
  private readonly domains = new SceneValidationCache();
  private readonly animations = new SceneValidationCache();
  private readonly schema = createSceneDefinitionSchema(<T>(schema: z.ZodType<T>): z.ZodType<T> => {
    // Each schema position has its own cache: an Actions array cannot masquerade as Actors.
    const validated = new WeakSet<object>();
    return z.unknown().transform((input, context): T => {
      if (isObject(input) && validated.has(input)) return input as T;
      const result = schema.safeParse(input);
      if (!result.success) {
        for (const issue of result.error.issues) context.addIssue({ ...issue });
        return z.NEVER;
      }
      const data = this.own(result.data, input);
      if (isObject(data)) validated.add(data);
      return data;
    });
  });

  constructor(
    private readonly options: SceneValidationOptions,
    private readonly animationIds?: (manifest: string) => readonly string[] | undefined,
  ) {}

  /** Copy new data and recover shared nested branches after schema parsing (including cue payloads). */
  private own<T>(parsed: T, input: unknown): T {
    if (!isObject(parsed)) return parsed;
    if (this.owned.has(parsed)) return parsed;
    if (isObject(input) && this.owned.has(input) && equalJsonData(parsed, input)) return input as T;
    const raw = isObject(input) ? input : undefined;
    const entries = Object.entries(parsed).map(
      ([key, value]: [string, unknown]) =>
        [key, this.own(value, raw && Object.getOwnPropertyDescriptor(raw, key)?.value)] as const,
    );
    const data = freezeData(Array.isArray(parsed) ? entries.map(([, value]) => value) : Object.fromEntries(entries));
    this.owned.add(data);
    return data as T;
  }

  /** Mask known JSON only at fixed schema depths, preserving descriptors for hostile-input checks.
   * Nested arbitrary payloads still pass the ordinary nesting/cycle/accessor guard.
   */
  private jsonShape(input: unknown, depth = 0): unknown {
    if (!isObject(input)) return input;
    if (depth > 0 && this.owned.has(input)) return null;
    if (depth > 0 && (!Array.isArray(input) || depth > 1)) return input;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)!.value as PropertyDescriptor;
      if ('value' in descriptor) descriptor.value = this.jsonShape(descriptor.value, depth + 1);
    }
    const shape: object = Array.isArray(input)
      ? []
      : (Object.create(Object.getPrototypeOf(input) as object | null) as object);
    return Object.defineProperties(shape, descriptors);
  }

  parse(input: unknown): DeepReadonly<SceneDefinition> {
    const issues = checkSceneCollectionLimits(input);
    if (issues.length) throw new SceneValidationError(issues);
    checkJson(this.jsonShape(input), '', issues);
    if (issues.length) throw new SceneValidationError(issues);
    const { issues: versionIssues, versionError } = inspectVersion(input, SCENE_FORMAT_VERSION, 'scene');
    const result = this.schema.safeParse(input);
    if (!result.success) {
      throw (
        versionError ??
        new SceneValidationError([
          ...versionIssues,
          ...shapeIssues(result.error).filter(({ path }) => path !== 'version' || !versionIssues.length),
        ])
      );
    }
    const scene = this.own(result.data, input);
    issues.push(...checkSceneDefinitionDomains(scene, this.options, this.domains));
    this.checkAnimations(scene, issues);
    if (issues.length) throw new SceneValidationError(issues);
    assertJsonExportSize(scene);
    return scene;
  }

  private checkAnimations(scene: DeepReadonly<SceneDefinition>, issues: ValidationIssue[]): void {
    if (!this.animationIds) return;
    const actors = new Map(scene.actors.map((actor) => [actor.id, actor]));
    const catalog = new Map(
      [...new Set(scene.actors.map((actor) => actor.character.manifest))].map((manifest) => [
        manifest,
        this.animationIds!(manifest),
      ]),
    );
    const references = scene.actors.map((actor) => [actor.id, actor.character.manifest]);
    this.animations.check(
      'animations',
      [scene.actions, JSON.stringify(references), JSON.stringify([...catalog])],
      issues,
      () => {
        for (const [index, action] of scene.actions.entries()) {
          const actor = actors.get(action.actorId);
          const animations = actor && catalog.get(actor.character.manifest);
          if (action.type === 'animation' && animations && !animations.includes(action.animation))
            issues.push({
              severity: 'error',
              path: `actions[${index}].animation`,
              message: `Unknown animation "${action.animation}" for Actor "${actor.id}".`,
            });
        }
      },
    );
  }
}
