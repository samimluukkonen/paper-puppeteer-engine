import type { RigEditor } from './RigEditor.js';
import type { BoneField, SlotField, SpriteField } from './RigEditorState.js';

const format = (value: number | undefined, fallback = 0): string => String(Number((value ?? fallback).toFixed(4)));
const escapeHtml = (value: string | number): string =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const row = (name: string, value: string | number | undefined): string =>
  `<div class="property"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`;
type ScopeFields = {
  bone: BoneField;
  slot: SlotField;
  sprite: SpriteField;
  attachment: SpriteField;
};
interface NumberField<Field extends string> {
  field: Field;
  label: string;
  fallback: number | 'Auto';
  degrees?: boolean;
}

const transformFields: readonly NumberField<ScopeFields['bone'] & ScopeFields['slot']>[] = [
  { field: 'x', label: 'x', fallback: 0 },
  { field: 'y', label: 'y', fallback: 0 },
  { field: 'rotation', label: 'rotation (rad)', fallback: 0, degrees: true },
  { field: 'scaleX', label: 'scaleX', fallback: 1 },
  { field: 'scaleY', label: 'scaleY', fallback: 1 },
];
const boneFields: readonly NumberField<ScopeFields['bone']>[] = [
  ...transformFields,
  { field: 'length', label: 'length', fallback: 'Auto' },
];
const depthField = { field: 'depth', label: 'depth', fallback: 0 } as const;
const artworkFields: readonly NumberField<ScopeFields['sprite']>[] = [
  { field: 'x', label: 'spriteOffsetX', fallback: 0 },
  { field: 'y', label: 'spriteOffsetY', fallback: 0 },
  { field: 'originX', label: 'originX', fallback: 0.5 },
  { field: 'originY', label: 'originY', fallback: 0.5 },
];
const fieldsByScope = {
  bone: [...boneFields, depthField],
  slot: [...transformFields, { ...depthField, fallback: 'Auto' }],
  sprite: artworkFields,
  attachment: artworkFields,
} satisfies { [Scope in keyof ScopeFields]: readonly NumberField<ScopeFields[Scope]>[] };

function numberRows<Scope extends keyof ScopeFields>(
  scope: Scope,
  values: Partial<Record<ScopeFields[Scope], number>>,
  fields: readonly NumberField<ScopeFields[Scope]>[],
): string {
  return fields
    .map(({ field, label, fallback, degrees }) => {
      const value = values[field];
      const displayed = value ?? (fallback === 'Auto' ? '' : fallback);
      const input = `<label class="property"><span>${escapeHtml(label)}</span><input type="number" step="any" value="${displayed}" data-scope="${scope}" data-field="${field}" placeholder="${fallback}" title="Clear to remove this override"></label>`;
      return degrees
        ? input +
            `<div class="property"><span>rotation (deg)</span><strong data-derived="rotation-degrees">${format(((value ?? 0) * 180) / Math.PI)}°</strong></div>`
        : input;
    })
    .join('');
}

