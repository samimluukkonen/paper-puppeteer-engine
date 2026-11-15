import {
  composeAffine,
  localToWorld,
  transformToAffine,
  worldToLocal,
  shortestRotationDelta,
  createTransform,
  transformProperties,
  type Affine,
  type JointTransform,
} from '../../engine/core.js';
import type { AnimationPose, ValidationIssue, Rig } from '../../engine/data.js';
import { type BoneSymmetryIssueCode, type BoneSymmetryMapping, validateBoneSymmetryMapping } from './boneSymmetry.js';
import { freezeData } from './editorData.js';

export type MirrorDirection = 'left-to-right' | 'right-to-left' | 'swap';

export type PoseMirrorIssueCode =
  | BoneSymmetryIssueCode
  | 'invalid-direction'
  | 'invalid-source'
  | 'invalid-transform'
  | 'singular-transform'
  | 'unsupported-scale'
  | 'unsupported-shear'
  | 'non-finite-result';

export interface PoseMirrorIssue extends ValidationIssue {
  readonly code: PoseMirrorIssueCode;
  readonly boneIds: readonly string[];
  readonly pairIndex?: number;
}

export type PoseMirrorResult =
  | { readonly success: true; readonly pose: AnimationPose; readonly issues: readonly PoseMirrorIssue[] }
  | { readonly success: false; readonly pose: null; readonly issues: readonly PoseMirrorIssue[] };

const identity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const multiply = (parent: Affine, local: Affine): Affine => composeAffine(local, parent, identity());
const linear = (matrix: Affine): Affine => ({ ...matrix, tx: 0, ty: 0 });

interface BindFrames {
  readonly bind: ReadonlyMap<string, JointTransform>;
  readonly world: ReadonlyMap<string, Affine>;
}

// Validated skeleton arrays are immutable and shared by skin-only rig copies.
// Weak ownership releases these calculations when the skeleton is no longer used.
const bindFrames = new WeakMap<Rig['bones'], BindFrames>();

function getBindFrames(rig: Rig): BindFrames {
  const cached = bindFrames.get(rig.bones);
  if (cached) return cached;
  const bind = new Map(rig.bones.map((bone) => [bone.id, createTransform(bone)]));
  const world = new Map<string, Affine>();
  for (const bone of rig.bones) {
    const local = transformToAffine(bind.get(bone.id)!, identity());
    world.set(
      bone.id,
      composeAffine(local, bone.parent === undefined ? undefined : world.get(bone.parent), identity()),
    );
  }
  const frames = { bind, world };
  bindFrames.set(rig.bones, frames);
  return frames;
}

function inverseLinear(matrix: Affine): Affine | undefined {
  const x = worldToLocal({ x: 1, y: 0 }, matrix);
  const y = worldToLocal({ x: 0, y: 1 }, matrix);
  return x && y ? { a: x.x, b: x.y, c: y.x, d: y.y, tx: 0, ty: 0 } : undefined;
}

function diagnostic(code: PoseMirrorIssueCode, message: string, boneIds: readonly string[]): PoseMirrorIssue {
  return { code, severity: 'error', message, boneIds };
}

/** Mirror a detached authored, pre-IK snapshot. Sparse properties fall back to the resolved rig bind pose.
 * Reflection uses X -> -X in canonical character bind space, carried by unchanged centerline ancestors.
 * Only mapped destination entries are replaced. Failures are atomic and never expose a partial pose.
 */
