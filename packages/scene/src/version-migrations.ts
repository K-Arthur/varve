// COMPLEXITY: 178 — extracted from version.ts (was 212). 19 migration functions
// plus normalizeLegacyBackgroundRemoval, rehydrateEmbeddedAssetSrc, and helpers.
// No single function exceeds the 50-statement ceiling.
import { createEmbeddedAsset, mimeTypeFromDataUrl } from './assets';

function migrateRawToPages(raw: Record<string, unknown>): Record<string, unknown> {
  const rootChildren = (raw.rootChildren as string[]) ?? [];
  const nodes = (raw.nodes as Record<string, unknown>) ?? {};
  const nextId = (raw.nextId as number) ?? 1;
  const dpi = (raw.dpi as number) ?? 0;
  const isPrint = dpi > 0;
  const pageWidth = isPrint ? ((raw.physicalWidth as number) ?? 210) : 1920;
  const pageHeight = isPrint ? ((raw.physicalHeight as number) ?? 297) : 1080;
  const contentRootId = `n${nextId}`;
  const contentRoot: Record<string, unknown> = {
    id: contentRootId,
    kind: 'group',
    name: 'Page 1 content',
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: [0, 0, 0, 0],
    children: [...rootChildren],
  };
  const pageId = `p-${nextId}`;
  const page: Record<string, unknown> = {
    id: pageId,
    name: 'Page 1',
    width: pageWidth,
    height: pageHeight,
    backgrounds: [],
    contentRoot: contentRootId,
  };
  if (raw.bleed) page.bleed = raw.bleed;
  if (raw.safeArea) page.safeArea = raw.safeArea;
  if (raw.slug) page.slug = raw.slug;
  return {
    ...raw,
    pages: [page],
    rootChildren: [contentRootId],
    nodes: { ...nodes, [contentRootId]: contentRoot },
    nextId: nextId + 1,
  };
}

export function migrateV09ToV10(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    formatVersion: '1.0',
    canvasWidth: raw.canvasWidth ?? 1440,
    canvasHeight: raw.canvasHeight ?? 1024,
  };
}

export function migrateV10ToV11(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    formatVersion: '1.1',
    colorConfig: raw.colorConfig ?? undefined,
    documentUnit: raw.documentUnit ?? 'px',
    physicalWidth: raw.physicalWidth ?? undefined,
    physicalHeight: raw.physicalHeight ?? undefined,
    dpi: raw.dpi ?? 0,
    bleed: raw.bleed ?? undefined,
    safeArea: raw.safeArea ?? undefined,
    slug: raw.slug ?? undefined,
    swatches: raw.swatches ?? undefined,
    spotColors: raw.spotColors ?? undefined,
  };
}

export function migrateV11ToV12(raw: Record<string, unknown>): Record<string, unknown> {
  let result: Record<string, unknown> = {
    ...raw,
    formatVersion: '1.2',
    timelines: raw.timelines ?? undefined,
    activeTimelineId: raw.activeTimelineId ?? undefined,
  };
  if (!result.pages) {
    result = migrateRawToPages(result);
  }
  return result;
}

export function migrateV12ToV13(raw: Record<string, unknown>): Record<string, unknown> {
  const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
  const rootChildren = (raw.rootChildren as string[]) ?? [];
  const rootSet = new Set(rootChildren);
  const parentMap = new Map<string | null, string[]>();
  for (const [nid, node] of Object.entries(nodes)) {
    const children = (node.children as string[]) ?? [];
    if (children.length > 0) {
      for (const cid of children) {
        const existing = parentMap.get(cid) ?? [];
        existing.push(nid);
        parentMap.set(cid, existing);
      }
    }
  }
  const updatedNodes: Record<string, Record<string, unknown>> = {};
  for (const [nid, node] of Object.entries(nodes)) {
    if (rootSet.has(nid)) {
      updatedNodes[nid] = { ...node, parentId: null };
    } else {
      const parents = parentMap.get(nid);
      const parentId = parents && parents.length > 0 ? parents[0] : null;
      updatedNodes[nid] = { ...node, parentId };
    }
  }
  return {
    ...raw,
    nodes: updatedNodes,
    formatVersion: '1.3',
  };
}

