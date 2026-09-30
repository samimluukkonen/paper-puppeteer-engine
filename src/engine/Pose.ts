import { z } from 'zod';
import { checkJson, UnsupportedFormatVersionError, type ValidationIssue } from './externalData.js';
import type { Joint } from './Joint.js';
import type { Rig } from './Rig.js';
import { type JointTransform, transformProperties } from './types.js';

export const POSE_FORMAT_VERSION = 1;
const finite = z.number().finite();
export const poseDefinitionSchema = z.strictObject({
  version: z.literal(POSE_FORMAT_VERSION),
  name: z.string().min(1),
  bones: z.record(
    z.string(),
    z.strictObject({
      x: finite.optional(),
      y: finite.optional(),
      rotation: finite.optional(),
      scaleX: finite.optional(),
      scaleY: finite.optional(),
    }),
  ),
});

export type PoseDefinition = z.infer<typeof poseDefinitionSchema>;

export class PoseValidationError extends Error {
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super(`Invalid pose definition:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'PoseValidationError';
  }
}

/** A pose is sparse and uses absolute local joint values, in radians for rotation. */
export function parsePoseDefinition(input: unknown, rig: Rig): PoseDefinition {
  if (typeof input === 'object' && input !== null && 'version' in input && input.version !== POSE_FORMAT_VERSION) {
    throw new UnsupportedFormatVersionError('pose', input.version, POSE_FORMAT_VERSION);
  }
  const jsonIssues: ValidationIssue[] = [];
  checkJson(input, '', jsonIssues);
  if (jsonIssues.length)
    throw new PoseValidationError(jsonIssues.map(({ path, message }) => ({ path: path ?? '', message })));
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
      joint.pose[property] += (value - joint.pose[property]) * mix;
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
  if (!name) throw new Error('Pose name is required.');
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
    if (Object.keys(values).length) bones[id] = values;
  }
  return { version: POSE_FORMAT_VERSION, name, bones };
}