export function mirrorPose(
  pose: ReadonlyMap<string, Readonly<Partial<JointTransform>>>,
  rig: Rig,
  mapping: BoneSymmetryMapping,
  direction: MirrorDirection,
  options: { readonly sourceBoneIds?: readonly string[] } = {},
): PoseMirrorResult {
  // Mapping construction deliberately permits hierarchy warnings. Pose math needs corresponding parents.
  const issues: PoseMirrorIssue[] = validateBoneSymmetryMapping(rig, mapping).map((entry) => ({
    ...entry,
    severity: 'error',
  }));
  if (direction !== 'left-to-right' && direction !== 'right-to-left' && direction !== 'swap')
    issues.push(diagnostic('invalid-direction', 'Choose left-to-right, right-to-left or swap.', []));
  const sources = options.sourceBoneIds === undefined ? undefined : new Set(options.sourceBoneIds);
  if (sources) {
    const eligible = new Set(
      mapping.pairs.flatMap(({ leftBoneId, rightBoneId }) =>
        direction === 'left-to-right'
          ? [leftBoneId]
          : direction === 'right-to-left'
            ? [rightBoneId]
            : [leftBoneId, rightBoneId],
      ),
    );
    for (const id of sources) {
      if (!eligible.has(id))
        issues.push(
          diagnostic('invalid-source', `Bone "${id}" needs a symmetry pair on the source side of ${direction}.`, [id]),
        );
    }
  }
  if (issues.length) return failure(issues);

  const { bind, world: bindWorld } = getBindFrames(rig);
  const parentFrame = (id: string): Affine => {
    const parent = rig.getBone(id).parent;
    return parent === undefined ? identity() : linear(bindWorld.get(parent)!);
  };
  const result: AnimationPose = new Map([...pose].map(([id, values]) => [id, { ...values }]));

  const reflect = (sourceId: string, targetId: string): void => {
    const boneIds = [sourceId, targetId];
    const sourceBind = bind.get(sourceId)!;
    const targetBind = bind.get(targetId)!;
    const source = { ...sourceBind, ...pose.get(sourceId) };
    if (!transformProperties.every((property) => Number.isFinite(source[property]))) {
      issues.push(diagnostic('invalid-transform', 'The source transform must contain finite values.', boneIds));
      return;
    }
    // Retain each destination bind axis sign. Neither reflection nor artwork ownership creates a new sign.
    if (sourceBind.scaleX === 0 || sourceBind.scaleY === 0 || targetBind.scaleX === 0 || targetBind.scaleY === 0) {
      issues.push(diagnostic('singular-transform', 'Mapped bind scales must be nonzero.', boneIds));
      return;
    }
    if (source.scaleX / sourceBind.scaleX <= 0 || source.scaleY / sourceBind.scaleY <= 0) {
      issues.push(
        diagnostic('unsupported-scale', 'Zero scales and animated changes of axis sign are unsupported.', boneIds),
      );
      return;
    }
    const sourceParent = parentFrame(sourceId);
    const targetParentInverse = inverseLinear(parentFrame(targetId));
    if (!inverseLinear(sourceParent) || !targetParentInverse) {
      issues.push(diagnostic('singular-transform', 'Parent bind frames must be finite and invertible.', boneIds));
      return;
    }
    // C = inverse(B_targetParent) F B_sourceParent, using linear frames only.
    const reflection: Affine = { a: -1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const transfer = multiply(targetParentInverse, multiply(reflection, sourceParent));
    const transferInverse = inverseLinear(transfer);
    const sourceBindInverse = inverseLinear(linear(transformToAffine(sourceBind, identity())));
    if (!transferInverse || !sourceBindInverse) {
      issues.push(diagnostic('singular-transform', 'Bind-frame reflection cannot be inverted reliably.', boneIds));
      return;
    }
    // Delta = L_sourcePose inverse(L_sourceBind). Conjugate Delta, then apply to the target bind axes.
    const delta = multiply(linear(transformToAffine(source, identity())), sourceBindInverse);
    const target = multiply(
      multiply(multiply(transfer, delta), transferInverse),
      linear(transformToAffine(targetBind, identity())),
    );
    const offset = localToWorld({ x: source.x - sourceBind.x, y: source.y - sourceBind.y }, transfer);
    const scaleX = Math.hypot(target.a, target.b);
    const scaleY = Math.hypot(target.c, target.d);
    const x = targetBind.x + offset.x;
    const y = targetBind.y + offset.y;
    if (![target.a, target.b, target.c, target.d, x, y, scaleX, scaleY].every(Number.isFinite)) {
      issues.push(diagnostic('non-finite-result', 'Reflection exceeded finite transform precision.', boneIds));
      return;
    }
    if (scaleX === 0 || scaleY === 0) {
      issues.push(diagnostic('singular-transform', 'Reflected axes collapsed at the available precision.', boneIds));
      return;
    }
    const a = target.a / scaleX;
    const b = target.b / scaleX;
    const c = target.c / scaleY;
    const d = target.d / scaleY;
    if (
      Math.abs(a * c + b * d) > 1e-9 ||
      Math.sign(a * d - b * c) !== Math.sign(targetBind.scaleX) * Math.sign(targetBind.scaleY)
    ) {
      issues.push(
        diagnostic('unsupported-shear', 'Reflection requires shear that bone-local transforms cannot store.', boneIds),
      );
      return;
    }
    const angle = Math.atan2(b * Math.sign(targetBind.scaleX), a * Math.sign(targetBind.scaleX));
    const rotation = targetBind.rotation + shortestRotationDelta(targetBind.rotation, angle);
    result.set(targetId, {
      x,
      y,
      rotation,
      scaleX: scaleX * Math.sign(targetBind.scaleX),
      scaleY: scaleY * Math.sign(targetBind.scaleY),
    });
  };
  for (const { leftBoneId, rightBoneId } of mapping.pairs) {
    if (direction !== 'right-to-left' && (!sources || sources.has(leftBoneId))) reflect(leftBoneId, rightBoneId);
    if (direction !== 'left-to-right' && (!sources || sources.has(rightBoneId))) reflect(rightBoneId, leftBoneId);
  }
  return issues.length ? failure(issues) : { success: true, pose: result, issues: Object.freeze([]) };
}

function failure(issues: readonly PoseMirrorIssue[]): PoseMirrorResult {
  return { success: false, pose: null, issues: freezeData(issues) };
}
