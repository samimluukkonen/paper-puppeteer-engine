import { useState, useSyncExternalStore } from 'react';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { AttachmentController } from './AttachmentController.js';
import './attachments.css';
import type { RigEditorState } from './RigEditorState.js';

function BoneActions({
  controller,
  state,
  id,
}: {
  controller: AttachmentController;
  state: RigEditorState;
  id: string;
}) {
  const [name, setName] = useState(id);
  const bone = state.getBone(id);
  return (
    <fieldset>
      <legend>Selected bone: {id}</legend>
      <label>
        Bone ID / name
        <input aria-label="Bone ID / name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button type="button" disabled={!name.trim() || name === id} onClick={() => controller.renameBone(name)}>
        Rename bone
      </button>
      <label>
        Parent bone
        <select
          aria-label="Parent bone"
          value={bone.parent ?? ''}
          disabled={id === state.workingCopy.root}
          onChange={(event) => controller.reparentBone(event.target.value)}
        >
          <option value="" disabled>
            None (root)
          </option>
          {state.workingCopy.bones
            .filter((entry) => entry.id !== id)
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
              </option>
            ))}
        </select>
      </label>
      <button type="button" disabled={id === state.workingCopy.root} onClick={() => controller.removeBone()}>
        Remove bone
      </button>
      <small>Dependent children, slots, artwork, IK and animation tracks must be resolved before removal.</small>
    </fieldset>
  );
}

/** The hierarchy shares the rig document, selection and history with the existing inspector. */
export function RigStructurePanel({ controller }: { controller: AttachmentController }) {
  const { editor, message } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [boneId, setBoneId] = useState('');
  const [slotId, setSlotId] = useState('');
  const state = editor?.state;
  if (!state) return null;
  const selection = state.selection;
  return (
    <section className="attachment-panel rig-structure-panel" aria-label="Build skeleton">
      <fieldset disabled={!!editor.previewName} data-guide-id={GUIDE_TARGETS.rigBuildSkeleton}>
        <legend>Build skeleton</legend>
        <label>
          New bone ID
          <input aria-label="New bone ID" value={boneId} onChange={(event) => setBoneId(event.target.value)} />
        </label>
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.rigAddBone}
          disabled={!boneId.trim()}
          onClick={() => controller.createBone(boneId)}
        >
          + Add Bone
        </button>
        <small>
          Parent: {selection?.type === 'bone' ? selection.id : state.workingCopy.root}. Select a bone to add its child.
        </small>
        {selection?.type === 'bone' && (
          <BoneActions key={selection.id} controller={controller} state={state} id={selection.id} />
        )}
        <label>
          New slot ID
          <input aria-label="New slot ID" value={slotId} onChange={(event) => setSlotId(event.target.value)} />
        </label>
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.rigAddSlot}
          disabled={!selection || !slotId.trim()}
          onClick={() => controller.createSlot(slotId)}
        >
          + Add Slot
        </button>
        {selection?.type === 'slot' && (
          <button type="button" onClick={() => controller.removeSlot()}>
            Remove empty slot
          </button>
        )}
      </fieldset>
      <p>
        Use Bind pose and Joint Editing to position joints and test rotations. Import PNG/WebP artwork below, then
        create and assign attachments in the default skin.
      </p>
      <p role="status">{message}</p>
    </section>
  );
}
