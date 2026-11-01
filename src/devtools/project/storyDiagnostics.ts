import type { DeepReadonly } from '../../engine/readonlyData.js';
import type { StoryDefinition } from '../../engine/StoryDefinition.js';
import type { AssetReference, ProjectDiagnostic, ProjectInspection } from './projectInspection.js';

const key = ({ kind, owner, id }: AssetReference): string => JSON.stringify([kind, owner, id]);

/** Keep the source scene attached to transitive character/audio diagnostics for repair navigation. */
export function storyDiagnostics(report: ProjectInspection, story: DeepReadonly<StoryDefinition>) {
  const sources = new Map<string, string>();
  const outgoing = new Map<string, AssetReference[]>();
  for (const edge of report.dependencies) {
    const id = key(edge.from);
    const targets = outgoing.get(id) ?? [];
    targets.push(edge.to);
    outgoing.set(id, targets);
  }
  for (const sceneAssetId of new Set(story.scenes.map(({ sceneAssetId }) => sceneAssetId))) {
    const queue: AssetReference[] = [{ kind: 'scene', owner: sceneAssetId, id: sceneAssetId }];
    const visited = new Set<string>();
    while (queue.length) {
      const current = key(queue.pop()!);
      if (visited.has(current)) continue;
      visited.add(current);
      if (!sources.has(current)) sources.set(current, sceneAssetId);
      queue.push(...(outgoing.get(current) ?? []));
    }
  }
  const result: { issue: ProjectDiagnostic; sceneId?: string }[] = [];
  for (const issue of report.issues) {
    const sceneId = sources.get(key(issue.asset));
    if (sceneId) result.push({ issue, sceneId });
    else if (issue.asset.kind === 'story' && issue.asset.id === story.id && issue.path !== 'scenes') {
      const entry = story.scenes[Number(/scenes\[(\d+)\]/.exec(issue.path)?.[1])];
      result.push({ issue, ...(entry ? { sceneId: entry.sceneAssetId } : {}) });
    } else if (issue.asset.kind === 'story' && issue.asset.id === story.id && !story.scenes.length)
      result.push({ issue });
  }
  return result;
}
