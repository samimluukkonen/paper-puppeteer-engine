import { GUIDE_TARGETS } from './anchors.js';
import { rigGuides } from './rigGuides.js';
import type { GuideDefinition } from './types.js';

/** The animation catalog is extended independently of the Rig Editor task guides. */
export const guideDefinitions: readonly GuideDefinition[] = [
  ...rigGuides,
  {
    id: 'animation-timeline-navigation',
    title: 'Timeline Navigation',
    description: 'Find timeline controls, animation tracks, and the current time.',
    editor: 'animation',
    category: 'animation',
    prerequisites: [
      { capability: 'character', reason: 'Load or create a character first.' },
      { capability: 'valid-rig', reason: 'A valid rig is needed to preview an animation.' },
      { capability: 'animation', reason: 'Create or select an animation first.' },
    ],
    steps: [
      {
        id: 'timeline',
        title: 'Find the timeline',
        description: 'The timeline groups playback, navigation, and track controls.',
        targetId: GUIDE_TARGETS.animationTimeline,
      },
      {
        id: 'tracks',
        title: 'Find animation tracks',
        description: 'Tracks show the animation’s keys in time.',
        targetId: GUIDE_TARGETS.animationTracks,
      },
      {
        id: 'current-time',
        title: 'Find the current time',
        description: 'The time field displays the preview position in seconds.',
        targetId: GUIDE_TARGETS.animationTime,
      },
    ],
  },
];
