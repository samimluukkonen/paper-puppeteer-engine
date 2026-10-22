import { GraduationCap } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

/** Choose a real project asset before opening the existing editor's complete guide catalog. */
export function ProjectFeatureGuide({
  project,
  open,
}: {
  project?: ProjectWorkspace['definition'];
  open: (kind: 'character' | 'scene', id: string, view: 'rig' | 'animation') => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [character, setCharacter] = useState('');
  const [scene, setScene] = useState('');
  const characterId = project?.characters.some(({ id }) => id === character) ? character : project?.characters[0]?.id;
  const sceneId = project?.scenes.some(({ id }) => id === scene) ? scene : project?.scenes[0]?.id;
  const launch = (kind: 'character' | 'scene', id: string | undefined, view: 'rig' | 'animation'): void => {
    if (!id) return;
    dialog.current?.close();
    open(kind, id, view);
  };
  return (
    <>
      <button className="feature-guide-open" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <GraduationCap size={16} aria-hidden="true" /> Feature Guide
      </button>
      <dialog ref={dialog} className="workspace-dialog" aria-label="Project Feature Guide">
        <div className="workspace-panel-heading">
          <h2>Feature Guide</h2>
          <button onClick={() => dialog.current?.close()}>Close</button>
        </div>
        <p>
          Choose a project asset to open its editor and Feature Guide. Tours use your working copy; practice edits are
          explicit.
        </p>
        {characterId ? (
          <>
            <label>
              Guide character{' '}
              <select value={characterId} onChange={(event) => setCharacter(event.target.value)}>
                {project?.characters.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="project-actions">
              <button onClick={() => launch('character', characterId, 'rig')}>Open Rig Editor guides</button>
              <button onClick={() => launch('character', characterId, 'animation')}>
                Open Animation Editor guides
              </button>
            </div>
          </>
        ) : (
          <p>Create a project and add a character to use rig and animation guides.</p>
        )}
        {sceneId ? (
          <>
            <label>
              Guide scene{' '}
              <select value={sceneId} onChange={(event) => setScene(event.target.value)}>
                {project?.scenes.map(({ id }) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => launch('scene', sceneId, 'rig')}>Open Scene Editor guides</button>
          </>
        ) : (
          <p>Add a scene to use scene guides.</p>
        )}
      </dialog>
    </>
  );
}
