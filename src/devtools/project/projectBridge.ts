import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { SceneEditorDocument, ReadonlyScene } from '../scene-editor/SceneEditorDocument.js';
import type { SceneImageRegistry } from '../scene-editor/SceneImageRegistry.js';
import type { AnimationPreviewPreferences } from '../shared/animationPreviewPreferences.js';
import type { LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import type { PackageSnapshot, PackageFiles } from '../shared/package/characterPackage.js';

/** Same-origin retained editor hosts reuse the existing applications and their single owners. */
export interface ProjectEditorContext {
  readonly autosave?: LocalAutosave;
  readonly projectId?: string;
  readonly projectName: string;
  readonly assetName: string;
  subscribe: (listener: () => void) => () => void;
  bindGuide(open: (guideId?: string) => void): () => void;
  readonly characterId?: string;
  readonly definition?: CharacterDefinition;
  readonly sourceDefinition?: CharacterDefinition;
  readonly fetcher?: typeof fetch;
  readonly scenes?: SceneEditorDocument;
  readonly imageAssets?: SceneImageRegistry;
  readonly choices: readonly { id: string; label: string; manifest: string }[];
  readonly animationPreviewPreferences?: DeepReadonly<AnimationPreviewPreferences> | undefined;
  saveAnimationPreviewPreferences?(preferences: DeepReadonly<AnimationPreviewPreferences>): void;
  changed(): void;
  characterLoadFailed(): void;
  loadProjectImages?(
    this: void,
  ): Promise<readonly { id: string; name: string; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }[]>;
  loadCharacter(reference: string): Promise<CharacterDefinition>;
  bindScene(dispose: () => void): void;
  validateScene(scene: ReadonlyScene): void;
  buildScenePackage(scene: ReadonlyScene): Promise<PackageFiles>;
  confirmReplacement(kind: 'animation' | 'texture', id: string): boolean;
  assetReferences(kind: 'skin', id: string): readonly string[];
  bindCharacter(
    capture: () => PackageSnapshot,
    pending: () => boolean,
    navigate: (view: 'rig' | 'animation') => void,
  ): () => void;
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
