import type { ReactNode } from 'react';

/** Checkpoints describe application knowledge, never claim that a file was overwritten. */
export function EditorContext({
  project,
  editor,
  document,
  modified,
  ready = true,
  children,
}: {
  project?: string;
  editor: string;
  document: ReactNode;
  modified: readonly string[];
  ready?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="editor-context workspace-caption" aria-label="Editor context">
      <span>Project: {project ?? 'Standalone workspace'}</span>
      <span>Editor: {editor}</span>
      <span>{document}</span>
      <span>
        {!ready
          ? 'No document selected'
          : modified.length
            ? `Unsaved changes: ${modified.join(', ')}`
            : 'Matches loaded / exported checkpoint'}
      </span>
      {children}
    </section>
  );
}
