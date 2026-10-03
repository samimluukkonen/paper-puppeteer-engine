import type { z } from 'zod';
import { lerpProperty } from './AnimationPose.js';
import { UnsupportedFormatVersionError } from './externalData.js';
import type { Joint } from './Joint.js';
import { checkJson } from './jsonData.js';
import type { Rig } from './Rig.js';
import { identifierSchema, POSE_FORMAT_VERSION, poseDefinitionSchema } from './schemas.js';
import { type JointTransform, transformProperties } from './types.js';
import type { ValidationIssue } from './validation.js';

export { POSE_FORMAT_VERSION, poseDefinitionSchema } from './schemas.js';

export type PoseDefinition = z.infer<typeof poseDefinitionSchema>;

export class PoseValidationError extends Error {
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super(`Invalid pose definition:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'PoseValidationError';
  }
}

/** A pose is sparse and uses absolute local joint values, in radians for rotation. */
export function parsePoseDefinition(input: unknown, rig: Rig): PoseDefinition {
  const jsonIssues: ValidationIssue[] = [];
  checkJson(input, '', jsonIssues);
  if (jsonIssues.length)
    throw new PoseValidationError(jsonIssues.map(({ path, message }) => ({ path: path ?? '', message })));
  const version =
    typeof input === 'object' && input !== null ? Object.getOwnPropertyDescriptor(input, 'version') : undefined;
  if (version && version.value !== POSE_FORMAT_VERSION) {
    throw new UnsupportedFormatVersionError('pose', version.value, POSE_FORMAT_VERSION);
  }
  const parsed = poseDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new PoseValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  const issues = Object.keys(parsed.data.bones)
    .filter((id) => !rig.hasBone(id))
    .map((id) => ({ path: `bones.${id}`, message: `Unknown bone "${id}".` }));
  if (issues.length) throw new PoseValidationError(issues);
  return parsed.data;
}

export function applyPoseToJoints(
  pose: PoseDefinition,
  joints: ReadonlyMap<string, Joint>,
  mix = 1,
  underlying?: Map<string, Partial<JointTransform>>,
): void {
  if (!Number.isFinite(mix) || mix < 0 || mix > 1) throw new Error('Pose mix must be between 0 and 1.');
  for (const [id, transform] of Object.entries(pose.bones)) {
    const joint = joints.get(id);
    if (!joint) throw new Error(`Unknown bone "${id}".`);
    const saved = underlying?.get(id) ?? {};
    for (const property of transformProperties) {
      const value = transform[property];
      if (value === undefined) continue;
      saved[property] = joint.pose[property];
      joint.pose[property] = lerpProperty(property, joint.pose[property], value, mix);
    }
    if (underlying) underlying.set(id, saved);
  }
}

/** Serialize authored local transforms, omitting differences no greater than epsilon. */
export function serializePose(
  name: string,
  joints: ReadonlyMap<string, Joint>,
  options: { epsilon?: number; onlyChanged?: boolean } = {},
): PoseDefinition {
  identifierSchema.parse(name);
  const epsilon = options.epsilon ?? 1e-4;
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new Error('Pose epsilon must be nonnegative and finite.');
  const bones: Record<string, Partial<JointTransform>> = {};
  for (const [id, joint] of joints) {
    const values: Partial<JointTransform> = {};
    for (const property of transformProperties) {
      const value = joint.pose[property];
      if (!Number.isFinite(value)) throw new Error(`${id}.${property} must be finite.`);
      if (options.onlyChanged === false || Math.abs(value - joint.bindPose[property]) > epsilon)
        values[property] = value;
    }
    identifierSchema.parse(id);
    if (Object.keys(values).length) bones[id] = values;
  }
  return { version: POSE_FORMAT_VERSION, name, bones };
}
