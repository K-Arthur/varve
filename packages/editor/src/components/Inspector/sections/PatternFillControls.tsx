/**
 * PatternFillControls — pattern fill tile source, dimensions, spacing, rotation.
 *
 * Supports URL entry and local file pick (FileReader to data URL). Preview when
 * tileSrc is set. Tile width/height overrides let users scale the tile via
 * imageWidth/imageHeight without altering the source image.
 *
 * Research basis: Figma pattern fill controls; APG file input patterns.
 */
import type { PatternFillData } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useCallback, useEffect, useId, useRef } from 'react';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';

export function PatternFillControls({
  pattern,
  onChange,
}: {
  pattern: PatternFillData;
  onChange: (p: PatternFillData) => void;
}) {
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSrc = Boolean(pattern.tileSrc);

  // Direct native listener (NOT React's delegated onChange): the file dialog
  // can overlap an inspector subtree re-key, which detaches the DOM node
  // while the dialog is open. A native listener on the node itself still
  // receives the change; React's root-delegated listener loses it and the
  // user's file choice silently vanishes.
  const handleFileChange = useCallback(
    (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          onChange({ ...pattern, tileSrc: result });
        }
      };
      reader.readAsDataURL(file);
    },
    [pattern, onChange],
  );

  useEffect(() => {
    const input = fileRef.current;
    if (!input) return;
    input.addEventListener('change', handleFileChange);
    return () => input.removeEventListener('change', handleFileChange);
  }, [handleFileChange]);

  const clearTile = useCallback(() => {
    onChange({ ...pattern, tileSrc: '' });
  }, [pattern, onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {hasSrc && (
        <div className="insp-image-fill__preview" aria-hidden>
          <img src={pattern.tileSrc} alt="" className="insp-image-fill__preview-img" />
        </div>
      )}

      {!hasSrc && (
        <p className="insp-hint insp-image-fill__empty-hint" role="note">
          No tile selected — the fill is transparent until you choose one.
        </p>
      )}

      <div className="insp-image-fill__actions">
        <input
          ref={fileRef}
          id={fileInputId}
          type="file"
          accept="image/*"
          className="insp-image-fill__file"
          aria-hidden
          tabIndex={-1}
        />
        <button
          type="button"
          className="insp-add-btn insp-image-fill__choose"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="Image" label={undefined} size="0.85em" />
          <span>{hasSrc ? 'Replace tile' : 'Choose tile'}</span>
        </button>
        {hasSrc && (
          <button
            type="button"
            className="insp-inline-btn"
            onClick={clearTile}
            aria-label="Clear tile"
          >
            <Icon name="X" label={undefined} size="0.85em" />
          </button>
        )}
      </div>

      <FieldRow label="Source">
        <input
          type="text"
          value={pattern.tileSrc}
          aria-label="Pattern tile source"
          placeholder="URL or choose a file"
          onChange={(e) => onChange({ ...pattern, tileSrc: e.target.value })}
          className="insp-num__input"
        />
      </FieldRow>
      <NumberField
        label="Tile width"
        unit="px"
        value={pattern.imageWidth ?? 0}
        min={1}
        onChange={(v) => onChange({ ...pattern, imageWidth: v || undefined })}
      />
      <NumberField
        label="Tile height"
        unit="px"
        value={pattern.imageHeight ?? 0}
        min={1}
        onChange={(v) => onChange({ ...pattern, imageHeight: v || undefined })}
      />
      <NumberField
        label="Spacing"
        unit="px"
        value={pattern.spacing}
        min={0}
        onChange={(v) => onChange({ ...pattern, spacing: v })}
      />
      <NumberField
        label="Rotation"
        unit="deg"
        value={pattern.rotation}
        onChange={(v) => onChange({ ...pattern, rotation: v })}
      />
    </div>
  );
}
