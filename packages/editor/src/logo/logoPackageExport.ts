/**
 * Logo package export — a deterministic, production-ready deliverable set
 * for a logo project.
 *
 * Builds a ZIP (or folder set on desktop) containing, per included concept
 * and variant:
 * - SVG/<name>/<name>.svg — transparent vector
 * - PNG/<name>/<name>@1x.png, @2x.png — transparent raster ladder
 * - PDF/Print/<name>/<name>.pdf — vector PDF (raster fallback in browser)
 * - ICO/<name>.ico — multi-size Windows icon (16-256px, PNG-compressed)
 * - ICNS/<name>.icns — macOS Retina icon set (icp4..ic15)
 * plus Palette/, Source/, README.md, and a deterministic manifest.json.
 *
 * Everything is derived from the live document at export time; the source
 * artwork is never modified. File naming is deterministic and sanitized for
 * Windows/macOS/Linux. All encoders are pure TS or reuse the existing export
 * pipeline, so browser and desktop runtimes produce identical bytes.
 */

import type { Platform } from '@varve/platform';
import type { Document, NodeId } from '@varve/scene';
import {
  buildIcns,
  buildIco,
  ICNS_REPRESENTATIONS,
  ICO_SUPPORTED_SIZES,
  sanitizeSegment,
} from '@varve/scene/export';

