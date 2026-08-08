/**
 * PagePrintSection (M12, ADR-0166): page-level print geometry controls —
 * bleed, slug and safe area for the active page. Shown in the inspector
 * while the Page tool is active (page-focused inspector); values resolve
 * through resolvePagePrintGeometry and write page overrides via the
 * context setters. Document defaults stay untouched unless overridden.
 */

import type { BleedConfig, SafeAreaConfig, SlugConfig } from '@varve/scene';
import { resolvePagePrintGeometry } from '@varve/scene';
import { BUILTIN_PRESET_GROUPS } from '@varve/shared';
import { Select } from '@varve/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import './page-print.css';

/**
 * Page dimensions are unitless document pixels (the default page is a
 * 1920x1080 screen artboard), so physical presets convert at the CSS
 * reference of 96dpi.
 */
const MM_PER_INCH = 25.4;
const CSS_DPI = 96;

function presetToPagePixels(width: number, height: number, unit: string): [number, number] {
  switch (unit) {
    case 'mm':
      return [
        Math.round((width / MM_PER_INCH) * CSS_DPI),
        Math.round((height / MM_PER_INCH) * CSS_DPI),
      ];
    case 'in':
      return [Math.round(width * CSS_DPI), Math.round(height * CSS_DPI)];
    default:
      return [Math.round(width), Math.round(height)];
  }
}

/**
 * Paper and screen presets from the shared registry — the same source the
 * new-document flow uses, so page sizes and document sizes cannot drift apart.
 * Presets are a starting point, not a constraint: the width/height fields stay
 * editable for packaging, signage and other non-standard sizes.
 */
const PAGE_SIZE_OPTIONS = BUILTIN_PRESET_GROUPS.flatMap((group) =>
  group.presets.map((preset) => {
    const [w, h] = presetToPagePixels(preset.width, preset.height, preset.unit);
    return {
      value: `${group.category}:${preset.id}`,
      label: `${preset.name} (${w} x ${h})`,
      w,
      h,
    };
  }),
);

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
  const { state, setPageBleed, setPageSafeArea, setPageSlug, resizePage } = useEditor();
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

  const pageWidth = page?.width ?? 0;
  const pageHeight = page?.height ?? 0;

  // A preset only *reports* as selected when the page already matches it
  // exactly; choosing one is a one-way apply, never a stored mode. Editing
  // width or height afterwards simply clears the match.
  const matchedPreset = useMemo(
    () => PAGE_SIZE_OPTIONS.find((o) => o.w === pageWidth && o.h === pageHeight)?.value ?? '',
    [pageWidth, pageHeight],
  );

  const applySize = useCallback(
    (w: number, h: number) => {
      if (!pageId) return;
      // Anchor top-left: the page changes size, content keeps its own size and
      // position. Silently rescaling a laid-out page because the paper size
      // changed is destructive, so scaling stays an explicit separate action.
      resizePage(pageId, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    },
    [pageId, resizePage],
  );

  if (state.tool !== 'page' || !pageId || !geometry) return null;

  return (
    <DisclosureSection title="Page Print" sectionId="page-print" defaultExpanded>
      <div className="page-print">
        <h4 className="page-print__sub">Size</h4>
        <FieldRow label="Preset">
          <Select
            label="Page size preset"
            value={matchedPreset}
            placeholder="Custom"
            options={[
              ...(matchedPreset ? [] : [{ value: '', label: 'Custom', disabled: true }]),
              ...PAGE_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            ]}
            onChange={(v) => {
              const option = PAGE_SIZE_OPTIONS.find((o) => o.value === v);
              if (option) applySize(option.w, option.h);
            }}
          />
        </FieldRow>
        <div className="page-print__edges">
          <NumberField
            label="Page width"
            value={pageWidth}
            unit="px"
            onChange={(v) => applySize(v, pageHeight)}
          />
          <NumberField
            label="Page height"
            value={pageHeight}
            unit="px"
            onChange={(v) => applySize(pageWidth, v)}
          />
        </div>
        <button
          type="button"
          className="page-print__toggle"
          onClick={() => applySize(pageHeight, pageWidth)}
        >
          Swap orientation
        </button>
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
