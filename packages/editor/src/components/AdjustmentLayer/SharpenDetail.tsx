import { adjustmentToFilter, applyFilterWithCompositing } from '@varve/engine';
import type { Adjustment, AdjustmentNode, Document } from '@varve/scene';
import { Button } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import {
  type AdjustmentSourceSample,
  computeAdjustmentSourceSample,
} from '../../canvas/adjustmentHistogramSource';
import { NumberField } from '../Inspector/controls/NumberField';

/** Explicit detail render with canonical upstream halos, independent of camera. */
export function SharpenDetail({
  doc,
  scope,
  adjustment,
}: {
  doc?: Document;
  scope?: AdjustmentNode;
  adjustment: Adjustment;
}) {
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [sample, setSample] = useState<AdjustmentSourceSample | null>(null);
  const [message, setMessage] = useState(
    'Request a detail region to compare the filter input and output.',
  );
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const before = useRef<HTMLCanvasElement>(null),
    after = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    generation.current++;
    setSample(null);
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [doc, scope?.id, adjustment.id]);
  useEffect(() => {
    if (!sample?.detailRegion || !before.current || !after.current) return;
    const { x, y, width, height } = sample.detailRegion;
    const evaluated = document.createElement('canvas');
    evaluated.width = sample.imageData.width;
    evaluated.height = sample.imageData.height;
    const ctx = evaluated.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(sample.imageData, 0, 0);
    applyFilterWithCompositing(
      ctx,
      [adjustmentToFilter(adjustment)],
      evaluated.width,
      evaluated.height,
      { treatmentSpace: { pixelsPerUnit: 1 } },
    );
    for (const [canvas, pixels] of [
      [before.current, sample.imageData],
      [after.current, ctx.getImageData(0, 0, evaluated.width, evaluated.height)],
    ] as const) {
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.putImageData(pixels, -x, -y);
    }
  }, [sample, adjustment]);
  const request = async () => {
    if (!doc || !scope || busy) return;
    const requestGeneration = ++generation.current;
    setBusy(true);
    const result = await computeAdjustmentSourceSample(doc, scope, adjustment.id, {
      x: position.x / 100,
      y: position.y / 100,
    });
    if (requestGeneration !== generation.current) return;
    setSample(result);
    setBusy(false);
    setMessage(
      result
        ? '1 document pixel per CSS pixel. Filter input/output before the layer mask and layer opacity.'
        : 'Detail unavailable: empty scope, missing source, or spatial halo exceeds the one-megapixel diagnostic budget.',
    );
  };
  return (
    <div className="tonal-editor">
      <div className="tonal-editor__fields">
        <NumberField
          label="Detail horizontal position"
          displayLabel="Horizontal"
          value={position.x}
          min={0}
          max={100}
          unit="%"
          onChange={(x) => setPosition({ ...position, x })}
        />
        <NumberField
          label="Detail vertical position"
          displayLabel="Vertical"
          value={position.y}
          min={0}
          max={100}
          unit="%"
          onChange={(y) => setPosition({ ...position, y })}
        />
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={!doc || !scope || busy}
        onClick={() => void request()}
      >
        Compare document-pixel detail
      </Button>
      <p className="tonal-editor__hint" role="status">
        {!scope
          ? 'Document-pixel detail is available on Adjustment Filters. Object-local radii follow the object transform; inspect the original source through Channels.'
          : message}
      </p>
      {sample && (
        <div className="tonal-detail">
          <figure>
            <figcaption>Filter input</figcaption>
            <canvas ref={before} aria-label="Sharpen detail input" />
          </figure>
          <figure>
            <figcaption>Filtered output</figcaption>
            <canvas ref={after} aria-label="Sharpen detail output" />
          </figure>
        </div>
      )}
    </div>
  );
}