export function migrateV13ToV14(raw: Record<string, unknown>): Record<string, unknown> {
  const pages = (raw.pages as Record<string, unknown>[]) ?? [];
  const activePageId =
    pages.length > 0
      ? ((pages[0] as Record<string, unknown> | undefined)?.id as string)
      : undefined;
  return {
    ...raw,
    formatVersion: '1.4',
    activePageId,
    globalChildren: [],
  };
}

export function migrateV14ToV15(raw: Record<string, unknown>): Record<string, unknown> {
  const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
  const migrated: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (node.kind === 'image') {
      const w = (node.w as number) ?? 100;
      const h = (node.h as number) ?? 100;
      const src = (node.src as string) ?? '';
      const fit = (node.imageFit as string) ?? 'fill';
      const { src: _, w: _w, h: _h, imageFit: _if, ...rest } = node;
      migrated[id] = {
        ...rest,
        kind: 'shape',
        shape: { kind: 'rect', x: 0, y: 0, w, h },
        fills: [
          {
            type: 'image',
            image: { src, fit, x: 0, y: 0, scale: 1 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
      };
    } else {
      migrated[id] = node;
    }
  }
  return { ...raw, formatVersion: '1.5', nodes: migrated };
}

export function migrateV15ToV16(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    formatVersion: '1.6',
    interactions: raw.interactions ?? undefined,
  };
}

export function migrateV16ToV17(raw: Record<string, unknown>): Record<string, unknown> {
  const activePageId =
    (raw.activePageId as string | undefined) ??
    (raw.pages as { id: string }[] | undefined)?.[0]?.id;
  const guides = (raw.guides as { pageId?: string }[] | undefined) ?? [];
  return {
    ...raw,
    formatVersion: '1.7',
    guides: guides.map((g) => ({
      ...g,
      pageId: g.pageId ?? activePageId,
    })),
  };
}

export function migrateV17ToV18(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    formatVersion: '1.8',
    paints: raw.paints ?? undefined,
  };
}

export function migrateV18ToV19(raw: Record<string, unknown>): Record<string, unknown> {
  const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
  const migrated: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes)) {
    const mask = node.mask as Record<string, unknown> | undefined;
    if (mask && typeof mask === 'object') {
      if (mask.type === 'clip' && !mask.fillRule) {
        mask.fillRule = 'nonzero';
      }
      if (mask.vectorMask && typeof mask.vectorMask === 'object') {
        const vm = mask.vectorMask as Record<string, unknown>;
        if (!vm.fillRule) {
          vm.fillRule = 'nonzero';
        }
      }
      migrated[id] = { ...node, mask };
    } else {
      migrated[id] = node;
    }
  }
  return {
    ...raw,
    formatVersion: '1.9',
    nodes: migrated,
  };
}

export function migrateV19ToV110(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    formatVersion: '1.10',
    brushPresets: raw.brushPresets ?? undefined,
  };
}

export function migrateV110ToV20(raw: Record<string, unknown>): Record<string, unknown> {
  const pages = (raw.pages as Record<string, unknown>[] | undefined) ?? [];
  const migratedPages = pages.map((page, i) => {
    if (!page.order) {
      const order = `a${i.toString(36).padStart(4, '0')}`;
      return { ...page, order };
    }
    return page;
  });
  let activePageId = raw.activePageId as string | undefined;
  if (!activePageId && migratedPages.length > 0) {
    activePageId = (migratedPages[0] as Record<string, unknown>).id as string;
  }
  return {
    ...raw,
    formatVersion: '2.0',
    pages: migratedPages,
    activePageId: activePageId ?? undefined,
    masters: raw.masters ?? undefined,
    spreads: raw.spreads ?? undefined,
    sections: raw.sections ?? undefined,
    facingPages: raw.facingPages ?? undefined,
  };
}

