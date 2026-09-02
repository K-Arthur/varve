import type { FileRejection, FileSelectionOptions } from '@varve/shared';
import { validateFileSelection } from '@varve/shared';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { FilePickerButton } from './FilePickerButton';

import './FileDropZone.css';

type DropState = 'idle' | 'drag-active' | 'accepted' | 'rejected';

export interface FileDropZoneProps extends FileSelectionOptions {
  /** Action-specific visible heading, e.g. “Drop images to import”. */
  label: string;
  description?: string;
  actionLabel?: string;
  icon?: IconName;
  size?: 'compact' | 'large';
  disabled?: boolean;
  processing?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  onReject?: (rejections: FileRejection<File>[]) => void;
  className?: string;
}

/**
 * Shared drag surface for local file acquisition. It deliberately owns only
 * interaction state and early selection checks; import semantics stay with
 * the feature that consumes `onFiles`.
 */
export function FileDropZone({
  label,
  description,
  actionLabel = 'Browse',
  icon = 'FileUp',
  size = 'large',
  disabled = false,
  processing = false,
  accept,
  multiple = false,
  maxFiles,
  maxSize,
  minSize,
  onFiles,
  onReject,
  className = '',
}: FileDropZoneProps) {
  const [dropState, setDropState] = useState<DropState>('idle');
  const [handling, setHandling] = useState(false);
  const dragDepthRef = useRef(0);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const describedBy = description ? `${label.replace(/\W+/g, '-').toLowerCase()}-hint` : undefined;
  const busy = processing || handling;

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    },
    [],
  );

  const showFeedback = useCallback((state: Exclude<DropState, 'idle' | 'drag-active'>) => {
    setDropState(state);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setDropState('idle'), 1800);
  }, []);

  const handleRejected = useCallback(
    (rejections: FileRejection<File>[]) => {
      showFeedback('rejected');
      onReject?.(rejections);
    },
    [onReject, showFeedback],
  );

  const handleAccepted = useCallback(
    async (files: File[]) => {
      showFeedback('accepted');
      setHandling(true);
      try {
        await onFiles(files);
      } finally {
        setHandling(false);
      }
    },
    [onFiles, showFeedback],
  );

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLFieldSetElement>) => {
      if (disabled || busy || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      dragDepthRef.current += 1;
      setDropState('drag-active');
    },
    [busy, disabled],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLFieldSetElement>) => {
      if (disabled || busy || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [busy, disabled],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLFieldSetElement>) => {
      if (disabled || busy) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDropState('idle');
    },
    [busy, disabled],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLFieldSetElement>) => {
      if (disabled || busy) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      const files = Array.from(event.dataTransfer.files);
      const result = validateFileSelection(files, { accept, maxFiles, maxSize, minSize });
      if (result.rejected.length > 0) handleRejected(result.rejected);
      if (result.accepted.length > 0) void handleAccepted(result.accepted);
      if (result.accepted.length === 0 && result.rejected.length === 0) setDropState('idle');
    },
    [accept, busy, disabled, handleAccepted, handleRejected, maxFiles, maxSize, minSize],
  );

  const state = disabled ? 'disabled' : busy ? 'processing' : dropState;
  const classes = ['file-drop-zone', `file-drop-zone--${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <fieldset
      className={classes}
      data-state={state}
      aria-busy={busy || undefined}
      aria-describedby={describedBy}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <legend className="varve-visually-hidden">{label}</legend>
      <Icon name={icon} label={undefined} className="file-drop-zone__icon" />
      <div className="file-drop-zone__copy">
        <strong className="file-drop-zone__label">{label}</strong>
        {description && (
          <span id={describedBy} className="file-drop-zone__description">
            {description}
          </span>
        )}
      </div>
      <FilePickerButton
        variant="secondary"
        size={size === 'compact' ? 'sm' : 'md'}
        accept={accept}
        multiple={multiple}
        maxFiles={maxFiles}
        maxSize={maxSize}
        minSize={minSize}
        disabled={disabled || busy}
        actionLabel={actionLabel}
        inputLabel={actionLabel}
        onFiles={handleAccepted}
        onReject={handleRejected}
      />
      {state === 'processing' && <span className="file-drop-zone__state">Processing files…</span>}
      {state === 'accepted' && <span className="file-drop-zone__state">Files ready</span>}
      {state === 'rejected' && (
        <span className="file-drop-zone__state">Some files were rejected</span>
      )}
      {disabled && <span className="file-drop-zone__state">File selection is unavailable</span>}
    </fieldset>
  );
}
