export const CURRENT_DOCUMENT_VERSION = '2.2';

export const SUPPORTED_VERSIONS = [
  '1.0',
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '1.7',
  '1.8',
  '1.9',
  '1.10',
  '2.0',
  '2.1',
  '2.2',
];

export interface DocumentMigration {
  from: string;
  to: string;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

const migrations: DocumentMigration[] = [
  {
    from: '0.9',
    to: '1.0',
    migrate: (raw) => ({
      ...raw,
      formatVersion: '1.0',
      canvasWidth: raw.canvasWidth ?? 1440,
      canvasHeight: raw.canvasHeight ?? 1024,
    }),
  },
  {
    from: '1.0',
    to: '1.1',
    migrate: (raw) => ({
      ...raw,
      formatVersion: '1.1',
      // Print production fields default to undefined (optional).
      // Documents created before v1.1 are treated as RGB, px-only.
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
    }),
  },
  {
    from: '1.1',
    to: '1.2',
    migrate: (raw) => {
      let result: Record<string, unknown> = {
        ...raw,
        formatVersion: '1.2',
        // Motion/animation fields default to undefined (no timelines by default).
        timelines: raw.timelines ?? undefined,
        activeTimelineId: raw.activeTimelineId ?? undefined,
      };

      // Migrate flat rootChildren into pages if no pages exist
      if (!result.pages) {
        result = migrateRawToPages(result);
      }

      return result;
    },
  },
  {
    from: '1.2',
    to: '1.3',
    migrate: (raw) => {
      // O(n) scan to compute parentId for every node
      const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
      const rootChildren = (raw.rootChildren as string[]) ?? [];
      const rootSet = new Set(rootChildren);

      // Build parent map: parentId → all its children
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

      // Set parentId on each node
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
    },
  },
  {
    from: '1.3',
    to: '1.4',
    migrate: (raw) => {
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
    },
  },
  {
    from: '1.4',
    to: '1.5',
    migrate: (raw) => {
      const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
      const migrated: Record<string, Record<string, unknown>> = {};
      for (const [id, node] of Object.entries(nodes)) {
        if (node.kind === 'image') {
          const w = (node.w as number) ?? 100;
          const h = (node.h as number) ?? 100;
          const src = (node.src as string) ?? '';
          const fit = (node.imageFit as string) ?? 'fill';
          // Re-create as a shape node with image fill, preserving common fields
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
    },
  },
  {
    from: '1.5',
    to: '1.6',
    migrate: (raw) => ({
      ...raw,
      formatVersion: '1.6',
      interactions: raw.interactions ?? undefined,
    }),
  },
  {
    from: '1.6',
    to: '1.7',
    migrate: (raw) => {
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
    },
  },
  {
    from: '1.7',
    to: '1.8',
    migrate: (raw) => ({
      ...raw,
      formatVersion: '1.8',
      // paints field is optional — defaults to undefined
      paints: raw.paints ?? undefined,
    }),
  },
  {
    from: '1.8',
    to: '1.9',
    migrate: (raw) => {
      const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
      const migrated: Record<string, Record<string, unknown>> = {};
      for (const [id, node] of Object.entries(nodes)) {
        const mask = node.mask as Record<string, unknown> | undefined;
        if (mask && typeof mask === 'object') {
          // v1.9: add fillRule to clip masks (default 'nonzero')
          if (mask.type === 'clip' && !mask.fillRule) {
            mask.fillRule = 'nonzero';
          }
          // v1.9: ensure vectorMask is preserved if present
          if (mask.vectorMask && typeof mask.vectorMask === 'object') {
            const vm = mask.vectorMask as Record<string, unknown>;
            if (!vm.fillRule) {
              vm.fillRule = 'nonzero';
            }
          }
          // v1.9: sourceNodeId is now optional (vector masks don't require it)
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
    },
  },
  {
    from: '1.9',
    to: '1.10',
    migrate: (raw) => ({
      ...raw,
      formatVersion: '1.10',
      brushPresets: raw.brushPresets ?? undefined,
    }),
  },
  {
    from: '1.10',
    to: '2.0',
    migrate: (raw) => {
      const pages = (raw.pages as Record<string, unknown>[] | undefined) ?? [];

      // Assign stable order keys to pages that don't have them
      const migratedPages = pages.map((page, i) => {
        if (!page.order) {
          const order = `a${i.toString(36).padStart(4, '0')}`;
          return { ...page, order };
        }
        return page;
      });

      // Add activePageId if missing but pages exist
      let activePageId = raw.activePageId as string | undefined;
      if (!activePageId && migratedPages.length > 0) {
        activePageId = (migratedPages[0] as Record<string, unknown>).id as string;
      }

      return {
        ...raw,
        formatVersion: '2.0',
        pages: migratedPages,
        activePageId: activePageId ?? undefined,
        // New fields default to undefined (empty records/arrays)
        masters: raw.masters ?? undefined,
        spreads: raw.spreads ?? undefined,
        sections: raw.sections ?? undefined,
        facingPages: raw.facingPages ?? undefined,
      };
    },
  },
  {
    from: '2.0',
    to: '2.1',
    migrate: (raw) => normalizeLegacyBackgroundRemoval({ ...raw, formatVersion: '2.1' }),
  },
  {
    from: '2.1',
    to: '2.2',
    migrate: (raw) => normalizeV21RasterMaskIdentity({ ...raw, formatVersion: '2.2' }),
  },
];

export interface MigrationResult {
  document: Record<string, unknown>;
  fromVersion: string;
  toVersion: string;
  migrated: boolean;
  warnings: string[];
}

function parseVersion(v: string): number[] {
  return v.split('.').map((s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

function isVersionLessThan(a: string, b: string): boolean {
  const [aMajor = 0, aMinor = 0] = parseVersion(a);
  const [bMajor = 0, bMinor = 0] = parseVersion(b);
  return aMajor < bMajor || (aMajor === bMajor && aMinor < bMinor);
}

export function stampVersion<T extends { formatVersion?: string }>(
  doc: T,
): T & { formatVersion: string } {
  return { ...doc, formatVersion: CURRENT_DOCUMENT_VERSION };
}

export function serializeDocument(doc: Record<string, unknown> | unknown): string {
  const target = doc as Record<string, unknown>;
  return JSON.stringify(stampVersion(normalizeLegacyBackgroundRemoval(target)));
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

/** Convert deprecated inline background-removal payloads to v2.1 mask assets. */
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

export function isForwardCompatible(fileVersion: string): boolean {
  const [fMajor = 0, fMinor = 0] = parseVersion(fileVersion);
  const [cMajor = 0, cMinor = 0] = parseVersion(CURRENT_DOCUMENT_VERSION);
  return fMajor < cMajor || (fMajor === cMajor && fMinor <= cMinor);
}

export function detectForwardCompatWarning(fileVersion: string): string | null {
  if (!isForwardCompatible(fileVersion)) {
    return `File version ${fileVersion} is newer than current version ${CURRENT_DOCUMENT_VERSION}. Some features may not be supported.`;
  }
  return null;
}

export function migrateDocument(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const currentVersion = (doc.formatVersion as string) || '0.9';

  let result = { ...doc };

  for (const migration of migrations) {
    if (
      !isVersionLessThan(migration.to, currentVersion) &&
      isVersionLessThan(currentVersion, migration.to)
    ) {
      result = migration.migrate(result);
    }
  }

  if (!result.formatVersion) {
    result.formatVersion = CURRENT_DOCUMENT_VERSION;
  }

  return result;
}

export function migrateDocumentDetailed(raw: unknown): MigrationResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const fromVersion = (doc.formatVersion as string) || '0.9';
  const warnings: string[] = [];

  const fwdWarn = detectForwardCompatWarning(fromVersion);
  if (fwdWarn) warnings.push(fwdWarn);

  let result = { ...doc };
  let migrated = false;

  for (const migration of migrations) {
    if (
      !isVersionLessThan(migration.to, fromVersion) &&
      isVersionLessThan(fromVersion, migration.to)
    ) {
      result = migration.migrate(result);
      migrated = true;
    }
  }

  if (!result.formatVersion) {
    result.formatVersion = CURRENT_DOCUMENT_VERSION;
  }

  return {
    document: result,
    fromVersion,
    toVersion: result.formatVersion as string,
    migrated,
    warnings,
  };
}

/**
 * Raw-record migration helper: wrap flat rootChildren into a Page.
 * Used by the 1.1→1.2 migration step.
 */
function migrateRawToPages(raw: Record<string, unknown>): Record<string, unknown> {
  const rootChildren = (raw.rootChildren as string[]) ?? [];
  const nodes = (raw.nodes as Record<string, unknown>) ?? {};
  const nextId = (raw.nextId as number) ?? 1;

  // Determine dimensions: print-oriented if dpi > 0
  const dpi = (raw.dpi as number) ?? 0;
  const isPrint = dpi > 0;
  const pageWidth = isPrint ? ((raw.physicalWidth as number) ?? 210) : 1920;
  const pageHeight = isPrint ? ((raw.physicalHeight as number) ?? 297) : 1080;

  // Create a contentRoot group node
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

  // Inherit print config if present
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

export function migrateDocumentJson(json: string): Record<string, unknown> | null {
  try {
    const trimmed = json.replace(/^\uFEFF/, '').trim();
    if (!trimmed) return null;
    const raw = JSON.parse(trimmed);
    return migrateDocument(raw);
  } catch {
    return null;
  }
}
