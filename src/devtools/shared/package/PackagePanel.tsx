import Phaser from 'phaser';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CharacterDefinition } from '../../../engine/CharacterDefinition.js';
import { Puppet } from '../../../engine/Puppet.js';
import { loadSceneCharacter } from '../../../shared/loadSceneCharacter.js';
import { createEditorGame } from '../editorGame.js';
import { openPackageRuntime, type PackageFiles } from './characterPackage.js';
import type { PackageController } from './PackageController.js';

class PackageRuntimeScene extends Phaser.Scene {
  puppet: Puppet | undefined;
  constructor(
    private readonly definition: CharacterDefinition,
    private readonly report: (message: string) => void,
    private readonly ready: () => void,
  ) {
    super('PackageRuntime');
  }
  create(): void {
    this.events.once('shutdown', () => {
      this.puppet?.destroy();
      this.puppet = undefined;
    });
    void loadSceneCharacter(this, 'local-package', { definition: this.definition, allowWebp: true })
      .then((definition) => {
        if (!definition) return;
        this.puppet = new Puppet(this, { definition, x: 380, y: 435 });
        const bounds = this.puppet.container.getBounds();
        if (bounds.width > 0 && bounds.height > 0) {
          this.cameras.main.setZoom(Math.min(760 / (bounds.width + 120), 640 / (bounds.height + 120)));
          this.cameras.main.centerOn(bounds.centerX, bounds.centerY);
        }
        const clip = definition.animations[0];
        if (clip) this.puppet.play(clip.name);
        this.ready();
        this.report('CharacterLoader → Puppet: runtime playback ready.');
      })
      .catch((error: unknown) => this.report(String(error)));
  }
}

function PackageRuntimePreview({ files, close }: { files: PackageFiles; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState('Loading exported character through CharacterLoader…');
  const [runtime, setRuntime] = useState<{ files: PackageFiles; definition: CharacterDefinition } | null>(null);
  const definition = runtime?.files === files ? runtime.definition : null;
  const scene = useRef<PackageRuntimeScene | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const request = new AbortController();
    let game: Phaser.Game | undefined;
    let release: (() => void) | undefined;
    void openPackageRuntime(files, request.signal)
      .then((runtime) => {
        if (request.signal.aborted) {
          runtime.dispose();
          return;
        }
        release = runtime.dispose;
        const preview = new PackageRuntimeScene(
          runtime.definition,
          (text) => {
            if (!request.signal.aborted) setMessage(text);
          },
          () => {
            if (!request.signal.aborted) setRuntime({ files, definition: runtime.definition });
          },
        );
        scene.current = preview;
        game = createEditorGame('package-runtime-stage', preview);
        // Phaser destroys games on its next frame; release image URLs after scene shutdown and texture destruction.
        game.events.once('destroy', runtime.dispose);
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setMessage(String(error));
      });
    return () => {
      request.abort();
      scene.current = null;
      if (game) game.destroy(true);
      else release?.();
    };
  }, [files]);
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog package-runtime-dialog"
      aria-label="Package runtime preview"
      onCancel={close}
      onClose={close}
    >
      <h2>Package runtime preview</h2>
      <button type="button" onClick={close}>
        Close preview
      </button>
      <p role="status">{message}</p>
      {definition && (
        <div className="workspace-preview-options">
          <label>
            Animation{' '}
            <select
              aria-label="Animation"
              disabled={!definition.animations.length}
              defaultValue={definition.animations[0]?.name}
              onChange={(event) => scene.current?.puppet?.play(event.target.value)}
            >
              {!definition.animations.length && <option>No animations</option>}
              {definition.animations.map((clip) => (
                <option key={clip.name}>{clip.name}</option>
              ))}
            </select>
          </label>
          <label>
            Skin{' '}
            <select
              aria-label="Skin"
              defaultValue={definition.defaultSkin}
              onChange={(event) => {
                // Authoring skins are sparse overrides of the character's default appearance.
                scene.current?.puppet?.setSkin(definition.defaultSkin).applySkin(event.target.value);
              }}
            >
              {definition.rig.skins.map((skin) => (
                <option key={skin.name}>{skin.name}</option>
              ))}
            </select>
          </label>
          <label>
            Facing{' '}
            <select
              aria-label="Facing"
              defaultValue="right"
              onChange={(event) => scene.current?.puppet?.setFacing(event.target.value === 'left' ? 'left' : 'right')}
            >
              <option>right</option>
              <option>left</option>
            </select>
          </label>
        </div>
      )}
      <div id="package-runtime-stage" style={{ width: '100%', height: 'min(60vh, 640px)' }} />
    </dialog>
  );
}

export function PackagePanel({ controller }: { controller: PackageController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <details className="package-tools">
      <summary>
        Character package{' '}
        <small aria-label="Package document status">
          {snapshot.ready
            ? ['Rig', 'Animations', 'Assets', 'Skins']
                .map((domain) => `${domain}: ${snapshot.modified.includes(domain) ? 'Modified' : 'Clean'}`)
                .join(' · ')
            : 'Loading character…'}
        </small>
      </summary>
      <div className="package-tools-content">
        {snapshot.ready && (
          <div aria-label="Character readiness">
            <p>
              {snapshot.draftWarnings.length
                ? 'Incomplete draft — valid drafts can still be exported.'
                : 'Ready for export validation.'}
            </p>
            {snapshot.draftWarnings.length > 0 && (
              <ul>
                {snapshot.draftWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <small>
              Download validates the rig, skins, animations, paths and image files. Resolve any reported errors and
              retry.
            </small>
          </div>
        )}
        <p>
          Package checkpoint:{' '}
          {['Rig', 'Animations', 'Assets', 'Skins']
            .map((domain) => `${domain}: ${snapshot.modified.includes(domain) ? 'Modified' : 'Clean'}`)
            .join(' · ')}
        </p>
        <div className="package-tools-actions">
          <button
            type="button"
            className="workspace-primary"
            disabled={!snapshot.ready || snapshot.busy}
            onClick={() => {
              void controller.download();
            }}
          >
            Download character ZIP
          </button>
          <button type="button" disabled={snapshot.busy} onClick={() => controller.previewExport()}>
            Reload exported package
          </button>
        </div>
        <label>
          Import ZIP for runtime preview{' '}
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={snapshot.busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void controller.importPreview(file);
            }}
          />
        </label>
        <p role="status">{snapshot.message}</p>
        <small>
          Downloads establish a package checkpoint. Save and extract the ZIP yourself; repository files are not
          overwritten.
        </small>
      </div>
      {snapshot.preview && <PackageRuntimePreview files={snapshot.preview} close={controller.closePreview} />}
    </details>
  );
}
