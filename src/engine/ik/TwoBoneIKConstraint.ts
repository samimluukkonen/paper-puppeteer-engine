import { interpolateNumber } from '../animationMath.js';
import type { Joint } from '../Joint.js';
import type { Rig } from '../Rig.js';
import { twoBoneIKDefinitionSchema } from '../schemas.js';
import { assertFinite } from '../types.js';
import type { IKAnimationValues } from './AnimationIKPose.js';
import { assertBendDirection, blendIKRotation, IK_EPSILON, solveTwoBoneIK } from './solveTwoBoneIK.js';
import type {
  BendDirection,
  IKStatus,
  IKTarget,
  IKTargetProvider,
  IKTransformContext,
  TwoBoneIKDefinition,
} from './types.js';

/** Validate chain data and rig references without allocating renderer objects. */
export function parseTwoBoneIKDefinition(definition: TwoBoneIKDefinition, rig: Rig): TwoBoneIKDefinition {
  const parsed = twoBoneIKDefinitionSchema.parse(definition);
  const root = rig.getBone(parsed.rootBone);
  const middle = rig.getBone(parsed.middleBone);
  const end = rig.getBone(parsed.endBone);
  if (middle.parent !== root.id || end.parent !== middle.id) {
    throw new Error(`IK "${parsed.name}" must name three directly connected bones.`);
  }
  return parsed;
}

/** A data-driven chain; the only rendering dependency is a coordinate adapter. */
export class TwoBoneIKConstraint {
  readonly name: string;
  readonly rootBone: string;
  readonly middleBone: string;
  readonly endBone: string;
  private endpointOffset: Readonly<IKTarget> = Object.freeze({ x: 0, y: 0 });
  private order: number;
  private active = true;
  private revision = 0;
  status: IKStatus = 'inactive';
  resolvedTarget: Readonly<IKTarget> | undefined;
  lengthA = 0;
  lengthB = 0;
  private influence: number;
  private mixOverride = false;
  private bend: BendDirection;
  private readonly defaultTarget: Readonly<IKTarget> | undefined;
  private point: Readonly<IKTarget> | undefined;
  private provider: IKTargetProvider | undefined;
  private disposed = false;
  private readonly root: Joint;
  private readonly middle: Joint;
  private readonly end: Joint;

  constructor(definition: TwoBoneIKDefinition, rig: Rig, joints: ReadonlyMap<string, Joint>) {
    definition = parseTwoBoneIKDefinition(definition, rig);
    this.name = definition.name;
    this.defaultTarget = definition.target ? Object.freeze({ ...definition.target }) : undefined;
    this.rootBone = definition.rootBone;
    this.middleBone = definition.middleBone;
    this.endBone = definition.endBone;
    this.setEndOffset(definition.endOffset ?? { x: 0, y: 0 });
    const getJoint = (id: string): Joint => {
      const joint = joints.get(id);
      if (!joint) throw new Error(`Missing IK joint "${id}".`);
      return joint;
    };
    this.root = getJoint(this.rootBone);
    this.middle = getJoint(this.middleBone);
    this.end = getJoint(this.endBone);
    this.influence = definition.mix ?? 1;
    this.bend = 1;
    this.bendDirection = definition.bendDirection ?? 1;
    this.enabled = definition.enabled ?? true;
    this.order = 0;
    this.priority = definition.priority ?? 0;
  }

  get mix(): number {
    return this.influence;
  }
  /** @internal Changes to runtime ownership/settings, independent of solved pose and playback time. */
  get configurationRevision(): number {
    return this.revision;
  }
  get enabled(): boolean {
    return this.active;
  }
  set enabled(value: boolean) {
    if (this.active !== value) this.revision++;
    this.active = value;
  }
  get isDisposed(): boolean {
    return this.disposed;
  }
  get priority(): number {
    return this.order;
  }
  set priority(value: number) {
    this.assertActive();
    assertFinite(value, `IK ${this.name}.priority`);
    if (this.order !== value) this.revision++;
    this.order = value;
  }
  set mix(value: number) {
    this.assertActive();
    assertFinite(value, 'IK mix');
    if (value < 0 || value > 1) throw new Error('IK mix must be between 0 and 1.');
    if (this.influence !== value || !this.mixOverride) this.revision++;
    this.influence = value;
    this.mixOverride = true;
  }

  /** Return influence ownership to animation while retaining the current static fallback mix. */
  clearMixOverride(): this {
    this.assertActive();
    if (this.mixOverride) this.revision++;
    this.mixOverride = false;
    return this;
  }

  /** Explicit runtime influence ownership, even when its numeric value equals the rig default. */
  get hasMixOverride(): boolean {
    return this.mixOverride;
  }

