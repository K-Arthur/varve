/**
 * SubjectPickerOverlay — multi-subject mask component selector.
 *
 * Shown when AI segmentation returns multiple disconnected foreground regions.
 * Displays visual subject cards with thumbnails, mask previews, and
 * canvas highlighting. Users can toggle, select all, merge, and preview
 * the combined result before committing.
 */

import type { MaskComponent } from '@varve/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../BackgroundRemoval/SubjectCard.css';
import '../BackgroundRemoval/CombinedPreview.css';
import { CombinedPreview } from './CombinedPreview';
import { SubjectCard, type ThumbnailPreviewMode } from './SubjectCard';
import { useSubjectThumbnails } from './useSubjectThumbnails';

export interface SubjectPickerSession {
  nodeId: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  components: MaskComponent[];
  /** Component ids selected for keep (defaults to largest). */
  keepIds: number[];
  /** Pending mask data URL before component filter applied. */
  pendingMaskDataUrl: string;
  /** Source image data URL or file path for thumbnail generation. */
  sourceImageSrc: string;
  method: string;
  confidence: number;
  feather: number;
  decontaminate: boolean;
}

interface SubjectPickerOverlayProps {
  session: SubjectPickerSession;
  onConfirm: (keepIds: number[]) => void;
  onCancel: () => void;
  /** Called when a card is hovered/focused, for canvas highlighting. */
  onHighlight?: (componentId: number | null) => void;
  /** Called when components are modified (merge, reset). */
  onComponentsChange?: (components: MaskComponent[]) => void;
}

export function SubjectPickerOverlay({
  session,
  onConfirm,
  onCancel,
  onHighlight,
}: SubjectPickerOverlayProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(session.keepIds));
  const [previewModes, setPreviewModes] = useState<Map<number, ThumbnailPreviewMode>>(
    () => new Map(),
  );
  const [localComponents] = useState<MaskComponent[]>(() => [...session.components]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Generate thumbnails
  const thumbnails = useSubjectThumbnails(
    session.sourceImageSrc,
    localComponents,
    session.pendingMaskDataUrl,
    session.sourceWidth,
    session.sourceHeight,
  );

  // Open dialog on mount
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(session.components.map((c) => c.id)));
  }, [session.components]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const keepAll = useCallback(() => {
    onConfirm(localComponents.map((c) => c.id));
  }, [localComponents, onConfirm]);

  const handleHoverStart = useCallback((id: number) => onHighlight?.(id), [onHighlight]);

  const handleHoverEnd = useCallback(() => onHighlight?.(null), [onHighlight]);

  const handleFocus = useCallback((id: number) => onHighlight?.(id), [onHighlight]);

  const handleBlur = useCallback(() => onHighlight?.(null), [onHighlight]);

  const handlePreviewModeChange = useCallback((id: number, mode: ThumbnailPreviewMode) => {
    setPreviewModes((prev) => new Map(prev).set(id, mode));
  }, []);

  // Keyboard navigation within the list
  // (navigation is handled by the dialog's built-in focus management)

  const selectedCount = selected.size;
  const totalCount = session.components.length;

  // Sort components: selected first, then by original order (pixel count desc)
  const sortedComponents = useMemo(() => {
    return [...localComponents].sort((a, b) => {
      const aSelected = selected.has(a.id) ? 0 : 1;
      const bSelected = selected.has(b.id) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return b.pixelCount - a.pixelCount;
    });
  }, [localComponents, selected]);

  const handleConfirm = useCallback(() => {
    onConfirm([...selected]);
  }, [selected, onConfirm]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === dialogRef.current) {
        onCancel();
      }
    },
    [onCancel],
  );

  return (
    <dialog
      ref={dialogRef}
      className="subject-picker-dialog"
      aria-modal="true"
      aria-label="Select subjects to keep"
      onClose={onCancel}
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="subject-picker-panel">
        <div className="subject-picker-header">
          <h3 className="subject-picker-title">Multiple subjects detected</h3>
          <p className="subject-picker-hint">
            {totalCount} regions found. Click to include or exclude each one.
          </p>
        </div>

        <div className="subject-picker-toolbar">
          <button
            type="button"
            className="varve-btn varve-btn--ghost varve-btn--sm"
            onClick={selectAll}
          >
            Select all
          </button>
          <button
            type="button"
            className="varve-btn varve-btn--ghost varve-btn--sm"
            onClick={deselectAll}
          >
            Deselect all
          </button>
          <span className="subject-picker-toolbar__count" aria-live="polite">
            {selectedCount} of {totalCount} selected
          </span>
        </div>

        <ul ref={listRef} className="subject-picker-grid" aria-label="Detected subjects">
          {sortedComponents.map((c, _i) => (
            <SubjectCard
              key={c.id}
              component={c}
              index={session.components.indexOf(c)}
              selected={selected.has(c.id)}
              thumbnail={thumbnails.get(c.id)}
              previewMode={previewModes.get(c.id) ?? 'isolated'}
              onToggle={toggle}
              onHoverStart={handleHoverStart}
              onHoverEnd={handleHoverEnd}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onPreviewModeChange={handlePreviewModeChange}
            />
          ))}
        </ul>

        {/* Combined result preview */}
        {selectedCount > 0 && (
          <CombinedPreview
            sourceImageSrc={session.sourceImageSrc}
            maskDataUrl={session.pendingMaskDataUrl}
            sourceWidth={session.sourceWidth}
            sourceHeight={session.sourceHeight}
            selectedCount={selectedCount}
            totalCount={totalCount}
          />
        )}

        <div className="subject-picker-actions">
          <button
            type="button"
            className="varve-btn varve-btn--primary"
            disabled={selectedCount === 0}
            onClick={handleConfirm}
          >
            {selectedCount === totalCount
              ? `Keep all (${totalCount})`
              : selectedCount === 0
                ? 'No subjects selected'
                : `Keep ${selectedCount} subject${selectedCount > 1 ? 's' : ''}`}
          </button>
          {selectedCount > 0 && selectedCount < totalCount && (
            <button type="button" className="varve-btn varve-btn--ghost" onClick={keepAll}>
              Keep all ({totalCount})
            </button>
          )}
          <button type="button" className="varve-btn varve-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
