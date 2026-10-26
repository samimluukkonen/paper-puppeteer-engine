import { useState, useSyncExternalStore } from 'react';
import { InspectorSection } from '../../ui/InspectorSection.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { AttachmentController } from './AttachmentController.js';
import './attachments.css';

export function AttachmentPanel({
  controller,
  authoring = true,
  defaultOpen = false,
  embedded = false,
}: {
  controller: AttachmentController;
  authoring?: boolean;
  defaultOpen?: boolean;
  embedded?: boolean;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [attachmentId, setAttachmentId] = useState('');
  const [texture, setTexture] = useState('');
  const [frame, setFrame] = useState('');
  const [numericFrame, setNumericFrame] = useState(false);
  const [skinName, setSkinName] = useState('');
  const editor = snapshot.editor;
  const state = editor?.state;
  const selection = state?.selection;
  const slot = selection?.type === 'slot' ? selection.id : '';
  const active = state?.activeSkin ?? '';
  const skin = state?.skins.find((entry) => entry.name === active);
  const attachment = slot ? state?.resolvedAttachment(slot) : undefined;
  const assets = controller.artwork?.getSnapshot().targets ?? [];
  const selectedTexture = assets.some((asset) => asset.key === texture) ? texture : (assets[0]?.key ?? '');
  const errors = state?.validationIssues().filter((issue) => issue.severity === 'error') ?? [];
  const mapping = slot && skin && Object.hasOwn(skin.slots, slot) ? skin.slots[slot] : undefined;
  return (
    <InspectorSection
      embedded={embedded}
      defaultOpen={defaultOpen}
      className="attachment-panel"
      id="attachment-panel"
      summary="Attachments & skins"
    >
      {!state ? (
        <p>Load a character to manage attachments.</p>
      ) : (
        <section aria-label="Attachments and skins">
          <label>
            Active skin
            <select
              data-guide-id={GUIDE_TARGETS.rigActiveSkin}
              aria-label="Active skin"
              value={active}
              onChange={(event) => controller.selectSkin(event.target.value)}
            >
              {!state.skins.length && <option value="">No skins</option>}
              {state.skins.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                  {state.skinDirty(entry.name) ? ' (modified)' : ''}
                </option>
              ))}
            </select>
          </label>
          <p>
            Fallback: {state.defaultSkin || 'none'}.{' '}
            {state.isStandaloneSkin(active)
              ? 'Stored in a manifest skin file; download that skin to save its changes.'
              : 'Stored in rig JSON.'}
          </p>
          <label>
            Attachment slot
            <select
              data-guide-id={GUIDE_TARGETS.rigAttachmentSlot}
              aria-label="Attachment slot"
              value={slot}
              onChange={(event) => controller.selectSlot(event.target.value)}
            >
              <option value="" disabled>
                Select a slot
              </option>
              {(state.workingCopy.slots ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id} — {state.resolvedAttachment(entry.id) ?? 'empty'}
                </option>
              ))}
            </select>
          </label>
          {slot && (
            <>
              <p>
                Bone: {state.getSlot(slot).bone} · Depth: {state.getSlot(slot).depth ?? 'follows bone'} ·{' '}
                {attachment && state.visibility.artwork ? 'Artwork visible' : 'Artwork hidden or empty'}
              </p>
              {attachment &&
                controller.artwork?.assetPreview(state.getAttachment(attachment).texture, `attachment:${attachment}`)
                  ?.url && (
                  <img
                    className="attachment-thumbnail"
                    src={
                      controller.artwork.assetPreview(
                        state.getAttachment(attachment).texture,
                        `attachment:${attachment}`,
                      )!.url
                    }
                    alt={`Artwork for ${attachment}`}
                  />
                )}
              <p>
                Assignment: {attachment ?? 'empty'} ·{' '}
                {mapping === undefined ? 'inherited' : mapping === null ? 'explicitly cleared' : 'skin mapping'}
              </p>
              <label>
                Assigned attachment
                <select
                  aria-label="Assigned attachment"
                  value={attachment ?? ''}
                  disabled={!authoring || !skin}
                  onChange={(event) => controller.assign(event.target.value || null)}
                >
                  <option value="">Empty</option>
                  {(state.workingCopy.attachments ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.id} — {entry.texture}
                      {entry.frame === undefined ? '' : ` / ${entry.frame}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="action-grid">
                <button type="button" disabled={!authoring || !skin} onClick={() => controller.assign(null)}>
                  Clear assignment
                </button>
                <button
                  type="button"
                  disabled={!authoring || mapping === undefined}
                  onClick={() => controller.assign(undefined)}
                >
                  Remove override
                </button>
              </div>
            </>
          )}
          <fieldset disabled={!authoring} data-guide-id={GUIDE_TARGETS.rigSkinAuthoring}>
            <legend>Skin authoring</legend>
            <label>
              Skin name
              <input aria-label="Skin name" value={skinName} onChange={(event) => setSkinName(event.target.value)} />
            </label>
            <div className="action-grid">
              <button type="button" disabled={!skinName.trim()} onClick={() => controller.createSkin(skinName)}>
                Create skin
              </button>
              <button
                type="button"
                disabled={!skinName.trim() || !active || active === state.defaultSkin || state.isStandaloneSkin(active)}
                onClick={() => controller.renameSkin(skinName)}
              >
                Rename skin
              </button>
              <button type="button" disabled={!active} onClick={() => controller.downloadSkin()}>
                Download skin JSON
              </button>
            </div>
          </fieldset>
          <fieldset disabled={!authoring} data-guide-id={GUIDE_TARGETS.rigCreateAttachment}>
            <legend>Create sprite attachment</legend>
            <label>
              Attachment ID
              <input
                aria-label="Attachment ID"
                value={attachmentId}
                onChange={(event) => setAttachmentId(event.target.value)}
              />
            </label>
            <label>
              Attachment artwork
              <select
                aria-label="Attachment artwork"
                value={selectedTexture}
                onChange={(event) => setTexture(event.target.value)}
              >
                {assets.map((asset) => (
                  <option key={asset.key} value={asset.key}>
                    {asset.key} — {asset.filename}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Frame
              <input aria-label="Attachment frame" value={frame} onChange={(event) => setFrame(event.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={numericFrame}
                onChange={(event) => setNumericFrame(event.target.checked)}
              />{' '}
              Numeric frame
            </label>
            <button
              type="button"
              disabled={!attachmentId.trim() || !selectedTexture}
              onClick={() => controller.createAttachment(attachmentId, selectedTexture, frame, numericFrame)}
            >
              Create attachment
            </button>
            <small>
              IDs stay independent of filenames. Imported replacements use the selected character texture key.
            </small>
          </fieldset>
          <details>
            <summary>Attachment library ({state.workingCopy.attachments?.length ?? 0})</summary>
            <ul>
              {(state.workingCopy.attachments ?? []).map((entry) => (
                <li key={entry.id}>
                  <span>
                    {entry.id} · {entry.texture}
                  </span>
                  <button
                    type="button"
                    disabled={!authoring}
                    aria-label={`Remove attachment ${entry.id}`}
                    onClick={() => controller.removeAttachment(entry.id)}
                  >
                    Remove definition
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Available artwork ({assets.length})</summary>
            <ul>
              {assets.map((asset) => (
                <li key={asset.key}>
                  {asset.key} · {asset.filename} · {asset.width} × {asset.height} px
                  {controller.artwork?.assetPreview(asset.key)?.imported ? ' · imported replacement' : ''}
                </li>
              ))}
            </ul>
          </details>
          {!authoring && (
            <p>Use Rig Tweak mode to author assignments and skins. Skin selection remains available during playback.</p>
          )}
          {errors.length > 0 && (
            <ul role="alert">
              {errors.map((issue, index) => (
                <li key={index}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          )}
          <p role="status">{snapshot.message}</p>
        </section>
      )}
    </InspectorSection>
  );
}
