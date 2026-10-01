import Phaser from 'phaser';
import { type RigJsonDefinition, validateRigDefinition } from '../../engine/externalData.js';
import type { RigEditor } from './RigEditor.js';
import { RigEditorScene } from './RigEditorScene.js';
import type { GridSnap, RotationSnap } from './RigEditorState.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
app.innerHTML = `
  <header class="editor-header"><div><a href="../">← Engine demo</a><h1>Rig Editor <span>Bind Pose</span></h1><p>Edit local rig values · right facing</p><p id="dirty-status"></p></div><span>v0.5.1.3</span></header>
  <div class="editor-layout">
    <aside class="editor-panel"><h2>Hierarchy</h2><div id="hierarchy" role="tree"></div><h2>Editing</h2><div class="edit-controls"><label>Edit <select id="edit-mode"><option value="joint">Joint</option><option value="sprite">Sprite</option></select></label><label>Grid <select id="grid-snap"><option value="0">Off</option><option value="1">1</option><option value="2">2</option><option value="5">5</option><option value="10">10</option></select></label><label>Rotation snap <select id="rotation-snap"><option value="0">Off</option><option value="1">1°</option><option value="5">5°</option><option value="15">15°</option></select></label><label><input id="dim-selection" type="checkbox"> Dim unselected artwork</label><label><input id="ik-preview" type="checkbox"> IK Preview</label></div><h2>History and reset</h2><div class="action-grid"><button id="undo" type="button">Undo</button><button id="redo" type="button">Redo</button><button id="reset-selected" type="button">Reset Selected</button><button id="reset-rig" type="button">Reset Rig</button></div><h2>Visibility</h2><div id="visibility"></div><label class="opacity-label">Artwork opacity <select id="opacity"><option value="1">100%</option><option value="0.5">50%</option><option value="0.25">25%</option></select></label></aside>
    <section class="editor-center"><div id="editor-stage" aria-label="Rig canvas"></div><details class="shortcut-help"><summary>Controls and shortcuts</summary><div class="shortcut-table-wrap"><table><thead><tr><th scope="col">Action</th><th scope="col">Control</th></tr></thead><tbody>
      <tr><td>Select a bone or slot</td><td>Click the hierarchy or canvas; <kbd>Alt</kbd>+click prefers slots</td></tr>
      <tr><td>Move a joint or slot</td><td>Drag its canvas marker</td></tr>
      <tr><td>Edit artwork offset</td><td>Choose Sprite mode, then drag selected artwork</td></tr>
      <tr><td>Nudge a joint</td><td>Arrow keys; hold <kbd>Shift</kbd> for larger steps</td></tr>
      <tr><td>Rotate a joint</td><td><kbd>,</kbd> / <kbd>.</kbd>; hold <kbd>Shift</kbd> for larger steps</td></tr>
      <tr><td>Undo / redo</td><td><kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> / <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td></tr>
      <tr><td>Snap translation / rotation</td><td>Use Grid / Rotation snap in the left panel</td></tr>
      <tr><td>Reset selected / rig</td><td>Use Reset Selected / Reset Rig in the left panel</td></tr>
      <tr><td>Validate / export</td><td>Use the buttons in the right panel</td></tr>
      <tr><td>Zoom / pan</td><td>Mouse wheel / middle-button drag</td></tr>
    </tbody></table></div></details></section>
    <aside class="editor-panel inspector"><h2>Session</h2><div id="session-status"></div><h2>Inspector</h2><div id="inspector">Loading character…</div><h2>Validation and export</h2><div id="validation" role="status"></div><div class="action-grid"><button id="validate-rig" type="button">Validate</button><button id="copy-json" type="button">Copy rig JSON</button><button id="download-json" type="button">Download rig.json</button><button id="log-json" type="button">Log rig JSON</button><button id="reload-exported" type="button">Reload exported rig</button><button id="reload-original" type="button">Reload original rig</button></div><label class="load-label">Load rig JSON <input id="load-json" type="file" accept=".json,application/json"></label><div id="action-feedback" role="status"></div></aside>
  </div>`;

