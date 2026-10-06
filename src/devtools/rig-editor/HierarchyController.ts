import type { RigEditor } from './RigEditor.js';

/** Rebuilds only for new sessions and updates selection without replacing focused buttons. */
export function createHierarchyController(hierarchy: HTMLElement) {
  let lifetime = new AbortController();
  let disposed = false;
  let hierarchyEditor: RigEditor | undefined;
  const hierarchyButtons = new Map<string, HTMLButtonElement>();
  const hierarchyLevels = new Map<HTMLButtonElement, number>();
  let selectedHierarchyButton: HTMLButtonElement | undefined;
  function navigate(button: HTMLButtonElement, event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = [...hierarchyButtons.values()];
    const index = buttons.indexOf(button);
    let next = index;
    switch (event.key) {
      case 'ArrowUp':
        next = Math.max(0, index - 1);
        break;
      case 'ArrowDown':
        next = Math.min(buttons.length - 1, index + 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      case 'ArrowLeft':
        for (let previous = index - 1; previous >= 0; previous--) {
          if (hierarchyLevels.get(buttons[previous]!)! < hierarchyLevels.get(button)!) {
            next = previous;
            break;
          }
        }
        break;
      case 'ArrowRight':
        if (index + 1 < buttons.length && hierarchyLevels.get(buttons[index + 1]!)! > hierarchyLevels.get(button)!)
          next = index + 1;
        break;
      default:
        return;
    }
    // Consume hierarchy navigation before the window's authored joint shortcuts.
    event.preventDefault();
    if (next !== index) {
      buttons[next]!.focus({ preventScroll: true });
      buttons[next]!.click();
    }
  }
  function buildHierarchy(current: RigEditor): void {
    // Bind edits and history preserve topology; reloads create a new editor.
    if (hierarchyEditor === current) return;
    lifetime.abort();
    lifetime = new AbortController();
    hierarchyEditor = current;
    hierarchy.replaceChildren();
    hierarchyButtons.clear();
    hierarchyLevels.clear();
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
      button.tabIndex = hierarchyButtons.size === 0 ? 0 : -1;
      hierarchyLevels.set(button, level);
      button.addEventListener('keydown', (event) => navigate(button, event), { signal: lifetime.signal });
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
  }

  function updateHierarchySelection(current: RigEditor): void {
    const selection = current.state.selection;
    const selected = selection ? hierarchyButtons.get(`${selection.type}:${selection.id}`) : undefined;
    if (selected === selectedHierarchyButton) return;
    selectedHierarchyButton?.setAttribute('aria-selected', 'false');
    selected?.setAttribute('aria-selected', 'true');
    const first = hierarchyButtons.values().next().value;
    for (const button of hierarchyButtons.values()) button.tabIndex = button === (selected ?? first) ? 0 : -1;
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
      hierarchyLevels.clear();
      selectedHierarchyButton = undefined;
      hierarchy.replaceChildren();
    },
  };
}
