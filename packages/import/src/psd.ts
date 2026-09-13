/**
 * PSD parser — converts PSD files into a Varve Document using @webtoon/psd.
 *
 * Extracts layer structure, visibility, opacity, blend modes, and masks.
 * Layer masks and clipping masks are converted to the canonical Varve mask
 * model (clip, alpha, luminance). Vector masks are imported as vector masks
 * when representable.
 *
 * Research basis: Adobe Photoshop File Format Specification (PSB 6.0),
 * @webtoon/psd 0.4.0 API.
 */

import type { Affine } from '@varve/engine';
import type { Document, MaskType, SceneNode } from '@varve/scene';
import {
  addMask,
  addNode,
  createDocument,
  findOrCreateEmbeddedAsset,
  imageFill,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import type { Group as PsdGroup, Layer as PsdLayer } from '@webtoon/psd';
import Psd from '@webtoon/psd';
import UPNG from 'upng-js';
import { bytesToDataUrl } from './bitmap';
import type { ImportOptions, ImportParser, ImportResult } from './types';

const PSD_HEADER_BYTES = 26;
const MAX_PSD_ENCODED_BYTES = 128 * 1024 * 1024;
const MAX_PSD_PIXELS = 64 * 1024 * 1024;
const MAX_PSD_DIMENSION = 300_000;
const MAX_PSD_LAYER_RGBA_BYTES = MAX_PSD_PIXELS * 4;

/**
 * Map PSD blend mode constants to Varve blend modes.
 *
 * `@webtoon/psd` ships `BlendMode` as a type-only declaration — the enum has no
 * runtime value — so the keys are the raw PSD enum string values (see
 * `@webtoon/psd`'s `BlendMode` definition). Several values carry intentional
 * trailing spaces ("mul ", "div ", "hue ", "sat ", "lum "); those must be kept
 * exact or lookups silently miss.
 */
const BLEND_MODE_MAP: Record<string, import('@varve/scene').BlendMode> = {
  pass: 'passThrough',
  norm: 'normal',
  'mul ': 'multiply',
  scrn: 'screen',
  over: 'overlay',
  dark: 'darken',
  lite: 'lighten',
  'div ': 'colorDodge',
  idiv: 'colorBurn',
  hLit: 'hardLight',
  sLit: 'softLight',
  diff: 'difference',
  smud: 'exclusion',
  'hue ': 'hue',
  'sat ': 'saturation',
  colr: 'color',
  'lum ': 'luminosity',
};

/**
 * Access the blendMode from a PSD Layer or Group via its underlying layerFrame.
 * The @webtoon/psd classes keep layerFrame private, so we cast through unknown.
 */
function getPsdBlendMode(node: PsdLayer | PsdGroup): import('@varve/scene').BlendMode | undefined {
  try {
    const frame = (node as unknown as { layerFrame?: { layerProperties?: { blendMode?: string } } })
      .layerFrame;
    const mode = frame?.layerProperties?.blendMode;
    if (mode && mode in BLEND_MODE_MAP) return BLEND_MODE_MAP[mode];
  } catch {
    // Swallow — if the internal shape changes, fall back to undefined (normal)
  }
  return undefined;
}

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
        return {
          document: doc,
          nodeIds: [],
          warnings: ['PSD parsing requires binary data'],
        };
      }

      const header = validatePsdHeader(data);
      if (!header.ok) {
        return {
          document: doc,
          nodeIds: [],
          warnings: [header.message],
        };
      }

      try {
        return parsePsdData(data, opts, warnings);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`${photoshopFormatLabel(data)} parsing failed: ${msg}`);
        return { document: doc, nodeIds: [], warnings };
      }
    },
    parseAsync: async (data, options, signal) => {
      const opts: ImportOptions = {
        embedImages: options?.embedImages ?? true,
        scale: options?.scale ?? 1,
        center: options?.center ?? false,
        keepPosition: options?.keepPosition ?? false,
      };

      const warnings: string[] = [];
      const doc = createDocument('Imported PSD');

      if (typeof data === 'string') {
        return {
          document: doc,
          nodeIds: [],
          warnings: ['PSD parsing requires binary data'],
        };
      }

      const header = validatePsdHeader(data);
      if (!header.ok) {
        return {
          document: doc,
          nodeIds: [],
          warnings: [header.message],
        };
      }

      try {
        return await parsePsdDataAsync(data, opts, warnings, signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        warnings.push(`${photoshopFormatLabel(data)} parsing failed: ${msg}`);
        return { document: doc, nodeIds: [], warnings };
      }
    },
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('PSD import was cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

function parsePsdData(data: Uint8Array, opts: ImportOptions, warnings: string[]): ImportResult {
  let doc = createDocument('Imported PSD');
  const nodeIds: string[] = [];
  const formatLabel = photoshopFormatLabel(data);

  try {
    const buf = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    const psd = Psd.parse(buf);

    if (!psd.children || psd.children.length === 0) {
      warnings.push(`${formatLabel} file contains no layers`);
      return { document: doc, nodeIds, warnings };
    }

    // Walk the tree and convert each child
    for (const child of psd.children) {
      const result = convertPsdNode(child, doc, opts, warnings);
      doc = result.doc;
      nodeIds.push(...result.ids);
    }

    if (psd.width && psd.height) {
      doc = { ...doc, canvasWidth: psd.width, canvasHeight: psd.height };
    }

    warnings.push(
      `${formatLabel} import may lose fidelity: layer effects, adjustment layers, smart objects are not supported`,
    );
    warnings.push(`${formatLabel} text layers may use font substitutes`);

    return { document: doc, nodeIds, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    warnings.push(`${formatLabel} parsing failed: ${msg}`);
    return { document: doc, nodeIds, warnings };
  }
}

/**
 * Import the same bounded Photoshop layer tree while materializing each
 * supported layer's decoded pixels as an embedded PNG. `@webtoon/psd` exposes
 * its channel decoder through `Layer.composite()`, which is asynchronous
 * because the codec may initialize a WASM worker. Keeping this path separate
 * preserves the synchronous structural parser for validation and older
 * embedders while the import service receives artwork that is actually
 * visible.
 */
async function parsePsdDataAsync(
  data: Uint8Array,
  opts: ImportOptions,
  warnings: string[],
  signal?: AbortSignal,
): Promise<ImportResult> {
  let doc = createDocument('Imported PSD');
  const nodeIds: string[] = [];
  const formatLabel = photoshopFormatLabel(data);
  assertNotAborted(signal);

  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const psd = Psd.parse(buf);

  if (!psd.children || psd.children.length === 0) {
    warnings.push(`${formatLabel} file contains no layers`);
    return { document: doc, nodeIds, warnings };
  }

  for (const child of psd.children) {
    assertNotAborted(signal);
    const result = await convertPsdNodeAsync(child, doc, opts, warnings, signal);
    doc = result.doc;
    nodeIds.push(...result.ids);
  }

  if (psd.width && psd.height) {
    doc = { ...doc, canvasWidth: psd.width, canvasHeight: psd.height };
  }

  warnings.push(
    `${formatLabel} import may lose fidelity: adjustment layers, smart objects, and exact text editing are not supported`,
  );
  warnings.push(
    `${formatLabel} layer pixels are imported as embedded PNGs; text layers remain rasterized`,
  );

  return { document: doc, nodeIds, warnings };
}

async function convertPsdNodeAsync(
  node: PsdGroup | PsdLayer,
  doc: Document,
  opts: ImportOptions,
  warnings: string[],
  signal?: AbortSignal,
): Promise<PsdConvertResult> {
  assertNotAborted(signal);
  if (node.type === 'Group') {
    const childIds: string[] = [];
    let nextDoc = doc;
    for (const child of node.children) {
      const result = await convertPsdNodeAsync(child, nextDoc, opts, warnings, signal);
      nextDoc = result.doc;
      childIds.push(...result.ids);
    }
    if (childIds.length === 0) return { doc: nextDoc, ids: [] };

    const { id, doc: allocated } = nextNodeId(nextDoc);
    const groupBlendMode = getPsdBlendMode(node);
    const groupNode = makeGroupNode(id, {
      name: node.name || 'Group',
      children: childIds,
      ...(groupBlendMode ? { blendMode: groupBlendMode } : {}),
    });
    return { doc: addNode(allocated, groupNode), ids: [id] };
  }

  const base = convertPsdLayer(node, doc, opts, warnings);
  const layerId = base.ids[0];
  if (!layerId) return base;
  const sceneNode = base.doc.nodes[layerId];
  if (sceneNode?.kind !== 'shape') return base;

  assertNotAborted(signal);
  try {
    const width = Math.floor(node.width);
    const height = Math.floor(node.height);
    if (
      width < 1 ||
      height < 1 ||
      width > MAX_PSD_DIMENSION ||
      height > MAX_PSD_DIMENSION ||
      width > Math.floor(MAX_PSD_PIXELS / height) ||
      width * height * 4 > MAX_PSD_LAYER_RGBA_BYTES
    ) {
      throw new Error('layer pixel dimensions exceed the bounded raster budget');
    }

    const rgba = await node.composite(false, true);
    assertNotAborted(signal);
    if (rgba.byteLength !== width * height * 4) {
      throw new Error('layer decoder returned an unexpected RGBA length');
    }
    const rgbaBytes = new Uint8Array(rgba.byteLength);
    rgbaBytes.set(rgba);
    const png = new Uint8Array(UPNG.encode([rgbaBytes.buffer], width, height, 0));
    if (png.byteLength > MAX_PSD_ENCODED_BYTES) {
      throw new Error('decoded layer PNG exceeds the encoded import budget');
    }
    const dataUrl = bytesToDataUrl(png, 'image/png');
    const registered = findOrCreateEmbeddedAsset(base.doc, {
      dataUrl,
      mimeType: 'image/png',
      naturalWidth: width,
      naturalHeight: height,
    });
    const fill = imageFill(dataUrl, {
      assetId: registered.assetId,
      fit: 'fill',
      imageWidth: width,
      imageHeight: height,
    });
    const nextNode = {
      ...sceneNode,
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
      fills: [fill],
    };
    return {
      doc: {
        ...registered.document,
        nodes: { ...registered.document.nodes, [layerId]: nextNode },
      },
      ids: base.ids,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    warnings.push(
      `Layer "${node.name || 'Layer'}" pixels could not be decoded; an editable placeholder was retained`,
    );
    return base;
  }
}

function photoshopFormatLabel(data: Uint8Array): 'PSD' | 'PSB' {
  return data[4] === 0 && data[5] === 2 ? 'PSB' : 'PSD';
}

function validatePsdHeader(data: Uint8Array): { ok: true } | { ok: false; message: string } {
  if (data.length < PSD_HEADER_BYTES) {
    return { ok: false, message: 'File too small to be a valid PSD/PSB header' };
  }

  if (data[0] !== 0x38 || data[1] !== 0x42 || data[2] !== 0x50 || data[3] !== 0x53) {
    return { ok: false, message: 'Invalid PSD/PSB signature' };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint16(4, false);
  if (version !== 1 && version !== 2) {
    return { ok: false, message: `Unsupported Photoshop file version: ${version}` };
  }

  const channels = view.getUint16(12, false);
  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  const depth = view.getUint16(22, false);
  const colorMode = view.getUint16(24, false);

  if (data.byteLength > MAX_PSD_ENCODED_BYTES) {
    return {
      ok: false,
      message: `Photoshop source exceeds the ${MAX_PSD_ENCODED_BYTES}-byte import budget`,
    };
  }
  if (channels < 1 || channels > 56) {
    return { ok: false, message: `Invalid Photoshop channel count: ${channels}` };
  }
  if (width < 1 || height < 1) {
    return { ok: false, message: 'Photoshop document dimensions must be positive' };
  }
  if (
    width > MAX_PSD_DIMENSION ||
    height > MAX_PSD_DIMENSION ||
    width > Math.floor(MAX_PSD_PIXELS / height)
  ) {
    return {
      ok: false,
      message: `Photoshop document exceeds the ${MAX_PSD_PIXELS}-pixel import budget`,
    };
  }
  if (depth !== 1 && depth !== 8 && depth !== 16 && depth !== 32) {
    return { ok: false, message: `Unsupported Photoshop bit depth: ${depth}` };
  }
  if (colorMode > 9) {
    return { ok: false, message: `Unsupported Photoshop color mode: ${colorMode}` };
  }

  return { ok: true };
}

interface PsdConvertResult {
  doc: Document;
  ids: string[];
}

function convertPsdNode(
  node: PsdGroup | PsdLayer,
  doc: Document,
  opts: ImportOptions,
  warnings: string[],
): PsdConvertResult {
  if (node.type === 'Group') {
    return convertPsdGroup(node, doc, opts, warnings);
  }
  return convertPsdLayer(node, doc, opts, warnings);
}

function convertPsdGroup(
  group: PsdGroup,
  doc: Document,
  opts: ImportOptions,
  warnings: string[],
): PsdConvertResult {
  const childIds: string[] = [];
  let d = doc;

  for (const child of group.children) {
    const result = convertPsdNode(child, d, opts, warnings);
    d = result.doc;
    childIds.push(...result.ids);
  }

  if (childIds.length === 0) {
    return { doc: d, ids: [] };
  }

  const { id, doc: d2 } = nextNodeId(d);
  d = d2;

  const groupBlendMode = getPsdBlendMode(group);
  const groupNode = makeGroupNode(id, {
    name: group.name || 'Group',
    children: childIds,
    ...(groupBlendMode ? { blendMode: groupBlendMode } : {}),
  });

  d = addNode(d, groupNode);
  return { doc: d, ids: [id] };
}

function convertPsdLayer(
  layer: PsdLayer,
  doc: Document,
  opts: ImportOptions,
  warnings: string[],
): PsdConvertResult {
  const { id, doc: d2 } = nextNodeId(doc);
  let d = d2;

  const w = layer.width * opts.scale;
  const h = layer.height * opts.scale;
  const x = layer.left * opts.scale;
  const y = layer.top * opts.scale;

  const shape: import('@varve/engine').Shape = {
    kind: 'rect',
    x: 0,
    y: 0,
    w: w || 100,
    h: h || 100,
  };

  const blendMode = getPsdBlendMode(layer);
  const layerNode = makeShapeNode(id, shape, {
    name: layer.name || 'Layer',
    transform: [1, 0, 0, 1, x, y] as Affine,
    opacity: layer.composedOpacity ?? layer.opacity / 255,
    visible: !layer.isHidden,
    ...(blendMode ? { blendMode } : {}),
  });

  d = addNode(d, layerNode);

  // Check for mask data and apply it
  if (layer.maskData) {
    const result = applyPsdMask(layer, id, d, opts, warnings);
    d = result;
  }

  return { doc: d, ids: [id] };
}

function applyPsdMask(
  layer: PsdLayer,
  nodeId: string,
  doc: Document,
  opts: ImportOptions,
  warnings: string[],
): Document {
  const md = layer.maskData;
  if (!md) return doc;

  // Check if mask is disabled
  if (md.flags?.layerMaskDisabled) {
    warnings.push(`Layer "${layer.name}" has a disabled mask — imported but not active`);
  }

  // Determine mask bounds
  const mw = (md.right - md.left) * opts.scale || 100;
  const mh = (md.bottom - md.top) * opts.scale || 100;
  const mx = md.left * opts.scale;
  const my = md.top * opts.scale;

  // Determine mask type
  const maskType: MaskType = 'alpha';

  // Build mask source node (a rect representing the mask bounds)
  const { id: maskNodeId, doc: d2 } = nextNodeId(doc);
  let d = d2;

  const maskShape: import('@varve/engine').Shape = {
    kind: 'rect',
    x: 0,
    y: 0,
    w: mw,
    h: mh,
  };

  const maskNode = makeShapeNode(maskNodeId, maskShape, {
    name: `${layer.name} Mask`,
    transform: [1, 0, 0, 1, mx, my] as Affine,
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
  });

  d = addNode(d, maskNode);

  // Wrap the layer + mask source in a group container for the mask
  const { id: containerId, doc: d3 } = nextNodeId(d);
  d = d3;

  const containerNode = makeFrameNode(containerId, {
    name: layer.name || 'Layer',
    children: [maskNodeId, nodeId],
    w: mw || 100,
    h: mh || 100,
  });

  d = { ...d, nodes: { ...d.nodes, [containerId]: containerNode as SceneNode } };
  d = {
    ...d,
    rootChildren: [
      ...d.rootChildren.filter((nid) => nid !== nodeId && nid !== maskNodeId),
      containerId,
    ],
  };

  // Apply the mask
  const isInverted = md.flags?.invertMaskWhenBlending ?? false;
  const feather = md.flags?.masksHaveParametersApplied ? undefined : 0;
  const density = md.flags?.masksHaveParametersApplied ? undefined : 1;

  d = addMask(d, containerId, maskNodeId, maskType, {
    inverted: isInverted || undefined,
    feather: feather !== undefined ? feather : undefined,
    density: density !== undefined ? density : undefined,
    hideMaskSource: true,
  });

  // Add vector mask warning
  warnings.push(
    `Layer "${layer.name}" has a mask ${isInverted ? '(inverted) ' : ''}` +
      `${md.flags?.layerMaskDisabled ? '(disabled) ' : ''}` +
      `— imported as ${maskType} mask`,
  );

  return d;
}

// ─── Parser registration ───────────────────────────────────────────────────

import { registerParser } from './registry';

registerParser(createPsdParser());
