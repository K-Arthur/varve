/**
 * Records the sequence of `ReplayTarget` (Canvas2D-shaped) method calls and
 * property writes made during a `replayIr` pass, as plain data — no real
 * rasterization required. This is deliberately a *structural* regression
 * signal, complementary to (and faster/less flaky than) the pixel-based
 * Playwright harness under tests/e2e/visual/: a draw-call sequence diff
 * catches "wrong operation" or "wrong order" bugs (dropped transform, wrong
 * blend mode, swapped paint order) directly and immediately, without any
 * anti-aliasing/DPR/font-rendering noise, and runs in plain Vitest/jsdom.
 *
 * Built as a Proxy over a plain object rather than hand-implementing every
 * `ReplayTarget` method: the interface is large (30+ members) and a manual
 * implementation risks silently missing one, which would make the recorder
 * invisible to exactly the kind of bug it exists to catch.
 */
import type { ReplayTarget } from '../replay';

export type DrawCallEntry =
  | { type: 'call'; method: string; args: unknown[] }
  | { type: 'set'; property: string; value: unknown };

const WRITABLE_PROPERTIES = new Set([
  'font',
  'textBaseline',
  'fillStyle',
  'lineWidth',
  'lineCap',
  'textAlign',
  'lineJoin',
  'strokeStyle',
  'globalAlpha',
  'globalCompositeOperation',
  'filter',
  'lineDashOffset',
  'shadowColor',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
]);

/** Round floats in recorded args so harmless float-precision drift across
 * platforms/engines doesn't register as a structural diff — this recorder
 * is meant to catch "wrong operation," not "15th decimal place differs." */
function normalizeArg(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(normalizeArg);
  return value;
}

export function createRecordingTarget(): { target: ReplayTarget; log: DrawCallEntry[] } {
  const log: DrawCallEntry[] = [];
  const state: Record<string, unknown> = {};

  const gradientStub = {
    addColorStop: () => {
      /* no-op: gradient stop calls aren't part of the draw-call sequence signal */
    },
  };

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_obj, prop: string) {
      if (WRITABLE_PROPERTIES.has(prop)) return state[prop];
      if (
        prop === 'createLinearGradient' ||
        prop === 'createRadialGradient' ||
        prop === 'createConicGradient'
      ) {
        return (...args: unknown[]) => {
          log.push({ type: 'call', method: prop, args: args.map(normalizeArg) });
          return gradientStub;
        };
      }
      if (prop === 'createPattern') {
        return (...args: unknown[]) => {
          log.push({ type: 'call', method: prop, args: args.map(normalizeArg) });
          return null;
        };
      }
      // Any other method call is recorded generically.
      return (...args: unknown[]) => {
        log.push({ type: 'call', method: prop, args: args.map(normalizeArg) });
      };
    },
    set(_obj, prop: string, value: unknown) {
      state[prop] = value;
      log.push({ type: 'set', property: prop, value: normalizeArg(value) });
      return true;
    },
  };

  const target = new Proxy({}, handler) as unknown as ReplayTarget;
  return { target, log };
}

/** Compact, diff-friendly text rendering of a draw-call log for snapshotting. */
export function formatDrawCallLog(log: DrawCallEntry[]): string {
  return log
    .map((entry) =>
      entry.type === 'call'
        ? `call ${entry.method}(${entry.args.map((a) => JSON.stringify(a)).join(', ')})`
        : `set ${entry.property} = ${JSON.stringify(entry.value)}`,
    )
    .join('\n');
}
