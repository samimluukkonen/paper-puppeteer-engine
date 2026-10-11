import Phaser from 'phaser';
import { type AttachmentOptions, assertFinite } from './types.js';

/** Owns prop wrappers and destruction listeners; the host owns the rendered mounts. */
export class PuppetAttachments {
  private readonly mounts = new Map<Phaser.GameObjects.GameObject, Phaser.GameObjects.Container>();
  private disposed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getBoneContainer: (boneId: string) => Phaser.GameObjects.Container,
    private readonly getRenderMount: (boneId: string, slotId?: string) => Phaser.GameObjects.Container,
  ) {}

  attach(boneId: string, object: Phaser.GameObjects.GameObject, options: AttachmentOptions, slotId?: string): void {
    const bone = this.getBoneContainer(boneId);
    if (object.scene !== this.scene) throw new Error('Attachments must belong to the puppet scene.');
    this.assertNotAncestor(object, bone, 'Cannot attach an ancestor of the target bone.');
    for (const [label, value] of Object.entries(options) as [string, number][])
      assertFinite(value, `Attachment ${label}`);
    const renderMount = this.getRenderMount(boneId, slotId);
    this.assertNotAncestor(object, renderMount, 'Cannot attach an ancestor of the render mount.');
    this.detach(object);
    // A wrapper permits any Phaser GameObject without changing its own transform.
    const mount = this.scene.add
      .container(options.x ?? 0, options.y ?? 0)
      .setRotation(options.rotation ?? 0)
      .setDepth(options.depth ?? 1);
    mount.add(object);
    renderMount.add(mount).sort('depth');
    this.mounts.set(object, mount);
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    object.once(Phaser.GameObjects.Events.DESTROY, this.onDestroyed, this);
  }

  private assertNotAncestor(
    object: Phaser.GameObjects.GameObject,
    container: Phaser.GameObjects.Container,
    message: string,
  ): void {
    for (let ancestor: Phaser.GameObjects.Container | null = container; ancestor; ancestor = ancestor.parentContainer)
      if (ancestor === object) throw new Error(message);
  }

  private onDestroyed(object: Phaser.GameObjects.GameObject): void {
    const mount = this.mounts.get(object);
    if (!mount) return;
    this.mounts.delete(object);
    // Phaser removes the child first. Its wrapper may already be tearing down.
    if (!this.disposed && !mount.isDestroyed) mount.destroy();
  }

  /** Release to the scene display list; the object's local transform is retained. */
  detach(object: Phaser.GameObjects.GameObject): boolean {
    const mount = this.mounts.get(object);
    if (!mount) return false;
    // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
    object.off(Phaser.GameObjects.Events.DESTROY, this.onDestroyed, this);
    mount.remove(object);
    mount.destroy();
    this.mounts.delete(object);
    return true;
  }

  /** Release listeners before the host destroys render mounts and their attached props. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const object of this.mounts.keys())
      // oxlint-disable-next-line typescript/unbound-method -- Phaser uses the explicit listener context supplied below.
      object.off(Phaser.GameObjects.Events.DESTROY, this.onDestroyed, this);
    this.mounts.clear();
  }
}
