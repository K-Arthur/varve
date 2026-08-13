/**
 * Overlay manager — canvas overlay draw pipeline and CanvasOverlays host.
 *
 * Encapsulates the overlay `<canvas>` element, the `drawOverlay` function
 * (mask preview, subject picker, drop targets, layout grid, draft shapes,
 * diagnostics), and the RAF scheduling lifecycle so CanvasArea delegates
 * overlay rendering here instead of managing it inline.
 */

import { computeImagePlacement } from '@varve/engine';
import {
  canBeClipMaskSource,
  type Document,
  type NodeId,
  resolveNodePaints,
  type ShapeNode,
} from '@varve/scene';
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import type { EditorState } from '../context/types';
import type { TransformCache } from '../scene/transformCache';
import {
  getWorldBounds as getCachedWorldBounds,
  getWorldTransform as getCachedWorldTransform,
} from '../scene/transformCache';
import { nodeLocalBounds } from '../scene/world';
import { applyEditorCameraToCtx } from './cameraState';
import { resizeCanvasBackingStore } from './canvasSurface';
import { computeGridLines, renderGridOnCtx, resolveCanvasColor } from './gridRenderer';
import {
  cancelCanvasFrame,
  createCanvasFrameKey,
  renderPerfHud,
  scheduleCanvasFrame,
} from './perfRuntime';

export interface UseOverlayDrawOptions {
  overlayCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  stateRef: MutableRefObject<EditorState>;
  transformCacheRef: MutableRefObject<TransformCache>;
  displayDpr: number;
  accentColorRef: MutableRefObject<string>;
  sunkenColorRef: MutableRefObject<string>;
  draft: unknown | null;
  dropTargetFrameId: NodeId | null;
  maskDropTargetId: NodeId | null;
}

function drawObjectSelectionPreview(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  node: ShapeNode,
  session: NonNullable<EditorState['objectSelectionSession']>,
  worldTransform: readonly [number, number, number, number, number, number],
): void {
  const candidate = session.candidates[session.selectedCandidate];
  if (!candidate || candidate.mask.length !== session.width * session.height) return;
  const image = resolveNodePaints(node, doc).find((fill) => fill.type === 'image')?.image;
  const bounds = nodeLocalBounds(node, doc);
  if (!image || !bounds) return;
  const placement = computeImagePlacement({
    fit: image.fit,
    sourceWidth: session.width,
    sourceHeight: session.height,
    bounds,
    x: image.x,
    y: image.y,
    scale: image.scale,
    sourceCrop: image.crop,
    rotation: image.rotation,
    flipH: image.flipH,
    flipV: image.flipV,
  });
  if (!placement) return;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = session.width;
  maskCanvas.height = session.height;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;
  const pixels = maskCtx.createImageData(session.width, session.height);
  for (let i = 0; i < candidate.mask.length; i += 1) {
    const alpha = Math.round(candidate.mask[i]! * 0.42);
    pixels.data[i * 4] = 32;
    pixels.data[i * 4 + 1] = 160;
    pixels.data[i * 4 + 2] = 255;
    pixels.data[i * 4 + 3] = alpha;
  }
  maskCtx.putImageData(pixels, 0, 0);

  const [a, b, c, d, e, f] = worldTransform;
  const source = placement.sourceRect;
  const destination = placement.sampleDrawRect;
  ctx.save();
  ctx.transform(a, b, c, d, e, f);
  const transformed = placement.rotation !== 0 || placement.flipH || placement.flipV;
  if (transformed) {
    const centerX = placement.drawRect.x + placement.drawRect.w / 2;
    const centerY = placement.drawRect.y + placement.drawRect.h / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((placement.rotation * Math.PI) / 180);
    ctx.scale(placement.flipH ? -1 : 1, placement.flipV ? -1 : 1);
    ctx.drawImage(
      maskCanvas,
      source.x,
      source.y,
      source.w,
      source.h,
      destination.x - centerX,
      destination.y - centerY,
      destination.w,
      destination.h,
    );
    ctx.restore();
  } else {
    ctx.drawImage(
      maskCanvas,
      source.x,
      source.y,
      source.w,
      source.h,
      destination.x,
      destination.y,
      destination.w,
      destination.h,
    );
  }
  ctx.restore();
}

