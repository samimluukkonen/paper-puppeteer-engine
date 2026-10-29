import { z } from 'zod';
import { composeAffine, transformToAffine, type Affine } from './affineMath.js';
import type { AnimationClip, Keyframe } from './AnimationClip.js';
import { parseAnimationClip } from './externalData.js';
import type { MeshDeformationTracks } from './meshDeformation.js';
import { Rig } from './Rig.js';
import {
  validateRigBoneMapping,
  type IdentifiedRig,
  type RigBoneMapping,
  type RigMappingIssue,
} from './rigBoneMapping.js';
import { analyzeRigCompatibility } from './rigCompatibility.js';
import { identifierSchema } from './schemas.js';
import { createTransform, transformProperties } from './types.js';

export interface RetargetOptions {
  /** Explicit new runtime asset ID. No ID generation, registration or saving occurs. */
  readonly name: string;
  /** Non-root local translation deltas; default: scale-by-bone. Skeletal root defaults to preserve-delta. */
  readonly translation?: 'preserve-delta' | 'scale-by-bone';
  /** Anatomy is caller-owned. These mapped bones override the local/root translation policy. */
  readonly pelvis?: {
    readonly sourceBoneIds: readonly string[];
    readonly translation: 'preserve-delta' | 'scale-by-character';
  };
  readonly rootMotion: 'preserve' | 'scale-by-character' | 'omit';
  /** Only FK transfer is supported. Target constraints are suppressed on the returned clip. */
  readonly ik?: 'fk-only';
}

export interface RetargetInput {
  readonly sourceAnimation: AnimationClip;
  readonly sourceRig: IdentifiedRig;
  readonly targetRig: IdentifiedRig;
  readonly boneMapping: RigBoneMapping;
  readonly options: RetargetOptions;
}

export interface RetargetSkippedTrack {
  readonly kind: 'bone' | 'ik' | 'ik-suppression' | 'root-motion' | 'mesh';
  readonly id: string;
  readonly reason: string;
}

export interface RetargetResult {
  /** Null on validation failure; successful clips are detached, editable authored data. */
  readonly animation: AnimationClip | null;
  readonly diagnostics: readonly RigMappingIssue[];
  readonly skippedTracks: readonly RetargetSkippedTrack[];
  readonly compatibilityWarnings: readonly RigMappingIssue[];
  /** Present only when a policy needs the mapped rest-edge size ratio. */
  readonly characterSizeRatio?: number;
}

const optionsSchema = z.strictObject({
  name: identifierSchema,
  translation: z.enum(['preserve-delta', 'scale-by-bone']).optional(),
  pelvis: z
    .strictObject({
      sourceBoneIds: z.array(identifierSchema),
      translation: z.enum(['preserve-delta', 'scale-by-character']),
    })
    .optional(),
  rootMotion: z.enum(['preserve', 'scale-by-character', 'omit']),
  ik: z.literal('fk-only').optional(),
});
const identity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const minimumLength = 1e-8;

/** Puppet-space rest edge lengths, including ancestor scale/rotation but excluding Actor facing/placement. */
function restEdges(rig: Rig): Map<string, number> {
  const matrices = new Map<string, Affine>();
  const distances = new Map<string, number>();
  for (const bone of rig.bones) {
    const parent = bone.parent === undefined ? undefined : matrices.get(bone.parent);
    const local = transformToAffine(createTransform(bone), identity());
    const matrix = composeAffine(local, parent, identity());
    matrices.set(bone.id, matrix);
    // Transform the offset as a vector, avoiding cancellation against a large root placement.
    if (parent)
      distances.set(
        bone.id,
        Math.hypot(parent.a * local.tx + parent.c * local.ty, parent.b * local.tx + parent.d * local.ty),
      );
  }
  return distances;
}

