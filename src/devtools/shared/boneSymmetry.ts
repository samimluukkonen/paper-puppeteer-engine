import type { ValidationIssue } from '../../engine/externalData.js';
import { readonlyMap } from '../../engine/readonlyData.js';
import type { Rig } from '../../engine/Rig.js';
import { freezeData } from './editorData.js';

export interface BoneSymmetryPair {
  readonly leftBoneId: string;
  readonly rightBoneId: string;
}

/** Data-only editor metadata suitable for future persistence; never part of rig or animation JSON. */
export interface BoneSymmetryMappingData {
  readonly pairs: readonly BoneSymmetryPair[];
}

/** A mapping belongs to one loaded rig session. Reloaded rigs require explicit validation and rebinding. */
export interface BoneSymmetryMapping extends BoneSymmetryMappingData {
  readonly rig: Rig;
  readonly unpairedBoneIds: readonly string[];
  getMirroredBoneId(boneId: string): string | null;
}

export type BoneSymmetryIssueCode =
  | 'rig-mismatch'
  | 'missing-bone'
  | 'self-pair'
  | 'duplicate-pair'
  | 'multiple-partners'
  | 'invalid-reciprocal'
  | 'ambiguous-name'
  | 'ambiguous-match'
  | 'ancestor-pair'
  | 'parent-mismatch';

export interface BoneSymmetryIssue extends ValidationIssue {
  readonly code: BoneSymmetryIssueCode;
  readonly boneIds: readonly string[];
  readonly pairIndex?: number;
}

export interface BoneSymmetryCandidates extends BoneSymmetryMappingData {
  readonly issues: readonly BoneSymmetryIssue[];
}

export interface BoneSymmetryMappingOptions {
  readonly manualPairs?: readonly BoneSymmetryPair[];
  /** Only explicitly supplied candidates are accepted. Inference alone does not install a mapping. */
  readonly automaticCandidates?: readonly BoneSymmetryPair[];
}

export type BoneSymmetryMappingResult =
  | { readonly success: true; readonly mapping: BoneSymmetryMapping; readonly issues: readonly BoneSymmetryIssue[] }
  | { readonly success: false; readonly mapping: null; readonly issues: readonly BoneSymmetryIssue[] };

const compareIds = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const pairIds = (pair: BoneSymmetryPair): readonly string[] => [pair.leftBoneId, pair.rightBoneId];
const pairKey = (pair: BoneSymmetryPair): string => JSON.stringify(pairIds(pair));

function issue(
  code: BoneSymmetryIssueCode,
  severity: BoneSymmetryIssue['severity'],
  message: string,
  boneIds: readonly string[],
  pairIndex?: number,
): BoneSymmetryIssue {
  return {
    code,
    severity,
    message,
    boneIds: [...boneIds],
    ...(pairIndex === undefined ? {} : { pairIndex, path: `pairs[${pairIndex}]` }),
  };
}

function indexPairs(pairs: readonly BoneSymmetryPair[]): ReadonlyMap<string, string> {
  return readonlyMap(
    pairs.flatMap(({ leftBoneId, rightBoneId }) => [
      [leftBoneId, rightBoneId],
      [rightBoneId, leftBoneId],
    ]),
  );
}

/** Structural errors block construction; hierarchy compatibility is advisory for asymmetrical rigs. */
export function validateBoneSymmetryMapping(
  rig: Rig,
  data: BoneSymmetryMappingData | BoneSymmetryMapping,
): readonly BoneSymmetryIssue[] {
  const issues: BoneSymmetryIssue[] = [];
  if ('rig' in data && data.rig !== rig)
    issues.push(issue('rig-mismatch', 'error', 'The symmetry mapping belongs to a different rig session.', []));
  const seen = new Set<string>();
  const assignments = new Map<string, string>();
  data.pairs.forEach((pair, pairIndex) => {
    const { leftBoneId, rightBoneId } = pair;
    for (const id of pairIds(pair)) {
      if (!rig.hasBone(id))
        issues.push(issue('missing-bone', 'error', `Bone "${id}" does not exist in the current rig.`, [id], pairIndex));
    }
    if (leftBoneId === rightBoneId)
      issues.push(
        issue('self-pair', 'error', `Bone "${leftBoneId}" cannot be paired with itself.`, [leftBoneId], pairIndex),
      );
    if (seen.has(pairKey(pair)))
      issues.push(
        issue('duplicate-pair', 'error', 'This symmetry pair is assigned more than once.', pairIds(pair), pairIndex),
      );
    if (seen.has(pairKey({ leftBoneId: rightBoneId, rightBoneId: leftBoneId })) && leftBoneId !== rightBoneId)
      issues.push(
        issue(
          'invalid-reciprocal',
          'error',
          'A reciprocal pair must not reverse the left/right assignments.',
          pairIds(pair),
          pairIndex,
        ),
      );
    seen.add(pairKey(pair));
    for (const [id, partner] of [
      [leftBoneId, rightBoneId],
      [rightBoneId, leftBoneId],
    ] as const) {
      const previous = assignments.get(id);
      if (previous !== undefined && previous !== partner)
        issues.push(
          issue(
            'multiple-partners',
            'error',
            `Bone "${id}" is assigned to several partners.`,
            [id, previous, partner],
            pairIndex,
          ),
        );
      assignments.set(id, partner);
    }
  });
  // Never derive compatibility from an inconsistent or incomplete lookup.
  if (issues.some((entry) => entry.severity === 'error')) return freezeData(issues);
  const partners = indexPairs(data.pairs);
  if ('getMirroredBoneId' in data && typeof data.getMirroredBoneId === 'function') {
    for (const { id } of rig.bones) {
      if (data.getMirroredBoneId(id) !== (partners.get(id) ?? null))
        issues.push(
          issue('invalid-reciprocal', 'error', `The lookup for bone "${id}" does not agree with the symmetry pairs.`, [
            id,
          ]),
        );
    }
    if (issues.length) return freezeData(issues);
  }
  const isAncestor = (ancestor: string, descendant: string): boolean => {
    let parent = rig.getBone(descendant).parent;
    while (parent !== undefined) {
      if (parent === ancestor) return true;
      parent = rig.getBone(parent).parent;
    }
    return false;
  };
  data.pairs.forEach((pair, pairIndex) => {
    const { leftBoneId, rightBoneId } = pair;
    if (isAncestor(leftBoneId, rightBoneId) || isAncestor(rightBoneId, leftBoneId))
      issues.push(
        issue(
          'ancestor-pair',
          'warning',
          'Paired bones are ancestors of each other; future pose mirroring may be incompatible.',
          pairIds(pair),
          pairIndex,
        ),
      );
    const leftParent = rig.getBone(leftBoneId).parent;
    const rightParent = rig.getBone(rightBoneId).parent;
    // An unpaired shared parent is a conservative centerline. Otherwise parents must correspond.
    const expectedParent = leftParent === undefined ? undefined : (partners.get(leftParent) ?? leftParent);
    if (expectedParent !== rightParent)
      issues.push(
        issue(
          'parent-mismatch',
          'warning',
          'Paired bones do not have corresponding parents; review the hierarchy before mirroring.',
          pairIds(pair),
          pairIndex,
        ),
      );
  });
  return freezeData(issues);
}

