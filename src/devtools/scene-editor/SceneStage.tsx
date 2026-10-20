import Phaser from 'phaser';
import { useLayoutEffect, useState } from 'react';
import { Actor } from '../../engine/Actor.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { loadSceneCharacter } from '../../engine/loadSceneCharacter.js';
import { throwNotificationErrors } from '../../engine/notifications.js';
import { Puppet } from '../../engine/Puppet.js';
import { observePreview } from '../../ui/observePreview.js';
import { panCamera, zoomCameraAt } from '../shared/editorCamera.js';
import { createEditorGame } from '../shared/editorGame.js';
import { GroundGuideOverlay } from '../shared/GroundGuideOverlay.js';
import { SceneActorPreview } from './SceneActorPreview.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';
import { SceneGroundHandle } from './SceneGroundHandle.js';
import { draggedPosition, stagePoint } from './stageCoordinates.js';

type Point = { x: number; y: number };
type Gesture = { pointer: number; scene: string; start: Point; origin: Point; axis: 'x' | 'y' | 'both' };

/** Phaser owns rendering; React/document changes reconcile existing instances without remounting the game. */
class SceneStage extends Phaser.Scene {
  private preview!: SceneActorPreview;
  private overlay!: Phaser.GameObjects.Graphics;
  private grid!: Phaser.GameObjects.Graphics;
  private groundOverlay!: GroundGuideOverlay;
  private groundHandle!: SceneGroundHandle;
  private gesture: Gesture | undefined;
  private pan: { pointer: number; x: number; y: number } | undefined;
  private readonly definitions = new Map<string, CharacterDefinition>();
  private readonly requests = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private alive = true;
  private refresh: () => void = () => {};
  private readonly failures = new Map<string, string>();
  retry(): void {
    for (const manifest of this.failures.keys()) this.requests.delete(manifest);
    this.failures.clear();
    this.refresh();
  }
  showGrid = true;

  constructor(
    private readonly document: SceneEditorDocument,
    private readonly characters: SceneCharacterRegistry,
    private readonly playback: SceneEditorPlayback,
    private readonly status: (message: string) => void,
  ) {
    super('SceneStage');
  }

