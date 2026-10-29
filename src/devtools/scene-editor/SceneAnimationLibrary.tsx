import { useState, useSyncExternalStore } from 'react';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { projectEditorContext } from '../project/projectBridge.js';
import { AnimationLibrary } from '../shared/AnimationLibrary.js';
import { existingAnimationReference } from '../shared/animationLibraryData.js';
import { AnimationLibraryPreview, type AnimationPreviewLease } from '../shared/AnimationLibraryPreviewDialog.js';

const noSubscribe = () => () => {};
const emptySnapshot = () => 0;

/** Applies only an existing clip ID. The caller retains timing, movement ownership and scene history. */
export function SceneAnimationLibrary({
  definition,
  manifest,
  onUse,
}: {
  definition: CharacterDefinition;
  manifest: string;
  onUse(this: void, name: string): void;
}) {
  const project = projectEditorContext();
  useSyncExternalStore(project?.subscribe ?? noSubscribe, project?.animationLibraryRevision ?? emptySnapshot);
  const targetRig = project?.choices.find((choice) => choice.manifest === manifest)?.id ?? manifest;
  const entries =
    project?.animationLibrary?.() ??
    definition.animations.map((clip) => ({
      character: manifest,
      characterName: definition.id,
      rigIdentity: targetRig,
      clip,
    }));
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{
    animation: string;
    load(this: void, signal: AbortSignal): Promise<AnimationPreviewLease>;
  }>();
  return (
    <>
      <AnimationLibrary
        entries={entries}
        targetRig={targetRig}
        onUse={(entry) => {
          try {
            const name = existingAnimationReference(entry, targetRig);
            if (!definition.animations.some((clip) => clip.name === name))
              throw new Error(
                'The source character has changed. Return to Project and reopen this scene to load the latest animations.',
              );
            onUse(name);
            setMessage(`Using existing animation ${name}. Source identity and scene timing are preserved.`);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
          }
        }}
        onPreview={(entry) =>
          setPreview({
            animation: entry.clip.name,
            load: project?.loadAnimationPreview
              ? (signal) => project.loadAnimationPreview!(entry.character, signal)
              : async () => ({ definition, dispose() {} }),
          })
        }
        onLocate={
          project?.openAnimation
            ? (entry) => {
                void project.openAnimation!(entry.character, entry.clip.name).catch((error: unknown) =>
                  setMessage(String(error)),
                );
              }
            : undefined
        }
        onCopy={
          project?.openAnimation
            ? (entry) => {
                void project.openAnimation!(entry.character, entry.clip.name, true).catch((error: unknown) =>
                  setMessage(String(error)),
                );
              }
            : undefined
        }
      />
      {message && <p role="status">{message}</p>}
      {preview && (
        <AnimationLibraryPreview
          animation={preview.animation}
          load={preview.load}
          close={() => setPreview(undefined)}
        />
      )}
    </>
  );
}
