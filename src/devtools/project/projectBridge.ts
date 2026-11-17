import type { AnimationClip, CharacterDefinition, DeepReadonly } from '../../engine/data.js';
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

export interface ProjectImage {
  id: string;
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

/** Members every project-embedded editor and the shared view shell read. */
export interface ProjectHostContext {
  readonly projectId: string;
  readonly projectName: string;
  readonly assetName: string;
  readonly autosave: LocalAutosave;
  subscribe: (listener: () => void) => () => void;
  bindRenderer(renderer: ProjectRenderer): () => void;
  bindGuide(open: (guideId?: string) => void): () => void;
  navigate(view: 'project' | 'rig' | 'animation'): void;
  loadProjectImages(this: void): Promise<readonly ProjectImage[]>;
}

/** A rig or animation editor borrowing one project character's document owners. */
export interface CharacterEditorContext extends ProjectHostContext {
  readonly kind: 'character';
  readonly characterDocuments: ProjectCharacterDocument;
  readonly definition: CharacterDefinition;
  readonly sourceDefinition: CharacterDefinition;
  readonly fetcher: typeof fetch;
  readonly imageAssets: SceneImageRegistry;
  /** Undefined unless another character shares this rig. */
  readonly sharedRigNotice: string | undefined;
  /** Undefined until the character has saved preview preferences. */
  readonly animationPreviewPreferences: DeepReadonly<AnimationPreviewPreferences> | undefined;
  saveAnimationPreviewPreferences(preferences: DeepReadonly<AnimationPreviewPreferences>): void;
  changed(): void;
  characterLoadFailed(): void;
  confirmReplacement(kind: 'animation' | 'texture', id: string): boolean;
  bindCharacter(pending: () => boolean, navigate: (view: 'rig' | 'animation') => void): () => void;
  bindAnimationSelection(select: (name: string, copy: boolean) => void): () => void;
  bindAnimationCreation(create: (clip: AnimationClip) => boolean): () => void;
}

/** The scene editor borrowing the project's scene document. */
export interface SceneEditorContext extends ProjectHostContext {
  readonly kind: 'scene';
  readonly scenes: SceneEditorDocument;
  readonly choices: readonly { id: string; label: string; manifest: string; rigIdentity?: string }[];
  readonly sceneReuse: DeepReadonly<SceneReuseLibrary>;
  loadCharacter(reference: string): Promise<CharacterDefinition>;
  bindScene(dispose: () => void): void;
  saveSceneReuse(input: unknown): void;
  createSceneCopy(scene: ReadonlyScene): void;
  validateScene(scene: ReadonlyScene): void;
  buildScenePackage(scene: ReadonlyScene): Promise<PackageFiles>;
  animationLibrary(): readonly AnimationLibraryEntry[];
  animationLibraryRevision(this: void): number;
  loadAnimationPreview(characterId: string, signal: AbortSignal): Promise<AnimationPreviewLease>;
  openAnimation(characterId: string, name: string, copy?: boolean): Promise<void>;
}

/** Same-origin renderer hosts borrow the project's single document owners. */
export type ProjectEditorContext = CharacterEditorContext | SceneEditorContext;

declare global {
  interface Window {
    paperProjectEditor?: (token: string) => ProjectEditorContext | undefined;
  }
}

/**
 * The parent project's context for this frame, or undefined when standalone or embedded by a foreign origin.
 * Call it only from an editor's main.tsx and pass the result down (`npm run lint` enforces this).
 */
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

export function projectCharacterContext(): CharacterEditorContext | undefined {
  const context = projectEditorContext();
  return context?.kind === 'character' ? context : undefined;
}

export function projectSceneContext(): SceneEditorContext | undefined {
  const context = projectEditorContext();
  return context?.kind === 'scene' ? context : undefined;
}
