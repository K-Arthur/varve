// COMPLEXITY: 214 cyclo — see docs/plans/architecture-health-remediation-2026-07-26.md
import { createEmbeddedAsset, mimeTypeFromDataUrl } from './assets';
import { textColorMigration } from './colorMigration';
import { migrateV214ToV215 } from './modifiersMigration';
import { migrateV212ToV213 } from './version-migrations';
import { migrateV216ToV217 } from './version-migrations-v217';
import { migrateV217ToV218 } from './version-migrations-v218';
import { migrateV218ToV219 } from './version-migrations-v219';
import { migrateV219ToV220 } from './version-migrations-v220';

export const CURRENT_DOCUMENT_VERSION = '2.20';

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
  '2.3',
  '2.4',
  '2.5',
  '2.6',
  '2.7',
  '2.8',
  '2.9',
  '2.10',
  '2.11',
  '2.12',
  '2.13',
  '2.14',
  '2.15',
  '2.16',
  '2.17',
  '2.18',
  '2.19',
  '2.20',
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
  {
    from: '2.2',
    to: '2.3',
    migrate: (raw) => {
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
                typeof a === 'object' &&
                a !== null &&
                (a as Record<string, unknown>).visible !== false,
            );
          let scope: Record<string, unknown> | undefined;
          if (clipping) {
            const targetNodeId = siblingBelow(id);
            if (targetNodeId) scope = { mode: 'image-local', targetNodeId };
          } else if (hasActiveAdjustments) {
            // Non-clipping adjustment with content: set to document scope
            scope = { mode: 'document' };
          }
          // Empty/inactive adjustments leave scope undefined (no-op)
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
    },
  },
  {
    from: '2.3',
    to: '2.4',
    migrate: (raw) => {
      // Add bitDepth and workingSpace to colorConfig if present.
      // Colors themselves gain an optional bitDepth field with default
      // 'uint8' at read time — no per-color migration needed (lossless).
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
    },
  },
  {
    from: '2.4',
    to: '2.5',
    migrate: (raw) => {
      // Coordinate architecture v2: bake per-node rotation into the transform
      // tuple so that transform is the single source of truth for a node's
      // local→parent affine. Previously rotation was a separate field composed
      // at render time, which caused nodeLocalBounds to return un-rotated
      // bounds while the renderer applied rotation.
      const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};
      const migratedNodes: Record<string, Record<string, unknown>> = {};
      let bakedCount = 0;

      for (const [id, node] of Object.entries(nodes)) {
        const rotation = (node.rotation as number) ?? 0;
        const transform = node.transform as number[] | undefined;

        if (rotation !== 0 && transform && Array.isArray(transform) && transform.length === 6) {
          // Bake rotation into transform: newTransform = transform * rotateDeg(rotation)
          const radians = (rotation * Math.PI) / 180;
          const cos = Math.cos(radians);
          const sin = Math.sin(radians);
          const a = transform[0] ?? 1;
          const b = transform[1] ?? 0;
          const c = transform[2] ?? 0;
          const d = transform[3] ?? 1;
          const e = transform[4] ?? 0;
          const f = transform[5] ?? 0;
          // multiplyAffine(transform, rotateDeg(rotation)):
          //   [a*cos + c*sin, b*cos + d*sin, -a*sin + c*cos, -b*sin + d*cos, e, f]
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

      // Validate all transforms are finite
      const errors: string[] = [];
      for (const [id, node] of Object.entries(migratedNodes)) {
        const t = node.transform as number[] | undefined;
        if (t && Array.isArray(t)) {
          for (let i = 0; i < Math.min(t.length, 6); i++) {
            if (typeof t[i] !== 'number' || !Number.isFinite(t[i])) {
              errors.push(`Node ${id}: transform[${i}] is non-finite`);
              // Reset to identity to prevent rendering failures
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
    },
  },
  {
    from: '2.5',
    to: '2.6',
    migrate: (raw) => {
      // Generalizes RasterMaskAsset (raster masks, v2.1+) to image fills:
      // extract inline data-URL image content into a document-level,
      // content-hashed asset table (Document.assets) so identical bytes
      // placed on multiple layers/paints are stored once. Fills keep `src`
      // populated in-memory (rehydrateEmbeddedAssetSrc keeps this true on
      // every future load); only `serializeDocument` strips the redundant
      // copy at save time. See docs/audits/smart-object-feasibility-audit.md.
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
    },
  },
  {
    from: '2.6',
    to: '2.7',
    migrate: (raw) => {
      // v2.7 adds non-destructive crop, rotation, flipH, flipV fields to
      // ImageFillData. These fields are all optional and default to
      // "no crop / no rotation / no flip", so existing fills need no
      // structural change — we only normalize any already-present values
      // (e.g. from a beta serialization) to guarantee invariants:
      //   - crop is clamped to source dimensions
      //   - crop covering the full source is stored as undefined
      //   - rotation is normalized to [0, 360)
      //   - flipH/flipV are booleans
      const nodes = (raw.nodes as Record<string, Record<string, unknown>>) ?? {};

      const normalizeFill = (fillValue: unknown): unknown => {
        if (!fillValue || typeof fillValue !== 'object') return fillValue;
        const fill = fillValue as Record<string, unknown>;
        if (fill.type !== 'image' || !fill.image || typeof fill.image !== 'object') return fill;
        const image = fill.image as Record<string, unknown>;
        let changed = false;

        // Normalize crop
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

        // Normalize rotation to [0, 360)
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

        // Normalize flipH/flipV to booleans
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
    },
  },
  {
    from: '2.7',
    to: '2.8',
    migrate: (raw) => {
      const suppressions = raw.suppressions;
      if (suppressions !== undefined && Array.isArray(suppressions)) {
        return { ...raw, formatVersion: '2.8', suppressions };
      }
      return { ...raw, formatVersion: '2.8', suppressions: [] };
    },
  },
  {
    from: '2.8',
    to: '2.9',
    migrate: (raw) => {
      // Initialize grid settings if they don't exist
      // This provides a clean slate for the new grid system
      // Existing localStorage-based grid settings will be migrated separately in the editor
      if (!raw.gridSettings) {
        return {
          ...raw,
          formatVersion: '2.9',
          gridSettings: {
            documentGrid: {
              id: 'grid-document-default',
              type: 'document',
              name: 'Document Grid',
              visible: false,
              snapEnabled: true,
              color: 'var(--color-border-subtle)',
              opacity: 0.4,
              scope: 'document',
              spacingX: 8,
              spacingY: 8,
              subdivisions: 4,
              offsetX: 0,
              offsetY: 0,
            },
            pixelGrid: {
              id: 'grid-pixel-default',
              type: 'pixel',
              name: 'Pixel Grid',
              visible: false,
              snapEnabled: false,
              color: 'var(--color-border-subtle)',
              opacity: 0.5,
              scope: 'document',
              showAtHighZoom: true,
              zoomThreshold: 4.0,
            },
          },
        };
      }
      return { ...raw, formatVersion: '2.9' };
    },
  },
  {
    from: '2.9',
    to: '2.10',
    migrate: (raw) => {
      // Add optional upscale field to ImageFillData.
      // The field is optional, so this is a no-op for existing documents.
      return { ...raw, formatVersion: '2.10' };
    },
  },
  {
    from: '2.10',
    to: '2.11',
    migrate: (raw) => {
      // Document-local gradient presets (gradient-map portability). New
      // documents get an empty array; the field is optional, so pre-existing
      // documents without one normalize to [] on read.
      const result = { ...raw, formatVersion: '2.11' } as Record<string, unknown>;
      if (!Array.isArray(result.gradientPresets)) {
        result.gradientPresets = [];
      }
      return result;
    },
  },
  {
    from: '2.11',
    to: '2.12',
    migrate: (raw) => {
      // Logo project metadata (concepts/variants/brief/palette) is optional;
      // existing documents simply have none. The migration normalizes any
      // malformed logoProject payload into a safe shape.
      const result = { ...raw, formatVersion: '2.12' } as Record<string, unknown>;
      if (result.logoProject !== undefined) {
        const p = result.logoProject as Record<string, unknown>;
        const concepts = Array.isArray(p.concepts) ? p.concepts : [];
        const variants = Array.isArray(p.variants) ? p.variants : [];
        const conceptIds = new Set(
          concepts
            .filter((c) => typeof c === 'object' && c !== null)
            .map((c) => (c as { id?: unknown }).id),
        );
        result.logoProject = {
          version: 1,
          id: typeof p.id === 'string' ? p.id : `logo-${Date.now()}`,
          name: typeof p.name === 'string' ? p.name : 'Logo Project',
          createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
          updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
          brief: {
            keywords: [],
            preferredColors: [],
            prohibitedColors: [],
            updatedAt: Date.now(),
            ...(typeof p.brief === 'object' && p.brief !== null ? (p.brief as object) : {}),
          },
          concepts,
          variants: variants.map((v) => {
            const vv = v as Record<string, unknown>;
            return {
              ...vv,
              sourceConceptId:
                typeof vv.sourceConceptId === 'string' && conceptIds.has(vv.sourceConceptId)
                  ? vv.sourceConceptId
                  : null,
            };
          }),
          palette: Array.isArray(p.palette)
            ? { colors: p.palette, updatedAt: Date.now() }
            : p.palette,
        };
      }
      return result;
    },
  },
  {
    from: '2.12',
    to: '2.13',
    migrate: (raw) => migrateV212ToV213(raw),
  },
  textColorMigration,
  {
    from: '2.14',
    to: '2.15',
    migrate: (raw) => migrateV214ToV215(raw),
  },
  {
    from: '2.15',
    to: '2.16',
    migrate: (raw) => {
      // v2.16: optional GroupNode.traceMetadata (Image Trace provenance).
      // The field is optional and only ever present on groups created by the
      // trace workflow, so existing documents need no structural change.
      return { ...raw, formatVersion: '2.16' };
    },
  },
  {
    from: '2.16',
    to: '2.17',
    migrate: (raw) => migrateV216ToV217(raw),
  },
  {
    from: '2.17',
    to: '2.18',
    migrate: (raw) => migrateV217ToV218(raw),
  },
  {
    from: '2.18',
    to: '2.19',
    migrate: (raw) => migrateV218ToV219(raw),
  },
  {
    from: '2.19',
    to: '2.20',
    migrate: (raw) => migrateV219ToV220(raw),
  },
];

/**
 * Unconditional post-migration step: materializes `ImageFillData.src` from
 * `Document.assets[assetId].dataUrl` wherever `assetId` is set. Every reader
 * in the codebase (render, codegen, print export, thumbnail/IR cache keys)
 * reads `.src` directly — this guarantees it is always populated in-memory,
 * so none of those readers need to know the asset table exists. Runs on
 * every load (not just the 2.5→2.6 migration step) because a document saved
 * at 2.6+ has `src` stripped from disk by `stripEmbeddedAssetPayloads` below.
 */
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

/**
 * Inverse of `rehydrateEmbeddedAssetSrc`, applied only at serialize time:
 * drops the per-fill `src` duplicate whenever it exactly matches the
 * canonical `Document.assets[assetId].dataUrl` copy, so the saved JSON
 * (and every autosave/recovery snapshot, which reuses this function) stores
 * embedded bytes once instead of once per placement. If `src` doesn't match
 * the asset (drift, or the asset is missing), it is left alone — never
 * silently discard data that isn't provably redundant.
 */
function stripEmbeddedAssetPayloads(raw: Record<string, unknown>): Record<string, unknown> {
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
  return JSON.stringify(
    stripEmbeddedAssetPayloads(stampVersion(normalizeLegacyBackgroundRemoval(target))),
  );
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

  return rehydrateEmbeddedAssetSrc(result);
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
    document: rehydrateEmbeddedAssetSrc(result),
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
