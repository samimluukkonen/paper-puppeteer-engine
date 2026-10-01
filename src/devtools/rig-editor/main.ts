import Phaser from 'phaser';
import type { RigEditor } from './RigEditor.js';
import { RigEditorScene } from './RigEditorScene.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
app.innerHTML = `
  <header class="editor-header"><div><a href="../">← Engine demo</a><h1>Rig Editor <span>Bind Pose</span></h1><p>Edit local rig values · right facing</p><p id="dirty-status"></p></div><span>v0.5.1.2</span></header>
  <div class="editor-layout">
    <aside class="editor-panel"><h2>Hierarchy</h2><div id="hierarchy" role="tree"></div><h2>Editing</h2><div class="edit-controls"><label>Edit <select id="edit-mode"><option value="joint">Joint</option><option value="sprite">Sprite</option></select></label><label><input id="dim-selection" type="checkbox"> Dim unselected artwork</label><label><input id="ik-preview" type="checkbox"> IK Preview</label></div><h2>Visibility</h2><div id="visibility"></div><label class="opacity-label">Artwork opacity <select id="opacity"><option value="1">100%</option><option value="0.5">50%</option><option value="0.25">25%</option></select></label></aside>
    <section class="editor-center"><div id="editor-stage" aria-label="Rig canvas"></div><p>Drag joints or slots · Sprite mode drags selected artwork offset · Alt click prefers slots · Arrow keys nudge joints · , / . rotate · Shift uses larger steps · Wheel zooms · Middle drag pans</p></section>
    <aside class="editor-panel inspector"><h2>Inspector</h2><div id="inspector">Loading character…</div><div id="validation" role="status"></div></aside>
  </div>`;

let editor: RigEditor | undefined;
const hierarchy = document.querySelector<HTMLElement>('#hierarchy')!;
const visibility = document.querySelector<HTMLElement>('#visibility')!;
const inspector = document.querySelector<HTMLElement>('#inspector')!;
const validation = document.querySelector<HTMLElement>('#validation')!;
const dirty = document.querySelector<HTMLElement>('#dirty-status')!;
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
  dirty.textContent = current.state.dirty ? 'Unsaved changes *' : 'No changes';
  validation.textContent = current.state.warnings.join(' · ');
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
        state.visibility[key] = input.checked;
        current.refresh();
      });
      label.append(input, title);
      visibility.append(label);
    }
  }
  document.querySelector<HTMLInputElement>('#ik-preview')!.checked = state.ikPreview;
  document.querySelector<HTMLSelectElement>('#edit-mode')!.value = state.editMode;
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
  if (editor) render(editor);
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
document.querySelector<HTMLInputElement>('#dim-selection')!.addEventListener('change', (event) => {
  if (!editor) return;
  editor.state.dimUnselected = (event.target as HTMLInputElement).checked;
  editor.refresh();
});
document.querySelector<HTMLInputElement>('#ik-preview')!.addEventListener('change', (event) => {
  editor?.setIKPreview((event.target as HTMLInputElement).checked);
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
