/**
 * ThumbnailPickerDialog — choose what represents a Varve design.
 *
 * Sources: Automatic, Page, Selected Frame, Selection. Every source is
 * previewed through the canonical thumbnail pipeline before committing;
 * the preference is persisted on the FileEntry and survives restarts. A
 * source that no longer exists is surfaced instead of silently failing.
 *
 * Accessibility: fully keyboard-operable (radio semantics, Escape closes,
 * focus restored on close), labels every control, and never announces
 * loading repeatedly.
 */

import type { ThumbnailSourcePreference } from '@varve/platform';
import { Button, Dialog, Icon } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { persistProjectThumbnail, preferenceToSource } from '../../thumbnail/thumbnailManager';
import { renderDocThumbnail } from '../../thumbnail/thumbnailService';
import './thumbnailpicker.css';

export interface ThumbnailPickerDialogProps {
  open: boolean;
  onClose: () => void;
}

type PickerSource = ThumbnailSourcePreference;

export function ThumbnailPickerDialog({ open, onClose }: ThumbnailPickerDialogProps) {
  const { state, platform, showToast } = useEditor();
  const doc = state.document;
  const currentFileId = state.sessions.find((s) => s.id === state.activeId)?.fileId;

  const [source, setSource] = useState<PickerSource>({ type: 'automatic' });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fallbackApplied, setFallbackApplied] = useState(false);
  const [saved, setSaved] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const pages = doc.pages ?? [];
  const selection = state.selection;
  const singleNode = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;
  const frameCandidate =
    singleNode && (singleNode.kind === 'frame' || singleNode.kind === 'group')
      ? selection[0]!
      : undefined;

  // Load the persisted preference when the dialog opens; restore focus on close.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    let cancelled = false;
    setSaved(false);
    if (platform && currentFileId) {
      void platform
        .getFile(currentFileId)
        .then((entry) => {
          if (cancelled || !entry?.thumbnailPreference) return;
          setSource(entry.thumbnailPreference);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [open, platform, currentFileId]);

  // Preview the selected source through the canonical pipeline.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreviewStatus('loading');
    setFallbackApplied(false);
    const controller = new AbortController();
    void (async () => {
      try {
        const outcome = await renderDocThumbnail(doc, {
          fileId: currentFileId,
          source: preferenceToSource(source),
          variant: {
            role: 'picker-preview',
            width: 256,
            height: 192,
            fit: 'contain',
            background: { type: 'checkerboard' },
            format: 'png',
            devicePixelRatio: 1,
          },
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted) return;
        setFallbackApplied(outcome.fallbackApplied);
        if (outcome.result?.dataUrl) {
          setPreviewUrl(outcome.result.dataUrl);
          setPreviewStatus('ready');
        } else {
          setPreviewUrl(null);
          setPreviewStatus('error');
        }
      } catch {
        if (!cancelled) setPreviewStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, source, doc, currentFileId]);

  const handleApply = useCallback(async () => {
    if (!platform || !currentFileId) {
      showToast({ message: 'Save the file once before choosing a thumbnail', type: 'warning' });
      return;
    }
    try {
      await platform.setThumbnailPreference(currentFileId, source);
      persistProjectThumbnail(platform, doc, {
        fileId: currentFileId,
        preference: source,
        priority: 'current-doc',
      });
      setSaved(true);
      showToast({ message: 'File thumbnail updated', type: 'success' });
    } catch {
      showToast({ message: 'Could not save thumbnail choice', type: 'error' });
    }
  }, [platform, currentFileId, source, doc, showToast]);

  const handleClose = useCallback(() => {
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    closeRef.current();
    requestAnimationFrame(() => prev?.focus?.({ preventScroll: true }));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    },
    [handleClose],
  );

  const pageNumberFor = (pageId: string): number =>
    Math.max(1, pages.findIndex((p) => p.id === pageId) + 1);

  const applyReset = useCallback(() => {
    setSource({ type: 'automatic' });
  }, []);

  return (
    <Dialog open={open} onClose={handleClose} title="File Thumbnail" className="thumbnail-picker">
      <div className="thumbnail-picker__body" onKeyDown={handleKeyDown}>
        <div className="thumbnail-picker__preview" role="img" aria-label="Thumbnail preview">
          {previewStatus === 'loading' && (
            <div className="thumbnail-picker__preview-loading" role="status">
              Generating preview…
            </div>
          )}
          {previewStatus === 'ready' && previewUrl && (
            <img src={previewUrl} alt="" className="thumbnail-picker__preview-img" />
          )}
          {previewStatus === 'error' && (
            <div className="thumbnail-picker__preview-error">
              <Icon name="TriangleAlert" label={undefined} size="1.25em" />
              <span>No preview available</span>
            </div>
          )}
        </div>

        {fallbackApplied && (
          <p className="thumbnail-picker__notice" role="status">
            The chosen source no longer exists — previewing the automatic source instead.
          </p>
        )}
        {saved && (
          <p className="thumbnail-picker__notice" role="status">
            Thumbnail saved.
          </p>
        )}

        <fieldset className="thumbnail-picker__sources">
          <legend className="thumbnail-picker__legend">What should represent this file?</legend>

          <label
            className={`thumbnail-picker__source${source.type === 'automatic' ? ' thumbnail-picker__source--active' : ''}`}
          >
            <input
              type="radio"
              name="thumbnail-source"
              value="automatic"
              checked={source.type === 'automatic'}
              onChange={() => setSource({ type: 'automatic' })}
            />
            <span className="thumbnail-picker__source-label">Automatic</span>
            <span className="thumbnail-picker__source-desc">
              Varve chooses the most representative view
            </span>
          </label>

          {pages.map((page) => (
            <label
              key={page.id}
              className={`thumbnail-picker__source${source.type === 'page' && source.pageId === page.id ? ' thumbnail-picker__source--active' : ''}`}
            >
              <input
                type="radio"
                name="thumbnail-source"
                value={`page:${page.id}`}
                checked={source.type === 'page' && source.pageId === page.id}
                onChange={() => setSource({ type: 'page', pageId: page.id })}
              />
              <span className="thumbnail-picker__source-label">Page {pageNumberFor(page.id)}</span>
              <span className="thumbnail-picker__source-desc">{page.name}</span>
            </label>
          ))}

          <label
            className={`thumbnail-picker__source${source.type === 'frame' ? ' thumbnail-picker__source--active' : ''}${frameCandidate ? '' : ' thumbnail-picker__source--disabled'}`}
          >
            <input
              type="radio"
              name="thumbnail-source"
              value="frame"
              checked={source.type === 'frame'}
              disabled={!frameCandidate}
              onChange={() =>
                frameCandidate && setSource({ type: 'frame', nodeId: frameCandidate })
              }
            />
            <span className="thumbnail-picker__source-label">Selected frame</span>
            <span className="thumbnail-picker__source-desc">
              {frameCandidate
                ? 'The frame currently selected on canvas'
                : 'Select exactly one frame on canvas'}
            </span>
          </label>

          <label
            className={`thumbnail-picker__source${source.type === 'selection' ? ' thumbnail-picker__source--active' : ''}${selection.length > 0 ? '' : ' thumbnail-picker__source--disabled'}`}
          >
            <input
              type="radio"
              name="thumbnail-source"
              value="selection"
              checked={source.type === 'selection'}
              disabled={selection.length === 0}
              onChange={() =>
                selection.length > 0 && setSource({ type: 'selection', nodeIds: selection })
              }
            />
            <span className="thumbnail-picker__source-label">Current selection</span>
            <span className="thumbnail-picker__source-desc">
              {selection.length > 0
                ? `${selection.length} node${selection.length === 1 ? '' : 's'} selected`
                : 'Select content on canvas first'}
            </span>
          </label>
        </fieldset>

        <div className="thumbnail-picker__linked-hint">
          <Icon name="Link" label={undefined} size="0.85em" />
          <span>The thumbnail stays linked to the design — it updates as you edit.</span>
        </div>
      </div>

      <div className="thumbnail-picker__footer">
        <Button
          variant="ghost"
          size="sm"
          onClick={applyReset}
          disabled={source.type === 'automatic'}
        >
          Reset to Automatic
        </Button>
        <div className="thumbnail-picker__footer-spacer" />
        <Button variant="ghost" size="sm" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => void handleApply()}>
          Apply
        </Button>
      </div>
    </Dialog>
  );
}
