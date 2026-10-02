import type { RigEditor } from './RigEditor.js';
import type { GridSnap, RotationSnap } from './RigEditorState.js';

/** Editing, snapping, visibility, opacity, and preview controls. */
export function createControlsController(app: HTMLElement, updateStatus: (editor: RigEditor) => void) {
  let editor: RigEditor | undefined;
  const visibility = app.querySelector<HTMLElement>('#visibility')!;
  function render(current: RigEditor): void {
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
      } as const;
      for (const [key, title] of Object.entries(names) as [keyof typeof names, string][]) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.visibility = key;
        input.checked = state.visibility[key];
        input.addEventListener('change', () => {
          if (!editor) return;
          editor.state.visibility[key] = input.checked;
          editor.refresh();
        });
        label.append(input, title);
        visibility.append(label);
      }
    }
    app.querySelector<HTMLInputElement>('#ik-preview')!.checked = state.ikPreview;
    app.querySelector<HTMLSelectElement>('#edit-mode')!.value = state.editMode;
    app.querySelector<HTMLSelectElement>('#grid-snap')!.value = String(state.gridSnap);
    app.querySelector<HTMLSelectElement>('#rotation-snap')!.value = String(state.rotationSnap);
    app.querySelector<HTMLSelectElement>('#opacity')!.value = String(state.artworkOpacity);
    app.querySelector<HTMLInputElement>('#dim-selection')!.checked = state.dimUnselected;
    for (const input of visibility.querySelectorAll<HTMLInputElement>('input'))
      input.checked = state.visibility[input.dataset.visibility as keyof typeof state.visibility];
  }
  app.querySelector<HTMLSelectElement>('#opacity')!.addEventListener('change', (event) => {
    if (!editor) return;
    editor.state.artworkOpacity = Number((event.target as HTMLSelectElement).value);
    editor.refresh();
  });
  app.querySelector<HTMLSelectElement>('#edit-mode')!.addEventListener('change', (event) => {
    if (!editor) return;
    editor.state.editMode = (event.target as HTMLSelectElement).value as 'joint' | 'sprite';
    editor.refresh();
  });
  app.querySelector<HTMLSelectElement>('#grid-snap')!.addEventListener('change', (event) => {
    if (!editor) return;
    editor.state.gridSnap = Number((event.target as HTMLSelectElement).value) as GridSnap;
    editor.refresh(false);
    updateStatus(editor);
  });
  app.querySelector<HTMLSelectElement>('#rotation-snap')!.addEventListener('change', (event) => {
    if (!editor) return;
    editor.state.rotationSnap = Number((event.target as HTMLSelectElement).value) as RotationSnap;
    updateStatus(editor);
  });
  app.querySelector<HTMLInputElement>('#dim-selection')!.addEventListener('change', (event) => {
    if (!editor) return;
    editor.state.dimUnselected = (event.target as HTMLInputElement).checked;
    editor.refresh();
  });
  app.querySelector<HTMLInputElement>('#ik-preview')!.addEventListener('change', (event) => {
    editor?.setIKPreview((event.target as HTMLInputElement).checked);
  });

  return { render };
}
