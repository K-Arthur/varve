export type PresentationSizePresetId = 'widescreen' | 'classic' | 'vertical';

export interface PresentationSizePreset {
  id: PresentationSizePresetId;
  name: string;
  width: number;
  height: number;
}

/** Pixel sizes used by new presentations. Custom sizes use document's px unit. */
export const PRESENTATION_SIZE_PRESETS: readonly PresentationSizePreset[] = [
  { id: 'widescreen', name: 'Widescreen 16:9', width: 1920, height: 1080 },
  { id: 'classic', name: 'Classic 4:3', width: 1440, height: 1080 },
  { id: 'vertical', name: 'Vertical 9:16', width: 1080, height: 1920 },
];

export function getPresentationSizePreset(
  id: PresentationSizePresetId | undefined,
): PresentationSizePreset {
  return (
    PRESENTATION_SIZE_PRESETS.find((preset) => preset.id === id) ?? PRESENTATION_SIZE_PRESETS[0]!
  );
}
