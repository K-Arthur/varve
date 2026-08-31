/**
 * SectionManagerTrigger — panel header button for managing section visibility.
 *
 * Shows a gear/ellipsis icon that opens a popover listing all sections with
 * toggle visibility, show all, and restore defaults actions.
 *
 * Research basis: Figma layer panel options, VS Code panel header menus.
 */
import { Icon } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { FEATURE_OWNERSHIP, type InspectorSurface } from './featureOwnership';
import {
  CATEGORY_LABELS,
  getSectionDefinition,
  type SectionDefinition,
  type SectionId,
} from './sectionRegistry';
import { getHiddenSectionIds, getOrderedSectionIds } from './sectionState';

export function SectionManagerTrigger({ surface = 'properties' }: { surface?: InspectorSurface }) {
  const {
    state,
    restoreDefaultSectionState,
    hideInspectorSection,
    showInspectorSection,
    moveSectionUp,
    moveSectionDown,
    resetSectionOrder,
  } = useEditor();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const surfaceIds = new Set<SectionId>(
    Object.entries(FEATURE_OWNERSHIP)
      .filter(([, ownership]) => ownership.surface === surface)
      .map(([id]) => id),
  );
  const hiddenIds = getHiddenSectionIds(state.sectionVisibility).filter((id) => surfaceIds.has(id));
  const hiddenCount = hiddenIds.length;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    const handle = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open]);

  const orderedSectionIds = getOrderedSectionIds(state.sectionVisibility, [...surfaceIds]);
  const allSections = orderedSectionIds
    .map((id) => getSectionDefinition(id))
    .filter((section): section is SectionDefinition => section !== undefined);

  const managerTitle = (definition: SectionDefinition): string => {
    switch (definition.id) {
      case 'position-size':
        return 'Position & size';
      case 'layout':
        return 'Frame layout';
      case 'layout-child':
        return 'Child layout';
      default:
        return definition.title;
    }
  };

  return (
    <div className="insp-section-manager">
      <button
        ref={buttonRef}
        type="button"
        className="insp-section-manager__trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Customize sections${hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="Settings" label={undefined} size="0.85em" />
        {hiddenCount > 0 && <span className="insp-section-manager__badge">{hiddenCount}</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="insp-section-manager__panel"
          role="dialog"
          aria-label="Customize sections"
        >
          <div className="insp-section-manager__actions">
            <button
              type="button"
              className="insp-section-manager__action"
              onClick={() => {
                for (const section of allSections) showInspectorSection(section.id);
                setOpen(false);
              }}
            >
              Show all sections
            </button>
            <button
              type="button"
              className="insp-section-manager__action"
              onClick={() => {
                for (const section of allSections) {
                  if (section.canHide) hideInspectorSection(section.id);
                }
                setOpen(false);
              }}
            >
              Hide optional
            </button>
            <button
              type="button"
              className="insp-section-manager__action"
              onClick={() => {
                restoreDefaultSectionState();
                setOpen(false);
              }}
            >
              Restore defaults
            </button>
            <button
              type="button"
              className="insp-section-manager__action"
              onClick={() => resetSectionOrder()}
            >
              Reset order
            </button>
          </div>

          <ol className="insp-section-manager__list" aria-label="Section order">
            {allSections.map((def, index) => {
              const hidden = state.sectionVisibility[def.id]?.hidden ?? false;
              const checkboxId = `${surface}-section-${def.id}`;
              const category = CATEGORY_LABELS[def.category] ?? def.category;
              const title = managerTitle(def);
              return (
                <li
                  key={def.id}
                  className={`insp-section-manager__item${hidden ? ' insp-section-manager__item--hidden' : ''}`}
                  data-section-id={def.id}
                >
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={!hidden}
                    disabled={!def.canHide}
                    onChange={() => {
                      if (hidden) {
                        showInspectorSection(def.id);
                      } else {
                        hideInspectorSection(def.id);
                      }
                    }}
                    className="insp-section-manager__checkbox"
                  />
                  <label htmlFor={checkboxId} className="insp-section-manager__label">
                    {title}
                  </label>
                  <span className="insp-section-manager__category">{category}</span>
                  {def.essential && (
                    <span className="insp-section-manager__essential">required</span>
                  )}
                  <button
                    type="button"
                    className="insp-section-manager__toggle"
                    aria-label={`Move ${title} up`}
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => moveSectionUp(def.id, orderedSectionIds)}
                  >
                    <Icon name="ChevronUp" label={undefined} size="0.85em" />
                  </button>
                  <button
                    type="button"
                    className="insp-section-manager__toggle"
                    aria-label={`Move ${title} down`}
                    title="Move down"
                    disabled={index === allSections.length - 1}
                    onClick={() => moveSectionDown(def.id, orderedSectionIds)}
                  >
                    <Icon name="ChevronDown" label={undefined} size="0.85em" />
                  </button>
                </li>
              );
            })}
          </ol>

          {hiddenIds.length > 0 && (
            <div className="insp-section-manager__recovery">
              <span className="insp-section-manager__recovery-label">Hidden sections:</span>
              {hiddenIds.map((id) => {
                const def = getSectionDefinition(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="insp-section-manager__recovery-btn"
                    onClick={() => showInspectorSection(id)}
                    aria-label={`Show ${def?.title ?? id}`}
                  >
                    {def?.title ?? id}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
