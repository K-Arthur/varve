import { describe, expect, it } from 'vitest';
import { estimateImagesBytes, estimateRgbaBytes, RenderBitmapBudget } from './renderBitmapBudget';

function bmp(w: number, h: number): ImageBitmap {
  return { width: w, height: h, close: () => undefined } as unknown as ImageBitmap;
}

describe('estimateRgbaBytes', () => {
  it('computes width * height * 4', () => {
    expect(estimateRgbaBytes(100, 50)).toBe(20000);
    expect(estimateRgbaBytes(0, 100)).toBe(0);
    expect(estimateRgbaBytes(-10, 100)).toBe(0);
  });

  it('supports a custom channel count', () => {
    expect(estimateRgbaBytes(10, 10, 2)).toBe(200);
  });

  it('sums an image map', () => {
    expect(estimateImagesBytes({ a: bmp(100, 100), b: bmp(10, 10) })).toBe(100 * 100 * 4 + 400);
    expect(estimateImagesBytes({})).toBe(0);
  });
});

describe('RenderBitmapBudget', () => {
  it('admits transfers up to the budget and rejects beyond it', () => {
    const budget = new RenderBitmapBudget(1000);
    expect(budget.tryReserveTransfer(600)).toBe(true);
    expect(budget.tryReserveTransfer(400)).toBe(true); // 600 + 400 = budget
    expect(budget.tryReserveTransfer(1)).toBe(false); // over budget
    expect(budget.state.admissionRejections).toBe(1);
    expect(budget.state.pendingBytes).toBe(1000);
    expect(budget.state.inFlightBytes).toBe(0);
  });

  it('moves pending reservations to in-flight on commit', () => {
    const budget = new RenderBitmapBudget(1000);
    budget.tryReserveTransfer(400);
    budget.commitTransfer(400);
    expect(budget.state.pendingBytes).toBe(0);
    expect(budget.state.inFlightBytes).toBe(400);
  });

  it('releases reservations without going negative', () => {
    const budget = new RenderBitmapBudget(1000);
    budget.tryReserveTransfer(300);
    budget.commitTransfer(300);
    budget.releaseTransfer(500); // over-release is clamped
    expect(budget.state.inFlightBytes).toBe(0);
    expect(budget.state.pendingBytes).toBe(0);
    expect(budget.state.disposalCount).toBe(1);
  });

  it('clamps partial releases across pending and in-flight', () => {
    const budget = new RenderBitmapBudget(1000);
    budget.tryReserveTransfer(400); // pending
    budget.tryReserveTransfer(300); // pending (replaced by newer? no — both pending)
    budget.commitTransfer(400); // 400 in-flight, 300 still pending
    budget.releaseTransfer(500); // takes 300 pending + 200 in-flight
    expect(budget.state.pendingBytes).toBe(0);
    expect(budget.state.inFlightBytes).toBe(200);
  });

  it('tracks resident frame bytes and releases the previous frame', () => {
    const budget = new RenderBitmapBudget(1000);
    budget.accountResidentFrame(400);
    expect(budget.state.residentBytes).toBe(400);
    budget.accountResidentFrame(300, 400); // replace 400-byte frame with 300-byte frame
    expect(budget.state.residentBytes).toBe(300);
    budget.releaseResident(300);
    expect(budget.state.residentBytes).toBe(0);
    expect(budget.state.disposalCount).toBe(2);
  });

  it('tracks the worker canvas backing store', () => {
    const budget = new RenderBitmapBudget(1000);
    budget.setWorkerCanvasBytes(estimateRgbaBytes(800 * 2, 600 * 2));
    expect(budget.state.workerCanvasBytes).toBe(800 * 2 * 600 * 2 * 4);
  });

  it('records a peak high-water mark across all categories', () => {
    const budget = new RenderBitmapBudget(10_000);
    budget.tryReserveTransfer(2000);
    budget.commitTransfer(2000);
    budget.setWorkerCanvasBytes(3000);
    budget.accountResidentFrame(1000);
    expect(budget.state.peakTotalBytes).toBe(2000 + 3000 + 1000);
    budget.releaseTransfer(2000);
    budget.releaseResident(1000);
    budget.setWorkerCanvasBytes(0);
    expect(budget.state.peakTotalBytes).toBe(2000 + 3000 + 1000); // peak retained
  });

  it('ignores non-positive reservations and releases', () => {
    const budget = new RenderBitmapBudget(100);
    expect(budget.tryReserveTransfer(0)).toBe(true);
    budget.commitTransfer(0);
    budget.releaseTransfer(-5);
    budget.releaseResident(0);
    expect(budget.state.pendingBytes).toBe(0);
    expect(budget.state.inFlightBytes).toBe(0);
  });

  it('reset clears all accounting and peak', () => {
    const budget = new RenderBitmapBudget(100);
    budget.tryReserveTransfer(80);
    budget.accountResidentFrame(20);
    budget.reset();
    const state = budget.state;
    expect(state.pendingBytes).toBe(0);
    expect(state.residentBytes).toBe(0);
    expect(state.peakTotalBytes).toBe(0);
    expect(state.admissionRejections).toBe(0);
  });

  it('budget can be resized dynamically', () => {
    const budget = new RenderBitmapBudget(100);
    expect(budget.tryReserveTransfer(200)).toBe(false);
    budget.setBudget(1000);
    expect(budget.tryReserveTransfer(200)).toBe(true);
  });

  it('accounts worker-resident source bitmaps and releases them on teardown', () => {
    const budget = new RenderBitmapBudget(1000);
    budget.accountResidentSource(400);
    expect(budget.state.residentSourceBytes).toBe(400);
    expect(budget.state.residentSourcePeakBytes).toBe(400);
    budget.accountResidentSource(600, 400); // replacement: 600 - 400
    expect(budget.state.residentSourceBytes).toBe(600);
    expect(budget.state.residentSourcePeakBytes).toBe(600);
    budget.accountResidentSource(300, 600); // shrink
    expect(budget.state.residentSourceBytes).toBe(300);
    expect(budget.state.residentSourcePeakBytes).toBe(600); // peak retained
    budget.releaseResidentSource(300);
    expect(budget.state.residentSourceBytes).toBe(0);
    expect(budget.state.residentSourcePeakBytes).toBe(600);
  });

  it('includes worker source residency and canvas in the admission gate', () => {
    const budget = new RenderBitmapBudget(1000);
    budget.accountResidentSource(400);
    // 400 resident + 700 transfer > 1000: refused.
    expect(budget.tryReserveTransfer(700)).toBe(false);
    // 400 + 600 = 1000: admitted exactly at the budget.
    expect(budget.tryReserveTransfer(600)).toBe(true);
    budget.releaseTransfer(600);
    // With a 300-byte worker canvas and a 200-byte retained frame:
    budget.setWorkerCanvasBytes(300);
    budget.accountResidentFrame(200);
    expect(budget.tryReserveTransfer(100)).toBe(true); // 400+300+200+100 = 1000
    expect(budget.tryReserveTransfer(1)).toBe(false); // would exceed
    expect(budget.state.admissionRejections).toBe(2);
  });

  it('records source set deltas as diagnostics counters', () => {
    const budget = new RenderBitmapBudget(1000);
    budget.recordSourceSetDelta(2, 1, 3);
    budget.recordSourceSetDelta(0, 2, 1);
    expect(budget.state.sourceAdds).toBe(2);
    expect(budget.state.sourceRemoves).toBe(3);
    expect(budget.state.sourceReuses).toBe(4);
  });

  it('peak includes resident source bytes', () => {
    const budget = new RenderBitmapBudget(10_000);
    budget.accountResidentSource(2500);
    budget.tryReserveTransfer(1000);
    expect(budget.state.peakTotalBytes).toBe(3500);
    budget.releaseResidentSource(2500);
    expect(budget.state.peakTotalBytes).toBe(3500); // peak retained
  });
});
