/**
 * Deterministic file naming for export (Strata export rebuild, M3).
 *
 * Single source for:
 *  - canonical format → file extension (fixes the three duplicate extension
 *    maps found in the audit: D7)
 *  - filename templates ({name}, {suffix}, {ext}, {scale}, {index}, ...)
 *  - cross-platform filename sanitization (reserved names, invalid chars,
 *    Unicode normalization, trailing dots/spaces, path traversal)
 *  - case-insensitive collision detection and deterministic renaming
 *
 * Pure module — no DOM, no platform APIs, deterministic for tests.
 */

import type { ExportFormat, ExportScale } from './model';

// ── Extension mapping (single source of truth) ──────────────────────────────

export const CANONICAL_EXTENSIONS: Record<ExportFormat, string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  avif: '.avif',
  gif: '.gif',
  svg: '.svg',
  pdf: '.pdf',
  'pdf-x1a': '.pdf',
  'pdf-x3': '.pdf',
  'pdf-x4': '.pdf',
  tiff: '.tiff',
  bmp: '.bmp',
  ico: '.ico',
  icns: '.icns',
  eps: '.eps',
  psd: '.psd',
  json: '.json',
  css: '.css',
  html: '.html',
  react: '.tsx',
  flutter: '.dart',
  swiftui: '.swift',
};

export function extensionForFormat(format: ExportFormat): string {
  return CANONICAL_EXTENSIONS[format];
}

// ── Sanitization ────────────────────────────────────────────────────────────

const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

const INVALID_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function isInvalidFilenameChar(char: string): boolean {
  return INVALID_FILENAME_CHARS.has(char) || char.charCodeAt(0) < 0x20;
}

export interface SanitizeOptions {
  /** Replace invalid chars with this (default '_'). */
  replacement?: string;
  /** Keep dots in the segment (a full filename keeps one extension dot). */
  keepDots?: boolean;
  /** Max length for a single segment (default 160). */
  maxLength?: number;
}

/**
 * Sanitize one path segment (object/page name) so it is safe as a filename on
 * Windows, macOS, and Linux: strips reserved characters, control chars, and
 * path-traversal risk, normalizes Unicode (NFC), guards reserved Windows names,
 * and trims trailing dots/spaces.
 */
export function sanitizeSegment(input: string, options: SanitizeOptions = {}): string {
  const replacement = options.replacement ?? '_';
  const keepDots = options.keepDots ?? false;
  const maxLength = options.maxLength ?? 160;

  let result = input
    .normalize('NFC')
    .split('')
    .map((char) => (isInvalidFilenameChar(char) ? replacement : char))
    .join('');
  // Trim trailing dots/spaces first so a trailing dot is not turned into a
  // replacement character and kept.
  result = result.replace(/[ .]+$/g, '');
  if (!keepDots) {
    result = result.replace(/\./g, replacement);
  }
  result = result.replace(/^\./g, replacement);

  if (result.length === 0) return replacement;

  // Reserved Windows device names (case-insensitive), with or without extension.
  const base = result.split('.')[0]?.toUpperCase() ?? '';
  if (RESERVED_WINDOWS_NAMES.has(base)) {
    result = `_${result}`;
  }

  if (result.length > maxLength) {
    result = result.slice(0, maxLength);
  }
  return result;
}

/**
 * Sanitize a full filename (name + extension). The extension dot is preserved;
 * everything else goes through {@link sanitizeSegment}.
 */
export function sanitizeFileName(name: string, ext: string, options: SanitizeOptions = {}): string {
  const extension = ext.startsWith('.') ? ext : `.${ext}`;
  const safeBase = sanitizeSegment(name, options);
  if (safeBase === (options.replacement ?? '_')) return `${safeBase}${extension}`;
  return `${safeBase}${extension}`;
}

// ── Scale tokens ────────────────────────────────────────────────────────────

