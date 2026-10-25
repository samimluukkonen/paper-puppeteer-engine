import type { AnimationClip } from './AnimationClip.js';
import type { PropertyCurves } from './animationCurves.js';
import type { RigDefinition, SkinDefinition } from './types.js';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  path?: string;
  message: string;
}

/** File validation collects issues; runtime entry points throw before building state. */
export type ReportValidationIssue = (issue: ValidationIssue, runtimeMessage?: string) => void;

export const throwValidationIssue: ReportValidationIssue = (issue, runtimeMessage) => {
  throw new Error(runtimeMessage ?? issue.message);
};

/** Semantic checks assume shape and scalar validation has already succeeded. */
export function checkRigReferences(definition: RigDefinition, report: ReportValidationIssue): void {
  const { root, bones } = definition;
  const ids = new Map<string, number>();
  for (const [index, bone] of bones.entries()) {
    if (ids.has(bone.id))
      report(
        { severity: 'error', path: `bones[${index}].id`, message: `Duplicate bone id "${bone.id}".` },
        `Empty or duplicate bone id: "${bone.id}".`,
      );
    else ids.set(bone.id, index);
  }
  if (!ids.has(root))
    report({ severity: 'error', path: 'root', message: `Root bone "${root}" is missing.` }, `Unknown bone "${root}".`);
  for (const [index, bone] of bones.entries()) {
    if (bone.id === root && bone.parent !== undefined)
      report({
        severity: 'error',
        path: `bones[${index}].parent`,
        message: 'The root bone cannot have a parent.',
      });
    if (bone.id !== root && bone.parent === undefined)
      report({ severity: 'error', path: `bones[${index}].parent`, message: `Bone "${bone.id}" needs a parent.` });
    if (bone.parent !== undefined && !ids.has(bone.parent))
      report(
        {
          severity: 'error',
          path: `bones[${index}].parent`,
          message: `Bone "${bone.id}" references unknown parent "${bone.parent}".`,
        },
        `Unknown parent "${bone.parent}" of bone "${bone.id}".`,
      );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const start of ids.keys()) {
    const path: string[] = [];
    let id: string | undefined = start;
    while (id !== undefined && ids.has(id) && !visited.has(id)) {
      visiting.add(id);
      path.push(id);
      const index: number = ids.get(id)!;
      const parent: string | undefined = bones[index]?.parent;
      if (parent !== undefined && visiting.has(parent)) {
        report(
          {
            severity: 'error',
            path: `bones[${index}].parent`,
            message: `Circular hierarchy involving "${id}" and "${parent}".`,
          },
          `Rig contains a cycle at "${id}".`,
        );
        break;
      }
      id = parent;
    }
    for (const id of path) {
      visiting.delete(id);
      visited.add(id);
    }
  }
  const markerIds = new Set<string>();
  for (const [index, marker] of (definition.footContactMarkers ?? []).entries()) {
    if (markerIds.has(marker.id))
      report({
        severity: 'error',
        path: `footContactMarkers[${index}].id`,
        message: `Duplicate foot contact marker id "${marker.id}".`,
      });
    markerIds.add(marker.id);
    if (!ids.has(marker.boneId))
      report({
        severity: 'error',
        path: `footContactMarkers[${index}].boneId`,
        message: `Foot contact marker references unknown bone "${marker.boneId}".`,
      });
  }
  const slotIds = new Set<string>();
  for (const [index, slot] of (definition.slots ?? []).entries()) {
    if (slotIds.has(slot.id))
      report({ severity: 'error', path: `slots[${index}].id`, message: `Duplicate slot id "${slot.id}".` });
    slotIds.add(slot.id);
    if (!ids.has(slot.bone))
      report(
        {
          severity: 'error',
          path: `slots[${index}].bone`,
          message: `Slot references unknown bone "${slot.bone}".`,
        },
        `Slot "${slot.id}" references unknown bone "${slot.bone}".`,
      );
  }
  const attachmentIds = new Set<string>();
  for (const [index, attachment] of (definition.attachments ?? []).entries()) {
    if (attachmentIds.has(attachment.id))
      report({
        severity: 'error',
        path: `attachments[${index}].id`,
        message: `Duplicate attachment id "${attachment.id}".`,
      });
    attachmentIds.add(attachment.id);
  }
  checkSkinReferences(definition.skins ?? [], definition, report);
  const constraintNames = new Set<string>();
  for (const [index, constraint] of (definition.ik ?? []).entries()) {
    const path = `ik[${index}]`;
    if (constraintNames.has(constraint.name))
      report({
        severity: 'error',
        path: `${path}.name`,
        message: `Duplicate IK constraint name "${constraint.name}".`,
      });
    constraintNames.add(constraint.name);
    for (const field of ['rootBone', 'middleBone', 'endBone'] as const) {
      if (!ids.has(constraint[field]))
        report({ severity: 'error', path: `${path}.${field}`, message: `Unknown IK bone "${constraint[field]}".` });
    }
    const middle = bones[ids.get(constraint.middleBone) ?? -1];
    const end = bones[ids.get(constraint.endBone) ?? -1];
    if (middle && end && (middle.parent !== constraint.rootBone || end.parent !== constraint.middleBone))
      report({ severity: 'error', path, message: 'IK must name three directly connected bones.' });
  }
}

