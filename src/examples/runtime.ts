import type Phaser from 'phaser';
import { loadSceneCharacter, Puppet } from '../engine/runtime.js';

/** Minimal runtime consumer for the shipped demo-puppet character. The host owns scene textures. */
export async function runRuntimeExample(scene: Phaser.Scene, url: string): Promise<void> {
  const definition = await loadSceneCharacter(scene, url);
  if (!definition) return; // The scene shut down during loading.
  const puppet = new Puppet(scene, { definition, autoUpdate: false });
  const unsubscribe = puppet.onAnimationEvent((event) => console.info(event.clip, event.name));
  try {
    puppet.play('idle');
    puppet.update(250);
    puppet.play('walk', { fadeDuration: 150 });
    puppet.update(150);
    puppet.setSkin(definition.defaultSkin);
  } finally {
    unsubscribe();
    puppet.destroy();
  }
  // Release host-owned textures only after every puppet using them is destroyed.
}
