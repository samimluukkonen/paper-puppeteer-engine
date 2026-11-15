import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { analyzeRigCompatibility } from '../../engine/core.js';
import type { AnimationClip, RetargetOptions, RigBoneMapping } from '../../engine/data.js';
import { animationAssetReference, type AnimationLibraryEntry } from '../shared/animationLibraryData.js';
import { CharacterRigSelect } from '../shared/CharacterRigSelect.js';
import type { AnimationRetargetSession } from './AnimationRetargetSession.js';
import { MappingEditor } from './ProjectRigMapping.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

const Comparison = lazy(() =>
  import('../shared/RetargetComparison.js').then((module) => ({ default: module.RetargetComparison })),
);

export function AnimationRetargetDialog({
  workspace,
  session,
  entry,
  changeSource,
  create,
  close,
}: {
  workspace: ProjectWorkspace;
  session: AnimationRetargetSession;
  entry: AnimationLibraryEntry;
  changeSource(this: void, entry: AnimationLibraryEntry): void;
  create(this: void, target: string, clip: AnimationClip, targetRevision: string): Promise<void>;
  close(this: void): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [, refresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('Select a target character and a reviewed bone mapping.');
  const [preview, setPreview] = useState<ReturnType<AnimationRetargetSession['previewLoader']>>();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const onReady = useCallback((ready: boolean) => setReady(ready), []);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const invalidate = () => {
    setPreview(undefined);
    setReady(false);
    refresh((value) => value + 1);
  };
  const attempt = (action: () => void) => {
    try {
      action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    refresh((value) => value + 1);
  };
  const regenerate = () => {
    invalidate();
    attempt(() => {
      const result = session.preview();
      if (!result.animation) {
        setMessage('Preview failed. Resolve the errors below and review the mapping.');
        return;
      }
      setPreview(() => session.previewLoader());
      setMessage('Review both characters and all diagnostics before creating the target animation.');
    });
  };
  const mappingChoices = (workspace.definition.rigMappings ?? []).filter(
    (mapping) => mapping.sourceRigId === session.sourceCharacter && mapping.targetRigId === session.targetCharacter,
  );
  const report =
    session.target && session.mapping
      ? analyzeRigCompatibility(
          { id: session.sourceCharacter, rig: session.source.rig },
          { id: session.targetCharacter, rig: session.target.rig },
          session.mapping,
        )
      : undefined;
  const issues =
    session.result?.diagnostics ??
    (report ? [...report.diagnostics, ...report.ikDiagnostics, ...report.meshDiagnostics] : []);
  const options = session.options;
  const changeOptions = (patch: Partial<RetargetOptions>) => {
    session.setOptions({ ...options, ...patch });
    invalidate();
    setMessage('Options changed. Preview Result again before creating the animation.');
  };
  const selectMapping = (mapping: RigBoneMapping | undefined) => {
    session.selectMapping(mapping);
    invalidate();
  };
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog retarget-dialog"
      aria-label="Retarget Animation"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) close();
      }}
    >
      <h2>Retarget Animation</h2>
      <p>Compare the source and a detached target result, then create an independently editable animation.</p>
      <fieldset disabled={saving} className="retarget-settings">
        <label>
          Source animation
          <select
            aria-label="Source animation"
            value={animationAssetReference(entry)}
            onChange={(event) => {
              const selected = workspace
                .animationLibrary()
                .find((candidate) => animationAssetReference(candidate) === event.target.value);
              if (selected) changeSource(selected);
            }}
          >
            {workspace.animationLibrary().map((candidate) => (
              <option key={animationAssetReference(candidate)} value={animationAssetReference(candidate)}>
                {candidate.characterName} · {candidate.clip.library?.displayName ?? candidate.clip.name}
              </option>
            ))}
          </select>
        </label>
        <p>
          Source character: <strong>{entry.characterName}</strong>
        </p>
        <CharacterRigSelect
          label="Target character"
          value={session.targetCharacter}
          choices={workspace.definition.characters.filter(({ id }) => id !== session.sourceCharacter)}
          emptyLabel="Choose another character"
          onChange={(id) =>
            attempt(() => {
              session.selectTarget(id);
              setEditing(false);
              invalidate();
              setMessage('Select a saved mapping, or open the Bone Mapping Editor to create one.');
            })
          }
        />
        <label>
          Bone mapping
          <select
            aria-label="Bone mapping"
            value={session.mapping?.id ?? ''}
            disabled={!session.target}
            onChange={(event) => {
              selectMapping(mappingChoices.find(({ id }) => id === event.target.value));
              setEditing(false);
            }}
          >
            <option value="">Choose a reviewed mapping</option>
            {mappingChoices.map((mapping) => (
              <option key={mapping.id} value={mapping.id}>
                {mapping.name}
              </option>
            ))}
          </select>
        </label>
        <div className="animation-library-actions">
          <button
            type="button"
            disabled={!session.target}
            onClick={() => {
              invalidate();
              setEditing(!editing);
            }}
          >
            {editing
              ? 'Back to retargeting'
              : session.mapping
                ? 'Review / adjust bone mapping'
                : 'Open Bone Mapping Editor'}
          </button>
        </div>
        <p role="status">
          Compatibility:{' '}
          {report
            ? `${report.mappingValid ? 'Validated mapping' : 'Invalid mapping — repair required'} · ${report.level}`
            : 'No validated mapping selected'}
        </p>
        {editing && session.target && (
          <MappingEditor
            key={`${session.targetCharacter}:${session.mapping?.id ?? 'new'}`}
            workspace={workspace}
            source={{ id: session.sourceCharacter, rig: session.source.rig }}
            target={{ id: session.targetCharacter, rig: session.target.rig }}
            initial={session.mapping}
            busy={saving}
            onSaved={(mapping) => {
              selectMapping(mapping);
              setEditing(false);
              regenerate();
            }}
          />
        )}
        {!editing && (
          <>
            <label>
              Root motion
              <select
                aria-label="Root motion"
                value={options.rootMotion}
                onChange={(event) => changeOptions({ rootMotion: event.target.value as RetargetOptions['rootMotion'] })}
              >
                <option value="preserve">Preserve displacement</option>
                <option value="scale-by-character">Scale to character</option>
                <option value="omit">Omit root motion</option>
              </select>
            </label>
            <p className="workspace-caption">
              Root motion moves the whole character. Scaling uses the ratio of mapped rest-edge lengths; skeletal root
              keys remain separate.
            </p>
            <label>
              Local translation
              <select
                aria-label="Local translation"
                value={options.translation}
                onChange={(event) =>
                  changeOptions({ translation: event.target.value as NonNullable<RetargetOptions['translation']> })
                }
              >
                <option value="scale-by-bone">Scale deltas by bone length</option>
                <option value="preserve-delta">Preserve local deltas</option>
              </select>
            </label>
            <p className="workspace-caption">
              Non-root keyed translation is relative to each rest pose. Unkeyed target channels keep their own rest
              values.
            </p>
            <p>
              IK: <strong>FK-only transfer</strong>. Bake source IK first to transfer solved motion. Source IK tracks
              are omitted and target constraints are suppressed on the new clip.
            </p>
            <p>Missing tracks: skip unmapped source tracks with warnings. Extra target branches stay at rest.</p>
            <details>
              <summary>Pelvis / body translation override (optional)</summary>
              <p>
                Choose mapped source bones explicitly; anatomy is never inferred. This overrides local translation,
                including skeletal root motion keys.
              </p>
              {session.source.rig.bones.map((bone) => (
                <label key={bone.id}>
                  <input
                    type="checkbox"
                    disabled={!session.mapping?.entries.some(({ sourceBoneId }) => sourceBoneId === bone.id)}
                    checked={options.pelvis?.sourceBoneIds.includes(bone.id) ?? false}
                    onChange={(event) => {
                      const ids = (options.pelvis?.sourceBoneIds ?? []).filter((id) => id !== bone.id);
                      if (event.target.checked) ids.push(bone.id);
                      changeOptions({
                        pelvis: {
                          sourceBoneIds: ids,
                          translation: options.pelvis?.translation ?? 'scale-by-character',
                        },
                      });
                    }}
                  />
                  {bone.id}
                </label>
              ))}
              <label>
                Pelvis translation
                <select
                  aria-label="Pelvis translation"
                  disabled={!options.pelvis?.sourceBoneIds.length}
                  value={options.pelvis?.translation ?? 'scale-by-character'}
                  onChange={(event) =>
                    changeOptions({
                      pelvis: {
                        sourceBoneIds: options.pelvis?.sourceBoneIds ?? [],
                        translation: event.target.value as 'preserve-delta' | 'scale-by-character',
                      },
                    })
                  }
                >
                  <option value="scale-by-character">Scale to character</option>
                  <option value="preserve-delta">Preserve deltas</option>
                </select>
              </label>
            </details>
          </>
        )}
      </fieldset>
      <p role="status">{message}</p>
      {!!issues.length && (
        <section aria-label="Retargeting diagnostics">
          <h3>Diagnostics ({issues.length})</h3>
          <ul className="retarget-diagnostics">
            {issues.map((issue, index) => (
              <li key={index} className={issue.severity === 'error' ? 'project-validation-error' : undefined}>
                {issue.severity} · {issue.code}: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview && (
        <Suspense fallback={<p role="status">Loading comparison renderer…</p>}>
          <Comparison
            key={session.result?.animation?.name}
            load={preview}
            sourceAnimation={session.sourceAnimation.name}
            targetAnimation={session.name}
            groundReference={session.groundReference}
            onReady={onReady}
          />
        </Suspense>
      )}
      <div className="animation-library-actions">
        <button type="button" disabled={saving || editing || !report?.mappingValid} onClick={regenerate}>
          Preview Result
        </button>
        <button
          type="button"
          className="workspace-primary"
          disabled={saving || editing || !ready || !session.result?.animation}
          onClick={() => {
            setSaving(true);
            void (async () => {
              try {
                const clip = session.acceptedAnimation();
                await create(session.targetCharacter, clip, session.mapping!.targetRevision);
                close();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error));
                setSaving(false);
                invalidate();
              }
            })();
          }}
        >
          {saving ? 'Creating Animation…' : 'Create Animation'}
        </button>
        <button type="button" disabled={saving} onClick={close}>
          Cancel
        </button>
      </div>
      <p className="workspace-caption">
        Cancel discards the preview. Explicitly saved bone mappings remain project metadata. Creation opens the target
        Animation Editor; local autosave and Export Project include the new animation.
      </p>
    </dialog>
  );
}
