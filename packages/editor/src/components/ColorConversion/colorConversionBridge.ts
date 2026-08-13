/**
 * Module-level bridge for opening the Document Color Mode dialog from
 * anywhere in the editor (menu actions, command palette) without threading
 * dialog state through hub files. Registered by the dialog host on mount.
 */

type ColorConversionHandler = () => void;

let conversionHandler: ColorConversionHandler | null = null;

export function setColorConversionHandler(fn: ColorConversionHandler | null): void {
  conversionHandler = fn;
}

/** Open the Document Color Mode dialog (no-op when the host is not mounted). */
export function openColorConversion(): void {
  conversionHandler?.();
}
