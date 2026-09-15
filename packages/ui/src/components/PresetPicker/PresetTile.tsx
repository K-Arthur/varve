import type { Preset } from '@varve/shared';
import { useRef, useState } from 'react';
import { IconButton } from '../IconButton';
import { Menu, type MenuEntry } from '../Menu';

/** Max preview box in px per density; the preset's proportion is fit inside. */
const PREVIEW_BOX = { comfortable: 22, compact: 14 } as const;
const DIMENSION_SEPARATOR = String.fromCharCode(215);

export type PresetPickerDensity = keyof typeof PREVIEW_BOX;

function previewDims(
  preset: { width: number; height: number },
  box: number,
): { w: number; h: number } {
  const min = Math.max(4, Math.round(box / 4));
  const ratio = preset.width / preset.height;
  if (ratio >= 1) return { w: box, h: Math.max(min, box / ratio) };
  return { w: Math.max(min, box * ratio), h: box };
}

function formatDimension(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** "393 x 852" for pixels; physical units keep their suffix ("8.5 x 11 in"). */
export function formatPresetSize(preset: Preset): string {
  const size = `${formatDimension(preset.width)} ${DIMENSION_SEPARATOR} ${formatDimension(preset.height)}`;
  return preset.unit === 'px' ? size : `${size} ${preset.unit}`;
}

/** True when the name already states the size ("4 x 6 in"), so a caption would repeat it. */
export function presetNameRepeatsSize(preset: Preset): boolean {
  const compact = (value: string) =>
    value.toLowerCase().replace(new RegExp(DIMENSION_SEPARATOR, 'g'), 'x').replace(/\s+/g, '');
  const size = `${formatDimension(preset.width)}x${formatDimension(preset.height)}`;
  return compact(preset.name).includes(size);
}

export interface PresetTileProps {
  preset: Preset;
  optionId: string;
  isCustom: boolean;
  isHighlighted: boolean;
  isSelected: boolean;
  isFavorite: boolean;
  /** `compact` renders one line (name, then size) for narrow side panels. */
  density?: PresetPickerDensity;
  onSelect: () => void;
  onMouseEnter: () => void;
  onToggleFavorite?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

/**
 * A single preset option — proportional preview, name, size caption, an
 * optional favorite star, and (for custom presets) an overflow menu with
 * edit/duplicate/delete. Rendered as role="option" inside PresetPicker's
 * role="listbox"; the favorite star and overflow menu are real focusable
 * controls nested inside (reachable via Tab as a secondary path — the
 * primary navigation is the listbox's roving aria-activedescendant).
 */
export function PresetTile({
  preset,
  optionId,
  isCustom,
  isHighlighted,
  isSelected,
  isFavorite,
  density = 'comfortable',
  onSelect,
  onMouseEnter,
  onToggleFavorite,
  onEdit,
  onDuplicate,
  onDelete,
}: PresetTileProps) {
  const dims = previewDims(preset, PREVIEW_BOX[density]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const rawMenuItems: (MenuEntry | undefined)[] = [
    onEdit ? { id: 'edit', label: 'Edit', onAction: onEdit } : undefined,
    onDuplicate ? { id: 'duplicate', label: 'Duplicate', onAction: onDuplicate } : undefined,
    onDelete ? { id: 'delete', label: 'Delete', onAction: onDelete } : undefined,
  ];
  const menuItems = rawMenuItems.filter((entry): entry is MenuEntry => entry != null);

  const showOverflow = isCustom && menuItems.length > 0;
  const sizeLabel = presetNameRepeatsSize(preset) ? null : formatPresetSize(preset);

  return (
    // biome-ignore lint/a11y/useFocusableInteractive: focus managed by aria-activedescendant on the parent listbox/combobox, matching Select.tsx's option rows
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav handled by the parent listbox via aria-activedescendant, matching Select.tsx's option rows
    <div
      id={optionId}
      role="option"
      aria-selected={isSelected}
      data-highlighted={isHighlighted || undefined}
      data-variant="selectable"
      data-density="compact"
      data-orientation="horizontal"
      data-preset-density={density}
      data-selected={isSelected || undefined}
      className={`preset-tile varve-card varve-card--selectable${isHighlighted ? ' preset-tile--highlighted' : ''}${isSelected ? ' preset-tile--selected' : ''}`}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
    >
      <span className="preset-tile__preview" aria-hidden>
        <span className="preset-tile__preview-box" style={{ width: dims.w, height: dims.h }} />
      </span>
      <span className="preset-tile__info">
        <span className="preset-tile__name">{preset.name}</span>
        {sizeLabel && <span className="preset-tile__size">{sizeLabel}</span>}
      </span>
      {onToggleFavorite && (
        <IconButton
          icon="Star"
          label={
            isFavorite ? `Remove ${preset.name} from favorites` : `Add ${preset.name} to favorites`
          }
          solid={isFavorite}
          pressed={isFavorite}
          size="sm"
          variant="ghost"
          className="preset-tile__favorite"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
        />
      )}
      {showOverflow && (
        // Menu renders its items via a portal, but React bubbles synthetic
        // events through the *component* tree, not the DOM tree — a click on
        // a portaled menu item would otherwise still reach this tile's
        // onClick and fire onSelect. Stop it at this wrapper instead; the
        // wrapper itself carries no semantics of its own (the real
        // interactive controls are the IconButton/Menu inside it).
        // biome-ignore lint/a11y/noStaticElementInteractions: propagation firewall only, not a control in its own right
        // biome-ignore lint/a11y/useKeyWithClickEvents: no keyboard interaction of its own — stopPropagation only, real controls are the children
        <span onClick={(e) => e.stopPropagation()}>
          <IconButton
            ref={menuTriggerRef}
            icon="DotsThreeVertical"
            label={`More actions for ${preset.name}`}
            solid
            size="sm"
            variant="ghost"
            className="preset-tile__menu-trigger"
            onClick={() => setMenuOpen((open) => !open)}
          />
          <Menu
            triggerRef={menuTriggerRef}
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            label={`${preset.name} actions`}
            items={menuItems}
            size="compact"
          />
        </span>
      )}
    </div>
  );
}
