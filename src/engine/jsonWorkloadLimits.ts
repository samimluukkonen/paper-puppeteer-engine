import { JsonInputLimitError, validateInputLimit } from './jsonInput.js';

/** External imports have work budgets in addition to their encoded byte limits. */
export const DEFAULT_JSON_WORKLOAD_LIMITS = Object.freeze({
  maxBones: 4096,
  maxBoneDepth: 256,
  maxSlots: 4096,
  maxAttachments: 4096,
  maxIKConstraints: 256,
  maxKeyframes: 100_000,
  maxEvents: 10_000,
});

export interface JsonWorkloadLimitOptions {
  /** Maximum bones per externally loaded rig. Defaults to 4096. */
  maxBones?: number;
  /** Maximum hierarchy levels, including the root. Defaults to 256. */
  maxBoneDepth?: number;
  /** Maximum render slots per externally loaded rig. Defaults to 4096. */
  maxSlots?: number;
  /** Maximum attachment definitions per externally loaded rig. Defaults to 4096. */
  maxAttachments?: number;
  /** Maximum IK constraints per externally loaded rig. Defaults to 256. */
  maxIKConstraints?: number;
  /** Maximum bone, IK and root-motion keyframe rows combined across all loaded clips. Defaults to 100000. */
  maxKeyframes?: number;
  /** Maximum authored events combined across all loaded clips. Defaults to 10000. */
  maxEvents?: number;
}

/** Read only owned data properties; malformed shapes remain the schema validator's responsibility. */
function ownValue(input: unknown, key: string): unknown {
  if (input === null || typeof input !== 'object') return undefined;
  return Object.getOwnPropertyDescriptor(input, key)?.value;
}

/** @internal One external load owns cumulative keyframe/event budgets, before schema parsing or cloning. */
export class JsonWorkloadBudget {
  private readonly limits: Required<JsonWorkloadLimitOptions>;
  private keyframes = 0;
  private events = 0;

  constructor(options: JsonWorkloadLimitOptions = {}) {
    this.limits = {
      maxBones: validateInputLimit(options.maxBones ?? DEFAULT_JSON_WORKLOAD_LIMITS.maxBones, 'maxBones'),
      maxBoneDepth: validateInputLimit(
        options.maxBoneDepth ?? DEFAULT_JSON_WORKLOAD_LIMITS.maxBoneDepth,
        'maxBoneDepth',
      ),
      maxSlots: validateInputLimit(options.maxSlots ?? DEFAULT_JSON_WORKLOAD_LIMITS.maxSlots, 'maxSlots'),
      maxAttachments: validateInputLimit(
        options.maxAttachments ?? DEFAULT_JSON_WORKLOAD_LIMITS.maxAttachments,
        'maxAttachments',
      ),
      maxIKConstraints: validateInputLimit(
        options.maxIKConstraints ?? DEFAULT_JSON_WORKLOAD_LIMITS.maxIKConstraints,
        'maxIKConstraints',
      ),
      maxKeyframes: validateInputLimit(
        options.maxKeyframes ?? DEFAULT_JSON_WORKLOAD_LIMITS.maxKeyframes,
        'maxKeyframes',
      ),
      maxEvents: validateInputLimit(options.maxEvents ?? DEFAULT_JSON_WORKLOAD_LIMITS.maxEvents, 'maxEvents'),
    };
  }

  checkRig(input: unknown): void {
    // Bound render allocation and solver/catalog work before inspecting any entries.
    for (const [field, limit, label] of [
      ['slots', this.limits.maxSlots, 'slot'],
      ['attachments', this.limits.maxAttachments, 'attachment'],
      ['ik', this.limits.maxIKConstraints, 'IK constraint'],
    ] as const) {
      const entries = ownValue(input, field);
      if (Array.isArray(entries) && entries.length > limit)
        throw new JsonInputLimitError(`Rig exceeds the ${limit}-${label} limit.`);
    }
    const bones = ownValue(input, 'bones');
    if (!Array.isArray(bones)) return;
    if (bones.length > this.limits.maxBones)
      throw new JsonInputLimitError(`Rig exceeds the ${this.limits.maxBones}-bone limit.`);
    const parents = new Map<string, string | undefined>();
    for (let index = 0; index < bones.length; ++index) {
      const bone = ownValue(bones, String(index));
      const id = ownValue(bone, 'id');
      const parent = ownValue(bone, 'parent');
      if (typeof id === 'string') parents.set(id, typeof parent === 'string' ? parent : undefined);
    }
    const depths = new Map<string, number>();
    for (const start of parents.keys()) {
      if (depths.has(start)) continue;
      const path: string[] = [];
      const seen = new Set<string>();
      let id: string | undefined = start;
      while (id !== undefined && parents.has(id) && !depths.has(id)) {
        // Cycles and broken references are invalid schemas, rather than a reason to loop here.
        if (seen.has(id)) break;
        seen.add(id);
        path.push(id);
        if (path.length > this.limits.maxBoneDepth) this.depthExceeded();
        id = parents.get(id);
      }
      let depth = id === undefined ? 0 : (depths.get(id) ?? 0);
      for (let index = path.length - 1; index >= 0; --index) {
        ++depth;
        if (depth > this.limits.maxBoneDepth) this.depthExceeded();
        depths.set(path[index]!, depth);
      }
    }
  }

  private depthExceeded(): never {
    throw new JsonInputLimitError(`Rig exceeds the ${this.limits.maxBoneDepth}-level bone hierarchy limit.`);
  }

  checkAnimation(input: unknown): void {
    const rootKeys = ownValue(ownValue(input, 'rootMotion'), 'translationKeys');
    if (Array.isArray(rootKeys)) this.keyframes += rootKeys.length;
    if (this.keyframes > this.limits.maxKeyframes)
      throw new JsonInputLimitError(`Animation data exceeds the ${this.limits.maxKeyframes}-keyframe limit.`);
    const events = ownValue(input, 'events');
    if (Array.isArray(events)) {
      this.events += events.length;
      if (this.events > this.limits.maxEvents)
        throw new JsonInputLimitError(`Animation data exceeds the ${this.limits.maxEvents}-event limit.`);
    }
    for (const field of ['tracks', 'ikTracks']) {
      const tracks = ownValue(input, field);
      if (tracks === null || typeof tracks !== 'object' || Array.isArray(tracks)) continue;
      for (const name of Object.keys(tracks)) {
        const rows = ownValue(tracks, name);
        if (!Array.isArray(rows)) continue;
        this.keyframes += rows.length;
        if (this.keyframes > this.limits.maxKeyframes)
          throw new JsonInputLimitError(`Animation data exceeds the ${this.limits.maxKeyframes}-keyframe limit.`);
      }
    }
  }
}