let editor: RigEditor | undefined;
const hierarchy = document.querySelector<HTMLElement>('#hierarchy')!;
const visibility = document.querySelector<HTMLElement>('#visibility')!;
const inspector = document.querySelector<HTMLElement>('#inspector')!;
const validation = document.querySelector<HTMLElement>('#validation')!;
const dirty = document.querySelector<HTMLElement>('#dirty-status')!;
const session = document.querySelector<HTMLElement>('#session-status')!;
const feedback = document.querySelector<HTMLElement>('#action-feedback')!;
let lastExport: RigJsonDefinition | undefined;
let lastExportFilename: string | undefined;
const format = (value: number | undefined, fallback = 0): string => String(Number((value ?? fallback).toFixed(4)));
const escapeHtml = (value: string | number): string =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const row = (name: string, value: string | number | undefined): string =>
  `<div class="property"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`;
const numberRow = (name: string, value: number | undefined, scope: string, field: string, fallback = 0): string =>
  `<label class="property"><span>${escapeHtml(name)}</span><input type="number" step="any" value="${format(value, fallback)}" data-scope="${scope}" data-field="${field}"></label>`;
const rotationRows = (value: number | undefined, scope: string): string =>
  numberRow('rotation (rad)', value, scope, 'rotation') +
  row('rotation (deg)', `${format(((value ?? 0) * 180) / Math.PI)}°`);

function updateStatus(current: RigEditor): void {
  const isDirty = current.state.dirty;
  dirty.textContent = isDirty ? 'Unsaved changes *' : 'No changes';
  document.querySelector('#editor-stage')!.classList.toggle('grid-active', current.state.gridSnap !== 0);
  const issues = current.state.validationIssues();
  validation.textContent = issues.length
    ? issues.map((issue) => `${issue.severity}: ${issue.path ?? 'rig'}: ${issue.message}`).join('\n')
    : 'Validation: OK';
  session.textContent = `Character: ${scene.characterId}\nRig: ${scene.rigFilename}\nMode: ${current.state.editMode}\nSelected: ${current.state.selection?.id ?? 'none'}\nGrid: ${current.state.gridSnap || 'Off'}\nRotation snap: ${current.state.rotationSnap ? `${current.state.rotationSnap}°` : 'Off'}\nModified: ${isDirty ? 'Yes' : 'No'}\nValidation: ${issues.some((issue) => issue.severity === 'error') ? 'Errors' : 'OK'}`;
  document.querySelector<HTMLButtonElement>('#undo')!.disabled = !current.state.canUndo;
  document.querySelector<HTMLButtonElement>('#redo')!.disabled = !current.state.canRedo;
  document.querySelector<HTMLButtonElement>('#reset-selected')!.disabled = !current.state.selection;
}

