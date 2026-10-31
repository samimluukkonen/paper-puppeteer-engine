import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronUp from 'lucide-react/icons/chevron-up';
import FolderOpen from 'lucide-react/icons/folder-open';
import HardDrive from 'lucide-react/icons/hard-drive';
import Package from 'lucide-react/icons/package';
import PencilLine from 'lucide-react/icons/pencil-line';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface EditorTab {
  id: string;
  label: string;
  icon?: 'edit' | 'package' | 'draft' | 'project';
  content: ReactNode;
  /** Hide mode-specific tabs while retaining their controller hosts and drafts. */
  hidden?: boolean;
}

const icons = { edit: PencilLine, package: Package, draft: HardDrive, project: FolderOpen };

/** View-only chrome. Keep every panel mounted so native controller bindings and drafts survive tab changes. */
export function EditorTabs({
  label,
  tabs,
  defaultExpanded = true,
  controlsLabel = 'editor controls',
  wrap = false,
  toolbar,
}: {
  label: string;
  tabs: readonly EditorTab[];
  defaultExpanded?: boolean;
  controlsLabel?: string;
  wrap?: boolean;
  /** Persistent controls beside the tabs, including while panels are collapsed. */
  toolbar?: ReactNode;
}) {
  const visibleTabs = tabs.filter((tab) => !tab.hidden);
  const [selected, setActive] = useState(tabs[0]!.id);
  const active = visibleTabs.some((tab) => tab.id === selected) ? selected : visibleTabs[0]!.id;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const reveal = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!tabs.some((tab) => tab.id === id && !tab.hidden)) return;
      setActive(id);
      setExpanded(true);
    };
    element.addEventListener('workspace:reveal-tab', reveal);
    return () => element.removeEventListener('workspace:reveal-tab', reveal);
  }, [tabs]);
  const select = (id: string) => {
    setActive(id);
    setExpanded(true);
  };
  return (
    <div ref={root} className={`editor-tabs${wrap ? ' editor-tabs-wrap' : ''}`}>
      <div className={`editor-tabs-heading${toolbar ? ' editor-tabs-heading-with-toolbar' : ''}`}>
        <div role="tablist" aria-label={label} aria-orientation="horizontal">
          {visibleTabs.map((tab, index) => {
            const Icon = tab.icon ? icons[tab.icon] : undefined;
            return (
              <button
                key={tab.id}
                id={`${tab.id}-tab`}
                type="button"
                role="tab"
                aria-selected={active === tab.id}
                aria-controls={`${tab.id}-panel`}
                tabIndex={active === tab.id ? 0 : -1}
                onClick={() => select(tab.id)}
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % visibleTabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + visibleTabs.length - 1) % visibleTabs.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? visibleTabs.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  select(visibleTabs[next]!.id);
                  root.current?.querySelector<HTMLButtonElement>(`[id="${visibleTabs[next]!.id}-tab"]`)?.focus();
                }}
              >
                {Icon && <Icon size={14} aria-hidden="true" />}
                {tab.label}
              </button>
            );
          })}
        </div>
        {toolbar}
        <button
          type="button"
          className="editor-tabs-collapse"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${controlsLabel}`}
          aria-expanded={expanded}
          aria-controls={`${active}-panel`}
          title={`${expanded ? 'Collapse' : 'Expand'} ${controlsLabel}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${tab.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${tab.id}-tab`}
          data-editor-tab-panel={tab.id}
          hidden={tab.hidden || !expanded || active !== tab.id}
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
