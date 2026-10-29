import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { MeshDiagnosticsOverlay } from '../src/devtools/shared/MeshDiagnosticsOverlay.js';
import { Puppet } from '../src/engine/Puppet.js';
import { productionMesh } from './helpers/productionMesh.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

test('overlay inspects visible selected attachments, leaves geometry intact and releases its sole resource', () => {
  const scene = puppetScene();
  const graphics = {
    scene: { cameras: { main: { zoom: 1 } } },
    setDepth: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(),
    strokeTriangle: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(),
    fillRect: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  };
  const allocate = vi.spyOn(scene.add, 'graphics').mockReturnValue(graphics as unknown as Phaser.GameObjects.Graphics);
  const { rig, mesh } = productionMesh(2);
  const puppet = new Puppet(scene, { rig, skin: 'default', autoUpdate: false });
  const object = puppet.getSlotMesh('cloth')!;
  const before = [...object.vertices];
  const overlay = new MeshDiagnosticsOverlay(scene);
  assert.include(overlay.render(puppet, mesh), 'Bones: upper, lower');
  assert.equal(graphics.strokeTriangle.mock.calls.length, 2);
  assert.deepEqual(object.vertices, before);
  puppet.setFacing('left');
  assert.notInclude(overlay.render(puppet, mesh), '1 inverted');
  puppet.getBone('upper').container.setVisible(false);
  puppet.syncPose();
  assert.include(overlay.render(puppet, mesh), 'skin displaying it');
  puppet.getBone('upper').container.setVisible(true);
  puppet.syncPose();
  puppet.clearAttachment('cloth');
  const drawn = graphics.strokeTriangle.mock.calls.length;
  assert.include(overlay.render(puppet, mesh), 'skin displaying it');
  assert.equal(graphics.strokeTriangle.mock.calls.length, drawn);
  overlay.clear();
  overlay.destroy();
  assert.equal(allocate.mock.calls.length, 1);
  assert.equal(graphics.destroy.mock.calls.length, 1);
  puppet.destroy();
});
