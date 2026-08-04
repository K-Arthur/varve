/**
 * CanvasAnnouncer — screen-reader announcement service.
 *
 * Manages two aria-live regions (polite + assertive) mounted on document.body.
 * Provides formatted announcements for selection changes, operations, and
 * generic messages.
 *
 * Research basis: WAI-ARIA 1.2 live regions, APG alert/status patterns.
 */

import type { SceneNode } from '@varve/scene';

export class CanvasAnnouncer {
  private politeEl: HTMLElement | null = null;
  private assertiveEl: HTMLElement | null = null;

  constructor() {
    this.createRegions();
  }

  private createRegions(): void {
    this.politeEl = document.createElement('div');
    this.politeEl.id = 'strata-canvas-announcer-polite';
    this.politeEl.setAttribute('role', 'status');
    this.politeEl.setAttribute('aria-live', 'polite');
    this.politeEl.setAttribute('aria-atomic', 'true');
    Object.assign(this.politeEl.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
    });
    document.body.appendChild(this.politeEl);

    this.assertiveEl = document.createElement('div');
    this.assertiveEl.id = 'strata-canvas-announcer-assertive';
    this.assertiveEl.setAttribute('role', 'alert');
    this.assertiveEl.setAttribute('aria-live', 'assertive');
    this.assertiveEl.setAttribute('aria-atomic', 'true');
    Object.assign(this.assertiveEl.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
    });
    document.body.appendChild(this.assertiveEl);
  }

  announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    const el = priority === 'assertive' ? this.assertiveEl : this.politeEl;
    if (!el) return;
    el.textContent = '';
    const target = el;
    requestAnimationFrame(() => {
      target.textContent = message;
    });
  }

  announceSelection(elements: SceneNode[]): void {
    if (elements.length === 0) {
      this.announce('Selection cleared');
      return;
    }
    if (elements.length > 1) {
      this.announce(`Selected ${elements.length} objects`);
      return;
    }
    const n = elements[0];
    if (!n) return;
    const typeName = nodeTypeForAnnounce(n);
    const bounds = extractBoundsForAnnounce(n);
    const posStr = bounds ? `, x:${Math.round(bounds.x)} y:${Math.round(bounds.y)}` : '';
    const sizeStr = bounds ? `, ${Math.round(bounds.w)}x${Math.round(bounds.h)}` : '';
    this.announce(`Selected: ${n.name}, ${typeName}${posStr}${sizeStr}`);
  }

  announceOperation(op: string, result: string): void {
    this.announce(`${op}: ${result}`, 'polite');
  }

  destroy(): void {
    this.politeEl?.remove();
    this.assertiveEl?.remove();
  }
}

function nodeTypeForAnnounce(n: SceneNode): string {
  if (n.kind === 'shape') {
    const s = n.shape;
    switch (s.kind) {
      case 'rect':
        return 'rectangle';
      case 'ellipse':
        return 'ellipse';
      case 'circle':
        return 'circle';
      case 'line':
        return 'line';
      case 'polygon':
        return 'polygon';
      case 'star':
        return 'star';
      case 'path':
        return 'path';
      case 'arrow':
        return 'arrow';
      default:
        return 'shape';
    }
  }
  return n.kind;
}

function extractBoundsForAnnounce(
  n: SceneNode,
): { x: number; y: number; w: number; h: number } | null {
  const tx = n.transform[4] ?? 0;
  const ty = n.transform[5] ?? 0;
  if (n.kind === 'shape') {
    const s = n.shape;
    if (s.kind === 'rect') return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
    if (s.kind === 'ellipse')
      return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    if (s.kind === 'circle')
      return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
    if (s.kind === 'line') {
      const minX = Math.min(s.from[0], s.to[0]);
      const minY = Math.min(s.from[1], s.to[1]);
      return {
        x: tx + minX,
        y: ty + minY,
        w: Math.abs(s.to[0] - s.from[0]) || 4,
        h: Math.abs(s.to[1] - s.from[1]) || 4,
      };
    }
    if (s.kind === 'polygon')
      return { x: tx + s.cx - s.radius, y: ty + s.cy - s.radius, w: s.radius * 2, h: s.radius * 2 };
    if (s.kind === 'star')
      return {
        x: tx + s.cx - s.outerRadius,
        y: ty + s.cy - s.outerRadius,
        w: s.outerRadius * 2,
        h: s.outerRadius * 2,
      };
  }
  if (n.kind === 'text')
    return { x: tx, y: ty, w: (n.fontSize ?? 16) * 3, h: (n.fontSize ?? 16) * 1.4 };
  if (n.kind === 'frame' || n.kind === 'group') return { x: tx, y: ty, w: 200, h: 160 };
  return null;
}
