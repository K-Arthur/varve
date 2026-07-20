/**
 * DisclosureSection — APG Disclosure pattern for collapsible Inspector groups.
 *
 * Research basis: WAI-ARIA Authoring Practices 1.2 — "Disclosure (Show/Hide)".
 * The trigger is a <button> with aria-expanded + aria-controls; the panel is a
 * <fieldset> (with <legend> mapped to the trigger via aria-labelledby) when
 * it contains form controls, so screen-reader users get a labelled group.
 *
 * Two modes:
 * - Legacy (no sectionId): local useState + sessionStorage (backward-compatible)
 * - Registry (with sectionId): centralized EditorState + localStorage persistence
 *   with hide/show support, context menu, and management UI integration.
 */
import { Icon } from '@strata/ui';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import type { SectionId } from '../sectionRegistry';
import { getSectionDefinition } from '../sectionRegistry';
import { isSectionCollapsed, isSectionVisible } from '../sectionState';

export interface DisclosureSectionProps {
  title: string;
  /** Stable id used as the sessionStorage key; defaults to a slug of the title. */
  id?: string;
  /** Link to the section registry for centralized state management. */
  sectionId?: SectionId;
  defaultExpanded?: boolean;
  children: ReactNode;
}

const STORAGE_PREFIX = 'strata:inspector:disclosure:';

function readStored(id: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + id);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // sessionStorage may be unavailable (private mode / sandbox) — ignore.
  }
  return fallback;
}

function writeStored(id: string, expanded: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + id, expanded ? '1' : '0');
  } catch {
    // ignore
  }
}

export function DisclosureSection({
  title,
  id,
  sectionId,
  defaultExpanded = true,
  children,
}: DisclosureSectionProps) {
  const auto = useId();
  const slug = id ?? title.toLowerCase().replace(/\s+/g, '-');
  const panelId = `disclosure-${slug}-${auto}`;

  // ── Registry mode: centralized state ──
  if (sectionId) {
    return (
      <RegistryDisclosure
        sectionId={sectionId}
        title={title}
        panelId={panelId}
        defaultExpanded={defaultExpanded}
      >
        {children}
      </RegistryDisclosure>
    );
  }

  // ── Legacy mode: local state + sessionStorage ──
  return (
    <LegacyDisclosure
      slug={slug}
      title={title}
      panelId={panelId}
      defaultExpanded={defaultExpanded}
    >
      {children}
    </LegacyDisclosure>
  );
}

// ---------------------------------------------------------------------------
// Registry mode — reads from EditorState
// ---------------------------------------------------------------------------

function RegistryDisclosure({
  sectionId,
  title,
  panelId,
  defaultExpanded,
  children,
}: {
  sectionId: SectionId;
  title: string;
  panelId: string;
  defaultExpanded: boolean;
  children: ReactNode;
}) {
  const { state, toggleSectionCollapse, hideInspectorSection } = useEditor();
  const expanded = isSectionCollapsed(state.sectionVisibility, sectionId) ? false : defaultExpanded;
  const visible = isSectionVisible(state.sectionVisibility, sectionId);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const def = getSectionDefinition(sectionId);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [contextMenu]);

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [contextMenu]);

  if (!visible) return null;

  const handleToggle = () => toggleSectionCollapse(sectionId);
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (def && !def.canHide) return; // essential sections can't be hidden
    setContextMenu({ x: e.clientX, y: e.clientY });
  };
  const handleHide = () => {
    hideInspectorSection(sectionId);
    setContextMenu(null);
  };

  return (
    <section className="insp-disclosure" onContextMenu={handleContextMenu}>
      <button
        type="button"
        className="insp-disclosure__trigger"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={handleToggle}
      >
        <Icon
          name="ChevronRight"
          label={undefined}
          className="insp-disclosure__chevron"
          size="0.9em"
        />
        <span>{title}</span>
      </button>
      {expanded && (
        <fieldset className="insp-disclosure__content" id={panelId}>
          <legend className="sr-only">{title}</legend>
          {children}
        </fieldset>
      )}
      {contextMenu && def?.canHide && (
        <div
          ref={menuRef}
          className="insp-disclosure__context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="insp-disclosure__context-menu-item"
            role="menuitem"
            onClick={handleHide}
          >
            Hide section
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Legacy mode — local state + sessionStorage (backward-compatible)
// ---------------------------------------------------------------------------

function LegacyDisclosure({
  slug,
  title,
  panelId,
  defaultExpanded,
  children,
}: {
  slug: string;
  title: string;
  panelId: string;
  defaultExpanded: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState<boolean>(() => readStored(slug, defaultExpanded));

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      writeStored(slug, next);
      return next;
    });
  }, [slug]);

  return (
    <section className="insp-disclosure">
      <button
        type="button"
        className="insp-disclosure__trigger"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={toggle}
      >
        <Icon
          name="ChevronRight"
          label={undefined}
          className="insp-disclosure__chevron"
          size="0.9em"
        />
        <span>{title}</span>
      </button>
      {expanded && (
        <fieldset className="insp-disclosure__content" id={panelId}>
          <legend className="sr-only">{title}</legend>
          {children}
        </fieldset>
      )}
    </section>
  );
}
