import { z } from 'zod';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneDefinition } from './SceneDefinition.js';
import { identifierSchema } from './schemas.js';
import { assertFinite } from './types.js';

/** Milliseconds on the existing scene clock. End opacity holds until the next fade. */
export const sceneTransitionSchema = z.strictObject({
  id: identifierSchema.regex(/\S/, 'Must contain a non-whitespace character.'),
  time: z.number().nonnegative(),
  duration: z.number().positive(),
  type: z.enum(['fade-in', 'fade-out']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color (#rrggbb).'),
});
export type SceneTransition = z.infer<typeof sceneTransitionSchema>;
export interface SceneTransitionState {
  readonly color: string;
  readonly opacity: number;
}
export interface SceneTransitionTarget {
  setTransition(state: SceneTransitionState): void;
}
export const CLEAR_SCENE_TRANSITION: SceneTransitionState = Object.freeze({ color: '#000000', opacity: 0 });

/** Pure, order-independent sampling of validated, non-overlapping intervals. Before the
 * first fade the overlay is clear. At an adjacent boundary the new fade owns the sample.
 * Fade-out holds its color; a later fade-in permits an authored hold between them.
 */
export function evaluateTransitionAtTime(scene: DeepReadonly<SceneDefinition>, time: number): SceneTransitionState {
  assertFinite(time, 'Transition sample time');
  const bounded = Math.max(0, Math.min(scene.duration, time));
  let latest: DeepReadonly<SceneTransition> | undefined;
  for (const transition of scene.transitions ?? [])
    if (transition.time <= bounded && (!latest || transition.time > latest.time)) latest = transition;
  if (!latest) return CLEAR_SCENE_TRANSITION;
  const progress = Math.min(1, (bounded - latest.time) / latest.duration);
  return { color: latest.color, opacity: latest.type === 'fade-in' ? 1 - progress : progress };
}
