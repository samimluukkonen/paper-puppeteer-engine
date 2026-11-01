import Phaser from 'phaser';
import { useEffect, useId, useRef, useState } from 'react';
import { DialogueKeyboardInput } from '../../engine/DialogueKeyboardInput.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { LoadedScene } from '../../engine/SceneLoader.js';
import type { StandaloneStorySource } from '../../engine/StandaloneStoryPlayer.js';
import type { StoryDefinition } from '../../engine/StoryDefinition.js';
import { StoryPackageLoader } from '../../engine/StoryPackageLoader.js';
import { StoryPlayer } from '../../engine/StoryPlayer.js';
import { createEditorGame, destroyEditorGame } from '../shared/editorGame.js';
import { buildProjectStoryPackage } from './projectPackage.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

type PreviewState = { status: string; index: number; waiting: boolean; text: string; audio: string; error: string };

/** Artist-only host around the public StoryPlayer and SceneLoader. No viewer controls enter the runtime. */
class StoryPreviewScene extends Phaser.Scene {
  private player: StoryPlayer | undefined;
  private loaded: LoadedScene | undefined;
  private source: StandaloneStorySource | undefined;
  private readonly lifetime = new AbortController();
  private ticking = false;
  private closed = false;
  private failure = '';
  private lastReport = '';
  constructor(
    private readonly story: DeepReadonly<StoryDefinition>,
    private readonly workspace: ProjectWorkspace,
    private readonly report: (state: PreviewState) => void,
  ) {
    super('StoryPreview');
  }
  create(): void {
    if (this.closed) return;
    this.events.once('shutdown', () => this.disposePreview());
    void this.prepare().catch((error: unknown) => this.failed(error));
  }
  private async prepare(): Promise<void> {
    const files = await buildProjectStoryPackage(this.workspace, this.story.id, this.lifetime.signal);
    this.lifetime.signal.throwIfAborted();
    const source = await StoryPackageLoader.load(this, files, { signal: this.lifetime.signal });
    if (this.closed) {
      source.dispose?.();
      return;
    }
    this.source = source;
    const attach = (loaded: LoadedScene): LoadedScene => {
      try {
        loaded.applyCamera(this.cameras.main, { x: 0, y: 0, width: 960, height: 540 });
      } catch (error) {
        loaded.dispose();
        throw error;
      }
      this.loaded = loaded;
      return {
        ...loaded,
        dispose: () => {
          if (this.loaded === loaded) this.loaded = undefined;
          loaded.dispose();
        },
      };
    };
    this.player = new StoryPlayer(source.definition, {
      scenes: source.scenes,
      ...(source.transitionOverlay ? { transitionOverlay: source.transitionOverlay } : {}),
      prepareScene: async (definition, context) => {
        const prepared = await source.prepareScene!(definition, context);
        return { dispose: () => prepared.dispose(), activate: async () => attach(await prepared.activate()) };
      },
      loadScene: async (definition, context) => attach(await source.loadScene(definition, context)),
    });
    this.restart();
  }

