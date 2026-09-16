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
import {
  ContextMenu,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Icon,
  type OverlayAnchor,
  pointAnchor,
  useDisclosureFocusRestore,
  viewportPoint,
} from '@varve/ui';
import type { ReactNode } from 'react';
import { useCallback, useId, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import type { SectionId } from '../sectionRegistry';
import { getSectionDefinition } from '../sectionRegistry';
import { isSectionCollapsed, isSectionVisible, isSubSectionCollapsed } from '../sectionState';

export interface DisclosureSectionProps {
  title: string;
  /** Stable id used as the sessionStorage key; defaults to a slug of the title. */
  id?: string;
  /** Link to the section registry for centralized state management. */
  sectionId?: SectionId;
  /** Nested subsection identifier under a parent sectionId. Requires sectionId. */
  subsectionId?: string;
  /**
   * Default expansion for the legacy (non-registry) mode only.
   *
   * Registry sections resolve their defaults from `sectionRegistry` — for
   * top-level sections via `defaultExpanded` and for subsections via the
   * section definition's `subsections` map — so the value stays consistent
   * across every call site and survives with the rest of `sectionVisibility`.
   * Passing this together with `sectionId` has no effect. See
   * docs/architecture/disclosure-system.md.
   */
  defaultExpanded?: boolean;
  /** Optional action rendered beside the disclosure trigger. */
  action?: ReactNode;
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
  subsectionId,
  defaultExpanded = true,
  action,
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
        subsectionId={subsectionId}
        title={title}
        panelId={panelId}
        action={action}
      >
        {children}
      </RegistryDisclosure>
    );
  }

  // ── Legacy mode: local state + sessionStorage ──
  return (
    <LegacyDisclosure slug={slug} title={title} defaultExpanded={defaultExpanded} action={action}>
      {children}
    </LegacyDisclosure>
  );
}

// ---------------------------------------------------------------------------
// Registry mode — reads from EditorState
// ---------------------------------------------------------------------------

function RegistryDisclosure({
  sectionId,
  subsectionId,
  title,
  panelId,
  action,
  children,
}: {
  sectionId: SectionId;
  subsectionId?: string;
  title: string;
  panelId: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { state, toggleSectionCollapse, toggleSubSectionCollapse, hideInspectorSection } =
    useEditor();

  // Determine expanded state. Both levels read from the registry-backed
  // section state: top-level `defaultExpanded` comes from the section
  // definition, and a registry subsection may declare its own default (see
  // SectionDefinition.subsections). The call-site prop is legacy-mode only.
  const expanded = subsectionId
    ? !isSubSectionCollapsed(state.sectionVisibility, sectionId, subsectionId)
    : !isSectionCollapsed(state.sectionVisibility, sectionId);
  const visible = subsectionId
    ? !isSectionCollapsed(state.sectionVisibility, sectionId)
    : isSectionVisible(state.sectionVisibility, sectionId);
  const [contextMenu, setContextMenu] = useState<OverlayAnchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const def = getSectionDefinition(sectionId);
  const focusRestore = useDisclosureFocusRestore({
    open: expanded,
    rootRef,
    triggerRef,
  });

  if (!visible) return null;

  const handleToggle = () => {
    if (subsectionId) {
      toggleSubSectionCollapse(sectionId, subsectionId);
    } else {
      toggleSectionCollapse(sectionId);
    }
  };
  const handleTriggerContextMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (def && !def.canHide) return; // essential sections can't be hidden
    const contextElement = e.currentTarget;
    setContextMenu(
      pointAnchor(
        viewportPoint(e.clientX, e.clientY),
        contextElement.ownerDocument,
        contextElement,
      ),
    );
  };
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      if (def && !def.canHide) return;
      setContextMenu({ kind: 'element', element: e.currentTarget });
    }
  };
  const handleHide = () => {
    hideInspectorSection(sectionId);
    setContextMenu(null);
  };

  return (
    <section
      ref={rootRef}
      {...focusRestore}
      className="insp-disclosure"
      data-section-id={sectionId}
      data-subsection-id={subsectionId}
    >
      <div className="insp-disclosure__header">
        {/* APG Accordion: the header button is wrapped in a heading so
            assistive technology can navigate between inspector sections. The
            section action stays outside the heading. */}
        <h3 className="insp-disclosure__heading">
          <button
            ref={triggerRef}
            type="button"
            className="insp-disclosure__trigger"
            aria-expanded={expanded}
            /* The panel is unmounted while collapsed, so aria-controls only
               points at something that actually exists. */
            aria-controls={expanded ? panelId : undefined}
            aria-haspopup={def?.canHide ? 'menu' : undefined}
            onClick={handleToggle}
            onContextMenu={handleTriggerContextMenu}
            onKeyDown={handleTriggerKeyDown}
          >
            <Icon
              name="ChevronRight"
              label={undefined}
              className="insp-disclosure__chevron"
              size="0.9em"
            />
            <span>{title}</span>
          </button>
        </h3>
        {action && <div className="insp-disclosure__action">{action}</div>}
      </div>
      {expanded && (
        <fieldset className="insp-disclosure__content" id={panelId}>
          <legend className="sr-only">{title}</legend>
          {children}
        </fieldset>
      )}
      {contextMenu && def?.canHide && (
        <ContextMenu
          anchor={contextMenu}
          items={[{ id: 'hide-section', label: 'Hide section', onAction: handleHide }]}
          onClose={() => setContextMenu(null)}
          label={`${title} section actions`}
          size="compact"
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Legacy mode — local state + sessionStorage (backward-compatible)
// Uses the shared Disclosure primitive from @varve/ui for consistent
// accessibility and visual treatment.
// ---------------------------------------------------------------------------

function LegacyDisclosure({
  slug,
  title,
  defaultExpanded,
  action,
  children,
}: {
  slug: string;
  title: string;
  defaultExpanded: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState<boolean>(() => readStored(slug, defaultExpanded));

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setExpanded(next);
      writeStored(slug, next);
    },
    [slug],
  );

  return (
    <Disclosure open={expanded} onOpenChange={handleOpenChange} className="insp-disclosure">
      <div className="insp-disclosure__header">
        <h3 className="insp-disclosure__heading">
          <DisclosureTrigger className="insp-disclosure__trigger">{title}</DisclosureTrigger>
        </h3>
        {action && <div className="insp-disclosure__action">{action}</div>}
      </div>
      <DisclosureContent className="insp-disclosure__content">{children}</DisclosureContent>
    </Disclosure>
  );
}
