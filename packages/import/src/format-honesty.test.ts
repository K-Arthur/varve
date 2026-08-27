/**
 * The picker must not advertise what the pipeline cannot ingest, and a file
 * that belongs to File > Open must say so rather than failing as a bad Figma
 * decode. Both were live drift: `.svgz` was offered but decoded to nothing,
 * and bare `.json` put Varve's own documents in the artwork picker.
 */
import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { getImportAcceptString } from './registry';
import { ImportService } from './service';

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
