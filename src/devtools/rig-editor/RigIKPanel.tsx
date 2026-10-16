import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { IKConstraintPatch } from '../../engine/ik/ikAuthoring.js';
import type { TwoBoneIKDefinition } from '../../engine/ik/types.js';
import type { RigDefinition } from '../../engine/types.js';
import type { AttachmentController } from './AttachmentController.js';
import './attachments.css';
import { rigIKChains, rigIKFormError } from './rigIKForm.js';

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setText(String(value)), [value]);
  const valid =
    text.trim() !== '' &&
    Number.isFinite(Number(text)) &&
    (min === undefined || Number(text) >= min) &&
    (max === undefined || Number(text) <= max);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        step="any"
        min={min}
        max={max}
        value={text}
        aria-invalid={!valid}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            setText(String(value));
            return;
          }
          if (valid && Number(text) !== value) onCommit(Number(text));
          else setText(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            cancelled.current = true;
            setText(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function ChainFields({
  rig,
  definition,
  disabled,
  onPatch,
}: {
  rig: RigDefinition;
  definition: TwoBoneIKDefinition;
  disabled?: boolean;
  onPatch: (patch: IKConstraintPatch) => void;
}) {
  const chains = rigIKChains(rig);
  const fields = [
    { field: 'rootBone', label: 'Start bone' },
    { field: 'middleBone', label: 'Middle bone' },
    { field: 'endBone', label: 'End bone' },
  ] as const;
  return (
    <fieldset disabled={disabled}>
      <legend>Bone chain</legend>
      {fields.map(({ field, label }) => {
        const compatible = chains.filter(
          (chain) =>
            field === 'rootBone' ||
            (chain.rootBone === definition.rootBone &&
              (field === 'middleBone' || chain.middleBone === definition.middleBone)),
        );
        const ids = [...new Set([definition[field], ...compatible.map((chain) => chain[field])])].filter(Boolean);
        return (
          <label key={field}>
            {label}
            <select
              aria-label={label}
              value={definition[field]}
              onChange={(event) => {
                const next = compatible.find((chain) => chain[field] === event.target.value);
                if (next) onPatch(next);
              }}
            >
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </fieldset>
  );
}

function Settings({
  definition,
  protectedChain,
  onPatch,
}: {
  definition: TwoBoneIKDefinition;
  protectedChain?: boolean;
  onPatch: (patch: IKConstraintPatch) => void;
}) {
  return (
    <>
      <NumberField label="Influence" value={definition.mix ?? 1} min={0} max={1} onCommit={(mix) => onPatch({ mix })} />
      <label>
        Bend direction
        <select
          aria-label="Bend direction"
          value={definition.bendDirection ?? ''}
          onChange={(event) => onPatch({ bendDirection: event.target.value === '1' ? 1 : -1 })}
        >
          <option value="" disabled>
            Automatic from pose
          </option>
          <option value="1">Clockwise</option>
          <option value="-1">Counterclockwise</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={definition.enabled !== false}
          onChange={(event) => onPatch({ enabled: event.target.checked })}
        />
        Enabled
      </label>
      <NumberField label="Priority" value={definition.priority ?? 0} onCommit={(priority) => onPatch({ priority })} />
      <fieldset disabled={protectedChain}>
        <legend>End effector offset (end bone local)</legend>
        {(['x', 'y'] as const).map((axis) => (
          <NumberField
            key={axis}
            label={`End offset ${axis.toUpperCase()}`}
            value={definition.endOffset?.[axis] ?? 0}
            onCommit={(value) =>
              onPatch({
                endOffset: { x: definition.endOffset?.x ?? 0, y: definition.endOffset?.y ?? 0, [axis]: value },
              })
            }
          />
        ))}
      </fieldset>
    </>
  );
}

function TargetFields({
  target,
  onCommit,
}: {
  target: { x: number; y: number };
  onCommit: (target: { x: number; y: number }) => void;
}) {
  return (
    <fieldset>
      <legend>Default target (rig local)</legend>
      {(['x', 'y'] as const).map((axis) => (
        <NumberField
          key={axis}
          label={`Target ${axis.toUpperCase()}`}
          value={target[axis]}
          onCommit={(value) => onCommit({ ...target, [axis]: value })}
        />
      ))}
    </fieldset>
  );
}

export function RigIKCreateForm({
  controller,
  rig,
  onClose,
}: {
  controller: AttachmentController;
  rig: RigDefinition;
  onClose: () => void;
}) {
  const [definition, setDefinition] = useState<TwoBoneIKDefinition>(() => ({
    name: '',
    rootBone: '',
    middleBone: '',
    endBone: '',
    ...rigIKChains(rig)[0],
  }));
  const [automaticTarget, setAutomaticTarget] = useState(true);
  const patch = (values: IKConstraintPatch) => setDefinition((previous) => ({ ...previous, ...values }));
  const error = rigIKFormError(rig, definition);
  return (
    <form
      aria-label="Create IK constraint"
      onSubmit={(event) => {
        event.preventDefault();
        if (error) return;
        controller.createIK(definition);
        if (controller.getSnapshot().editor?.state.workingCopy.ik?.some((entry) => entry.name === definition.name))
          onClose();
      }}
    >
      <p>Choose three connected joints, name the constraint, then configure its default target and solver.</p>
      {!rigIKChains(rig).length && <p role="alert">Add a chain of three connected bones before creating IK.</p>}
      <ChainFields rig={rig} definition={definition} onPatch={patch} />
      <label>
        Constraint name
        <input
          aria-label="Constraint name"
          required
          value={definition.name}
          onChange={(event) => setDefinition({ ...definition, name: event.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={automaticTarget}
          onChange={(event) => {
            setAutomaticTarget(event.target.checked);
            setDefinition((previous) => {
              const { target: _target, ...rest } = previous;
              return event.target.checked ? rest : { ...rest, target: { x: 0, y: 0 } };
            });
          }}
        />
        Initialize target at current end effector
      </label>
      {!automaticTarget && (
        <TargetFields target={definition.target ?? { x: 0, y: 0 }} onCommit={(target) => patch({ target })} />
      )}
      <Settings definition={definition} onPatch={patch} />
      {definition.name && error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!!error}>
        Create IK Constraint
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}

export function RigIKPanel({ controller }: { controller: AttachmentController }) {
  const { editor, message } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [creating, setCreating] = useState(false);
  // Character/session replacement discards only the local creation form.
  useEffect(() => setCreating(false), [editor]);
  if (!editor) return null;
  const state = editor.state;
  const constraints = state.workingCopy.ik ?? [];
  const selected = constraints.find((entry) => entry.name === state.selectedIKConstraintId);
  const dependencies = selected ? state.ikConstraintDependencies(selected.name) : [];
  const patch = (values: IKConstraintPatch) => {
    if (selected) controller.updateIK(selected.name, values);
  };
  return (
    <section className="attachment-panel rig-ik-panel" aria-label="IK constraints">
      <h3>IK constraints</h3>
      {!constraints.length && (
        <>
          <p>No IK constraints</p>
          <p>Create an IK constraint to control a chain of bones using a target.</p>
        </>
      )}
      <div className="action-grid">
        {constraints.map((entry) => (
          <button
            key={entry.name}
            type="button"
            aria-pressed={entry.name === selected?.name}
            onClick={() => controller.selectIK(entry.name)}
          >
            {entry.name}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setCreating(true)}>
        + Add IK Constraint
      </button>
      <label>
        <input
          type="checkbox"
          checked={state.ikPreview}
          onChange={(event) => controller.previewIK(event.target.checked)}
        />
        Live solver preview
      </label>
      <p>Targets edit rig defaults. Drag a crosshair or enter rig local coordinates. Escape cancels a drag.</p>
      {creating && (
        <RigIKCreateForm
          key={state.name ?? 'rig'}
          controller={controller}
          rig={state.workingCopy}
          onClose={() => setCreating(false)}
        />
      )}
      {selected && (
        <fieldset key={selected.name}>
          <legend>Selected: {selected.name}</legend>
          <ChainFields rig={state.workingCopy} definition={selected} disabled={!!dependencies.length} onPatch={patch} />
          {selected.target ? (
            <TargetFields target={selected.target} onCommit={(target) => patch({ target })} />
          ) : (
            <p>No static target. Drag the end effector crosshair to author a default target.</p>
          )}
          {editor.getIKTargetEditIssue(selected.name) && (
            <p role="status">{editor.getIKTargetEditIssue(selected.name)}</p>
          )}
          <Settings definition={selected} protectedChain={!!dependencies.length} onPatch={patch} />
          {!!dependencies.length && (
            <p role="status">
              Used by {dependencies.join(', ')}. Resolve these dependencies before deleting or changing the chain or end
              offset.
            </p>
          )}
          <button type="button" disabled={!!dependencies.length} onClick={() => controller.removeIK(selected.name)}>
            Delete Constraint
          </button>
        </fieldset>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