export function migrateV20ToV21(raw: Record<string, unknown>): Record<string, unknown> {
  return normalizeLegacyBackgroundRemoval({ ...raw, formatVersion: '2.1' });
}

function normalizeV21RasterMaskIdentity(raw: Record<string, unknown>): Record<string, unknown> {
  const rawNodes = (raw.nodes as Record<string, Record<string, unknown>> | undefined) ?? {};
  const nodes: Record<string, Record<string, unknown>> = {};
  for (const [nodeId, node] of Object.entries(rawNodes)) {
    const mask = node.mask as Record<string, unknown> | undefined;
    const rasterMask = mask?.rasterMask as Record<string, unknown> | undefined;
    if (!mask || !rasterMask || rasterMask.sourceIdentity) {
      nodes[nodeId] = node;
      continue;
    }
    const fingerprint =
      typeof rasterMask.sourceFingerprint === 'string' ? rasterMask.sourceFingerprint : nodeId;
    const checksumMatch = /^sha256:([a-f0-9]{64})$/.exec(fingerprint);
    const locator = fingerprint.replace(/^(?:source|legacy):/, '');
    const revision =
      Number.isInteger(rasterMask.sourcePixelRevision) &&
      (rasterMask.sourcePixelRevision as number) >= 0
        ? (rasterMask.sourcePixelRevision as number)
        : 1;
    const { sourceFingerprint: _fingerprint, sourcePixelRevision: _revision, ...rest } = rasterMask;
    nodes[nodeId] = {
      ...node,
      mask: {
        ...mask,
        rasterMask: {
          ...rest,
          sourceIdentity: checksumMatch
            ? { kind: 'content-sha256', sha256: checksumMatch[1], revision }
            : { kind: 'source-metadata', locator, revision },
        },
      },
    };
  }
  return { ...raw, nodes };
}

export function migrateV21ToV22(raw: Record<string, unknown>): Record<string, unknown> {
  return normalizeV21RasterMaskIdentity({ ...raw, formatVersion: '2.2' });
}

export function migrateV22ToV23(raw: Record<string, unknown>): Record<string, unknown> {
  const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
  const rootChildren = Array.isArray(raw.rootChildren)
    ? raw.rootChildren.filter((id): id is string => typeof id === 'string')
    : [];
  const siblingBelow = (adjustmentId: string): string | undefined => {
    let siblings = rootChildren;
    for (const node of Object.values(nodes)) {
      if (Array.isArray(node.children) && node.children.includes(adjustmentId)) {
        siblings = node.children.filter((id): id is string => typeof id === 'string');
        break;
      }
    }
    const index = siblings.indexOf(adjustmentId);
    if (index <= 0) return undefined;
    const targetId = siblings[index - 1];
    const target = targetId ? nodes[targetId] : undefined;
    return target && target.kind !== 'adjustment' ? targetId : undefined;
  };
  const migrated: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (node.kind === 'adjustment') {
      const clipping = node.clipping === true;
      const adjustments = node.adjustments as unknown[] | undefined;
      const hasActiveAdjustments =
        Array.isArray(adjustments) &&
        adjustments.some(
          (a) =>
            typeof a === 'object' && a !== null && (a as Record<string, unknown>).visible !== false,
        );
      let scope: Record<string, unknown> | undefined;
      if (clipping) {
        const targetNodeId = siblingBelow(id);
        if (targetNodeId) scope = { mode: 'image-local', targetNodeId };
      } else if (hasActiveAdjustments) {
        scope = { mode: 'document' };
      }
      migrated[id] = scope ? { ...node, scope } : node;
    } else {
      migrated[id] = node;
    }
  }
  return {
    ...raw,
    formatVersion: '2.3',
    nodes: migrated,
  };
}

