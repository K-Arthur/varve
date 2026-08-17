import type { ManagedColor } from '@varve/scene';
import { managedColorToCss } from '@varve/shared';
import { Dialog, Select, Tooltip } from '@varve/ui';
import { useCallback, useState } from 'react';
import type { MappingMode, MappingResult } from '../intelligence/paletteMapper';

export interface PaletteEntry {
  color: ManagedColor;
  name?: string;
  source?: 'extracted' | 'proposed';
  warning?: string;
}

export interface PalettePreviewDialogProps {
  open: boolean;
  title: string;
  sourceEntries: PaletteEntry[];
  proposedEntries?: PaletteEntry[];
  mappingResult?: MappingResult | null;
  affectedNodeCount?: number;
  onApply: (mode: MappingMode) => void;
  onCancel: () => void;
  onRegenerate?: () => void;
  onSaveAsSwatches?: () => void;
  onExcludeMapping?: (nodeId: string, fillIndex: number) => void;
  loading?: boolean;
  error?: string | null;
}

const MODE_LABELS: Record<MappingMode, string> = {
  nearest: 'Nearest color',
  'preserve-lightness': 'Preserve lightness',
  'preserve-contrast': 'Preserve contrast',
  'fill-slot-only': 'Selected fill slots only',
};

export function PalettePreviewDialog({
  open,
  title,
  sourceEntries,
  proposedEntries,
  mappingResult,
  affectedNodeCount,
  onApply,
  onCancel,
  onRegenerate,
  onSaveAsSwatches,
  onExcludeMapping,
  loading,
  error,
}: PalettePreviewDialogProps) {
  const [mode, setMode] = useState<MappingMode>('nearest');
  const [showAllMappings, setShowAllMappings] = useState(false);

  const handleApply = useCallback(() => onApply(mode), [onApply, mode]);

  const hasBeforeAfter = proposedEntries && proposedEntries.length > 0;

  const swatchStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 4,
    border: '1px solid var(--color-border-subtle)',
    flexShrink: 0,
  };

  const contrastRegressions = mappingResult?.contrastRegressions ?? [];
  const hasWarnings =
    mappingResult?.wouldChangeSharedStyle ||
    contrastRegressions.length > 0 ||
    sourceEntries.some((e) => e.warning) ||
    !!error ||
    mappingResult?.mappings.some((m) => m.warning);

  return (
    <Dialog open={open} onClose={onCancel} title={title} className="palette-preview-dialog">
      <div style={{ minWidth: 480, maxWidth: 640, padding: 'var(--space-3)' }}>
        {error && (
          <div
            role="alert"
            style={{
              padding: 'var(--space-2)',
              background: 'var(--color-feedback-danger)',
              borderRadius: 4,
              marginBottom: 'var(--space-2)',
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <div aria-live="polite" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
            Extracting palette…
          </div>
        )}

        {!loading && !error && (
          <>
            {hasBeforeAfter && (
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Source palette ({sourceEntries.length} colors)
                </p>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {sourceEntries.map((entry, i) => (
                    <Tooltip
                      // biome-ignore lint/suspicious/noArrayIndexKey: palette entries have no unique id; names/colors can repeat
                      key={`src-${i}`}
                      label={`${entry.name ?? `Color ${i + 1}`}${entry.warning ? ` — ${entry.warning}` : ''}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div
                          style={{
                            ...swatchStyle,
                            background: managedColorToCss(entry.color),
                          }}
                          role="img"
                          aria-label={`${entry.name ?? `Color ${i + 1}`}: ${managedColorToCss(entry.color)}`}
                        />
                        {entry.warning && (
                          <span
                            style={{
                              fontSize: '0.75em',
                              color: 'var(--color-feedback-warning-strong)',
                            }}
                          >
                            !
                          </span>
                        )}
                      </div>
                    </Tooltip>
                  ))}
                </div>
              </div>
            )}

            {proposedEntries && proposedEntries.length > 0 && (
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>Proposed palette</p>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {proposedEntries.map((entry, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: palette entries have no unique id; names/colors can repeat
                    <Tooltip key={`dst-${i}`} label={entry.name ?? `Color ${i + 1}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div
                          style={{
                            ...swatchStyle,
                            background: managedColorToCss(entry.color),
                          }}
                          role="img"
                          aria-label={`${entry.name ?? `Color ${i + 1}`}: ${managedColorToCss(entry.color)}`}
                        />
                        {entry.name && (
                          <span
                            style={{
                              fontSize: '0.75em',
                              maxWidth: 80,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {entry.name}
                          </span>
                        )}
                      </div>
                    </Tooltip>
                  ))}
                </div>
              </div>
            )}

            {hasWarnings && (
              <div
                style={{
                  marginBottom: 'var(--space-2)',
                  padding: 'var(--space-1) var(--space-2)',
                  background: 'var(--color-feedback-warning)',
                  borderRadius: 4,
                  fontSize: '0.85em',
                }}
                role="status"
              >
                {mappingResult?.wouldChangeSharedStyle && (
                  <p>
                    This will modify shared styles used by {mappingResult.sharedStyleDetails.length}{' '}
                    style
                    {mappingResult.sharedStyleDetails.length === 1 ? '' : 's'}.
                  </p>
                )}
                {contrastRegressions.length > 0 && (
                  <p>
                    {contrastRegressions.length} mapping
                    {contrastRegressions.length === 1 ? '' : 's'} may reduce contrast.
                  </p>
                )}
                {sourceEntries.some((e) => e.warning) && <p>Some source colors have warnings.</p>}
                {error && <p>{error}</p>}
              </div>
            )}

            <div style={{ marginBottom: 'var(--space-2)' }}>
              <Select
                label="Mapping mode"
                value={mode}
                onChange={(v) => setMode(v as MappingMode)}
                options={(Object.keys(MODE_LABELS) as MappingMode[]).map((m) => ({
                  value: m,
                  label: MODE_LABELS[m],
                }))}
              />
            </div>

            {affectedNodeCount != null && (
              <p style={{ fontSize: '0.85em', opacity: 0.7, marginBottom: 'var(--space-2)' }}>
                Affects {affectedNodeCount} node{affectedNodeCount === 1 ? '' : 's'}
              </p>
            )}

            {mappingResult && mappingResult.mappings.length > 0 && (
              <details
                open={showAllMappings}
                onToggle={(e) => setShowAllMappings((e.target as HTMLDetailsElement).open)}
                style={{ marginBottom: 'var(--space-2)' }}
              >
                <summary style={{ fontSize: '0.85em', cursor: 'pointer' }}>
                  {mappingResult.mappings.length} mapping
                  {mappingResult.mappings.length === 1 ? '' : 's'}
                </summary>
                <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                  {mappingResult.mappings.map((m) => (
                    <div
                      key={`m-${m.nodeId}-${m.fillIndex}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 0',
                        fontSize: '0.8em',
                      }}
                    >
                      <div
                        style={{
                          ...swatchStyle,
                          background: managedColorToCss(m.originalColor),
                          width: 16,
                          height: 16,
                        }}
                      />
                      <span>&rarr;</span>
                      <div
                        style={{
                          ...swatchStyle,
                          background: managedColorToCss(m.mappedColor),
                          width: 16,
                          height: 16,
                        }}
                      />
                      <span style={{ opacity: 0.6, marginLeft: 4 }}>
                        &Delta;E {m.deltaE.toFixed(1)}
                      </span>
                      {m.contrastPreserved === false && (
                        <Tooltip label="Contrast may be reduced">
                          <span
                            style={{
                              color: 'var(--color-feedback-warning-strong)',
                              fontSize: '0.9em',
                            }}
                          >
                            !
                          </span>
                        </Tooltip>
                      )}
                      {onExcludeMapping && (
                        <button
                          type="button"
                          onClick={() => onExcludeMapping(m.nodeId, m.fillIndex)}
                          style={{
                            marginLeft: 'auto',
                            fontSize: '0.8em',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-text-muted)',
                          }}
                          aria-label={`Exclude mapping for ${m.nodeId} fill ${m.fillIndex}`}
                        >
                          Exclude
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-1)',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-3)',
            borderTop: '1px solid var(--color-border-subtle)',
            paddingTop: 'var(--space-2)',
          }}
        >
          <button type="button" className="varve-btn varve-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          {onSaveAsSwatches && (
            <button
              type="button"
              className="varve-btn varve-btn--secondary"
              onClick={onSaveAsSwatches}
            >
              Save as swatches
            </button>
          )}
          {onRegenerate && (
            <button
              type="button"
              className="varve-btn varve-btn--secondary"
              onClick={onRegenerate}
              disabled={loading}
            >
              Regenerate
            </button>
          )}
          <button
            type="button"
            className="varve-btn varve-btn--primary"
            onClick={handleApply}
            disabled={loading || !!error}
          >
            Apply
          </button>
        </div>
      </div>
    </Dialog>
  );
}
