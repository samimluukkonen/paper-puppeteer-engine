import { animationGuides } from './animationGuides.js';
import { rigGuides } from './rigGuides.js';
import type { GuideDefinition } from './types.js';

export const guideDefinitions: readonly GuideDefinition[] = [...rigGuides, ...animationGuides];
