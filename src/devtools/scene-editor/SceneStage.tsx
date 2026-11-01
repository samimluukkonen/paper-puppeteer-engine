import Phaser from 'phaser';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { Actor } from '../../engine/Actor.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { cinematicFrame, SCENE_OUTPUT_VIEWPORT } from '../../engine/cinematicCamera.js';
import { loadSceneCharacter } from '../../engine/loadSceneCharacter.js';
import { throwNotificationErrors } from '../../engine/notifications.js';
import { Puppet } from '../../engine/Puppet.js';
import { getDialogueAtTime } from '../../engine/sceneDialogue.js';
import { SceneDialogueOverlay } from '../../engine/SceneDialogueOverlay.js';
import { SceneImageLayer } from '../../engine/SceneImageLayer.js';
import { sceneLayer } from '../../engine/sceneLayers.js';
import { createSceneTextureBudget } from '../../engine/sceneTextureBudget.js';
import { SceneTransitionOverlay } from '../../engine/SceneTransitionOverlay.js';
import { CLEAR_SCENE_TRANSITION, evaluateTransitionAtTime } from '../../engine/sceneTransitions.js';
import { assertSceneInstanceBudget } from '../../engine/sceneWorkloadLimits.js';
import { blocksEditorShortcut } from '../../shared/keyboardShortcuts.js';
import { observePreview } from '../../ui/observePreview.js';
import { projectEditorContext } from '../project/projectBridge.js';
import { panCamera, zoomCameraAt } from '../shared/editorCamera.js';
import { roundEditorNumber } from '../shared/editorData.js';
import { createEditorGame, destroyEditorGame } from '../shared/editorGame.js';
import { evaluatedFootContacts } from '../shared/footContactGround.js';
import { GroundGuideOverlay } from '../shared/GroundGuideOverlay.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { SceneActorPreview } from './SceneActorPreview.js';
import { SceneCameraPreview } from './SceneCameraPreview.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import type { ActorGroundContact, SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';
import { SceneGroundHandle } from './SceneGroundHandle.js';
import { draggedPosition, stagePoint } from './stageCoordinates.js';

type Point = { x: number; y: number };
type Gesture = { pointer: number; scene: string; start: Point; origin: Point; axis: 'x' | 'y' | 'both' };

