import type { AnimationEditorScene } from './AnimationEditorScene.js';
import type { OnionSkinSettings } from './onionSkinSettings.js';

const numericControls = {
  previousCount: 'animation-onion-previous-count',
  nextCount: 'animation-onion-next-count',
  frameSpacing: 'animation-onion-spacing',
  previousOpacity: 'animation-onion-previous-opacity',
  nextOpacity: 'animation-onion-next-opacity',
} as const;
const colorControls = {
  previousTint: 'animation-onion-previous-color',
  nextTint: 'animation-onion-next-color',
} as const;

/** Native preference inputs owned by this controller, independent of document transactions. */
export class OnionSkinControlsController {
  private readonly abort = new AbortController();

  constructor(app: HTMLElement, scene: Pick<AnimationEditorScene, 'getOnionSkinSettings' | 'setOnionSkinSettings'>) {
    const options = { signal: this.abort.signal };
    const enable = app.querySelector<HTMLInputElement>('#animation-onion-skinning')!;
    enable.checked = scene.getOnionSkinSettings().enabled;
    enable.addEventListener('change', () => scene.setOnionSkinSettings({ enabled: enable.checked }), options);

    for (const [key, id] of Object.entries(numericControls)) {
      const property = key as keyof typeof numericControls;
      const input = app.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = String(scene.getOnionSkinSettings()[property]);
      input.addEventListener(
        'input',
        () => {
          if (input.value === '') return;
          const patch: Partial<OnionSkinSettings> = { [property]: Number(input.value) };
          scene.setOnionSkinSettings(patch);
          input.value = String(scene.getOnionSkinSettings()[property]);
        },
        options,
      );
      input.addEventListener(
        'change',
        () => {
          input.value = String(scene.getOnionSkinSettings()[property]);
        },
        options,
      );
    }
    for (const [key, id] of Object.entries(colorControls)) {
      const property = key as keyof typeof colorControls;
      const input = app.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = `#${scene.getOnionSkinSettings()[property].toString(16).padStart(6, '0')}`;
      input.addEventListener(
        'input',
        () => {
          if (/^#[\da-f]{6}$/i.test(input.value))
            scene.setOnionSkinSettings({ [property]: Number.parseInt(input.value.slice(1), 16) });
        },
        options,
      );
    }
  }

  dispose(): void {
    this.abort.abort();
  }
}
