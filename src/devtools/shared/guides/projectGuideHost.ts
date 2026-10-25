import type { GuideLaunchHost } from './GuideLauncher.js';

/** Project presence is a live capability; tours never receive asset commands or playback owners. */
export function projectGuideHost(hasProject: () => boolean): GuideLaunchHost {
  return {
    getContext: () => ({ editor: 'project', capabilities: hasProject() ? ['tool:project'] : [] }),
    getNavigationAvailability: (editor) =>
      editor === 'project'
        ? { available: true }
        : { available: false, reason: 'Choose a project asset to open its editor guide.' },
    navigate: (editor) => editor === 'project',
  };
}
