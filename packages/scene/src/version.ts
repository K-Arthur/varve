export const CURRENT_DOCUMENT_VERSION = '1.4';

export const SUPPORTED_VERSIONS = ['1.0', '1.1', '1.2', '1.3', '1.4'];

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
        pages.length > 0 ? ((pages[0] as Record<string, unknown> | undefined)?.contentRoot as string) : undefined;
      return {
        ...raw,
        formatVersion: '1.4',
        activePageId,
        globalChildren: [],
      };
    },
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
    index: 0,
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