/** Pure FK retargeting in corresponding parent-local axes. See docs/animation-retargeting.md for policies. */
export function retargetAnimation(input: RetargetInput): RetargetResult {
  const diagnostics: RigMappingIssue[] = [];
  const skippedTracks: RetargetSkippedTrack[] = [];
  const compatibilityWarnings: RigMappingIssue[] = [];
  let characterSizeRatio: number | undefined;
  const result = (animation: AnimationClip | null): RetargetResult => ({
    animation,
    diagnostics,
    skippedTracks,
    compatibilityWarnings,
    ...(characterSizeRatio === undefined ? {} : { characterSizeRatio }),
  });
  const error = (code: string, message: string): void => {
    diagnostics.push({ code, severity: 'error', message });
  };
  const warn = (code: string, message: string): void => {
    diagnostics.push({ code, severity: 'warning', message });
  };
  const skip = (kind: RetargetSkippedTrack['kind'], id: string, reason: string): void => {
    skippedTracks.push({ kind, id, reason });
    warn(`${kind}-omitted`, `${id}: ${reason}`);
  };
  const parsedOptions = optionsSchema.safeParse(input.options);
  if (!parsedOptions.success) {
    error('invalid-options', parsedOptions.error.message);
    return result(null);
  }
  const options = parsedOptions.data;
  let source: Rig, target: Rig;
  try {
    source = new Rig(input.sourceRig.rig);
    target = new Rig(input.targetRig.rig);
  } catch (cause) {
    error('invalid-rig', String(cause));
    return result(null);
  }
  const mappingIssues = validateRigBoneMapping(input.sourceRig, input.targetRig, input.boneMapping);
  if (mappingIssues.some(({ severity }) => severity === 'error')) {
    diagnostics.push(...mappingIssues);
    return result(null);
  }
  let clip: AnimationClip;
  try {
    clip = structuredClone(parseAnimationClip({ version: 1, ...input.sourceAnimation }, source));
  } catch (cause) {
    error('invalid-source-animation', String(cause));
    return result(null);
  }
  const compatibility = analyzeRigCompatibility(input.sourceRig, input.targetRig, input.boneMapping);
  // The comparison service describes what a bone map alone permits. This operation supplies its own FK/mesh policies.
  compatibilityWarnings.push(
    ...[...compatibility.diagnostics, ...compatibility.ikDiagnostics, ...compatibility.meshDiagnostics].filter(
      ({ code }) => !['ik-track-transfer-unsupported', 'deformation-transfer-unsupported'].includes(code),
    ),
  );
  diagnostics.push(...compatibilityWarnings);
  const pairs = [...input.boneMapping.entries].sort((a, b) =>
    a.sourceBoneId < b.sourceBoneId ? -1 : a.sourceBoneId > b.sourceBoneId ? 1 : 0,
  );
  const mapped = new Map(pairs.map(({ sourceBoneId, targetBoneId }) => [sourceBoneId, targetBoneId]));
  const pelvis = new Set(options.pelvis?.sourceBoneIds ?? []);
  for (const id of pelvis)
    if (!mapped.has(id)) error('invalid-pelvis', `Pelvis bone "${id}" needs a current bone correspondence.`);
  for (const pair of pairs) {
    const a = createTransform(source.getBone(pair.sourceBoneId)),
      b = createTransform(target.getBone(pair.targetBoneId));
    for (const axis of ['scaleX', 'scaleY'] as const) {
      if (a[axis] === 0 || b[axis] === 0)
        error('singular-rest-scale', `Mapped bone "${pair.sourceBoneId}" has zero rest ${axis}.`);
      else if (Math.sign(a[axis]) !== Math.sign(b[axis]))
        error(
          'unsupported-rest-reflection',
          `Mapped bone "${pair.sourceBoneId}" changes rest ${axis} reflection. Explicit mirror conversion is required.`,
        );
    }
  }
  if (diagnostics.some(({ severity }) => severity === 'error')) return result(null);
  const sizeRatio = (): number => {
    if (characterSizeRatio !== undefined) return characterSizeRatio;
    const a = restEdges(source),
      b = restEdges(target);
    let from = 0,
      to = 0;
    for (const pair of pairs) {
      const x = a.get(pair.sourceBoneId) ?? 0,
        y = b.get(pair.targetBoneId) ?? 0;
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error(`Nonfinite puppet-space rest edge for "${pair.sourceBoneId}".`);
      if (x > minimumLength && y > minimumLength) {
        from += x;
        to += y;
      }
    }
    const ratio = to / from;
    if (
      !(
        from > minimumLength &&
        to > minimumLength &&
        Number.isFinite(from) &&
        Number.isFinite(to) &&
        Number.isFinite(ratio) &&
        ratio > 0
      )
    )
      throw new Error('Character scaling requires finite, nonzero corresponding puppet-space rest edges.');
    characterSizeRatio = ratio;
    unusualRatio(ratio, 'character');
    return ratio;
  };
  const unusualRatio = (ratio: number, id: string): void => {
    if (ratio < 0.25 || ratio > 4)
      warn(
        'unusual-proportions',
        `${id}: size ratio ${ratio} is outside [0.25, 4]. Motion is not clamped or contact-corrected.`,
      );
  };
  const tracks: Record<string, Keyframe[]> = {};
  try {
    for (const id of Object.keys(clip.tracks).sort()) {
      const targetId = mapped.get(id);
      if (targetId === undefined) {
        skip('bone', id, 'No explicit target bone correspondence.');
        continue;
      }
      const a = createTransform(source.getBone(id)),
        b = createTransform(target.getBone(targetId));
      const keys = clip.tracks[id]!;
      const hasTranslation = keys.some((key) => key.x !== undefined || key.y !== undefined);
      let ratio = 1;
      if (hasTranslation && pelvis.has(id)) {
        if (options.pelvis?.translation === 'scale-by-character') ratio = sizeRatio();
      } else if (hasTranslation && id !== source.root && (options.translation ?? 'scale-by-bone') === 'scale-by-bone') {
        const from = Math.hypot(a.x, a.y),
          to = Math.hypot(b.x, b.y);
        if (from > minimumLength && to > minimumLength && Number.isFinite(from) && Number.isFinite(to)) {
          ratio = to / from;
          if (!Number.isFinite(ratio) || ratio <= 0) throw new Error(`Invalid local translation ratio for "${id}".`);
          unusualRatio(ratio, id);
        } else
          warn(
            'degenerate-bone-length',
            `${id}: local rest offset is zero, too short or nonfinite; preserving translation deltas without scaling.`,
          );
      }
      tracks[targetId] = keys.map((key) => {
        const converted = { ...key };
        for (const property of transformProperties) {
          const value = key[property];
          if (value === undefined) continue;
          // Identity conversions retain exact numbers, including authored angular representatives.
          if (property === 'scaleX' || property === 'scaleY')
            converted[property] = a[property] === b[property] ? value : value * (b[property] / a[property]);
          else {
            const multiplier = property === 'rotation' ? 1 : ratio;
            converted[property] =
              a[property] === b[property] && multiplier === 1
                ? value
                : b[property] + (value - a[property]) * multiplier;
          }
          if (!Number.isFinite(converted[property])) throw new Error(`Retargeted ${id}.${property} is nonfinite.`);
        }
        return converted;
      });
    }
    // Root offsets are animation-local Actor displacement. They never enter FK or pelvis keys.
    let rootMotion = clip.rootMotion;
    if (rootMotion && options.rootMotion === 'omit') {
      skip('root-motion', 'rootMotion', 'Omitted by the selected root-motion policy.');
      rootMotion = undefined;
    } else if (rootMotion && options.rootMotion === 'scale-by-character') {
      const ratio = sizeRatio();
      rootMotion = {
        translationKeys: rootMotion.translationKeys.map((key) => ({
          ...key,
          ...(key.x === undefined ? {} : { x: key.x * ratio }),
          ...(key.y === undefined ? {} : { y: key.y * ratio }),
        })),
      };
    }
    for (const id of Object.keys(clip.ikTracks ?? {}).sort())
      skip(
        'ik',
        id,
        'FK-only policy omits source puppet-local IK target and mix keys. Bake source IK first to transfer its evaluated motion.',
      );
    for (const id of [...(clip.disabledIKConstraints ?? [])].sort())
      skip(
        'ik-suppression',
        id,
        'Source constraint IDs are not mapped; the result suppresses target constraints instead.',
      );
    if (source.ik?.length)
      warn(
        'source-ik-not-evaluated',
        'FK-only transfer copies authored FK motion without solving source IK, including rig default targets. Bake source IK first when its evaluated pose is needed.',
      );
    const disabledIKConstraints = (target.ik ?? []).map(({ name }) => name).sort();
    if (disabledIKConstraints.length)
      warn(
        'target-ik-disabled',
        'All target IK constraints are suppressed on this clip so default targets/providers cannot override transferred FK.',
      );
    const deformationTracks: Record<string, MeshDeformationTracks[string]> = {};
    const verifiedMeshBasis =
      compatibility.sourceRevision === compatibility.targetRevision &&
      pairs.length === source.bones.length &&
      pairs.every(({ sourceBoneId, targetBoneId }) => sourceBoneId === targetBoneId);
    for (const id of Object.keys(clip.deformationTracks ?? {}).sort()) {
      if (verifiedMeshBasis) deformationTracks[id] = clip.deformationTracks![id]!;
      else
        skip(
          'mesh',
          id,
          'Corrective vertices require identical effective rig revisions, mesh IDs/topology/bind basis and complete identity correspondence. Target skinning remains available.',
        );
    }
    if (clip.events?.some((event) => Object.hasOwn(event, 'data')))
      warn(
        'event-payload-unmapped',
        'Event payloads are copied unchanged. Application-specific source bone, constraint, mesh or asset references require caller review.',
      );
    const {
      rootMotion: _root,
      ikTracks: _ik,
      disabledIKConstraints: _disabled,
      deformationTracks: _mesh,
      ...metadata
    } = clip;
    const animation: AnimationClip = {
      ...metadata,
      name: options.name,
      tracks,
      ...(rootMotion === undefined ? {} : { rootMotion }),
      ...(disabledIKConstraints.length ? { disabledIKConstraints } : {}),
      ...(Object.keys(deformationTracks).length ? { deformationTracks } : {}),
    };
    // The same strict authored validation used for import/serialization checks the target result.
    return result(structuredClone(parseAnimationClip({ version: 1, ...animation }, target)));
  } catch (cause) {
    error('conversion-failed', String(cause));
    return result(null);
  }
}
