/**
 * Transient preview canvas for brush stroke preview rendering.
 *
 * Renders predicted pointer events as a temporary overlay that is:
 * - Drawn on top of the main canvas
 * - Cleared when confirmed events arrive
 * - Never committed to document history
 * - Discarded on pointer up / cancel / tool switch
 *
 * Architecture:
 * - Uses an OffscreenCanvas matching the canvas dimensions
 * - Stamped with predicted dabs using the same compositing as the real path
 * - On each re-prediction, the canvas is cleared and re-drawn
 * - Falls back gracefully when OffscreenCanvas is unavailable
 */

export class PreviewCanvas {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;

  /** Ensure the canvas is sized to match the given dimensions. */
  ensureSize(w: number, h: number): void {
    if (this.width === w && this.height === h && this.canvas) return;
    this.width = w;
    this.height = h;
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(Math.ceil(w), Math.ceil(h));
      this.ctx = this.canvas.getContext('2d');
    }
  }

  /** Clear the preview canvas completely. */
  clear(): void {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** Get the offscreen canvas for compositing. Returns null if unavailable. */
  getCanvas(): OffscreenCanvas | null {
    return this.canvas;
  }

  /** Get the 2D context for drawing. Returns null if unavailable. */
  getContext(): OffscreenCanvasRenderingContext2D | null {
    return this.ctx;
  }

  /** Draw predicted dabs as semi-transparent circles. */
  drawPredictedDabs(
    dabs: Array<{ x: number; y: number; radius: number; opacity: number }>,
    color: [number, number, number, number],
  ): void {
    if (!this.ctx) return;
    for (const dab of dabs) {
      this.ctx.beginPath();
      this.ctx.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${dab.opacity * 0.4})`;
      this.ctx.fill();
    }
  }

  /** Destroy and free resources. */
  destroy(): void {
    this.canvas = null;
    this.ctx = null;
    this.width = 0;
    this.height = 0;
  }
}
