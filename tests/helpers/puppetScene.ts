import type Phaser from 'phaser';

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
  transformPoint(x: number, y: number): { x: number; y: number };
  applyInverse(x: number, y: number): { x: number; y: number };
}

/** Minimal affine scene for exercising the real Puppet and render projection pipeline. */
class Container {
  x = 0;
  y = 0;
  rotation = 0;
  scaleX = 1;
  scaleY = 1;
  alpha = 1;
  visible = true;
  depth = 0;
  isDestroyed = false;
  name = '';
  tint = 0xffffff;
  texture = { key: '' };
  frame: { name: string | number } = { name: '__BASE' };
  width = 100;
  height = 100;
  originX = 0.5;
  originY = 0.5;
  isCropped = false;
  crop: { x: number; y: number; width: number; height: number } | undefined;
  parentContainer: Container | null = null;
  readonly list: Container[] = [];

  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
  setRotation(rotation: number) {
    // Match Phaser's angle wrapping, including its floating-point rounding.
    const range = 2 * Math.PI;
    this.rotation = -Math.PI + ((((rotation + Math.PI) % range) + range) % range);
    return this;
  }
  setScale(x: number, y = x) {
    this.scaleX = x;
    this.scaleY = y;
    return this;
  }
  setAlpha(alpha: number) {
    this.alpha = alpha;
    return this;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    return this;
  }
  setDepth(depth: number) {
    this.depth = depth;
    return this;
  }
  setName(name: string) {
    this.name = name;
    return this;
  }
  setTexture(key: string, frame: string | number = '__BASE') {
    this.texture = { key };
    this.frame = { name: frame };
    return this;
  }
  setTint(tint: number) {
    this.tint = tint;
    return this;
  }
  setOrigin(x: number, y: number) {
    this.originX = x;
    this.originY = y;
    return this;
  }
  setCrop(x?: number, y = 0, width = 0, height = 0) {
    this.isCropped = x !== undefined;
    this.crop = x === undefined ? undefined : { x, y, width, height };
    return this;
  }
  sort(property: keyof Container) {
    this.list.sort((left, right) => {
      const a = left[property];
      const b = right[property];
      return typeof a === 'number' && typeof b === 'number' ? a - b : 0;
    });
    return this;
  }
  clear() {
    return this;
  }
  lineStyle() {
    return this;
  }
  lineBetween() {
    return this;
  }
  strokeCircle() {
    return this;
  }
  strokeRect() {
    return this;
  }
  fillStyle() {
    return this;
  }
  fillRoundedRect() {
    return this;
  }
  fillTriangle() {
    return this;
  }
  fillCircle() {
    return this;
  }
  once() {
    return this;
  }
  off() {
    return this;
  }
  add(child: Container) {
    child.parentContainer?.remove(child);
    child.parentContainer = this;
    this.list.push(child);
    return this;
  }
  remove(child: Container) {
    child.parentContainer = null;
    const index = this.list.indexOf(child);
    if (index !== -1) this.list.splice(index, 1);
    return this;
  }
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.parentContainer?.remove(this);
    // Destruction removes children from their parent, so iterate a snapshot.
    for (const child of this.list.slice()) child.destroy();
    this.list.length = 0;
  }

  getWorldTransformMatrix(): Matrix {
    const cos = Math.cos(this.rotation),
      sin = Math.sin(this.rotation);
    const local = {
      a: cos * this.scaleX,
      b: sin * this.scaleX,
      c: -sin * this.scaleY,
      d: cos * this.scaleY,
      tx: this.x,
      ty: this.y,
    };
    const parent = this.parentContainer?.getWorldTransformMatrix();
    const matrix = parent
      ? {
          a: parent.a * local.a + parent.c * local.b,
          b: parent.b * local.a + parent.d * local.b,
          c: parent.a * local.c + parent.c * local.d,
          d: parent.b * local.c + parent.d * local.d,
          tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
          ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
        }
      : local;
    return {
      ...matrix,
      transformPoint(x: number, y: number) {
        return { x: matrix.a * x + matrix.c * y + matrix.tx, y: matrix.b * x + matrix.d * y + matrix.ty };
      },
      applyInverse(x: number, y: number) {
        const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
        return {
          x: (matrix.d * (x - matrix.tx) - matrix.c * (y - matrix.ty)) / determinant,
          y: (-matrix.b * (x - matrix.tx) + matrix.a * (y - matrix.ty)) / determinant,
        };
      },
    };
  }
}

export function puppetScene(): Phaser.Scene {
  const makeContainer = (x = 0, y = 0) => Object.assign(new Container().setPosition(x, y), { scene });
  const scene = {
    add: {
      container: makeContainer,
      image: (x: number, y: number, texture: string, frame?: string | number) =>
        makeContainer(x, y).setTexture(texture, frame),
      graphics: makeContainer,
      text: (x = 0, y = 0) => new Container().setPosition(x, y),
    },
    scale: { width: 760, height: 640 },
    textures: { exists: () => true },
    events: { on() {}, once() {}, off() {} },
  } as unknown as Phaser.Scene;
  return scene;
}
