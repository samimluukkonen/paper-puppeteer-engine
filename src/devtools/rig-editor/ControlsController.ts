import { requireElement } from '../shared/editorElements.js';
import { RIG_IDS } from './elementIds.js';
import type { RigEditor } from './RigEditor.js';
import type { EditMode, GridSnap, RotationSnap } from './RigEditorState.js';

/** Editing, snapping, visibility, opacity, and preview controls. */
export function createControlsController(app: HTMLElement, updateStatus: (editor: RigEditor) => void) {
  const lifetime = new AbortController();
  let editor: RigEditor | undefined;
  let clipsEditor: RigEditor | undefined;
  let clipNames = '';
  const visibility = requireElement(app, RIG_IDS.visibility, HTMLElement);
  function render(current: RigEditor): void {
    if (lifetime.signal.aborted) return;
    editor = current;
    const { state } = current;
    if (!visibility.childElementCount) {
      const names = {
        artwork: 'Artwork',
        bones: 'Bones',
        boneNames: 'Bone Names',
        boneLengths: 'Bone Lengths',
        slots: 'Slots',
        spriteOrigins: 'Sprite Origins',
        ik: 'IK chains',
        footContacts: 'Foot contact markers',
      } as const;
      for (const [key, title] of Object.entries(names) as [keyof typeof names, string][]) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.visibility = key;
        input.checked = state.visibility[key];
        input.addEventListener(
          'change',
          () => {
            if (!editor) return;
            editor.state.visibility[key] = input.checked;
            editor.refresh();
          },
          { signal: lifetime.signal },
        );
        label.append(input, title);
        visibility.append(label);
      }
    }
    const namesKey = JSON.stringify((current.previewClips ?? []).map((clip) => clip.name));
    if (clipsEditor !== current || clipNames !== namesKey) {
      clipsEditor = current;
      clipNames = namesKey;
      const poses = requireElement(app, RIG_IDS.previewPose, HTMLSelectElement);
      poses.replaceChildren();
      for (const [name, title] of [
        ['', 'Bind pose'],
        ...(current.previewClips ?? []).map((clip) => [clip.name, clip.name]),
      ]) {
        const option = document.createElement('option');
        option.value = name!;
        option.textContent = title!;
        poses.append(option);
      }
    }
    requireElement(app, RIG_IDS.facing, HTMLSelectElement).value = state.facing;
    requireElement(app, RIG_IDS.previewPose, HTMLSelectElement).value = current.previewName ?? '';
    const time = requireElement(app, RIG_IDS.previewTime, HTMLInputElement);
    time.value = String(current.previewTime ?? 0);
    time.disabled = !current.previewName;
    time.max = String(current.previewClips?.find((clip) => clip.name === current.previewName)?.duration ?? 0);
    requireElement(app, RIG_IDS.modeHint, HTMLElement).textContent =
      {
        mesh: 'Edit Mesh Geometry: drag cyan diamond vertices; select edges in the Mesh inspector',
        weights: 'Paint Bone Weights: brush mesh vertices; choose bone and brush in Mesh geometry',
        joint: 'Joint Editing: move bones · Arrow keys nudge joints',
        sprite: 'Artwork Offset Editing: drag artwork or its pivot · Arrow keys nudge offsets',
        origin: 'Sprite Origin Editing: drag to choose a texture-local pivot; offset stays fixed',
        slot: 'Slot Transform Editing: drag slot markers · Arrow keys nudge slots',
      }[state.editMode] +
      (current.previewName ? ' · Bone pose preview; switch to Bind pose for joint/slot editing' : '') +
      ' · Wheel to zoom · Middle drag to pan · Escape cancels';
    requireElement(app, RIG_IDS.ikPreview, HTMLInputElement).checked = state.ikPreview;
    requireElement(app, RIG_IDS.editMode, HTMLSelectElement).value = state.editMode;
    requireElement(app, RIG_IDS.gridSnap, HTMLSelectElement).value = String(state.gridSnap);
    requireElement(app, RIG_IDS.rotationSnap, HTMLSelectElement).value = String(state.rotationSnap);
    requireElement(app, RIG_IDS.opacity, HTMLSelectElement).value = String(state.artworkOpacity);
    requireElement(app, RIG_IDS.dimSelection, HTMLInputElement).checked = state.dimUnselected;
    for (const input of visibility.querySelectorAll<HTMLInputElement>('input'))
      input.checked = state.visibility[input.dataset.visibility as keyof typeof state.visibility];
  }
  requireElement(app, RIG_IDS.opacity, HTMLSelectElement).addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.state.artworkOpacity = Number((event.target as HTMLSelectElement).value);
      editor.refresh();
    },
    { signal: lifetime.signal },
  );
  requireElement(app, RIG_IDS.editMode, HTMLSelectElement).addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.cancelGesture();
      editor.state.editMode = (event.target as HTMLSelectElement).value as EditMode;
      if (editor.state.editMode === 'weights' && editor.state.selectedMesh && editor.state.selection?.type === 'slot')
        editor.state.selectSlot(editor.state.selection.id, 'mesh');
      editor.refresh();
    },
    { signal: lifetime.signal },
  );
  requireElement(app, RIG_IDS.gridSnap, HTMLSelectElement).addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.state.gridSnap = Number((event.target as HTMLSelectElement).value) as GridSnap;
      editor.refresh(false);
      updateStatus(editor);
    },
    { signal: lifetime.signal },
  );
  requireElement(app, RIG_IDS.rotationSnap, HTMLSelectElement).addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.state.rotationSnap = Number((event.target as HTMLSelectElement).value) as RotationSnap;
      updateStatus(editor);
    },
    { signal: lifetime.signal },
  );
  requireElement(app, RIG_IDS.dimSelection, HTMLInputElement).addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.state.dimUnselected = (event.target as HTMLInputElement).checked;
      editor.refresh();
    },
    { signal: lifetime.signal },
  );
  requireElement(app, RIG_IDS.ikPreview, HTMLInputElement).addEventListener(
    'change',
    (event) => {
      editor?.setIKPreview((event.target as HTMLInputElement).checked);
    },
    { signal: lifetime.signal },
  );

  requireElement(app, RIG_IDS.facing, HTMLSelectElement).addEventListener(
    'change',
    (event) => {
      editor?.setFacing((event.target as HTMLSelectElement).value as 'left' | 'right');
    },
    { signal: lifetime.signal },
  );
  requireElement(app, RIG_IDS.previewPose, HTMLSelectElement).addEventListener(
    'change',
    (event) => {
      editor?.setPreviewPose((event.target as HTMLSelectElement).value);
    },
    { signal: lifetime.signal },
  );
  requireElement(app, RIG_IDS.previewTime, HTMLInputElement).addEventListener(
    'input',
    (event) => {
      const time = Number((event.target as HTMLInputElement).value);
      if (editor && Number.isFinite(time)) editor.setPreviewPose(editor.previewName, time);
    },
    { signal: lifetime.signal },
  );

  return {
    render,
    dispose(): void {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      editor = undefined;
      visibility.replaceChildren();
    },
  };
}