/** Render a human/device scale token, e.g. `@2x`, `1.5x`, `300dpi`, `400w`. */
export function scaleToken(scale: ExportScale): string {
  switch (scale.mode) {
    case 'multiplier':
      return `${formatNumber(scale.value)}x`;
    case 'width':
      return `${Math.round(scale.value)}w`;
    case 'height':
      return `${Math.round(scale.value)}h`;
    case 'resolution':
      return `${Math.round(scale.dpi)}dpi`;
  }
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toFixed(3)));
}

// ── Template resolution ─────────────────────────────────────────────────────

export interface FileNameContext {
  /** Primary object/page name (pre-sanitization). */
  name: string;
  format: ExportFormat;
  scale: ExportScale;
  /** Pre-normalized suffix (e.g. '@2x' or '-social'). */
  suffix?: string;
  /** Extension token rendered WITHOUT a leading dot, since templates write
   * `.{ext}` (e.g. the default `{name}{suffix}.{ext}`). Accepts a leading dot
   * for convenience and strips it. */
  ext?: string;
  /** 1-based index within the batch. */
  index?: number;
  /** Page number when the target is a page. */
  pageNumber?: number;
  /** Page name (for `{page}` folder grouping). */
  page?: string;
  /** Component/variant name when available. */
  variant?: string;
  /** Preset name when the configuration derives from a preset. */
  presetName?: string;
  /** Resolved output width in px. */
  width?: number;
  /** Resolved output height in px. */
  height?: number;
  /** ISO date; only rendered when the template explicitly asks for {date}. */
  date?: string;
  /** Base folder rule: 'flat' | 'by-preset' | 'by-node' (folder grouping). */
  folderRule?: 'flat' | 'by-preset' | 'by-node';
}

const TOKEN_PATTERN =
  /\{(name|suffix|ext|format|scale|index|page|pageNumber|variant|preset|width|height|date)\}/g;

/**
 * Resolve a filename template into a sanitized relative file path.
 *
 * Tokens are rendered from {@link FileNameContext}; unknown/empty tokens become
 * the empty string so templates like `{page}/{name}{suffix}.{ext}` work even
 * when no page exists (the empty folder segment is dropped by
 * {@link normalizeRelativePath}).
 */
export function formatFileName(template: string, ctx: FileNameContext): string {
  const extension = (ctx.ext ?? extensionForFormat(ctx.format)).replace(/^\./, '');

  const values: Record<string, string> = {
    name: ctx.name,
    suffix: ctx.suffix ?? '',
    ext: extension,
    format: ctx.format,
    scale: scaleToken(ctx.scale),
    index: ctx.index !== undefined ? String(ctx.index) : '',
    page: ctx.page ?? ctx.variant ?? '',
    pageNumber: ctx.pageNumber !== undefined ? String(ctx.pageNumber) : '',
    variant: ctx.variant ?? '',
    preset: ctx.presetName ?? '',
    width: ctx.width !== undefined ? String(ctx.width) : '',
    height: ctx.height !== undefined ? String(ctx.height) : '',
    date: ctx.date ?? '',
  };

  const resolved = template.replace(TOKEN_PATTERN, (_match, token: string) => values[token] ?? '');

  const segments = resolved.split('/').map((segment, index, arr) => {
    if (segment.trim().length === 0) return '';
    const cleaned = sanitizeSegment(segment, { keepDots: true, maxLength: 160 });
    // The final segment is the file name — never let it collapse to a bare
    // replacement char or an empty folder-ish name.
    if (index === arr.length - 1 && (cleaned === '' || cleaned === '_')) return 'export';
    return cleaned;
  });

  // A node named `logo.png` rendered through the default `{name}.{ext}`
  // template would become `logo.png.png`. When the final segment ends in the
  // extension twice, the template's extension is authoritative: collapse the
  // duplicate (case-insensitive) rather than shipping a double extension.
  if (segments.length > 0 && extension.length > 0) {
    const escaped = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const duplicate = new RegExp(`\\.${escaped}\\.${escaped}$`, 'i');
    const last = segments.length - 1;
    const finalSegment = segments[last];
    if (finalSegment) {
      segments[last] = finalSegment.replace(duplicate, `.${extension}`);
    }
  }

  return normalizeRelativePath(segments);
}

