import Phaser from 'phaser';
import type { RigEditor } from './RigEditor.js';
import { RigEditorScene } from './RigEditorScene.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
app.innerHTML = `
  <header class="editor-header"><div><a href="../">← Engine demo</a><h1>Rig Editor <span>Bind Pose</span></h1><p>Canonical rig values · right-facing demo preview · read only</p></div><span>v0.5.1.1</span></header>
  <div class="editor-layout">
    <aside class="editor-panel"><h2>Hierarchy</h2><div id="hierarchy" role="tree"></div><h2>Visibility</h2><div id="visibility"></div><label class="opacity-label">Artwork opacity <select id="opacity"><option value="1">100%</option><option value="0.5">50%</option><option value="0.25">25%</option></select></label></aside>
    <section class="editor-center"><div id="editor-stage" aria-label="Rig canvas"></div><p>Click a joint, line, or square slot · Alt click prefers overlapping slots · Wheel zooms · Middle drag pans</p></section>
    <aside class="editor-panel inspector"><h2>Inspector</h2><div id="inspector">Loading character…</div></aside>
  </div>`;

let editor: RigEditor | undefined;
const hierarchy = document.querySelector<HTMLElement>('#hierarchy')!;
const visibility = document.querySelector<HTMLElement>('#visibility')!;
const inspector = document.querySelector<HTMLElement>('#inspector')!;
const format = (value: number | undefined, fallback = 0): string => String(Number((value ?? fallback).toFixed(4)));
const escapeHtml = (value: string | number): string =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const row = (name: string, value: string | number | undefined): string =>
  `<div class="property"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`;

function render(current: RigEditor): void {
  editor = current;
  const { state } = current;
  const selection = state.selection;
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
      ik: 'IK',
    } as const;
    for (const [key, title] of Object.entries(names) as [keyof typeof names, string][]) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.visibility[key];
      input.addEventListener('change', () => {
        state.visibility[key] = input.checked;
        current.refresh();
      });
      label.append(input, title);
      visibility.append(label);
    }
  }
  if (!selection) {
    inspector.textContent = 'Select a bone or slot to inspect its bind values.';
    return;
  }
  if (selection.type === 'bone') {
    const bone = state.rig.getBone(selection.id);
    const sprite = bone.sprite;
    inspector.innerHTML = `<h3>Bone: ${escapeHtml(bone.id)}</h3>${row('Parent', bone.parent ?? 'none')}${row('x', format(bone.x))}${row('y', format(bone.y))}${row('rotation', `${format(bone.rotation)} rad · ${format(((bone.rotation ?? 0) * 180) / Math.PI)}°`)}${row('scaleX', format(bone.scaleX, 1))}${row('scaleY', format(bone.scaleY, 1))}${row('length', bone.length)}${row('spriteOffsetX', sprite ? format(sprite.x) : undefined)}${row('spriteOffsetY', sprite ? format(sprite.y) : undefined)}${row('originX', sprite ? format(sprite.originX, 0.5) : undefined)}${row('originY', sprite ? format(sprite.originY, 0.5) : undefined)}${row('depth', format(bone.depth))}`;
  } else {
    const slot = state.rig.slots.find((item) => item.id === selection.id)!;
    const attachmentId = current.getAttachment(slot.id);
    const attachment = state.rig.attachments.find((item) => item.id === attachmentId);
    inspector.innerHTML = `<h3>Slot: ${escapeHtml(slot.id)}</h3>${row('Parent bone', slot.bone)}${row('Attachment', attachmentId ?? 'empty')}${row('x', format(slot.x))}${row('y', format(slot.y))}${row('rotation', `${format(slot.rotation)} rad · ${format(((slot.rotation ?? 0) * 180) / Math.PI)}°`)}${row('scaleX', format(slot.scaleX, 1))}${row('scaleY', format(slot.scaleY, 1))}${row('depth', slot.depth ?? 'inherited')}${row('texture', attachment?.texture)}${row('spriteOffsetX', attachment ? format(attachment.x) : undefined)}${row('spriteOffsetY', attachment ? format(attachment.y) : undefined)}${row('originX', attachment ? format(attachment.originX, 0.5) : undefined)}${row('originY', attachment ? format(attachment.originY, 0.5) : undefined)}`;
  }
}

document.querySelector<HTMLSelectElement>('#opacity')?.addEventListener('change', (event) => {
  if (!editor) return;
  editor.state.artworkOpacity = Number((event.target as HTMLSelectElement).value);
  editor.refresh();
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
