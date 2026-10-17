import { freezeData } from '../editorData.js';
import { guideDefinitions } from './definitions.js';
import type { GuideAvailability, GuideContext, GuideDefinition, GuideEditor, GuideStep } from './types.js';

export function getGuideAvailability(
  guide: GuideDefinition,
  context: GuideContext,
  step?: GuideStep,
): GuideAvailability {
  const missing = [...(guide.prerequisites ?? []), ...(step?.prerequisites ?? [])].find(
    ({ capability }) => !context.capabilities.includes(capability),
  );
  return missing ? { available: false, reason: missing.reason } : { available: true };
}

/** Own immutable copies, so neither consumers nor later edits to input data can corrupt a running guide. */
export class GuideRegistry {
  private readonly guides: readonly GuideDefinition[];
  private readonly byId: ReadonlyMap<string, GuideDefinition>;

  constructor(definitions: readonly GuideDefinition[]) {
    const byId = new Map<string, GuideDefinition>();
    for (const definition of definitions) {
      if (!definition.id.trim() || byId.has(definition.id))
        throw new Error(`Invalid or duplicate guide ID: ${definition.id}`);
      if (!definition.steps.length) throw new Error(`Guide ${definition.id} has no steps.`);
      const stepIds = new Set<string>();
      for (const step of definition.steps) {
        if (!step.id.trim() || stepIds.has(step.id))
          throw new Error(`Invalid or duplicate step ID in ${definition.id}: ${step.id}`);
        if (!step.targetId.trim()) throw new Error(`Step ${definition.id}/${step.id} has no target.`);
        if (step.mode === 'try-it' && (!step.practice.targetId.trim() || !step.practice.instruction.trim()))
          throw new Error(`Step ${definition.id}/${step.id} has incomplete practice instructions or target.`);
        stepIds.add(step.id);
      }
      const guide = freezeData(structuredClone(definition));
      byId.set(guide.id, guide);
    }
    this.byId = byId;
    this.guides = Object.freeze([...byId.values()]);
  }

  getAllGuides(): readonly GuideDefinition[] {
    return this.guides;
  }

  getGuidesForEditor(editor: GuideEditor): readonly GuideDefinition[] {
    return Object.freeze(this.guides.filter((guide) => guide.editor === editor));
  }

  getGuideById(id: string): GuideDefinition | undefined {
    return this.byId.get(id);
  }

  getGuideStep(guideId: string, stepId: string): GuideStep | undefined {
    return this.byId.get(guideId)?.steps.find((step) => step.id === stepId);
  }
}

export const guideRegistry = new GuideRegistry(guideDefinitions);
export const getAllGuides = (): readonly GuideDefinition[] => guideRegistry.getAllGuides();
export const getGuidesForEditor = (editor: GuideEditor): readonly GuideDefinition[] =>
  guideRegistry.getGuidesForEditor(editor);
export const getGuideById = (id: string): GuideDefinition | undefined => guideRegistry.getGuideById(id);