export function migrateV23ToV24(raw: Record<string, unknown>): Record<string, unknown> {
  const config = raw.colorConfig as Record<string, unknown> | undefined;
  if (config && typeof config === 'object') {
    return {
      ...raw,
      formatVersion: '2.4',
      colorConfig: {
        bitDepth: 'uint8',
        workingSpace: 'srgb',
        ...config,
      },
    };
  }
  return { ...raw, formatVersion: '2.4' };
}

export function migrateV24ToV25(raw: Record<string, unknown>): Record<string, unknown> {
  const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
  const migratedNodes: Record<string, Record<string, unknown>> = {};
  let bakedCount = 0;
  for (const [id, node] of Object.entries(nodes)) {
    const rotation = (node.rotation as number) ?? 0;
    const transform = node.transform as number[] | undefined;
    if (rotation !== 0 && transform && Array.isArray(transform) && transform.length === 6) {
      const radians = (rotation * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const a = transform[0] ?? 1;
      const b = transform[1] ?? 0;
      const c = transform[2] ?? 0;
      const d = transform[3] ?? 1;
      const e = transform[4] ?? 0;
      const f = transform[5] ?? 0;
      const baked = [
        a * cos + c * sin,
        b * cos + d * sin,
        -a * sin + c * cos,
        -b * sin + d * cos,
        e,
        f,
      ];
      migratedNodes[id] = { ...node, transform: baked, rotation: 0 };
      bakedCount++;
    } else {
      migratedNodes[id] = node;
    }
  }
  const errors: string[] = [];
  for (const [id, node] of Object.entries(migratedNodes)) {
    const t = node.transform as number[] | undefined;
    if (t && Array.isArray(t)) {
      for (let i = 0; i < Math.min(t.length, 6); i++) {
        if (typeof t[i] !== 'number' || !Number.isFinite(t[i])) {
          errors.push(`Node ${id}: transform[${i}] is non-finite`);
          migratedNodes[id] = { ...node, transform: [1, 0, 0, 1, 0, 0], rotation: 0 };
        }
      }
    }
  }
  return {
    ...raw,
    nodes: migratedNodes,
    formatVersion: '2.5',
    ...(errors.length > 0 ? { _migrationWarnings: errors } : {}),
    ...(bakedCount > 0 ? { _rotationBakedCount: bakedCount } : {}),
  };
}

export function migrateV25ToV26(raw: Record<string, unknown>): Record<string, unknown> {
  const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
  const assets: Record<string, Record<string, unknown>> = {
    ...((raw.assets as Record<string, Record<string, unknown>> | undefined) ?? {}),
  };
  const extractFromFill = (fillValue: unknown): unknown => {
    if (!fillValue || typeof fillValue !== 'object') return fillValue;
    const fill = fillValue as Record<string, unknown>;
    if (fill.type !== 'image' || !fill.image || typeof fill.image !== 'object') return fill;
    const image = fill.image as Record<string, unknown>;
    const src = image.src;
    if (image.assetId || typeof src !== 'string' || !src.startsWith('data:')) return fill;
    const asset = createEmbeddedAsset({
      dataUrl: src,
      mimeType: mimeTypeFromDataUrl(src),
      naturalWidth: typeof image.imageWidth === 'number' ? image.imageWidth : 0,
      naturalHeight: typeof image.imageHeight === 'number' ? image.imageHeight : 0,
    });
    assets[asset.id] ??= asset as unknown as Record<string, unknown>;
    return { ...fill, image: { ...image, assetId: asset.id } };
  };
  const migratedNodes: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes)) {
    migratedNodes[id] = Array.isArray(node.fills)
      ? { ...node, fills: node.fills.map(extractFromFill) }
      : node;
  }
  const rawPaints = raw.paints as Record<string, Record<string, unknown>> | undefined;
  const migratedPaints = rawPaints
    ? Object.fromEntries(
        Object.entries(rawPaints).map(([paintId, paint]) => [
          paintId,
          { ...paint, fill: extractFromFill(paint.fill) },
        ]),
      )
    : undefined;
  return {
    ...raw,
    nodes: migratedNodes,
    ...(migratedPaints ? { paints: migratedPaints } : {}),
    assets: Object.keys(assets).length > 0 ? assets : undefined,
    formatVersion: '2.6',
  };
}

