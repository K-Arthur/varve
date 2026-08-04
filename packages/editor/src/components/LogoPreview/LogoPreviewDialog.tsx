/**
 * LogoPreviewDialog — test a logo at real small sizes on realistic surfaces.
 *
 * Renders the active artboard once through the export raster pipeline, then
 * presents it at the favicon-to-social ladder (16–128 px) on light, dark, and
 * checkerboard surfaces, with original/monochrome/grayscale/reversed modes.
 * The dialog is a preview only: it never mutates the artwork, never holds an
 * editor transaction, and releases the rendered bitmap on close.
 */
import type { Engine } from '@varve/engine';
import { createEngine } from '@varve/engine';
import { Button, Dialog, SegmentedControl } from '@varve/ui';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import './logo-preview.css';
import {
  LOGO_PREVIEW_BASE,
  LOGO_SMALL_SIZES,
  type LogoPreviewImage,
  type LogoPreviewMode,
  type LogoSurfaceKind,
  previewFilter,
  renderLogoPreviewImage,
  surfaceColor,
} from '../../logo/logoPreview';

const MODE_LABELS = [
  { value: 'original', label: 'Original' },
  { value: 'monochrome', label: 'Monochrome' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'reversed', label: 'Reversed' },
] as const satisfies readonly { value: LogoPreviewMode; label: string }[];

const SURFACE_LABELS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'checker', label: 'Transparency' },
] as const satisfies readonly { value: LogoSurfaceKind; label: string }[];

export function LogoPreviewDialog() {
  const editor = useEditor();
  const open = editor.state.logoPreviewDialogOpen;
  const [mode, setMode] = useState<LogoPreviewMode>('original');
  const [surface, setSurface] = useState<LogoSurfaceKind>('light');
  const [image, setImage] = useState<LogoPreviewImage | null>(null);
  const [renderState, setRenderState] = useState<'idle' | 'rendering' | 'error'>('idle');
  const abortRef = useRef<AbortController | null>(null);
  const engineRef = useRef<Promise<Engine> | null>(null);

  const artboardId = useMemo(() => {
    const doc = editor.state.document;
    const sel = editor.state.selection;
    if (sel.length === 0) return null;
    let current: string | null = sel[0] ?? null;
    while (current) {
      const node = doc.nodes[current];
      if (!node) return null;
      if (node.kind === 'frame') return current;
      const parent = Object.values(doc.nodes).find(
        (n) => 'children' in n && n.children.includes(current as string),
      );
      current = parent ? parent.id : null;
    }
    return null;
  }, [editor.state.document, editor.state.selection]);

  useEffect(() => {
    if (!open) return;
    const doc = editor.state.document;
    const node = artboardId ? doc.nodes[artboardId] : undefined;
    if (!node) {
      setRenderState('error');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRenderState('rendering');
    engineRef.current ??= createEngine('auto');
    engineRef.current
      .then((engine) => renderLogoPreviewImage(node, doc, engine, controller.signal))
      .then((result) => {
        if (controller.signal.aborted) return;
        setImage((prev) => {
          prev?.bitmap.close();
          return result;
        });
        setRenderState(result ? 'idle' : 'error');
      })
      .catch(() => {
        if (!controller.signal.aborted) setRenderState('error');
      });
    return () => {
      controller.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artboardId]);

  const close = () => {
    editor.patch({ logoPreviewDialogOpen: false });
    setImage((prev) => {
      prev?.bitmap.close();
      return null;
    });
  };

  const hasImage = image !== null;

  return (
    <Dialog open={open} onClose={close} title="Test Logo at Small Sizes" dismissible>
      <div className="logo-preview">
        <p className="logo-preview__intro">
          Preview of the active artboard at real sizes. The artwork is not modified; this is a
          rendered snapshot.
        </p>
        <div className="logo-preview__controls">
          <SegmentedControl label="Mode" options={MODE_LABELS} value={mode} onChange={setMode} />
          <SegmentedControl
            label="Surface"
            options={SURFACE_LABELS}
            value={surface}
            onChange={setSurface}
          />
        </div>
        {renderState === 'rendering' && (
          <p className="logo-preview__status" aria-live="polite">
            Rendering preview…
          </p>
        )}
        {renderState === 'error' && (
          <p className="logo-preview__status logo-preview__status--error" role="alert">
            Select an artboard frame to preview. The active selection is not inside a frame.
          </p>
        )}
        {renderState === 'idle' && hasImage && (
          <ul className="logo-preview__ladder" aria-label="Preview sizes">
            {LOGO_SMALL_SIZES.map((size) => (
              <PreviewCell key={size} size={size} image={image} mode={mode} surface={surface} />
            ))}
          </ul>
        )}
        {renderState === 'idle' && hasImage && (
          <div className="logo-preview__large">
            <span className="logo-preview__label">At full size ({LOGO_PREVIEW_BASE}px render)</span>
            <PreviewCell size={256} image={image} mode={mode} surface={surface} large />
          </div>
        )}
        <div className="logo-preview__footer">
          <Button variant="primary" onClick={close} aria-label="Close logo preview">
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PreviewCell({
  size,
  image,
  mode,
  surface,
  large = false,
}: {
  size: number;
  image: LogoPreviewImage;
  mode: LogoPreviewMode;
  surface: LogoSurfaceKind;
  large?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = previewFilter(mode);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.bitmap, 0, 0, canvas.width, canvas.height);
  }, [image, mode, size]);

  const bg = surfaceColor(surface);
  const style: CSSProperties | undefined = bg ? { backgroundColor: bg } : undefined;

  return (
    <li className="logo-preview__cell">
      <div
        className={`logo-preview__canvas-wrap${large ? ' logo-preview__canvas-wrap--large' : ''}`}
        style={style}
      >
        {surface === 'checker' && <div className="logo-preview__checker" aria-hidden />}
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          className="logo-preview__canvas"
          role="img"
          aria-label={`Logo at ${size}px, ${mode} mode, ${surface} surface`}
        />
      </div>
      <span className="logo-preview__size">{size}px</span>
    </li>
  );
}
