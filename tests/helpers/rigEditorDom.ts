import { setMaxListeners } from 'node:events';
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
  classList = { add: vi.fn(), toggle: vi.fn() };
  private readonly attributes = new Map<string, string>();
  setAttribute = vi.fn((name: string, value: string) => this.attributes.set(name, value));
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setCustomValidity = vi.fn();
  reportValidity = vi.fn();
  private readonly listeners = new Map<string, ((event: { target: EditorElement }) => unknown)[]>();

  get childElementCount(): number {
    return this.children.length;
  }

  addEventListener(
    event: string,
    listener: (event: { target: EditorElement }) => unknown,
    options?: AddEventListenerOptions,
  ): void {
    const signal = options?.signal;
    if (signal?.aborted) return;
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    if (signal) {
      // One controller can own many DOM listeners; browsers do not impose Node's listener warning limit.
      setMaxListeners(0, signal);
      signal.addEventListener(
        'abort',
        () => {
          this.listeners.set(
            event,
            (this.listeners.get(event) ?? []).filter((entry) => entry !== listener),
          );
        },
        { once: true },
      );
    }
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
  Object.assign(querySelector('#editor-app'), { querySelector });
  vi.stubGlobal('document', { querySelector, createElement: () => new EditorElement() });
  return querySelector;
}