export interface LogoPackageEntry {
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface LogoPackageOptions {
  /** Brand name used for the package folder and README (defaults to project/doc name). */
  brandName?: string;
  /** Concept ids to include (defaults to all concepts with artboards). */
  conceptIds?: string[];
  /** Also export registered variants (default true). */
  includeVariants?: boolean;
  /** PNG scale factors (default [1, 2]). */
  scales?: number[];
  /** Include SVG (default true). */
  includeSvg?: boolean;
  /** Include PNG (default true). */
  includePng?: boolean;
  /** Include a vector PDF per variant (default true). */
  includePdf?: boolean;
  /** Include a multi-size ICO per variant (default true). */
  includeIco?: boolean;
  /** ICO sizes (default [16, 32, 48, 256]). */
  icoSizes?: number[];
  /** Include a Retina ICNS per variant (default true). */
  includeIcns?: boolean;
  /** ICNS representation types (default: full modern set). */
  icnsTypes?: string[];
  /** Include the document's palette (default true). */
  includePalette?: boolean;
  /** Include the source document (default true). */
  includeSource?: boolean;
  /** Document JSON for Source/project.varve. */
  sourceJson?: string;
}

export interface LogoPackageResult {
  fileName: string;
  entries: string[];
  /** Per-folder file counts for the completion report. */
  counts: Record<string, number>;
  bytes: Uint8Array;
}

const PNG_MIME = 'image/png';
const SVG_MIME = 'image/svg+xml';
const PDF_MIME = 'application/pdf';
const ICO_MIME = 'image/x-icon';
const ICNS_MIME = 'image/icns';

export const DEFAULT_ICO_SIZES = [16, 32, 48, 256] as const;

/** Render a node to a transparent PNG blob at the given scale factor. */
async function renderPngBytes(
  node: import('@varve/scene').SceneNode,
  doc: Document,
  scale: number,
): Promise<Uint8Array> {
  const { exportNodeAsRaster } = await import('../components/SpecPanel/export');
  const { createEngine } = await import('@varve/engine');
  const engine = await createEngine('auto');
  const result = await exportNodeAsRaster(node, doc, engine, {
    format: 'image/png',
    scale,
    transparency: true,
  });
  return new Uint8Array(await result.blob.arrayBuffer());
}

/** Render a node to a transparent PNG at an exact pixel size (for icons). */
async function renderPngAtSize(
  node: import('@varve/scene').SceneNode,
  doc: Document,
  size: number,
): Promise<Uint8Array> {
  const { worldBBox } = await import('../components/SpecPanel/measurement');
  const bbox = worldBBox(node, doc);
  const worldSize = Math.max(bbox.w, bbox.h, 1);
  const scale = size / worldSize;
  return renderPngBytes(node, doc, scale);
}

/** Render a node to an SVG string (transparent background). */
async function renderSvg(node: import('@varve/scene').SceneNode, doc: Document): Promise<string> {
  const { exportNodeToSvg } = await import('@varve/codegen');
  return exportNodeToSvg(node, doc, {
    background: 'transparent',
    minify: false,
  });
}

/** Render a node to a PDF (vector on desktop, raster fallback in browser). */
async function renderPdf(
  node: import('@varve/scene').SceneNode,
  doc: Document,
): Promise<Uint8Array> {
  const { exportNodeAsPdf } = await import('../components/SpecPanel/export');
  const { createEngine } = await import('@varve/engine');
  const engine = await createEngine('auto');
  const result = await exportNodeAsPdf(node, doc, 1, engine);
  return result.bytes;
}

export function collectPalette(doc: Document): Record<string, string> {
  const project = doc.logoProject;
  const out: Record<string, string> = {};
  const push = (name: string, color: string): void => {
    out[sanitizeSegment(name)] = color;
  };
  if (project?.palette) {
    for (const c of project.palette.colors) {
      push(c.name ?? `color-${c.id.slice(0, 6)}`, managedColorToHex(c.color));
    }
  }
  for (const swatch of doc.swatches ?? []) {
    const name = swatch.name ?? 'swatch';
    if (!(name in out)) push(name, managedColorToHex(swatch.color));
  }
  return out;
}

export function managedColorToHex(color: import('@varve/scene').ManagedColor): string {
  if (color.space === 'rgb') {
    const to255 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
    const a = to255(color.a);
    const hex = `#${[color.r, color.g, color.b].map((v) => to255(v).toString(16).padStart(2, '0')).join('')}`;
    return a < 255 ? `${hex}${a.toString(16).padStart(2, '0')}` : hex;
  }
  if (color.space === 'cmyk') {
    const c = Math.min(1, Math.max(0, color.c));
    const m = Math.min(1, Math.max(0, color.m));
    const y = Math.min(1, Math.max(0, color.y));
    const k = Math.min(1, Math.max(0, color.k));
    const r = Math.round(255 * (1 - c) * (1 - k));
    const g = Math.round(255 * (1 - m) * (1 - k));
    const b = Math.round(255 * (1 - y) * (1 - k));
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  const gray = Math.round(255 * Math.min(1, Math.max(0, color.space === 'gray' ? color.v : 0.5)));
  return `#${[gray, gray, gray].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function buildReadme(
  brandName: string,
  concepts: { name: string; folders: string[] }[],
  variants: { name: string; kind: string; folders: string[] }[],
  paletteCount: number,
  formats: string[],
): string {
  const conceptLines = concepts.map((c) => `- ${c.name}: ${c.folders.join(', ')}`).join('\n');
  const variantLines =
    variants.length > 0
      ? variants.map((v) => `- ${v.name} (${v.kind}): ${v.folders.join(', ')}`).join('\n')
      : '- None yet.';
  return [
    `# ${brandName} — Logo Package`,
    '',
    'Generated by Varve. This package contains production-ready logo assets.',
    '',
    '## Contents',
    '',
    `- Formats: ${formats.join(', ')}.`,
    `- \`Palette/\`: ${paletteCount} brand color(s) as JSON (hex).`,
    '- `Source/`: the editable Varve document.',
    '',
    '## Concepts',
    '',
    conceptLines || '- None.',
    '',
    '## Variants',
    '',
    variantLines,
    '',
    '## Usage notes',
    '',
    '- Logos are delivered on a transparent background; place them on your',
    '  brand surfaces, never on an opaque box.',
    '- Keep the clear space around the logo free of other elements.',
    '- For one-color reproduction (fax, engraving, stamps), use the',
    '  monochrome or reversed variant when provided.',
    '',
    '## Licensing',
    '',
    'Review the licensing status of fonts, images, and templates used in',
    'this logo before commercial adoption. Varve records what it can but',
    'does not grant or assert trademark rights.',
    '',
  ].join('\n');
}

interface RenderTarget {
  id: string;
  name: string;
  kind?: string;
  nodeId: NodeId | null;
}

/** Collect the render targets (concepts + variants) for a package. */
export function collectRenderTargets(
  doc: Document,
  options: LogoPackageOptions = {},
): { concepts: RenderTarget[]; variants: RenderTarget[] } {
  const project = doc.logoProject;
  const concepts = (project?.concepts ?? [])
    .filter((c) =>
      options.conceptIds ? options.conceptIds.includes(c.id) : c.status !== 'rejected',
    )
    .map((c) => ({ id: c.id, name: c.name, nodeId: c.artboardId }));
  const variants =
    (options.includeVariants ?? true)
      ? (project?.variants ?? []).map((v) => ({
          id: v.id,
          name: v.name,
          kind: v.kind,
          nodeId: v.artboardId,
        }))
      : [];
  return { concepts, variants };
}

/** Estimate the number of files a package will contain (for the UI). */
export function estimatePackageFileCount(options: LogoPackageOptions, targetCount: number): number {
  let count = 0;
  if (options.includePng ?? true) count += (options.scales ?? [1, 2]).length * targetCount;
  if (options.includeSvg ?? true) count += targetCount;
  if (options.includePdf ?? true) count += targetCount;
  if (options.includeIco ?? true) count += targetCount;
  if (options.includeIcns ?? true) count += targetCount;
  count += 2; // README + manifest
  if (options.includePalette ?? true) count += 1;
  if (options.includeSource ?? true) count += 1;
  return count;
}

/** Build the deterministic logo package ZIP. */
export async function buildLogoPackage(
  doc: Document,
  options: LogoPackageOptions,
): Promise<LogoPackageResult> {
  const project = doc.logoProject;
  const brandName = options.brandName || project?.name || doc.name || 'Brand';
  const scales = options.scales ?? [1, 2];
  const icoSizes = options.icoSizes ?? [...DEFAULT_ICO_SIZES];
  const icnsTypes = options.icnsTypes ?? ICNS_REPRESENTATIONS.map((r) => r.type);
  const entries: LogoPackageEntry[] = [];
  const counts: Record<string, number> = {};
  const folder = sanitizeSegment(brandName);

  const push = (fileName: string, bytes: Uint8Array, mimeType: string): void => {
    entries.push({ fileName, bytes, mimeType });
    const section = fileName.split('/')[1] ?? 'other';
    counts[section] = (counts[section] ?? 0) + 1;
  };

  const renderTargetEntries = async (
    target: RenderTarget,
    targetFolder: string,
  ): Promise<string[]> => {
    const node = target.nodeId ? doc.nodes[target.nodeId] : undefined;
    if (!node) return [];
    const files: string[] = [];
    if (options.includePng ?? true) {
      for (const scale of scales) {
        const suffix = scale === 1 ? '' : `@${scale}x`;
        const png = await renderPngBytes(node, doc, scale);
        const fileName = `${sanitizeSegment(target.name)}${suffix}.png`;
        push(`${folder}/PNG/${targetFolder}/${fileName}`, png, PNG_MIME);
        files.push(fileName);
      }
    }
    if (options.includeSvg ?? true) {
      const svg = await renderSvg(node, doc);
      const svgName = `${sanitizeSegment(target.name)}.svg`;
      push(`${folder}/SVG/${targetFolder}/${svgName}`, new TextEncoder().encode(svg), SVG_MIME);
      files.push(svgName);
    }
    if (options.includePdf ?? true) {
      const pdf = await renderPdf(node, doc);
      const pdfName = `${sanitizeSegment(target.name)}.pdf`;
      push(`${folder}/PDF/Print/${targetFolder}/${pdfName}`, pdf, PDF_MIME);
      files.push(pdfName);
    }
    if (options.includeIco ?? true) {
      const validSizes = icoSizes.filter((size) => ICO_SUPPORTED_SIZES.includes(size as never));
      const pngs = await Promise.all(validSizes.map((size) => renderPngAtSize(node, doc, size)));
      const ico = buildIco(validSizes.map((size, index) => ({ size, png: pngs[index]! })));
      const icoName = `${sanitizeSegment(target.name)}.ico`;
      push(`${folder}/ICO/${icoName}`, ico.bytes, ICO_MIME);
      files.push(icoName);
    }
    if (options.includeIcns ?? true) {
      const types = icnsTypes.filter((type) =>
        ICNS_REPRESENTATIONS.some((rep) => rep.type === type),
      );
      const pngs = await Promise.all(
        types.map((type) => {
          const rep = ICNS_REPRESENTATIONS.find((r) => r.type === type);
          return renderPngAtSize(node, doc, rep?.pixelSize ?? 256);
        }),
      );
      const icns = buildIcns(types.map((type, index) => ({ type, png: pngs[index]! })));
      const icnsName = `${sanitizeSegment(target.name)}.icns`;
      push(`${folder}/ICNS/${icnsName}`, icns.bytes, ICNS_MIME);
      files.push(icnsName);
    }
    return files;
  };

  const { concepts, variants } = collectRenderTargets(doc, options);
  const conceptFolders: { name: string; folders: string[] }[] = [];
  for (const concept of concepts) {
    const sub = sanitizeSegment(concept.name);
    const files = await renderTargetEntries(concept, sub);
    if (files.length > 0) conceptFolders.push({ name: concept.name, folders: files });
  }

  const variantFolders: { name: string; kind: string; folders: string[] }[] = [];
  for (const variant of variants) {
    const sub = sanitizeSegment(variant.name);
    const files = await renderTargetEntries(variant, sub);
    if (files.length > 0) {
      variantFolders.push({ name: variant.name, kind: variant.kind ?? 'custom', folders: files });
    }
  }

  const palette: Record<string, string> =
    (options.includePalette ?? true) ? collectPalette(doc) : {};
  const paletteJson = JSON.stringify({ name: brandName, colors: palette }, null, 2);
  push(
    `${folder}/Palette/brand-palette.json`,
    new TextEncoder().encode(paletteJson),
    'application/json',
  );

  const formats: string[] = [];
  if (options.includeSvg ?? true) formats.push('SVG');
  if (options.includePng ?? true) formats.push('PNG');
  if (options.includePdf ?? true) formats.push('PDF');
  if (options.includeIco ?? true) formats.push('ICO');
  if (options.includeIcns ?? true) formats.push('ICNS');

  const readme = buildReadme(
    brandName,
    conceptFolders,
    variantFolders,
    Object.keys(palette).length,
    formats,
  );
  push(`${folder}/README.md`, new TextEncoder().encode(readme), 'text/markdown');

  if (options.includeSource ?? true) {
    const sourceJson = options.sourceJson ?? JSON.stringify(doc, null, 2);
    push(
      `${folder}/Source/project.varve`,
      new TextEncoder().encode(sourceJson),
      'application/json',
    );
  }

  const manifest = {
    name: brandName,
    generatedBy: 'varve-logo-package',
    version: 2,
    generatedAt: new Date().toISOString(),
    concepts: conceptFolders.map((c) => c.name),
    variants: variantFolders.map((v) => v.name),
    scales,
    formats,
    icoSizes: (options.includeIco ?? true) ? icoSizes : undefined,
    icnsTypes: (options.includeIcns ?? true) ? icnsTypes : undefined,
    palette: Object.keys(palette),
  };
  push(
    `${folder}/manifest.json`,
    new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    'application/json',
  );

  // Deterministic zip: sort entries by path, then compress.
  const sorted = [...entries].sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
  const files: Record<string, Uint8Array> = {};
  for (const entry of sorted) files[entry.fileName] = entry.bytes;

  const { zipSync } = await import('fflate');
  const zipped = zipSync(files, { level: 6 });

  return {
    fileName: `${folder}-Logo-Package.zip`,
    entries: sorted.map((e) => e.fileName),
    counts,
    bytes: zipped,
  };
}

/** Save a built logo package through the platform facade. */
export async function saveLogoPackage(
  platform: Platform | undefined,
  result: LogoPackageResult,
): Promise<boolean> {
  if (!platform) return false;
  try {
    await platform.saveBinaryFile(result.fileName, result.bytes, 'application/zip', 'zip');
    return true;
  } catch {
    return false;
  }
}
