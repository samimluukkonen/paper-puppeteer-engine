export const transformProperties = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const;

export type TransformProperty = (typeof transformProperties)[number];

/** Local joint coordinates; rotations are radians, scales are unitless. */
export interface JointTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** The image origin is normalized (0–1), independently of its joint offset. */
export interface SpriteDefinition {
  texture: string;
  frame?: string | number;
  x?: number;
  y?: number;
  originX?: number;
  originY?: number;
  scaleX?: number;
  scaleY?: number;
  depth?: number;
}

export interface BoneDefinition extends Partial<JointTransform> {
  id: string;
  parent?: string;
  sprite?: SpriteDefinition;
  /** Render order among siblings; an entire child subtree shares this order. */
  depth?: number;
}

export interface RigDefinition {
  root: string;
  bones: readonly BoneDefinition[];
}

export type Facing = 'left' | 'right';

export interface AttachmentOptions {
  x?: number;
  y?: number;
  rotation?: number;
  depth?: number;
}

export function createTransform(values: Partial<JointTransform> = {}): JointTransform {
  return {
    x: values.x ?? 0,
    y: values.y ?? 0,
    rotation: values.rotation ?? 0,
    scaleX: values.scaleX ?? 1,
    scaleY: values.scaleY ?? 1,
  };
}

export function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
}
