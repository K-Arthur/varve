/**
 * SubjectPickerOverlay — multi-subject mask component selector.
 *
 * Shown when AI segmentation returns multiple disconnected foreground regions.
 * Displays visual subject cards with thumbnails, mask previews, and
 * canvas highlighting. Users can toggle, select all, merge, and preview
 * the combined result before committing.
 */

import type { MaskComponent } from '@strata/engine';
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
  onComponentsChange,
}: SubjectPickerOverlayProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(session.keepIds));
  const [previewModes, setPreviewModes] = useState<Map<number, ThumbnailPreviewMode>>(
    () => new Map(),
  );
  const [localComponents, setLocalComponents] = useState<MaskComponent[]>(() => [...session.components]);
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

  const mergeSelected = useCallback(() => {
    if (selected.size < 2) return;
    const selectedIds = [...selected];
    const mergedPixelCount = localComponents
      .filter((c) => selectedIds.includes(c.id))
      .reduce((sum, c) => sum + c.pixelCount, 0);
    const mergedBbox = localComponents
      .filter((c) => selectedIds.includes(c.id))
      .reduce(
        (acc, c) => ({
          x: Math.min(acc.x, c.bbox.x),
          y: Math.min(acc.y, c.bbox.y),
          w: Math.max(acc.x + acc.w, c.bbox.x + c.bbox.w) - Math.min(acc.x, c.bbox.x),
          h: Math.max(acc.y + acc.h, c.bbox.y + c.bbox.h) - Math.min(acc.y, c.bbox.y),
        }),
        { x: Infinity, y: Infinity, w: 0, h: 0 },
      );
    const mergedCenterOfMass = localComponents
      .filter((c) => selectedIds.includes(c.id))
      .reduce(
        (acc, c) => ({
          x: (acc.x * acc.pixelCount + c.centerOfMass.x * c.pixelCount) / (acc.pixelCount + c.pixelCount),
          y: (acc.y * acc.pixelCount + c.centerOfMass.y * c.pixelCount) / (acc.pixelCount + c.pixelCount),
        }),
        { x: 0, y: 0, pixelCount: 0 },
      );
    mergedCenterOfMass.pixelCount = mergedPixelCount;

    const mergedComponent: MaskComponent = {
      id: Math.max(...localComponents.map((c) => c.id)) + 1,
      pixelCount: mergedPixelCount,
      bbox: mergedBbox,
      confidence: localComponents
        .filter((c) => selectedIds.includes(c.id))
        .reduce((sum, c) => sum + c.confidence * c.pixelCount, 0) / mergedPixelCount,
      relativeArea: mergedPixelCount / (session.width * session.height),
      centerOfMass: { x: mergedCenterOfMass.x, y: mergedCenterOfMass.y },
      edgePixelCount: localComponents
        .filter((c) => selectedIds.includes(c.id))
        .reduce((sum, c) => sum + c.edgePixelCount, 0),
      isLargest: false,
      mergedFrom: selectedIds,
    };

    const newComponents = [
      ...localComponents.filter((c) => !selectedIds.includes(c.id)),
      mergedComponent,
    ].sort((a, b) => b.pixelCount - a.pixelCount);

    // Mark the largest
    if (newComponents.length > 0 && newComponents[0]) {
      newComponents[0].isLargest = true;
    }

    setLocalComponents(newComponents);
    setSelected(new Set([mergedComponent.id]));
    onComponentsChange?.(newComponents);
  }, [selected, localComponents, session.width, session.height, onComponentsChange]);

  const resetComponents = useCallback(() => {
    setLocalComponents([...session.components]);
    setSelected(new Set(session.keepIds));
    onComponentsChange?.(session.components);
  }, [session.components, session.keepIds, onComponentsChange]);

  const handleHoverStart = useCallback((id: number) => onHighlight?.(id), [onHighlight]);

  const handleHoverEnd = useCallback(() => onHighlight?.(null), [onHighlight]);

  const handleFocus = useCallback((id: number) => onHighlight?.(id), [onHighlight]);

  const handleBlur = useCallback(() => onHighlight?.(null), [onHighlight]);

  const handlePreviewModeChange = useCallback((id: number, mode: ThumbnailPreviewMode) => {
    setPreviewModes((prev) => new Map(prev).set(id, mode));
  }, []);

  // Keyboard navigation within the list
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        selectAll();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const items = listRef.current?.querySelectorAll('[role="option"]');
        if (items && items.length > 0) {
          const focused = document.activeElement;
          const idx = Array.from(items).indexOf(focused as Element);
          const next = idx < items.length - 1 ? idx + 1 : 0;
          (items[next] as HTMLElement)?.focus();
        }
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const items = listRef.current?.querySelectorAll('[role="option"]');
        if (items && items.length > 0) {
          const focused = document.activeElement;
          const idx = Array.from(items).indexOf(focused as Element);
          const prev = idx > 0 ? idx - 1 : items.length - 1;
          (items[prev] as HTMLElement)?.focus();
        }
      }
    },
    [selectAll],
  );

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
      role="dialog"
      aria-modal="true"
      aria-label="Select subjects to keep"
      onClose={onCancel}
      onClick={handleBackdropClick}
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
            className="button--ghost subject-picker-toolbar__btn"
            onClick={selectAll}
          >
            Select all
          </button>
          <button
            type="button"
            className="button--ghost subject-picker-toolbar__btn"
            onClick={deselectAll}
          >
            Deselect all
          </button>
          <span className="subject-picker-toolbar__count" aria-live="polite">
            {selectedCount} of {totalCount} selected
          </span>
        </div>

        <ul
          ref={listRef}
          className="subject-picker-grid"
          role="listbox"
          aria-label="Detected subjects"
          onKeyDown={handleKeyDown}
        >
          {sortedComponents.map((c, i) => (
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
            className="button--primary"
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
            <button type="button" className="button--ghost" onClick={keepAll}>
              Keep all ({totalCount})
            </button>
          )}
          <button type="button" className="button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
