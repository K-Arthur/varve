/**
 * Frame Presets section — the Figma model for sizing artboards.
 *
 * Two Inspector compositions mount it: `create` while the Frame tool is active
 * with nothing selected (section `frame-presets`, placing a new preset-sized
 * frame), and `resize` for a single non-component frame under any tool
 * (section `frame-resize`, one collapsed row). Presets come from the
 * shared, data-driven registry (@varve/shared) rendered via the shared
 * PresetPicker (@varve/ui) — searchable, grouped, with favorites/recents and
 * a user-created "Custom" section backed by usePresetLibrary.
 *
 * Frame create/resize never reads colorMode/dpi/bleed off a preset — only
 * width/height/unit ever reach applyFramePreset, since frames have no color
 * mode (only documents do).
 */
import {
  BUILTIN_PRESET_GROUPS,
  type CustomPreset,
  type Preset,
  type PresetGroup,
  physicalToPx,
} from '@varve/shared';
import { Button, PresetPicker } from '@varve/ui';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { usePresetLibrary } from '../../../presetLibrary';
import { promptDialog } from '../../PromptDialog';
import { DisclosureSection } from '../controls/DisclosureSection';
import type { SectionId } from '../sectionRegistry';

/**
 * Frames commonly start from screen sizes, but the same shared control also
 * exposes print, comic-page, and source-strip bounds. Device groups lead (as
 * in Figma and Penpot); comic sizes sit before generic print sizes so their
 * page/strip intent is visible without turning them into panel layouts.
 * Unlisted groups keep their registry order at the end.
 */
const FRAME_GROUP_ORDER: readonly PresetGroup['category'][] = [
  'mobile-tablet',
  'desktop',
  'web',
  'presentation',
  'social',
  'video-motion',
  'icon-asset',
  'logo',
  'comic',
  'print',
  'paper',
  'photo',
];

const FRAME_PRESET_GROUPS: PresetGroup[] = [...BUILTIN_PRESET_GROUPS].sort((a, b) => {
  const rank = (group: PresetGroup) => {
    const index = FRAME_GROUP_ORDER.indexOf(group.category);
    return index === -1 ? FRAME_GROUP_ORDER.length : index;
  };
  return rank(a) - rank(b);
});

export function FramePresetsSection({
  mode,
  sectionId,
}: {
  mode: 'create' | 'resize';
  sectionId?: SectionId;
}) {
  const { state, platform, applyFramePreset } = useEditor();
  const lib = usePresetLibrary(platform);

  const selection = state.selection;
  const selectedFrame =
    selection.length === 1
      ? (() => {
          const node = state.document.nodes[selection[0]!];
          return node && node.kind === 'frame' ? node : null;
        })()
      : null;

  const handleSelect = useCallback(
    (preset: Preset) => {
      // Only width/height (converted to the canvas' fixed-96dpi world unit)
      // ever reach applyFramePreset — colorMode/dpi/bleed are document-level
      // concerns, never applicable to a frame.
      const w = physicalToPx(preset.width, preset.unit);
      const h = physicalToPx(preset.height, preset.unit);
      applyFramePreset({ name: preset.name, w, h });
      lib.recordRecent(preset.id);
    },
    [applyFramePreset, lib.recordRecent],
  );

  const handleSaveCurrentAsPreset = useCallback(async () => {
    if (!selectedFrame) return;
    const name = await promptDialog('Save frame size as preset', selectedFrame.name);
    if (!name) return;
    lib.addCustomPreset({
      name,
      width: selectedFrame.w,
      height: selectedFrame.h,
      unit: 'px',
      orientation:
        selectedFrame.w === selectedFrame.h
          ? 'square'
          : selectedFrame.w > selectedFrame.h
            ? 'landscape'
            : 'portrait',
    });
  }, [selectedFrame, lib.addCustomPreset]);

  const handleEditCustom = useCallback(
    async (preset: CustomPreset) => {
      const name = await promptDialog('Rename preset', preset.name);
      if (!name || name === preset.name) return;
      lib.updateCustomPreset(preset.id, { name });
    },
    [lib.updateCustomPreset],
  );

  const label = mode === 'resize' ? 'Resize to Preset' : 'Frame Presets';

  return (
    <DisclosureSection title={label} sectionId={sectionId}>
      <PresetPicker
        groups={FRAME_PRESET_GROUPS}
        density="compact"
        customPresets={lib.customPresets}
        recentIds={lib.recentIds}
        favoriteIds={lib.favoriteIds}
        label={label}
        onSelect={handleSelect}
        onToggleFavorite={(preset) => lib.toggleFavorite(preset.id)}
        onEditCustom={handleEditCustom}
        onDuplicateCustom={(preset) => lib.duplicateCustomPreset(preset.id)}
        onDeleteCustom={(preset) => lib.deleteCustomPreset(preset.id)}
      />
      {mode === 'resize' && selectedFrame && (
        <Button variant="ghost" size="sm" onClick={handleSaveCurrentAsPreset}>
          Save current size as preset
        </Button>
      )}
    </DisclosureSection>
  );
}
