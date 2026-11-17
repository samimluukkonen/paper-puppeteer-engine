import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FeatureGuideButton } from '../../ui/FeatureGuide.js';
import { FeatureGuideCatalog } from '../../ui/FeatureGuideCatalog.js';
import { GuideSpotlight } from '../../ui/GuideSpotlight.js';
import { GuideLauncher } from '../shared/guides/GuideLauncher.js';
import { guideRegistry } from '../shared/guides/registry.js';
import type { GuideEditor, GuideTargetResolver } from '../shared/guides/types.js';
import { projectGuideHost } from './projectGuideHost.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

/** Project tours run here; character/scene tours verify live prerequisites in their retained editor. */
export function ProjectFeatureGuide({
  project,
  targets,
  open,
}: {
  project?: ProjectWorkspace['definition'];
  targets: GuideTargetResolver;
  open: (kind: 'character' | 'scene', id: string, view: 'rig' | 'animation', guideId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const currentProject = useRef(project);
  currentProject.current = project;
  const [launcher] = useState(() => new GuideLauncher(projectGuideHost(() => !!currentProject.current)));
  const snapshot = useSyncExternalStore(
    launcher.controller.subscribe,
    launcher.controller.getSnapshot,
    launcher.controller.getSnapshot,
  );
  useEffect(() => launcher.refresh(), [launcher, project]);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<GuideEditor>('rig');
  const [character, setCharacter] = useState('');
  const [scene, setScene] = useState('');
  const characterId = project?.characters.some(({ id }) => id === character) ? character : project?.characters[0]?.id;
  const sceneId = project?.scenes.some(({ id }) => id === scene) ? scene : project?.scenes[0]?.id;
  const isScene = editor === 'scene';
  const isProject = editor === 'project';
  const assetId = isScene ? sceneId : characterId;
  return (
    <>
      <FeatureGuideButton
        onOpen={() => {
          setError('');
          launcher.refresh();
          dialog.current?.showModal();
        }}
      />
      <dialog ref={dialog} className="workspace-dialog feature-guide-dialog" aria-label="Feature Guide">
        <FeatureGuideCatalog
          error={error}
          setError={setError}
          editor={editor}
          setEditor={setEditor}
          guides={guideRegistry.getGuidesForEditor(editor)}
          hasCharacter={!!characterId}
          availableLabel={isProject ? 'Available' : 'Requirements checked in editor'}
          currentGuide={snapshot.status === 'active' ? snapshot.currentGuide : undefined}
          onExit={() => launcher.controller.exit()}
          selection={
            isProject ? (
              <p>
                {project
                  ? 'Project guides run here. No character or scene is required.'
                  : 'Create or import a project to use project guides.'}
              </p>
            ) : assetId ? (
              <div className="feature-guide-asset">
                <label>
                  {isScene ? 'Guide scene' : 'Guide character'}
                  <select value={assetId} onChange={(event) => (isScene ? setScene : setCharacter)(event.target.value)}>
                    {(isScene ? project?.scenes : project?.characters)?.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {'name' in asset ? asset.name : asset.id}
                      </option>
                    ))}
                  </select>
                </label>
                <p>The guide opens in this asset's editor. Requirements are checked there before the tour starts.</p>
              </div>
            ) : (
              <p role="status">
                {isScene
                  ? 'Add a scene to use scene guides.'
                  : 'Create a project and add a character to use rig and animation guides.'}
              </p>
            )
          }
          getAvailability={(guideId) => {
            if (isProject) return launcher.getAvailability(guideId);
            if (snapshot.status === 'active')
              return { available: false, reason: 'Exit the current guide before starting another.' };
            const standaloneRequirement = guideRegistry
              .getGuideById(guideId)
              ?.prerequisites?.find(({ capability }) => capability === 'tool:new-character');
            if (standaloneRequirement) return { available: false, reason: standaloneRequirement.reason };
            return assetId
              ? { available: true }
              : { available: false, reason: isScene ? 'Add a scene first.' : 'Add a character first.' };
          }}
          onStart={(guideId) => {
            if (isProject) return launcher.launch(guideId);
            if (!assetId) return { ok: false, reason: 'Choose a project asset first.' };
            open(isScene ? 'scene' : 'character', assetId, editor === 'animation' ? 'animation' : 'rig', guideId);
            return { ok: true };
          }}
          onClose={() => dialog.current?.close()}
        />
      </dialog>
      {snapshot.status === 'active' && (
        <GuideSpotlight
          controller={launcher.controller}
          snapshot={snapshot}
          targets={targets}
          onCatalog={() => {
            launcher.controller.exit();
            setEditor('project');
            setError('');
            dialog.current?.showModal();
          }}
        />
      )}
    </>
  );
}
