/**
 * MeasurementReadout — per-node dimension and position readout for the Spec Panel.
 *
 * Shows width, height, X/Y (relative to parent and to page), and rotation.
 * Uses the selected unit for display, with unit conversion applied to copied values.
 */

import type { Document, SceneNode } from '@strata/scene';
import { convertPx, formatValue, type SpecUnit } from '@strata/shared';
import { CopyButton } from '@strata/ui';
import { useMemo } from 'react';
import { worldBBox } from './measurement';

export interface MeasurementReadoutProps {
  node: SceneNode;
  doc: Document;
  unit: SpecUnit;
  baseFontSize: number;
}

export function MeasurementReadout({ node, doc, unit, baseFontSize }: MeasurementReadoutProps) {
  const bbox = useMemo(() => worldBBox(node, doc), [node, doc]);

  const localX = node.transform[4] ?? 0;
  const localY = node.transform[5] ?? 0;

  const containerSize = bbox.w;

  function withUnit(px: number): string {
    return formatValue(convertPx(px, unit, baseFontSize, containerSize), unit);
  }

  return (
    <section className="spec-panel__section" aria-labelledby="meas-dim-heading">
      <h3 id="meas-dim-heading">Dimensions</h3>

      <div className="spec-row">
        <span className="spec-row__label">Width</span>
        <span className="spec-row__value">{withUnit(bbox.w)}</span>
        <CopyButton value={withUnit(bbox.w)} label="Width" className="spec-row__copy" />
      </div>

      <div className="spec-row">
        <span className="spec-row__label">Height</span>
        <span className="spec-row__value">{withUnit(bbox.h)}</span>
        <CopyButton value={withUnit(bbox.h)} label="Height" className="spec-row__copy" />
      </div>

      <div className="spec-row">
        <span className="spec-row__label">X (page)</span>
        <span className="spec-row__value">{withUnit(bbox.x)}</span>
        <CopyButton value={withUnit(bbox.x)} label="X position (page)" className="spec-row__copy" />
      </div>

      <div className="spec-row">
        <span className="spec-row__label">Y (page)</span>
        <span className="spec-row__value">{withUnit(bbox.y)}</span>
        <CopyButton value={withUnit(bbox.y)} label="Y position (page)" className="spec-row__copy" />
      </div>

      <div className="spec-row">
        <span className="spec-row__label">X (parent)</span>
        <span className="spec-row__value">{withUnit(localX)}</span>
        <CopyButton
          value={withUnit(localX)}
          label="X position (parent)"
          className="spec-row__copy"
        />
      </div>

      <div className="spec-row">
        <span className="spec-row__label">Y (parent)</span>
        <span className="spec-row__value">{withUnit(localY)}</span>
        <CopyButton
          value={withUnit(localY)}
          label="Y position (parent)"
          className="spec-row__copy"
        />
      </div>
    </section>
  );
}
