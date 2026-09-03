/** Structural Canvas2D types shared by the replay implementation and helpers. */

export interface ReplayTarget {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rot: number,
    start: number,
    end: number,
  ): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  /** Rounded-rect path (Canvas2D `roundRect`); radii mirror the CSS shorthand forms. */
  roundRect?(x: number, y: number, w: number, h: number, radii: number | number[]): void;
  fill(fillRule?: CanvasFillRule): void;
  stroke(): void;
  closePath(): void;
  clip(): void;
  fillText(text: string, x: number, y: number): void;
  /** Optional measurement hook used to derive a canonical browser snapshot. */
  measureText?(text: string): TextMetrics;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  textAlign: CanvasTextAlign;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  /** F6: opacity for the item layer. */
  globalAlpha: number;
  /** F6: blend mode compositing. */
  globalCompositeOperation: string;
  /** F6: CSS filter for effects. */
  filter: string;
  lineDashOffset: number;
  setLineDash(segments: number[]): void;
  /**
   * Draw an image. Supports Canvas2D overloads:
   *   3-arg: drawImage(image, dx, dy)
   *   5-arg: drawImage(image, dx, dy, dw, dh)
   *   9-arg: drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
   */
  drawImage?(
    image: CanvasImageSource | string,
    a1: number,
    a2: number,
    a3?: number,
    a4?: number,
    a5?: number,
    a6?: number,
    a7?: number,
    a8?: number,
  ): void;
  /** P2: create a linear gradient for gradient fills. */
  createLinearGradient?(x0: number, y0: number, x1: number, y1: number): ReplayGradient;
  /** P2: create a radial gradient for gradient fills. */
  createRadialGradient?(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): ReplayGradient;
  /** P2: create a conic gradient for angular gradient fills. */
  createConicGradient?(angle: number, cx: number, cy: number): ReplayGradient;
  /** P2: for shadow effects (replay clips shadow pass). */
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  /** Create a pattern from an image source. */
  createPattern?(image: CanvasImageSource | string, repetition: string): ReplayPattern | null;
  /** Canvas element reference for offscreen compositing (filter compositor, background blur). */
  canvas?: { width: number; height: number };
  /** Reset the current transform matrix (Canvas2D setTransform). */
  setTransform?(a: number, b: number, c: number, d: number, e: number, f: number): void;
  /** Read the current transform matrix (Canvas2D getTransform). */
  getTransform?(): { a: number; b: number; c: number; d: number; e: number; f: number };
  getImageData?(x: number, y: number, width: number, height: number): ImageData;
  putImageData?(data: ImageData, x: number, y: number): void;
}

export interface ReplayPattern {
  /** Transform the pattern's coordinate system. */
  setTransform(transform: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  }): void;
}

export interface ReplayGradient {
  addColorStop(offset: number, color: string): void;
}
