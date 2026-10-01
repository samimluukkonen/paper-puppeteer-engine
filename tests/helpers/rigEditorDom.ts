import { vi } from 'vitest';

/** Minimal DOM adapter for exercising the editor panel's event handlers in Node. */
export class EditorElement {
  textContent = '';
  innerHTML = '';
  type = '';
  value = '';
  checked = false;
  disabled = false;
  style = {};
  dataset: Record<string, string> = {};
  files: { name: string; text: () => Promise<string> }[] = [];
  children: EditorElement[] = [];
  classList = { toggle: vi.fn() };
  setAttribute = vi.fn();
  setCustomValidity = vi.fn();
  reportValidity = vi.fn();
  private readonly listeners = new Map<string, ((event: { target: EditorElement }) => unknown)[]>();

  get childElementCount(): number {
    return this.children.length;
  }

  addEventListener(event: string, listener: (event: { target: EditorElement }) => unknown): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  async dispatch(event: string, target: EditorElement = this): Promise<void> {
    for (const listener of this.listeners.get(event) ?? []) await listener({ target });
  }

  click(): Promise<void> {
    return this.disabled ? Promise.resolve() : this.dispatch('click');
  }

  append(...children: (EditorElement | string)[]): void {
    this.children.push(...children.filter((child): child is EditorElement => typeof child !== 'string'));
  }

  replaceChildren(): void {
    this.children = [];
  }

  querySelectorAll(selector: string): EditorElement[] {
    return this.children.flatMap((child) => [
      ...(selector === 'input' && child.type === 'checkbox' ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  matches(selector: string): boolean {
    return selector === 'input[type="number"]' && this.type === 'number';
  }
}

export function stubRigEditorDom(): (selector: string) => EditorElement {
  const elements = new Map<string, EditorElement>();
  const querySelector = (selector: string): EditorElement => {
    if (!elements.has(selector)) elements.set(selector, new EditorElement());
    return elements.get(selector)!;
  };
  vi.stubGlobal('document', { querySelector, createElement: () => new EditorElement() });
  return querySelector;
}
