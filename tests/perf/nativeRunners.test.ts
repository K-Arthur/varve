/**
 * Unit tests for the native runners' pure logic — duration parsing, streaming
 * aggregates, growth-slope estimation, build-mode detection, profiler
 * capability interpretation, and perf command construction.
 *
 * Deliberately does not require perf, sysprof or a Tauri binary to be present:
 * CI must be able to verify the runners' decision-making without a native
 * profiling toolchain installed.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script, no type declarations.
import {
  GrowthSlope,
  parseDuration,
  resolveReleaseBinary,
  StreamingStat,
} from '../../scripts/perf/native-soak.mjs';
// @ts-expect-error — plain ESM script, no type declarations.
import {
  buildPerfCommand,
  interpretParanoid,
  interpretPtraceScope,
} from '../../scripts/perf/webkit-profile.mjs';

describe('parseDuration', () => {
  it('accepts hours, minutes, seconds and bare milliseconds', () => {
    expect(parseDuration('4h')).toBe(4 * 3_600_000);
    expect(parseDuration('30m')).toBe(30 * 60_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('500')).toBe(500);
  });

  it('accepts fractional values', () => {
    expect(parseDuration('1.5h')).toBe(5_400_000);
  });

  it('rejects nonsense rather than silently running forever', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('4 hours')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });
});

describe('StreamingStat', () => {
  it('summarizes without retaining samples', () => {
    const stat = new StreamingStat();
    for (const value of [2, 4, 4, 4, 5, 5, 7, 9]) stat.add(value);
    const json = stat.toJSON();
    expect(json.count).toBe(8);
    expect(json.min).toBe(2);
    expect(json.max).toBe(9);
    expect(json.mean).toBeCloseTo(5, 6);
    // Sample standard deviation of that classic series.
    expect(json.stddev).toBeCloseTo(2.138, 3);
  });

  it('stays constant-memory over a long run', () => {
    const stat = new StreamingStat();
    for (let i = 0; i < 200_000; i++) stat.add(i);
    expect(stat.toJSON().count).toBe(200_000);
    // No array of samples is retained anywhere on the instance.
    expect(Object.values(stat).some((v) => Array.isArray(v))).toBe(false);
  });

  it('reports an empty summary before any sample', () => {
    expect(new StreamingStat().toJSON()).toEqual({ count: 0 });
  });

  it('ignores non-finite values', () => {
    const stat = new StreamingStat();
    stat.add(Number.NaN);
    stat.add(Number.POSITIVE_INFINITY);
    expect(stat.toJSON().count).toBe(0);
  });
});

describe('GrowthSlope', () => {
  it('recovers a known linear growth rate', () => {
    const slope = new GrowthSlope();
    // 1024 KB of growth per iteration.
    for (let i = 0; i < 100; i++) slope.add(i, 50_000 + i * 1024);
    expect(slope.slope).toBeCloseTo(1024, 6);
  });

  it('reports no growth for a flat series — the plateau case', () => {
    const slope = new GrowthSlope();
    for (let i = 0; i < 100; i++) slope.add(i, 50_000);
    expect(slope.slope).toBeCloseTo(0, 9);
  });

  it('reports negative slope when memory is reclaimed', () => {
    const slope = new GrowthSlope();
    for (let i = 0; i < 50; i++) slope.add(i, 80_000 - i * 200);
    expect(slope.slope).toBeLessThan(0);
  });

  it('does not divide by zero with fewer than two points', () => {
    const slope = new GrowthSlope();
    expect(slope.slope).toBe(0);
    slope.add(1, 100);
    expect(slope.slope).toBe(0);
  });
});

describe('resolveReleaseBinary', () => {
  it('flags an explicit debug path rather than accepting it as release', () => {
    const resolved = resolveReleaseBinary('/tmp/target/debug/strata');
    expect(resolved.isRelease).toBe(false);
  });

  it('accepts an explicit release path', () => {
    const resolved = resolveReleaseBinary('/tmp/target/release/strata');
    expect(resolved.isRelease).toBe(true);
    expect(resolved.mode).toBe('explicit');
  });

  it('reports missing rather than inventing a path', () => {
    // No binary is built in CI; the runner must say so, not guess.
    const resolved = resolveReleaseBinary(null);
    expect(['release', 'debug', 'missing']).toContain(resolved.mode);
    if (resolved.mode === 'missing') expect(resolved.path).toBeNull();
  });
});

describe('interpretParanoid', () => {
  it('treats user-space-only sampling as usable, not as failure', () => {
    // paranoid=2 is the common default and still yields useful flamegraphs.
    const result = interpretParanoid('2');
    expect(result.usable).toBe(true);
    expect(result.detail).toContain('user-space');
  });

  it('reports level 3 as unusable', () => {
    expect(interpretParanoid('3').usable).toBe(false);
  });

  it('allows kernel stacks at level 1 and below', () => {
    expect(interpretParanoid('1').usable).toBe(true);
    expect(interpretParanoid('-1').usable).toBe(true);
  });

  it('handles an unreadable value without throwing', () => {
    expect(interpretParanoid(null).usable).toBe(false);
    expect(interpretParanoid('nonsense').detail).toBe('unreadable');
  });
});

describe('interpretPtraceScope', () => {
  it('recognises that scope 1 blocks attaching to a running session', () => {
    // The default on most distributions, and the reason the gdb/eu-stack
    // fallback cannot profile a session already on screen.
    const result = interpretPtraceScope('1');
    expect(result.attachRunning).toBe(false);
    expect(result.detail).toContain('descendants only');
  });

  it('allows attaching at scope 0', () => {
    expect(interpretPtraceScope('0').attachRunning).toBe(true);
  });

  it('blocks at admin-only and disabled levels', () => {
    expect(interpretPtraceScope('2').attachRunning).toBe(false);
    expect(interpretPtraceScope('3').attachRunning).toBe(false);
  });

  it('treats a missing Yama file as unrestricted', () => {
    expect(interpretPtraceScope(null).attachRunning).toBe(true);
  });
});

describe('buildPerfCommand', () => {
  it('samples every supplied pid with call graphs', () => {
    const [cmd, args] = buildPerfCommand({
      pids: [100, 200, 300],
      durationSeconds: 15,
      output: '/tmp/perf.data',
    });
    expect(cmd).toBe('perf');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('100,200,300');
    expect(args).toContain('--call-graph');
    expect(args.slice(-2)).toEqual(['sleep', '15']);
  });

  it('bounds the capture with an explicit duration rather than running open-ended', () => {
    const [, args] = buildPerfCommand({ pids: [1], durationSeconds: 5, output: 'o' });
    expect(args).toContain('sleep');
    expect(args).toContain('5');
  });

  it('accepts a custom sampling frequency', () => {
    const [, args] = buildPerfCommand({
      pids: [1],
      durationSeconds: 5,
      output: 'o',
      frequency: 997,
    });
    expect(args[args.indexOf('-F') + 1]).toBe('997');
  });

  it('refuses to build a command with no target', () => {
    expect(() => buildPerfCommand({ pids: [], durationSeconds: 5, output: 'o' })).toThrow(
      'no target pids',
    );
  });
});
