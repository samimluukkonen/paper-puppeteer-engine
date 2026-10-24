import { blocksEditorShortcut, historyShortcut } from '../../shared/keyboardShortcuts.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';

/** One command router for the scene; document selection and history remain scene-owned. */
export function bindSceneShortcuts(document: SceneEditorDocument, playback: SceneEditorPlayback): () => void {
  const keydown = (event: KeyboardEvent): void => {
    if (blocksEditorShortcut(event) || !document.workingScene) return;
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (document.hasActiveGesture) {
        document.cancelCameraDrag();
        document.cancelImageDrag();
        document.cancelActorDrag();
        document.cancelActionDrag();
      } else if (document.cameraSelected) document.selectCamera(false);
      else if (document.selectedTransition) document.selectTransition(null);
      else if (document.selectedImageId) document.selectImage(null);
      else if (document.selectedActionId) document.selectAction(null);
      else document.selectActor(null);
      return;
    }
    if (document.hasActiveGesture) return;
    const history = historyShortcut(event);
    if (history) {
      event.preventDefault();
      if (!event.repeat) {
        if (history === 'undo') document.undo();
        else document.redo();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (event.repeat) return;
      if (document.selectedTransition) {
        document.removeTransition(document.selectedTransition.id);
        return;
      }
      const cameraKey = document.selectedCameraKey;
      if (cameraKey) {
        document.removeCameraKey(cameraKey.property, cameraKey.key.id);
        return;
      }
      if (document.cameraSelected) return;
      if (document.selectedImageId) document.removeImage(document.selectedImageId);
      else if (document.selectedActionId) document.removeAction(document.selectedActionId);
      else if (document.selectedActorId) {
        const id = document.selectedActorId;
        const references = document.actorReferences(id);
        if (
          !references.length ||
          window.confirm(
            `Remove actor "${id}" and its ${references.length} referenced scene action(s)? This can be undone.`,
          )
        )
          document.removeActor(id, { removeActions: references.length > 0 });
      }
      return;
    }
    if (!playback.ready) return;
    if (event.code === 'Space') {
      if ((event.target as Element | null)?.closest?.('button, a[href], summary')) return;
      event.preventDefault();
      if (!event.repeat) {
        if (playback.status === 'playing') playback.pause();
        else playback.play();
      }
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!event.repeat) {
        if (event.key === 'Home') playback.restart();
        else playback.seek(document.workingScene.duration);
      }
    }
  };
  window.addEventListener('keydown', keydown);
  return () => window.removeEventListener('keydown', keydown);
}
