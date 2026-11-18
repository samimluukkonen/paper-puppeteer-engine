/**
 * Node has no DOM, so editor controllers that check element types (`requireElement(root, id, HTMLInputElement)`)
 * would throw a ReferenceError against the fake DOMs the unit tests use. Where a constructor is missing, define a
 * stand-in that accepts any object; the real type checks run in the browser, and
 * `tests/editorElementIdContract.test.ts` checks each claimed type against the rendered markup.
 */
const EDITOR_ELEMENT_TYPES = [
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLDetailsElement',
  'HTMLDialogElement',
  'HTMLFieldSetElement',
  'HTMLFormElement',
  'HTMLInputElement',
  'HTMLOptionElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'SVGGElement',
  'SVGLineElement',
  'SVGSVGElement',
] as const;

for (const name of EDITOR_ELEMENT_TYPES) {
  if (name in globalThis) continue;
  const standIn = {
    [name]: class {
      static [Symbol.hasInstance](value: unknown): boolean {
        return typeof value === 'object' && value !== null;
      }
    },
  }[name]!;
  Object.defineProperty(globalThis, name, { value: standIn, configurable: true, writable: true });
}
