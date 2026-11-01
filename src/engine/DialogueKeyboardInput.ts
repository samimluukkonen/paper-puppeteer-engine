import { isTypingTarget } from './keyboardTarget.js';

export interface DialogueKeyboardOptions {
  /** KeyboardEvent.key values; defaults to Enter. Space is ' '. */
  readonly keys?: readonly string[];
  readonly waiting: () => boolean;
  readonly advanceDialogue: () => void;
}

/** Focus-scoped input adapter. It owns no clock, transport commands or global listeners. */
export class DialogueKeyboardInput {
  private readonly keys: ReadonlySet<string>;
  private disposed = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly options: DialogueKeyboardOptions,
  ) {
    this.keys = new Set(options.keys ?? ['Enter']);
    target.addEventListener('keydown', this.keydown);
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    const element = event.target as Element | null;
    if (
      this.disposed ||
      !this.keys.has(event.key) ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      this.target.closest('[hidden], [inert]') ||
      !this.target.contains(this.target.ownerDocument.activeElement) ||
      isTypingTarget(event.target) ||
      element?.closest('button, a[href], summary, [role="button"]') ||
      !this.options.waiting()
    )
      return;
    event.preventDefault();
    if (!event.repeat) this.options.advanceDialogue();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('keydown', this.keydown);
  }
}
