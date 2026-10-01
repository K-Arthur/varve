import type { PatternDefinition } from '@varve/scene';
import { patternFillForDefinition } from '@varve/scene';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createOffsetRasterTileDataUrl } from '../../../patterns/rasterPatternOffset';
import { PatternRepeatPreview } from './PatternRepeatPreview';

interface OffsetPreview {
  key: string;
  dataUrl: string;
  error: string | null;
}

export function PatternRasterOffsetEditor({
  documentId,
  definition,
  assetDataUrl,
  usageCount,
  onApply,
  onCancel,
}: {
  documentId: string;
  definition: PatternDefinition;
  assetDataUrl: string;
  usageCount: number;
  onApply: (
    id: string,
    expectedDocumentId: string,
    expectedRevision: number,
    dataUrl: string,
  ) => boolean;
  onCancel: () => void;
}) {
  const expectedDocumentId = useRef(documentId).current;
  const expectedRevision = useRef(definition.revision).current;
  const requests = useRef(0);
  const source = definition.source;
  const width = source.kind === 'raster' ? source.width : 0;
  const height = source.kind === 'raster' ? source.height : 0;
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const requestKey = `${offsetX}:${offsetY}`;
  const [preview, setPreview] = useState<OffsetPreview>(() => ({
    key: '0:0',
    dataUrl: assetDataUrl,
    error: assetDataUrl ? null : 'The embedded tile is missing or unavailable.',
  }));

  useEffect(() => {
    const request = ++requests.current;
    if (!assetDataUrl) {
      setPreview({
        key: requestKey,
        dataUrl: '',
        error: 'The embedded tile is missing or unavailable.',
      });
      return;
    }
    if (offsetX === 0 && offsetY === 0) {
      setPreview({ key: requestKey, dataUrl: assetDataUrl, error: null });
      return;
    }
    setPreview({ key: requestKey, dataUrl: '', error: null });
    createOffsetRasterTileDataUrl(assetDataUrl, width, height, offsetX, offsetY)
      .then((dataUrl) => {
        if (request === requests.current) setPreview({ key: requestKey, dataUrl, error: null });
      })
      .catch((error: unknown) => {
        if (request === requests.current) {
          setPreview({
            key: requestKey,
            dataUrl: '',
            error: error instanceof Error ? error.message : 'Raster tile offset preview failed.',
          });
        }
      });
    return () => {
      requests.current += 1;
    };
  }, [assetDataUrl, height, offsetX, offsetY, requestKey, width]);

  const stale = documentId !== expectedDocumentId || definition.revision !== expectedRevision;
  const previewReady = preview.key === requestKey && Boolean(preview.dataUrl) && !stale;
  const previewFill = useMemo(
    () => patternFillForDefinition(definition, {}, preview.dataUrl),
    [definition, preview.dataUrl],
  );

  return (
    <section
      className="insp-pattern-source-editor insp-pattern-raster-offset-editor"
      aria-label={`Inspect ${definition.name} raster tile seams`}
    >
      <div className="insp-pattern-source-editor__header">
        <strong>Inspect tile seams</strong>
        <div>
          <button type="button" className="insp-num__input" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="insp-num__input"
            disabled={!previewReady || (offsetX === 0 && offsetY === 0)}
            onClick={() =>
              onApply(definition.id, expectedDocumentId, expectedRevision, preview.dataUrl)
            }
          >
            Apply offset
          </button>
        </div>
      </div>
      <p className="insp-hint" role="note">
        Move the existing tile pixels across the boundary to inspect the join. This changes the
        shared raster source for {usageCount} fill{usageCount === 1 ? '' : 's'}; it does not repair
        the image or enable wraparound painting. Apply stores a new embedded PNG tile.
      </p>
      {stale ? (
        <p className="insp-hint" role="alert">
          This pattern or document changed. Cancel and reopen seam inspection before applying.
        </p>
      ) : null}
      {preview.error ? (
        <p className="insp-hint" role="alert">
          {preview.error}
        </p>
      ) : null}
      {!previewReady && !preview.error && !stale ? (
        <p className="insp-hint" role="status">
          Preparing offset preview…
        </p>
      ) : null}
      {previewReady ? <PatternRepeatPreview pattern={previewFill} /> : null}
      <fieldset className="insp-pattern-source-editor__transform">
        <legend>
          Source tile offset · {width} by {height} pixels
        </legend>
        <label>
          Horizontal offset (pixels)
          <input
            className="insp-num__input"
            aria-label="Raster tile offset X"
            type="number"
            min={0}
            max={Math.max(0, width - 1)}
            step={1}
            value={offsetX}
            disabled={stale}
            onChange={(event) => setOffsetX(Number(event.currentTarget.value))}
          />
        </label>
        <label>
          Vertical offset (pixels)
          <input
            className="insp-num__input"
            aria-label="Raster tile offset Y"
            type="number"
            min={0}
            max={Math.max(0, height - 1)}
            step={1}
            value={offsetY}
            disabled={stale}
            onChange={(event) => setOffsetY(Number(event.currentTarget.value))}
          />
        </label>
      </fieldset>
    </section>
  );
}
