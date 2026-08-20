import { readFileSync } from 'node:fs';
import { bench, describe } from 'vitest';
import { createFigmaParser } from './figma';

function fixture(nodeCount: number): string {
  return JSON.stringify({
    document: {
      type: 'DOCUMENT',
      children: [
        {
          id: 'page:benchmark',
          type: 'CANVAS',
          name: 'Benchmark',
          children: Array.from({ length: nodeCount }, (_, index) => ({
            id: `shape:${index}`,
            type: index % 5 === 0 ? 'TEXT' : 'RECTANGLE',
            name: `Node ${index}`,
            characters: index % 5 === 0 ? 'Benchmark text' : undefined,
            style: index % 5 === 0 ? { fontFamily: 'Inter', fontSize: 14 } : undefined,
            absoluteBoundingBox: {
              x: (index % 100) * 12,
              y: Math.floor(index / 100) * 12,
              width: 10,
              height: 10,
            },
          })),
        },
      ],
    },
  });
}

const parser = createFigmaParser();
const fixtures = [100, 1_000, 5_000].map((nodeCount) => [nodeCount, fixture(nodeCount)] as const);
const nativeFixtureUrl = new URL('../test-fixtures/OpenFigs.fig', import.meta.url);
const nativeFixture = new Uint8Array(
  readFileSync(
    nativeFixtureUrl.protocol === 'file:'
      ? nativeFixtureUrl
      : 'packages/import/test-fixtures/OpenFigs.fig',
  ),
);

describe('Figma JSON decode and semantic conversion', () => {
  for (const [nodeCount, data] of fixtures) {
    bench(
      `${nodeCount} nodes`,
      () => {
        parser.parse(data);
      },
      { iterations: 10 },
    );
  }
});

describe('Native Figma .fig decode and semantic conversion', () => {
  bench(
    'OpenFigs.fig',
    () => {
      parser.parse(nativeFixture);
    },
    { iterations: 10 },
  );
});
