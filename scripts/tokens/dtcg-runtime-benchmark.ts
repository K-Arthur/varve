/**
 * Reproducible, deliberately small DTCG Format pipeline benchmark.
 *
 * Measures parsing plus resolved-value validation, reference-graph building,
 * shared token resolution, and canonical serialization independently. It
 * reports observations from the current machine; results are not a stable
 * performance budget or a cross-machine comparison.
 *
 * Run from the repository root with:
 *   apps/website/node_modules/.bin/tsx scripts/tokens/dtcg-runtime-benchmark.ts --write-results
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  buildReferenceGraph,
  parseFormatDocument,
  renderCanonical,
  resolveFormatTokenValue,
  validateResolvedTokenValues,
} from '../../packages/tokens/src/index.ts';
import type {
  DtcgDocument,
  DtcgTokenNode,
  TokenDiagnostic,
} from '../../packages/tokens/src/types.ts';

const REPETITIONS = 3;
const TOKEN_TOTALS = [1_000, 10_000] as const;
const RESULTS_PATH = 'docs/tokens/fixtures/dtcg-runtime-benchmark-2026-09-25.json';

type Sample = {
  elapsedMs: number;
  rssBeforeBytes: number;
  rssAfterBytes: number;
};

type Measurement = {
  medianMs: number;
  samples: Sample[];
};

function syntheticFormatDocument(totalTokens: number): { text: string; tokenCount: number } {
  const foundationCount = Math.floor(totalTokens / 2);
  const aliasCount = totalTokens - foundationCount;
  const foundation: Record<string, unknown> = {};
  const semantic: Record<string, unknown> = {};

  for (let index = 0; index < foundationCount; index += 1) {
    const normalized = index / Math.max(1, foundationCount - 1);
    foundation[`token-${String(index).padStart(5, '0')}`] = {
      $value: {
        colorSpace: 'srgb',
        components: [normalized, ((index * 17) % 101) / 100, ((index * 37) % 101) / 100],
        alpha: 1,
      },
    };
  }

  for (let index = 0; index < aliasCount; index += 1) {
    const targetName = `token-${String(index % foundationCount).padStart(5, '0')}`;
    // Alternate the two whole-token reference forms so graph building and
    // resolution cover both qualified curly aliases and JSON Pointer aliases.
    semantic[`token-${String(index).padStart(5, '0')}`] =
      index % 2 === 0
        ? { $value: `{foundation.color.${targetName}}` }
        : { $ref: `#/foundation/color/${targetName}` };
  }

  const value = {
    foundation: { color: { $type: 'color', ...foundation } },
    semantic: { color: { $type: 'color', ...semantic } },
  };

  return { text: JSON.stringify(value), tokenCount: totalTokens };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure<T>(operation: () => T): { result: T; sample: Sample } {
  const rssBeforeBytes = process.memoryUsage().rss;
  const start = performance.now();
  const result = operation();
  const elapsedMs = performance.now() - start;
  const rssAfterBytes = process.memoryUsage().rss;
  return { result, sample: { elapsedMs, rssBeforeBytes, rssAfterBytes } };
}

function summarize(samples: Sample[]): Measurement {
  return { medianMs: median(samples.map((sample) => sample.elapsedMs)), samples };
}

function errors(diagnostics: readonly TokenDiagnostic[]): TokenDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
}

function resolutionChecksum(
  document: DtcgDocument,
  tokens: readonly DtcgTokenNode[],
): {
  resolvedTokenCount: number;
  resolvedColorCount: number;
  colorComponentChecksum: number;
} {
  let colorComponentChecksum = 0;
  let resolvedColorCount = 0;
  for (const token of tokens) {
    const resolved = resolveFormatTokenValue(document, token);
    if (
      resolved !== null &&
      typeof resolved === 'object' &&
      !Array.isArray(resolved) &&
      Array.isArray((resolved as { components?: unknown }).components)
    ) {
      const color = resolved as { colorSpace?: unknown; components: unknown[] };
      if (color.colorSpace !== 'srgb' || color.components.length !== 3) {
        throw new Error(`Resolved ${token.path.join('.')} to an unexpected color payload`);
      }
      resolvedColorCount += 1;
      for (const component of color.components) {
        if (typeof component === 'number') colorComponentChecksum += component;
      }
    } else {
      throw new Error(`Token ${token.path.join('.')} did not resolve to a color payload`);
    }
  }
  return { resolvedTokenCount: tokens.length, resolvedColorCount, colorComponentChecksum };
}

function runCase(totalTokens: number) {
  const { text, tokenCount } = syntheticFormatDocument(totalTokens);
  const inputBytes = Buffer.byteLength(text, 'utf8');
  const parseSamples: Sample[] = [];
  let document: DtcgDocument | undefined;

  for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
    const measured = measure(() => {
      const parsed = parseFormatDocument(text, {
        sourceFileId: `benchmark-${totalTokens}.tokens`,
        maxTokens: totalTokens + 1,
      });
      const resolvedDiagnostics = validateResolvedTokenValues(parsed);
      return { parsed, diagnostics: [...parsed.diagnostics, ...resolvedDiagnostics] };
    });
    parseSamples.push(measured.sample);
    const parseErrors = errors(measured.result.diagnostics);
    if (parseErrors.length > 0) {
      throw new Error(
        `Parse/validation failed for ${totalTokens} tokens: ${parseErrors
          .slice(0, 3)
          .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
          .join('; ')}`,
      );
    }
    if (Object.keys(measured.result.parsed.tokens).length !== tokenCount) {
      throw new Error(
        `Expected ${tokenCount} tokens, parsed ${Object.keys(measured.result.parsed.tokens).length}`,
      );
    }
    document = measured.result.parsed;
  }

  if (!document) throw new Error('Parser did not produce a document');
  const tokens = Object.values(document.tokens);

  const graphSamples: Sample[] = [];
  let graphSummary: { edgeCount: number; maxChainDepth: number } | undefined;
  for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
    const measured = measure(() => buildReferenceGraph(document));
    graphSamples.push(measured.sample);
    const graphErrors = errors(measured.result.diagnostics);
    if (graphErrors.length > 0) {
      throw new Error(
        `Reference graph failed for ${totalTokens} tokens: ${graphErrors
          .slice(0, 3)
          .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
          .join('; ')}`,
      );
    }
    graphSummary = {
      edgeCount: [...measured.result.outgoing.values()].reduce(
        (sum, edges) => sum + edges.length,
        0,
      ),
      maxChainDepth: measured.result.maxChainDepth,
    };
    if (graphSummary.edgeCount !== tokenCount - Math.floor(tokenCount / 2)) {
      throw new Error(
        `Expected one reference edge per semantic alias, found ${graphSummary.edgeCount}`,
      );
    }
  }

  const resolutionSamples: Sample[] = [];
  let resolutionSummary: ReturnType<typeof resolutionChecksum> | undefined;
  for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
    const measured = measure(() => resolutionChecksum(document, tokens));
    resolutionSamples.push(measured.sample);
    resolutionSummary = measured.result;
    if (
      resolutionSummary.resolvedTokenCount !== tokenCount ||
      resolutionSummary.resolvedColorCount !== tokenCount
    ) {
      throw new Error(
        `Resolved ${resolutionSummary.resolvedColorCount} of ${tokenCount} tokens to color payloads`,
      );
    }
  }

  const canonicalSamples: Sample[] = [];
  let canonicalBytes = 0;
  let canonicalOutput: string | undefined;
  for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
    const measured = measure(() => renderCanonical(document.sourceRoot));
    canonicalSamples.push(measured.sample);
    const currentBytes = Buffer.byteLength(measured.result, 'utf8');
    if (canonicalOutput !== undefined && canonicalOutput !== measured.result) {
      throw new Error('Canonical serialization changed between repetitions');
    }
    canonicalOutput = measured.result;
    canonicalBytes = currentBytes;
  }

  return {
    totalTokens: tokenCount,
    foundationTokens: Math.floor(tokenCount / 2),
    semanticAliases: tokenCount - Math.floor(tokenCount / 2),
    referenceForms: ['qualified-curly-brace', 'json-pointer'],
    inputBytes,
    canonicalOutputBytes: canonicalBytes,
    contextCount: 1,
    formatSnapshot:
      'DTCG Format 2025.10 stable default; one generated snapshot, no context/theme expansion',
    parseValidate: summarize(parseSamples),
    referenceGraph: { ...summarize(graphSamples), ...graphSummary },
    resolveAllTokens: { ...summarize(resolutionSamples), ...resolutionSummary },
    canonicalSerialize: summarize(canonicalSamples),
  };
}

const result = {
  generatedAt: new Date().toISOString(),
  benchmark: 'DTCG Format token parse/graph/resolution/canonical serialization',
  repetitions: REPETITIONS,
  warmupRuns: 0,
  note: 'Shared-machine observations for reproducibility only; not a stable performance budget or an allocation-isolated RSS measurement.',
  environment: {
    node: process.version,
    platform: os.platform(),
    osRelease: os.release(),
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: os.cpus().length,
    availableParallelism: os.availableParallelism?.() ?? os.cpus().length,
    rssUnit:
      'bytes; process-wide before/after each timed sample; other machine activity may affect it',
  },
  cases: TOKEN_TOTALS.map(runCase),
};

const output = `${JSON.stringify(result, null, 2)}\n`;
if (process.argv.includes('--write-results')) {
  const destination = resolve(RESULTS_PATH);
  mkdirSync(resolve('docs/tokens/fixtures'), { recursive: true });
  writeFileSync(destination, output, 'utf8');
}
process.stdout.write(output);
