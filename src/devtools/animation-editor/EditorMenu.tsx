import type { ReactNode } from 'react';

/** Native disclosure buttons retain Enter/Space and normal Tab navigation. */
export function EditorMenu({
  id,
  label,
  children,
  compact = false,
  guideTargetId,
}: {
  id: string;
  label: string;
  children: ReactNode;
  compact?: boolean;
  guideTargetId?: string;
}) {
  return (
    <details id={id} className="animation-menu" data-workspace-menu>
      <summary aria-label={label} title={compact ? label : undefined}>
        {compact ? (
          <>
            <span aria-hidden="true">⋯</span>
            <span className="editor-sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </summary>
      <div
        data-guide-id={guideTargetId}
        className="animation-menu-content"
        role="group"
        aria-label={`${label} commands`}
      >
        {children}
      </div>
    </details>
  );
}
