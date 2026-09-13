/**
 * The picker must not advertise what the pipeline cannot ingest, and a file
 * that belongs to File > Open must say so rather than failing as a bad Figma
 * decode. Both were live drift: `.svgz` was offered but decoded to nothing,
 * and bare `.json` put Varve's own documents in the artwork picker.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { getImportAcceptString } from './registry';
import { ImportService } from './service';

function corpusFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures/import-corpus', name)));
}

describe('import format honesty', () => {
  it('imports a real .svgz, which is gzipped SVG', async () => {
    const svgz = gzipSync(strToU8('<svg><rect width="10" height="10" fill="red"/></svg>'));
    const report = await ImportService.importFiles([
      { name: 'logo.svgz', source: 'file-picker', bytes: svgz },
    ]);
    const file = report.files[0]!;
    expect(file.status).toBe('success');
    expect(file.nodeCount).toBe(1);
  });

  it('keeps SVG and SVGZ as vector imports with their logical format labels', async () => {
    const svg = '<svg><g id="mark"><rect width="12" height="8" /></g></svg>';
    const report = await ImportService.importFiles([
      { name: 'mark.svg', source: 'file-picker', text: svg },
      { name: 'mark.svgz', source: 'file-picker', bytes: gzipSync(strToU8(svg)) },
    ]);

    expect(report.files.map((file) => [file.format, file.status, file.nodeCount])).toEqual([
      ['svg', 'success', 1],
      ['svg', 'success', 1],
    ]);
  });

  it('imports real layered PSD and PSB fixtures as partial editable layer trees', async () => {
    const report = await ImportService.importFiles([
      { name: 'example.psd', source: 'file-picker', bytes: corpusFile('example.psd') },
      { name: 'example.psb', source: 'file-picker', bytes: corpusFile('example.psb') },
    ]);

    expect(report.files.map((file) => file.format)).toEqual(['psd', 'psb']);
    for (const file of report.files) {
      expect(file.status).toBe('partial');
      expect(file.nodeCount).toBeGreaterThan(0);
      expect(file.artifacts[0]?.nodeIds.length).toBe(file.nodeCount);
      expect(file.unsupportedFeatures.map((feature) => feature.feature)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^(PSD|PSB) layer effects/),
          expect.stringMatching(/^(PSD|PSB) smart objects/),
        ]),
      );
    }
  });

  it('normalizes a real TIFF first IFD to an embedded PNG raster', async () => {
    const report = await ImportService.importFiles([
      { name: 'raster.tif', source: 'file-picker', bytes: corpusFile('raster.tif') },
    ]);
    const file = report.files[0]!;
    const artifact = file.artifacts[0]!;
    const node = artifact.document.nodes[artifact.nodeIds[0]!] as {
      shape?: { w: number; h: number };
      fills?: Array<{
        image?: { src: string; assetId?: string; imageWidth?: number; imageHeight?: number };
      }>;
    };
    const image = node.fills?.[0]?.image;

    expect(file).toMatchObject({ format: 'tiff', status: 'partial', nodeCount: 1 });
    expect(file.unsupportedFeatures.map((feature) => feature.feature).join(' ')).toMatch(
      /flattened raster/i,
    );
    expect(node.shape).toEqual({ kind: 'rect', x: 0, y: 0, w: 64, h: 48 });
    expect(image).toMatchObject({
      src: expect.stringMatching(/^data:image\/png;base64,/),
      assetId: expect.any(String),
      imageWidth: 64,
      imageHeight: 48,
    });
  });

  it('routes a PDF-compatible AI wrapper through the AI adapter', async () => {
    const ai = `%PDF-1.4\nBT /F1 12 Tf 100 700 Td (Imported AI) Tj ET\n100 100 200 100 re f\n`;
    const report = await ImportService.importFiles([
      { name: 'sample.ai', source: 'file-picker', bytes: strToU8(ai) },
    ]);
    const file = report.files[0]!;

    expect(file.format).toBe('ai');
    expect(file.status).toBe('partial');
    expect(file.nodeCount).toBeGreaterThan(0);
    expect(file.warnings.map((warning) => warning.message).join(' ')).toMatch(
      /AI file with PDF wrapper/i,
    );
  });

  it('does not offer bare .json, which belongs to File > Open', () => {
    const accept = getImportAcceptString();
    expect(accept.split(',')).not.toContain('.json');
    // Real Figma exports are still reachable by suffix match.
    expect(accept).toContain('.fig.json');
  });

  it('tells the user to use File > Open when a Varve document reaches Import', async () => {
    const doc = JSON.stringify({
      formatVersion: '2.20',
      name: 'Poster',
      nodes: {},
      rootChildren: [],
    });
    const report = await ImportService.importFiles([
      { name: 'poster.json', source: 'file-picker', text: doc },
    ]);
    const file = report.files[0]!;
    expect(file.status).toBe('unsupported');
    expect(file.unsupportedFeatures[0]!.message).toMatch(/File > Open/);
  });
});
