/**
 * PatternRepeatPreview — a live, honest preview of how a pattern fill repeats.
 *
 * It is not a decorative swatch: it composes the tile through the *same*
 * `@varve/shared` `patternRepeat` lattice the canvas renderer uses, so the
 * arrangement, independent gaps, row shift, mirroring, and phase shown here are
 * the ones that will be painted and exported. A preview that disagreed with the
 * renderer would be worse than none.
 *
 * The source cell is highlighted and its neighbours are dimmed, so the tile
 * boundary, the origin, and the repeat direction are all readable without
 * changing the exported appearance.
 *
 * The phase shown is the pattern's own offset relative to the tile, not the
 * phase the artwork paints: the renderer adds the painted object's origin to
 * `offsetX`/`offsetY` (`offsetX: bounds.x + (fill.offsetX ?? 0)`), so a fill on
 * an offset object starts part-way through the tile. Anchoring the preview to
 * the object would make the sample depend on where the object happens to sit,
 * which is not what a reusable definition is describing, so the preview stays
 * origin-relative on purpose.
 */
import type { PatternFillData } from '@varve/scene';
import { patternRepeatParams } from '@varve/scene';
import {
  forEachPatternInstance,
  PATTERN_ARRANGEMENT_LABELS,
  type PatternLattice,
  patternInstanceMatrix,
  resolvePatternLattice,
} from '@varve/shared';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PatternSourceMotifBounds } from '../../../patterns/patternSourceHitTest';
import { hitTestPatternSourceMotifs } from '../../../patterns/patternSourceHitTest';

const PREVIEW_SIZE = 132;
/** Tiles shown per axis (centred on the source cell): -1…+1 at minimum. */
const SPAN = 3;

interface PatternRepeatPreviewProps {
  pattern: PatternFillData;
  sourceMotifs?: readonly PatternSourceMotifBounds[];
  selectedSourceMotifId?: string | null;
  onSourceMotifSelect?: (id: string) => void;
  onSourceMotifMove?: (id: string, dx: number, dy: number) => void;
}

interface PreviewInteractionState {
  lattice: PatternLattice;
  scale: number;
}

interface ActiveSourceDrag {
  pointerId: number;
  id: string;
  lastX: number;
  lastY: number;
  flipX: number;
  flipY: number;
}

