import { extractPalette as engineExtractPalette, type PaletteResult } from '@strata/engine';
import { managedColorToCss } from '@strata/shared';
import { Icon } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

interface ExtractionState {
  status: 'idle' | 'loading' | 'done' | 'error';
  result: PaletteResult | null;
  errorMessage: string | null;
  colorCount: number;
}

export function PaletteSection() {
  const { state } = useEditor();
  const selection = state.selection;
  const abortRef = useRef<AbortController | null>(null);

  const [extraction, setExtraction] = useState<ExtractionState>({
    status: 'idle',
    result: null,
    errorMessage: null,
    colorCount: 6,
  });

  const selectedImageNode = selection
    .map((id) => state.document.nodes[id])
    .find((n) => {
      if (!n) return false;
      const nodeAny = n as unknown as Record<string, unknown>;
      const fills = nodeAny.fills as Array<{ type: string; image?: { src: string } }> | undefined;
      return fills?.some((f) => f.type === 'image' && f.image?.src);
    });

  const imageSrc = (() => {
    if (!selectedImageNode) return null;
    const nodeAny = selectedImageNode as unknown as Record<string, unknown>;
    const fills = nodeAny.fills as Array<{ type: string; image?: { src: string } }> | undefined;
    return fills?.find((f) => f.type === 'image')?.image?.src ?? null;
  })();

  const isVisible = !!selectedImageNode;

  const doExtract = useCallback(
    (count: number) => {
      if (!imageSrc) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setExtraction((s) => ({ ...s, status: 'loading', errorMessage: null }));

      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        if (controller.signal.aborted) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setExtraction((s) => ({
            ...s,
            status: 'error',
            errorMessage: 'Failed to get canvas context',
          }));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        try {
          const result = engineExtractPalette(data, count);
          if (controller.signal.aborted) return;
          setExtraction({ status: 'done', result, errorMessage: null, colorCount: count });
        } catch (err) {
          if (controller.signal.aborted) return;
          setExtraction((s) => ({
            ...s,
            status: 'error',
            errorMessage: err instanceof Error ? err.message : 'Extraction failed',
          }));
        }
      };

      img.onerror = () => {
        if (controller.signal.aborted) return;
        setExtraction((s) => ({ ...s, status: 'error', errorMessage: 'Failed to load image' }));
      };

      img.src = imageSrc;
    },
    [imageSrc],
  );

  useEffect(() => {
    const aborter = abortRef.current;
    return () => {
      aborter?.abort();
    };
  }, []);

  const handleExtract = useCallback(() => {
    doExtract(extraction.colorCount);
  }, [doExtract, extraction.colorCount]);

  const handleColorCountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 2 && val <= 24) {
      setExtraction((s) => ({ ...s, colorCount: val }));
    }
  }, []);

  if (!isVisible) return null;

  const swatchStyle: React.CSSProperties = {
    width: 20,
    height: 20,
    borderRadius: 3,
    border: '1px solid var(--color-border-subtle)',
    flexShrink: 0,
  };

  return (
    <DisclosureSection title="Extract Palette" defaultExpanded={false}>
      <div
        style={{
          padding: 'var(--space-1) var(--space-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        <label style={{ fontSize: '0.85em' }}>
          Color count
          <input
            type="number"
            min={2}
            max={24}
            value={extraction.colorCount}
            onChange={handleColorCountChange}
            style={{ width: '100%', padding: '2px 4px', marginTop: 2 }}
            aria-label="Number of colors to extract"
          />
        </label>

        <button
          type="button"
          className="intelligence-action-btn"
          onClick={handleExtract}
          disabled={extraction.status === 'loading'}
        >
          <Icon name="Palette" label={undefined} size="0.85em" />
          {extraction.status === 'loading' ? 'Extracting\u2026' : 'Extract'}
        </button>

        {extraction.status === 'loading' && (
          <div aria-live="polite" style={{ fontSize: '0.85em', opacity: 0.6 }}>
            Extracting colors\u2026
          </div>
        )}

        {extraction.status === 'error' && extraction.errorMessage && (
          <div role="alert" style={{ fontSize: '0.85em', color: 'var(--color-text-critical)' }}>
            {extraction.errorMessage}
          </div>
        )}

        {extraction.status === 'done' &&
          extraction.result &&
          (extraction.result.colors.length === 0 ? (
            <p style={{ fontSize: '0.85em', opacity: 0.6 }}>
              No colors extracted. Try a different image or increase the color count.
            </p>
          ) : (
            <>
              <p style={{ fontSize: '0.8em', opacity: 0.6 }}>
                {extraction.result.colors.length} colors (
                {Math.round(extraction.result.coverage * 100)}% coverage)
              </p>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {extraction.result.colors.map((color, i) => (
                  <div
                    key={`pal-${i}`}
                    style={{ ...swatchStyle, background: managedColorToCss(color) }}
                    title={managedColorToCss(color)}
                    role="img"
                    aria-label={`Color ${i + 1}: ${managedColorToCss(color)}`}
                  />
                ))}
              </div>
            </>
          ))}

        {extraction.status === 'idle' && selectedImageNode && (
          <p style={{ fontSize: '0.8em', opacity: 0.6 }}>
            Extract a color palette from the selected image.
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
