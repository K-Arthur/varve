/**
 * useAdjustmentHistogram — React hook that computes the source histogram
 * for an adjustment node's scope targets.
 *
 * The histogram represents the ADJUSTMENT INPUT (pixels before this
 * adjustment is applied). It is used by:
 * - LevelsEditor → HistogramWidget (draggable triangle display)
 * - CurvesEditor → CurveEditor (histogram background)
 * - Auto Levels button (autoLevelsParams from histogram)
 *
 * Architecture:
 *   The async computation runs through the canonical scene→engine→replay
 *   pipeline at reduced resolution (256px max). Results are cached by
 *   (doc revision, adjustment id, sorted target ids) at the module level
 *   so identical requests return instantly.
 *
 * The histogram is recomputed when:
 *   - The adjustment selection changes
 *   - The document is mutated (doc.nextId changes)
 *   - The scope/targets change
 *
 * The histogram is NOT recomputed when only the adjustment's parameters
 * change (since the histogram shows the input, not the output).
 */
import type { Histogram } from '@varve/engine';
import type { AdjustmentNode, Document } from '@varve/scene';
import { useEffect, useRef, useState } from 'react';
import { computeAdjustmentSourceHistogram } from '../../canvas/adjustmentHistogramSource';

export interface UseAdjustmentHistogramResult {
  histogram: Histogram | null;
  loading: boolean;
}

export function useAdjustmentHistogram(
  doc: Document | undefined,
  adjNode: AdjustmentNode | undefined,
): UseAdjustmentHistogramResult {
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(0);

  useEffect(() => {
    if (!doc || !adjNode) {
      setHistogram(null);
      setLoading(false);
      return;
    }

    const generation = ++abortRef.current;
    let cancelled = false;
    setLoading(true);

    computeAdjustmentSourceHistogram(doc, adjNode).then((result) => {
      if (cancelled || generation !== abortRef.current) return;
      setHistogram(result);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // Documents are immutable, so identity is the reliable invalidation token.
    // `nextId` only changes when allocating node ids and would leave the
    // histogram stale after an edit to an existing scoped target.
  }, [doc, adjNode?.id, adjNode?.scope]);

  return { histogram, loading };
}
