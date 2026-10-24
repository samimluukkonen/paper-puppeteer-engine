import { characterManifestSchema } from '../../engine/CharacterDefinition.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { inspectImageHeader } from '../../engine/imageHeader.js';
import { throwNotificationErrors } from '../../engine/notifications.js';
import { parseSceneJson } from '../../engine/SceneDefinition.js';
import type { LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import { buildCharacterPackage, openPackageRuntime, packageJson } from '../shared/package/characterPackage.js';
import type { ProjectEditorContext } from './projectBridge.js';
import { ProjectValidationError, requireValidExport, type ProjectInspection } from './projectInspection.js';
import { buildProjectScenePackage, characterFileFetcher } from './projectPackage.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

export interface ProjectSession {
  key: string;
  workspace: ProjectWorkspace;
  autosave: LocalAutosave;
  releaseAutosave: () => void;
}
export interface ProjectEditorHost {
  token: string;
  session: ProjectSession;
  asset: string;
  kind: 'character' | 'scene';
  src: string;
  context: ProjectEditorContext;
  pending?: () => boolean;
  openView?: (view: 'rig' | 'animation') => void;
  openGuide?: (guideId?: string) => void;
  guideId?: string | undefined;
  guidePending?: boolean;
}
interface RuntimeLease {
  definition: CharacterDefinition;
  dispose(): void;
}

interface ProjectEditorHostOptions {
  readonly baseUrl: string;
  readonly changed: (hosts: readonly ProjectEditorHost[]) => void;
  readonly activate: (token: string | undefined) => void;
  readonly validate: (workspace: ProjectWorkspace, report: ProjectInspection) => void;
}

/** Own retained editor contexts, runtime leases and preview teardown independently of React rendering. */
export class ProjectEditorHosts {
  private readonly owners = new Map<string, ProjectEditorHost>();
  private readonly leases = new Set<RuntimeLease>();
  private readonly closers = new Map<string, () => void>();
  private readonly lifetime = new AbortController();

  constructor(private readonly options: ProjectEditorHostOptions) {}

  readonly resolve = (token: string): ProjectEditorContext | undefined => this.owners.get(token)?.context;

  private publish(): void {
    this.options.changed([...this.owners.values()]);
  }

  private releaseLease(lease: RuntimeLease): void {
    if (this.leases.delete(lease)) lease.dispose();
  }

  dispose(): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort(new DOMException('Project editors closed.', 'AbortError'));
    const errors: unknown[] = [];
    for (const release of [
      ...this.closers.values(),
      ...[...this.leases].map((lease) => () => this.releaseLease(lease)),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    this.closers.clear();
    this.owners.clear();
    this.leases.clear();
    throwNotificationErrors(errors, 'Project editor disposal failed.');
  }

  private async runtime(workspace: ProjectWorkspace, id: string, namespace?: string): Promise<RuntimeLease> {
    const snapshot = workspace.captureCharacter(id);
    const files = await buildCharacterPackage(
      snapshot,
      characterFileFetcher(workspace.character(id).files),
      this.lifetime.signal,
    );
    const lease = await openPackageRuntime(files, this.lifetime.signal, namespace);
    if (this.lifetime.signal.aborted) {
      lease.dispose();
      this.lifetime.signal.throwIfAborted();
    }
    this.leases.add(lease);
    return lease;
  }
  async open(
    session: ProjectSession,
    kind: 'character' | 'scene',
    id: string,
    view: 'rig' | 'animation' = 'rig',
    guide = false,
    guideId?: string,
  ): Promise<void> {
    this.lifetime.signal.throwIfAborted();
    const workspace = session.workspace;
    const existing = [...this.owners.values()].find(
      (host) => host.session === session && host.kind === kind && host.asset === id,
    );
    if (existing) {
      existing.openView?.(view);
      this.options.activate(existing.token);
      if (guide) {
        if (existing.openGuide) existing.openGuide(guideId);
        else {
          existing.guidePending = true;
          existing.guideId = guideId;
        }
      }
      return;
    }
    const token = crypto.randomUUID();
    const ownedLeases = new Set<RuntimeLease>();
    let closed = false;
    let failed = false;
    let disposeScene: (() => void) | undefined;
    const character = kind === 'character' ? workspace.character(id) : undefined;
    const close = (): void => {
      closed = true;
      if (character) character.loading = false;
      const dispose = disposeScene;
      disposeScene = undefined;
      dispose?.();
    };
    const initialLease = kind === 'character' ? await this.runtime(workspace, id) : undefined;
    if (initialLease) ownedLeases.add(initialLease);
    const definition = initialLease?.definition;
    if (kind === 'scene') workspace.scenes.selectScene(id);
    const choices = workspace.definition.characters.map((entry) => ({
      id: entry.id,
      label: entry.name,
      manifest: entry.manifest,
    }));
    // Scene runtime definitions are fresh on every opening. The document remains the same owner.
    const runtimeCharacters = new Map<string, Promise<CharacterDefinition>>();
    let lastAuthoredRevision = workspace.autosaveRevision;
    const context: ProjectEditorContext = {
      autosave: session.autosave,
      get projectName() {
        return workspace.definition.name;
      },
      get assetName() {
        return kind === 'character'
          ? (workspace.definition.characters.find((entry) => entry.id === id)?.name ?? id)
          : (workspace.scenes.scene(id)?.name ?? id);
      },
      subscribe: workspace.subscribe,
      bindGuide: (open) => {
        const host = this.owners.get(token)!;
        host.openGuide = open;
        if (host.guidePending) {
          host.guidePending = false;
          open(host.guideId);
          delete host.guideId;
        }
        return () => {
          delete host.openGuide;
        };
      },
      ...(definition
        ? {
            definition,
            characterId: id,
            sourceDefinition: workspace.character(id).definition,
            fetcher: characterFileFetcher(workspace.character(id).files),
          }
        : { scenes: workspace.scenes }),
      choices,
      changed: () => {
        const revision = workspace.autosaveRevision;
        if (revision === lastAuthoredRevision) return;
        lastAuthoredRevision = revision;
        workspace.refresh();
      },
      characterLoadFailed: () => {
        if (kind !== 'character' || closed) return;
        const entry = workspace.character(id);
        if (!entry.loading) return;
        failed = true;
        entry.loading = false;
        workspace.refresh();
      },
      bindScene: (dispose) => {
        disposeScene = dispose;
      },
      validateScene: (scene) => {
        const report = workspace.inspect('export', true, parseSceneJson(JSON.stringify(scene)));
        this.options.validate(workspace, report);
        requireValidExport(report);
        workspace.validateScene(scene);
      },
      confirmReplacement: (assetKind, assetId) => {
        const dependents = workspace
          .dependents({ kind: assetKind, owner: id, id: assetId })
          .filter(({ from }) => from.kind !== 'character');
        return (
          !dependents.length ||
          window.confirm(
            `Replace ${assetKind} "${assetId}"? This affects:\n${dependents.map(({ label }) => label).join('\n')}\n\nReferences will be kept. Continue?`,
          )
        );
      },
      assetReferences: (kind, assetId) =>
        workspace
          .dependents({ kind, owner: id, id: assetId })
          .filter(({ from }) => from.kind === 'actor')
          .map(({ label }) => label),
      buildScenePackage: (scene) =>
        buildProjectScenePackage(workspace, scene).catch((error: unknown) => {
          if (error instanceof ProjectValidationError) this.options.validate(workspace, error.report);
          throw error;
        }),
      loadProjectImages: async () => {
        const images: { id: string; name: string; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }[] =
          [];
        for (const { id: characterId } of workspace.definition.characters) {
          const packaged = await buildCharacterPackage(
            workspace.captureCharacter(characterId),
            characterFileFetcher(workspace.character(characterId).files),
          );
          const manifest = characterManifestSchema.parse(packageJson(packaged, 'character.json'));
          for (const path of new Set(Object.values(manifest.textures))) {
            const bytes = packaged.get(path)!;
            const header = inspectImageHeader(bytes)!;
            images.push({
              id: `${characterId}:${path}`,
              name: `${characterId}: ${path}`,
              bytes,
              width: header.width,
              height: header.height,
            });
          }
        }
        return images;
      },
      loadCharacter: (reference) => {
        const characterId = workspace.resolveCharacter(reference);
        let request = runtimeCharacters.get(reference);
        if (!request) {
          request = this.runtime(
            workspace,
            characterId,
            `project_${token.replaceAll('-', '_')}_${runtimeCharacters.size}`,
          ).then((lease) => {
            if (closed) {
              this.releaseLease(lease);
              throw new Error('Scene preview closed.');
            }
            ownedLeases.add(lease);
            return lease.definition;
          });
          runtimeCharacters.set(reference, request);
        }
        return request;
      },
      bindCharacter: (capture, pending, navigate) => {
        failed = false;
        const entry = workspace.character(id);
        entry.capture = capture;
        entry.pending = pending;
        entry.loading = false;
        const host = this.owners.get(token)!;
        host.pending = pending;
        host.openView = navigate;
        workspace.refresh();
        return () => {
          delete entry.capture;
          delete entry.pending;
          entry.loading = false;
          delete host.pending;
          delete host.openView;
        };
      },
      navigate: () => {
        this.options.activate(undefined);
        workspace.refresh();
        // Scene stages cache textures by reference. Dispose this preview on return so later
        // character edits are reflected on its next opening; authored scene history is retained.
        if (kind === 'scene' || failed) {
          close();
          this.closers.delete(token);
          this.owners.delete(token);
          this.publish();
          // React removes the iframe and its Phaser consumers before releasing their URLs.
          setTimeout(() => {
            for (const lease of ownedLeases) {
              this.releaseLease(lease);
            }
            ownedLeases.clear();
          }, 0);
        }
      },
    };
    const url = new URL(`../${kind === 'scene' ? 'scene' : view}-editor/`, this.options.baseUrl);
    url.searchParams.set('projectSession', token);
    if (kind === 'character') {
      url.searchParams.set('character', id);
      workspace.character(id).loading = true;
    }
    const host: ProjectEditorHost = {
      token,
      session,
      asset: id,
      kind,
      src: url.href,
      context,
      guidePending: guide,
      guideId,
    };
    this.owners.set(token, host);
    this.closers.set(token, close);
    this.publish();
    this.options.activate(token);
  }
}
