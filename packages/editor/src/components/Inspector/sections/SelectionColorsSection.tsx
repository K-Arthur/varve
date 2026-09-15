/**
 * Compact, selection-scoped paint summary for the Properties inspector.
 *
 * The scene package owns traversal, paint resolution and replacement. This
 * component only presents that derived model and routes edits through the
 * existing InspectorColorPopover transaction flow.
 */

import type { Document, ManagedColor, NodeId, SceneNode, SelectedPaintGroup } from '@varve/scene';
import { collectSelectedPaints, replaceSelectedPaintReferences } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { TooltipProvider } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';

const INITIAL_VISIBLE_GROUPS = 16;

export interface SelectionColorsSectionProps {
  /** PropertiesPanel passes the actual selection; explicit values support focused UI tests. */
  nodes?: SceneNode[];
  document?: Document;
  selectionIds?: readonly NodeId[];
  textRange?: import('@varve/scene').RichSelection | null;
}

export function SelectionColorsSection({
  nodes,
  document: suppliedDocument,
  selectionIds,
  textRange: suppliedTextRange,
}: SelectionColorsSectionProps) {
  const editor = useEditor();
  const document = suppliedDocument ?? editor.state.document;
  const ids = selectionIds ?? nodes?.map((node) => node.id) ?? editor.state.selection;
  const textRange =
    suppliedTextRange ??
    (editor.state.selectionMode === 'text' ? editor.state.selectionRange : null);
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(
    () => collectSelectedPaints(document, ids, { textRange }),
    [document, ids, textRange],
  );
  const visibleGroups = expanded ? summary.groups : summary.groups.slice(0, INITIAL_VISIBLE_GROUPS);
  const remainingCount = summary.groups.length - visibleGroups.length;

  const replaceGroup = useCallback(
    (group: SelectedPaintGroup, color: ManagedColor) => {
      editor.updateDoc((current) =>
        replaceSelectedPaintReferences(current, group.references, color),
      );
    },
    [editor],
  );

  if (summary.groups.length === 0 && summary.nonColorPaints.length === 0) return null;

  return (
    <DisclosureSection title="Selection Colors" sectionId="selection-colors">
      <TooltipProvider>
        <div className="selection-colors" data-testid="selection-colors">
          {summary.groups.length > 0 && (
            <ul className="selection-colors__grid" aria-label="Selection colors">
              {visibleGroups.map((group) => {
                const label = paintGroupLabel(group);
                const disabledReason = groupDisabledReason(group);
                return (
                  <li key={group.key} className="selection-colors__item">
                    <span className="selection-colors__swatch-wrap">
                      <InspectorColorPopover
                        label={label}
                        tooltipLabel={label}
                        tooltipDisabledReason={disabledReason}
                        value={group.color}
                        onChange={(color) => replaceGroup(group, color)}
                        className="selection-colors__swatch"
                        disabled={group.editableReferenceCount === 0}
                        documentColorMode={editor.documentColorMode}
                        onEditStart={editor.beginTransaction}
                        onEditEnd={editor.commitTransaction}
                        swatchStyle={swatchStyle(group.color, group.paintOpacity)}
                      />
                    </span>
                    <span className="selection-colors__meta" aria-hidden="true">
                      <span className="selection-colors__count">{group.references.length}</span>
                      <span className="selection-colors__role">{roleLabel(group)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {remainingCount > 0 && (
            <button
              type="button"
              className="selection-colors__more"
              onClick={() => setExpanded(true)}
              aria-label={`Show ${remainingCount} more selection colors`}
            >
              + {remainingCount} more
            </button>
          )}
          {expanded && summary.groups.length > INITIAL_VISIBLE_GROUPS && (
            <button
              type="button"
              className="selection-colors__more"
              onClick={() => setExpanded(false)}
            >
              Show less
            </button>
          )}
          {summary.nonColorPaints.length > 0 && (
            <p className="selection-colors__non-color" role="status">
              {nonColorPaintLabel(summary.nonColorPaints)}
            </p>
          )}
        </div>
      </TooltipProvider>
    </DisclosureSection>
  );
}

function swatchStyle(color: ManagedColor, paintOpacity: number): React.CSSProperties {
  const [r, g, b, alpha] = managedColorToRgba(color);
  const opacity = Math.max(0, Math.min(1, (alpha / 255) * paintOpacity));
  const face = `rgba(${r}, ${g}, ${b}, ${opacity})`;
  return {
    backgroundImage:
      `linear-gradient(${face}, ${face}), ` +
      'conic-gradient(var(--color-surface-sunken) 25%, var(--color-surface-raised) 0 50%, var(--color-surface-sunken) 0 75%, var(--color-surface-raised) 0)',
    backgroundSize: 'auto, 0.5rem 0.5rem',
  };
}

function paintGroupLabel(group: SelectedPaintGroup): string {
  const editable = group.editableReferenceCount;
  const total = group.references.length;
  const editability = editable === total ? '' : `, ${editable} of ${total} editable`;
  return `${colorLabel(group.color)}, ${roleLabel(group)}, ${total} paint ${pluralize(
    total,
    'use',
  )}${opacityLabel(group)}${editability}`;
}

function colorLabel(color: ManagedColor): string {
  switch (color.space) {
    case 'rgb': {
      const [r, g, b] = managedColorToRgba(color);
      const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
      return color.profile ? `RGB ${hex} (${color.profile})` : `RGB ${hex}`;
    }
    case 'cmyk':
      return `CMYK (${color.c}, ${color.m}, ${color.y}, ${color.k})${color.profile ? ` (${color.profile})` : ''}`;
    case 'gray':
      return `Gray ${color.v}${color.profile ? ` (${color.profile})` : ''}`;
    case 'spot':
      return `Spot ${color.name} ${color.tint}%`;
    case 'lab':
      return `Lab (${color.l}, ${color.av}, ${color.b})${color.profile ? ` (${color.profile})` : ''}`;
    case 'lch':
      return `LCH (${color.l}, ${color.c}, ${color.h})${color.profile ? ` (${color.profile})` : ''}`;
    case 'registration':
      return 'Registration color';
    case 'unresolved':
      return `Unresolved color${color.reason ? ` (${color.reason})` : ''}`;
  }
}

function opacityLabel(group: SelectedPaintGroup): string {
  const [, , , alpha] = managedColorToRgba(group.color);
  const opacity = Math.round((alpha / 255) * group.paintOpacity * 100);
  return opacity === 100 ? '' : `, ${opacity}% opacity`;
}

function roleLabel(group: SelectedPaintGroup): string {
  return group.roles
    .map((role) => {
      switch (role) {
        case 'fill':
          return 'Fill';
        case 'stroke':
          return 'Stroke';
        case 'gradient-stop':
          return 'Gradient stop';
        case 'text-fill':
          return 'Text';
        case 'table-fill':
          return 'Table fill';
        case 'table-stroke':
          return 'Table border';
        case 'table-text':
          return 'Table text';
        default:
          return role;
      }
    })
    .join(' · ');
}

function groupDisabledReason(group: SelectedPaintGroup): string | undefined {
  if (group.editableReferenceCount > 0) return undefined;
  const reason = group.references[0]?.editBlockReason;
  switch (reason) {
    case 'locked':
      return 'This paint is on locked content.';
    case 'linked-story':
      return 'Linked text stories are inspected here but edited through their text story.';
    case 'variant-derived':
      return 'This paint is supplied by the active component variant.';
    case 'variable-bound':
      return 'This paint is bound to a variable. Edit the variable to preserve the link.';
    default:
      return 'This selected paint cannot be edited here.';
  }
}

function nonColorPaintLabel(paints: readonly { kind: string; count: number }[]): string {
  return `${paints
    .map((paint) => {
      const label =
        paint.kind === 'image'
          ? 'image fill'
          : paint.kind === 'pattern'
            ? 'pattern fill'
            : 'raster layer';
      return `${paint.count} ${label}${paint.count === 1 ? '' : 's'}`;
    })
    .join(' · ')} — not sampled as editable vector colors.`;
}

function pluralize(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}
