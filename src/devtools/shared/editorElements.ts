/** A DOM element constructor such as `HTMLInputElement`, used to check what an editor id refers to. */
export type EditorElementType<T extends Element> = abstract new () => T;

/**
 * Finds the element with `id` under `root` and checks its type.
 * Throws naming the id, so a renamed or missing element fails where it is looked up.
 */
export function requireElement<T extends Element>(root: ParentNode, id: string, type: EditorElementType<T>): T {
  const element = optionalElement(root, id, type);
  if (!element) throw new Error(`Missing editor element #${id}`);
  return element;
}

/**
 * Like {@link requireElement}, but returns null when the element is absent.
 * Use only where the element is legitimately conditional, and say why at the call site.
 */
export function optionalElement<T extends Element>(root: ParentNode, id: string, type: EditorElementType<T>): T | null {
  const element: unknown = root.querySelector(`#${id}`);
  if (element === null) return null;
  if (!(element instanceof type)) throw new Error(`Editor element #${id} is not a ${type.name}`);
  return element;
}
