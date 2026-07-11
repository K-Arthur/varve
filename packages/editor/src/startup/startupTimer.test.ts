import { describe, expect, it } from 'vitest';
import { createStartupTimer } from './startupTimer';

describe('createStartupTimer', () => {
  it('records a mark with timestamp', () => {
    const timer = createStartupTimer();
    timer.mark('app_mount');
    const marks = timer.getMarks();
    expect(marks).toHaveLength(1);
    expect(marks[0].name).toBe('app_mount');
    expect(marks[0].time).toBeGreaterThan(0);
  });

  it('records marks in insertion order', () => {
    const timer = createStartupTimer();
    timer.mark('first');
    timer.mark('second');
    const marks = timer.getMarks();
    expect(marks[0].name).toBe('first');
    expect(marks[1].name).toBe('second');
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
});