function render(current: RigEditor): void {
  editor = current;
  const { state } = current;
  const selection = state.selection;
  updateStatus(current);
  hierarchy.replaceChildren();
  for (const { id, depth } of state.hierarchy()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-entry';
    button.style.paddingLeft = `${10 + depth * 16}px`;
    button.textContent = id;
    button.setAttribute('role', 'treeitem');
    button.setAttribute('aria-selected', String(selection?.type === 'bone' && selection.id === id));
    button.addEventListener('click', () => {
      state.selectBone(id);
      current.refresh();
    });
    hierarchy.append(button);
    for (const slot of state.rig.slots.filter((item) => item.bone === id)) {
      const slotButton = document.createElement('button');
      slotButton.type = 'button';
      slotButton.className = 'tree-entry slot-entry';
      slotButton.style.paddingLeft = `${26 + depth * 16}px`;
      slotButton.textContent = `◇ ${slot.id}`;
      slotButton.setAttribute('role', 'treeitem');
      slotButton.setAttribute('aria-selected', String(selection?.type === 'slot' && selection.id === slot.id));
      slotButton.addEventListener('click', () => {
        state.selectSlot(slot.id);
        current.refresh();
      });
      hierarchy.append(slotButton);
    }
  }
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
  document.querySelector<HTMLInputElement>('#ik-preview')!.checked = state.ikPreview;
  document.querySelector<HTMLSelectElement>('#edit-mode')!.value = state.editMode;
  document.querySelector<HTMLSelectElement>('#grid-snap')!.value = String(state.gridSnap);
  document.querySelector<HTMLSelectElement>('#rotation-snap')!.value = String(state.rotationSnap);
  document.querySelector<HTMLInputElement>('#dim-selection')!.checked = state.dimUnselected;
  for (const input of visibility.querySelectorAll<HTMLInputElement>('input'))
    input.checked = state.visibility[input.dataset.visibility as keyof typeof state.visibility];
  if (!selection) {
    inspector.textContent = 'Select a bone or slot to edit its bind values.';
    return;
  }
  if (selection.type === 'bone') {
    const bone = state.getBone(selection.id);
    const sprite = bone.sprite;
    inspector.innerHTML = `<h3>Bone: ${escapeHtml(bone.id)}</h3>${row('Parent', bone.parent ?? 'none')}${numberRow('x', bone.x, 'bone', 'x')}${numberRow('y', bone.y, 'bone', 'y')}${rotationRows(bone.rotation, 'bone')}${numberRow('scaleX', bone.scaleX, 'bone', 'scaleX', 1)}${numberRow('scaleY', bone.scaleY, 'bone', 'scaleY', 1)}${numberRow('length', bone.length, 'bone', 'length')}${sprite ? numberRow('spriteOffsetX', sprite.x, 'sprite', 'x') + numberRow('spriteOffsetY', sprite.y, 'sprite', 'y') + numberRow('originX', sprite.originX, 'sprite', 'originX', 0.5) + numberRow('originY', sprite.originY, 'sprite', 'originY', 0.5) : ''}${numberRow('depth', bone.depth, 'bone', 'depth')}`;
  } else {
    const slot = state.getSlot(selection.id);
    const attachmentId = current.getAttachment(slot.id);
    const attachment = attachmentId ? state.getAttachment(attachmentId) : undefined;
    inspector.innerHTML = `<h3>Slot: ${escapeHtml(slot.id)}</h3>${row('Parent bone', slot.bone)}${row('Attachment', attachmentId ?? 'empty')}${numberRow('x', slot.x, 'slot', 'x')}${numberRow('y', slot.y, 'slot', 'y')}${rotationRows(slot.rotation, 'slot')}${numberRow('scaleX', slot.scaleX, 'slot', 'scaleX', 1)}${numberRow('scaleY', slot.scaleY, 'slot', 'scaleY', 1)}${numberRow('depth', slot.depth, 'slot', 'depth')}${row('texture', attachment?.texture)}${attachment ? numberRow('spriteOffsetX', attachment.x, 'attachment', 'x') + numberRow('spriteOffsetY', attachment.y, 'attachment', 'y') + numberRow('originX', attachment.originX, 'attachment', 'originX', 0.5) + numberRow('originY', attachment.originY, 'attachment', 'originY', 0.5) : ''}`;
  }
}

inspector.addEventListener('focusin', (event) => {
  if ((event.target as HTMLElement).matches('input[type="number"]')) editor?.state.beginOperation();
});
inspector.addEventListener('input', (event) => {
  if (!editor?.state.selection) return;
  const input = event.target as HTMLInputElement;
  if (!input.matches('input[type="number"]') || input.value === '') return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const { scope, field } = input.dataset;
  const id = editor.state.selection.id;
  try {
    if (scope === 'bone') editor.editBone(id, field as Parameters<RigEditor['editBone']>[1], value, false);
    else if (scope === 'slot') editor.editSlot(id, field as Parameters<RigEditor['editSlot']>[1], value, false);
    else
      editor.editSprite(
        scope === 'attachment' ? editor.getAttachment(id)! : id,
        field as Parameters<RigEditor['editSprite']>[1],
        value,
        scope === 'attachment',
        false,
      );
    input.setCustomValidity('');
    updateStatus(editor);
  } catch (error) {
    input.setCustomValidity(String(error));
    input.reportValidity();
  }
});
inspector.addEventListener('change', () => {
  editor?.state.endOperation();
  if (editor) render(editor);
});
inspector.addEventListener('focusout', () => {
  editor?.state.endOperation();
  if (editor) updateStatus(editor);
});

