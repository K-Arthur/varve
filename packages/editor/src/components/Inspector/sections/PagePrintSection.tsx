/**
 * PagePrintSection (M12, ADR-0166): page-level print geometry controls —
 * bleed, slug and safe area for the active page. Shown in the inspector
 * while the Page tool is active (page-focused inspector); values resolve
 * through resolvePagePrintGeometry and write page overrides via the
 * context setters. Document defaults stay untouched unless overridden.
 */

import type { BleedConfig, SafeAreaConfig, SlugConfig } from '@varve/scene';
import { resolvePagePrintGeometry } from '@varve/scene';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import './page-print.css';

function EdgeFields({
  label,
  values,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  values: { top: number; right: number; bottom: number; left: number };
  unit: string;
  onChange: (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="page-print__edges">
      <NumberField
        label={`${label} top`}
        value={values.top}
        unit={unit}
        disabled={disabled}
        onChange={(v) => onChange('top', v)}
      />
      <NumberField
        label={`${label} right`}
        value={values.right}
        unit={unit}
        disabled={disabled}
        onChange={(v) => onChange('right', v)}
      />
      <NumberField
        label={`${label} bottom`}
        value={values.bottom}
        unit={unit}
        disabled={disabled}
        onChange={(v) => onChange('bottom', v)}
      />
      <NumberField
        label={`${label} left`}
        value={values.left}
        unit={unit}
        disabled={disabled}
        onChange={(v) => onChange('left', v)}
      />
    </div>
  );
}

export function PagePrintSection() {
  const { state, setPageBleed, setPageSafeArea, setPageSlug } = useEditor();
  const doc = state.document;
  const pageId = doc.activePageId;

  const geometry = useMemo(
    () => (pageId ? resolvePagePrintGeometry(doc, pageId) : null),
    [doc, pageId],
  );
  const page = useMemo(
    () => (pageId ? doc.pages?.find((p) => p.id === pageId) : undefined),
    [doc, pageId],
  );

  const handleBleed = useCallback(
    (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => {
      if (!pageId) return;
      const current: BleedConfig = page?.bleed ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        linked: true,
        unit: 'px',
      };
      setPageBleed(pageId, { ...current, [edge]: Math.max(0, value), unit: 'px' });
    },
    [pageId, page?.bleed, setPageBleed],
  );

  const handleSafeArea = useCallback(
    (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => {
      if (!pageId) return;
      const current: SafeAreaConfig = page?.safeArea ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        unit: 'px',
        enabled: true,
      };
      setPageSafeArea(pageId, { ...current, [edge]: Math.max(0, value), unit: 'px' });
    },
    [pageId, page?.safeArea, setPageSafeArea],
  );

  const handleSlug = useCallback(
    (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => {
      if (!pageId) return;
      const current: SlugConfig = page?.slug ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        unit: 'px',
        enabled: true,
      };
      setPageSlug(pageId, { ...current, [edge]: Math.max(0, value), unit: 'px' });
    },
    [pageId, page?.slug, setPageSlug],
  );

  if (state.tool !== 'page' || !pageId || !geometry) return null;

  return (
    <DisclosureSection title="Page Print" sectionId="page-print" defaultExpanded>
      <div className="page-print">
        <h4 className="page-print__sub">Bleed</h4>
        <EdgeFields label="Bleed" values={geometry.bleed} unit="px" onChange={handleBleed} />
        <h4 className="page-print__sub">Safe area</h4>
        <label className="page-print__toggle">
          <input
            type="checkbox"
            checked={geometry.safeArea.enabled}
            onChange={(e) => {
              if (pageId) {
                const current = page?.safeArea ?? geometry.safeArea;
                setPageSafeArea(pageId, { ...current, enabled: e.target.checked });
              }
            }}
          />
          Show safe area
        </label>
        <EdgeFields
          label="Safe area"
          values={geometry.safeArea}
          unit="px"
          disabled={!geometry.safeArea.enabled}
          onChange={handleSafeArea}
        />
        <h4 className="page-print__sub">Slug</h4>
        <label className="page-print__toggle">
          <input
            type="checkbox"
            checked={geometry.slug.enabled}
            onChange={(e) => {
              if (pageId) {
                const current = page?.slug ?? geometry.slug;
                setPageSlug(pageId, { ...current, enabled: e.target.checked });
              }
            }}
          />
          Show slug
        </label>
        <EdgeFields
          label="Slug"
          values={geometry.slug}
          unit="px"
          disabled={!geometry.slug.enabled}
          onChange={handleSlug}
        />
      </div>
    </DisclosureSection>
  );
}