/** Own an immutable mapping and a single reciprocal index, with manual assignments taking precedence. */
export function createBoneSymmetryMapping(
  rig: Rig,
  options: BoneSymmetryMappingOptions = {},
): BoneSymmetryMappingResult {
  const manualPairs = options.manualPairs ?? [];
  const manualIssues = validateBoneSymmetryMapping(rig, { pairs: manualPairs });
  if (manualIssues.some((entry) => entry.severity === 'error'))
    return Object.freeze({ success: false, mapping: null, issues: manualIssues });
  const claimed = new Set(manualPairs.flatMap(pairIds));
  const pairs = [
    ...manualPairs,
    ...(options.automaticCandidates ?? []).filter((pair) => !pairIds(pair).some((id) => claimed.has(id))),
  ].map((pair) => ({ ...pair }));
  const issues = validateBoneSymmetryMapping(rig, { pairs });
  if (issues.some((entry) => entry.severity === 'error'))
    return Object.freeze({ success: false, mapping: null, issues });
  const partners = indexPairs(pairs);
  const mapping: BoneSymmetryMapping = Object.freeze({
    rig,
    pairs: freezeData(pairs),
    unpairedBoneIds: Object.freeze(
      rig.bones
        .map((bone) => bone.id)
        .filter((id) => !partners.has(id))
        .sort(compareIds),
    ),
    getMirroredBoneId: (boneId: string) => partners.get(boneId) ?? null,
  });
  return Object.freeze({ success: true, mapping, issues });
}

/** Split full tokens, including camel/Pascal case and acronyms, without replacing arbitrary substrings. */
function nameTokens(id: string): readonly string[] {
  return id
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_.\s-]+/)
    .filter(Boolean);
}

function sideOf(token: string): 'left' | 'right' | null {
  if (token.toLowerCase() === 'left' || token === 'L') return 'left';
  if (token.toLowerCase() === 'right' || token === 'R') return 'right';
  return null;
}

/** Return candidates only. Case/delimiter aliases and multiple side tokens require manual resolution. */
export function inferBoneSymmetryPairs(
  rig: Rig,
  manualPairs: readonly BoneSymmetryPair[] = [],
): BoneSymmetryCandidates {
  const manualIssues = validateBoneSymmetryMapping(rig, { pairs: manualPairs });
  if (manualIssues.some((entry) => entry.severity === 'error')) return freezeData({ pairs: [], issues: manualIssues });
  const claimed = new Set(manualPairs.flatMap(pairIds));
  const groups = new Map<string, { left: string[]; right: string[] }>();
  const issues: BoneSymmetryIssue[] = [];
  for (const id of rig.bones.map((bone) => bone.id).sort(compareIds)) {
    if (claimed.has(id)) continue;
    const tokens = nameTokens(id);
    const sides = tokens.map(sideOf).filter((side) => side !== null);
    if (!sides.length || tokens.length === 1) continue;
    if (sides.length > 1) {
      issues.push(
        issue('ambiguous-name', 'warning', `Bone "${id}" contains several side tokens. Define its pair manually.`, [
          id,
        ]),
      );
      continue;
    }
    const key = JSON.stringify(tokens.map((token) => (sideOf(token) ? '<side>' : token.toLowerCase())));
    const group = groups.get(key) ?? { left: [], right: [] };
    group[sides[0]!].push(id);
    groups.set(key, group);
  }
  const pairs: BoneSymmetryPair[] = [];
  for (const key of [...groups.keys()].sort(compareIds)) {
    const group = groups.get(key)!;
    if (group.left.length > 1 || group.right.length > 1) {
      const ids = [...group.left, ...group.right].sort(compareIds);
      issues.push(
        issue(
          'ambiguous-match',
          'warning',
          'Several bones share the same side-aware name. Define their pairs manually.',
          ids,
        ),
      );
    } else if (group.left.length === 1 && group.right.length === 1) {
      pairs.push({ leftBoneId: group.left[0]!, rightBoneId: group.right[0]! });
    }
  }
  pairs.sort((a, b) => compareIds(a.leftBoneId, b.leftBoneId) || compareIds(a.rightBoneId, b.rightBoneId));
  return freezeData({ pairs, issues });
}
