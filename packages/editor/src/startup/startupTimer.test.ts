import { describe, expect, it } from 'vitest';
import { createStartupTimer, STARTUP_MILESTONES } from './startupTimer';

describe('createStartupTimer', () => {
  it('records a mark with timestamp', () => {
    const timer = createStartupTimer();
    timer.mark('app_mount');
    const marks = timer.getMarks();
    expect(marks).toHaveLength(1);
    expect(marks[0]?.name).toBe('app_mount');
    expect(marks[0]?.time).toBeGreaterThan(0);
  });

  it('records marks in insertion order', () => {
    const timer = createStartupTimer();
    timer.mark('first');
    timer.mark('second');
    const marks = timer.getMarks();
    expect(marks[0]?.name).toBe('first');
    expect(marks[1]?.name).toBe('second');
  });

  it('computes elapsed from first to last mark', () => {
    const timer = createStartupTimer();
    timer.mark('start');
    timer.mark('mid');
    timer.mark('end');
    const elapsed = timer.elapsed();
    expect(typeof elapsed).toBe('number');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('returns zero elapsed when no marks exist', () => {
    const timer = createStartupTimer();
    expect(timer.elapsed()).toBe(0);
  });

  it('returns a frozen snapshot of marks', () => {
    const timer = createStartupTimer();
    timer.mark('a');
    const marks = timer.getMarks();
    timer.mark('b');
    expect(marks).toHaveLength(1);
  });

  it('records lifecycle milestones once under duplicate effects', () => {
    const userMarks: string[] = [];
    const timer = createStartupTimer(
      () => 12,
      (name) => userMarks.push(name),
    );

    expect(timer.markOnce(STARTUP_MILESTONES.HOME_INTERACTIVE)).toBe(true);
    expect(timer.markOnce(STARTUP_MILESTONES.HOME_INTERACTIVE)).toBe(false);
    expect(timer.getMarks()).toHaveLength(1);
    expect(userMarks).toEqual([STARTUP_MILESTONES.HOME_INTERACTIVE]);
  });

  it('exports a versioned timeline with monotonic timestamps', () => {
    const times = [10, 8, 14];
    const timer = createStartupTimer(
      () => times.shift() ?? 14,
      () => undefined,
    );
    timer.mark('mount');
    timer.mark('state');
    timer.mark('visible');

    const exported = timer.exportTimeline();
    expect(exported.schemaVersion).toBe(1);
    expect(exported.clock).toBe('performance-now');
    expect(exported.marks.map((mark) => mark.time)).toEqual([10, 10, 14]);
    expect(() => JSON.stringify(exported)).not.toThrow();
  });
});
