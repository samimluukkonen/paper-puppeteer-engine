import { useState } from 'react';
import type { AnimationClip } from '../../engine/data.js';
import { AnimationLibrary } from '../shared/AnimationLibrary.js';
import { animationAssetReference, type AnimationLibraryEntry } from '../shared/animationLibraryData.js';
import { AnimationLibraryPreview, type AnimationPreviewLease } from '../shared/AnimationLibraryPreviewDialog.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { buildCharacterPackage, openPackageRuntime } from '../shared/package/characterPackage.js';
import { AnimationRetargetDialog } from './AnimationRetargetDialog.js';
import { AnimationRetargetSession } from './AnimationRetargetSession.js';
import { characterFileFetcher } from './projectPackage.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

export function ProjectAnimationLibrary({
  workspace,
  busy,
  open,
  create,
}: {
  workspace: ProjectWorkspace;
  busy: boolean;
  open(this: void, character: string, animation: string, copy: boolean): void;
  create(this: void, target: string, clip: AnimationClip, targetRevision: string): Promise<void>;
}) {
  const [retarget, setRetarget] = useState<{ entry: AnimationLibraryEntry; session: AnimationRetargetSession }>();
  const [message, setMessage] = useState('');
  const chooseSource = (entry: AnimationLibraryEntry) => {
    try {
      setRetarget({ entry, session: new AnimationRetargetSession(workspace, entry) });
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
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
        targets={workspace.definition.characters.map(({ id, name }) => ({
          id,
          name,
          rigIdentity: workspace.rigOwner(id),
        }))}
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
        onRetarget={chooseSource}
      />
      {message && <p role="status">{message}</p>}
      {retarget && (
        <AnimationRetargetDialog
          key={animationAssetReference(retarget.entry)}
          workspace={workspace}
          entry={retarget.entry}
          session={retarget.session}
          changeSource={chooseSource}
          create={create}
          close={() => setRetarget(undefined)}
        />
      )}
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