export function migrateV26ToV27(raw: Record<string, unknown>): Record<string, unknown> {
  const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
  const normalizeFill = (fillValue: unknown): unknown => {
    if (!fillValue || typeof fillValue !== 'object') return fillValue;
    const fill = fillValue as Record<string, unknown>;
    if (fill.type !== 'image' || !fill.image || typeof fill.image !== 'object') return fill;
    const image = fill.image as Record<string, unknown>;
    let changed = false;
    if (image.crop !== undefined) {
      const crop = image.crop as Record<string, unknown>;
      if (
        !crop ||
        typeof crop !== 'object' ||
        !Number.isFinite(crop.x) ||
        !Number.isFinite(crop.y) ||
        !Number.isFinite(crop.w) ||
        !Number.isFinite(crop.h) ||
        (crop.w as number) <= 0 ||
        (crop.h as number) <= 0
      ) {
        delete image.crop;
        changed = true;
      } else {
        const sw = Math.max(1, (image.imageWidth as number) ?? (crop.w as number));
        const sh = Math.max(1, (image.imageHeight as number) ?? (crop.h as number));
        const cx = Math.max(0, Math.min(crop.x as number, sw - 1));
        const cy = Math.max(0, Math.min(crop.y as number, sh - 1));
        const cw = Math.max(1, Math.min(crop.w as number, sw - cx));
        const ch = Math.max(1, Math.min(crop.h as number, sh - cy));
        const isFull = cx <= 0 && cy <= 0 && cw >= sw && ch >= sh;
        if (isFull) {
          delete image.crop;
          changed = true;
        } else if (cx !== crop.x || cy !== crop.y || cw !== crop.w || ch !== crop.h) {
          image.crop = { x: cx, y: cy, w: cw, h: ch };
          changed = true;
        }
      }
    }
    if (image.rotation !== undefined) {
      const rot = image.rotation as number;
      if (!Number.isFinite(rot)) {
        delete image.rotation;
        changed = true;
      } else {
        const normalized = ((rot % 360) + 360) % 360;
        if (Math.abs(normalized) < 1e-6) {
          delete image.rotation;
          changed = true;
        } else if (normalized !== rot) {
          image.rotation = normalized;
          changed = true;
        }
      }
    }
    if (image.flipH !== undefined && typeof image.flipH !== 'boolean') {
      image.flipH = Boolean(image.flipH);
      changed = true;
    }
    if (image.flipV !== undefined && typeof image.flipV !== 'boolean') {
      image.flipV = Boolean(image.flipV);
      changed = true;
    }
    return changed ? { ...fill, image: { ...image } } : fill;
  };
  const migratedNodes: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (Array.isArray(node.fills)) {
      migratedNodes[id] = { ...node, fills: node.fills.map(normalizeFill) };
    } else {
      migratedNodes[id] = node;
    }
  }
  return {
    ...raw,
    nodes: migratedNodes,
    formatVersion: '2.7',
  };
}

function decodedBase64Length(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (!payload) return 0;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function legacyPngDimensions(dataUrl: string): { width: number; height: number } | null {
  if (!dataUrl.startsWith('data:image/png;base64,')) return null;
  try {
    const header = atob(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 33));
    if (header.length < 24 || header.slice(1, 4) !== 'PNG' || header.slice(12, 16) !== 'IHDR') {
      return null;
    }
    const readU32 = (offset: number) =>
      header.charCodeAt(offset) * 0x1000000 +
      header.charCodeAt(offset + 1) * 0x10000 +
      header.charCodeAt(offset + 2) * 0x100 +
      header.charCodeAt(offset + 3);
    return { width: readU32(16), height: readU32(20) };
  } catch {
    return null;
  }
}

