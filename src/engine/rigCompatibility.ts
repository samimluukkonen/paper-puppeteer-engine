import { shortestRotationDelta } from './animationMath.js';
import { canonicalJson } from './authoredSerialization.js';
import { freezeData } from './readonlyData.js';
import { Rig } from './Rig.js';
import {
  rigCompatibilityRevision,
  validateRigBoneMapping,
  type BoneMappingEntry,
  type IdentifiedRig,
  type RigBoneMapping,
  type RigMappingIssue,
} from './rigBoneMapping.js';
import { createTransform, type BoneDefinition } from './types.js';

export type RigCompatibilityLevel = 'exact' | 'mappable' | 'partial' | 'incompatible';
export interface RigCompatibilityReport {
  readonly level: RigCompatibilityLevel;
  readonly sourceRevision: string;
  readonly targetRevision: string;
  readonly mappingValid: boolean;
  readonly matchingBones: readonly BoneMappingEntry[];
  readonly missingBones: readonly string[];
  readonly extraBones: readonly string[];
  readonly diagnostics: readonly RigMappingIssue[];
  readonly ikDiagnostics: readonly RigMappingIssue[];
  readonly meshDiagnostics: readonly RigMappingIssue[];
  /** A bone map never grants cross-rig IK or vertex-track transfer. */
  readonly directReuse: boolean;
}
export interface BoneMappingSuggestion {
  readonly sourceBoneId: string;
  readonly targetBoneIds: readonly string[];
  readonly reason: string;
  readonly ambiguous: boolean;
}
export interface RigMappingSuggestions {
  readonly entries: readonly BoneMappingEntry[];
  readonly suggestions: readonly BoneMappingSuggestion[];
}

function nameKey(id: string): string {
  return id
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[_.\s-]+/)
    .filter(Boolean)
    .map((token) => (token === 'l' ? 'left' : token === 'r' ? 'right' : token))
    .sort()
    .join(' ');
}

/** Proposals only: unique names plus corresponding parents, or a unique hierarchy position.
 * Equal scores and competing assignments remain unassigned for explicit user choice. */
export function suggestRigBoneMapping(source: IdentifiedRig, target: IdentifiedRig): RigMappingSuggestions {
  const a = new Rig(source.rig),
    b = new Rig(target.rig);
  const entries: BoneMappingEntry[] = [];
  const suggestions: BoneMappingSuggestion[] = [];
  const parents = new Map<string, string>();
  const used = new Set<string>();
  const childCounts = (rig: Rig) => {
    const counts = new Map<string, number>();
    for (const bone of rig.bones) if (bone.parent) counts.set(bone.parent, (counts.get(bone.parent) ?? 0) + 1);
    return counts;
  };
  const ac = childCounts(a),
    bc = childCounts(b);
  // Process complete sibling groups so iteration order cannot resolve a many-to-one ambiguity.
  const groups = new Map<string | undefined, BoneDefinition[]>();
  for (const bone of a.bones) {
    const siblings = groups.get(bone.parent) ?? [];
    siblings.push(bone);
    groups.set(bone.parent, siblings);
  }
  for (const [parent, siblings] of groups) {
    if (parent !== undefined && !parents.has(parent)) {
      for (const bone of siblings)
        suggestions.push({
          sourceBoneId: bone.id,
          targetBoneIds: [],
          reason: 'Resolve the parent mapping first.',
          ambiguous: false,
        });
      continue;
    }
    const candidates = b.bones.filter(
      (bone) => !used.has(bone.id) && bone.parent === (parent === undefined ? undefined : parents.get(parent)),
    );
    const proposed = siblings.map((bone) => {
      const ranked = candidates.map((candidate) => ({
        id: candidate.id,
        score:
          bone.parent === undefined
            ? 150
            : bone.id === candidate.id
              ? 120
              : nameKey(bone.id) === nameKey(candidate.id)
                ? 100
                : (ac.get(bone.id) ?? 0) === (bc.get(candidate.id) ?? 0)
                  ? 10
                  : 0,
      }));
      const best = Math.max(0, ...ranked.map(({ score }) => score));
      return {
        bone,
        best,
        ids: ranked
          .filter(({ score }) => score === best && best > 0)
          .map(({ id }) => id)
          .sort(),
      };
    });
    for (const proposal of proposed) {
      const { bone, best, ids } = proposal;
      const competing = ids.length === 1 && proposed.some((other) => other !== proposal && other.ids.includes(ids[0]!));
      const ambiguous = ids.length > 1 || competing;
      suggestions.push({
        sourceBoneId: bone.id,
        targetBoneIds: ids,
        ambiguous,
        reason: !ids.length
          ? 'No structural candidate.'
          : ambiguous
            ? 'Several plausible assignments; choose explicitly.'
            : bone.parent === undefined
              ? 'Root hierarchy position; review before saving.'
              : best >= 100
                ? 'Matching name and parent correspondence.'
                : 'Unique hierarchy position; review before saving.',
      });
      if (ids.length === 1 && !ambiguous) {
        entries.push({ sourceBoneId: bone.id, targetBoneId: ids[0]! });
        parents.set(bone.id, ids[0]!);
        used.add(ids[0]!);
      }
    }
  }
  return freezeData({ entries, suggestions });
}

