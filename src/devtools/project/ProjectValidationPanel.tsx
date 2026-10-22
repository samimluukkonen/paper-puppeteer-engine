import type { ProjectDiagnostic, ProjectInspection, ValidationContext } from './projectInspection.js';

export function ProjectValidationPanel({
  report,
  busy,
  revalidate,
  openAsset,
}: {
  report: ProjectInspection;
  busy: boolean;
  revalidate: (context: ValidationContext) => void;
  openAsset: (issue: ProjectDiagnostic) => void;
}) {
  return (
    <section className="project-panel project-validation" aria-label="Project validation">
      <div className="workspace-panel-heading">
        <h2>Project Validation</h2>
        <div className="project-actions">
          <label>
            Check for{' '}
            <select
              aria-label="Validation context"
              value={report.context}
              disabled={busy}
              onChange={(event) => revalidate(event.target.value === 'export' ? 'export' : 'draft')}
            >
              <option value="draft">Editing draft</option>
              <option value="export">Production export</option>
            </select>
          </label>
          <button disabled={busy} onClick={() => revalidate(report.context)}>
            Revalidate
          </button>
        </div>
      </div>
      <p aria-live="polite">
        {report.counts.error} Errors · {report.counts.warning} Warnings
      </p>
      <p className="workspace-caption">
        Drafts can keep unresolved artwork while editing. Production exports require all referenced images and static
        frames to be resolved.
      </p>
      {!report.issues.length && <p>No problems found in the registered project assets.</p>}
      <ul className="project-assets">
        {report.issues.map((issue, index) => (
          <li key={`${issue.asset.owner}:${issue.path}:${index}`}>
            <strong className={`project-validation-${issue.severity}`}>{issue.severity.toUpperCase()}</strong>
            <p>{issue.message}</p>
            {issue.path && <p className="workspace-caption">Reference: {issue.path}</p>}
            <p className="workspace-caption">{issue.advice}</p>
            {issue.view !== 'project' && (
              <button disabled={busy} onClick={() => openAsset(issue)}>
                Open Affected Asset ·{' '}
                {issue.view === 'scene'
                  ? 'Scene Editor'
                  : issue.view === 'animation'
                    ? 'Animation Editor'
                    : 'Rig Editor'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