function legacyImageMetadata(node: Record<string, unknown>): {
  src: string;
  width: number;
  height: number;
} {
  const fills = Array.isArray(node.fills) ? (node.fills as Record<string, unknown>[]) : [];
  const imageFill = fills.find((fill) => fill.type === 'image');
  const image = imageFill?.image as Record<string, unknown> | undefined;
  const shape = node.shape as Record<string, unknown> | undefined;
  return {
    src: typeof image?.src === 'string' ? image.src : String(node.id ?? ''),
    width: Number(image?.imageWidth ?? shape?.w ?? 1),
    height: Number(image?.imageHeight ?? shape?.h ?? 1),
  };
}

function sameLegacyRasterAsset(
  existing: Record<string, unknown>,
  candidate: Record<string, unknown>,
): boolean {
  return (
    existing.mimeType === candidate.mimeType &&
    existing.dataUrl === candidate.dataUrl &&
    existing.width === candidate.width &&
    existing.height === candidate.height &&
    existing.byteLength === candidate.byteLength &&
    existing.checksum === candidate.checksum
  );
}

function collisionSafeLegacyAssetId(
  baseId: string,
  candidate: Record<string, unknown>,
  assets: Record<string, Record<string, unknown>>,
): string {
  for (let suffix = 0; ; suffix += 1) {
    const id = suffix === 0 ? baseId : `${baseId}:${suffix}`;
    const existing = assets[id];
    if (!existing || sameLegacyRasterAsset(existing, candidate)) return id;
  }
}

export function rehydrateEmbeddedAssetSrc(raw: Record<string, unknown>): Record<string, unknown> {
  const assets = raw.assets as Record<string, Record<string, unknown>> | undefined;
  if (!assets) return raw;
  const rehydrateFill = (fillValue: unknown): unknown => {
    if (!fillValue || typeof fillValue !== 'object') return fillValue;
    const fill = fillValue as Record<string, unknown>;
    if (fill.type !== 'image' || !fill.image || typeof fill.image !== 'object') return fill;
    const image = fill.image as Record<string, unknown>;
    const assetId = image.assetId;
    if (typeof assetId !== 'string') return fill;
    const asset = assets[assetId];
    if (!asset || typeof asset.dataUrl !== 'string' || image.src === asset.dataUrl) return fill;
    return { ...fill, image: { ...image, src: asset.dataUrl } };
  };
  const nodes = raw.nodes as Record<string, Record<string, unknown>> | undefined;
  let nodesChanged = false;
  const rehydratedNodes: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes ?? {})) {
    const originalFills = node.fills;
    if (!Array.isArray(originalFills)) {
      rehydratedNodes[id] = node;
      continue;
    }
    const fills = originalFills.map(rehydrateFill);
    if (fills.some((f, i) => f !== originalFills[i])) {
      rehydratedNodes[id] = { ...node, fills };
      nodesChanged = true;
    } else {
      rehydratedNodes[id] = node;
    }
  }
  const paints = raw.paints as Record<string, Record<string, unknown>> | undefined;
  let paintsChanged = false;
  let rehydratedPaints: Record<string, Record<string, unknown>> | undefined;
  if (paints) {
    rehydratedPaints = {};
    for (const [id, paint] of Object.entries(paints)) {
      const fill = rehydrateFill(paint.fill);
      if (fill !== paint.fill) {
        rehydratedPaints[id] = { ...paint, fill };
        paintsChanged = true;
      } else {
        rehydratedPaints[id] = paint;
      }
    }
  }
  if (!nodesChanged && !paintsChanged) return raw;
  return {
    ...raw,
    ...(nodesChanged ? { nodes: rehydratedNodes } : {}),
    ...(paintsChanged ? { paints: rehydratedPaints } : {}),
  };
}

