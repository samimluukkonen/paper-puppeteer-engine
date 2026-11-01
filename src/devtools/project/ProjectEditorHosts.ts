import type { AnimationClip } from '../../engine/AnimationClip.js';
import { characterManifestSchema } from '../../engine/CharacterDefinition.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { inspectImageHeader } from '../../engine/imageHeader.js';
import { throwNotificationErrors } from '../../engine/notifications.js';
import { rigCompatibilityRevision } from '../../engine/rigBoneMapping.js';
import { parseSceneJson } from '../../engine/SceneDefinition.js';
import type { LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import { buildCharacterPackage, openPackageRuntime, packageJson } from '../shared/package/characterPackage.js';
import type { ProjectEditorContext, ProjectRenderer } from './projectBridge.js';
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
  active: boolean;
  renderer?: ProjectRenderer;
  pending?: () => boolean;
  openView?: (view: 'rig' | 'animation') => void;
  openGuide?: (guideId?: string) => void;
  guideId?: string | undefined;
  guidePending?: boolean;
  animationRequest?: { name: string; copy: boolean } | undefined;
  selectAnimation?: (name: string, copy: boolean) => void;
  createAnimation?: (clip: AnimationClip) => boolean;
  pendingCreation?: { run(): void; reject(error: Error): void };
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
  static readonly rendererLimit = 2;
  private readonly owners = new Map<string, ProjectEditorHost>();
  private readonly leases = new Set<RuntimeLease>();
  private readonly closers = new Map<string, () => void>();
  private readonly lifetime = new AbortController();
  private readonly pendingOpenings = new Map<ProjectSession, Map<string, Promise<void>>>();
  private opening: Promise<void> = Promise.resolve();

  constructor(private readonly options: ProjectEditorHostOptions) {}

  readonly resolve = (token: string): ProjectEditorContext | undefined => this.owners.get(token)?.context;

  private publish(): void {
    this.options.changed([...this.owners.values()]);
  }

  private releaseLease(lease: RuntimeLease): void {
    if (this.leases.delete(lease)) lease.dispose();
  }

  private activateHost(token: string | undefined): void {
    for (const host of this.owners.values()) {
      const active = host.token === token;
      if (host.active === active) continue;
      host.active = active;
      if (active) host.renderer?.activate();
      else host.renderer?.suspend();
    }
    const host = token && this.owners.get(token);
    if (host) {
      // Map insertion order is the renderer cache's least-recently-used order.
      this.owners.delete(host.token);
      this.owners.set(host.token, host);
    }
    this.options.activate(token);
  }

  private evict(token: string): void {
    const close = this.closers.get(token);
    try {
      close?.();
    } finally {
      this.closers.delete(token);
      this.owners.delete(token);
      this.publish();
    }
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

  private async runtime(
    workspace: ProjectWorkspace,
    id: string,
    namespace?: string,
    signal = this.lifetime.signal,
    source = false,
  ): Promise<RuntimeLease> {
    const files = source
      ? workspace.character(id).files
      : await buildCharacterPackage(
          workspace.captureCharacter(id),
          characterFileFetcher(workspace.character(id).files),
          signal,
        );
    const lease = await openPackageRuntime(files, signal, namespace);
    if (signal.aborted) {
      lease.dispose();
      signal.throwIfAborted();
    }
    this.leases.add(lease);
    return lease;
  }

  /** Wait for the existing editor owner; never maintain a second writable animation registry. */
  async createAnimation(
    session: ProjectSession,
    id: string,
    clip: AnimationClip,
    targetRevision: string,
  ): Promise<void> {
    id = session.workspace.rigOwner(id);
    await this.open(session, 'character', id, 'animation');
    const host = [...this.owners.values()].find(
      (entry) => entry.session === session && entry.kind === 'character' && entry.asset === id,
    );
    if (!host) throw new Error('Target editor is unavailable. Return to Project and retry.');
    if (host.pendingCreation) throw new Error('An animation is already being created.');
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error): void => {
          clearTimeout(timer);
          delete host.pendingCreation;
          if (error) reject(error);
          else resolve();
        };
        const timer = setTimeout(
          () => finish(new Error('Target editor did not become ready. Return to Project and retry.')),
          30_000,
        );
        host.pendingCreation = {
          reject: finish,
          run: () => {
            try {
              if (host.pending?.()) throw new Error('Commit or cancel temporary target edits first.');
              if (rigCompatibilityRevision(session.workspace.rigSource(id).rig) !== targetRevision)
                throw new Error('Target rig changed. Review the mapping and preview again.');
              if (!host.createAnimation?.(structuredClone(clip)))
                throw new Error('Could not create animation. Check target editor validation, then preview again.');
              session.workspace.refresh();
              finish();
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
            }
          },
        };
        if (host.createAnimation) host.pendingCreation.run();
      });
    } catch (error) {
      if (session.workspace.character(id).loading) host.context.characterLoadFailed();
      host.context.navigate('project');
      throw error;
    }
  }
  open(
    session: ProjectSession,
    kind: 'character' | 'scene',
    id: string,
    view: 'rig' | 'animation' = 'rig',
    guide = false,
    guideId?: string,
    animationRequest?: { name: string; copy: boolean },
  ): Promise<void> {
    if (kind === 'character') id = session.workspace.rigOwner(id);
    let pending = this.pendingOpenings.get(session);
    if (!pending) {
      pending = new Map();
      this.pendingOpenings.set(session, pending);
    }
    const key = JSON.stringify([kind, id]);
    const existing = pending.get(key);
    const opening = this.opening
      .catch(() => {})
      .then(async () => {
        // Share preparation failures, but preserve request ordering for activation and navigation.
        await existing;
        await this.openHost(session, kind, id, view, guide, guideId, animationRequest);
      })
      .finally(() => {
        if (pending.get(key) === opening) {
          pending.delete(key);
          if (!pending.size) this.pendingOpenings.delete(session);
        }
      });
    pending.set(key, opening);
    this.opening = opening;
    return opening;
  }

  private async openHost(
    session: ProjectSession,
    kind: 'character' | 'scene',
    id: string,
    view: 'rig' | 'animation',
    guide: boolean,
    guideId?: string,
    animationRequest?: { name: string; copy: boolean },
  ): Promise<void> {
    this.lifetime.signal.throwIfAborted();
    const workspace = session.workspace;
    let existing = [...this.owners.values()].find(
      (host) => host.session === session && host.kind === kind && host.asset === id,
    );
    if (existing && kind === 'character' && existing.context.characterDocuments !== workspace.character(id).documents) {
      this.evict(existing.token);
      existing = undefined;
    }
    if (existing) {
      existing.openView?.(view);
      this.activateHost(existing.token);
      if (animationRequest) {
        if (existing.selectAnimation) existing.selectAnimation(animationRequest.name, animationRequest.copy);
        else existing.animationRequest = animationRequest;
      }
      if (guide) {
        if (existing.openGuide) existing.openGuide(guideId);
        else {
          existing.guidePending = true;
          existing.guideId = guideId;
        }
      }
      return;
    }
    if (this.owners.size >= ProjectEditorHosts.rendererLimit) {
      const candidate = [...this.owners.values()].find(
        (host) => !host.active && !host.pending?.() && !host.pendingCreation,
      );
      if (!candidate) throw new Error('Finish temporary edits in an open editor before opening another character.');
      this.evict(candidate.token);
    }
    const token = crypto.randomUUID();
    const lifetime = new AbortController();
    const signal = AbortSignal.any([this.lifetime.signal, lifetime.signal]);
    const ownedLeases = new Set<RuntimeLease>();
    let closed = false;
    let failed = false;
    let disposeScene: (() => void) | undefined;
    const character = kind === 'character' ? workspace.character(id) : undefined;
    const close = (): void => {
      if (closed) return;
      closed = true;
      lifetime.abort(new DOMException('Editor renderer closed.', 'AbortError'));
      this.owners.get(token)?.pendingCreation?.reject(new Error('Target editor closed before animation creation.'));
      if (character) character.loading = false;
      const dispose = disposeScene;
      disposeScene = undefined;
      const errors: unknown[] = [];
      for (const release of [
        () => this.owners.get(token)?.renderer?.dispose(),
        () => dispose?.(),
        ...[...ownedLeases].map((lease) => () => this.releaseLease(lease)),
      ]) {
        try {
          release();
        } catch (error) {
          errors.push(error);
        }
      }
      ownedLeases.clear();
      throwNotificationErrors(errors, 'Editor renderer disposal failed.');
    };
    const documents = kind === 'character' ? workspace.characterDocuments(id) : undefined;
    // The document owns edits and artwork overrides; this lease supplies only original source textures.
    const initialLease = kind === 'character' ? await this.runtime(workspace, id, undefined, signal, true) : undefined;
    if (initialLease) ownedLeases.add(initialLease);
    const definition = initialLease?.definition;
    if (kind === 'scene') workspace.scenes.selectScene(id);
    const choices = workspace.definition.characters.map((entry) => ({
      id: entry.id,
      rigIdentity: workspace.rigOwner(entry.id),
      label: entry.name,
      manifest: entry.manifest,
    }));
    // Scene runtime definitions are fresh on every opening. The document remains the same owner.
    const runtimeCharacters = new Map<string, Promise<CharacterDefinition>>();
    let lastAuthoredRevision = workspace.autosaveRevision;
    const context: ProjectEditorContext = {
      ...(documents ? { characterDocuments: documents } : {}),
      bindRenderer: (renderer) => {
        const host = this.owners.get(token);
        if (!host || closed) {
          renderer.dispose();
          return () => {};
        }
        host.renderer = renderer;
        if (host.active) renderer.activate();
        else renderer.suspend();
        return () => {
          if (host.renderer === renderer) delete host.renderer;
        };
      },
      autosave: session.autosave,
      projectId: workspace.definition.id,
      get projectName() {
        return workspace.definition.name;
      },
      get assetName() {
        return kind === 'character'
          ? (workspace.definition.characters.find((entry) => entry.id === id)?.name ?? id)
          : (workspace.scenes.scene(id)?.name ?? id);
      },
      get sharedRigNotice() {
        if (kind !== 'character' || !workspace.definition.characters.some((entry) => entry.id === id)) return undefined;
        const users = workspace.sharedRigUsers(id);
        return users.length > 1
          ? `Shared rig and animations: edits here affect ${users.join(', ')}. Return to Project and create an independent character copy for a different skeleton or private artwork.`
          : undefined;
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
      imageAssets: workspace.scenes.images,
      ...(kind === 'character'
        ? {
            get animationPreviewPreferences() {
              return workspace.animationPreviewPreferences(id);
            },
            saveAnimationPreviewPreferences: (preferences: unknown) =>
              workspace.setAnimationPreviewPreferences(id, preferences),
          }
        : {}),
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
        this.owners
          .get(token)
          ?.pendingCreation?.reject(new Error('Target character failed to load. Repair it and retry.'));
        workspace.refresh();
      },
      animationLibrary: () => workspace.animationLibrary(),
      animationLibraryRevision: workspace.getSnapshot,
      loadAnimationPreview: async (characterId, signal) =>
        openPackageRuntime(
          await buildCharacterPackage(
            workspace.captureCharacter(characterId),
            characterFileFetcher(workspace.character(characterId).files),
            signal,
          ),
          signal,
        ),
      openAnimation: (characterId, name, copy = false) => {
        // Reopen scenes after character editing so their runtime definitions include new variations.
        if (kind === 'scene') context.navigate('project');
        return this.open(session, 'character', characterId, 'animation', false, undefined, { name, copy });
      },
      bindAnimationSelection: (select) => {
        const host = this.owners.get(token)!;
        host.selectAnimation = select;
        if (host.animationRequest) {
          const request = host.animationRequest;
          host.animationRequest = undefined;
          select(request.name, request.copy);
        }
        return () => {
          delete host.selectAnimation;
        };
      },
      bindAnimationCreation: (create) => {
        const host = this.owners.get(token)!;
        host.createAnimation = create;
        host.pendingCreation?.run();
        return () => {
          delete host.createAnimation;
        };
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
          .filter(({ from }) => from.kind !== 'character' || from.owner !== id);
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
          .filter(({ from }) => from.kind === 'actor' || (from.kind === 'character' && from.owner !== id))
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
            signal,
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
      bindCharacter: (pending, navigate) => {
        failed = false;
        const entry = workspace.character(id);
        entry.pending = pending;
        entry.loading = false;
        const host = this.owners.get(token)!;
        host.pending = pending;
        host.openView = navigate;
        workspace.refresh();
        return () => {
          delete entry.pending;
          entry.loading = false;
          delete host.pending;
          delete host.openView;
        };
      },
      navigate: () => {
        if (closed) return;
        this.activateHost(undefined);
        workspace.refresh();
        // Scene stages cache textures by reference. Dispose this preview on return so later
        // character edits are reflected on its next opening; authored scene history is retained.
        if (kind === 'scene' || failed) {
          this.evict(token);
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
      active: false,
      guidePending: guide,
      guideId,
      animationRequest,
    };
    this.owners.set(token, host);
    this.closers.set(token, close);
    this.publish();
    this.activateHost(token);
  }
}
