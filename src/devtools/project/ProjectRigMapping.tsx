import { useMemo, useState, type ReactNode } from 'react';
import { createRigBoneMapping, type IdentifiedRig, type RigBoneMapping } from '../../engine/rigBoneMapping.js';
import {
  analyzeRigCompatibility,
  suggestRigBoneMapping,
  type RigMappingSuggestions,
} from '../../engine/rigCompatibility.js';
import { CharacterRigSelect } from '../shared/CharacterRigSelect.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

const labels = {
  exact: 'Exact / shared rig',
  mappable: 'Mappable rig',
  partial: 'Partially compatible',
  incompatible: 'Incompatible',
};

export function ProjectRigMapping({ workspace, busy }: { workspace: ProjectWorkspace; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [loaded, setLoaded] = useState<RigBoneMapping>();
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState('');
  const choose = (id: string, side: 'source' | 'target') => {
    (side === 'source' ? setSource : setTarget)(id);
    setLoaded(undefined);
    setGeneration((value) => value + 1);
    setStatus('');
  };
  let comparison: ReactNode = (
    <p>Choose source and target character rigs to compare their current authored structure.</p>
  );
  if (open && source && target) {
    try {
      const a = workspace.rigSource(source),
        b = workspace.rigSource(target);
      comparison = (
        <MappingEditor
          key={`${source}:${target}:${generation}`}
          workspace={workspace}
          source={a}
          target={b}
          initial={loaded}
          busy={busy}
        />
      );
    } catch (error) {
      comparison = <p role="status">{error instanceof Error ? error.message : String(error)}</p>;
    }
  }
  const saved = workspace.definition.rigMappings ?? [];
  return (
    <details
      className="project-panel project-rig-mapping"
      data-guide-id={GUIDE_TARGETS.projectRigMapping}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Rig compatibility &amp; bone mapping ({saved.length})</summary>
      {open && (
        <div className="project-rig-mapping-content">
          <p className="workspace-caption">
            Compare authored rigs and approve bone correspondence for future retargeting. Saving a mapping does not
            transfer animations.
          </p>
          <div className="project-mapping-pickers">
            <CharacterRigSelect
              label="Source rig"
              value={source}
              onChange={(id) => choose(id, 'source')}
              choices={workspace.definition.characters}
              emptyLabel="Choose a source character"
              disabled={busy}
            />
            <CharacterRigSelect
              label="Target rig"
              value={target}
              onChange={(id) => choose(id, 'target')}
              choices={workspace.definition.characters}
              emptyLabel="Choose a target character"
              disabled={busy}
            />
          </div>
          {comparison}
          <h3>Saved mappings</h3>
          {!saved.length && <p>No approved mappings. Review correspondences and choose Save Mapping.</p>}
          <ul className="project-mapping-saved">
            {saved.map((mapping) => {
              let state = 'Needs review';
              try {
                const report = workspace.rigMappingReport(mapping);
                state = report.mappingValid ? labels[report.level] : 'Invalid or stale — review required';
              } catch {
                state = 'Rig unavailable — repair or remove mapping';
              }
              return (
                <li key={mapping.id}>
                  <strong>{mapping.name}</strong>
                  <span>
                    {mapping.sourceRigId} → {mapping.targetRigId} · {state}
                  </span>
                  <div className="project-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setSource(mapping.sourceRigId);
                        setTarget(mapping.targetRigId);
                        setLoaded(mapping);
                        setGeneration((value) => value + 1);
                      }}
                    >
                      Review mapping
                    </button>
                    <button
                      className="workspace-danger"
                      disabled={busy}
                      onClick={() => {
                        workspace.removeRigMapping(mapping.id);
                        setStatus('Mapping removed. Undo Project restores it.');
                      }}
                    >
                      Remove mapping
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p role="status">{status}</p>
        </div>
      )}
    </details>
  );
}

function MappingEditor({
  workspace,
  source,
  target,
  initial,
  busy,
}: {
  workspace: ProjectWorkspace;
  source: IdentifiedRig;
  target: IdentifiedRig;
  initial: RigBoneMapping | undefined;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(
    () =>
      initial ??
      createRigBoneMapping(source, target, [], crypto.randomUUID(), `${source.id} → ${target.id}`.slice(0, 200)),
  );
  const [proposals, setProposals] = useState<RigMappingSuggestions>();
  const [status, setStatus] = useState(
    'Review each correspondence. Save Mapping explicitly approves the current mapping.',
  );
  const { id: sourceId, rig: sourceRig } = source;
  const { id: targetId, rig: targetRig } = target;
  const report = useMemo(
    () => analyzeRigCompatibility({ id: sourceId, rig: sourceRig }, { id: targetId, rig: targetRig }, draft),
    [sourceId, sourceRig, targetId, targetRig, draft],
  );
  const issues = [...report.diagnostics, ...report.ikDiagnostics, ...report.meshDiagnostics];
  const stale = issues.some(({ code }) => code === 'stale-mapping');
  const change = (sourceBoneId: string, targetBoneId: string) => {
    setDraft({
      ...draft,
      entries: [
        ...draft.entries.filter((entry) => entry.sourceBoneId !== sourceBoneId),
        ...(targetBoneId ? [{ sourceBoneId, targetBoneId }] : []),
      ],
    });
    setStatus('Unsaved mapping edits. Validate and review before saving.');
  };
  const removed = draft.entries.filter((entry) => !source.rig.bones.some((bone) => bone.id === entry.sourceBoneId));
  return (
    <div className="project-mapping-editor">
      <label>
        Mapping name
        <input
          value={draft.name}
          maxLength={200}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <div className="project-actions">
        <button
          disabled={busy || stale}
          onClick={() => {
            const result = suggestRigBoneMapping(source, target);
            setProposals(result);
            setDraft({ ...draft, entries: result.entries });
            setStatus(
              'Suggestions are unsaved proposals. Review every row; choose ambiguous matches explicitly before saving.',
            );
          }}
        >
          Auto Suggest
        </button>
        <button
          disabled={busy}
          onClick={() =>
            setStatus(
              report.mappingValid
                ? 'Mapping validated against current rig revisions. Review compatibility diagnostics before saving.'
                : 'Validation failed. Resolve the listed mapping errors before saving.',
            )
          }
        >
          Validate
        </button>
        {stale && (
          <button
            disabled={busy}
            onClick={() => {
              setDraft(createRigBoneMapping(source, target, draft.entries, draft.id, draft.name || 'Bone mapping'));
              setProposals(undefined);
              setStatus(
                'Current rig revisions acknowledged. Review all rows and diagnostics, then Save Mapping to approve again.',
              );
            }}
          >
            Review current revisions
          </button>
        )}
        <button
          className="workspace-primary"
          disabled={busy || !report.mappingValid || !draft.name.trim()}
          onClick={() => {
            try {
              workspace.saveRigMapping({ ...draft, name: draft.name.trim() });
              setStatus('Mapping saved in project metadata. Local autosave and Export Project include it.');
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          Save Mapping
        </button>
      </div>
      <p role="status">{status}</p>
      <p>
        <strong>{labels[report.level]}</strong> · {report.matchingBones.length} matching · {report.missingBones.length}{' '}
        missing · {report.extraBones.length} extra target bones
      </p>
      <div className="project-mapping-table-scroll">
        <table className="project-mapping-table">
          <caption>Bone correspondence proposals</caption>
          <thead>
            <tr>
              <th>Source bone</th>
              <th>Target bone</th>
              <th>Review</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {source.rig.bones.map((bone) => {
              const entry = draft.entries.find((entry) => entry.sourceBoneId === bone.id);
              const suggestion = proposals?.suggestions.find((entry) => entry.sourceBoneId === bone.id);
              const errors = issues.filter((issue) => issue.sourceBoneId === bone.id && issue.severity === 'error');
              const missingTarget = entry && !target.rig.bones.some((bone) => bone.id === entry.targetBoneId);
              return (
                <tr key={bone.id}>
                  <th scope="row">
                    {bone.id}
                    <small>Parent: {bone.parent ?? '(root)'}</small>
                  </th>
                  <td>
                    <select
                      aria-label={`Target for ${bone.id}`}
                      aria-invalid={!!errors.length}
                      value={entry?.targetBoneId ?? ''}
                      disabled={busy}
                      onChange={(event) => change(bone.id, event.target.value)}
                    >
                      <option value="">Unmapped / skip</option>
                      {missingTarget && <option value={entry.targetBoneId}>{entry.targetBoneId} (missing)</option>}
                      {target.rig.bones.map((bone) => (
                        <option key={bone.id} value={bone.id}>
                          {bone.id} · {bone.parent ?? 'root'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {errors.length ? (
                      <span className="project-validation-error">{errors.map(({ message }) => message).join(' ')}</span>
                    ) : !entry ? (
                      suggestion?.ambiguous ? (
                        `Ambiguous: ${suggestion.targetBoneIds.join(', ')}. Choose explicitly.`
                      ) : (
                        'Missing / skipped'
                      )
                    ) : (
                      'Mapped'
                    )}
                    {suggestion && <small>{suggestion.reason}</small>}
                  </td>
                  <td>
                    <button
                      disabled={busy || !entry}
                      aria-label={`Remove correspondence for ${bone.id}`}
                      onClick={() => change(bone.id, '')}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {removed.map((entry) => (
        <p key={entry.sourceBoneId} className="project-validation-error">
          Missing source bone: {entry.sourceBoneId} → {entry.targetBoneId}{' '}
          <button disabled={busy} onClick={() => change(entry.sourceBoneId, '')}>
            Remove obsolete correspondence
          </button>
        </p>
      ))}
      <details className="project-mapping-diagnostics">
        <summary>Compatibility diagnostics ({issues.length})</summary>
        {!issues.length && <p>No structural differences detected.</p>}
        <ul>
          {issues.map((issue, index) => (
            <li key={index} className={issue.severity === 'error' ? 'project-validation-error' : undefined}>
              {issue.severity}: {issue.message}
            </li>
          ))}
        </ul>
      </details>
      <p className="workspace-caption">
        Bone keys use absolute local transforms; proportions and rest orientation may need future retargeting. IK
        targets, constraint suppression, foot markers and mesh correction tracks need separate handling.
      </p>
    </div>
  );
}
