import { getDemoCharacterProfile } from '../../demo/demoCharacterProfiles.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { createEditorGame } from '../shared/editorGame.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import { BoneInspectorController } from './BoneInspectorController.js';
import { mountEditorMarkup } from './editorMarkup.js';
import { TimelineController } from './TimelineController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#animation-editor-app');
if (!app) throw new Error('Missing animation editor host.');
mountEditorMarkup(app);

const releaseCharacterSelection = bindCharacterSelection(app);
const timeline = new TimelineController(app);
const inspector = new BoneInspectorController(app);
const releaseNavigationGuard = protectUnsavedChanges(() => timeline.hasUnsavedChanges);
const scene = new AnimationEditorScene(
  (state, id) => {
    timeline.bind(state, id);
    inspector.bind(state);
  },
  (message) => timeline.showError(message),
  {
    characterUrl: `../characters/${selectedCharacterId()}/character.json`,
    ikChains: getDemoCharacterProfile(selectedCharacterId()).ikChains,
  },
);
const previewControls = new AbortController();
app.querySelector<HTMLSelectElement>('#animation-facing')!.addEventListener(
  'change',
  (event) => {
    const facing = (event.target as HTMLSelectElement).value;
    if (facing === 'left' || facing === 'right') scene.setFacing(facing);
  },
  { signal: previewControls.signal },
);
app.querySelector<HTMLInputElement>('#animation-show-bones')!.addEventListener(
  'change',
  (event) => {
    scene.setBonesVisible((event.target as HTMLInputElement).checked);
  },
  { signal: previewControls.signal },
);
app.querySelector<HTMLInputElement>('#animation-ik-preview')!.addEventListener(
  'change',
  (event) => {
    scene.setIKPreview((event.target as HTMLInputElement).checked);
  },
  { signal: previewControls.signal },
);
const game = createEditorGame('animation-stage', scene);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    releaseNavigationGuard();
    timeline.dispose();
    inspector.dispose();
    previewControls.abort();
    releaseCharacterSelection();
    game.destroy(true);
  });
