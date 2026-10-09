import { useSyncExternalStore, type CSSProperties } from 'react';
import { ViewHeader } from '../ui/viewShell.js';
import { openWorkspaceDialog, useWorkspaceInspector, WorkspaceDialog } from '../ui/Workspace.js';
import { DemoControls } from './DemoControls.js';
import { demoLimbColors } from './demoLimbColors.js';
import type { DemoUIStore } from './DemoUIStore.js';

function DemoStatus({ store }: { store: DemoUIStore }) {
  const status = useSyncExternalStore(store.subscribe, store.getStatus);
  const stopped = useSyncExternalStore(store.subscribe, store.isStopped);
  return (
    <div className="status" aria-live="polite">
      <span className={`status-dot${stopped ? ' stopped' : ''}`} />
      <span id="status-text">{status}</span>
    </div>
  );
}

export function DemoView({ store, sketch }: { store: DemoUIStore; sketch: boolean }) {
  const inspector = useWorkspaceInspector();
  return (
    <>
      <ViewHeader view="demo" />
      <section className="workspace-command-bar" aria-label="Demo session">
        <span className="workspace-command-title">The puppet lab</span>
        <span>Animation · Playback · IK</span>
        <button
          id="demo-help-open"
          type="button"
          aria-haspopup="dialog"
          onClick={() => openWorkspaceDialog('demo-help-dialog')}
        >
          Help
        </button>
        <button id="demo-reset-layout" type="button" onClick={inspector.reset}>
          Reset layout
        </button>
        <button
          ref={inspector.toggle}
          id="demo-inspector-toggle"
          className="workspace-inspector-toggle"
          type="button"
          aria-expanded={inspector.open}
          aria-controls="demo-inspector"
          onClick={inspector.toggleOpen}
        >
          Controls
        </button>
      </section>
      <main
        className={`workspace-layout view-content ${inspector.open ? 'inspector-open' : ''}`}
        aria-label="Paper puppet animation demo"
      >
        <section className="workspace-preview" aria-label="Engine preview">
          <div className="workspace-preview-options">
            <span>
              {sketch ? 'Artist’s sketch' : 'Paper puppet'} · Move a hand target, plant the feet, and turn a katana.
            </span>
          </div>
          <div id="stage" aria-label="Paper Puppeteer Engine animation demo; move the mouse to aim the hand" />
          <div className="workspace-caption">Mouse to aim · Q / E to turn</div>
        </section>
        <aside
          ref={inspector.panel}
          id="demo-inspector"
          className="workspace-inspector controls"
          inert={inspector.narrow && !inspector.open}
          aria-label="Animation controls"
        >
          <div className="workspace-panel-heading">
            <h2>Controls</h2>
            <button
              id="demo-inspector-close"
              className="workspace-inspector-close"
              type="button"
              onClick={inspector.close}
            >
              Close
            </button>
          </div>
          <DemoControls store={store} />
          <aside className="limb-legend" aria-label="Limb colors" hidden={sketch}>
            <h2>Limb colors</h2>
            <ul>
              {Object.values(demoLimbColors).map(({ label, color }) => (
                <li key={label}>
                  <span
                    className="limb-swatch"
                    style={{ '--limb-color': `#${color.toString(16).padStart(6, '0')}` } as CSSProperties}
                    aria-hidden="true"
                  />
                  {label}
                </li>
              ))}
            </ul>
          </aside>
        </aside>
      </main>
      <section className="workspace-status-bar" aria-label="Demo status">
        <DemoStatus store={store} />
      </section>
      <WorkspaceDialog id="demo-help-dialog" title="Engine demo help">
        <p>Choose an animation in Controls, then change playback, facing, skins, and IK while it runs.</p>
        <p>
          Move the mouse over the canvas to aim the hand when Mouse hand target is enabled. Q / E turns the katana.
          Space stops or restarts playback; P pauses or resumes.
        </p>
        <p>
          Pose inspector enables bone selection with [ / ], arrow-key adjustments, and pose JSON export. Shortcuts are
          shown beside each control.
        </p>
      </WorkspaceDialog>
    </>
  );
}