export function checkSkinReferences(
  skins: readonly SkinDefinition[],
  rig: RigDefinition,
  report: ReportValidationIssue,
): void {
  const slotIds = new Set((rig.slots ?? []).map((slot) => slot.id));
  const attachmentIds = new Set((rig.attachments ?? []).map((attachment) => attachment.id));
  const skinNames = new Set<string>();
  for (const [index, skin] of skins.entries()) {
    if (skinNames.has(skin.name))
      report({ severity: 'error', path: `skins[${index}].name`, message: `Duplicate skin name "${skin.name}".` });
    skinNames.add(skin.name);
    for (const [slot, attachment] of Object.entries(skin.slots)) {
      if (!slotIds.has(slot))
        report(
          { severity: 'error', path: `skins[${index}].slots.${slot}`, message: `Unknown slot "${slot}".` },
          `Skin "${skin.name}" references unknown slot "${slot}".`,
        );
      if (attachment !== null && !attachmentIds.has(attachment))
        report(
          {
            severity: 'error',
            path: `skins[${index}].slots.${slot}`,
            message: `Unknown attachment "${attachment}".`,
          },
          `Skin "${skin.name}" references unknown attachment "${attachment}".`,
        );
    }
  }
}

export function checkAnimationReferences(
  clip: AnimationClip,
  rig: Pick<RigDefinition, 'bones' | 'ik'> | undefined,
  report: ReportValidationIssue,
): void {
  // Timeline rules remain checkable even when character assembly has no valid skeleton.
  if (clip.rootMotion) {
    const keys = clip.rootMotion.translationKeys;
    const path = 'rootMotion.translationKeys';
    for (const [index, key] of keys.entries()) {
      if (key.x === undefined && key.y === undefined)
        report({ severity: 'error', path: `${path}[${index}]`, message: 'Root motion keyframe needs x or y.' });
    }
    checkKeyframeTimeline(keys, clip.duration, path, report);
    checkPropertyCurves(keys, path, report);
  }
  const boneIds = rig ? new Set(rig.bones.map((bone) => bone.id)) : undefined;
  for (const [bone, keys] of Object.entries(clip.tracks)) {
    if (boneIds && !boneIds.has(bone))
      report(
        {
          severity: 'error',
          path: `tracks.${bone}`,
          message: `Animation "${clip.name}" references unknown bone "${bone}".`,
        },
        `Unknown bone "${bone}".`,
      );
    checkKeyframeTimeline(
      keys,
      clip.duration,
      `tracks.${bone}`,
      report,
      `Keys for "${bone}" must have strictly increasing times within the clip.`,
    );
    checkPropertyCurves(keys, `tracks.${bone}`, report);
  }
  const constraints = rig ? new Set((rig.ik ?? []).map((constraint) => constraint.name)) : undefined;
  const disabled = new Set<string>();
  for (const [index, name] of (clip.disabledIKConstraints ?? []).entries()) {
    const path = `disabledIKConstraints[${index}]`;
    if (disabled.has(name)) report({ severity: 'error', path, message: `Duplicate disabled IK constraint "${name}".` });
    if (constraints && !constraints.has(name))
      report({ severity: 'error', path, message: `Unknown IK constraint "${name}".` });
    disabled.add(name);
  }
  for (const [name, keys] of Object.entries(clip.ikTracks ?? {})) {
    const path = `ikTracks.${name}`;
    if (constraints && !constraints.has(name))
      report({ severity: 'error', path, message: `Unknown IK constraint "${name}".` });
    // Empty timelines are valid placeholders. A row must author at least one channel.
    for (const [index, key] of keys.entries()) {
      if (key.x === undefined && key.y === undefined && key.mix === undefined)
        report({ severity: 'error', path: `${path}[${index}]`, message: 'IK keyframe needs x, y or mix.' });
    }
    checkKeyframeTimeline(keys, clip.duration, path, report);
    checkPropertyCurves(keys, path, report);
  }
  for (const [index, event] of (clip.events ?? []).entries()) {
    if (event.time < 0 || event.time > clip.duration)
      report(
        {
          severity: 'error',
          path: `events[${index}].time`,
          message: 'Event time must stay within the animation duration.',
        },
        `Invalid event in animation "${clip.name}".`,
      );
  }
}

/** Controls belong only to keyed channels; terminal controls are retained for later insert/move edits. */
function checkPropertyCurves(
  keys: readonly { curves?: PropertyCurves<string> }[],
  path: string,
  report: ReportValidationIssue,
): void {
  for (const [index, key] of keys.entries()) {
    for (const [property, curve] of Object.entries(key.curves ?? {})) {
      const curvePath = `${path}[${index}].curves.${property}`;
      if (!Object.hasOwn(key, property))
        report({
          severity: 'error',
          path: curvePath,
          message: 'Curve controls require a value on the same keyframe property.',
        });
      if (curve?.mode === 'bezier' && curve.control1.x > curve.control2.x)
        report({
          severity: 'error',
          path: curvePath,
          message: 'Bézier time controls must be ordered: control1.x <= control2.x.',
        });
    }
  }
}

/** Shared strict authored timeline rules; tolerant matching belongs to editing operations only. */
function checkKeyframeTimeline(
  keys: readonly { time: number }[],
  duration: number,
  path: string,
  report: ReportValidationIssue,
  runtimeMessage?: string,
): void {
  let previousTime = -1;
  for (const [index, key] of keys.entries()) {
    if (key.time < 0 || key.time > duration || key.time <= previousTime)
      report(
        {
          severity: 'error',
          path: `${path}[${index}].time`,
          message: 'Keyframe time must increase strictly and stay within the animation duration.',
        },
        runtimeMessage,
      );
    previousTime = key.time;
  }
}
