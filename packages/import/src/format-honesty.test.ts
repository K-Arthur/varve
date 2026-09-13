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
import { inspectImageSource } from './image';
import { importFile } from './import';
import { getImportAcceptString } from './registry';
import { ImportService } from './service';

function corpusFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures/import-corpus', name)));
}

function photoshopHeader(version: 1 | 2, width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set(new TextEncoder().encode('8BPS'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, version, false);
  view.setUint16(12, 4, false);
  view.setUint32(14, height, false);
  view.setUint32(18, width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return bytes;
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
      ['svgz', 'success', 1],
    ]);
  });

  it('reports malformed SVGZ as a bounded parse failure with its source label', async () => {
    const report = await ImportService.importFiles([
      { name: 'broken.svgz', source: 'file-picker', bytes: new Uint8Array([0x1f, 0x8b, 0x08]) },
    ]);
    const file = report.files[0]!;

    expect(file).toMatchObject({ format: 'svgz', status: 'failed', nodeCount: 0 });
    expect(file.error).toBeUndefined();
    expect(file.warnings.map((warning) => warning.message).join(' ')).toMatch(
      /no <svg> element found/i,
    );
    expect(file.unsupportedFeatures).toEqual([]);
  });

  it('reports truncated PSD and PSB headers as failed, not partial imports', async () => {
    const report = await ImportService.importFiles([
      {
        name: 'broken.psd',
        source: 'file-picker',
        bytes: new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]),
      },
      {
        name: 'broken.psb',
        source: 'file-picker',
        bytes: new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x02]),
      },
    ]);

    expect(report.files.map((file) => [file.format, file.status, file.nodeCount])).toEqual([
      ['psd', 'failed', 0],
      ['psb', 'failed', 0],
    ]);
    expect(report.files.every((file) => file.artifacts[0]?.nodeIds.length === 0)).toBe(true);
    expect(report.files.map((file) => file.warnings[0]?.message)).toEqual([
      'File too small to be a valid PSD/PSB header',
      'File too small to be a valid PSD/PSB header',
    ]);
  });

  it('rejects a PSD extension with a foreign signature before decoding', async () => {
    const bytes = photoshopHeader(1, 32, 32);
    bytes.set(new TextEncoder().encode('ABCD'), 0);
    const report = await ImportService.importFiles([
      { name: 'renamed.psd', source: 'file-picker', bytes },
    ]);
    const file = report.files[0]!;

    expect(file).toMatchObject({ format: 'psd', status: 'failed', nodeCount: 0 });
    expect(file.warnings.map((warning) => warning.message).join(' ')).toMatch(
      /invalid PSD\/PSB signature/i,
    );
  });

  it('does not fabricate an AI layer from a header-only PDF wrapper', async () => {
    const report = await ImportService.importFiles([
      {
        name: 'broken.ai',
        source: 'file-picker',
        bytes: new TextEncoder().encode('%PDF-1.7'),
      },
    ]);
    const file = report.files[0]!;

    expect(file).toMatchObject({ format: 'ai', status: 'failed', nodeCount: 0 });
    expect(file.artifacts[0]?.nodeIds).toEqual([]);
    expect(file.warnings.map((warning) => warning.message).join(' ')).toMatch(
      /no supported Illustrator content/i,
    );
  });

  it('rejects Photoshop dimensions before the parser can allocate a pixel grid', async () => {
    const report = await ImportService.importFiles([
      {
        name: 'oversized.psd',
        source: 'file-picker',
        bytes: photoshopHeader(1, 100_000, 100_000),
      },
    ]);
    const file = report.files[0]!;

    expect(file).toMatchObject({ format: 'psd', status: 'failed', nodeCount: 0 });
    expect(file.warnings.map((warning) => warning.message).join(' ')).toMatch(
      /pixel import budget/i,
    );
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
      const imageLayers = Object.values(file.artifacts[0]?.document.nodes ?? {}).filter(
        (node) =>
          node.kind === 'shape' &&
          node.fills?.some((fill) => fill.type === 'image' && Boolean(fill.image?.assetId)),
      );
      expect(imageLayers.length).toBeGreaterThan(0);
      expect(file.warnings.map((warning) => warning.message).join(' ')).toMatch(
        /layer pixels are imported as embedded PNGs/i,
      );
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

  it('keeps TIFF source colour provenance while storing the normalized PNG', () => {
    const bytes = corpusFile('raster.tif');
    const inspected = inspectImageSource(bytes);
    expect(inspected).toMatchObject({
      mimeType: 'image/png',
      sourceMimeType: 'image/tiff',
      storedWidth: 64,
      storedHeight: 48,
      metadata: {
        encoding: {
          model: 'rgb',
          bitDepth: 16,
          provenance: 'format-default',
        },
      },
    });

    const result = importFile('raster.tif', bytes);
    const node = result.document.nodes[result.nodeIds[0]!]!;
    const assetId = node.fills?.[0]?.image?.assetId;
    const asset = assetId ? result.document.assets?.[assetId] : undefined;
    expect(asset).toMatchObject({
      mimeType: 'image/png',
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      metadata: {
        colorEncoding: expect.objectContaining({ provenance: 'format-default' }),
      },
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

  it('routes a legacy PostScript AI wrapper through the EPS subset with provenance', async () => {
    const ai =
      '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 300 200\n' + '20 30 120 80 rectfill\nshowpage\n';
    const report = await ImportService.importFiles([
      { name: 'legacy.ai', source: 'file-picker', bytes: strToU8(ai) },
    ]);
    const file = report.files[0]!;

    expect(file).toMatchObject({ format: 'ai', status: 'partial' });
    expect(file.nodeCount).toBeGreaterThan(0);
    expect(file.warnings.map((warning) => warning.message).join(' ')).toMatch(
      /AI file with EPS wrapper/i,
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