  private failed(error: unknown): void {
    if (this.closed) return;
    this.failure = error instanceof Error ? error.message : String(error);
    this.publish();
  }
  private publish(): void {
    if (this.closed) return;
    const runner = this.loaded?.runner;
    const state: PreviewState = {
      status: this.player?.status ?? 'loading',
      index: this.player?.index ?? -1,
      waiting: runner?.status === 'waiting-for-dialogue-advance',
      text: runner?.dialogue?.line.text ?? '',
      audio: runner?.audio?.status ?? 'disabled',
      error: this.failure || runner?.audio?.error || '',
    };
    const signature = JSON.stringify(state);
    if (signature !== this.lastReport) {
      this.lastReport = signature;
      this.report(state);
    }
  }
  restart(): void {
    if (!this.player || this.closed) return;
    this.failure = '';
    this.player.stop();
    void this.player.start().then(
      () => this.publish(),
      (error: unknown) => this.failed(error),
    );
    this.publish();
  }
  stop(): void {
    this.player?.stop();
    this.publish();
  }
  advance(): void {
    try {
      this.player?.advanceDialogue();
      this.publish();
    } catch (error) {
      this.failed(error);
    }
  }
  get waitingForDialogue(): boolean {
    return this.player?.currentSession?.runner.status === 'waiting-for-dialogue-advance';
  }
  enableAudio(): void {
    void this.loaded?.runner.audio?.unlock().then(
      () => {
        this.loaded?.runner.syncAudio();
        this.publish();
      },
      (error: unknown) => this.failed(error),
    );
  }
  update(_time: number, delta: number): void {
    if (this.closed || !this.player) return;
    if (this.ticking) {
      this.publish();
      return;
    }
    this.ticking = true;
    void this.player
      .update(delta)
      .then(
        () => this.publish(),
        (error: unknown) => this.failed(error),
      )
      .finally(() => {
        this.ticking = false;
      });
  }
  disposePreview(): void {
    if (this.closed) return;
    this.closed = true;
    this.player?.dispose();
    this.player = undefined;
    this.lifetime.abort();
    this.source?.dispose?.();
    this.source = undefined;
  }
}

export default function StoryPreview({
  story,
  workspace,
  close,
}: {
  story: DeepReadonly<StoryDefinition>;
  workspace: ProjectWorkspace;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const runtime = useRef<StoryPreviewScene | undefined>(undefined);
  const parent = `story-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [state, setState] = useState<PreviewState>({
    status: 'loading',
    index: -1,
    waiting: false,
    text: '',
    audio: 'disabled',
    error: '',
  });
  useEffect(() => {
    dialog.current?.showModal();
    const preview = new StoryPreviewScene(story, workspace, setState);
    runtime.current = preview;
    const game = createEditorGame(parent, preview, { width: 960, height: 540 });
    const target = document.getElementById(parent)!;
    const keyboard = new DialogueKeyboardInput(target, {
      waiting: () => preview.waitingForDialogue,
      advanceDialogue: () => preview.advance(),
    });
    target.focus();
    return () => {
      keyboard.dispose();
      runtime.current = undefined;
      try {
        preview.disposePreview();
      } finally {
        destroyEditorGame(game);
      }
    };
  }, [story, workspace, parent]);
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog story-preview"
      aria-label="Entire story preview"
      onClose={close}
      onCancel={close}
    >
      <h2>Preview · {story.name}</h2>
      <p className="workspace-caption">
        Artist preview · Stop and Restart affect this preview only. Close to return to editing.
      </p>
      <div className="project-actions">
        <button onClick={() => runtime.current?.stop()} disabled={state.status === 'stopped'}>
          Stop story
        </button>
        <button onClick={() => runtime.current?.restart()}>Restart story</button>
        <button onClick={() => runtime.current?.advance()} disabled={!state.waiting}>
          Advance dialogue (Enter)
        </button>
        {['locked', 'error'].includes(state.audio) && (
          <button onClick={() => runtime.current?.enableAudio()}>Enable story audio</button>
        )}
        <button onClick={close}>Close preview</button>
      </div>
      <p role="status">
        {state.status} ·{' '}
        {state.index >= 0 && state.index < story.scenes.length
          ? `Scene ${state.index + 1} of ${story.scenes.length}: ${workspace.scenes.scene(story.scenes[state.index]!.sceneAssetId)?.name ?? story.scenes[state.index]!.sceneAssetId}`
          : `${story.scenes.length} scenes`}
        {state.waiting ? ' · Wait for Enter' : ''}
      </p>
      {state.text && <p className="story-preview-dialogue">{state.text}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      <div
        id={parent}
        className="story-preview-canvas"
        tabIndex={0}
        role="group"
        aria-label="Story preview canvas"
        onPointerDown={(event) => event.currentTarget.focus()}
      />
    </dialog>
  );
}
