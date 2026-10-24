import Phaser from 'phaser';
import { useLayoutEffect, useState } from 'react';
import { Actor } from '../../engine/Actor.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { loadSceneCharacter } from '../../engine/loadSceneCharacter.js';
import { throwNotificationErrors } from '../../engine/notifications.js';
import { Puppet } from '../../engine/Puppet.js';
import { SceneImageLayer } from '../../engine/SceneImageLayer.js';
import { sceneLayer } from '../../engine/sceneLayers.js';
import { createSceneTextureBudget } from '../../engine/sceneTextureBudget.js';
import { assertSceneInstanceBudget } from '../../engine/sceneWorkloadLimits.js';
import { blocksEditorShortcut } from '../../shared/keyboardShortcuts.js';
import { observePreview } from '../../ui/observePreview.js';
import { panCamera, zoomCameraAt } from '../shared/editorCamera.js';
import { roundEditorNumber } from '../shared/editorData.js';
import { createEditorGame } from '../shared/editorGame.js';
import { evaluatedFootContacts } from '../shared/footContactGround.js';
import { GroundGuideOverlay } from '../shared/GroundGuideOverlay.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
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
  private artwork!: SceneImageLayer;
  private imageGesture:
    | {
        pointer: number;
        scene: string;
        id: string;
        start: Point;
        origin: Point;
        scale: Point;
        size: Point;
        resize: boolean;
      }
    | undefined;
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
  private readonly textureBudget = createSceneTextureBudget();
  private alive = true;
  private refresh: () => void = () => {};
  private readonly failures = new Map<string, string>();
  retry(): void {
    for (const manifest of this.failures.keys()) this.requests.delete(manifest);
    this.failures.clear();
    this.artwork.retry();
    this.refresh();
  }
  showGrid = true;
  private cinematicScroll: Point = { x: 0, y: 0 };
  /** View-only simulation of a future cinematic camera, independent of editor navigation. */
  setPreviewScroll(scroll: Point): void {
    if (!this.sys.isActive() || !Number.isFinite(scroll.x) || !Number.isFinite(scroll.y)) return;
    this.document.cancelImageDrag();
    this.document.cancelActorDrag();
    this.gesture = undefined;
    this.imageGesture = undefined;
    this.groundHandle.cancel();
    this.cameras.main.scrollX += scroll.x - this.cinematicScroll.x;
    this.cameras.main.scrollY += scroll.y - this.cinematicScroll.y;
    this.cinematicScroll = scroll;
    this.artwork.sync(this.document.workingScene?.images, this.document.workingScene?.layers, scroll);
  }

  constructor(
    private readonly document: SceneEditorDocument,
    private readonly characters: SceneCharacterRegistry,
    private readonly playback: SceneEditorPlayback,
    private readonly status: (message: string) => void,
  ) {
    super('SceneStage');
  }

  create(): void {
    this.artwork = new SceneImageLayer(
      this,
      (reference) => Promise.resolve(this.document.images.read(reference)),
      () => this.refresh(),
      this.textureBudget,
    );
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
      if (
        this.imageGesture &&
        (!this.document.hasActiveGesture || this.imageGesture.scene !== this.document.selectedSceneId)
      )
        this.imageGesture = undefined;
      const document = this.document.workingScene;
      this.artwork.sync(document?.images, document?.layers, this.cinematicScroll);
      if (!document) {
        this.preview.dispose();
        this.document.setActorGroundOffsets(new Map());
        this.document.setActorGroundContacts(new Map());
        return;
      }
      let message = [
        this.artwork.error,
        ...new Set(document.actors.map((actor) => this.failures.get(actor.character.manifest))),
      ]
        .filter(Boolean)
        .join('\n');
      try {
        assertSceneInstanceBudget(document, this.definitions);
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
      this.document.setActorGroundOffsets(this.preview.groundOffsets());
      this.document.setActorGroundContacts(this.preview.groundContacts());
      this.status(message);
      for (const actor of document.actors) this.ensureCharacter(actor.character.manifest, sync);
    };
    this.refresh = sync;
    const unsubscribe = this.document.subscribe(sync);
    const unsubscribeImages = this.document.images.subscribe(sync);
    const cancel = (): void => {
      this.gesture = undefined;
      this.imageGesture = undefined;
      this.pan = undefined;
      this.groundHandle.cancel();
      this.document.cancelImageDrag();
      this.document.cancelActorDrag();
    };
    const unsubscribePlayback = this.playback.subscribe(() => {
      this.document.setGroundPreviewing(this.playback.previewing);
      if (this.playback.previewing && (this.gesture || this.imageGesture)) {
        this.gesture = undefined;
        this.imageGesture = undefined;
        this.document.cancelImageDrag();
        this.document.cancelActorDrag();
      }
    });
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.document.workingScene || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
        if (this.imageGesture || this.gesture || this.pan || this.groundHandle.dragging) return;
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
        if (selected && sceneLayer(this.document.workingScene, 'actors').visible) {
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
        // A selected image's corner is a scale handle, even outside the image bounds.
        const selectedImage = this.document.workingScene.images?.find(
          (image) => image.id === this.document.selectedImageId,
        );
        const selectedObject = selectedImage && this.artwork.objects.get(selectedImage.id);
        const selectedBounds = selectedObject?.getBounds();
        const resize =
          !!selectedObject?.visible &&
          !this.document.isImageLocked(selectedImage?.id ?? '') &&
          !!selectedBounds &&
          Math.hypot(point.x - selectedBounds.right, point.y - selectedBounds.bottom) * zoom < 12;
        if (resize && selectedImage && selectedObject) {
          this.startImageGesture(event.pointerId, point, selectedImage.id, true);
          return;
        }
        // Selected handles take precedence; otherwise the unified display depth chooses the hit.
        const hits: { id: string; kind: 'actor' | 'image'; depth: number }[] = [];
        if (!id && sceneLayer(this.document.workingScene, 'actors').visible) {
          for (const actor of [...this.document.workingScene.actors].reverse()) {
            const entry = this.preview.instances.get(actor.id);
            if (!entry) continue;
            const bounds = entry.actor.puppet.container.getBounds();
            if (
              bounds.contains(point.x, point.y) ||
              Math.hypot(point.x - actor.position.x, point.y - actor.position.y) < 14 / zoom
            ) {
              hits.push({ id: actor.id, kind: 'actor', depth: entry.actor.puppet.container.depth });
            }
          }
        }
        if (!id) {
          for (const image of this.document.workingScene.images ?? []) {
            const object = this.artwork.objects.get(image.id);
            if (
              object?.visible &&
              !this.document.isImageLocked(image.id) &&
              object.getBounds().contains(point.x, point.y)
            )
              hits.push({ id: image.id, kind: 'image', depth: object.depth });
          }
          const hit = hits.sort((a, b) => b.depth - a.depth)[0];
          if (hit?.kind === 'image') {
            this.startImageGesture(event.pointerId, point, hit.id, false);
            return;
          }
          id = hit?.id ?? null;
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
        } else if (this.imageGesture?.pointer === event.pointerId) {
          this.moveImageGesture(this.point(event));
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
        if (this.imageGesture?.pointer === event.pointerId) {
          this.moveImageGesture(this.point(event));
          this.imageGesture = undefined;
          this.document.endImageDrag();
        }
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
        if (this.imageGesture || this.gesture || this.groundHandle.dragging) return;
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
        if (
          event.key === 'Escape' &&
          !blocksEditorShortcut(event) &&
          (this.imageGesture || this.gesture || this.pan || this.groundHandle.dragging)
        ) {
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
      unsubscribeImages();
      this.document.setActorGroundOffsets(new Map());
      this.document.setActorGroundContacts(new Map());
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
        () => this.artwork.dispose(),
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
  private startImageGesture(pointer: number, point: Point, id: string, resize: boolean): void {
    const image = this.document.workingScene?.images?.find((image) => image.id === id);
    const object = this.artwork.objects.get(id);
    if (!image || !object || !this.document.beginImageDrag(id)) return;
    this.imageGesture = {
      pointer,
      scene: this.document.selectedSceneId!,
      id,
      start: point,
      origin: image.position,
      scale: image.scale,
      size: { x: object.width, y: object.height },
      resize,
    };
  }
  private moveImageGesture(point: Point): void {
    const gesture = this.imageGesture;
    if (!gesture || !this.document.hasActiveGesture) return;
    const scale = gesture.resize
      ? {
          x: roundEditorNumber(Math.max(0.001, gesture.scale.x + (2 * (point.x - gesture.start.x)) / gesture.size.x)),
          y: roundEditorNumber(Math.max(0.001, gesture.scale.y + (2 * (point.y - gesture.start.y)) / gesture.size.y)),
        }
      : gesture.scale;
    this.document.moveImageDrag({
      position: gesture.resize ? gesture.origin : draggedPosition(gesture.start, gesture.origin, point, 'both'),
      scale,
    });
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
        const ready = await loadSceneCharacter(this, manifest, {
          definition,
          allowWebp: true,
          sharedBudget: this.textureBudget,
        });
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
      actor.puppet.container.setVisible(
        !this.playback.previewing &&
          !!this.document.workingScene &&
          sceneLayer(this.document.workingScene, 'actors').visible,
      );
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
    const imageId = this.document.selectedImageId;
    const image = imageId ? this.artwork.objects.get(imageId) : undefined;
    if (image?.visible && !this.document.isImageLocked(imageId!)) {
      const bounds = image.getBounds();
      const size = 10 / camera.zoom;
      this.overlay.lineStyle(2 / camera.zoom, 0xe5b35c).strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      this.overlay.fillStyle(0xe5b35c).fillRect(bounds.right - size / 2, bounds.bottom - size / 2, size, size);
    }
    const id = this.document.selectedActorId;
    const actor = id && (this.playback.actors?.get(id) ?? this.preview.instances.get(id)?.actor);
    if (!actor || !this.document.workingScene || !sceneLayer(this.document.workingScene, 'actors').visible) return;
    const { x, y } = actor.position;
    if (this.document.showFootContacts) {
      for (const contact of evaluatedFootContacts(actor.puppet)) {
        const { x: cx, y: cy } = contact.world;
        const size = 7 / camera.zoom;
        this.overlay.lineStyle(
          2 / camera.zoom,
          contact.id === this.document.selectedFootContactId ? 0xe5b35c : 0x85bf9b,
        );
        this.overlay
          .strokeCircle(cx, cy, size)
          .lineBetween(cx - size, cy, cx + size, cy)
          .lineBetween(cx, cy - size, cx, cy + size);
      }
    }
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
  const [previewScroll, setPreviewScroll] = useState<Point>({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const scene = new SceneStage(document, registry, playback, setError);
    setStage(scene);
    const game = createEditorGame('scene-stage-canvas', scene, { width: 1000, height: 700 });
    const release = observePreview(window.document.querySelector<HTMLElement>('#scene-stage-canvas')!, game);
    return () => {
      release();
      document.cancelImageDrag();
      document.cancelActorDrag();
      // A project retains this document after its iframe is removed. Release scene
      // subscriptions now; Game.destroy otherwise waits for another animation frame.
      game.scene.stop(scene);
      game.destroy(true);
    };
  }, [document, registry, playback]);
  return (
    <>
      <div className="scene-stage-toolbar" data-guide-id={GUIDE_TARGETS.sceneParallaxPreview}>
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
        {(['x', 'y'] as const).map((axis) => (
          <label key={axis}>
            Preview camera {axis.toUpperCase()}
            <input
              type="number"
              step="any"
              value={previewScroll[axis]}
              disabled={document.hasActiveGesture}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (!Number.isFinite(value)) return;
                const next = { ...previewScroll, [axis]: value };
                setPreviewScroll(next);
                stage?.setPreviewScroll(next);
              }}
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => {
            if (stage?.sys.isActive()) {
              stage.setPreviewScroll({ x: 0, y: 0 });
              setPreviewScroll({ x: 0, y: 0 });
              stage.cameras.main.setZoom(1).centerOn(0, 0);
            }
          }}
        >
          Reset view
        </button>
        <span>Wheel: zoom · Middle/right/Alt-drag: pan · Shift: bypass ground snap · Escape: cancel drag</span>
      </div>
      <div id="scene-stage-canvas" />
      {error && (
        <p className="scene-preview-error" role="alert">
          {error} Check the character references and required artwork, then retry preview.{' '}
          <button type="button" onClick={() => stage?.retry()}>
            Retry preview
          </button>
        </p>
      )}
    </>
  );
}
