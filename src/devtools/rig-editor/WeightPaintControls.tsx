import { useState } from 'react';
import { boneHierarchy } from '../shared/boneHierarchy.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { InspectorNumberField } from '../shared/InspectorNumberField.js';
import type { AttachmentController } from './AttachmentController.js';
import type { RigEditor } from './RigEditor.js';

/** Mounted inside the shared mesh inspector; settings are view state, weights are authored data. */
export function WeightPaintControls({ controller, editor }: { controller: AttachmentController; editor: RigEditor }) {
  const [reset, setReset] = useState(0);
  const { state } = editor,
    mesh = state.selectedMesh;
  if (!mesh) return null;
  const boneId = state.weightBoneId;
  const vertex = mesh.vertices.find((entry) => entry.id === state.selectedMeshVertexId);
  const influences = vertex?.influences ?? [{ boneId: state.meshSlotBoneId, weight: 1 }];
  const weight = influences.find((entry) => entry.boneId === boneId)?.weight ?? 0;
  const previewBone = state.rig.hasBone(editor.weightPreviewBoneId) ? editor.weightPreviewBoneId : boneId;
  const degrees = (editor.weightPreviewRotation * 180) / Math.PI;
  const bones = boneHierarchy(state.rig).map((bone) => (
    <option key={bone.id} value={bone.id}>
      {'　'.repeat(bone.depth)}
      {bone.id}
    </option>
  ));
  return (
    <section aria-label="Bone weight painting" className="attachment-panel">
      <button
        data-guide-id={GUIDE_TARGETS.rigWeightMode}
        type="button"
        aria-pressed={state.editMode === 'weights'}
        onClick={() => controller.meshAction('paint')}
      >
        Paint Bone Weights
      </button>
      <div className="weight-paint-controls" hidden={state.editMode !== 'weights'}>
        <p>Selected mesh: {mesh.id}. Brush existing vertices; Escape cancels the stroke. Each stroke is one Undo.</p>
        <label data-guide-id={GUIDE_TARGETS.rigWeightBone}>
          Influence bone
          <select
            aria-label="Influence bone"
            value={boneId}
            onChange={(event) => controller.weightSettings({ boneId: event.target.value })}
          >
            {bones}
          </select>
        </label>
        <div className="weight-brush-controls" data-guide-id={GUIDE_TARGETS.rigWeightBrush}>
          <label>
            Brush action
            <select
              aria-label="Brush action"
              value={state.brushErase ? 'erase' : 'paint'}
              onChange={(event) => controller.weightSettings({ erase: event.target.value === 'erase' })}
            >
              <option value="paint">Paint — add influence</option>
              <option value="erase">Erase — reduce influence</option>
            </select>
          </label>
          <InspectorNumberField
            label="Brush radius (screen pixels)"
            value={state.brushRadius}
            min={1}
            max={500}
            onCommit={(radius) => controller.weightSettings({ radius })}
          />
          <InspectorNumberField
            label="Brush strength"
            value={state.brushStrength}
            min={0}
            max={1}
            onCommit={(strength) => controller.weightSettings({ strength })}
          />
        </div>
        <label data-guide-id={GUIDE_TARGETS.rigWeightLimit}>
          Maximum influences per edited vertex
          <select
            aria-label="Maximum influences per edited vertex"
            value={state.weightInfluenceLimit}
            onChange={(event) => controller.weightSettings({ limit: Number(event.target.value) })}
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <small>
          Other weights keep their ratios. At the limit, keep the strongest other bones; ties use bone ID. Only edited
          vertices change. With a limit of 1, painting any positive weight assigns that bone fully.
        </small>
        <p>
          Gray: zero · Blue: weak · Orange: strong · Gold outline: selected vertex. Weights always total 100%. Fallback
          bone: {state.weightFallbackBoneId}.
        </p>
        <label data-guide-id={GUIDE_TARGETS.rigWeightVertex}>
          Weight vertex
          <select
            aria-label="Weight vertex"
            value={vertex?.id ?? ''}
            onChange={(event) => controller.selectMeshVertex(event.target.value)}
          >
            <option value="">Select a vertex</option>
            {mesh.vertices.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
              </option>
            ))}
          </select>
        </label>
        {vertex && (
          <fieldset key={`${mesh.id}:${vertex.id}:${boneId}:${reset}`}>
            <legend>Vertex weights: {vertex.id}</legend>
            <InspectorNumberField
              label="Selected bone weight"
              value={weight}
              min={0}
              max={1}
              onCommit={(value) => {
                if (!controller.editWeight(value)) setReset((value) => value + 1);
              }}
            />
            <ul>
              {influences.map((entry) => (
                <li key={entry.boneId}>
                  {entry.boneId}: {(entry.weight * 100).toFixed(2)}%
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <div className="action-grid" data-guide-id={GUIDE_TARGETS.rigWeightActions}>
          <button type="button" onClick={() => controller.meshAction('normalize')}>
            Normalize mesh weights
          </button>
          <button type="button" className="workspace-danger" onClick={() => controller.meshAction('reset')}>
            Reset mesh weights
          </button>
        </div>
        <small>
          Normalize preserves all influences. Reset assigns every vertex of this mesh to its slot bone; Undo restores
          painted weights.
        </small>
        <details data-guide-id={GUIDE_TARGETS.rigWeightPreview}>
          <summary>Preview deformation</summary>
          <div className="weight-preview-controls">
            <label>
              <input
                type="checkbox"
                checked={editor.weightPreviewEnabled}
                onChange={(event) => controller.weightPreview(event.target.checked, previewBone, degrees)}
              />
              Preview test bend
            </label>
            <label>
              Test bone
              <select
                aria-label="Test bone"
                value={previewBone}
                onChange={(event) => controller.weightPreview(editor.weightPreviewEnabled, event.target.value, degrees)}
              >
                {bones}
              </select>
            </label>
            <InspectorNumberField
              label="Test bend (degrees)"
              value={degrees}
              min={-180}
              max={180}
              onCommit={(value) => controller.weightPreview(true, previewBone, value)}
            />
            <label>
              Weight preview pose
              <select
                aria-label="Weight preview pose"
                value={editor.previewName}
                onChange={(event) => controller.previewPose(event.target.value)}
              >
                <option value="">Bind pose</option>
                {editor.previewClips.map((clip) => (
                  <option key={clip.name} value={clip.name}>
                    {clip.name}
                  </option>
                ))}
              </select>
            </label>
            {editor.previewName && (
              <InspectorNumberField
                label="Weight preview time (ms)"
                value={editor.previewTime}
                min={0}
                max={editor.previewClips.find((clip) => clip.name === editor.previewName)?.duration ?? 0}
                onCommit={(value) => controller.previewPose(editor.previewName, value)}
              />
            )}
            <small>
              Uses the runtime FK/IK and skinning evaluator. Test bends and clip sampling create no animation keys and
              are never exported.
            </small>
          </div>
        </details>
      </div>
    </section>
  );
}