export function stripEmbeddedAssetPayloads(raw: Record<string, unknown>): Record<string, unknown> {
  const assets = raw.assets as Record<string, Record<string, unknown>> | undefined;
  if (!assets) return raw;
  const stripFill = (fillValue: unknown): unknown => {
    if (!fillValue || typeof fillValue !== 'object') return fillValue;
    const fill = fillValue as Record<string, unknown>;
    if (fill.type !== 'image' || !fill.image || typeof fill.image !== 'object') return fill;
    const image = fill.image as Record<string, unknown>;
    const assetId = image.assetId;
    if (typeof assetId !== 'string') return fill;
    const asset = assets[assetId];
    if (!asset || image.src !== asset.dataUrl) return fill;
    const { src: _src, ...rest } = image;
    return { ...fill, image: rest };
  };
  const nodes = raw.nodes as Record<string, Record<string, unknown>> | undefined;
  const strippedNodes: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes ?? {})) {
    strippedNodes[id] = Array.isArray(node.fills)
      ? { ...node, fills: node.fills.map(stripFill) }
      : node;
  }
  const paints = raw.paints as Record<string, Record<string, unknown>> | undefined;
  const strippedPaints = paints
    ? Object.fromEntries(
        Object.entries(paints).map(([id, paint]) => [
          id,
          { ...paint, fill: stripFill(paint.fill) },
        ]),
      )
    : undefined;
  return {
    ...raw,
    nodes: strippedNodes,
    ...(strippedPaints ? { paints: strippedPaints } : {}),
  };
}

export function normalizeLegacyBackgroundRemoval(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const rawNodes = (raw.nodes as Record<string, Record<string, unknown>> | undefined) ?? {};
  const nodes: Record<string, Record<string, unknown>> = {};
  const rasterMaskAssets = {
    ...((raw.rasterMaskAssets as Record<string, Record<string, unknown>> | undefined) ?? {}),
  };
  for (const [nodeId, node] of Object.entries(rawNodes)) {
    const legacy = node.backgroundRemoval as Record<string, unknown> | undefined;
    if (!('backgroundRemoval' in node)) {
      nodes[nodeId] = node;
      continue;
    }
    const { backgroundRemoval: _legacy, ...normalizedNode } = node;
    if (!legacy || typeof legacy !== 'object' || typeof legacy.maskDataUrl !== 'string') {
      nodes[nodeId] = normalizedNode;
      continue;
    }
    if (node.kind !== 'shape' || node.mask) {
      nodes[nodeId] = normalizedNode;
      continue;
    }
    const metadata = legacyImageMetadata(node);
    const previewDimensions = legacyPngDimensions(legacy.maskDataUrl);
    if (!previewDimensions) {
      nodes[nodeId] = normalizedNode;
      continue;
    }
    const assetData = {
      mimeType: 'image/png',
      dataUrl: legacy.maskDataUrl,
      width: previewDimensions.width,
      height: previewDimensions.height,
      byteLength: decodedBase64Length(legacy.maskDataUrl),
    };
    const assetId = collisionSafeLegacyAssetId(
      `raster-mask:legacy:${encodeURIComponent(nodeId)}`,
      assetData,
      rasterMaskAssets,
    );
    rasterMaskAssets[assetId] ??= { id: assetId, ...assetData };
    normalizedNode.mask = {
      type: 'alpha',
      visible: true,
      feather:
        typeof legacy.feather === 'number' && legacy.feather > 0 ? legacy.feather : undefined,
      rasterMask: {
        assetId,
        coordinateSpace: 'legacy-preview-pixels',
        sourceIdentity: {
          kind: 'source-metadata',
          locator: metadata.src,
          ...(Number.isInteger(metadata.width) && metadata.width > 0
            ? { pixelWidth: metadata.width }
            : {}),
          ...(Number.isInteger(metadata.height) && metadata.height > 0
            ? { pixelHeight: metadata.height }
            : {}),
          revision: 1,
        },
        staleReason: 'legacy-preview-resolution',
        provenance: {
          method:
            legacy.method === 'quick' ||
            legacy.method === 'ai-balanced' ||
            legacy.method === 'ai-quality'
              ? legacy.method
              : 'quick',
          runtime: 'typescript',
          generatedAt: typeof legacy.appliedAt === 'number' ? legacy.appliedAt : 0,
          confidence: typeof legacy.confidence === 'number' ? legacy.confidence : undefined,
          decontaminate:
            typeof legacy.decontaminate === 'boolean' ? legacy.decontaminate : undefined,
          origin: 'legacy-background-removal-preview',
        },
      },
    };
    nodes[nodeId] = normalizedNode;
  }
  return {
    ...raw,
    nodes,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
  };
}

