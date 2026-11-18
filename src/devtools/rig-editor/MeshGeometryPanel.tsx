import { useState, useSyncExternalStore } from 'react';
import { meshEdges } from '../../engine/core.js';
import { InspectorSection } from '../../ui/InspectorSection.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { InspectorNumberField } from '../shared/InspectorNumberField.js';
import type { AttachmentController } from './AttachmentController.js';
import { RIG_IDS } from './elementIds.js';
import { WeightPaintControls } from './WeightPaintControls.js';

export function MeshGeometryPanel({
  controller,
  embedded = false,
}: {
  controller: AttachmentController;
  embedded?: boolean;
}) {
  const [fieldReset, setFieldReset] = useState(0);
  const { editor, message } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const commitVertex = (axis: 'x' | 'y', value: number) => {
    if (!controller.editMeshVertex(axis, value)) setFieldReset((reset) => reset + 1);
  };
  const state = editor?.state;
  const mesh = state?.selectedMesh;
  const vertex = mesh?.vertices.find((v) => v.id === state?.selectedMeshVertexId);
  const slot = state?.selection?.type === 'slot' ? state.selection.id : '';
  const id = slot ? state?.resolvedAttachment(slot) : undefined;
  return (
    <InspectorSection id="mesh-geometry-panel" embedded={embedded} summary="Mesh geometry" className="attachment-panel">
      {!state ? (
        <p>Load a character to edit mesh geometry.</p>
      ) : (
        <section aria-label="Mesh geometry tools" data-guide-id={GUIDE_TARGETS.rigMeshTools}>
          <label data-guide-id={GUIDE_TARGETS.rigMeshSkin}>
            Mesh skin
            <select
              aria-label="Mesh skin"
              value={state.activeSkin}
              onChange={(event) => controller.selectSkin(event.target.value)}
            >
              {state.skins.map((skin) => (
                <option key={skin.name} value={skin.name}>
                  {skin.name}
                </option>
              ))}
            </select>
          </label>
          <label data-guide-id={GUIDE_TARGETS.rigMeshSlot}>
            Mesh attachment slot
            <select
              aria-label="Mesh attachment slot"
              value={slot}
              onChange={(event) => controller.selectSlot(event.target.value, 'mesh')}
            >
              <option value="" disabled>
                Select a slot
              </option>
              {(state.workingCopy.slots ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                </option>
              ))}
            </select>
          </label>
          {!mesh ? (
            <>
              <p>
                Select a rigid sprite slot to create a rectangular mesh. The source artwork and other skin assignments
                are preserved. Converting the default skin creates and selects a new skin variant.
              </p>
              <button
                type="button"
                className="workspace-primary"
                data-guide-id={GUIDE_TARGETS.rigMeshWorkflow}
                disabled={!id}
                onClick={() => controller.convertToMesh()}
              >
                Convert to Mesh Attachment
              </button>
            </>
          ) : (
            <>
              <p>
                {mesh.id}: {mesh.vertices.length} vertices · {mesh.triangles.length / 3} triangles
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={editor?.meshDiagnosticsEnabled ?? false}
                  onChange={(event) => controller.meshDiagnostics(event.target.checked)}
                />
                Show mesh diagnostics
              </label>
              <p id={RIG_IDS.meshDiagnosticsStatus} hidden={!editor?.meshDiagnosticsEnabled} />
              {editor && <WeightPaintControls controller={controller} editor={editor} />}
              <button
                type="button"
                data-guide-id={GUIDE_TARGETS.rigMeshWorkflow}
                aria-pressed={state.editMode === 'mesh'}
                onClick={() => controller.meshAction('edit')}
              >
                Edit Mesh Geometry
              </button>
              <div className="mesh-geometry-controls" hidden={state.editMode === 'weights'}>
                <p>
                  Cyan diamonds are mesh vertices. Select a diamond or edge in the canvas. Drag vertices; Escape
                  cancels. Use the wheel to zoom and middle drag to pan.
                </p>
                <label>
                  Mesh vertex
                  <select
                    aria-label="Mesh vertex"
                    value={vertex?.id ?? ''}
                    onChange={(event) => controller.selectMeshVertex(event.target.value)}
                  >
                    <option value="">Select a vertex</option>
                    {mesh.vertices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.id}
                      </option>
                    ))}
                  </select>
                </label>
                {vertex && (
                  <fieldset key={`${mesh.id}:${vertex.id}:${fieldReset}`}>
                    <legend>Attachment-local position</legend>
                    <InspectorNumberField
                      label="Vertex X"
                      value={vertex.x}
                      onCommit={(value) => commitVertex('x', value)}
                    />
                    <InspectorNumberField
                      label="Vertex Y"
                      value={vertex.y}
                      onCommit={(value) => commitVertex('y', value)}
                    />
                    <small>
                      UV: {vertex.u.toFixed(4)}, {vertex.v.toFixed(4)} (retained when moving)
                    </small>
                  </fieldset>
                )}
                <label>
                  Mesh edge
                  <select
                    aria-label="Mesh edge"
                    value={state.selectedMeshEdge?.join(':') ?? ''}
                    onChange={(event) => controller.selectMeshEdge(event.target.value)}
                  >
                    <option value="">Select an edge</option>
                    {meshEdges(mesh).map(([a, b]) => (
                      <option key={`${a}:${b}`} value={`${a}:${b}`}>
                        {mesh.vertices[a]!.id} — {mesh.vertices[b]!.id}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="action-grid">
                  <button
                    type="button"
                    className="workspace-primary"
                    disabled={!state.selectedMeshEdge}
                    onClick={() => controller.meshAction('subdivide')}
                  >
                    Subdivide edge
                  </button>
                  <button
                    type="button"
                    className="workspace-danger"
                    disabled={!vertex}
                    onClick={() => controller.meshAction('delete')}
                  >
                    Delete vertex
                  </button>
                </div>
                <small>
                  Deletion triangulates a connected fan. Keep corners when no valid replacement triangle exists. Invalid
                  edits leave the mesh unchanged.
                </small>
                <details>
                  <summary>Triangle inspection ({mesh.triangles.length / 3})</summary>
                  <ol>
                    {Array.from({ length: mesh.triangles.length / 3 }, (_, i) => (
                      <li key={i}>
                        {mesh.triangles
                          .slice(i * 3, i * 3 + 3)
                          .map((index) => mesh.vertices[index]!.id)
                          .join(' → ')}
                      </li>
                    ))}
                  </ol>
                </details>
                <p>Topology valid. UVs remain attached to vertices; subdivision averages endpoint UVs.</p>
              </div>
            </>
          )}
          <p role="status">{state.meshFeedback}</p>
          <p role="status">{message}</p>
        </section>
      )}
    </InspectorSection>
  );
}