  create(): void {
    this.preview = new SceneActorPreview(this);
    this.grid = this.add.graphics().setDepth(-1000);
    this.overlay = this.add.graphics().setDepth(1_000_000);
    this.groundOverlay = new GroundGuideOverlay(this, { draggable: true });
    this.groundHandle = new SceneGroundHandle(this.document.groundGuide);
    this.cameras.main.centerOn(0, 0);
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Actor placement canvas');
    const events = new AbortController();
    const sync = (): void => {
      if (this.gesture && this.gesture.scene !== this.document.selectedSceneId) this.gesture = undefined;
      const document = this.document.workingScene;
      if (!document) {
        this.preview.dispose();
        return;
      }
      let message = [...new Set(document.actors.map((actor) => this.failures.get(actor.character.manifest)))]
        .filter(Boolean)
        .join('\n');
      try {
        this.playback.sync(
          document,
          document.actors.every((actor) => this.definitions.has(actor.character.manifest)),
          (data, depth) => {
            const definition = this.definitions.get(data.character.manifest);
            if (!definition) throw new Error(`Character "${data.character.manifest}" is not loaded.`);
            const puppet = new Puppet(this, { definition, autoUpdate: false, depth });
            try {
              return new Actor({ id: data.id, puppet, puppetOwnership: 'owned' });
            } catch (error) {
              puppet.destroy();
              throw error;
            }
          },
        );
        this.preview.sync(document, this.definitions);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      this.status(message);
      for (const actor of document.actors) this.ensureCharacter(actor.character.manifest, sync);
    };
    this.refresh = sync;
    const unsubscribe = this.document.subscribe(sync);
    const cancel = (): void => {
      this.gesture = undefined;
      this.pan = undefined;
      this.groundHandle.cancel();
      this.document.cancelActorDrag();
    };
    const unsubscribePlayback = this.playback.subscribe(() => {
      if (this.playback.previewing && this.gesture) {
        this.gesture = undefined;
        this.document.cancelActorDrag();
      }
    });
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.document.workingScene || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
        if (this.gesture || this.pan || this.groundHandle.dragging) return;
        event.preventDefault();
        canvas.focus();
        canvas.setPointerCapture(event.pointerId);
        if (event.button !== 0 || event.altKey) {
          this.pan = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
          return;
        }
        const point = this.point(event);
        if (this.groundHandle.down(event.pointerId, point, this.cameras.main)) return;
        // Runtime transforms are view-only. The independent guide remains draggable during preview.
        if (this.playback.previewing) return;
        const selected = this.document.workingScene.actors.find((actor) => actor.id === this.document.selectedActorId);
        let id: string | null = null;
        let axis: Gesture['axis'] = 'both';
        const zoom = this.cameras.main.zoom;
        if (selected) {
          const dx = (point.x - selected.position.x) * zoom;
          const dy = (point.y - selected.position.y) * zoom;
          if (Math.hypot(dx, dy) < 12) {
            id = selected.id;
          } else if (dx > 14 && dx < 58 && Math.abs(dy) < 9) {
            id = selected.id;
            axis = 'x';
          } else if (dy < -14 && dy > -58 && Math.abs(dx) < 9) {
            id = selected.id;
            axis = 'y';
          }
        }
        if (!id) {
          for (const actor of [...this.document.workingScene.actors].reverse()) {
            const entry = this.preview.instances.get(actor.id);
            if (!entry) continue;
            const bounds = entry.actor.puppet.container.getBounds();
            if (
              bounds.contains(point.x, point.y) ||
              Math.hypot(point.x - actor.position.x, point.y - actor.position.y) < 14 / zoom
            ) {
              id = actor.id;
              break;
            }
          }
        }
        this.document.selectActor(id);
        const actor = this.document.workingScene.actors.find((actor) => actor.id === id);
        if (actor && this.document.beginActorDrag(actor.id)) {
          this.gesture = {
            pointer: event.pointerId,
            scene: this.document.workingScene.id,
            start: point,
            origin: actor.position,
            axis,
          };
        }
      },
      { signal: events.signal },
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (this.pan?.pointer === event.pointerId) {
          const bounds = canvas.getBoundingClientRect();
          panCamera(
            this.cameras.main,
            ((event.clientX - this.pan.x) * this.cameras.main.width) / bounds.width,
            ((event.clientY - this.pan.y) * this.cameras.main.height) / bounds.height,
          );
          this.pan.x = event.clientX;
          this.pan.y = event.clientY;
        } else if (this.groundHandle.dragging) {
          this.groundHandle.move(event.pointerId, this.point(event));
        } else if (this.gesture?.pointer === event.pointerId) {
          const gesture = this.gesture;
          this.document.moveActorDrag(draggedPosition(gesture.start, gesture.origin, this.point(event), gesture.axis), {
            bypassGround: event.shiftKey,
          });
        }
      },
      { signal: events.signal },
    );
    canvas.addEventListener(
      'pointerup',
      (event) => {
        this.groundHandle.up(event.pointerId, this.point(event));
        if (this.gesture?.pointer === event.pointerId) {
          const gesture = this.gesture;
          this.document.moveActorDrag(draggedPosition(gesture.start, gesture.origin, this.point(event), gesture.axis), {
            bypassGround: event.shiftKey,
          });
          this.gesture = undefined;
          this.document.endActorDrag();
        }
        if (this.pan?.pointer === event.pointerId) this.pan = undefined;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      },
      { signal: events.signal },
    );
    canvas.addEventListener('pointercancel', cancel, { signal: events.signal });
    canvas.addEventListener('lostpointercapture', cancel, { signal: events.signal });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), { signal: events.signal });
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        if (this.gesture || this.groundHandle.dragging) return;
        const bounds = canvas.getBoundingClientRect();
        zoomCameraAt(
          this.cameras.main,
          ((event.clientX - bounds.left) * this.cameras.main.width) / bounds.width,
          ((event.clientY - bounds.top) * this.cameras.main.height) / bounds.height,
          event.deltaY,
        );
      },
      { signal: events.signal, passive: false },
    );
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && !event.isComposing && (this.gesture || this.pan || this.groundHandle.dragging)) {
          event.preventDefault();
          cancel();
        }
      },
      { signal: events.signal },
    );
    window.addEventListener('blur', cancel, { signal: events.signal });
    window.addEventListener('pagehide', cancel, { signal: events.signal });
    window.addEventListener(
      'visibilitychange',
      () => {
        if (window.document.visibilityState === 'hidden') cancel();
      },
      { signal: events.signal, capture: true },
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
      unsubscribe();
      unsubscribePlayback();
      events.abort();
      cancel();
      this.definitions.clear();
      this.requests.clear();
      this.failures.clear();
      this.refresh = () => {};
      const errors: unknown[] = [];
      for (const dispose of [
        () => this.groundHandle.dispose(),
        () => this.groundOverlay.dispose(),
        () => this.playback.dispose(),
        () => this.preview.dispose(),
      ]) {
        try {
          dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      throwNotificationErrors(errors, 'Scene stage disposal failed.');
    });
    sync();
  }
  private point(event: PointerEvent): Point {
    return stagePoint(
      { x: event.clientX, y: event.clientY },
      this.game.canvas.getBoundingClientRect(),
      this.cameras.main,
    );
  }
  private ensureCharacter(manifest: string, sync: () => void): void {
    if (this.requests.has(manifest)) return;
    this.requests.add(manifest);
    // Serialize artwork loads: Phaser rejects concurrent ownership of the same pending texture key.
    this.queue = this.queue
      .then(async () => {
        if (!this.alive) return;
        const definition = await this.characters.load(manifest);
        if (!this.alive) return;
        const ready = await loadSceneCharacter(this, manifest, { definition });
        if (!ready || !this.alive) return;
        this.definitions.set(manifest, ready);
        sync();
      })
      .catch((error: unknown) => {
        if (this.alive) {
          this.failures.set(manifest, `${manifest}: ${error instanceof Error ? error.message : String(error)}`);
          sync();
        }
      });
  }
  update(_time: number, delta: number): void {
    this.groundOverlay.render(this.document.groundGuide.getSnapshot().guide);
    this.playback.update(delta);
    for (const { actor } of this.preview.instances.values())
      actor.puppet.container.setVisible(!this.playback.previewing);
    const camera = this.cameras.main;
    this.grid.clear();
    if (this.showGrid) {
      const top = camera.getWorldPoint(0, 0);
      const bottom = camera.getWorldPoint(camera.width, camera.height);
      this.grid.lineStyle(1 / camera.zoom, 0x454550, 0.4);
      for (let x = Math.floor(top.x / 32) * 32; x <= bottom.x; x += 32) this.grid.lineBetween(x, top.y, x, bottom.y);
      for (let y = Math.floor(top.y / 32) * 32; y <= bottom.y; y += 32) this.grid.lineBetween(top.x, y, bottom.x, y);
    }
    this.overlay.clear();
    const action = this.document.workingScene?.actions.find((entry) => entry.id === this.document.selectedActionId);
    if (action?.type === 'move') {
      const { x, y } = action.destination;
      const size = 10 / camera.zoom;
      this.overlay.lineStyle(2 / camera.zoom, 0x85bf9b).strokeCircle(x, y, size);
      this.overlay.lineBetween(x - size, y, x + size, y).lineBetween(x, y - size, x, y + size);
    }
    const id = this.document.selectedActorId;
    const actor = id && (this.playback.actors?.get(id) ?? this.preview.instances.get(id)?.actor);
    if (!actor) return;
    const { x, y } = actor.position;
    const bounds = actor.puppet.container.getBounds();
    const z = camera.zoom;
    this.overlay.lineStyle(1 / z, 0xe5b35c, 0.9).strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.overlay.lineStyle(3 / z, 0xef8075).lineBetween(x, y, x + 52 / z, y);
    this.overlay.lineStyle(3 / z, 0x85bf9b).lineBetween(x, y, x, y - 52 / z);
    this.overlay.lineStyle(2 / z, 0xe5b35c).strokeCircle(x, y, 9 / z);
  }
}

