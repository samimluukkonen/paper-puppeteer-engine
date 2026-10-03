import type { RigEditor } from './RigEditor.js';

/** Rebuilds only for new sessions and updates selection without replacing focused buttons. */
export function createHierarchyController(hierarchy: HTMLElement) {
  let lifetime = new AbortController();
  let disposed = false;
  let hierarchyEditor: RigEditor | undefined;
  const hierarchyButtons = new Map<string, HTMLButtonElement>();
  let selectedHierarchyButton: HTMLButtonElement | undefined;
  function buildHierarchy(current: RigEditor): void {
    // Bind edits and history preserve topology; reloads create a new editor.
    if (hierarchyEditor === current) return;
    lifetime.abort();
    lifetime = new AbortController();
    hierarchyEditor = current;
    hierarchy.replaceChildren();
    hierarchyButtons.clear();
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
      button.addEventListener(
        'click',
        () => {
          if (type === 'bone') state.selectBone(id);
          else state.selectSlot(id);
          current.refresh();
        },
        { signal: lifetime.signal },
      );
      hierarchy.append(button);
      hierarchyButtons.set(`${type}:${id}`, button);
    };
    for (const { id, depth } of state.hierarchy()) {
      appendEntry('bone', id, depth);
      for (const slot of state.rig.slots.filter((item) => item.bone === id)) appendEntry('slot', slot.id, depth);
    }
  }

  function updateHierarchySelection(current: RigEditor): void {
    const selection = current.state.selection;
    const selected = selection ? hierarchyButtons.get(`${selection.type}:${selection.id}`) : undefined;
    if (selected === selectedHierarchyButton) return;
    selectedHierarchyButton?.setAttribute('aria-selected', 'false');
    selected?.setAttribute('aria-selected', 'true');
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
      hierarchyButtons.clear();
      selectedHierarchyButton = undefined;
      hierarchy.replaceChildren();
    },
  };
}
