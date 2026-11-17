import { createContext, useContext, type ReactNode } from 'react';
import type { ProjectEditorContext } from '../devtools/project/projectBridge.js';

const ProjectContext = createContext<ProjectEditorContext | undefined>(undefined);

/**
 * Supplies the project context an editor's main.tsx looked up once. Leave `value` undefined for a standalone
 * editor; every consumer then behaves as it does outside a project.
 */
export function ProjectContextProvider({
  value,
  children,
}: {
  value: ProjectEditorContext | undefined;
  children: ReactNode;
}) {
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

/** The embedding project's context, or undefined in a standalone editor. Narrow on `kind` for kind members. */
export function useProjectContext(): ProjectEditorContext | undefined {
  return useContext(ProjectContext);
}
