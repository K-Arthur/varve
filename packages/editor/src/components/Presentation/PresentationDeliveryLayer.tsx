import { createEngine, type Engine } from '@varve/engine';
import type { Platform } from '@varve/platform';
import {
  type Document,
  type PresentationDeck,
  type ResolvedPresentationSlide,
  resolvePresentationSlides,
} from '@varve/scene';
import { sanitizeFileName } from '@varve/scene/export';
import { Button, Dialog } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { saveExportBytes } from '../../exportSaveAdapter';
import { capturePresentationFrame, decodePresentationFrame } from './presentationCapture';
import {
  PRESENTATION_EXPORT_EVENT,
  PRESENTATION_PREVIEW_CLOSE_EVENT,
  PRESENTATION_PREVIEW_EVENT,
  setPresentationPreviewOpen,
} from './presentationCommands';
import { resolvePresentationDeliveryScope } from './presentationDeliveryScope';
import { makePresentationPngArchive, PresentationPdfBuilder } from './presentationFormats';
import './presentationDelivery.css';

type DeliveryMode = 'preview' | 'export';
type OutputFormat = 'pdf' | 'png';

interface DeliverySnapshot {
  mode: DeliveryMode;
  deckId: string;
  document: Document;
  documentId: string;
  revision: number;
  deck: PresentationDeck;
  slides: ResolvedPresentationSlide[];
  deliveryErrors: ResolvedPresentationSlide[];
  selectedScope: boolean;
  startEntryId?: string;
}

interface PresentationDeliveryLayerProps {
  platform?: Platform;
  getEngine?: () => Promise<Engine>;
}

const PREVIEW_CACHE_LIMIT = 6;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Presentation operation failed. Try again.';
}

function currentSlideIndex(snapshot: DeliverySnapshot): number {
  if (!snapshot.startEntryId) return 0;
  const selected = snapshot.slides.findIndex(({ entry }) => entry.id === snapshot.startEntryId);
  return selected >= 0 ? selected : 0;
}

function slideName(deck: PresentationDeck, entry: ResolvedPresentationSlide['entry']): string {
  return entry.title.trim() || `${deck.name} slide`;
}

function ensureSnapshotCurrent(
  snapshot: DeliverySnapshot,
  state: ReturnType<typeof useEditor>['state'],
): void {
  if (state.document.id !== snapshot.documentId || state.revision !== snapshot.revision) {
    throw new Error(
      'The document changed during this operation. Reopen the deck view and try again.',
    );
  }
}

