import Phaser from 'phaser';
import { useEffect, useId, useRef, useState } from 'react';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { Puppet } from '../../engine/Puppet.js';
import { loadSceneCharacter } from '../../shared/loadSceneCharacter.js';
import { createEditorGame } from './editorGame.js';

export interface AnimationPreviewLease {
  readonly definition: CharacterDefinition;
  dispose(this: void): void;
}

/** A detached ordinary Puppet evaluates FK, IK, deformation and root motion together. */
export class AnimationLibraryRuntimeScene extends Phaser.Scene {
  puppet: Puppet | undefined;
  private loop: boolean;
  private playing = false;
  constructor(
    private readonly definition: CharacterDefinition,
    private readonly animation: string,
    private readonly report: (message: string) => void,
    private readonly playback: (playing: boolean) => void,
    private readonly ready: () => void,
  ) {
    super('AnimationLibraryRuntime');
    this.loop = definition.animations.find((clip) => clip.name === animation)?.loop ?? false;
  }
  create(): void {
    this.events.once('shutdown', () => {
      this.puppet?.destroy();
      this.puppet = undefined;
    });
    void loadSceneCharacter(this, 'animation-library', { definition: this.definition, allowWebp: true })
      .then((definition) => {
        if (!definition) return;
        if (!definition.animations.some((clip) => clip.name === this.animation))
          throw new Error('Animation is missing from its source character.');
        this.puppet = new Puppet(this, { definition, x: 380, y: 435, autoUpdate: false });
        this.puppet.animationPlayer.setPreviewMode(true, { applyRootMotion: true });
        this.stopPreview();
        const bounds = this.puppet.container.getBounds();
        if (bounds.width > 0 && bounds.height > 0) {
          this.cameras.main.setZoom(Math.min(760 / (bounds.width + 120), 500 / (bounds.height + 120)));
          this.cameras.main.centerOn(bounds.centerX, bounds.centerY);
        }
        this.report('Runtime preview ready. Source animation is unchanged.');
        this.ready();
      })
      .catch((error: unknown) => this.report(String(error)));
  }
  stopPreview(): void {
    const puppet = this.puppet;
    if (!puppet) return;
    puppet.stop();
    puppet.container.setPosition(380, 435);
    puppet.play(this.animation, { restart: true, fadeDuration: 0, loop: this.loop, rootMotion: 'apply' });
    puppet.pauseAnimation().sampleAnimation(0);
    this.playing = false;
    this.playback(false);
  }
  toggle(): void {
    if (!this.puppet) return;
    if (this.playing) this.puppet.pauseAnimation();
    else {
      if (this.puppet.isPlaybackStopped() || this.puppet.getPlaybackStatus()?.status === 'completed')
        this.stopPreview();
      this.puppet.resumeAnimation();
    }
    this.playing = !this.playing;
    this.playback(this.playing);
  }
  setLoop(loop: boolean): void {
    this.loop = loop;
    this.stopPreview();
  }
  update(_time: number, delta: number): void {
    this.puppet?.update(delta);
    if (this.playing && !this.puppet?.isPlaying) {
      this.playing = false;
      this.playback(false);
    }
  }
}

/** Uses the same cancellable metadata/artwork loading and game teardown as package previews. */
export function AnimationLibraryPreview({
  animation,
  load,
  close,
}: {
  animation: string;
  load(this: void, signal: AbortSignal): Promise<AnimationPreviewLease>;
  close(this: void): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scene = useRef<AnimationLibraryRuntimeScene | undefined>(undefined);
  const parent = `animation-library-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [message, setMessage] = useState('Loading source character…');
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    const request = new AbortController();
    let game: Phaser.Game | undefined;
    let lease: AnimationPreviewLease | undefined;
    void load(request.signal)
      .then((runtime) => {
        if (request.signal.aborted) {
          runtime.dispose();
          return;
        }
        lease = runtime;
        setLoop(runtime.definition.animations.find((clip) => clip.name === animation)?.loop ?? false);
        const preview = new AnimationLibraryRuntimeScene(
          runtime.definition,
          animation,
          (text) => {
            if (!request.signal.aborted) setMessage(text);
          },
          (value) => {
            if (!request.signal.aborted) setPlaying(value);
          },
          () => {
            if (!request.signal.aborted) setReady(true);
          },
        );
        scene.current = preview;
        game = createEditorGame(parent, preview, { width: 760, height: 500 });
        game.events.once('destroy', runtime.dispose);
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setMessage(String(error));
      });
    return () => {
      request.abort();
      scene.current = undefined;
      if (game) game.destroy(true);
      else lease?.dispose();
    };
  }, [animation, load, parent]);
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog animation-library-preview"
      aria-label="Animation runtime preview"
      onCancel={close}
      onClose={close}
    >
      <h2>Preview · {animation}</h2>
      <div className="animation-library-actions">
        <button type="button" disabled={!ready} onClick={() => scene.current?.toggle()}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" disabled={!ready} onClick={() => scene.current?.stopPreview()}>
          Stop / Restart
        </button>
        <label>
          <input
            type="checkbox"
            disabled={!ready}
            checked={loop}
            onChange={(event) => {
              setLoop(event.target.checked);
              scene.current?.setLoop(event.target.checked);
            }}
          />{' '}
          Loop preview
        </label>
        <button type="button" onClick={close}>
          Close preview
        </button>
      </div>
      <p role="status">{message}</p>
      <div id={parent} className="animation-library-stage" />
    </dialog>
  );
}
