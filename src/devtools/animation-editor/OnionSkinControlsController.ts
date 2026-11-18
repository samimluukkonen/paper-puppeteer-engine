import { requireElement } from '../shared/editorElements.js';
import type { AnimationEditorScene } from './AnimationEditorScene.js';
import { ANIMATION_IDS } from './elementIds.js';
import type { OnionSkinSettings } from './onionSkinSettings.js';

const numericControls = {
  previousCount: ANIMATION_IDS.onionPreviousCount,
  nextCount: ANIMATION_IDS.onionNextCount,
  frameSpacing: ANIMATION_IDS.onionSpacing,
  previousOpacity: ANIMATION_IDS.onionPreviousOpacity,
  nextOpacity: ANIMATION_IDS.onionNextOpacity,
} as const;
const colorControls = {
  previousTint: ANIMATION_IDS.onionPreviousColor,
  nextTint: ANIMATION_IDS.onionNextColor,
} as const;

/** Native preference inputs owned by this controller, independent of document transactions. */
export class OnionSkinControlsController {
  private readonly abort = new AbortController();

  constructor(
    app: HTMLElement,
    scene: Pick<AnimationEditorScene, 'getOnionSkinSettings' | 'setOnionSkinSettings'>,
    onChange: () => void = () => {},
  ) {
    const options = { signal: this.abort.signal };
    const enable = requireElement(app, ANIMATION_IDS.onionSkinning, HTMLInputElement);
    enable.checked = scene.getOnionSkinSettings().enabled;
    enable.addEventListener(
      'change',
      () => {
        scene.setOnionSkinSettings({ enabled: enable.checked });
        onChange();
      },
      options,
    );

    for (const [key, id] of Object.entries(numericControls)) {
      const property = key as keyof typeof numericControls;
      const input = requireElement(app, id, HTMLInputElement);
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
      const input = requireElement(app, id, HTMLInputElement);
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
