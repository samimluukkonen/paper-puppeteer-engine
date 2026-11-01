import type { AnimationClip } from '../../engine/AnimationClip.js';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { SceneEditorDocument, ReadonlyScene } from '../scene-editor/SceneEditorDocument.js';
import type { SceneImageRegistry } from '../scene-editor/SceneImageRegistry.js';
import type { AnimationLibraryEntry } from '../shared/animationLibraryData.js';
import type { AnimationPreviewLease } from '../shared/AnimationLibraryPreview.js';
import type { AnimationPreviewPreferences } from '../shared/animationPreviewPreferences.js';
import type { LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import type { PackageFiles } from '../shared/package/characterPackage.js';
import type { SceneReuseLibrary } from '../shared/sceneReuse.js';
import type { ProjectCharacterDocument } from './ProjectCharacterDocument.js';

export interface ProjectRenderer {
  activate(): void;
  suspend(): void;
  dispose(): void;
}

/** Same-origin renderer hosts borrow the project's single document owners. */
export interface ProjectEditorContext {
  readonly characterDocuments?: ProjectCharacterDocument;
  bindRenderer(renderer: ProjectRenderer): () => void;
  readonly autosave?: LocalAutosave;
  readonly projectId?: string;
  readonly projectName: string;
  readonly assetName: string;
  readonly sharedRigNotice?: string | undefined;
  subscribe: (listener: () => void) => () => void;
  bindGuide(open: (guideId?: string) => void): () => void;
  readonly characterId?: string;
  readonly definition?: CharacterDefinition;
  readonly sourceDefinition?: CharacterDefinition;
  readonly fetcher?: typeof fetch;
  readonly scenes?: SceneEditorDocument;
  readonly imageAssets?: SceneImageRegistry;
  readonly choices: readonly { id: string; label: string; manifest: string; rigIdentity?: string }[];
  readonly animationPreviewPreferences?: DeepReadonly<AnimationPreviewPreferences> | undefined;
  saveAnimationPreviewPreferences?(preferences: DeepReadonly<AnimationPreviewPreferences>): void;
  changed(): void;
  characterLoadFailed(): void;
  loadProjectImages?(
    this: void,
  ): Promise<readonly { id: string; name: string; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }[]>;
  loadCharacter(reference: string): Promise<CharacterDefinition>;
  bindScene(dispose: () => void): void;
  bindAnimationSelection?(select: (name: string, copy: boolean) => void): () => void;
  bindAnimationCreation?(create: (clip: AnimationClip) => boolean): () => void;
  openAnimation?(characterId: string, name: string, copy?: boolean): Promise<void>;
  animationLibrary?(): readonly AnimationLibraryEntry[];
  animationLibraryRevision?(this: void): number;
  loadAnimationPreview?(characterId: string, signal: AbortSignal): Promise<AnimationPreviewLease>;
  readonly sceneReuse?: DeepReadonly<SceneReuseLibrary>;
  saveSceneReuse?(input: unknown): void;
  createSceneCopy?(scene: ReadonlyScene): void;
  validateScene(scene: ReadonlyScene): void;
  buildScenePackage(scene: ReadonlyScene): Promise<PackageFiles>;
  confirmReplacement(kind: 'animation' | 'texture', id: string): boolean;
  assetReferences(kind: 'skin', id: string): readonly string[];
  bindCharacter(pending: () => boolean, navigate: (view: 'rig' | 'animation') => void): () => void;
  navigate(view: 'project' | 'rig' | 'animation'): void;
}

declare global {
  interface Window {
    paperProjectEditor?: (token: string) => ProjectEditorContext | undefined;
  }
}

export function projectEditorContext(): ProjectEditorContext | undefined {
  if (typeof window === 'undefined' || !window.parent || window.parent === window || !window.location) return undefined;
  const token = new URLSearchParams(window.location.search).get('projectSession');
  if (!token) return undefined;
  // A foreign embedding page has no authority to supply our document owner.
  try {
    if (window.parent.location.origin !== window.location.origin) return undefined;
    return window.parent.paperProjectEditor?.(token);
  } catch {
    return undefined;
  }
}
