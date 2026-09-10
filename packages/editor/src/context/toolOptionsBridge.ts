/**
 * Lets the Inspector open the floating Tool Options popover without lifting
 * the popover's transient open state into editor state.
 */
let toolOptionsHandler: (() => void) | null = null;

export function setToolOptionsHandler(handler: (() => void) | null): void {
  toolOptionsHandler = handler;
}

export function requestToolOptions(): void {
  toolOptionsHandler?.();
}