const differs = (a: number, b: number) => Math.abs(a - b) > 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Pure structural analysis. Suggestions never establish compatibility; explicit current mappings do. */
export function analyzeRigCompatibility(
  source: IdentifiedRig,
  target: IdentifiedRig,
  mapping?: RigBoneMapping,
): RigCompatibilityReport {
  const a = new Rig(source.rig),
    b = new Rig(target.rig);
  const sourceRevision = rigCompatibilityRevision(a),
    targetRevision = rigCompatibilityRevision(b);
  const shared =
    source.id === target.id &&
    sourceRevision === targetRevision &&
    (!mapping ||
      (mapping.entries.length === a.bones.length &&
        mapping.entries.every((entry) => entry.sourceBoneId === entry.targetBoneId)));
  const mappingIssues = mapping ? validateRigBoneMapping(source, target, mapping) : [];
  const mappingValid = mapping ? !mappingIssues.some(({ severity }) => severity === 'error') : shared;
  const pairs =
    mapping?.entries ??
    a.bones.filter((bone) => b.hasBone(bone.id)).map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id }));
  const lookup = new Map(pairs.map((entry) => [entry.sourceBoneId, entry.targetBoneId]));
  const targetCounts = new Map<string, number>();
  for (const { targetBoneId } of pairs) targetCounts.set(targetBoneId, (targetCounts.get(targetBoneId) ?? 0) + 1);
  const matchingBones: BoneMappingEntry[] = [];
  const diagnostics: RigMappingIssue[] = [...mappingIssues];
  const ikDiagnostics: RigMappingIssue[] = [],
    meshDiagnostics: RigMappingIssue[] = [];
  const add = (code: string, message: string, entry?: BoneMappingEntry): void => {
    diagnostics.push({ code, message, severity: 'warning', ...entry });
  };
  const accepted = new Set<string>();
  // Root-first processing prevents mismatched ancestors from making descendants look safe.
  for (const bone of a.bones) {
    const id = lookup.get(bone.id);
    if (!id || !b.hasBone(id)) continue;
    const other = b.getBone(id);
    const pair = { sourceBoneId: bone.id, targetBoneId: id };
    if (
      (bone.parent === undefined ? undefined : lookup.get(bone.parent)) !== other.parent ||
      (bone.parent !== undefined && !accepted.has(bone.parent)) ||
      targetCounts.get(id) !== 1
    ) {
      add(
        'hierarchy-mismatch',
        `Hierarchy differs for ${bone.id} → ${id}. Inserted, collapsed or conflicting chains require manual correction.`,
        pair,
      );
      continue;
    }
    accepted.add(bone.id);
    matchingBones.push(pair);
    const x = createTransform(bone),
      y = createTransform(other);
    if (Object.keys(x).some((key) => differs(x[key as keyof typeof x], y[key as keyof typeof y])))
      add(
        'rest-pose-difference',
        `Rest transform differs for ${bone.id} → ${id}; keys are absolute local values.`,
        pair,
      );
    if (
      differs(shortestRotationDelta(x.rotation, y.rotation), 0) ||
      (Math.hypot(x.x, x.y) > 0 &&
        Math.hypot(y.x, y.y) > 0 &&
        differs(shortestRotationDelta(Math.atan2(x.y, x.x), Math.atan2(y.y, y.x)), 0))
    )
      add('orientation-difference', `Rest rotation or joint-offset direction differs for ${bone.id} → ${id}.`, pair);
    if (differs(Math.hypot(x.x, x.y), Math.hypot(y.x, y.y)) || differs(bone.length ?? 0, other.length ?? 0))
      add('proportion-difference', `Effective joint distance or explicit length differs for ${bone.id} → ${id}.`, pair);
    if (Math.sign(x.scaleX) !== Math.sign(y.scaleX) || Math.sign(x.scaleY) !== Math.sign(y.scaleY))
      add(
        'rest-reflection-difference',
        `Rest reflection differs for ${bone.id} → ${id}; actor facing is separate from bone correspondence.`,
        pair,
      );
  }
  const missingBones = a.bones.filter((bone) => !accepted.has(bone.id)).map((bone) => bone.id);
  const claimed = new Set(matchingBones.map((entry) => entry.targetBoneId));
  const extraBones = b.bones.filter((bone) => !claimed.has(bone.id)).map((bone) => bone.id);
  for (const id of missingBones)
    add('missing-bone', `Source bone "${id}" has no safe target correspondence.`, {
      sourceBoneId: id,
      targetBoneId: lookup.get(id) ?? '',
    });
  for (const id of extraBones) add('extra-bone', `Target bone "${id}" has no source correspondence.`);
  if (!mapping && !shared)
    add(
      'mapping-required',
      'Review and save an explicit bone mapping. Matching IDs or names alone do not establish a shared rig.',
    );

  for (const chain of a.ik ?? []) {
    const matches = (b.ik ?? []).filter(
      (candidate) =>
        lookup.get(chain.rootBone) === candidate.rootBone &&
        lookup.get(chain.middleBone) === candidate.middleBone &&
        lookup.get(chain.endBone) === candidate.endBone,
    );
    if (!matches.length)
      ikDiagnostics.push({
        code: 'missing-ik-chain',
        severity: 'warning',
        message: `IK "${chain.name}" has no corresponding two-bone target chain. Different or missing chain structures are unsupported.`,
      });
    else if (matches.length > 1)
      ikDiagnostics.push({
        code: 'ambiguous-ik-chain',
        severity: 'warning',
        message: `IK "${chain.name}" has several corresponding target constraints; choose a future constraint mapping explicitly.`,
      });
    else {
      const other = matches[0]!;
      if (chain.name !== other.name)
        ikDiagnostics.push({
          code: 'ik-identity-difference',
          severity: 'warning',
          message: `IK "${chain.name}" corresponds structurally to "${other.name}"; bone mapping does not rename IK tracks or suppression references.`,
        });
      if (!equal(chain, other))
        ikDiagnostics.push({
          code: 'ik-settings-difference',
          severity: 'warning',
          message: `IK "${chain.name}" differs in IDs, target, end offset, bend, mix, execution order or enabled state. Review constraint settings separately.`,
        });
      if (chain.target && !other.target)
        ikDiagnostics.push({
          code: 'missing-ik-target',
          severity: 'warning',
          message: `Target IK "${other.name}" has no authored default target.`,
        });
      const lengths = (rig: Rig, middle: string, end: string) =>
        [middle, end].map((id) => {
          const bone = rig.getBone(id);
          return Math.hypot(bone.x ?? 0, bone.y ?? 0);
        });
      if (
        lengths(a, chain.middleBone, chain.endBone).some((value, index) =>
          differs(value, lengths(b, other.middleBone, other.endBone)[index]!),
        )
      )
        ikDiagnostics.push({
          code: 'ik-length-difference',
          severity: 'warning',
          message: `IK "${chain.name}" has different effective segment lengths.`,
        });
    }
  }
  for (const chain of b.ik ?? [])
    if (
      !(a.ik ?? []).some(
        (candidate) =>
          lookup.get(candidate.rootBone) === chain.rootBone &&
          lookup.get(candidate.middleBone) === chain.middleBone &&
          lookup.get(candidate.endBone) === chain.endBone,
      )
    )
      ikDiagnostics.push({
        code: 'extra-ik-chain',
        severity: 'warning',
        message: `Target IK "${chain.name}" has no source chain; it can change evaluated motion.`,
      });
  if (!shared && ((a.ik?.length ?? 0) || (b.ik?.length ?? 0)))
    ikDiagnostics.push({
      code: 'ik-track-transfer-unsupported',
      severity: 'warning',
      message:
        'Cross-rig IK target tracks and disabled-constraint references require separate retargeting; a bone map does not transfer them.',
    });
  for (const marker of a.footContactMarkers ?? []) {
    const other = b.footContactMarkers?.find(
      (candidate) => candidate.id === marker.id && lookup.get(marker.boneId) === candidate.boneId,
    );
    if (!other || differs(marker.localX, other.localX) || differs(marker.localY, other.localY))
      add(
        'foot-marker-difference',
        `Foot marker "${marker.id}" is missing or has different bone-local coordinates; marker IDs are not mapped by bone correspondence.`,
      );
  }
  for (const marker of b.footContactMarkers ?? [])
    if (
      !(a.footContactMarkers ?? []).some(
        (candidate) => candidate.id === marker.id && lookup.get(candidate.boneId) === marker.boneId,
      )
    )
      add('extra-foot-marker', `Target foot marker "${marker.id}" has no source counterpart.`);

  for (const mesh of a.attachments.filter((attachment) => attachment.type === 'mesh')) {
    const other = b.attachments.find((attachment) => attachment.id === mesh.id);
    if (!other || other.type !== 'mesh')
      meshDiagnostics.push({
        code: 'missing-mesh',
        severity: 'warning',
        message: `Mesh "${mesh.id}" is missing on the target; no attachment or vertex mapping exists.`,
      });
    else {
      if (
        !equal(
          mesh.vertices.map(({ id, x, y, u, v }) => ({ id, x, y, u, v })),
          other.vertices.map(({ id, x, y, u, v }) => ({ id, x, y, u, v })),
        ) ||
        !equal(mesh.triangles, other.triangles) ||
        !equal(mesh.imageSize, other.imageSize)
      )
        meshDiagnostics.push({
          code: 'mesh-topology-difference',
          severity: 'warning',
          message: `Mesh "${mesh.id}" has different vertex IDs, geometry, UVs, image dimensions or triangle topology. Vertex correction tracks cannot be shared safely.`,
        });
      if (
        !equal(mesh.bindPose, other.bindPose) ||
        !equal(
          mesh.vertices.map((vertex) => vertex.influences ?? []),
          other.vertices.map((vertex) => vertex.influences ?? []),
        )
      )
        meshDiagnostics.push({
          code: 'mesh-binding-difference',
          severity: 'warning',
          message: `Mesh "${mesh.id}" has different bind transforms or bone weights; bone mapping is not vertex mapping.`,
        });
    }
  }
  for (const mesh of b.attachments.filter((attachment) => attachment.type === 'mesh'))
    if (!a.attachments.some((attachment) => attachment.id === mesh.id && attachment.type === 'mesh'))
      meshDiagnostics.push({
        code: 'extra-mesh',
        severity: 'warning',
        message: `Target mesh "${mesh.id}" has no source mesh.`,
      });
  if (!shared && [...a.attachments, ...b.attachments].some((attachment) => attachment.type === 'mesh'))
    meshDiagnostics.push({
      code: 'deformation-transfer-unsupported',
      severity: 'warning',
      message:
        'Cross-rig mesh deformation-track transfer is unsupported, including meshes with matching topology. No vertex correspondence is approved by this mapping.',
    });
  const slots = (rig: Rig) =>
    rig.slots
      .map((slot) => ({ ...slot, ...createTransform(slot) }))
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const skins = (rig: Rig) => [...rig.skins].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  if (!equal(slots(a), slots(b)) || !equal(skins(a), skins(b)))
    add(
      'skin-binding-difference',
      'Slot transforms, bone bindings or skin attachment selections differ. Bone correspondence does not remap skins or attachments.',
    );
  const invalid = mappingIssues.some(({ severity }) => severity === 'error');
  const level: RigCompatibilityLevel = invalid
    ? 'incompatible'
    : shared
      ? 'exact'
      : !accepted.has(a.root)
        ? 'incompatible'
        : !mappingValid ||
            missingBones.length ||
            ikDiagnostics.length ||
            meshDiagnostics.length ||
            diagnostics.some(({ code }) => ['foot-marker-difference', 'extra-foot-marker'].includes(code))
          ? 'partial'
          : 'mappable';
  return freezeData({
    level,
    sourceRevision,
    targetRevision,
    mappingValid,
    matchingBones,
    missingBones,
    extraBones,
    diagnostics,
    ikDiagnostics,
    meshDiagnostics,
    directReuse: shared && !invalid,
  });
}
