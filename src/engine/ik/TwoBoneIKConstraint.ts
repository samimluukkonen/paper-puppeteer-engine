import type { Joint } from '../Joint.js';
import type { Rig } from '../Rig.js';
import { assertFinite } from '../types.js';
import { assertBendDirection, blendIKRotation, IK_EPSILON, solveTwoBoneIK } from './solveTwoBoneIK.js';
import type {
  BendDirection, IKStatus, IKTarget, IKTargetProvider, IKTransformContext, TwoBoneIKDefinition,
} from './types.js';

/** A data-driven chain; the only rendering dependency is a coordinate adapter. */
export class TwoBoneIKConstraint {
  readonly name: string;
  readonly rootBone: string;
  readonly middleBone: string;
  readonly endBone: string;
  private endpointOffset: Readonly<IKTarget> = Object.freeze({ x: 0, y: 0 });
  private order: number;
  enabled: boolean;
  status: IKStatus = 'inactive';
  resolvedTarget: Readonly<IKTarget> | undefined;
  lengthA = 0;
  lengthB = 0;
  private influence: number;
  private bend: BendDirection;
  private point: Readonly<IKTarget> | undefined;
  private provider: IKTargetProvider | undefined;
  private readonly root: Joint;
  private readonly middle: Joint;
  private readonly end: Joint;

  constructor(definition: TwoBoneIKDefinition, rig: Rig, joints: ReadonlyMap<string, Joint>) {
    if (!definition.name) throw new Error('An IK constraint needs a name.');
    this.name = definition.name;
    this.rootBone = definition.rootBone;
    this.middleBone = definition.middleBone;
    this.endBone = definition.endBone;
    this.setEndOffset(definition.endOffset ?? { x: 0, y: 0 });
    const root = rig.getBone(this.rootBone);
    const middle = rig.getBone(this.middleBone);
    const end = rig.getBone(this.endBone);
    if (middle.parent !== root.id || end.parent !== middle.id) {
      throw new Error(`IK "${this.name}" must name three directly connected bones.`);
    }
    const getJoint = (id: string): Joint => {
      const joint = joints.get(id);
      if (!joint) throw new Error(`Missing IK joint "${id}".`);
      return joint;
    };
    this.root = getJoint(root.id);
    this.middle = getJoint(middle.id);
    this.end = getJoint(end.id);
    this.influence = 1;
    this.mix = definition.mix ?? 1;
    this.bend = 1;
    this.bendDirection = definition.bendDirection ?? 1;
    this.enabled = definition.enabled ?? true;
    this.order = 0;
    this.priority = definition.priority ?? 0;
  }

  get mix(): number { return this.influence; }
  get priority(): number { return this.order; }
  set priority(value: number) {
    assertFinite(value, `IK ${this.name}.priority`);
    this.order = value;
  }
  set mix(value: number) {
    assertFinite(value, 'IK mix');
    if (value < 0 || value > 1) throw new Error('IK mix must be between 0 and 1.');
    this.influence = value;
  }

  get bendDirection(): BendDirection { return this.bend; }
  set bendDirection(value: BendDirection) { assertBendDirection(value); this.bend = value; }

  get endOffset(): Readonly<IKTarget> { return this.endpointOffset; }
  setEndOffset(offset: IKTarget): this {
    assertFinite(offset.x, `IK ${this.name}.endOffset.x`);
    assertFinite(offset.y, `IK ${this.name}.endOffset.y`);
    this.endpointOffset = Object.freeze({ ...offset });
    return this;
  }

  get target(): Readonly<IKTarget> | undefined { return this.point; }
  set target(value: IKTarget | undefined) {
    if (value) {
      assertFinite(value.x, 'IK target.x');
      assertFinite(value.y, 'IK target.y');
    }
    this.point = value ? Object.freeze({ ...value }) : undefined;
    this.provider = undefined;
  }

  setTarget(target: IKTarget): this;
  setTarget(x: number, y: number): this;
  setTarget(targetOrX: IKTarget | number, y?: number): this {
    if (typeof targetOrX === 'number' && y === undefined) throw new Error('IK target needs x and y.');
    this.target = typeof targetOrX === 'number' ? { x: targetOrX, y: y! } : targetOrX;
    return this;
  }

  /** Evaluated immediately before this constraint, after all earlier constraints. */
  setTargetProvider(provider: IKTargetProvider | undefined): this {
    this.provider = provider;
    return this;
  }

  apply(context: IKTransformContext): void {
    this.status = 'inactive';
    this.resolvedTarget = undefined;
    if (!this.enabled || this.mix === 0) return;
    const target = this.provider ? this.provider() : this.point;
    if (!target) return;
    assertFinite(target.x, 'IK target.x');
    assertFinite(target.y, 'IK target.y');
    this.resolvedTarget = { ...target };
    const localTarget = context.worldToParent(this.rootBone, target);
    if (!localTarget) { this.status = 'singular-transform'; return; }
    const root = this.root.pose;
    const middle = this.middle.pose;
    const end = this.end.pose;
    const sx = root.scaleX;
    const sy = root.scaleY;
    if (Math.abs(sx) <= IK_EPSILON || Math.abs(sy) <= IK_EPSILON) {
      this.status = 'singular-transform';
      return;
    }
    // Arbitrary affine ancestors are removed by worldToParent. A nonuniform
    // scale INSIDE the rotating root makes the second link trace an ellipse.
    if (Math.abs(Math.abs(sx) - Math.abs(sy)) > IK_EPSILON * Math.max(Math.abs(sx), Math.abs(sy))) {
      this.status = 'unsupported-scale';
      return;
    }
    const ax = sx * middle.x;
    const ay = sy * middle.y;
    const offsetX = end.scaleX * this.endOffset.x;
    const offsetY = end.scaleY * this.endOffset.y;
    // The end bone's own rotation is not solved, so its local palm/sole point
    // has a fixed offset from the middle joint throughout this IK pass.
    const endX = end.x + Math.cos(end.rotation) * offsetX - Math.sin(end.rotation) * offsetY;
    const endY = end.y + Math.sin(end.rotation) * offsetX + Math.cos(end.rotation) * offsetY;
    const bx = sx * middle.scaleX * endX;
    const by = sy * middle.scaleY * endY;
    this.lengthA = Math.hypot(ax, ay);
    this.lengthB = Math.hypot(bx, by);
    const axisA = Math.atan2(ay, ax);
    const axisB = Math.atan2(by, bx);
    const reflection = Math.sign(sx * sy);
    const solved = solveTwoBoneIK({
      root, target: localTarget, lengthA: this.lengthA, lengthB: this.lengthB,
      bendDirection: (this.bendDirection * reflection) as BendDirection,
      fallbackRotation: root.rotation + axisA,
    });
    const rootRotation = solved.rootRotation - axisA;
    const middleRotation = reflection * (axisA + solved.middleRotation - axisB);
    root.rotation = blendIKRotation(root.rotation, rootRotation, this.mix);
    middle.rotation = blendIKRotation(middle.rotation, middleRotation, this.mix);
    this.status = solved.reachable ? 'solved' : 'clamped';
  }
}
