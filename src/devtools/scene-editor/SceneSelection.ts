import type { CameraProperty } from '../../engine/core.js';

export interface SceneCameraKeySelection {
  readonly property: CameraProperty;
  readonly id: string;
}

/**
 * One scene's selection. Each variant is a legal state, so selecting one kind replaces every other.
 * Actions carry the Actor of their primary (last) action; the camera and Actors are never selected together.
 */
export type SceneSelection =
  | null
  | { readonly kind: 'actor'; readonly id: string }
  | { readonly kind: 'actions'; readonly actorId: string; readonly ids: readonly string[] }
  | { readonly kind: 'camera'; readonly key: SceneCameraKeySelection | null }
  | { readonly kind: 'image'; readonly id: string }
  | { readonly kind: 'dialogue'; readonly id: string }
  | { readonly kind: 'audio'; readonly id: string }
  | { readonly kind: 'transition'; readonly id: string };

type SingleKind = 'actor' | 'image' | 'dialogue' | 'audio' | 'transition';

/** The Actor selected directly or through its actions. */
export function selectedActorOf(selection: SceneSelection): string | null {
  if (selection?.kind === 'actor') return selection.id;
  return selection?.kind === 'actions' ? selection.actorId : null;
}

export function selectedActionIdsOf(selection: SceneSelection): readonly string[] {
  return selection?.kind === 'actions' ? selection.ids : [];
}

export function cameraKeyOf(selection: SceneSelection): SceneCameraKeySelection | null {
  return selection?.kind === 'camera' ? selection.key : null;
}

export function idOf(selection: SceneSelection, kind: SingleKind): string | null {
  return selection?.kind === kind ? selection.id : null;
}

/**
 * Additive selection toggles `id`; otherwise `id` replaces the selection. Removing the last action, or clearing
 * with `null`, steps back to the Actor that owned the actions. `actorOf` returns undefined for a deleted action,
 * which is dropped from the selection.
 */
export function selectAction(
  selection: SceneSelection,
  id: string | null,
  actorOf: (actionId: string) => string | undefined,
  additive: boolean,
): SceneSelection {
  const current = selectedActionIdsOf(selection).filter((value) => actorOf(value) !== undefined);
  const ids =
    additive && id
      ? current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
      : id
        ? [id]
        : [];
  const primary = ids.at(-1);
  const primaryActor = primary === undefined ? undefined : actorOf(primary);
  if (primaryActor !== undefined) return { kind: 'actions', actorId: primaryActor, ids };
  const actor = selectedActorOf(selection);
  return actor ? { kind: 'actor', id: actor } : null;
}
