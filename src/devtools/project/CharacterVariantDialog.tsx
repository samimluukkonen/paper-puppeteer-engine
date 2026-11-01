import { useEffect, useRef, useState } from 'react';
import { characterCatalog } from '../../shared/characterCatalog.js';
import { suggestCharacterId } from '../shared/newCharacter.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

export type CharacterCreationKind = 'variant' | 'copy' | 'template';

/** Shared rigs are explicit references; copies and template instances are detached snapshots. */
export function CharacterVariantDialog({
  workspace,
  source,
  kind,
  busy,
  run,
  created,
  close,
}: {
  workspace: ProjectWorkspace;
  source: string;
  kind: CharacterCreationKind;
  busy: boolean;
  run(this: void, operation: () => Promise<void>): void;
  created(this: void, id: string, independent: boolean): Promise<void>;
  close(this: void): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(source);
  const [name, setName] = useState('');
  const [independent, setIndependent] = useState(kind !== 'variant');
  const [skin, setSkin] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const entry = workspace.definition.characters.find((entry) => entry.id === selected);
  const owner = entry && workspace.rigOwner(entry.id);
  const skins = entry ? workspace.characterSkins(entry.id) : [];
  const appearance = skin || entry?.variant?.skin || (owner ? workspace.character(owner).definition.defaultSkin : '');
  const warnings = entry ? workspace.appearanceWarnings(entry.id, appearance) : [];
  const title =
    kind === 'template'
      ? 'New Character from Template'
      : kind === 'copy'
        ? 'Create Independent Character Copy'
        : 'Create Character Variant';
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <h2>{title}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            setError('');
            try {
              if (!entry) throw new Error('Select a source character.');
              const id = suggestCharacterId(name, [
                ...workspace.definition.characters.map(({ id }) => id),
                ...characterCatalog.map(({ id }) => id),
              ]);
              const result =
                kind === 'template'
                  ? await workspace.createCharacterFromTemplate(entry.id, name, id)
                  : independent
                    ? await workspace.copyCharacter(entry.id, name, id)
                    : workspace.createCharacterVariant(entry.id, name, appearance, id);
              close();
              await created(result, independent);
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure));
              throw failure;
            }
          });
        }}
      >
        {error && (
          <p className="project-validation-error" role="alert">
            {error}
          </p>
        )}
        <label>
          {kind === 'template' ? 'Template' : 'Source character'}
          <select
            required
            value={selected}
            disabled={busy}
            onChange={(event) => {
              setSelected(event.target.value);
              setSkin('');
            }}
          >
            {workspace.definition.characters
              .filter((entry) => kind !== 'template' || entry.template)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          New character name
          <input
            required
            maxLength={100}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {kind === 'variant' && (
          <label>
            Rig ownership
            <select
              value={independent ? 'copy' : 'shared'}
              disabled={busy}
              onChange={(event) => setIndependent(event.target.value === 'copy')}
            >
              <option value="shared">Reuse shared rig and animations</option>
              <option value="copy">Create independent character copy</option>
            </select>
          </label>
        )}
        <p className="workspace-caption">
          {independent
            ? 'Copies the current skeleton, skins, attachments and animations into a new stable identity. Image binaries are reused. Future source or template edits do not affect this character.'
            : `Shared rig: ${owner}. Rig, artwork and animation edits affect every variant. This character owns its name and selected appearance only.`}
        </p>
        {!independent && (
          <label>
            Appearance skin
            <select required value={appearance} disabled={busy} onChange={(event) => setSkin(event.target.value)}>
              {skins.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!!warnings.length && (
          <details>
            <summary>Mesh compatibility</summary>
            {warnings.map((warning) => (
              <p key={warning} className="workspace-caption">
                {warning}
              </p>
            ))}
          </details>
        )}
        <div className="project-dialog-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="workspace-primary" disabled={busy || !entry}>
            {independent ? 'Create Character' : 'Create Variant'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