  get bendDirection(): BendDirection {
    return this.bend;
  }
  set bendDirection(value: BendDirection) {
    this.assertActive();
    assertBendDirection(value);
    if (this.bend !== value) this.revision++;
    this.bend = value;
  }

  get endOffset(): Readonly<IKTarget> {
    return this.endpointOffset;
  }
  setEndOffset(offset: IKTarget): this {
    this.assertActive();
    assertFinite(offset.x, `IK ${this.name}.endOffset.x`);
    assertFinite(offset.y, `IK ${this.name}.endOffset.y`);
    if (this.endpointOffset.x !== offset.x || this.endpointOffset.y !== offset.y) this.revision++;
    this.endpointOffset = Object.freeze({ ...offset });
    return this;
  }

  /** Read-only position ownership, including providers which currently return no target. */
  get targetOwnership(): 'provider' | 'runtime' | 'animation' {
    return this.provider ? 'provider' : this.point ? 'runtime' : 'animation';
  }

  get target(): Readonly<IKTarget> | undefined {
    return this.point;
  }
  /** Current host callback, retained when an editor rebuilds its preview skeleton. */
  get targetProvider(): IKTargetProvider | undefined {
    return this.provider;
  }
  set target(value: IKTarget | undefined) {
    this.assertActive();
    if (value) {
      assertFinite(value.x, 'IK target.x');
      assertFinite(value.y, 'IK target.y');
    }
    if (this.provider || this.point?.x !== value?.x || this.point?.y !== value?.y) this.revision++;
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
    this.assertActive();
    if (this.provider !== provider) this.revision++;
    this.provider = provider;
    return this;
  }

  apply(context: IKTransformContext, animation?: IKAnimationValues): void {
    if (this.disposed) return;
    this.status = 'inactive';
    this.resolvedTarget = undefined;
    if (!this.enabled || (animation?.disabled?.value ?? 0) * (animation?.disabled?.weight ?? 0) >= 1) return;
    let mix = this.mix;
    if (!this.provider && !this.mixOverride && animation?.mix)
      mix = interpolateNumber(mix, animation.mix.value, animation.mix.weight);
    mix *= 1 - (animation?.disabled?.value ?? 0) * (animation?.disabled?.weight ?? 0);
    if (mix === 0) return;
    let target: Readonly<IKTarget> | undefined;
    if (this.provider || this.point) {
      // Explicit world targets own position; late-bound specialized providers also own influence.
      target = this.provider ? this.provider() : this.point;
    } else if (
      context.puppetToWorld &&
      (this.defaultTarget || ((animation?.x || animation?.y) && context.worldToPuppet && context.endToWorld))
    ) {
      const fallback = this.defaultTarget ?? context.worldToPuppet!(context.endToWorld!(this.endBone, this.endOffset));
      if (!fallback) {
        this.status = 'singular-transform';
        return;
      }
      target = context.puppetToWorld({
        x: animation?.x ? interpolateNumber(fallback.x, animation.x.value, animation.x.weight) : fallback.x,
        y: animation?.y ? interpolateNumber(fallback.y, animation.y.value, animation.y.weight) : fallback.y,
      });
      // When a sparse target fades away, restore ordinary authored bone control.
      if (!this.defaultTarget) mix *= Math.max(animation?.x?.weight ?? 0, animation?.y?.weight ?? 0);
    }
    if (!target || mix === 0) return;
    assertFinite(target.x, 'IK target.x');
    assertFinite(target.y, 'IK target.y');
    this.resolvedTarget = Object.freeze({ ...target });
    const localTarget = context.worldToParent(this.rootBone, target);
    if (!localTarget) {
      this.status = 'singular-transform';
      return;
    }
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
      root,
      target: localTarget,
      lengthA: this.lengthA,
      lengthB: this.lengthB,
      bendDirection: (this.bendDirection * reflection) as BendDirection,
      fallbackRotation: root.rotation + axisA,
    });
    const rootRotation = solved.rootRotation - axisA;
    const middleRotation = reflection * (axisA + solved.middleRotation - axisB);
    root.rotation = blendIKRotation(root.rotation, rootRotation, mix);
    middle.rotation = blendIKRotation(middle.rotation, middleRotation, mix);
    this.status = solved.reachable ? 'solved' : 'clamped';
  }

  /** Release the host's target callback. Puppet calls this for every owned constraint on destruction. */
  dispose(): void {
    if (this.disposed) return;
    this.revision++;
    this.disposed = true;
    this.provider = undefined;
    this.point = undefined;
    this.resolvedTarget = undefined;
    this.enabled = false;
    this.status = 'inactive';
  }

  private assertActive(): void {
    if (this.disposed) throw new Error(`IK "${this.name}" has been disposed.`);
  }
}