function drawObjectSelectionPrompts(
  ctx: CanvasRenderingContext2D,
  session: NonNullable<EditorState['objectSelectionSession']>,
  zoom: number,
): void {
  ctx.save();
  ctx.lineWidth = 2 / zoom;
  for (const point of session.points) {
    const positive = point.label === 1;
    ctx.fillStyle = positive ? 'rgba(32,160,255,0.95)' : 'rgba(236,72,153,0.95)';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7 / zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.font = `bold ${10 / zoom}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(positive ? '+' : '−', point.x, point.y);
  }
  if (session.box) {
    const x = Math.min(session.box.x1, session.box.x2);
    const y = Math.min(session.box.y1, session.box.y2);
    const w = Math.abs(session.box.x2 - session.box.x1);
    const h = Math.abs(session.box.y2 - session.box.y1);
    ctx.strokeStyle = 'rgba(32,160,255,0.95)';
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

export function useOverlayDraw({
  overlayCanvasRef,
  stateRef,
  transformCacheRef,
  displayDpr,
  accentColorRef,
  draft,
  dropTargetFrameId,
  maskDropTargetId,
}: UseOverlayDrawOptions): () => void {
  const overlayFrameKey = useRef<string | null>(null);
  overlayFrameKey.current ??= createCanvasFrameKey('overlay');

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = displayDpr;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    resizeCanvasBackingStore(canvas, cssW, cssH, dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const doc = s.document;
    const cache = transformCacheRef.current;
    const vp = { width: cssW, height: cssH };
    const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
    const accentColor = accentColorRef.current;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Document grid overlay ────────────────────────────────────────────
    const dg = s.documentGrid;
    if (dg?.visible && dg.spacingX > 0 && dg.spacingY > 0) {
      const lines = computeGridLines(dg, s.zoom, s.pan.x, s.pan.y, cssW, cssH);
      const minorOpacity = dg.opacity * 0.6;
      renderGridOnCtx(
        ctx,
        lines,
        dpr,
        dg.color,
        dg.color,
        dg.opacity,
        minorOpacity,
        dg.rotation ?? 0,
        dg.offsetX ?? 0,
        dg.offsetY ?? 0,
      );
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    applyEditorCameraToCtx(ctx, camState, dpr, vp);

    // ── Mask preview overlay ─────────────────────────────────────────────
    const previewMode = s.maskPreviewMode;
    const previewNodeId = s.selection[0];
    const previewNode = previewNodeId ? doc.nodes[previewNodeId] : undefined;
    const maskEditing = s.tool === 'refineMask' || s.tool === 'trimapEdit';
    if (
      previewMode !== 'none' &&
      maskEditing &&
      previewNode?.kind === 'shape' &&
      previewNode.mask?.rasterMask
    ) {
      const worldBounds = previewNodeId ? getCachedWorldBounds(cache, doc, previewNodeId) : null;
      if (worldBounds && previewNodeId) {
        ctx.save();
        const worldMat = getCachedWorldTransform(cache, doc, previewNodeId);
        const [a, b, c2, d2, e2, f2] = worldMat;
        ctx.transform(a, b, c2, d2, e2, f2);
        const w = worldBounds.w;
        const h = worldBounds.h;
        if (previewMode === 'checkerboard') {
          const sz = 8 / s.zoom;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.clip();
          for (let py = 0; py < h; py += sz) {
            for (let px = 0; px < w; px += sz) {
              ctx.fillStyle =
                (Math.floor(px / sz) + Math.floor(py / sz)) % 2 === 0
                  ? 'rgba(0,0,0,0.15)'
                  : 'rgba(255,255,255,0.15)';
              ctx.fillRect(px, py, sz, sz);
            }
          }
          ctx.restore();
        } else if (previewMode === 'overlay') {
          ctx.fillStyle = 'rgba(0,120,255,0.2)';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = 'rgba(0,120,255,0.5)';
          ctx.lineWidth = 2 / s.zoom;
          ctx.strokeRect(0, 0, w, h);
        } else if (previewMode === 'black') {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(0, 0, w, h);
        } else if (previewMode === 'white') {
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.fillRect(0, 0, w, h);
        } else if (previewMode === 'mask-only') {
          ctx.fillStyle = 'rgba(128,128,128,0.4)';
          ctx.fillRect(0, 0, w, h);
        } else if (previewMode === 'edge') {
          ctx.strokeStyle = 'rgba(255,50,50,0.8)';
          ctx.lineWidth = 2 / s.zoom;
          ctx.setLineDash([4 / s.zoom, 4 / s.zoom]);
          ctx.strokeRect(0, 0, w, h);
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }

    // ── Object Selection preview ─────────────────────────────────────────
    const objectSession = s.objectSelectionSession;
    const objectNode = objectSession?.nodeId ? doc.nodes[objectSession.nodeId] : undefined;
    if (objectSession && objectNode?.kind === 'shape') {
      const objectTransform = getCachedWorldTransform(cache, doc, objectNode.id);
      if (objectTransform) {
        drawObjectSelectionPreview(ctx, doc, objectNode, objectSession, objectTransform);
        drawObjectSelectionPrompts(ctx, objectSession, s.zoom);
      }
    }

    // ── Subject picker highlight overlay ─────────────────────────────────
    const subjectPickerSession = s.subjectPickerSession;
    if (subjectPickerSession) {
      const highlightId = s.subjectHighlightId;
      const imageNodeId = subjectPickerSession.nodeId;
      const imageNode = doc.nodes[imageNodeId];
      if (imageNode && imageNode.kind === 'shape') {
        const worldBounds = getCachedWorldBounds(cache, doc, imageNodeId);
        const worldMat = getCachedWorldTransform(cache, doc, imageNodeId);
        if (worldBounds && worldMat) {
          const imgW = worldBounds.w;
          const imgH = worldBounds.h;
          const srcW = subjectPickerSession.sourceWidth;
          const srcH = subjectPickerSession.sourceHeight;
          const scaleX = srcW > 0 ? imgW / srcW : 1;
          const scaleY = srcH > 0 ? imgH / srcH : 1;
          const [a, b, c2, d2, e2, f2] = worldMat;

          ctx.save();

          // Dim non-highlighted regions
          if (highlightId !== null) {
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath();
            ctx.rect(e2, f2, imgW, imgH);
            ctx.fill();
          }

          for (const comp of subjectPickerSession.components) {
            const isSelected = subjectPickerSession.keepIds.includes(comp.id);
            const isHighlighted = comp.id === highlightId;

            const bx = comp.bbox.x * scaleX;
            const by = comp.bbox.y * scaleY;
            const bw = comp.bbox.w * scaleX;
            const bh = comp.bbox.h * scaleY;

            const corners = [
              [bx, by],
              [bx + bw, by],
              [bx + bw, by + bh],
              [bx, by + bh],
            ] as const;

            if (highlightId !== null && isHighlighted) {
              ctx.save();
              ctx.globalCompositeOperation = 'destination-out';
              ctx.fillStyle = 'rgba(0,0,0,1)';
              ctx.beginPath();
              for (let i = 0; i < corners.length; i++) {
                const [lx, ly] = corners[i]!;
                const wx = a * lx + c2 * ly + e2;
                const wy = b * lx + d2 * ly + f2;
                if (i === 0) ctx.moveTo(wx, wy);
                else ctx.lineTo(wx, wy);
              }
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }

            ctx.beginPath();
            for (let i = 0; i < corners.length; i++) {
              const [lx, ly] = corners[i]!;
              const wx = a * lx + c2 * ly + e2;
              const wy = b * lx + d2 * ly + f2;
              if (i === 0) ctx.moveTo(wx, wy);
              else ctx.lineTo(wx, wy);
            }
            ctx.closePath();

            if (isHighlighted) {
              ctx.strokeStyle = accentColor;
              ctx.lineWidth = 3 / s.zoom;
              ctx.setLineDash([]);
            } else if (isSelected) {
              ctx.strokeStyle = 'rgba(34,197,94,0.8)';
              ctx.lineWidth = 2 / s.zoom;
              ctx.setLineDash([]);
            } else {
              ctx.strokeStyle = 'rgba(128,128,128,0.5)';
              ctx.lineWidth = 1.5 / s.zoom;
              ctx.setLineDash([4 / s.zoom, 4 / s.zoom]);
            }
            ctx.stroke();

            const labelX = a * bx + c2 * by + e2;
            const labelY = b * bx + d2 * by + f2 - 8 / s.zoom;
            const labelFontSize = Math.max(10, 12) / s.zoom;
            ctx.font = `bold ${labelFontSize}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = isHighlighted
              ? accentColor
              : isSelected
                ? 'rgba(34,197,94,0.9)'
                : 'rgba(128,128,128,0.8)';
            ctx.fillText(`${subjectPickerSession.components.indexOf(comp) + 1}`, labelX, labelY);
          }

          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }

    // ── Drop target container highlight ─────────────────────────────────
    if (dropTargetFrameId) {
      const containerNode = doc.nodes[dropTargetFrameId];
      if (containerNode && (containerNode.kind === 'frame' || containerNode.kind === 'group')) {
        const containerWorld = getCachedWorldTransform(cache, doc, dropTargetFrameId);
        const cw = containerNode.kind === 'frame' ? containerNode.w : 0;
        const ch = containerNode.kind === 'frame' ? containerNode.h : 0;
        if (containerWorld && containerNode.kind === 'frame') {
          const [a, b, c, d, e2, f2] = containerWorld;
          ctx.save();
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = 2 / s.zoom;
          ctx.setLineDash([6 / s.zoom, 4 / s.zoom]);
          ctx.beginPath();
          const corners = [
            [0, 0],
            [cw, 0],
            [cw, ch],
            [0, ch],
          ] as const;
          for (let i = 0; i < corners.length; i++) {
            const [lx, ly] = corners[i]!;
            const wx = a * lx + c * ly + e2;
            const wy = b * lx + d * ly + f2;
            if (i === 0) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        } else if (containerNode.kind === 'group') {
          const groupBounds = getCachedWorldBounds(cache, doc, dropTargetFrameId);
          if (groupBounds) {
            const { x, y, w, h } = groupBounds;
            ctx.save();
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2 / s.zoom;
            ctx.setLineDash([6 / s.zoom, 4 / s.zoom]);
            ctx.strokeRect(x, y, w, h);
            ctx.restore();
          }
        }
      }
    }

    // ── Mask drop target ─────────────────────────────────────────────────
    if (maskDropTargetId) {
      const target = doc.nodes[maskDropTargetId];
      if (target && target.kind === 'shape' && canBeClipMaskSource(target)) {
        const world = getCachedWorldTransform(cache, doc, maskDropTargetId);
        ctx.save();
        ctx.transform(...world);
        ctx.beginPath();
        const tb = getCachedWorldBounds(cache, doc, maskDropTargetId);
        if (tb) {
          ctx.rect(0, 0, tb.w, tb.h);
        }
        ctx.closePath();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 3 / s.zoom;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── Layout grid overlay ────────────────────────────────────────────
    const layoutGrids = doc.gridSettings?.layoutGrids;
    if (layoutGrids) {
      for (const [frameId, layoutGrid] of Object.entries(layoutGrids)) {
        if (!layoutGrid.visible) continue;
        const frame = doc.nodes[frameId];
        if (frame?.kind !== 'frame') continue;

        const world = getCachedWorldTransform(cache, doc, frameId);
        const [a, b, c, d, e, f] = world;
        const fw = frame.w;
        const fh = frame.h;
        const [marginTop, marginRight, marginBottom, marginLeft] = layoutGrid.margin;

        ctx.save();
        ctx.strokeStyle = resolveCanvasColor(layoutGrid.color);
        ctx.globalAlpha = layoutGrid.opacity;
        ctx.lineWidth = 1 / s.zoom;
        ctx.setLineDash([0]);

        const contentWidth = fw - marginLeft - marginRight;
        const contentHeight = fh - marginTop - marginBottom;

        if (layoutGrid.layoutMode === 'columns' || layoutGrid.layoutMode === 'uniform') {
          // Render column grid
          const columnCount = layoutGrid.columnCount || 1;
          const columnWidth = layoutGrid.columnWidth ?? contentWidth / columnCount;
          const totalGutterWidth = (columnCount - 1) * layoutGrid.gutter;
          const totalColumnWidth = columnCount * columnWidth + totalGutterWidth;
          const scale = contentWidth / totalColumnWidth;
          const scaledColumnWidth = columnWidth * scale;
          const scaledGutter = layoutGrid.gutter * scale;

          let xPos = marginLeft;
          for (let i = 0; i < columnCount; i++) {
            const wx = a * xPos + c * marginTop + e;
            const wy = b * xPos + d * marginTop + f;
            const wx2 = a * xPos + c * (marginTop + contentHeight) + e;
            const wy2 = b * xPos + d * (marginTop + contentHeight) + f;
            ctx.beginPath();
            ctx.moveTo(wx, wy);
            ctx.lineTo(wx2, wy2);
            ctx.stroke();
            xPos += scaledColumnWidth + scaledGutter;
          }
        }

        if (layoutGrid.layoutMode === 'rows' || layoutGrid.layoutMode === 'uniform') {
          // Render row grid
          const rowCount = layoutGrid.rowCount || 1;
          const rowHeight = layoutGrid.rowHeight ?? contentHeight / rowCount;
          const totalGutterHeight = (rowCount - 1) * layoutGrid.gutter;
          const totalRowHeight = rowCount * rowHeight + totalGutterHeight;
          const scale = contentHeight / totalRowHeight;
          const scaledRowHeight = rowHeight * scale;
          const scaledGutter = layoutGrid.gutter * scale;

          let yPos = marginTop;
          for (let i = 0; i < rowCount; i++) {
            const wx = a * marginLeft + c * yPos + e;
            const wy = b * marginLeft + d * yPos + f;
            const wx2 = a * (marginLeft + contentWidth) + c * yPos + e;
            const wy2 = b * (marginLeft + contentWidth) + d * yPos + f;
            ctx.beginPath();
            ctx.moveTo(wx, wy);
            ctx.lineTo(wx2, wy2);
            ctx.stroke();
            yPos += scaledRowHeight + scaledGutter;
          }
        }

        ctx.restore();
      }
    }

    // ── Draft shape preview ────────────────────────────────────────────
    if (draft) {
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1 / s.zoom;
      ctx.setLineDash([4 / s.zoom, 4 / s.zoom]);

      const d = draft as {
        kind: string;
        x: number;
        y: number;
        w: number;
        h: number;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        sides: number;
        points: number;
        pts: Array<{ x: number; y: number }>;
        label?: string;
      };

      switch (d.kind) {
        case 'rect':
        case 'frame':
          ctx.strokeRect(d.x, d.y, d.w, d.h);
          break;
        case 'ellipse': {
          const ecx = d.x + d.w / 2;
          const ecy = d.y + d.h / 2;
          ctx.beginPath();
          ctx.ellipse(ecx, ecy, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'polygon': {
          const pcx = d.x + d.w / 2;
          const pcy = d.y + d.h / 2;
          const pr = Math.min(d.w, d.h) / 2;
          ctx.beginPath();
          for (let i = 0; i < d.sides; i++) {
            const a = (2 * Math.PI * i) / d.sides - Math.PI / 2;
            const px = pcx + pr * Math.cos(a);
            const py = pcy + pr * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
          break;
        }
        case 'star': {
          const scx = d.x + d.w / 2;
          const scy = d.y + d.h / 2;
          const outerR = Math.min(d.w, d.h) / 2;
          const innerR = outerR * 0.4;
          ctx.beginPath();
          for (let i = 0; i < d.points * 2; i++) {
            const a = (Math.PI * i) / d.points - Math.PI / 2;
            const r = i % 2 === 0 ? outerR : innerR;
            const px = scx + r * Math.cos(a);
            const py = scy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
          break;
        }
        case 'line':
          ctx.beginPath();
          ctx.moveTo(d.x1, d.y1);
          ctx.lineTo(d.x2, d.y2);
          ctx.stroke();
          break;
        case 'arrow':
          ctx.beginPath();
          ctx.moveTo(d.x1, d.y1);
          ctx.lineTo(d.x2, d.y2);
          ctx.stroke();
          {
            const angle = Math.atan2(d.y2 - d.y1, d.x2 - d.x1);
            const spread = Math.PI / 7;
            const headLen = 10 / s.zoom;
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(d.x2, d.y2);
            ctx.lineTo(
              d.x2 - headLen * Math.cos(angle - spread),
              d.y2 - headLen * Math.sin(angle - spread),
            );
            ctx.lineTo(
              d.x2 - headLen * Math.cos(angle + spread),
              d.y2 - headLen * Math.sin(angle + spread),
            );
            ctx.closePath();
            ctx.fill();
          }
          break;
        case 'freehand':
          if (d.pts && d.pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(d.pts[0]!.x, d.pts[0]!.y);
            for (let i = 1; i < d.pts.length; i++) {
              ctx.lineTo(d.pts[i]!.x, d.pts[i]!.y);
            }
            ctx.stroke();
          }
          break;
      }

      ctx.setLineDash([]);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (d.kind === 'freehand') {
        const pt = d.pts?.[0];
        if (pt) {
          const [sx2, sy2] = [
            (pt.x - s.pan.x) * s.zoom + cssW / 2,
            (pt.y - s.pan.y) * s.zoom + cssH / 2,
          ];
          ctx.font = '11px system-ui';
          ctx.fillStyle = accentColor;
          ctx.fillText(d.label ?? `${d.pts.length} pts`, sx2 + 4, sy2 + 14);
        }
      } else {
        const worldX = d.kind === 'line' || d.kind === 'arrow' ? Math.min(d.x1, d.x2) : d.x;
        const worldY = d.kind === 'line' || d.kind === 'arrow' ? Math.min(d.y1, d.y2) : d.y;
        const sx2 = (worldX - s.pan.x) * s.zoom + cssW / 2;
        const sy2 = (worldY - s.pan.y) * s.zoom + cssH / 2;
        const sw = d.w * s.zoom;
        ctx.font = '11px system-ui';
        ctx.fillStyle = accentColor;
        const label = d.label ?? `${Math.round(sw / s.zoom)} x ${Math.round(d.h * s.zoom)}`;
        ctx.fillText(label, sx2 + sw + 4, sy2 + 14);
      }
    }

    // Dev-only diagnostics overlay
    renderPerfHud(ctx, canvas.width);
  }, [
    overlayCanvasRef,
    stateRef,
    transformCacheRef,
    displayDpr,
    accentColorRef,
    draft,
    dropTargetFrameId,
    maskDropTargetId,
  ]);

  // Schedule the overlay draw on the ui lane
  useEffect(() => {
    const frameKey = overlayFrameKey.current;
    if (!frameKey) return;
    scheduleCanvasFrame(frameKey, 'ui', () => {
      drawOverlay();
    });
    return () => {
      cancelCanvasFrame(frameKey);
    };
  }, [drawOverlay]);

  // Theme-change redraw guard
  useEffect(() => {
    const el = document.documentElement;
    const cb: MutationCallback = () => {
      if (overlayFrameKey.current) {
        scheduleCanvasFrame(overlayFrameKey.current, 'ui', () => {
          drawOverlay();
        });
      }
    };
    const obs = new MutationObserver(cb);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, [drawOverlay]);

  return drawOverlay;
}