/**
 * Build a relative path from segments, enforcing no absolute paths, no `..`,
 * and forward slashes only.
 */
export function normalizeRelativePath(segments: string[]): string {
  const safe = segments
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
  if (safe.length === 0) return 'export';
  return safe;
}

/** Split a relative path into folder + file. */
export function splitRelativePath(relativePath: string): { folder: string | null; file: string } {
  const parts = relativePath.split('/');
  const file = parts.pop() ?? relativePath;
  const folder = parts.length > 0 ? parts.join('/') : null;
  return { folder, file };
}

// ── Collision resolution ────────────────────────────────────────────────────

export interface PlannedOutput {
  configurationId: string;
  fileName: string;
  relativePath: string;
}

export type CollisionAction = 'skip' | 'rename' | 'replace';

export interface CollisionResolutionResult {
  outputs: PlannedOutput[];
  /** Filenames that would collide under a 'rename' policy. */
  collisions: Array<{ relativePath: string; configurationIds: string[] }>;
  /** configurationIds dropped when action is 'skip'. */
  skipped: string[];
  /** configurationIds overwritten (kept) when action is 'replace'. */
  replaced: string[];
}

/**
 * Detect case-insensitive output-path collisions and resolve them
 * deterministically. Ordering follows input order; renames append `-2`, `-3`
 * before the extension.
 */
export function resolveCollisions(
  outputs: PlannedOutput[],
  action: CollisionAction = 'rename',
): CollisionResolutionResult {
  const byKey = new Map<string, PlannedOutput[]>();
  for (const output of outputs) {
    const key = output.relativePath.toLocaleLowerCase();
    const list = byKey.get(key) ?? [];
    list.push(output);
    byKey.set(key, list);
  }

  const collisions: Array<{ relativePath: string; configurationIds: string[] }> = [];
  const skipped: string[] = [];
  const replaced: string[] = [];
  const seen = new Set<string>();
  const resolved: PlannedOutput[] = [];

  for (const output of outputs) {
    const key = output.relativePath.toLocaleLowerCase();
    const group = byKey.get(key) ?? [];
    if (group.length > 1 && !collisions.some((c) => c.relativePath.toLocaleLowerCase() === key)) {
      collisions.push({
        relativePath: output.relativePath,
        configurationIds: group.map((g) => g.configurationId),
      });
    }

    if (action === 'skip' && group.length > 1 && group[0] !== output) {
      skipped.push(output.configurationId);
      continue;
    }

    if (action === 'replace') {
      // Last writer wins; earlier duplicates are marked replaced (dropped).
      if (group.length > 1 && group[group.length - 1] !== output) {
        replaced.push(output.configurationId);
        continue;
      }
      resolved.push(output);
      continue;
    }

    // rename (default): append deterministic `-2`, `-3`, ...
    let candidate = output.relativePath;
    let counter = 2;
    while (seen.has(candidate.toLocaleLowerCase())) {
      candidate = appendSuffix(output.relativePath, counter);
      counter += 1;
    }
    seen.add(candidate.toLocaleLowerCase());
    resolved.push({
      ...output,
      relativePath: candidate,
      fileName: splitRelativePath(candidate).file,
    });
  }

  return { outputs: resolved, collisions, skipped, replaced };
}

function appendSuffix(relativePath: string, counter: number): string {
  const { folder, file } = splitRelativePath(relativePath);
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';
  const renamed = `${base}-${counter}${ext}`;
  return folder ? `${folder}/${renamed}` : renamed;
}

// ── Path safety ─────────────────────────────────────────────────────────────

/**
 * Ensure a destination folder string is safe: no absolute paths, no traversal,
 * forward slashes only. Returns null when the folder would escape the
 * destination root.
 */
export function safeFolder(folder: string | null | undefined): string | null {
  if (!folder) return null;
  const normalized = folder.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized === '' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    return null;
  }
  return normalized;
}