/** Phaser owns rendering; React/document changes reconcile existing instances without remounting the game. */
class SceneStage extends Phaser.Scene {
  private cameraPreview!: SceneCameraPreview;
  private cameraGesture: Gesture | undefined;
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
  private transitions!: SceneTransitionOverlay;
  private dialogue!: SceneDialogueOverlay;
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
  /** Legacy parallax inspection offset; view-only and ignored by audience preview. */
  setPreviewScroll(scroll: Point): void {
    if (
      this.document.cameraPreviewing ||
      !this.sys.isActive() ||
      !Number.isFinite(scroll.x) ||
      !Number.isFinite(scroll.y)
    )
      return;
    this.document.cancelCameraDrag();
    this.cameraGesture = undefined;
    this.document.cancelImageDrag();
    this.document.cancelActorDrag();
    this.gesture = undefined;
    this.imageGesture = undefined;
    this.groundHandle.cancel();
    this.cameras.main.scrollX += scroll.x - this.cinematicScroll.x;
    this.cameras.main.scrollY += scroll.y - this.cinematicScroll.y;
    this.cinematicScroll = scroll;
    this.syncArtwork();
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
    this.document.setCameraTimeProvider(() => this.playback.time);
    this.artwork = new SceneImageLayer(
      this,
      (reference) => Promise.resolve(this.document.images.read(reference)),
      () => this.refresh(),
      this.textureBudget,
    );
    this.preview = new SceneActorPreview(this);
    this.document.setActorBoundsProvider((id) => {
      const actor = this.playback.actors?.get(id) ?? this.preview.instances.get(id)?.actor;
      const bounds = actor?.puppet.container.getBounds();
      return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined;
    });
    this.grid = this.add.graphics().setDepth(-1000);
    this.transitions = new SceneTransitionOverlay(this);
    this.dialogue = new SceneDialogueOverlay(this);
    this.overlay = this.add.graphics().setDepth(1_000_000);
    this.groundOverlay = new GroundGuideOverlay(this, { draggable: true });
    this.groundHandle = new SceneGroundHandle(this.document.groundGuide);
    this.cameras.main.centerOn(0, 0);
    this.cameraPreview = new SceneCameraPreview(this.cameras.main);
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Actor placement canvas');
    const events = new AbortController();
    const groundOffsets = new Map<string, number>();
    const groundContacts = new Map<string, readonly ActorGroundContact[]>();
    const syncGestures = (): void => {
      if (this.gesture && this.gesture.scene !== this.document.selectedSceneId) this.gesture = undefined;
      if (
        this.imageGesture &&
        (!this.document.hasActiveGesture || this.imageGesture.scene !== this.document.selectedSceneId)
      )
        this.imageGesture = undefined;
      if (!this.document.hasActiveGesture) this.cameraGesture = undefined;
    };
    const sync = (): void => {
      syncGestures();
      const document = this.document.workingScene;
      this.syncCamera();
      this.syncArtwork();
      if (!document) {
        this.playback.dispose();
        this.preview.dispose();
        groundOffsets.clear();
        groundContacts.clear();
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
      let changedActors: ReadonlySet<string> | undefined;
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
          {
            resolve: (id) => {
              const asset = this.document.audioAssets.find((entry) => entry.id === id);
              if (!asset) return undefined;
              return {
                definition: { ...asset, path: asset.path.replace(/^(?:\.\.\/)+/, '') },
                bytes: this.document.readAudio(asset.path),
              };
            },
          },
        );
        changedActors = this.preview.sync(document, this.definitions);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // Removed/replaced Actors lose old measurements; unchanged Actors keep theirs.
      for (const id of groundOffsets.keys())
        if (!this.preview.instances.has(id) || !changedActors || changedActors.has(id)) groundOffsets.delete(id);
      for (const id of groundContacts.keys())
        if (!this.preview.instances.has(id) || !changedActors || changedActors.has(id)) groundContacts.delete(id);
      for (const [id, offset] of this.preview.groundOffsets(changedActors)) groundOffsets.set(id, offset);
      for (const [id, contacts] of this.preview.groundContacts(changedActors)) groundContacts.set(id, contacts);
      this.document.setActorGroundOffsets(groundOffsets);
      this.document.setActorGroundContacts(new Map(groundContacts));
      this.status(message);
      for (const actor of document.actors) this.ensureCharacter(actor.character.manifest, sync);
    };
    this.refresh = sync;
    const unsubscribe = this.document.subscribeAuthored(sync);
    let cameraPreviewing = this.document.cameraPreviewing;
    const unsubscribePresentation = this.document.subscribe(() => {
      syncGestures();
      if (cameraPreviewing === this.document.cameraPreviewing) return;
      cameraPreviewing = this.document.cameraPreviewing;
      this.syncCamera();
      this.syncArtwork();
    });
    const unsubscribeImages = this.document.images.subscribe(sync);
    const cancel = (): void => {
      this.gesture = undefined;
      this.imageGesture = undefined;
      this.pan = undefined;
      this.groundHandle.cancel();
      this.document.cancelCameraDrag();
      this.cameraGesture = undefined;
      this.document.cancelImageDrag();
      this.document.cancelActorDrag();
    };
    const unsubscribePlayback = this.playback.subscribe(() => {
      this.syncCamera();
      this.syncArtwork();
      this.document.setGroundPreviewing(this.playback.previewing);
      if (this.playback.previewing && (this.gesture || this.imageGesture)) {
        this.gesture = undefined;
        this.imageGesture = undefined;
        this.document.cancelCameraDrag();
        this.cameraGesture = undefined;
        this.document.cancelImageDrag();
        this.document.cancelActorDrag();
      }
    });
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.document.workingScene || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
        if (this.cameraGesture || this.imageGesture || this.gesture || this.pan || this.groundHandle.dragging) return;
        event.preventDefault();
        canvas.focus();
        canvas.setPointerCapture(event.pointerId);
        if (this.document.cameraPreviewing && !this.document.cameraOverlays) return;
        if (event.button !== 0 || event.altKey) {
          if (this.document.cameraPreviewing) return;
          this.pan = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
          return;
        }
        const point = this.point(event);
        if (!this.document.cameraPreviewing && this.hitCamera(point) && this.document.beginCameraDrag()) {
          this.playback.pause();
          this.cameraGesture = {
            pointer: event.pointerId,
            scene: this.document.selectedSceneId!,
            start: point,
            origin: this.document.cinematicCamera,
            axis: 'both',
          };
          return;
        }
        if (this.groundHandle.down(event.pointerId, point, this.cameras.main)) return;
        // Runtime transforms are view-only. The independent guide remains draggable during preview.
        if (this.playback.previewing) return;
        const selected = this.document.workingScene.actors.find((actor) => actor.id === this.document.selectedActorId);
        let id: string | null = null;
        let axis: Gesture['axis'] = 'both';
        const zoom = this.cameras.main.zoom;
        if (!this.document.cameraSelected && selected && sceneLayer(this.document.workingScene, 'actors').visible) {
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
        } else if (this.cameraGesture?.pointer === event.pointerId) {
          const gesture = this.cameraGesture;
          this.document.moveCameraDrag(draggedPosition(gesture.start, gesture.origin, this.point(event), 'both'));
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
        if (this.cameraGesture?.pointer === event.pointerId) {
          const gesture = this.cameraGesture;
          this.document.moveCameraDrag(draggedPosition(gesture.start, gesture.origin, this.point(event), 'both'));
          this.cameraGesture = undefined;
          this.document.endCameraDrag();
        }
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
        if (
          this.document.cameraPreviewing ||
          this.cameraGesture ||
          this.imageGesture ||
          this.gesture ||
          this.groundHandle.dragging
        )
          return;
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
          (this.cameraGesture || this.imageGesture || this.gesture || this.pan || this.groundHandle.dragging)
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
      unsubscribePresentation();
      unsubscribeImages();
      this.document.setActorBoundsProvider(undefined);
      this.document.setCameraTimeProvider(undefined);
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
        () => this.transitions.dispose(),
        () => this.dialogue.dispose(),
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
  private syncCamera(): void {
    this.cameraPreview.sync(this.document.cameraPreviewing, this.document.cinematicCamera, {
      x: 0,
      y: 0,
      width: this.scale.gameSize.width,
      height: this.scale.gameSize.height,
    });
  }
  private syncArtwork(): void {
    const scene = this.document.workingScene;
    const state = this.document.cinematicCamera;
    const offset = this.document.cameraPreviewing ? { x: 0, y: 0 } : this.cinematicScroll;
    this.artwork.sync(scene?.images, scene?.layers, { x: state.x + offset.x, y: state.y + offset.y });
  }
  private hitCamera(point: Point): boolean {
    const state = this.document.cinematicCamera;
    const frame = cinematicFrame(state);
    const tolerance = 10 / this.cameras.main.zoom;
    // Unselected edges select the camera. The center handle requires explicit selection.
    return (
      (this.document.cameraSelected && Math.hypot(point.x - state.x, point.y - state.y) < tolerance * 1.5) ||
      (point.x >= frame.x - tolerance &&
        point.x <= frame.x + frame.width + tolerance &&
        point.y >= frame.y - tolerance &&
        point.y <= frame.y + frame.height + tolerance &&
        Math.min(
          Math.abs(point.x - frame.x),
          Math.abs(point.x - frame.x - frame.width),
          Math.abs(point.y - frame.y),
          Math.abs(point.y - frame.y - frame.height),
        ) < tolerance)
    );
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
    const canvasBounds = this.game.canvas.getBoundingClientRect();
    const camera = this.cameras.main;
    const scaleX = canvasBounds.width / this.scale.gameSize.width;
    const scaleY = canvasBounds.height / this.scale.gameSize.height;
    return stagePoint(
      { x: event.clientX, y: event.clientY },
      {
        left: canvasBounds.left + camera.x * scaleX,
        top: canvasBounds.top + camera.y * scaleY,
        width: camera.width * scaleX,
        height: camera.height * scaleY,
      },
      {
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
        zoom: camera.zoom,
        width: camera.width,
        height: camera.height,
        originX: camera.originX,
        originY: camera.originY,
      },
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
    this.playback.update(delta);
    this.syncCamera();
    this.syncArtwork();
    const source = this.document.workingScene;
    this.dialogue.setCamera(this.document.cinematicCamera);
    this.dialogue.setDialogue(
      source &&
        this.playback.previewing &&
        !['failed', 'cancelled', 'interrupted', 'disposed'].includes(this.playback.status)
        ? getDialogueAtTime(source, this.playback.time)
        : undefined,
    );
    this.transitions.setCamera(this.document.cinematicCamera);
    this.transitions.setTransition(
      source && (this.playback.previewing || this.document.cameraPreviewing)
        ? evaluateTransitionAtTime(source, this.playback.time)
        : CLEAR_SCENE_TRANSITION,
    );
    const cleanPreview = this.document.cameraPreviewing && !this.document.cameraOverlays;
    const guide = this.document.groundGuide.getSnapshot().guide;
    this.groundOverlay.render(cleanPreview ? { ...guide, enabled: false } : guide);
    const actorsVisible = !this.playback.previewing && !!source && sceneLayer(source, 'actors').visible;
    for (const { actor } of this.preview.instances.values()) {
      const container = actor.puppet.container;
      if (container.visible !== actorsVisible) container.setVisible(actorsVisible);
    }
    const camera = this.cameras.main;
    this.grid.clear();
    if (this.showGrid && !cleanPreview) {
      const top = camera.getWorldPoint(0, 0);
      const bottom = camera.getWorldPoint(camera.width, camera.height);
      this.grid.lineStyle(1 / camera.zoom, 0x454550, 0.4);
      for (let x = Math.floor(top.x / 32) * 32; x <= bottom.x; x += 32) this.grid.lineBetween(x, top.y, x, bottom.y);
      for (let y = Math.floor(top.y / 32) * 32; y <= bottom.y; y += 32) this.grid.lineBetween(top.x, y, bottom.x, y);
    }
    this.overlay.clear();
    if (cleanPreview) return;
    if (!this.document.cameraPreviewing) {
      const state = this.document.cinematicCamera;
      const frame = cinematicFrame(state);
      const z = camera.zoom;
      this.overlay
        .lineStyle((this.document.cameraSelected ? 2 : 1) / z, 0x58a6ff, 0.9)
        .strokeRect(frame.x, frame.y, frame.width, frame.height);
      this.overlay
        .lineBetween(state.x - 9 / z, state.y, state.x + 9 / z, state.y)
        .lineBetween(state.x, state.y - 9 / z, state.x, state.y + 9 / z);
      if (this.document.cameraSelected) this.overlay.strokeCircle(state.x, state.y, 12 / z);
    }
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
    if (
      this.document.cameraSelected ||
      !actor ||
      !this.document.workingScene ||
      !sceneLayer(this.document.workingScene, 'actors').visible
    )
      return;
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
  useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<SceneStage>();
  const [grid, setGrid] = useState(true);
  const [previewScroll, setPreviewScroll] = useState<Point>({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const scene = new SceneStage(document, registry, playback, setError);
    setStage(scene);
    const game = createEditorGame('scene-stage-canvas', scene, SCENE_OUTPUT_VIEWPORT);
    const release = observePreview(window.document.querySelector<HTMLElement>('#scene-stage-canvas')!, game);
    let rendererActive = true;
    game.events.once(Phaser.Core.Events.READY, () =>
      queueMicrotask(() => {
        if (!rendererActive && game.isRunning) game.loop.stop();
      }),
    );
    const releaseRenderer = projectEditorContext()?.bindRenderer({
      activate: () => {
        rendererActive = true;
        if (game.isRunning && !game.loop.running) game.loop.start(game.loop.callback);
      },
      suspend: () => {
        rendererActive = false;
        playback.pause();
        game.loop.stop();
      },
      // The scene host's bindScene callback unmounts this React owner.
      dispose: () => {},
    });
    return () => {
      releaseRenderer?.();
      release();
      document.cancelImageDrag();
      document.cancelActorDrag();
      // A project retains this document after its iframe is removed. Release scene
      // subscriptions now; Game.destroy otherwise waits for another animation frame.
      game.scene.stop(scene);
      destroyEditorGame(game);
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
              disabled={document.hasActiveGesture || document.cameraPreviewing}
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
          data-guide-id={GUIDE_TARGETS.sceneCameraNavigation}
          disabled={document.cameraPreviewing}
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
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.sceneCameraPreview}
          disabled={!stage}
          aria-pressed={document.cameraPreviewing}
          onClick={() => document.setCameraPreview(!document.cameraPreviewing)}
        >
          {document.cameraPreviewing ? 'Exit Camera Preview' : 'Preview Through Camera'}
        </button>
        {document.cameraPreviewing && (
          <label>
            <input
              type="checkbox"
              checked={document.cameraOverlays}
              onChange={(event) => document.setCameraOverlays(event.target.checked)}
            />{' '}
            Editor overlays
          </label>
        )}
        <span>
          1000 × 700 · 10:7 · Wheel: zoom · Middle/right/Alt-drag: pan · Shift: bypass ground snap · Escape: cancel drag
        </span>
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
