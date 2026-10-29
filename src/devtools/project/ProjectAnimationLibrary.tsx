import { useState } from 'react';
import { AnimationLibrary } from '../shared/AnimationLibrary.js';
import { AnimationLibraryPreview, type AnimationPreviewLease } from '../shared/AnimationLibraryPreviewDialog.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { buildCharacterPackage, openPackageRuntime } from '../shared/package/characterPackage.js';
import { characterFileFetcher } from './projectPackage.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

export function ProjectAnimationLibrary({
  workspace,
  busy,
  open,
}: {
  workspace: ProjectWorkspace;
  busy: boolean;
  open(this: void, character: string, animation: string, copy: boolean): void;
}) {
  const [preview, setPreview] = useState<{
    animation: string;
    load(this: void, signal: AbortSignal): Promise<AnimationPreviewLease>;
  }>();
  const entries = workspace.animationLibrary();
  const unavailable = workspace.definition.characters.filter(({ id }) => workspace.character(id).loading);
  return (
    <section className="project-panel" aria-label="Project animation library">
      <AnimationLibrary
        guideTarget={GUIDE_TARGETS.projectAnimationLibrary}
        entries={entries}
        targets={workspace.definition.characters.map(({ id, name }) => ({ id, name }))}
        disabled={busy}
        onPreview={(entry) => {
          // Capture the current authored snapshot before asynchronous image loading.
          const snapshot = workspace.captureCharacter(entry.character);
          const files = workspace.character(entry.character).files;
          setPreview({
            animation: entry.clip.name,
            load: async (signal) =>
              openPackageRuntime(await buildCharacterPackage(snapshot, characterFileFetcher(files), signal), signal),
          });
        }}
        onUse={(entry) => open(entry.character, entry.clip.name, false)}
        onLocate={(entry) => open(entry.character, entry.clip.name, false)}
        onCopy={(entry) => open(entry.character, entry.clip.name, true)}
      />
      {!!unavailable.length && (
        <ul>
          {unavailable.map(({ id, name }) => (
            <li key={id}>{name}: Character is opening. Wait for the editor to load.</li>
          ))}
        </ul>
      )}
      {preview && (
        <AnimationLibraryPreview
          animation={preview.animation}
          load={preview.load}
          close={() => setPreview(undefined)}
        />
      )}
    </section>
  );
}
