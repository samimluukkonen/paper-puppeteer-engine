export interface IKTarget {
  x: number;
  y: number;
}

export type BendDirection = 1 | -1;
export type IKTargetProvider = () => IKTarget | undefined;

export interface TwoBoneIKDefinition {
  /** Stable rig constraint identifier, also used by authored animation IK tracks. */
  name: string;
  rootBone: string;
  middleBone: string;
  endBone: string;
  /** Point on the end bone to place at the target, in end-bone local coordinates. Defaults to its joint origin. */
  endOffset?: IKTarget;
  /** Signed turn from the first segment to the second, in rig space. */
  bendDirection?: BendDirection;
  mix?: number;
  enabled?: boolean;
  /** Lower priorities run first. Equal priorities retain registration order. */
  priority?: number;
}

/** Renderer adapter; a singular parent transform returns undefined. */
export interface IKTransformContext {
  /** Optional animated-target adapter; omitted adapters retain static runtime behavior. */
  puppetToWorld?(target: IKTarget): IKTarget;
  worldToPuppet?(target: IKTarget): IKTarget | undefined;
  endToWorld?(boneId: string, offset: IKTarget): IKTarget;
  worldToParent(boneId: string, target: IKTarget): IKTarget | undefined;
}

export type IKStatus = 'inactive' | 'solved' | 'clamped' | 'singular-transform' | 'unsupported-scale';
