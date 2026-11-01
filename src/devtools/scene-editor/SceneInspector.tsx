import Blend from 'lucide-react/icons/blend';
import Camera from 'lucide-react/icons/camera';
import Clapperboard from 'lucide-react/icons/clapperboard';
import Image from 'lucide-react/icons/image';
import MessagesSquare from 'lucide-react/icons/messages-square';
import Users from 'lucide-react/icons/users';
import Volume2 from 'lucide-react/icons/volume-2';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorTabs } from '../../ui/EditorTabs.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { SceneActionInspector } from './SceneActionInspector.js';
import { SceneActorsPanel } from './SceneActorsPanel.js';
import { SceneArtworkPanel } from './SceneArtworkPanel.js';
import { SceneAudioInspector } from './SceneAudioInspector.js';
import { SceneCameraPanel } from './SceneCameraPanel.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import { SceneDialogueInspector } from './SceneDialogueInspector.js';
import type { ReadonlyScene, SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';
import { SceneGroundPanel } from './SceneGroundPanel.js';
import { SceneLayersPanel } from './SceneLayersPanel.js';
import { ScenePlaybackInspector } from './ScenePlaybackInspector.js';
import { SceneTransitionPanel } from './SceneTransitionPanel.js';

function SceneProperties({ scene, document }: { scene: ReadonlyScene; document: SceneEditorDocument }) {
  const [name, setName] = useState(scene.name);
  const [duration, setDuration] = useState(String(scene.duration / 1000));
  useEffect(() => {
    setName(scene.name);
    setDuration(String(scene.duration / 1000));
  }, [scene]);
  return (
    <details data-guide-id={GUIDE_TARGETS.sceneProperties}>
      <summary>Scene properties</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          document.updateProperties({ name, duration: duration.trim() ? Number(duration) * 1000 : NaN });
        }}
      >
        <label>
          Scene ID
          <input value={scene.id} readOnly />
        </label>
        <p className="workspace-caption">Assigned when the scene is created.</p>
        <label>
          Name
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Duration (seconds)
          <input
            type="number"
            min="0.001"
            step="any"
            required
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        <button type="submit">Apply properties</button>
      </form>
    </details>
  );
}

/** Inspector navigation is view state; every group stays mounted to retain drafts and disclosures. */
export function SceneInspector({
  scene,
  document,
  registry,
  playback,
}: {
  scene: ReadonlyScene;
  document: SceneEditorDocument;
  registry: SceneCharacterRegistry;
  playback: SceneEditorPlayback;
}) {
  const root = useRef<HTMLDivElement>(null);
  const selection = document.selectedAudioClip
    ? `audio:${document.selectedAudioClip.id}`
    : document.selectedDialogueLine
      ? `dialogue:${document.selectedDialogueLine.id}`
      : document.selectedTransition
        ? `transitions:${document.selectedTransition.id}`
        : document.cameraSelected
          ? `camera:${document.selectedCameraKey?.property ?? 'frame'}:${document.selectedCameraKey?.key.id ?? ''}`
          : document.selectedImageId
            ? `artwork:${document.selectedImageId}`
            : document.selectedActionId
              ? `actors:action:${document.selectedActionId}`
              : document.selectedActorId
                ? `actors:actor:${document.selectedActorId}`
                : null;
  useLayoutEffect(() => {
    if (!selection) return;
    const id = `scene-inspector-${selection.split(':')[0]}`;
    root.current
      ?.querySelector(`[data-editor-tab-panel="${id}"]`)
      ?.dispatchEvent(new CustomEvent('workspace:reveal-tab', { bubbles: true, detail: id }));
  }, [selection]);
  return (
    <div ref={root} className="scene-inspector-groups">
      <EditorTabs
        label="Scene inspector groups"
        controlsLabel="inspector groups"
        wrap
        tabs={[
          {
            id: 'scene-inspector-scene',
            label: 'Scene',
            icon: Clapperboard,
            content: (
              <>
                <SceneProperties scene={scene} document={document} />
                <details>
                  <summary>Document contents</summary>
                  <p>
                    {scene.actors.length} actors · {scene.actions.length} scheduled actions
                  </p>
                  <p>Actor array order controls preview depth. Actions are preserved in downloads.</p>
                </details>
              </>
            ),
          },
          {
            id: 'scene-inspector-actors',
            label: 'Actors',
            icon: Users,
            content: (
              <>
                <SceneActorsPanel scene={scene} document={document} registry={registry} />
                <SceneActionInspector scene={scene} document={document} registry={registry} />
                <SceneGroundPanel document={document} playback={playback} />
                <ScenePlaybackInspector playback={playback} actorId={document.selectedActorId} />
              </>
            ),
          },
          {
            id: 'scene-inspector-camera',
            label: 'Camera',
            icon: Camera,
            content: <SceneCameraPanel document={document} playback={playback} />,
          },
          {
            id: 'scene-inspector-artwork',
            label: 'Artwork',
            icon: Image,
            content: (
              <>
                <SceneArtworkPanel document={document} />
                <SceneLayersPanel document={document} />
              </>
            ),
          },
          {
            id: 'scene-inspector-dialogue',
            label: 'Dialogue',
            icon: MessagesSquare,
            content: <SceneDialogueInspector document={document} registry={registry} />,
          },
          {
            id: 'scene-inspector-audio',
            label: 'Audio',
            icon: Volume2,
            content: <SceneAudioInspector document={document} />,
          },
          {
            id: 'scene-inspector-transitions',
            label: 'Transitions',
            icon: Blend,
            content: <SceneTransitionPanel document={document} />,
          },
        ]}
      />
    </div>
  );
}
