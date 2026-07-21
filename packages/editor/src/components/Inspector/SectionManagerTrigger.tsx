/**
 * SectionManagerTrigger — panel header button for managing section visibility.
 *
 * Shows a gear/ellipsis icon that opens a popover listing all sections with
 * toggle visibility, show all, and restore defaults actions.
 *
 * Research basis: Figma layer panel options, VS Code panel header menus.
 */
import { Icon } from '@strata/ui';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { CATEGORY_LABELS, getAllSections, getSectionDefinition } from './sectionRegistry';
import { countHiddenSections, getHiddenSectionIds } from './sectionState';

export function SectionManagerTrigger() {
  const {
    state,
    showAllInspectorSections,
    restoreDefaultSectionState,
    restoreDefaultCollapsed,
    hideOptionalSections,
    showInspectorSection,
  } = useEditor();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hiddenCount = countHiddenSections(state.sectionVisibility);
  const hiddenIds = getHiddenSectionIds(state.sectionVisibility);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
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

  const allSections = getAllSections() as import('./sectionRegistry').SectionDefinition[];
  const grouped = new Map<string, typeof allSections>();
  for (const s of allSections) {
    const cat = CATEGORY_LABELS[s.category] ?? s.category;
    const list = grouped.get(cat) ?? [];
    list.push(s);
    grouped.set(cat, list);
  }

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
                showAllInspectorSections();
                setOpen(false);
              }}
            >
              Show all sections
            </button>
            <button
              type="button"
              className="insp-section-manager__action"
              onClick={() => {
                hideOptionalSections();
                setOpen(false);
              }}
            >
              Hide optional
            </button>
            <button
              type="button"
              className="insp-section-manager__action"
              onClick={() => {
                restoreDefaultCollapsed();
                setOpen(false);
              }}
            >
              Reset collapse
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
          </div>

          <div className="insp-section-manager__list">
            {Array.from(grouped.entries()).map(([category, sections]) => (
              <div key={category} className="insp-section-manager__group">
                <span className="insp-section-manager__group-label">{category}</span>
                {sections.map((def) => {
                  const hidden = state.sectionVisibility[def.id]?.hidden ?? false;
                  return (
                    <label
                      key={def.id}
                      className={`insp-section-manager__item${hidden ? ' insp-section-manager__item--hidden' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden}
                        disabled={!def.canHide}
                        onChange={() => {
                          if (hidden) {
                            showInspectorSection(def.id);
                          } else {
                            // Show all first if this was the only way to see it
                            showInspectorSection(def.id);
                          }
                        }}
                        className="insp-section-manager__checkbox"
                      />
                      <span className="insp-section-manager__label">{def.title}</span>
                      {def.essential && (
                        <span className="insp-section-manager__essential">required</span>
                      )}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>

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
