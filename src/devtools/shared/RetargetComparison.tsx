import Phaser from 'phaser';
import { useEffect, useId, useRef, useState } from 'react';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { Puppet } from '../../engine/Puppet.js';
import { loadSceneCharacter } from '../../shared/loadSceneCharacter.js';
import type { AnimationPreviewLease } from './AnimationLibraryPreviewDialog.js';
import { createEditorGame } from './editorGame.js';
import type { GroundGuide } from './groundGuide.js';
import { GroundGuideOverlay } from './GroundGuideOverlay.js';
import { RetargetComparisonPlayback } from './RetargetComparisonPlayback.js';

const width = 1040;
const height = 360;

/** Two clipped cameras share world units and framing, exposing real proportion and travel differences. */
export class RetargetComparisonScene extends Phaser.Scene {
  playback: RetargetComparisonPlayback | undefined;
  private readonly request = new AbortController();
  private readonly puppets: Puppet[] = [];
  private readonly overlays: Phaser.GameObjects.Graphics[] = [];
  private ground: GroundGuideOverlay | undefined;
  private disposed = false;
  showGround = false;
  showFeet = false;
  showBones = true;
  groundY = 0;

  constructor(
    private readonly definitions: readonly [CharacterDefinition, CharacterDefinition],
    private readonly animations: readonly [string, string],
    private readonly report: (message: string, ready: boolean) => void,
    private readonly tick: (time: number, playing: boolean) => void,
  ) {
    super('RetargetComparison');
  }

