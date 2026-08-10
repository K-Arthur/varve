/**
 * Module-level bridge for opening the thumbnail picker from anywhere in the
 * editor (menu actions, canvas/page context menus, command palette) without
 * threading dialog state through hub files. Registered by
 * `ThumbnailPickerHost` on mount.
 */

type PickerHandler = (fileId?: string) => void;

let pickerHandler: PickerHandler | null = null;

export function setThumbnailPickerHandler(fn: PickerHandler | null): void {
  pickerHandler = fn;
}

/** Open the thumbnail picker dialog (no-op when the host is not mounted). */
export function openThumbnailPicker(fileId?: string): void {
  pickerHandler?.(fileId);
}
