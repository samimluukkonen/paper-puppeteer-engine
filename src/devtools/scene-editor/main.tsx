import { sceneAssetCatalog } from '../../engine/core.js';
import { FeatureGuide } from '../../ui/FeatureGuide.js';
import { mountView } from '../../ui/mountView.js';
import { projectEditorContext } from '../project/projectBridge.js';
import { GuideLauncher } from '../shared/guides/GuideLauncher.js';
import { GuideTargets } from '../shared/guides/GuideTargets.js';
import { sceneGuideHost } from '../shared/guides/sceneGuideHost.js';
import { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import { SceneEditorDocument } from './SceneEditorDocument.js';
import { SceneEditorView } from './SceneEditorView.js';

const host = document.querySelector<HTMLElement>('#scene-editor-app');
if (!host) throw new Error('Missing scene editor host.');
host.classList.add('view-shell', 'workspace-shell', 'scene-workspace');
const project = projectEditorContext();
const registry = new SceneCharacterRegistry(project ? (manifest) => project.loadCharacter(manifest) : undefined);
const scenes =
  project?.scenes ??
  new SceneEditorDocument({
    getCharacterAssets: (manifest) => {
      const definition = registry.get(manifest);
      return definition ? sceneAssetCatalog(new Map([[manifest, definition]])).get(manifest) : undefined;
    },
  });
const guides = new GuideLauncher(sceneGuideHost(scenes));
const unmount = mountView(
  host,
  <FeatureGuide launcher={guides} targets={new GuideTargets(host)}>
    <SceneEditorView document={scenes} registry={registry} />
  </FeatureGuide>,
  () => {
    const unsubscribe = scenes.subscribe(guides.refresh);
    return () => {
      unsubscribe();
      guides.controller.exit();
      registry.dispose();
    };
  },
);
project?.bindScene(unmount);
if (import.meta.hot) import.meta.hot.dispose(unmount);
