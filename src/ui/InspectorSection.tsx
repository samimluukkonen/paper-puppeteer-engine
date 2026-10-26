import type { ReactNode } from 'react';

/** Reuse inspector content in a tab without nesting a second disclosure. */
export function InspectorSection({
  embedded = false,
  defaultOpen = false,
  className,
  id,
  summary,
  children,
}: {
  embedded?: boolean;
  defaultOpen?: boolean;
  className: string;
  id?: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  return embedded ? (
    <div id={id} className={className}>
      {children}
    </div>
  ) : (
    <details id={id} className={className} open={defaultOpen || undefined}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