  create(): void {
    this.events.once('shutdown', () => this.dispose());
    void this.initialize().catch((error: unknown) => {
      if (this.request.signal.aborted) return;
      this.dispose();
      this.report(String(error), false);
    });
  }
  private async initialize(): Promise<void> {
    for (const [index, definition] of this.definitions.entries()) {
      const loaded = await loadSceneCharacter(this, `retarget-${index}`, {
        definition,
        allowWebp: true,
        signal: this.request.signal,
      });
      if (!loaded || this.disposed) return;
      const puppet = new Puppet(this, { definition: loaded, autoUpdate: false });
      this.puppets.push(puppet);
      puppet.animationPlayer.setPreviewMode(true);
      puppet.play(this.animations[index]!, { restart: true, loop: false, fadeDuration: 0 });
      puppet.pauseAnimation();
      this.overlays.push(this.add.graphics().setDepth(9000));
    }
    const source = this.puppets[0]!,
      target = this.puppets[1]!;
    this.playback = new RetargetComparisonPlayback(
      [source, target],
      this.definitions[0].animations.find(({ name }) => name === this.animations[0])!.duration,
    );
    const left = this.cameras.main.setViewport(0, 0, width / 2, height);
    const right = this.cameras.add(width / 2, 0, width / 2, height);
    left.ignore([target.container, this.overlays[1]!]);
    right.ignore([source.container, this.overlays[0]!]);
    this.ground = new GroundGuideOverlay(this);
    this.fit();
    this.report('Comparison ready. Both characters use the same time and world scale.', true);
  }
  fit(): void {
    if (!this.playback) return;
    let left = 0,
      right = 0,
      top = 0,
      bottom = 0;
    const time = this.playback.time;
    if (this.showGround) {
      top = Math.min(top, this.groundY);
      bottom = Math.max(bottom, this.groundY);
    }
    for (const sample of [0, this.playback.duration / 2, this.playback.duration]) {
      this.playback.seek(sample);
      for (const puppet of this.puppets) {
        const bounds = puppet.container.getBounds();
        left = Math.min(left, bounds.left);
        right = Math.max(right, bounds.right);
        top = Math.min(top, bounds.top);
        bottom = Math.max(bottom, bounds.bottom);
        for (const bone of puppet.rig.bones) {
          const point = puppet.getBone(bone.id).getWorldPosition();
          left = Math.min(left, point.x);
          right = Math.max(right, point.x);
          top = Math.min(top, point.y);
          bottom = Math.max(bottom, point.y);
        }
      }
    }
    const zoom = Math.min(2, (width / 2 - 64) / Math.max(1, right - left), (height - 64) / Math.max(1, bottom - top));
    for (const camera of this.cameras.cameras) camera.setZoom(zoom).centerOn((left + right) / 2, (top + bottom) / 2);
    this.playback.seek(time);
  }
  update(_time: number, delta: number): void {
    if (this.disposed || !this.playback) return;
    this.playback.advance(delta);
    this.tick(this.playback.time, this.playback.playing);
    this.ground?.render({ enabled: this.showGround, y: this.groundY, snapEnabled: false });
    const pixel = 1 / this.cameras.main.zoom;
    for (const [index, puppet] of this.puppets.entries()) {
      const graphics = this.overlays[index]!;
      graphics.clear();
      if (this.showBones) {
        graphics.lineStyle(1.5 * pixel, 0x58a6ff, 0.8);
        graphics.fillStyle(0x58a6ff);
        for (const bone of puppet.rig.bones) {
          const point = puppet.getBone(bone.id).getWorldPosition();
          if (bone.parent) {
            const parent = puppet.getBone(bone.parent).getWorldPosition();
            graphics.lineBetween(parent.x, parent.y, point.x, point.y);
          }
          graphics.fillCircle(point.x, point.y, 2.5 * pixel);
        }
      }
      if (this.showFeet) {
        graphics.lineStyle(2 * pixel, 0xdba75d, 1);
        for (const marker of puppet.rig.footContactMarkers ?? []) {
          const matrix = puppet.getBone(marker.boneId).container.getWorldTransformMatrix();
          const point = matrix.transformPoint(marker.localX, marker.localY);
          graphics.strokeCircle(point.x, point.y, 5 * pixel);
          graphics.lineBetween(point.x - 8 * pixel, point.y, point.x + 8 * pixel, point.y);
        }
      }
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.request.abort();
    this.playback = undefined;
    try {
      for (const puppet of this.puppets.splice(0)) puppet.destroy();
    } finally {
      for (const overlay of this.overlays.splice(0)) overlay.destroy();
      this.ground?.dispose();
      this.ground = undefined;
    }
  }
}

export function RetargetComparison({
  load,
  sourceAnimation,
  targetAnimation,
  groundReference,
  onReady,
}: {
  load(this: void, signal: AbortSignal): Promise<readonly [AnimationPreviewLease, AnimationPreviewLease]>;
  sourceAnimation: string;
  targetAnimation: string;
  groundReference: GroundGuide;
  onReady(this: void, ready: boolean): void;
}) {
  const parent = `retarget-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const scene = useRef<RetargetComparisonScene | undefined>(undefined);
  const [message, setMessage] = useState('Loading comparison characters…');
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(1);
  const [speed, setSpeed] = useState('1');
  const [ground, setGround] = useState(groundReference.enabled);
  const [groundY, setGroundY] = useState(groundReference.y);
  const [feet, setFeet] = useState(false);
  const [bones, setBones] = useState(true);
  useEffect(() => {
    const request = new AbortController();
    let game: Phaser.Game | undefined;
    let leases: readonly AnimationPreviewLease[] = [];
    const release = () => {
      for (const lease of leases) lease.dispose();
      leases = [];
    };
    setReady(false);
    setMessage('Loading comparison characters…');
    setPlaying(false);
    setTime(0);
    setSpeed('1');
    setGround(groundReference.enabled);
    setGroundY(groundReference.y);
    setFeet(false);
    setBones(true);
    onReady(false);
    void load(request.signal)
      .then((loaded) => {
        leases = loaded;
        if (request.signal.aborted) {
          release();
          return;
        }
        setDuration(loaded[0].definition.animations.find(({ name }) => name === sourceAnimation)!.duration);
        scene.current = new RetargetComparisonScene(
          [loaded[0].definition, loaded[1].definition],
          [sourceAnimation, targetAnimation],
          (message, ready) => {
            if (request.signal.aborted) return;
            setMessage(message);
            setReady(ready);
            onReady(ready);
          },
          (time, playing) => {
            if (!request.signal.aborted) {
              setTime(time);
              setPlaying(playing);
            }
          },
        );
        scene.current.showGround = groundReference.enabled;
        scene.current.groundY = groundReference.y;
        game = createEditorGame(parent, scene.current, { width, height });
        game.events.once('destroy', release);
      })
      .catch((error: unknown) => {
        release();
        if (!request.signal.aborted) {
          setMessage(String(error));
          onReady(false);
        }
      });
    return () => {
      request.abort();
      scene.current?.dispose();
      scene.current = undefined;
      if (game) game.destroy(true);
      else release();
    };
  }, [load, sourceAnimation, targetAnimation, parent, onReady, groundReference]);
  return (
    <section aria-label="Synchronized retargeting comparison">
      <div className="retarget-comparison-labels">
        <strong>Source · {sourceAnimation}</strong>
        <strong>Target · preview result</strong>
      </div>
      <div id={parent} className="retarget-comparison-stage" />
      <p role="status">{message}</p>
      <div className="animation-library-actions">
        <button type="button" disabled={!ready} onClick={() => scene.current?.playback?.toggle()}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" disabled={!ready} onClick={() => scene.current?.playback?.scrub(0)}>
          Restart
        </button>
        <label>
          Comparison time
          <input
            aria-label="Comparison time"
            type="range"
            min="0"
            max={duration}
            step="1"
            value={time}
            disabled={!ready}
            onChange={(event) => scene.current?.playback?.scrub(Number(event.target.value))}
          />
        </label>
        <output aria-label="Shared preview time">
          {Math.round(time)} / {duration} ms
        </output>
        <label>
          Playback speed
          <select
            aria-label="Playback speed"
            value={speed}
            disabled={!ready}
            onChange={(event) => {
              setSpeed(event.target.value);
              if (scene.current?.playback) scene.current.playback.speed = Number(event.target.value);
            }}
          >
            {['0.25', '0.5', '1', '2'].map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!ready} onClick={() => scene.current?.fit()}>
          Fit comparison
        </button>
      </div>
      <div className="animation-library-actions">
        <label>
          <input
            type="checkbox"
            checked={ground}
            disabled={!ready}
            onChange={(event) => {
              setGround(event.target.checked);
              if (scene.current) scene.current.showGround = event.target.checked;
            }}
          />
          Show ground reference
        </label>
        <label>
          Ground Y
          <input
            type="number"
            value={groundY}
            disabled={!ready || !ground}
            onChange={(event) => {
              const y = Number(event.target.value);
              if (Number.isFinite(y)) {
                setGroundY(y);
                if (scene.current) scene.current.groundY = y;
              }
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={feet}
            disabled={!ready}
            onChange={(event) => {
              setFeet(event.target.checked);
              if (scene.current) scene.current.showFeet = event.target.checked;
            }}
          />
          Show foot contact markers
        </label>
        <label>
          <input
            type="checkbox"
            checked={bones}
            disabled={!ready}
            onChange={(event) => {
              setBones(event.target.checked);
              if (scene.current) scene.current.showBones = event.target.checked;
            }}
          />
          Show bones
        </label>
      </div>
      <p className="workspace-caption">
        Ground Y uses character preview units (positive down). Foot markers appear only where authored on each rig.
        Contacts are diagnostics; no foot locking or corrections are applied.
      </p>
    </section>
  );
}
