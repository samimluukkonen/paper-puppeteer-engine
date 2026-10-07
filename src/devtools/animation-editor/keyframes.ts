/** Compatibility entry point. Editor modules import queries, edits, and sampling directly. */
export { KEYFRAME_TIME_TOLERANCE_MS, keyframeTimesMatch } from './keyframeTargets.js';
export {
  getAuthoredBoneProperties,
  findBonePropertyKeyframe,
  hasKeyframeAtTime,
  findAdjacentBonePropertyKeyframe,
  getKeyedPropertiesAtTime,
} from './keyframeQueries.js';
export {
  setBonePropertyKeyframe,
  removeBonePropertyKeyframe,
  type PropertyKeyframeTarget,
  type PropertyKeyframeEdit,
  setBonePropertyKeyframes,
  removeBonePropertyKeyframes,
  moveBonePropertyKeyframe,
  constrainKeyframeMoveDelta,
  type PropertyKeyframeMove,
  moveBonePropertyKeyframes,
} from './keyframeEdits.js';
export { getEvaluatedBoneTransform, getEvaluatedBonePropertyValue } from './animationValues.js';