export function PresentationDeliveryLayer({ platform, getEngine }: PresentationDeliveryLayerProps) {
  const editor = useEditor();
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const engineRef = useRef<Promise<Engine> | null>(null);
  const activeExportRef = useRef<AbortController | null>(null);
  const previewCacheRef = useRef(new Map<string, string>());
  const [request, setRequest] = useState<DeliverySnapshot | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outputWarnings, setOutputWarnings] = useState<string[]>([]);

  const getEngineOnce = useCallback(() => {
    if (getEngine) return getEngine();
    engineRef.current ??= createEngine('auto');
    return engineRef.current;
  }, [getEngine]);

  const openDelivery = useCallback(
    (mode: DeliveryMode, deckId: string, startEntryId?: string, selectedEntryIds?: string[]) => {
      const document = editorRef.current.state.document;
      const resolution = resolvePresentationSlides(document, deckId);
      if (!resolution.deck) {
        editorRef.current.announce('Choose a presentation deck first');
        return;
      }
      const deliveryScope = resolvePresentationDeliveryScope(resolution, selectedEntryIds);
      const snapshot: DeliverySnapshot = {
        mode,
        deckId,
        document,
        documentId: document.id,
        revision: editorRef.current.state.revision,
        deck: resolution.deck,
        ...deliveryScope,
        ...(startEntryId ? { startEntryId } : {}),
      };
      setRequest(snapshot);
      setSlideIndex(currentSlideIndex(snapshot));
      setError(null);
      setProgress('');
      setOutputWarnings([]);
      setImageUrl(null);
    },
    [],
  );

  useEffect(() => {
    const handlePreview = (event: Event) => {
      const detail = (event as CustomEvent<{ deckId?: string; entryId?: string }>).detail;
      if (detail?.deckId) openDelivery('preview', detail.deckId, detail.entryId);
    };
    const handleExport = (event: Event) => {
      const detail = (event as CustomEvent<{ deckId?: string; slideEntryIds?: string[] }>).detail;
      if (detail?.deckId) {
        openDelivery('export', detail.deckId, undefined, detail.slideEntryIds);
      }
    };
    window.addEventListener(PRESENTATION_PREVIEW_EVENT, handlePreview);
    window.addEventListener(PRESENTATION_EXPORT_EVENT, handleExport);
    const handleClose = () => setRequest(null);
    window.addEventListener(PRESENTATION_PREVIEW_CLOSE_EVENT, handleClose);
    return () => {
      window.removeEventListener(PRESENTATION_PREVIEW_EVENT, handlePreview);
      window.removeEventListener(PRESENTATION_EXPORT_EVENT, handleExport);
      window.removeEventListener(PRESENTATION_PREVIEW_CLOSE_EVENT, handleClose);
    };
  }, [openDelivery]);

  // Report playback state so the canonical "Present" command is a truthful
  // toggle across every entry point (menubar, palette, shortcut, navigator).
  useEffect(() => {
    setPresentationPreviewOpen(request?.mode === 'preview' ? request.deckId : null);
    return () => setPresentationPreviewOpen(null);
  }, [request]);

  useEffect(
    () => () => {
      activeExportRef.current?.abort();
      for (const url of previewCacheRef.current.values()) URL.revokeObjectURL(url);
      previewCacheRef.current.clear();
    },
    [],
  );

  const closeDelivery = useCallback(() => {
    activeExportRef.current?.abort();
    setRequest(null);
    setImageUrl(null);
    setError(null);
    setProgress('');
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (request?.mode !== 'preview') return;
    if (request.slides.length === 0) {
      setImageUrl(null);
      setLoadingPreview(false);
      setError(null);
      return;
    }
    const current = request.slides[slideIndex];
    if (!current?.frame) {
      setImageUrl(null);
      setLoadingPreview(false);
      setError('This slide no longer has valid frame artwork. Return to Slides to repair it.');
      return;
    }
    const cacheKey = `${request.documentId}:${request.revision}:${request.deckId}:${current.entry.id}`;
    const cached = previewCacheRef.current.get(cacheKey);
    if (cached) {
      previewCacheRef.current.delete(cacheKey);
      previewCacheRef.current.set(cacheKey, cached);
      setImageUrl(cached);
      setLoadingPreview(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoadingPreview(true);
    setImageUrl(null);
    setError(null);
    void (async () => {
      try {
        ensureSnapshotCurrent(request, editorRef.current.state);
        const engine = await getEngineOnce();
        const captured = await capturePresentationFrame(
          request.document,
          current.entry,
          engine,
          controller.signal,
        );
        ensureSnapshotCurrent(request, editorRef.current.state);
        const url = URL.createObjectURL(captured.blob);
        previewCacheRef.current.set(cacheKey, url);
        while (previewCacheRef.current.size > PREVIEW_CACHE_LIMIT) {
          const oldest = previewCacheRef.current.keys().next().value as string | undefined;
          if (!oldest) break;
          URL.revokeObjectURL(previewCacheRef.current.get(oldest)!);
          previewCacheRef.current.delete(oldest);
        }
        setImageUrl(url);
        setOutputWarnings(captured.warnings);
      } catch (captureError) {
        if (!controller.signal.aborted) setError(errorMessage(captureError));
      } finally {
        if (!controller.signal.aborted) setLoadingPreview(false);
      }
    })();
    return () => controller.abort();
  }, [getEngineOnce, request, slideIndex]);

  const exportDeck = useCallback(
    async (format: OutputFormat) => {
      if (request?.mode !== 'export' || exporting) return;
      if (request.deliveryErrors.length > 0) {
        setError(
          `Cannot export while ${request.deliveryErrors.length} included slide reference(s) need repair. Return to Slides and restore or remove the missing frame references.`,
        );
        return;
      }
      if (request.slides.length === 0) {
        setError('This deck has no included slides. Include at least one slide, then retry.');
        return;
      }

      const controller = new AbortController();
      activeExportRef.current = controller;
      setExporting(true);
      setError(null);
      setOutputWarnings([]);
      const warnings = new Set<string>();
      try {
        const engine = await getEngineOnce();
        const pdfBuilder = new PresentationPdfBuilder();
        const pngSlides: Array<{ title: string; png: Uint8Array }> = [];
        let archiveBytes = 0;
        for (const [index, slide] of request.slides.entries()) {
          ensureSnapshotCurrent(request, editorRef.current.state);
          if (controller.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
          setProgress(`Rendering slide ${index + 1} of ${request.slides.length}`);
          const captured = await capturePresentationFrame(
            request.document,
            slide.entry,
            engine,
            controller.signal,
          );
          for (const warning of captured.warnings) warnings.add(warning);
          if (format === 'png') {
            const png = new Uint8Array(await captured.blob.arrayBuffer());
            archiveBytes += png.byteLength;
            if (archiveBytes > MAX_ARCHIVE_BYTES) {
              throw new Error(
                'This deck exceeds the 512 MB output limit. Export smaller groups of slides.',
              );
            }
            pngSlides.push({ title: slideName(request.deck, slide.entry), png });
          } else {
            pdfBuilder.addPage(await decodePresentationFrame(captured.blob));
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        ensureSnapshotCurrent(request, editorRef.current.state);
        if (controller.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        setProgress('Preparing file');
        const bytes =
          format === 'pdf' ? pdfBuilder.finish() : makePresentationPngArchive(pngSlides);
        const extension = format === 'pdf' ? '.pdf' : '.zip';
        const mimeType = format === 'pdf' ? 'application/pdf' : 'application/zip';
        const fileName = sanitizeFileName(
          request.selectedScope ? `${request.deck.name} selected slides` : request.deck.name,
          extension,
        );
        setProgress('Writing file');
        const saved = await saveExportBytes(platform, fileName, bytes, mimeType, extension);
        if (!saved) throw new Error('The save was cancelled or unavailable. No file was written.');
        const warningList = [...warnings];
        setOutputWarnings(warningList);
        editorRef.current.announce(`${format.toUpperCase()} presentation saved: ${saved}`);
        setProgress('File saved');
      } catch (exportError) {
        if (
          controller.signal.aborted ||
          (exportError instanceof DOMException && exportError.name === 'AbortError')
        ) {
          setError('Export cancelled. No file was written. Choose an output again to retry.');
        } else {
          setError(errorMessage(exportError));
        }
        setProgress('');
      } finally {
        activeExportRef.current = null;
        setExporting(false);
      }
    },
    [exporting, getEngineOnce, platform, request],
  );

  const cancelExport = useCallback(() => {
    activeExportRef.current?.abort();
  }, []);

  /**
   * Advance/rewind without wrapping past the ends.
   *
   * A silent wrap from the last slide back to the first is indistinguishable
   * from a missed keypress: the presenter cannot tell whether the deck ended or
   * the input was dropped. The boundary is announced instead, and the explicit
   * "Start from beginning" control remains the way back to slide one.
   */
  const stepSlide = useCallback(
    (delta: 1 | -1) => {
      if (!request || request.slides.length === 0) return;
      setSlideIndex((index) => {
        const next = index + delta;
        if (next < 0) {
          editorRef.current.announce('Start of presentation');
          return index;
        }
        if (next >= request.slides.length) {
          editorRef.current.announce('End of presentation');
          return index;
        }
        return next;
      });
    },
    [request],
  );

  const handleAudienceKeyDown = useCallback(
    (event: import('react').KeyboardEvent<HTMLDialogElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDelivery();
        return;
      }
      // A focused control that natively activates on Space or Enter must keep
      // that activation: the audience view has no text fields, but its own
      // buttons are reachable by Tab and must not advance the deck twice.
      const target = event.target as Element | null;
      const nativeActivation = Boolean(
        target?.closest?.(
          'button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="menuitem"], [contenteditable="true"]',
        ),
      );
      if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
        if (nativeActivation) return;
        event.preventDefault();
        stepSlide(1);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        stepSlide(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        stepSlide(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setSlideIndex(0);
      } else if (event.key === 'End' && request?.slides.length) {
        event.preventDefault();
        setSlideIndex(request.slides.length - 1);
      }
    },
    [closeDelivery, request, stepSlide],
  );

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      editorRef.current.announce(
        'Fullscreen is unavailable. Audience preview remains open in the top layer.',
      );
    }
  }, []);

  const currentSlide = request?.slides[slideIndex];
  const blockingSlides = request?.deliveryErrors ?? [];

  return (
    <>
      <Dialog
        open={request?.mode === 'preview'}
        onClose={closeDelivery}
        title={`${request?.deck.name ?? 'Presentation'} — audience preview`}
        size="lg"
        className="presentation-audience-dialog"
        focusFirstControl
        dismissible={false}
        onKeyDown={handleAudienceKeyDown}
      >
        {request?.mode === 'preview' && (
          <div className="presentation-audience">
            {blockingSlides.length > 0 && (
              <p className="presentation-audience__warning" role="status">
                {blockingSlides.length} slide reference(s) need repair. Valid included slides remain
                available for preview.
              </p>
            )}
            <section
              className="presentation-audience__stage"
              aria-live="polite"
              aria-label="Slide stage"
              tabIndex={-1}
              data-autofocus
            >
              {loadingPreview && <p role="status">Preparing slide…</p>}
              {imageUrl && currentSlide && (
                <img
                  src={imageUrl}
                  alt={currentSlide.entry.altText ?? currentSlide.entry.title}
                  className="presentation-audience__image"
                />
              )}
              {error && (
                <p className="presentation-audience__error" role="alert">
                  {error}
                </p>
              )}
              {!loadingPreview && !imageUrl && !error && request.slides.length === 0 && (
                <p role="status">
                  No slides are included. Include a slide in the Slides panel to start.
                </p>
              )}
            </section>
            <div className="presentation-audience__controls">
              <Button size="sm" variant="ghost" onClick={() => setSlideIndex(0)}>
                Start from beginning
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => stepSlide(-1)}
                disabled={request.slides.length < 2 || slideIndex === 0}
              >
                Previous
              </Button>
              <span aria-live="polite">
                {request.slides.length === 0
                  ? 'No included slides'
                  : `Slide ${slideIndex + 1} of ${request.slides.length}`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => stepSlide(1)}
                disabled={request.slides.length < 2 || slideIndex >= request.slides.length - 1}
              >
                Next
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void enterFullscreen()}>
                Fullscreen
              </Button>
              <Button size="sm" variant="default" onClick={closeDelivery}>
                Exit
              </Button>
            </div>
            {outputWarnings.length > 0 && (
              <p className="presentation-audience__warning" role="status">
                {outputWarnings.join(' ')}
              </p>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={request?.mode === 'export'}
        onClose={closeDelivery}
        title={`Export ${request?.deck.name ?? 'presentation'}${request?.selectedScope ? ' — selected slides' : ''}`}
        size="lg"
        className="presentation-export-dialog"
        dismissible={false}
      >
        {request?.mode === 'export' && (
          <div className="presentation-delivery">
            <p>
              {request.slides.length} included slide(s)
              {request.selectedScope ? ' from the selected slide references' : ' in this deck'}.
              Skipped and hidden slides, notes, and artwork outside this scope are excluded.
            </p>
            {request.slides.length === 0 && (
              <p role="status">
                No slides are included. Return to Slides to add a frame or include a skipped slide.
              </p>
            )}
            <p className="presentation-delivery__limit">
              PDF is a compressed raster screen document. Text and vectors are not editable, notes
              are private, and the PDF does not contain tagged accessibility structure.
            </p>
            {blockingSlides.length > 0 && (
              <div className="presentation-delivery__error" role="alert">
                {blockingSlides.length} included slide reference(s) need repair before export.
              </div>
            )}
            {error && (
              <div className="presentation-delivery__error" role="alert">
                {error}
              </div>
            )}
            {progress && <p role="status">{progress}</p>}
            {exporting && (
              <progress
                aria-label="Presentation export progress"
                max={request.slides.length}
                value={undefined}
              />
            )}
            {outputWarnings.length > 0 && (
              <ul
                className="presentation-delivery__warnings"
                aria-label="Presentation export warnings"
              >
                {outputWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="presentation-delivery__actions">
              {exporting ? (
                <Button variant="ghost" onClick={cancelExport}>
                  Cancel export
                </Button>
              ) : (
                <>
                  <Button
                    variant="default"
                    disabled={request.slides.length === 0 || blockingSlides.length > 0}
                    onClick={() => void exportDeck('pdf')}
                  >
                    Export PDF
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={request.slides.length === 0 || blockingSlides.length > 0}
                    onClick={() => void exportDeck('png')}
                  >
                    Export PNG sequence
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
