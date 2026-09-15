import { beforeEach, describe, expect, it } from 'vitest';
import {
  enableInputDiagnostics,
  getInputDiagnosticCount,
  getRecentInputDiagnostics,
  isInputDiagnosticsEnabled,
  recordInputDiagnostic,
  resetInputDiagnostics,
} from './inputDiagnostics';

beforeEach(() => {
  resetInputDiagnostics();
  enableInputDiagnostics(false);
});

describe('inputDiagnostics', () => {
  it('is disabled by default and drops records', () => {
    expect(isInputDiagnosticsEnabled()).toBe(false);
    recordInputDiagnostic({
      eventType: 'wheel',
      source: 'wheel',
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    });
    expect(getInputDiagnosticCount()).toBe(0);
  });

  it('records normalized events when enabled', () => {
    enableInputDiagnostics(true);
    const rec = recordInputDiagnostic({
      eventType: 'wheel',
      source: 'wheel',
      modifiers: { shift: false, ctrl: true, alt: false, meta: false },
      wheel: { deltaX: 0, deltaY: -10, deltaMode: 0, source: 'trackpad', kind: 'zoom', scale: 1.1 },
    });
    expect(rec).not.toBeNull();
    expect(rec!.seq).toBe(0);
    expect(rec!.eventType).toBe('wheel');
    expect(rec!.wheel?.scale).toBe(1.1);
    expect(getInputDiagnosticCount()).toBe(1);
  });

  it('does not record when explicitly disabled', () => {
    enableInputDiagnostics(true);
    enableInputDiagnostics(false);
    recordInputDiagnostic({
      eventType: 'pointerdown',
      source: 'mouse',
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    });
    expect(getInputDiagnosticCount()).toBe(0);
  });

  it('getRecentInputDiagnostics returns records in order', () => {
    enableInputDiagnostics(true);
    for (let i = 0; i < 5; i++) {
      recordInputDiagnostic({
        eventType: `t${i}`,
        source: 'unknown',
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      });
    }
    expect(getRecentInputDiagnostics(3).map((r) => r.eventType)).toEqual(['t2', 't3', 't4']);
    expect(getRecentInputDiagnostics(100)).toHaveLength(5);
  });

  it('bounds the ring buffer at MAX_DIAG_RECORDS', () => {
    enableInputDiagnostics(true);
    for (let i = 0; i < 250; i++) {
      recordInputDiagnostic({
        eventType: `t${i}`,
        source: 'unknown',
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      });
    }
    expect(getInputDiagnosticCount()).toBeLessThanOrEqual(200);
    expect(getInputDiagnosticCount()).toBe(200);
    const recent = getRecentInputDiagnostics(200);
    expect(recent[0]!.eventType).toBe('t50');
    expect(recent[199]!.eventType).toBe('t249');
  });

  it('reset clears the ring and restarts the sequence', () => {
    enableInputDiagnostics(true);
    recordInputDiagnostic({
      eventType: 'a',
      source: 'unknown',
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    });
    resetInputDiagnostics();
    expect(getInputDiagnosticCount()).toBe(0);
    recordInputDiagnostic({
      eventType: 'b',
      source: 'unknown',
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    });
    expect(
      recordInputDiagnostic({
        eventType: 'c',
        source: 'unknown',
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      })!.seq,
    ).toBe(1);
  });

  it('captures viewport and timing fields', () => {
    enableInputDiagnostics(true);
    const rec = recordInputDiagnostic({
      eventType: 'wheel',
      source: 'wheel',
      modifiers: { shift: false, ctrl: true, alt: false, meta: false },
      viewport: { zoom: 1.5, panX: 10, panY: -5, rotation: 0 },
      processingMs: 0.42,
      preventedDefault: true,
    });
    expect(rec!.viewport).toEqual({ zoom: 1.5, panX: 10, panY: -5, rotation: 0 });
    expect(rec!.processingMs).toBe(0.42);
    expect(rec!.preventedDefault).toBe(true);
  });
});
