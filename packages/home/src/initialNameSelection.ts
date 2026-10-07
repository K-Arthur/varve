/** Select the suggestion once, without taking over an interaction already underway. */
export function scheduleInitialNameSelection(
  input: HTMLInputElement,
  suggestedName: string,
): () => void {
  const view = input.ownerDocument.defaultView;
  const dialog = input.closest('dialog');
  if (!view || !dialog) return () => {};

  let pending = true;
  const interactionEvents = ['pointerdown', 'keydown', 'beforeinput', 'input'] as const;
  const frame = view.requestAnimationFrame(() => {
    const shouldSelect =
      pending && input.isConnected && dialog.open && input.value === suggestedName;
    cancel();
    if (shouldSelect) {
      input.focus();
      input.select();
    }
  });

  function cancel() {
    pending = false;
    view?.cancelAnimationFrame(frame);
    for (const event of interactionEvents) dialog?.removeEventListener(event, cancel, true);
  }

  for (const event of interactionEvents) dialog.addEventListener(event, cancel, true);
  return cancel;
}
