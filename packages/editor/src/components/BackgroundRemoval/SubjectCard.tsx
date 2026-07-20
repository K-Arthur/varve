import type { MaskComponent } from '@strata/engine';
import { memo, useCallback } from 'react';
import type { SubjectThumbnail } from './useSubjectThumbnails';

export type ThumbnailPreviewMode = 'isolated' | 'original' | 'mask';

interface SubjectCardProps {
  component: MaskComponent;
  index: number;
  selected: boolean;
  thumbnail?: SubjectThumbnail;
  previewMode: ThumbnailPreviewMode;
  onToggle: (id: number) => void;
  onHoverStart: (id: number) => void;
  onHoverEnd: () => void;
  onFocus: (id: number) => void;
  onBlur: () => void;
  onPreviewModeChange: (id: number, mode: ThumbnailPreviewMode) => void;
}

export const SubjectCard = memo(function SubjectCard({
  component,
  index,
  selected,
  thumbnail,
  previewMode,
  onToggle,
  onHoverStart,
  onHoverEnd,
  onFocus,
  onBlur,
  onPreviewModeChange,
}: SubjectCardProps) {
  const { id, pixelCount, bbox, confidence, relativeArea, isLargest, mergedFrom } = component;

  const handleToggle = useCallback(() => onToggle(id), [id, onToggle]);
  const handleMouseEnter = useCallback(() => onHoverStart(id), [id, onHoverStart]);
  const handleMouseLeave = useCallback(() => onHoverEnd(), [onHoverEnd]);
  const handleFocus = useCallback(() => onFocus(id), [id, onFocus]);
  const handleBlur = useCallback(() => onBlur(), [onBlur]);

  const confidencePercent = Math.round(confidence * 100);
  const areaPercent = (relativeArea * 100).toFixed(1);

  return (
    <li className="subject-card-wrapper">
      <div
        className={`subject-card ${selected ? 'subject-card--selected' : ''}`}
        role="option"
        aria-selected={selected}
        aria-label={`Subject ${index + 1}, ${bbox.w}×${bbox.h} pixels, ${areaPercent}% of image${selected ? ', selected' : ''}${isLargest ? ', largest' : ''}`}
        tabIndex={0}
        onClick={handleToggle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <div className="subject-card__thumb-area">
          <span className="subject-card__number">{index + 1}</span>
          {thumbnail?.thumbnail ? (
            <img
              className="subject-card__thumb"
              src={previewMode === 'mask' ? thumbnail.maskOnly : thumbnail.thumbnail}
              alt={`Subject ${index + 1} preview`}
              draggable={false}
            />
          ) : (
            <div className="subject-card__thumb-placeholder" />
          )}
          {isLargest && <span className="subject-card__badge">Largest</span>}
          {mergedFrom && mergedFrom.length > 0 && (
            <span className="subject-card__badge subject-card__badge--merged">
              Merged ({mergedFrom.length + 1})
            </span>
          )}
        </div>

        <div className="subject-card__info">
          <span className="subject-card__label">Subject {index + 1}</span>
          <span className="subject-card__meta">
            {bbox.w}×{bbox.h} · {areaPercent}%
          </span>
          <div className="subject-card__confidence">
            <div
              className="subject-card__confidence-bar"
              style={{ width: `${confidencePercent}%` }}
            />
            <span className="subject-card__confidence-label">{confidencePercent}%</span>
          </div>
        </div>

        <div className="subject-card__preview-modes" onClick={(e) => e.stopPropagation()}>
          {(['isolated', 'original', 'mask'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`subject-card__mode-btn ${previewMode === mode ? 'subject-card__mode-btn--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onPreviewModeChange(id, mode);
              }}
              aria-label={`${mode} preview`}
              aria-pressed={previewMode === mode}
            >
              {mode === 'isolated' && '✦'}
              {mode === 'original' && '◱'}
              {mode === 'mask' && '◉'}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
});
