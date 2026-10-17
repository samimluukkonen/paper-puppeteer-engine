export { GUIDE_TARGETS } from './anchors.js';
export { GuideController, type GuideSnapshot } from './GuideController.js';
export { GuideTargets, type GuideGeometryProvider } from './GuideTargets.js';
export {
  getAllGuides,
  getGuideAvailability,
  getGuideById,
  getGuidesForEditor,
  GuideRegistry,
  guideRegistry,
} from './registry.js';
export type {
  GuideAvailability,
  GuideCapability,
  GuideCategory,
  GuideCommandResult,
  GuideContext,
  GuideDefinition,
  GuideEditor,
  GuidePrerequisite,
  GuideRectangle,
  GuideStep,
  GuideTargetId,
  GuideTargetResolver,
} from './types.js';
