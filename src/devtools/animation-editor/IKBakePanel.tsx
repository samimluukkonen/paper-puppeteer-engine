import { useEffect, useSyncExternalStore } from 'react';
import type { IKBakeController } from './IKBakeController.js';

/** React renders controller proposals; no animation mutation or separate clock lives here. */
export function IKBakePanel({ controller }: { controller: IKBakeController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.hidePreview(), [controller]);
  const plan = state.plan?.success ? state.plan : null;
  return (
    <details
      className="animation-popover animation-ik-baking"
      onToggle={(event) => {
        if (!event.currentTarget.open) controller.hidePreview();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          controller.hidePreview();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>IK Baking</summary>
      <section className="animation-popover-content animation-bake-panel" aria-label="IK Baking">
        <h2>IK Baking</h2>
        <fieldset>
          <legend>Constraints to bake</legend>
          {!state.constraints.length && <p>No IK constraints in the loaded rig.</p>}
          {state.constraints.map((constraint) => (
            <label key={constraint.id} className="animation-bake-constraint">
              <input
                type="checkbox"
                checked={state.selectedIds.includes(constraint.id)}
                disabled={!!constraint.reason}
                onChange={(event) => controller.setConstraint(constraint.id, event.target.checked)}
              />
              <span>
                {constraint.id} → {constraint.bones.join(', ')}
                {constraint.reason && ` — ${constraint.reason}`}
              </span>
            </label>
          ))}
        </fieldset>
        <p>Bake range: Entire animation. Output: Bone rotation keyframes.</p>
        <label>
          Sampling FPS
          <input
            type="number"
            min="0"
            step="any"
            value={state.fps}
            onChange={(event) => controller.setFPS(event.target.value)}
          />
        </label>
        <label>
          Output interpolation
          <select value="linear" disabled>
            <option value="linear">Linear</option>
          </select>
        </label>
        <p>
          Sampling FPS controls key density. The animation retains its playback mode, FPS and existing interpolation
          settings.
        </p>
        {plan && (
          <div aria-label="Bake summary">
            <p>Constraints: {plan.sampling.constraintIds.join(', ')}</p>
            <p>
              Affected bones: {plan.affectedBones.length} ({plan.affectedBones.map((bone) => bone.boneId).join(', ')})
            </p>
            <p>Generated keys: {plan.generatedKeyCount}</p>
            <p>Existing keys to replace: {plan.replacedKeyCount}</p>
            <p>Sampling FPS: {plan.sampling.fps}</p>
            <p>Constraints deactivated for this animation: {plan.sampling.constraintIds.join(', ')}</p>
            {state.motionFidelity && (
              <div aria-label="Bake fidelity">
                <p>Runtime comparison: {state.motionFidelity.probes.length} key and between-key probes.</p>
                <p>
                  At keys: maximum joint error {((state.motionFidelity.atKeys.rotation * 180) / Math.PI).toFixed(6)}°;
                  endpoint error {state.motionFidelity.atKeys.endEffector.toFixed(6)} rig units.
                </p>
                <p>
                  Between keys: maximum joint error{' '}
                  {((state.motionFidelity.betweenKeys.rotation * 180) / Math.PI).toFixed(3)}°; endpoint error{' '}
                  {state.motionFidelity.betweenKeys.endEffector.toFixed(3)} rig units. Target: ≤2° and ≤1 rig unit.
                  Preview the reach before committing.
                </p>
              </div>
            )}
          </div>
        )}
        {state.issues.map((issue, index) => (
          <p key={index} role={issue.severity === 'error' ? 'alert' : undefined}>
            {issue.path && `${issue.path}: `}
            {issue.message}
          </p>
        ))}
        <div className="animation-bake-actions">
          <button
            type="button"
            disabled={!plan}
            aria-pressed={state.preview}
            onClick={() => controller.togglePreview()}
          >
            {state.preview ? 'Hide Bake Preview' : 'Preview Bake'}
          </button>
          <button type="button" disabled={!plan} onClick={() => controller.commit()}>
            Bake IK
          </button>
        </div>
        <p>
          Violet overlay: proposed baked animation. Original IK animation stays visible underneath. Scrub the timeline
          to compare; hide preview to inspect the original. Close this panel to clear the preview.
        </p>
        <p role="status">{state.feedback}</p>
      </section>
    </details>
  );
}
