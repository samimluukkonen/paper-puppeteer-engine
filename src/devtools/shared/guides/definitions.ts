import { GUIDE_TARGETS } from './anchors.js';
import type { GuideDefinition } from './types.js';

/** Small architecture examples; the complete feature catalog belongs to later guide-content milestones. */
export const guideDefinitions: readonly GuideDefinition[] = [
  {
    id: 'rig-joint-editing',
    title: 'Editing Joint Positions',
    description: 'Find the hierarchy, joint properties, and rig preview.',
    editor: 'rig',
    category: 'rigging',
    prerequisites: [
      { capability: 'character', reason: 'Load or create a character first.' },
      { capability: 'valid-rig', reason: 'A valid rig is needed to inspect joint positions.' },
    ],
    steps: [
      {
        id: 'hierarchy',
        title: 'Find the bone hierarchy',
        description: 'The hierarchy lists the bones and their parent relationships.',
        targetId: GUIDE_TARGETS.rigHierarchy,
        preparation: 'reveal-target',
      },
      {
        id: 'joint-properties',
        title: 'Find joint properties',
        description: 'Selection details shows the selected bone’s local joint values.',
        targetId: GUIDE_TARGETS.rigSelection,
        preparation: 'reveal-target',
      },
      {
        id: 'preview',
        title: 'Find the rig preview',
        description: 'The canvas shows the skeleton and artwork together.',
        targetId: GUIDE_TARGETS.rigCanvas,
      },
    ],
  },
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
