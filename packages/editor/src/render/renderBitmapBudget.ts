/**
 * Byte-based bitmap budget for the render-worker pipeline.
 *
 * Accounts the main-thread-visible copies that cross (or wait to cross) the
 * worker boundary — pre-decoded ImageBitmaps queued or in flight, the
 * OffscreenCanvas backing store the worker replays into, the returned
 * frame bitmap retained for camera compensation, and the *source bitmaps
 * resident inside the worker* (retained by identity across frames so
 * unchanged photos are never re-transferred). The budget bounds what the
 * app *pays for* on the interaction path: an over-budget render is refused
 * up front and the frame falls back to main-thread Canvas2D instead of
 * ballooning worker memory.
 *
 * Admission policy (mission §32/§71): a render is refused when
 * pending + in-flight + resident source + retained frame + worker canvas +
 * the new transfer would exceed the budget. Worker source residency is
 * therefore never silently unbounded — a worker cannot accept 500 MiB of
 * photos merely because its outgoing transfer queue is small.
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
  /** Bytes of source bitmaps retained inside the worker (by identity). */
  residentSourceBytes: number;
  /** Peak of pending + inFlight + resident + workerCanvas + residentSource. */
  peakTotalBytes: number;
  /** Times admission control refused a transfer. */
  admissionRejections: number;
  /** Times a reservation/resident was released. */
  disposalCount: number;
  /** Times a reservation was successfully made. */
  reserveCount: number;
  /** Peak resident source bytes held inside the worker. */
  residentSourcePeakBytes: number;
  /** Source identities added to worker residency (set deltas). */
  sourceAdds: number;
  /** Source identities removed from worker residency (set deltas). */
  sourceRemoves: number;
  /** Source identities retained across frames without re-transfer. */
  sourceReuses: number;
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
  private residentSourceBytes = 0;
  private peakTotalBytes = 0;
  private admissionRejections = 0;
  private disposalCount = 0;
  private reserveCount = 0;
  private residentSourcePeakBytes = 0;
  private sourceAdds = 0;
  private sourceRemoves = 0;
  private sourceReuses = 0;

  constructor(budgetBytes: number) {
    this.budgetBytes = budgetBytes;
  }

  setBudget(bytes: number): void {
    this.budgetBytes = Math.max(0, bytes);
  }

  get totalBytes(): number {
    return (
      this.pendingBytes +
      this.inFlightBytes +
      this.residentBytes +
      this.workerCanvasBytes +
      this.residentSourceBytes
    );
  }

  get state(): BitmapBudgetState {
    return {
      budgetBytes: this.budgetBytes,
      pendingBytes: this.pendingBytes,
      inFlightBytes: this.inFlightBytes,
      residentBytes: this.residentBytes,
      workerCanvasBytes: this.workerCanvasBytes,
      residentSourceBytes: this.residentSourceBytes,
      peakTotalBytes: this.peakTotalBytes,
      admissionRejections: this.admissionRejections,
      disposalCount: this.disposalCount,
      reserveCount: this.reserveCount,
      residentSourcePeakBytes: this.residentSourcePeakBytes,
      sourceAdds: this.sourceAdds,
      sourceRemoves: this.sourceRemoves,
      sourceReuses: this.sourceReuses,
    };
  }

  /**
   * Try to reserve outbound transfer bytes. Admission considers worker
   * source residency, the retained frame, and the worker canvas in
   * addition to pending + in-flight transfers, so over-budget scenes are
   * refused deterministically. Returns false — without reserving anything —
   * when the transfer would exceed the budget; callers must close the
   * bitmaps and fall back to a cheaper path.
   */
  tryReserveTransfer(bytes: number): boolean {
    if (bytes <= 0) return true;
    if (
      this.pendingBytes +
        this.inFlightBytes +
        this.residentBytes +
        this.workerCanvasBytes +
        this.residentSourceBytes +
        bytes >
      this.budgetBytes
    ) {
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

  /**
   * Account source bitmaps resident inside the worker (reported by the
   * worker per frame), replacing the previous residency figure.
   */
  accountResidentSource(bytes: number, previousBytes = 0): void {
    if (previousBytes > 0) {
      this.residentSourceBytes = Math.max(0, this.residentSourceBytes - previousBytes);
    }
    this.residentSourceBytes += Math.max(0, bytes);
    if (this.residentSourceBytes > this.residentSourcePeakBytes) {
      this.residentSourcePeakBytes = this.residentSourceBytes;
    }
    this.trackPeak();
  }

  /** Release source residency (worker teardown / permanent failure). */
  releaseResidentSource(bytes: number): void {
    if (bytes <= 0) return;
    this.residentSourceBytes = Math.max(0, this.residentSourceBytes - bytes);
    this.disposalCount++;
  }

  /** Record worker-residency set deltas (diagnostics counters). */
  recordSourceSetDelta(adds: number, removes: number, reuses: number): void {
    this.sourceAdds += Math.max(0, adds);
    this.sourceRemoves += Math.max(0, removes);
    this.sourceReuses += Math.max(0, reuses);
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
    this.residentSourceBytes = 0;
    this.peakTotalBytes = 0;
    this.admissionRejections = 0;
    this.disposalCount = 0;
    this.reserveCount = 0;
    this.residentSourcePeakBytes = 0;
    this.sourceAdds = 0;
    this.sourceRemoves = 0;
    this.sourceReuses = 0;
  }

  private trackPeak(): void {
    if (this.totalBytes > this.peakTotalBytes) this.peakTotalBytes = this.totalBytes;
  }
}
