/**
 * Byte-based bitmap budget for the render-worker pipeline.
 *
 * Accounts the main-thread-visible copies that cross (or wait to cross) the
 * worker boundary — pre-decoded ImageBitmaps queued or in flight, the
 * OffscreenCanvas backing store the worker replays into, and the returned
 * frame bitmap retained for camera compensation. The budget bounds what the
 * app *pays for* on the interaction path: an over-budget render is refused
 * up front and the frame falls back to main-thread Canvas2D instead of
 * ballooning worker memory.
 *
 * Estimates are `width * height * 4` (RGBA). This deliberately does not try
 * to model mip levels, texture padding, GPU backing or double buffering —
 * those are backend-specific and unknowable from the JS side; the estimate is
 * a documented, deterministic admission gate, not an exact RSS measurement.
 */
export interface BitmapBudgetState {
  budgetBytes: number;
  /** Bytes reserved for a render waiting to be dispatched (pending). */
  pendingBytes: number;
  /** Bytes reserved for the currently dispatched render's transfer. */
  inFlightBytes: number;
  /** Bytes of the currently retained returned frame bitmap. */
  residentBytes: number;
  /** Estimated bytes of the worker's OffscreenCanvas backing store. */
  workerCanvasBytes: number;
  /** Peak of pending + inFlight + resident + workerCanvas. */
  peakTotalBytes: number;
  /** Times admission control refused a transfer. */
  admissionRejections: number;
  /** Times a reservation/resident was released. */
  disposalCount: number;
  /** Times a reservation was successfully made. */
  reserveCount: number;
}

export function estimateRgbaBytes(width: number, height: number, channels = 4): number {
  const w = Math.max(0, Math.ceil(width));
  const h = Math.max(0, Math.ceil(height));
  return w * h * channels;
}

/** Sum the estimated bytes of every ImageBitmap in a transfer map. */
export function estimateImagesBytes(images: Readonly<Record<string, ImageBitmap>>): number {
  let total = 0;
  for (const bmp of Object.values(images)) {
    total += estimateRgbaBytes(bmp.width, bmp.height);
  }
  return total;
}

export class RenderBitmapBudget {
  private budgetBytes: number;
  private pendingBytes = 0;
  private inFlightBytes = 0;
  private residentBytes = 0;
  private workerCanvasBytes = 0;
  private peakTotalBytes = 0;
  private admissionRejections = 0;
  private disposalCount = 0;
  private reserveCount = 0;

  constructor(budgetBytes: number) {
    this.budgetBytes = budgetBytes;
  }

  setBudget(bytes: number): void {
    this.budgetBytes = Math.max(0, bytes);
  }

  get totalBytes(): number {
    return this.pendingBytes + this.inFlightBytes + this.residentBytes + this.workerCanvasBytes;
  }

  get state(): BitmapBudgetState {
    return {
      budgetBytes: this.budgetBytes,
      pendingBytes: this.pendingBytes,
      inFlightBytes: this.inFlightBytes,
      residentBytes: this.residentBytes,
      workerCanvasBytes: this.workerCanvasBytes,
      peakTotalBytes: this.peakTotalBytes,
      admissionRejections: this.admissionRejections,
      disposalCount: this.disposalCount,
      reserveCount: this.reserveCount,
    };
  }

  /**
   * Try to reserve outbound transfer bytes (pending + in-flight are capped by
   * the budget). Returns false — without reserving anything — when the
   * transfer would exceed the budget; callers must close the bitmaps and fall
   * back to a cheaper path.
   */
  tryReserveTransfer(bytes: number): boolean {
    if (bytes <= 0) return true;
    if (this.pendingBytes + this.inFlightBytes + bytes > this.budgetBytes) {
      this.admissionRejections++;
      return false;
    }
    this.pendingBytes += bytes;
    this.reserveCount++;
    this.trackPeak();
    return true;
  }

  /** Move a pending reservation to in-flight once the transfer is actually posted. */
  commitTransfer(bytes: number): void {
    if (bytes <= 0) return;
    const moved = Math.min(bytes, this.pendingBytes);
    this.pendingBytes -= moved;
    this.inFlightBytes += moved;
    this.trackPeak();
  }

  /** Release an outbound reservation (superseded, closed, or completed). */
  releaseTransfer(bytes: number): void {
    if (bytes <= 0) return;
    let remaining = bytes;
    const fromPending = Math.min(remaining, this.pendingBytes);
    this.pendingBytes -= fromPending;
    remaining -= fromPending;
    const fromInFlight = Math.min(remaining, this.inFlightBytes);
    this.inFlightBytes -= fromInFlight;
    if (bytes > 0) this.disposalCount++;
  }

  /** Account a returned frame bitmap, releasing the previously retained one. */
  accountResidentFrame(bytes: number, previousBytes = 0): void {
    if (previousBytes > 0) {
      this.residentBytes = Math.max(0, this.residentBytes - previousBytes);
      this.disposalCount++;
    }
    this.residentBytes += Math.max(0, bytes);
    this.trackPeak();
  }

  /** Release a returned frame bitmap that is no longer retained. */
  releaseResident(bytes: number): void {
    if (bytes <= 0) return;
    this.residentBytes = Math.max(0, this.residentBytes - bytes);
    this.disposalCount++;
  }

  /** Record the worker's OffscreenCanvas backing-store estimate (per resize). */
  setWorkerCanvasBytes(bytes: number): void {
    this.workerCanvasBytes = Math.max(0, bytes);
    this.trackPeak();
  }

  reset(): void {
    this.pendingBytes = 0;
    this.inFlightBytes = 0;
    this.residentBytes = 0;
    this.workerCanvasBytes = 0;
    this.peakTotalBytes = 0;
    this.admissionRejections = 0;
    this.disposalCount = 0;
    this.reserveCount = 0;
  }

  private trackPeak(): void {
    if (this.totalBytes > this.peakTotalBytes) this.peakTotalBytes = this.totalBytes;
  }
}
