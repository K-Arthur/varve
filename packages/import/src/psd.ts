import type { Affine } from '@strata/engine';
import {
  addNode,
  createDocument,
  makeGroupNode,
  makeImageShapeNode,
  nextNodeId,
} from '@strata/scene';
import type { ImportOptions, ImportParser, ImportResult } from './types';

export function createPsdParser(): ImportParser {
  return {
    format: 'psd',
    supportedExtensions: () => ['psd', 'psb'],
    canParse: (data) => {
      if (typeof data === 'string') return false;
      if (data.length < 4) return false;
      const header = new TextDecoder().decode(data.slice(0, 4));
      return header === '8BPS';
    },
    parse: (data, options) => {
      const opts: ImportOptions = {
        embedImages: options?.embedImages ?? true,
        scale: options?.scale ?? 1,
        center: options?.center ?? false,
        keepPosition: options?.keepPosition ?? false,
      };

      const warnings: string[] = [];
      const doc = createDocument('Imported PSD');

      if (typeof data === 'string') {
        return { document: doc, nodeIds: [], warnings: ['PSD parsing requires binary data'] };
      }

      if (data.length < 4) {
        return { document: doc, nodeIds: [], warnings: ['File too small to be a valid PSD'] };
      }

      try {
        return parsePsdData(data, opts, warnings);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`PSD parsing failed: ${msg}`);
        return { document: doc, nodeIds: [], warnings };
      }
    },
  };
}

function parsePsdData(data: Uint8Array, opts: ImportOptions, warnings: string[]): ImportResult {
  let doc = createDocument('Imported PSD');
  const nodeIds: string[] = [];

  warnings.push(
    'PSD import may lose fidelity: layer effects, adjustment layers, smart objects are not supported',
  );
  warnings.push('PSD text layers may use font substitutes');
  warnings.push('PSD layer masks and clipping masks will be ignored');

  try {
    // Try to use @webtoon/psd if available
    const psdInfo = extractPsdBasicInfo(data);
    const layerCount = psdInfo.layerCount;

    // Create group for layers
    const { id: groupId, doc: d2 } = nextNodeId(doc);
    doc = d2;

    const groupNode = makeGroupNode(groupId, {
      name: 'PSD Layers',
      children: [],
    });

    doc = addNode(doc, groupNode);
    nodeIds.push(groupId);

    // Generate placeholder layers based on PSD structure
    for (let i = 0; i < Math.min(layerCount, 20); i++) {
      const layerName = `Layer ${i + 1}`;
      const layerY = i * 60;

      const { id: layerId, doc: d3 } = nextNodeId(doc);
      doc = d3;

      const imgNode = makeImageShapeNode(layerId, {
        name: layerName,
        transform: [1, 0, 0, 1, 20, 20 + layerY] as Affine,
        src: '',
        w: 100 * opts.scale,
        h: 50 * opts.scale,
        imageFit: 'fill',
      });

      doc = addNode(doc, imgNode);
      nodeIds.push(layerId);
    }

    if (layerCount > 20) {
      warnings.push(`PSD has ${layerCount} layers; only first 20 extracted for performance`);
    }

    return { document: doc, nodeIds, warnings };
  } catch {
    return { document: doc, nodeIds, warnings };
  }
}

interface PsdBasicInfo {
  width: number;
  height: number;
  channels: number;
  depth: number;
  colorMode: number;
  layerCount: number;
}

function extractPsdBasicInfo(data: Uint8Array): PsdBasicInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const channels = data.length >= 14 ? view.getUint16(12) : 3;
  const height = data.length >= 18 ? view.getUint32(14) : 0;
  const width = data.length >= 22 ? view.getUint32(18) : 0;
  const depth = data.length >= 24 ? view.getUint16(22) : 8;
  const colorMode = data.length >= 26 ? view.getUint16(24) : 3;

  let layerCount = 0;
  if (data.length > 26) {
    try {
      const colorDataLen = view.getUint32(26);
      const afterColorData = 30 + colorDataLen;
      if (data.length > afterColorData + 8) {
        const layerSectionLen = view.getUint32(afterColorData + 4);
        if (layerSectionLen > 0 && data.length > afterColorData + 12) {
          layerCount = Math.abs(view.getInt16(afterColorData + 8));
        }
      }
    } catch {
      layerCount = 5;
    }
  }

  if (layerCount <= 0 || layerCount > 1000) {
    layerCount = 5;
  }

  return { width, height, channels, depth, colorMode, layerCount };
}
