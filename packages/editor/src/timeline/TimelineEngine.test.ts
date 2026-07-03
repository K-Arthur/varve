/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineEngine } from './TimelineEngine';

describe('TimelineEngine', () => {
  let engine: TimelineEngine;
  let onFrame: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    engine = new TimelineEngine({ duration: 5000 });
    onFrame = vi.fn();
  });

  afterEach(() => {
    engine.stop();
  });

  it('starts in idle state with currentTime 0', () => {
    expect(engine.state).toBe('idle');
    expect(engine.currentTime).toBe(0);
    expect(engine.currentIteration).toBe(0);
  });

  it('plays and calls onFrame callback', () => {
    engine.play({ onFrame });
    expect(engine.state).toBe('playing');
    engine.processDelta(100);
    expect(onFrame).toHaveBeenCalled();
    expect(engine.currentTime).toBeGreaterThan(0);
  });

  it('pauses and preserves current time', () => {
    engine.play({ onFrame });
    engine.processDelta(500);
    engine.pause();
    const pausedTime = engine.currentTime;
    expect(engine.state).toBe('paused');
    engine.processDelta(500); // Should be no-op while paused
    expect(engine.currentTime).toBe(pausedTime);
  });

  it('seeks to a specific time', () => {
    engine.seek(2000);
    expect(engine.currentTime).toBe(2000);
  });

  it('seek calls onFrame when set', () => {
    engine.play({ onFrame });
    engine.seek(3000);
    expect(onFrame).toHaveBeenCalledWith(3000, 0);
  });

  it('clamps time to [0, duration]', () => {
    engine.seek(-100);
    expect(engine.currentTime).toBe(0);
    engine.seek(10000);
    expect(engine.currentTime).toBe(5000);
  });

  it('reports finished state at end', () => {
    engine.play({ onFrame });
    engine.processDelta(5000);
    expect(engine.state).toBe('finished');
  });

  it('supports speed control', () => {
    engine.setSpeed(2);
    engine.play({ onFrame });
    engine.processDelta(1000);
    // At 2x speed, 1000ms real time = 2000ms animation time
    expect(engine.currentTime).toBeGreaterThanOrEqual(1990);
    expect(engine.currentTime).toBeLessThanOrEqual(2010);
  });

  it('supports reverse playback', () => {
    engine.seek(4000);
    engine.play({ onFrame, direction: 'reverse' });
    engine.processDelta(500);
    expect(engine.currentTime).toBe(3500);
  });

  it('stops and resets', () => {
    engine.play({ onFrame });
    engine.processDelta(500);
    engine.stop();
    expect(engine.state).toBe('idle');
    expect(engine.currentTime).toBe(0);
    expect(engine.currentIteration).toBe(0);
  });

  it('calls onFinish callback when playback completes', () => {
    const onFinish = vi.fn();
    engine.play({ onFrame, onFinish });
    engine.processDelta(5000);
    expect(onFinish).toHaveBeenCalled();
  });

  it('calls onIteration callback on iteration change', () => {
    const onIteration = vi.fn();
    engine = new TimelineEngine({ duration: 1000, iterations: 3 });
    engine.play({ onFrame, onIteration });
    engine.processDelta(2500);
    expect(onIteration).toHaveBeenCalled();
  });

  it('exposes duration and iterations config', () => {
    const e = new TimelineEngine({ duration: 3000, iterations: 5 });
    expect(e.duration).toBe(3000);
    expect(e.iterations).toBe(5);
  });

  it('defaults to 1 iteration', () => {
    expect(engine.iterations).toBe(1);
  });

  it('exposes speed', () => {
    engine.setSpeed(0.5);
    expect(engine.speed).toBe(0.5);
  });

  it('clamps speed to minimum 0.01', () => {
    engine.setSpeed(0);
    expect(engine.speed).toBe(0.01);
    engine.setSpeed(-5);
    expect(engine.speed).toBe(0.01);
  });

  it('handles multiple processDelta calls', () => {
    engine.play({ onFrame });
    engine.processDelta(1000);
    const t1 = engine.currentTime;
    engine.processDelta(1000);
    expect(engine.currentTime).toBeGreaterThan(t1);
  });

  it('clamps to duration when processDelta exceeds it', () => {
    engine.play({ onFrame });
    engine.processDelta(10000);
    expect(engine.currentTime).toBe(5000);
    expect(engine.state).toBe('finished');
  });

  it('does not advance while paused', () => {
    engine.play({ onFrame });
    engine.processDelta(1000);
    engine.pause();
    const paused = engine.currentTime;
    engine.processDelta(5000);
    expect(engine.currentTime).toBe(paused);
  });

  it('does not advance after stop', () => {
    engine.play({ onFrame });
    engine.processDelta(500);
    engine.stop();
    engine.processDelta(5000);
    expect(engine.currentTime).toBe(0);
  });
});
