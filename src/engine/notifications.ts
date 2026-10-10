/** Finish one stable subscriber snapshot, collecting failures for the caller's notification boundary. */
export function dispatchListeners<Listener>(
  listeners: ReadonlySet<Listener>,
  deliver: (listener: Listener) => void,
  isActive: () => boolean = () => true,
): unknown[] {
  const errors: unknown[] = [];
  // oxlint-disable-next-line unicorn/no-useless-spread -- Callback mutations affect only subsequent notifications.
  for (const listener of [...listeners]) {
    if (!isActive()) break;
    try {
      deliver(listener);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/** Preserve a single failure's identity and retain every failure when multiple listeners throw. */
export function throwNotificationErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