export function PatternRepeatPreview({
  pattern,
  sourceMotifs,
  selectedSourceMotifId,
  onSourceMotifSelect,
  onSourceMotifMove,
}: PatternRepeatPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<PreviewInteractionState | null>(null);
  const sourceDragRef = useRef<ActiveSourceDrag | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const mapPreviewPoint = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const interaction = interactionRef.current;
    const bounds = canvas?.getBoundingClientRect();
    if (!interaction || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const canvasX = ((event.clientX - bounds.left) / bounds.width) * PREVIEW_SIZE;
    const canvasY = ((event.clientY - bounds.top) / bounds.height) * PREVIEW_SIZE;
    return {
      x: (canvasX - PREVIEW_SIZE / 2) / interaction.scale + interaction.lattice.phaseX,
      y: (canvasY - PREVIEW_SIZE / 2) / interaction.scale + interaction.lattice.phaseY,
      interaction,
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!sourceMotifs || !onSourceMotifMove || event.button !== 0) return;
      const point = mapPreviewPoint(event);
      if (!point) return;
      const hit = hitTestPatternSourceMotifs(
        point.interaction.lattice,
        point.x,
        point.y,
        sourceMotifs,
      );
      if (!hit) return;
      const matrix = patternInstanceMatrix(point.interaction.lattice, hit.i, hit.j);
      onSourceMotifSelect?.(hit.id);
      sourceDragRef.current = {
        pointerId: event.pointerId,
        id: hit.id,
        lastX: point.x,
        lastY: point.y,
        flipX: matrix[0],
        flipY: matrix[3],
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [mapPreviewPoint, onSourceMotifMove, onSourceMotifSelect, sourceMotifs],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = sourceDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !onSourceMotifMove) return;
      const point = mapPreviewPoint(event);
      if (!point) return;
      // Keep the transform of the copy where the gesture began. Re-resolving
      // parity after every pointer event reverses the delta at a mirror seam,
      // which makes a continuous drag jump when it crosses into the next copy.
      const dx = (point.x - drag.lastX) * drag.flipX;
      const dy = (point.y - drag.lastY) * drag.flipY;
      if (dx !== 0 || dy !== 0) onSourceMotifMove(drag.id, dx, dy);
      sourceDragRef.current = { ...drag, lastX: point.x, lastY: point.y };
    },
    [mapPreviewPoint, onSourceMotifMove],
  );

  const endSourceDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (sourceDragRef.current?.pointerId !== event.pointerId) return;
    sourceDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useEffect(() => {
    if (!pattern.tileSrc) {
      setImage(null);
      setLoadFailed(false);
      return;
    }
    let cancelled = false;
    const next = new Image();
    // A data URL or same-origin asset needs no CORS; a remote tile that is not
    // CORS-enabled still previews because the canvas is never read back.
    next.onload = () => {
      if (!cancelled) {
        setImage(next);
        setLoadFailed(false);
      }
    };
    next.onerror = () => {
      if (!cancelled) {
        setImage(null);
        setLoadFailed(true);
      }
    };
    next.src = pattern.tileSrc;
    return () => {
      cancelled = true;
    };
  }, [pattern.tileSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(PREVIEW_SIZE * dpr);
    canvas.height = Math.round(PREVIEW_SIZE * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    // Overlay colours come from the theme tokens so the preview reads correctly
    // in light, dark, and high-contrast themes; they are UI chrome, not
    // document content, and never appear in the fill or the export.
    const tokens = getComputedStyle(canvas);
    const sourceOutline =
      tokens.getPropertyValue('--color-accent-primary').trim() || 'currentColor';
    const originMark = tokens.getPropertyValue('--color-feedback-danger').trim() || 'currentColor';

    interactionRef.current = null;
    if (!image) return;
    const tileWidth = pattern.imageWidth ?? image.naturalWidth;
    const tileHeight = pattern.imageHeight ?? image.naturalHeight;
    const lattice = resolvePatternLattice(
      patternRepeatParams(
        { ...pattern, offsetX: pattern.offsetX ?? 0, offsetY: pattern.offsetY ?? 0 },
        tileWidth,
        tileHeight,
      ),
    );
    if (!lattice) return;

    // Fit a SPAN × SPAN block of tiles into the preview box.
    const scale = Math.min(PREVIEW_SIZE / (SPAN * tileWidth), PREVIEW_SIZE / (SPAN * tileHeight));
    interactionRef.current = { scale, lattice };
    const rect = {
      x: lattice.phaseX - tileWidth * ((SPAN - 1) / 2),
      y: lattice.phaseY - tileHeight * ((SPAN - 1) / 2),
      w: SPAN * tileWidth,
      h: SPAN * tileHeight,
    };

    ctx.save();
    ctx.translate(PREVIEW_SIZE / 2, PREVIEW_SIZE / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));

    forEachPatternInstance(lattice, rect, (i, j, matrix) => {
      const isSource = i === 0 && j === 0;
      ctx.save();
      // Neighbours are dimmed; the painted/exported opacity is untouched.
      ctx.globalAlpha = isSource ? 1 : 0.42;
      ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      ctx.drawImage(image, 0, 0, tileWidth, tileHeight);
      if (isSource) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = sourceOutline;
        ctx.strokeRect(0, 0, tileWidth, tileHeight);
      }
      ctx.restore();
    });

    const selectedMotif = sourceMotifs?.find((motif) => motif.id === selectedSourceMotifId);
    if (selectedMotif) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = sourceOutline;
      ctx.setLineDash([4 / scale, 2 / scale]);
      ctx.strokeRect(selectedMotif.x, selectedMotif.y, selectedMotif.w, selectedMotif.h);
      ctx.restore();
    }

    // Origin marker at pattern (0, 0).
    ctx.globalAlpha = 1;
    ctx.strokeStyle = originMark;
    ctx.lineWidth = 1 / scale;
    const originLength = PREVIEW_SIZE / scale / 18;
    ctx.beginPath();
    ctx.moveTo(lattice.phaseX - originLength, lattice.phaseY);
    ctx.lineTo(lattice.phaseX + originLength, lattice.phaseY);
    ctx.moveTo(lattice.phaseX, lattice.phaseY - originLength);
    ctx.lineTo(lattice.phaseX, lattice.phaseY + originLength);
    ctx.stroke();
    ctx.restore();
  }, [image, pattern, selectedSourceMotifId, sourceMotifs]);

  const arrangementLabel = PATTERN_ARRANGEMENT_LABELS[pattern.arrangement ?? 'grid'];
  const editable = Boolean(sourceMotifs?.length && onSourceMotifMove);
  const description = !pattern.tileSrc
    ? 'No tile yet — the preview appears once a source or generator is set.'
    : loadFailed
      ? 'The tile could not be decoded. The editor may show a placeholder; export reports a missing resource.'
      : `${arrangementLabel} repeat · source cell outlined, neighbours dimmed${editable ? ' · click and drag a motif to move its source' : ''}`;

  return (
    <div className="insp-pattern-preview">
      <canvas
        ref={canvasRef}
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        className={
          editable
            ? 'insp-pattern-preview__canvas insp-pattern-preview__canvas--editable'
            : 'insp-pattern-preview__canvas'
        }
        onPointerDown={editable ? handlePointerDown : undefined}
        onPointerMove={editable ? handlePointerMove : undefined}
        onPointerUp={editable ? endSourceDrag : undefined}
        onPointerCancel={editable ? endSourceDrag : undefined}
        role="img"
        aria-label={`Pattern repeat preview. ${description}`}
      />
      <p className="insp-hint" role="note">
        {description}
      </p>
    </div>
  );
}
