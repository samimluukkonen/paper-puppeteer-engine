import { Bone } from '../../src/engine/Bone.js';
import { PuppetRenderer } from '../../src/engine/PuppetRenderer.js';
import { Rig } from '../../src/engine/Rig.js';
import type { RigDefinition } from '../../src/engine/types.js';
import { puppetScene } from './puppetScene.js';

/** Count actual renderer allocations while retaining the affine scene's transform behavior. */
export function rendererFixture(definition: RigDefinition) {
  const scene = puppetScene();
  const allocations = { containers: 0, projections: 0 };
  const addContainer = scene.add.container.bind(scene.add);
  scene.add.container = (x, y) => {
    allocations.containers += 1;
    const container = addContainer(x, y);
    const setName = container.setName.bind(container);
    container.setName = (name) => {
      if (name.startsWith('pose-') || name.startsWith('render-')) allocations.projections += 1;
      return setName(name);
    };
    return container;
  };
  const rig = new Rig(definition);
  const parent = scene.add.container(0, 0);
  const bones = new Map<string, Bone>();
  for (const definition of rig.bones) {
    const bone = new Bone(scene, definition);
    bones.set(bone.id, bone);
    (bone.parentId === undefined ? parent : bones.get(bone.parentId)!.container).add(bone.container);
  }
  const renderer = new PuppetRenderer(scene, parent, rig, bones);
  return { renderer, rig, scene, parent, bones, allocations };
}
