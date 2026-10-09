import { useSyncExternalStore, type ReactNode } from 'react';
import type { DemoUIStore } from './DemoUIStore.js';

function DemoButton({
  store,
  action,
  className,
  children,
}: {
  store: DemoUIStore;
  action: string;
  className?: string;
  children: ReactNode;
}) {
  const pressed = useSyncExternalStore(store.subscribe, () => store.isPressed(action));
  return (
    <button
      type="button"
      data-action={action}
      className={className}
      aria-pressed={pressed}
      onClick={() => store.run(action)}
    >
      {children}
    </button>
  );
}

export function DemoControls({ store }: { store: DemoUIStore }) {
  return (
    <>
      <div className="control-section">
        <h2>
          01 <span>Animation</span>
        </h2>
        <div className="button-pair">
          <DemoButton store={store} action="idle">
            <kbd>1</kbd> Idle
          </DemoButton>
          <DemoButton store={store} action="walk">
            <kbd>2</kbd> Walk
          </DemoButton>
        </div>
        <DemoButton store={store} action="sword" className="wide-button">
          <span>
            <kbd>3</kbd> Two-handed katana
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <div className="button-pair">
          <DemoButton store={store} action="fadeIdle">
            <kbd>4</kbd> Fade to idle
          </DemoButton>
          <DemoButton store={store} action="fadeWalk">
            <kbd>5</kbd> Fade to walk
          </DemoButton>
        </div>
        <DemoButton store={store} action="upperBody" className="wide-button">
          <span>
            <kbd>L</kbd> Upper-body sword layer
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
      </div>
      <div className="control-section">
        <h2>
          02 <span>Playback</span>
        </h2>
        <DemoButton store={store} action="stepped" className="wide-button">
          <span>
            <kbd>S</kbd> Smooth / stepped
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <div className="button-pair">
          <DemoButton store={store} action="fps8">
            <kbd>8</kbd> 8 FPS
          </DemoButton>
          <DemoButton store={store} action="fps10">
            <kbd>0</kbd> 10 FPS
          </DemoButton>
        </div>
        <DemoButton store={store} action="pause" className="wide-button">
          <span>
            <kbd>P</kbd> Pause / resume
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <div className="button-pair">
          <DemoButton store={store} action="slower">
            <kbd>[</kbd> Slower
          </DemoButton>
          <DemoButton store={store} action="faster">
            <kbd>]</kbd> Faster
          </DemoButton>
        </div>
      </div>
      <div className="control-section">
        <h2>
          03 <span>Direction</span>
        </h2>
        <div className="button-pair">
          <DemoButton store={store} action="left">
            <kbd>A</kbd> Left
          </DemoButton>
          <DemoButton store={store} action="right">
            <kbd>D</kbd> Right
          </DemoButton>
        </div>
      </div>
      <div className="control-section">
        <h2>
          04 <span>Inspect the rig</span>
        </h2>
        <DemoButton store={store} action="debug" className="wide-button">
          <span>
            <kbd>B</kbd> Bones & pivots
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <DemoButton store={store} action="ikDebug" className="wide-button">
          <span>
            <kbd>I</kbd> IK targets & chains
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <DemoButton store={store} action="handIK" className="wide-button">
          <span>
            <kbd>H</kbd> Mouse hand target
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <DemoButton store={store} action="footIK" className="wide-button">
          <span>
            <kbd>F</kbd> Plant feet while walking
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <DemoButton store={store} action="prop" className="wide-button">
          <span>
            <kbd>T</kbd> Katana
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <div className="button-pair">
          <DemoButton store={store} action="defaultSkin">
            <kbd>K</kbd> Default skin
          </DemoButton>
          <DemoButton store={store} action="armoredSkin">
            <kbd>M</kbd> Armor skin
          </DemoButton>
        </div>
        <DemoButton store={store} action="gripHand" className="wide-button">
          <span>
            <kbd>G</kbd> Grip hand
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <DemoButton store={store} action="helmet" className="wide-button">
          <span>
            <kbd>N</kbd> Headwear override
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <DemoButton store={store} action="slotDebug" className="wide-button">
          <span>
            <kbd>V</kbd> Slots
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <div className="button-pair">
          <DemoButton store={store} action="rotateLeft">
            <kbd>Q</kbd> Turn −
          </DemoButton>
          <DemoButton store={store} action="rotateRight">
            <kbd>E</kbd> Turn +
          </DemoButton>
        </div>
      </div>
      <div className="control-section">
        <h2>
          05 <span>Pose authoring</span>
        </h2>
        <DemoButton store={store} action="poseMode" className="wide-button">
          <span>
            <kbd>O</kbd> Pose inspector
          </span>
          <span className="toggle" aria-hidden="true"></span>
        </DemoButton>
        <div className="button-pair">
          <DemoButton store={store} action="combatPose">
            <kbd>C</kbd> Combat pose
          </DemoButton>
          <DemoButton store={store} action="bindPose">
            <kbd>R</kbd> Bind pose
          </DemoButton>
        </div>
        <DemoButton store={store} action="exportPose" className="wide-button">
          <kbd>X</kbd> Export pose JSON
        </DemoButton>
        <p className="keyboard-note pose-note">
          In pose mode: <kbd>[</kbd>/<kbd>]</kbd> select · arrows adjust · Shift coarse · Alt + ←/→ moves x ·{' '}
          <kbd>U</kbd> reset bone · <kbd>J</kbd> print rig data
        </p>
      </div>
      <p className="keyboard-note">
        <kbd>Space</kbd> stop / restart <span>·</span> <kbd>R</kbd> restart
      </p>
    </>
  );
}
