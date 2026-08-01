import type { Preset } from '@strata/shared';
import { useRef, useState } from 'react';
import { IconButton } from '../IconButton';
import { Menu, type MenuEntry } from '../Menu';

/** Max preview box in px; the preset's proportion is fit inside this. */
const PREVIEW_BOX = 28;

function previewDims(preset: { width: number; height: number }): { w: number; h: number } {
  const ratio = preset.width / preset.height;
  if (ratio >= 1) return { w: PREVIEW_BOX, h: Math.max(6, PREVIEW_BOX / ratio) };
  return { w: Math.max(6, PREVIEW_BOX * ratio), h: PREVIEW_BOX };
}

function formatDimension(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export interface PresetTileProps {
  preset: Preset;
  optionId: string;
  isCustom: boolean;
  isHighlighted: boolean;
  isSelected: boolean;
  isFavorite: boolean;
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
  onSelect,
  onMouseEnter,
  onToggleFavorite,
  onEdit,
  onDuplicate,
  onDelete,
}: PresetTileProps) {
  const dims = previewDims(preset);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const rawMenuItems: (MenuEntry | undefined)[] = [
    onEdit ? { id: 'edit', label: 'Edit', onAction: onEdit } : undefined,
    onDuplicate ? { id: 'duplicate', label: 'Duplicate', onAction: onDuplicate } : undefined,
    onDelete ? { id: 'delete', label: 'Delete', onAction: onDelete } : undefined,
  ];
  const menuItems = rawMenuItems.filter((entry): entry is MenuEntry => entry != null);

  const showOverflow = isCustom && menuItems.length > 0;
  const sizeLabel = `${formatDimension(preset.width)} x ${formatDimension(preset.height)} ${preset.unit}`;

  return (
    // biome-ignore lint/a11y/useFocusableInteractive: focus managed by aria-activedescendant on the parent listbox/combobox, matching Select.tsx's option rows
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav handled by the parent listbox via aria-activedescendant, matching Select.tsx's option rows
    <div
      id={optionId}
      role="option"
      aria-selected={isSelected}
      data-highlighted={isHighlighted || undefined}
      className={`preset-tile${isHighlighted ? ' preset-tile--highlighted' : ''}${isSelected ? ' preset-tile--selected' : ''}`}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
    >
      <span className="preset-tile__preview" aria-hidden>
        <span className="preset-tile__preview-box" style={{ width: dims.w, height: dims.h }} />
      </span>
      <span className="preset-tile__info">
        <span className="preset-tile__name">{preset.name}</span>
        <span className="preset-tile__size">{sizeLabel}</span>
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
          />
        </span>
      )}
    </div>
  );
}