export function SceneStageView({
  document,
  registry,
  playback,
}: {
  document: SceneEditorDocument;
  registry: SceneCharacterRegistry;
  playback: SceneEditorPlayback;
}) {
  const [error, setError] = useState('');
  const [stage, setStage] = useState<SceneStage>();
  const [grid, setGrid] = useState(true);
  useLayoutEffect(() => {
    const scene = new SceneStage(document, registry, playback, setError);
    setStage(scene);
    const game = createEditorGame('scene-stage-canvas', scene, { width: 1000, height: 700 });
    const release = observePreview(window.document.querySelector<HTMLElement>('#scene-stage-canvas')!, game);
    return () => {
      release();
      document.cancelActorDrag();
      game.destroy(true);
    };
  }, [document, registry, playback]);
  return (
    <>
      <div className="scene-stage-toolbar">
        <label>
          <input
            type="checkbox"
            checked={grid}
            onChange={(event) => {
              setGrid(event.target.checked);
              if (stage) stage.showGrid = event.target.checked;
            }}
          />{' '}
          Grid
        </label>
        <button
          type="button"
          onClick={() => {
            if (stage?.sys.isActive()) stage.cameras.main.setZoom(1).centerOn(0, 0);
          }}
        >
          Reset view
        </button>
        <span>Wheel: zoom · Middle/right/Alt-drag: pan · Shift: bypass ground snap · Escape: cancel drag</span>
      </div>
      <div id="scene-stage-canvas" />
      {error && (
        <p className="scene-preview-error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => stage?.retry()}>
            Retry preview
          </button>
        </p>
      )}
    </>
  );
}
