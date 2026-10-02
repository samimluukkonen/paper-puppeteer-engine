import type { RigEditor } from './RigEditor.js';

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
  `<div class="property"><span>rotation (deg)</span><strong data-derived="rotation-degrees">${format(((value ?? 0) * 180) / Math.PI)}°</strong></div>`;

/** Inspector fields, derived labels, validation feedback, and focus-based undo grouping. */
export function createInspectorController(inspector: HTMLElement, updateStatus: (editor: RigEditor) => void) {
  let editor: RigEditor | undefined;
  function updateInspectorLabels(current: RigEditor): void {
    const { state } = current;
    const selection = state.selection;
    if (!selection) return;
    const selected = selection.type === 'bone' ? state.getBone(selection.id) : state.getSlot(selection.id);
    for (const label of inspector.querySelectorAll<HTMLElement>('[data-derived="rotation-degrees"]'))
      label.textContent = `${format(((selected.rotation ?? 0) * 180) / Math.PI)}°`;
  }

  function renderInspector(current: RigEditor): void {
    const { state } = current;
    const selection = state.selection;
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
      updateInspectorLabels(editor);
    } catch (error) {
      input.setCustomValidity(String(error));
      input.reportValidity();
    }
  });
  inspector.addEventListener('change', () => {
    if (editor) {
      updateStatus(editor);
      updateInspectorLabels(editor);
    }
  });
  inspector.addEventListener('focusout', (event) => {
    editor?.state.endOperation();
    if (editor) {
      updateStatus(editor);
      updateInspectorLabels(editor);
    }
    // During native Tab navigation activeElement can still be the body at focusout.
    // Preserve the inputs when the browser is about to focus another inspector field.
    const next = event.relatedTarget;
    if (next && next instanceof Element && next.closest('#inspector')) return;
    queueMicrotask(() => {
      if (editor && !document.activeElement?.closest('#inspector')) renderInspector(editor);
    });
  });

  return {
    render(current: RigEditor): void {
      editor = current;
      renderInspector(current);
    },
    showError(message: string): void {
      inspector.textContent = `Character load failed: ${message}`;
    },
  };
}
