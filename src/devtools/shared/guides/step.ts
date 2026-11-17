import type { GuideStep } from './types.js';

/** Named fields, so a swapped description and target cannot compile. Steps reveal their target by default. */
export const guideStep = (step: GuideStep): GuideStep => ({ preparation: 'reveal-target', ...step });
