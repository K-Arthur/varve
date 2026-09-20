/**
 * BlendModeField — the one blend-mode selector for every Inspector surface.
 *
 * Options come from the engine's applicability catalog
 * (`blendModesForDomain`) rather than a hand-maintained list per section, so
 * the UI can never offer a mode the renderer cannot paint. The catalog marks
 * `plusDarker` as non-editable everywhere and `css: null`, which previously
 * meant a hand-written Fill list could offer it and the Canvas2D replay would
 * throw when lowering the layer.
 *
 * Research basis: Krita/Photoshop users report long flat blend lists are hard
 * to scan; modes are grouped by the CSS/PDF family (Darken, Lighten,
 * Contrast, Comparative, Component) and the list is searchable. Photoshop's
 * dropdown also stays focused after a pick, which blocks shortcuts until the
 * user presses Enter — the shared `Select` closes on selection and returns
 * focus to its trigger instead.
 * See docs/research/effect-panel-competitive-2026-09-20.md.
 */
import type { BlendDomain } from '@varve/engine';
import { blendModesForDomain } from '@varve/engine';
import type { BlendMode } from '@varve/scene';
import { Select } from '@varve/ui';
import { useMemo } from 'react';
import { groupBlendOptions } from './blendModeOptionGroups';

export interface BlendModeFieldProps {
  /** Effect- or section-specific accessible name, e.g. "Fill 2 blend mode". */
  label: string;
  /** Which applicability domain this control belongs to. */
  domain: BlendDomain;
  value: BlendMode;
  mixed?: boolean;
  onChange: (mode: BlendMode) => void;
  /** Compact lists may prefer the grouped list only; search is on by default. */
  searchable?: boolean;
}

export function BlendModeField({
  label,
  domain,
  value,
  mixed = false,
  onChange,
  searchable = true,
}: BlendModeFieldProps) {
  const options = useMemo(
    () =>
      blendModesForDomain(domain).map((definition) => ({
        value: definition.id,
        label: definition.label,
      })),
    [domain],
  );

  return (
    <Select
      label={label}
      value={mixed ? '' : value}
      options={mixed ? [{ value: '', label: 'Mixed', disabled: true }] : []}
      groups={groupBlendOptions(options)}
      onChange={(next) => {
        if (next) onChange(next as BlendMode);
      }}
      placeholder="Mixed"
      searchable={searchable}
    />
  );
}
