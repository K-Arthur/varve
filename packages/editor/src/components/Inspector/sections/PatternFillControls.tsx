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

  // Ref-forwarded handler so all listeners stay attached once per node
  // lifetime while always invoking the logic for the CURRENT render.
  const handleFileChangeRef = useRef(handleFileChange);
  useEffect(() => {
    handleFileChangeRef.current = handleFileChange;
  });

  // The file-pick change must never be missed: a node-bound native listener
  // (survives detach mid-dialog) plus a document-capture fallback for a
  // subtree remount that replaces the input while the OS dialog is open.
  const pickPendingRef = useRef(false);
  useEffect(() => {
    const dispatch = (e: Event) => {
      pickPendingRef.current = false;
      handleFileChangeRef.current(e);
    };
    const nodeHandler = (e: Event) => dispatch(e);
    const input = fileRef.current;
    input?.addEventListener('change', nodeHandler);
    const onDocChange = (e: Event) => {
      if (!pickPendingRef.current) return;
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
      if (target === fileRef.current) return; // node listener handled it
      if (!target.classList.contains('insp-image-fill__file')) return;
      dispatch(e);
    };
    const onDocClick = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
      if (!target.classList.contains('insp-image-fill__file')) return;
      pickPendingRef.current = true;
    };
    document.addEventListener('change', onDocChange, true);
    document.addEventListener('click', onDocClick, true);
    return () => {
      // The node listener is intentionally NOT removed on cleanup: if the
      // node is detached by a remount while the OS dialog is open, removing
      // it here would lose the user's file choice.
      document.removeEventListener('change', onDocChange, true);
      document.removeEventListener('click', onDocClick, true);
    };
  }, []);

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
