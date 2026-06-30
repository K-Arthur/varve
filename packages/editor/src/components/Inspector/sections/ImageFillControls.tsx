/**
 * ImageFillControls — image fill sizing/position controls.
 *
 * Stub implementation: shows fit mode selector and source URL.
 * Full implementation lands with the asset system (Phase 2).
 *
 * Research basis: Figma image fill controls.
 */
import type { ImageFillData, ImageFit } from '@strata/scene';
import { useCallback } from 'react';
import { FieldRow } from '../controls/FieldRow';

const FIT_OPTIONS: { value: ImageFit; label: string }[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'tile', label: 'Tile' },
];

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  height: 'var(--space-5)',
  fontSize: 'var(--font-size-xs)',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-2)',
};

export function ImageFillControls({
  image,
  onChange,
}: {
  image: ImageFillData;
  onChange: (img: ImageFillData) => void;
}) {
  const handleFitChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange({ ...image, fit: e.target.value as ImageFit });
    },
    [image, onChange],
  );

  const handleSrcChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...image, src: e.target.value });
    },
    [image, onChange],
  );

  return (
    <div style={{ marginTop: 'var(--space-1)' }}>
      <FieldRow label="Source">
        <input
          type="text"
          value={image.src}
          onChange={handleSrcChange}
          aria-label="Image source URL"
          style={SELECT_STYLE}
        />
      </FieldRow>
      <FieldRow label="Fit">
        <select
          value={image.fit}
          onChange={handleFitChange}
          aria-label="Image fit mode"
          style={SELECT_STYLE}
        >
          {FIT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldRow>
    </div>
  );
}