/** Inspector fields, derived labels, validation feedback, and focus-based undo grouping. */
export function createInspectorController(inspector: HTMLElement, updateStatus: (editor: RigEditor) => void) {
  const lifetime = new AbortController();
  let editor: RigEditor | undefined;
  let renderedState: RigEditor['state'] | undefined;
  let renderedKey = '';
  const authoredValues = new WeakMap<HTMLInputElement, number | undefined>();

  function updateInspectorValues(current: RigEditor, editedInput?: HTMLInputElement): void {
    const { state } = current;
    const selection = state.selection;
    if (!selection) return;
    const selected = selection.type === 'bone' ? state.getBone(selection.id) : state.getSlot(selection.id);
    const attachmentId = selection.type === 'slot' ? current.getAttachment(selection.id) : undefined;
    const valuesByScope: Record<keyof ScopeFields, Partial<Record<BoneField | SpriteField, number>> | undefined> = {
      bone: selection.type === 'bone' ? state.getBone(selection.id) : undefined,
      slot: selection.type === 'slot' ? state.getSlot(selection.id) : undefined,
      sprite: selection.type === 'bone' ? state.getBone(selection.id).sprite : undefined,
      attachment: attachmentId ? state.getAttachment(attachmentId) : undefined,
    };
    for (const input of inspector.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
      const { scope, field } = input.dataset;
      if (scope !== 'bone' && scope !== 'slot' && scope !== 'sprite' && scope !== 'attachment') continue;
      const definition = fieldsByScope[scope].find((entry) => entry.field === field);
      if (!definition) continue;
      const value = valuesByScope[scope]?.[definition.field];
      // Keep partially typed text during unrelated refreshes. External edits and
      // history restores still replace a focused field when its authored value changes.
      if (input !== editedInput && (document.activeElement !== input || authoredValues.get(input) !== value)) {
        input.value = String(value ?? (definition.fallback === 'Auto' ? '' : definition.fallback));
        input.setCustomValidity('');
      }
      authoredValues.set(input, value);
    }
    for (const label of inspector.querySelectorAll<HTMLElement>('[data-derived="rotation-degrees"]'))
      label.textContent = `${format(((selected.rotation ?? 0) * 180) / Math.PI)}°`;
  }

  function renderInspector(current: RigEditor): void {
    const { state } = current;
    const selection = state.selection;
    if (!selection) {
      if (renderedState !== state || renderedKey !== 'empty') {
        renderedState = state;
        renderedKey = 'empty';
        inspector.textContent = 'Select a bone or slot to edit its bind values.';
      }
      return;
    }
    const attachmentId = selection.type === 'slot' ? current.getAttachment(selection.id) : undefined;
    const key = JSON.stringify([
      selection.type,
      selection.id,
      attachmentId,
      selection.type === 'bone' && !!state.getBone(selection.id).sprite,
    ]);
    if (renderedState === state && renderedKey === key) {
      updateInspectorValues(current);
      return;
    }
    // Rebuild only when selection, session, or the available artwork fields change.
    renderedState = state;
    renderedKey = key;
    if (selection.type === 'bone') {
      const bone = state.getBone(selection.id);
      const sprite = bone.sprite;
      inspector.innerHTML = [
        `<h3>Bone: ${escapeHtml(bone.id)}</h3>`,
        row('Parent', bone.parent ?? 'none'),
        numberRows('bone', bone, boneFields),
        sprite ? numberRows('sprite', sprite, fieldsByScope.sprite) : '',
        numberRows('bone', bone, [depthField]),
      ].join('');
    } else {
      const slot = state.getSlot(selection.id);
      const attachment = attachmentId ? state.getAttachment(attachmentId) : undefined;
      inspector.innerHTML = [
        `<h3>Slot: ${escapeHtml(slot.id)}</h3>`,
        row('Parent bone', slot.bone),
        row('Attachment', attachmentId ?? 'empty'),
        numberRows('slot', slot, fieldsByScope.slot),
        row('texture', attachment?.texture),
        attachment ? numberRows('attachment', attachment, fieldsByScope.attachment) : '',
      ].join('');
    }
    updateInspectorValues(current);
  }

  inspector.addEventListener(
    'focusin',
    (event) => {
      if ((event.target as HTMLElement).matches('input[type="number"]')) editor?.state.beginOperation();
    },
    { signal: lifetime.signal },
  );
  const applyInput = (input: HTMLInputElement, value: number | undefined): void => {
    if (!editor?.state.selection) return;
    const { scope, field } = input.dataset;
    const id = editor.state.selection.id;
    try {
      if (scope === 'bone') {
        const definition = fieldsByScope.bone.find((entry) => entry.field === field);
        if (!definition) throw new Error(`Unknown bone field "${field}".`);
        editor.editBone(id, definition.field, value, false);
      } else if (scope === 'slot') {
        const definition = fieldsByScope.slot.find((entry) => entry.field === field);
        if (!definition) throw new Error(`Unknown slot field "${field}".`);
        editor.editSlot(id, definition.field, value, false);
      } else if (scope === 'sprite' || scope === 'attachment') {
        const definition = fieldsByScope[scope].find((entry) => entry.field === field);
        if (!definition) throw new Error(`Unknown artwork field "${field}".`);
        const spriteId = scope === 'attachment' ? editor.getAttachment(id) : id;
        if (!spriteId) throw new Error(`No active attachment for "${id}".`);
        editor.editSprite(spriteId, definition.field, value, scope === 'attachment', false);
      } else throw new Error(`Unknown inspector scope "${scope}".`);
      input.setCustomValidity('');
      updateStatus(editor);
      updateInspectorValues(editor, input);
    } catch (error) {
      input.setCustomValidity(String(error));
      input.reportValidity();
    }
  };
  inspector.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.matches('input[type="number"]') || input.value === '') return;
      const value = Number(input.value);
      if (Number.isFinite(value)) applyInput(input, value);
    },
    { signal: lifetime.signal },
  );
  inspector.addEventListener(
    'change',
    (event) => {
      const input = event.target as HTMLInputElement;
      // Empty values are navigation through an unfinished edit until the field is committed.
      if (input.matches('input[type="number"]') && input.value === '' && !input.validity.badInput)
        applyInput(input, undefined);
      if (editor) {
        updateStatus(editor);
        updateInspectorValues(editor, input);
      }
    },
    { signal: lifetime.signal },
  );
  inspector.addEventListener(
    'focusout',
    () => {
      editor?.state.endOperation();
      if (editor) {
        updateStatus(editor);
        updateInspectorValues(editor);
      }
      // Normalize the blurred field after native focus navigation completes;
      // the next inspector field retains its node and any unfinished text.
      queueMicrotask(() => {
        if (!lifetime.signal.aborted && editor) renderInspector(editor);
      });
    },
    { signal: lifetime.signal },
  );

  return {
    render(current: RigEditor): void {
      if (lifetime.signal.aborted) return;
      editor = current;
      renderInspector(current);
    },
    showError(this: void, message: string): void {
      if (lifetime.signal.aborted) return;
      renderedState = undefined;
      renderedKey = '';
      inspector.textContent = `Character load failed: ${message}`;
    },
    dispose(): void {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      editor?.state.endOperation();
      editor = undefined;
    },
  };
}
