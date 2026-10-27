import type { TwoBoneIKDefinition } from './ik/types.js';

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
  /** Logical distance to direct child joints, independent of sprite dimensions. */
  length?: number;
  sprite?: SpriteDefinition;
  /** Render order among siblings; an entire child subtree shares this order. */
  depth?: number;
}

export interface SlotDefinition extends Partial<JointTransform> {
  id: string;
  bone: string;
  /** Global draw depth. Omitted slots follow their bone's render order. */
  depth?: number;
}

export interface AttachmentDefinitionBase {
  id: string;
  texture: string;
  frame?: string | number;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  originX?: number;
  originY?: number;
  /** Sole contact points in normalized image coordinates (0–1, measured from the top left). */
  groundContacts?: readonly { readonly x: number; readonly y: number }[];
}

/** Omitted type is the original rigid sprite format. */
export interface SpriteAttachmentDefinition extends AttachmentDefinitionBase {
  type?: 'sprite';
}

export interface MeshVertex {
  id: string;
  /** Unscaled attachment-local bind position, with the image pivot already subtracted. */
  x: number;
  y: number;
  /** Normalized image coordinates, top left (0, 0), bottom right (1, 1). */
  u: number;
  v: number;
}

/** Effective authored rest transforms, independent of live joints, animation and camera state. */
export interface MeshBindPose {
  version: 1;
  root: string;
  bones: readonly (JointTransform & { id: string; parent?: string })[];
  slots: readonly (JointTransform & { id: string; bone: string })[];
  attachment: JointTransform;
}

export interface MeshAttachmentDefinition extends AttachmentDefinitionBase {
  type: 'mesh';
  /** Mesh format version is independent of the enclosing version-1 rig. */
  meshVersion: 1;
  /** Whole images only in the foundation format; atlas/trimmed frames need explicit future support. */
  frame?: never;
  imageSize: { readonly width: number; readonly height: number };
  vertices: readonly MeshVertex[];
  /** Triples index the authored vertex array. Positive signed area is clockwise in Y-down coordinates. */
  triangles: readonly number[];
  bindPose: MeshBindPose;
}

export type AttachmentDefinition = SpriteAttachmentDefinition | MeshAttachmentDefinition;

export interface SkinDefinition {
  version: 1;
  name: string;
  /** An omitted slot inherits the base skin when applied as an override. */
  slots: Readonly<Record<string, string | null>>;
}

/** Artist-authored reference point in bone-local units, independent of artwork and IK. */
export interface FootContactMarker {
  id: string;
  name: string;
  boneId: string;
  localX: number;
  localY: number;
}

export interface RigDefinition {
  footContactMarkers?: readonly FootContactMarker[];
  /** Stable constraint names are animation IK track identifiers. */
  ik?: readonly TwoBoneIKDefinition[];
  root: string;
  bones: readonly BoneDefinition[];
  slots?: readonly SlotDefinition[];
  attachments?: readonly AttachmentDefinition[];
  skins?: readonly SkinDefinition[];
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
