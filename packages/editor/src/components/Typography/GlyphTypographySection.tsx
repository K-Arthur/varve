/**
 * GlyphTypographySection — shared kerning-mode + per-glyph adjustment
 * controls for text nodes. Used by the Inspector Typography section and the
 * Logo panel wordmark section so both surfaces expose identical behavior.
 *
 * All mutations route through the scene glyph-adjustment ops via
 * editor.updateDoc (single undo per change) — no business logic lives in
 * React handlers. When the selected text cannot be glyph-edited safely
 * (rich text, multi-line, RTL, case transforms, list styles, path text),
 * the controls are disabled with an explicit reason instead of corrupting
 * shaping.
 */

import type { GlyphAdjustment, TextNode } from '@strata/scene';
import {
  canGlyphAdjust,
  clearGlyphAdjustments,
  clusterLabel,
  glyphAdjustmentStats,
  graphemeClusters,
  setGlyphAdjustment,
  setPairAdjustment,
  setTextKerningMode,
} from '@strata/scene';
import { Button, NumberInput, Select } from '@strata/ui';
import { useMemo, useState } from 'react';
import { useEditor } from '../../context';
import './glyph-typography.css';

export interface GlyphTypographySectionProps {
  node: TextNode;
  /** Called when the user converts the wordmark to outlines (optional). */
  onConvertToOutlines?: () => void;
}

export function GlyphTypographySection({ node, onConvertToOutlines }: GlyphTypographySectionProps) {
  const editor = useEditor();
  const constraint = canGlyphAdjust(node);
  const enabled = constraint.ok;
  const disabledReason = enabled ? undefined : constraint.reason;
  const text = node.text ?? '';

  const clusters = useMemo(() => graphemeClusters(text), [text]);
  const stats = useMemo(() => glyphAdjustmentStats(node), [node]);

  const [selectedCluster, setSelectedCluster] = useState(0);
  const [selectedPair, setSelectedPair] = useState(0);

  const nodeId = node.id;
  const adjustment: GlyphAdjustment | undefined = node.glyphAdjustments?.[selectedCluster];
  const pairValue = node.pairAdjustments?.[selectedPair];

  const clusterOptions = clusters.map((_, index) => ({
    value: String(index),
    label: `${index + 1} · ${clusterLabel(text, index)}`,
  }));
  const pairOptions = clusters.slice(0, -1).map((_, index) => ({
    value: String(index),
    label: `${clusterLabel(text, index)} | ${clusterLabel(text, index + 1)}`,
  }));

  const patchAdjustment = (patch: Partial<GlyphAdjustment>) => {
    if (!enabled) return;
    editor.updateDoc((doc) => setGlyphAdjustment(doc, nodeId, selectedCluster, patch));
  };

  const selectedClusterWithinRange = selectedCluster < clusters.length;
  const selectedPairWithinRange = selectedPair < clusters.length - 1;

  return (
    <div className="glyph-typography">
      <div className="glyph-typography__field">
        <span className="glyph-typography__label">Kerning</span>
        <Select
          label="Kerning mode"
          value={node.kerningMode ?? 'auto'}
          disabled={!enabled}
          onChange={(mode) => {
            editor.updateDoc((doc) =>
              setTextKerningMode(doc, nodeId, mode === 'none' ? 'none' : 'auto'),
            );
          }}
          options={[
            { value: 'auto', label: 'Auto (font kerning)' },
            { value: 'none', label: 'Off' },
          ]}
        />
        <p className="glyph-typography__hint">
          Turning kerning off disables pair kerning between clusters; tracking and manual pair
          adjustments still apply. Ligatures stay independent.
        </p>
      </div>

      {!enabled ? (
        <p className="glyph-typography__hint glyph-typography__hint--muted">{disabledReason}</p>
      ) : (
        <>
          <div className="glyph-typography__field">
            <span className="glyph-typography__label">Glyph adjustments</span>
            <Select
              label="Cluster"
              value={String(selectedCluster)}
              disabled={clusterOptions.length === 0}
              onChange={(value) => setSelectedCluster(Number(value))}
              options={clusterOptions}
            />
            {selectedClusterWithinRange && (
              <div className="glyph-typography__grid">
                <NumberInput
                  label="X"
                  value={adjustment?.dx ?? 0}
                  step={1}
                  min={-1000}
                  max={1000}
                  onChange={(dx) => patchAdjustment({ dx })}
                />
                <NumberInput
                  label="Y"
                  value={adjustment?.dy ?? 0}
                  step={1}
                  min={-1000}
                  max={1000}
                  onChange={(dy) => patchAdjustment({ dy })}
                />
                <NumberInput
                  label="Advance"
                  value={adjustment?.advance ?? 0}
                  step={1}
                  min={-1000}
                  max={1000}
                  onChange={(advance) => patchAdjustment({ advance })}
                />
                <NumberInput
                  label="Rotation°"
                  value={Math.round(((adjustment?.rotation ?? 0) * 180) / Math.PI)}
                  step={1}
                  min={-360}
                  max={360}
                  onChange={(rotation) => patchAdjustment({ rotation: (rotation * Math.PI) / 180 })}
                />
                <NumberInput
                  label="Scale X"
                  value={adjustment?.scaleX ?? 1}
                  step={0.05}
                  min={0.05}
                  max={10}
                  onChange={(scaleX) => patchAdjustment({ scaleX })}
                />
                <NumberInput
                  label="Scale Y"
                  value={adjustment?.scaleY ?? 1}
                  step={0.05}
                  min={0.05}
                  max={10}
                  onChange={(scaleY) => patchAdjustment({ scaleY })}
                />
              </div>
            )}
          </div>

          <div className="glyph-typography__field">
            <span className="glyph-typography__label">Pair spacing</span>
            <Select
              label="Gap"
              value={String(selectedPair)}
              disabled={pairOptions.length === 0}
              onChange={(value) => setSelectedPair(Number(value))}
              options={pairOptions}
            />
            {selectedPairWithinRange && (
              <NumberInput
                label="Spacing px"
                value={pairValue ?? 0}
                step={1}
                min={-1000}
                max={1000}
                onChange={(px) => {
                  editor.updateDoc((doc) => setPairAdjustment(doc, nodeId, selectedPair, px));
                }}
              />
            )}
          </div>

          <div className="glyph-typography__row">
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedClusterWithinRange || adjustment === undefined}
              onClick={() => {
                editor.updateDoc((doc) => setGlyphAdjustment(doc, nodeId, selectedCluster, null));
              }}
            >
              Reset selected
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={stats.adjustedClusters === 0 && stats.adjustedPairs === 0}
              onClick={() => {
                editor.updateDoc((doc) => clearGlyphAdjustments(doc, nodeId));
              }}
            >
              Reset all
            </Button>
          </div>

          {onConvertToOutlines && (
            <div className="glyph-typography__row">
              <Button size="sm" variant="secondary" onClick={onConvertToOutlines}>
                Convert to outlines…
              </Button>
            </div>
          )}

          <p className="glyph-typography__hint glyph-typography__hint--muted">
            {stats.adjustedClusters} cluster{stats.adjustedClusters === 1 ? '' : 's'} and{' '}
            {stats.adjustedPairs} pair{stats.adjustedPairs === 1 ? '' : 's'} adjusted.
          </p>
        </>
      )}
    </div>
  );
}