export const migrations = [
  { from: '0.9', to: '1.0', migrate: migrateV09ToV10 },
  { from: '1.0', to: '1.1', migrate: migrateV10ToV11 },
  { from: '1.1', to: '1.2', migrate: migrateV11ToV12 },
  { from: '1.2', to: '1.3', migrate: migrateV12ToV13 },
  { from: '1.3', to: '1.4', migrate: migrateV13ToV14 },
  { from: '1.4', to: '1.5', migrate: migrateV14ToV15 },
  { from: '1.5', to: '1.6', migrate: migrateV15ToV16 },
  { from: '1.6', to: '1.7', migrate: migrateV16ToV17 },
  { from: '1.7', to: '1.8', migrate: migrateV17ToV18 },
  { from: '1.8', to: '1.9', migrate: migrateV18ToV19 },
  { from: '1.9', to: '1.10', migrate: migrateV19ToV110 },
  { from: '1.10', to: '2.0', migrate: migrateV110ToV20 },
  { from: '2.0', to: '2.1', migrate: migrateV20ToV21 },
  { from: '2.1', to: '2.2', migrate: migrateV21ToV22 },
  { from: '2.2', to: '2.3', migrate: migrateV22ToV23 },
  { from: '2.3', to: '2.4', migrate: migrateV23ToV24 },
  { from: '2.4', to: '2.5', migrate: migrateV24ToV25 },
  { from: '2.5', to: '2.6', migrate: migrateV25ToV26 },
  { from: '2.6', to: '2.7', migrate: migrateV26ToV27 },
];

/**
 * 2.12 → 2.13: glyph-level typography fields (kerningMode, per-cluster
 * glyphAdjustments, pairAdjustments). All optional; malformed entries are
 * dropped so readers can assume well-typed values.
 */
export function migrateV212ToV213(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw, formatVersion: '2.13' } as Record<string, unknown>;
  const nodes = result.nodes as Record<string, unknown> | undefined;
  if (nodes) {
    for (const node of Object.values(nodes)) {
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      if (n.kind !== 'text') continue;
      if (n.kerningMode !== undefined && n.kerningMode !== 'auto' && n.kerningMode !== 'none') {
        n.kerningMode = 'auto';
      }
      const glyphs = n.glyphAdjustments;
      if (glyphs && typeof glyphs === 'object') {
        const map = glyphs as Record<string, unknown>;
        for (const key of Object.keys(map)) {
          const adj = map[key];
          if (!adj || typeof adj !== 'object') {
            delete map[key];
            continue;
          }
          const a = adj as Record<string, unknown>;
          if (
            typeof a.dx !== 'number' ||
            typeof a.dy !== 'number' ||
            typeof a.advance !== 'number' ||
            typeof a.rotation !== 'number' ||
            typeof a.scaleX !== 'number' ||
            typeof a.scaleY !== 'number'
          ) {
            delete map[key];
          }
        }
      } else if (glyphs !== undefined) {
        n.glyphAdjustments = undefined;
      }
      const pairs = n.pairAdjustments;
      if (pairs && typeof pairs === 'object') {
        const map = pairs as Record<string, unknown>;
        for (const key of Object.keys(map)) {
          if (typeof map[key] !== 'number' || !Number.isFinite(map[key])) delete map[key];
        }
      } else if (pairs !== undefined) {
        n.pairAdjustments = undefined;
      }
    }
  }
  return result;
}
