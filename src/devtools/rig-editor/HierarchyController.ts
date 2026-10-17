import { type HierarchyEntry, navigateHierarchy, setHierarchyTabStop } from '../shared/hierarchyNavigation.js';
import type { RigEditor } from './RigEditor.js';

/** Rebuilds only for new sessions and updates selection without replacing focused buttons. */
export function createHierarchyController(hierarchy: HTMLElement) {
  let lifetime = new AbortController();
  let disposed = false;
  let hierarchyEditor: RigEditor | undefined;
  let hierarchyRig: RigEditor['state']['rig'] | undefined;
  const hierarchyButtons = new Map<string, HTMLButtonElement>();
  const hierarchyEntries: HierarchyEntry[] = [];
  let selectedHierarchyButton: HTMLButtonElement | undefined;
  function buildHierarchy(current: RigEditor): void {
    if (hierarchyEditor === current && hierarchyRig === current.state.rig) return;
    hierarchyRig = current.state.rig;
    lifetime.abort();
    lifetime = new AbortController();
    hierarchyEditor = current;
    hierarchy.replaceChildren();
    hierarchyButtons.clear();
    hierarchyEntries.length = 0;
    selectedHierarchyButton = undefined;
    const { state } = current;
    const appendEntry = (type: 'bone' | 'slot', id: string, depth: number): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = type === 'bone' ? 'tree-entry' : 'tree-entry slot-entry';
      button.style.paddingLeft = `${(type === 'bone' ? 10 : 26) + depth * 16}px`;
      button.textContent = type === 'bone' ? id : `◇ ${id}`;
      button.setAttribute('role', 'treeitem');
      button.setAttribute('aria-selected', 'false');
      const level = depth + (type === 'slot' ? 2 : 1);
      button.setAttribute('aria-level', String(level));
      hierarchyEntries.push({ button, level });
      button.addEventListener('keydown', (event) => navigateHierarchy(event, button, hierarchyEntries), {
        signal: lifetime.signal,
      });
      button.addEventListener(
        'click',
        () => {
          if (type === 'bone' && state.selection?.type === 'bone' && state.selection.id === id) state.clearSelection();
          else if (type === 'bone') state.selectBone(id);
          else state.selectSlot(id);
          current.refresh();
        },
        { signal: lifetime.signal },
      );
      hierarchy.append(button);
      hierarchyButtons.set(`${type}:${id}`, button);
    };
    const slotsByBone = new Map<string, string[]>();
    for (const slot of state.rig.slots) {
      const slots = slotsByBone.get(slot.bone) ?? [];
      slots.push(slot.id);
      slotsByBone.set(slot.bone, slots);
    }
    for (const { id, depth } of state.hierarchy()) {
      appendEntry('bone', id, depth);
      for (const slot of slotsByBone.get(id) ?? []) appendEntry('slot', slot, depth);
    }
    setHierarchyTabStop(hierarchyEntries);
  }

  function updateHierarchySelection(current: RigEditor): void {
    const selection = current.state.selection;
    const selected = selection ? hierarchyButtons.get(`${selection.type}:${selection.id}`) : undefined;
    if (selected === selectedHierarchyButton) return;
    selectedHierarchyButton?.setAttribute('aria-selected', 'false');
    selected?.setAttribute('aria-selected', 'true');
    setHierarchyTabStop(hierarchyEntries, selected);
    selectedHierarchyButton = selected;
  }

  return {
    render(current: RigEditor): void {
      if (disposed) return;
      buildHierarchy(current);
      updateHierarchySelection(current);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      hierarchyEditor = undefined;
      hierarchyRig = undefined;
      hierarchyButtons.clear();
      hierarchyEntries.length = 0;
      selectedHierarchyButton = undefined;
      hierarchy.replaceChildren();
    },
  };
}