document.querySelector<HTMLSelectElement>('#opacity')!.addEventListener('change', (event) => {
  if (!editor) return;
  editor.state.artworkOpacity = Number((event.target as HTMLSelectElement).value);
  editor.refresh();
});
document.querySelector<HTMLSelectElement>('#edit-mode')!.addEventListener('change', (event) => {
  if (!editor) return;
  editor.state.editMode = (event.target as HTMLSelectElement).value as 'joint' | 'sprite';
  editor.refresh();
});
document.querySelector<HTMLSelectElement>('#grid-snap')!.addEventListener('change', (event) => {
  if (!editor) return;
  editor.state.gridSnap = Number((event.target as HTMLSelectElement).value) as GridSnap;
  editor.refresh(false);
  updateStatus(editor);
});
document.querySelector<HTMLSelectElement>('#rotation-snap')!.addEventListener('change', (event) => {
  if (!editor) return;
  editor.state.rotationSnap = Number((event.target as HTMLSelectElement).value) as RotationSnap;
  updateStatus(editor);
});
document.querySelector<HTMLInputElement>('#dim-selection')!.addEventListener('change', (event) => {
  if (!editor) return;
  editor.state.dimUnselected = (event.target as HTMLInputElement).checked;
  editor.refresh();
});
document.querySelector<HTMLInputElement>('#ik-preview')!.addEventListener('change', (event) => {
  editor?.setIKPreview((event.target as HTMLInputElement).checked);
});
const action = (id: string, run: () => void | Promise<void>): void => {
  document.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener('click', () => {
    try {
      const result = run();
      if (result instanceof Promise)
        void result.catch((error) => {
          feedback.textContent = String(error);
        });
    } catch (error) {
      feedback.textContent = String(error);
    }
  });
};
action('undo', () => editor?.undo());
action('redo', () => editor?.redo());
action('reset-selected', () => editor?.resetSelected());
action('reset-rig', () => {
  editor?.resetRig();
  feedback.textContent = 'Rig reset to session start.';
});
action('validate-rig', () => {
  if (!editor) return;
  editor.state.validate();
  const issues = editor.state.validationIssues();
  updateStatus(editor);
  feedback.textContent = issues.length ? `${issues.length} validation issue(s).` : 'Rig validation passed.';
});
const prepareJson = (): string => {
  if (!editor) throw new Error('No rig is loaded.');
  const json = editor.exportJson(false);
  lastExport = JSON.parse(json) as RigJsonDefinition;
  lastExportFilename = scene.rigFilename;
  const warnings = editor.state.validationIssues().filter((issue) => issue.severity === 'warning');
  feedback.textContent = warnings.length
    ? `Exported with warnings: ${warnings.map((issue) => issue.message).join(' · ')}`
    : 'Rig JSON ready.';
  return json;
};
const markExported = (): void => {
  if (!editor) return;
  editor.state.markSaved();
  updateStatus(editor);
};
action('copy-json', async () => {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable. Use Download or Log rig JSON.');
  if (!editor) throw new Error('No rig is loaded.');
  const exportingEditor = editor;
  const json = prepareJson();
  const savedSnapshot = exportingEditor.state.workingSnapshot;
  await navigator.clipboard.writeText(json);
  if (editor !== exportingEditor) return;
  exportingEditor.state.markSaved(savedSnapshot);
  updateStatus(exportingEditor);
  feedback.textContent = 'Rig JSON copied.';
});
action('download-json', () => {
  const json = prepareJson();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = scene.rigFilename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markExported();
  feedback.textContent = 'Rig JSON download started.';
});
action('log-json', () => {
  const json = prepareJson();
  console.log(json);
  markExported();
  feedback.textContent = 'Rig JSON logged to the console.';
});
action('reload-exported', () => {
  if (!lastExport) throw new Error('Export the rig first.');
  if (editor?.state.dirty && !window.confirm('Discard edits made since the last export?')) return;
  scene.reloadRig(lastExport, lastExportFilename);
  feedback.textContent = 'Exported rig reloaded and validated.';
});
action('reload-original', () => {
  if (editor?.state.dirty && !window.confirm('Discard unsaved rig edits and reload the original?')) return;
  scene.reloadOriginal();
  feedback.textContent = 'Original rig reloaded.';
});
document.querySelector<HTMLInputElement>('#load-json')!.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text()) as RigJsonDefinition;
    const issues = validateRigDefinition(json);
    if (issues.some((issue) => issue.severity === 'error'))
      throw new Error(issues.map((issue) => `${issue.path ?? 'rig'}: ${issue.message}`).join('\n'));
    if (editor?.state.dirty && !window.confirm('Discard unsaved rig edits and load this file?')) {
      input.value = '';
      return;
    }
    scene.reloadRig(json, file.name);
    feedback.textContent = `${file.name} loaded and validated.`;
  } catch (error) {
    feedback.textContent = `Could not load rig: ${String(error)}`;
  }
  input.value = '';
});
const scene = new RigEditorScene(render, (message) => {
  inspector.textContent = `Character load failed: ${message}`;
});
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'editor-stage',
  width: 760,
  height: 640,
  transparent: true,
  render: { antialias: true, maxTextures: 1 },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [scene],
});
if (import.meta.hot) import.meta.hot.dispose(() => game.destroy(true));
