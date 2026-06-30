/**
 * DisclosureSection — APG Disclosure pattern for collapsible Inspector groups.
 *
 * Research basis: WAI-ARIA Authoring Practices 1.2 — "Disclosure (Show/Hide)".
 * The trigger is a <button> with aria-expanded + aria-controls; the panel is a
 * <fieldset> (with <legend> mapped to the trigger via aria-labelledby) when
 * it contains form controls, so screen-reader users get a labelled group.
 *
 * Expansion state persists per-session via sessionStorage (Strata plan §1:
 * "expansion state persists per session").
 */
import { Icon } from '@strata/ui';
import type { ReactNode } from 'react';
import { useCallback, useId, useState } from 'react';

export interface DisclosureSectionProps {
  title: string;
  /** Stable id used as the sessionStorage key; defaults to a slug of the title. */
  id?: string;
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
  defaultExpanded = true,
  children,
}: DisclosureSectionProps) {
  const auto = useId();
  const sectionId = id ?? title.toLowerCase().replace(/\s+/g, '-');
  const panelId = `disclosure-${sectionId}-${auto}`;
  const [expanded, setExpanded] = useState<boolean>(() => readStored(sectionId, defaultExpanded));

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      writeStored(sectionId, next);
      return next;
    });
  }, [sectionId]);

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
