import type { RigEditor } from './RigEditor.js';
import type { EditMode, GridSnap, RotationSnap } from './RigEditorState.js';

/** Editing, snapping, visibility, opacity, and preview controls. */
export function createControlsController(app: HTMLElement, updateStatus: (editor: RigEditor) => void) {
  const lifetime = new AbortController();
  let editor: RigEditor | undefined;
  let clipsEditor: RigEditor | undefined;
  let clipNames = '';
  const visibility = app.querySelector<HTMLElement>('#visibility')!;
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
      const poses = app.querySelector<HTMLSelectElement>('#rig-preview-pose')!;
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
    app.querySelector<HTMLSelectElement>('#rig-facing')!.value = state.facing;
    app.querySelector<HTMLSelectElement>('#rig-preview-pose')!.value = current.previewName ?? '';
    const time = app.querySelector<HTMLInputElement>('#rig-preview-time')!;
    time.value = String(current.previewTime ?? 0);
    time.disabled = !current.previewName;
    time.max = String(current.previewClips?.find((clip) => clip.name === current.previewName)?.duration ?? 0);
    app.querySelector<HTMLElement>('#rig-mode-hint')!.textContent =
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
    app.querySelector<HTMLInputElement>('#ik-preview')!.checked = state.ikPreview;
    app.querySelector<HTMLSelectElement>('#edit-mode')!.value = state.editMode;
    app.querySelector<HTMLSelectElement>('#grid-snap')!.value = String(state.gridSnap);
    app.querySelector<HTMLSelectElement>('#rotation-snap')!.value = String(state.rotationSnap);
    app.querySelector<HTMLSelectElement>('#opacity')!.value = String(state.artworkOpacity);
    app.querySelector<HTMLInputElement>('#dim-selection')!.checked = state.dimUnselected;
    for (const input of visibility.querySelectorAll<HTMLInputElement>('input'))
      input.checked = state.visibility[input.dataset.visibility as keyof typeof state.visibility];
  }
  app.querySelector<HTMLSelectElement>('#opacity')!.addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.state.artworkOpacity = Number((event.target as HTMLSelectElement).value);
      editor.refresh();
    },
    { signal: lifetime.signal },
  );
  app.querySelector<HTMLSelectElement>('#edit-mode')!.addEventListener(
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
  app.querySelector<HTMLSelectElement>('#grid-snap')!.addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.state.gridSnap = Number((event.target as HTMLSelectElement).value) as GridSnap;
      editor.refresh(false);
      updateStatus(editor);
    },
    { signal: lifetime.signal },
  );
  app.querySelector<HTMLSelectElement>('#rotation-snap')!.addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.state.rotationSnap = Number((event.target as HTMLSelectElement).value) as RotationSnap;
      updateStatus(editor);
    },
    { signal: lifetime.signal },
  );
  app.querySelector<HTMLInputElement>('#dim-selection')!.addEventListener(
    'change',
    (event) => {
      if (!editor) return;
      editor.state.dimUnselected = (event.target as HTMLInputElement).checked;
      editor.refresh();
    },
    { signal: lifetime.signal },
  );
  app.querySelector<HTMLInputElement>('#ik-preview')!.addEventListener(
    'change',
    (event) => {
      editor?.setIKPreview((event.target as HTMLInputElement).checked);
    },
    { signal: lifetime.signal },
  );

  app.querySelector<HTMLSelectElement>('#rig-facing')!.addEventListener(
    'change',
    (event) => {
      editor?.setFacing((event.target as HTMLSelectElement).value as 'left' | 'right');
    },
    { signal: lifetime.signal },
  );
  app.querySelector<HTMLSelectElement>('#rig-preview-pose')!.addEventListener(
    'change',
    (event) => {
      editor?.setPreviewPose((event.target as HTMLSelectElement).value);
    },
    { signal: lifetime.signal },
  );
  app.querySelector<HTMLInputElement>('#rig-preview-time')!.addEventListener(
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
