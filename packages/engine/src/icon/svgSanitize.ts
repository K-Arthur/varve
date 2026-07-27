/**
 * SVG sanitization for untrusted icon content.
 *
 * All imported and downloaded SVG is treated as untrusted. This module walks
 * the parsed element tree (from the string-based XML parser in @strata/import)
 * and strips or rejects anything that could execute code, exfiltrate data, or
 * cause denial-of-service.
 *
 * Design goals:
 * - No <script>, event handlers, foreignObject, or external resource loads.
 * - No javascript: or data: URL exploits.
 * - Resource limits on point counts, nesting depth, and attribute sizes.
 * - Deterministic output for the same input (stable for caching/hashing).
 *
 * Research basis: DOMPurify SVG handling, OWASP XSS Prevention (SVG category),
 * Iconify loader sanitization, SVG spec §13 (Scripting and Interactivity).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NESTING_DEPTH = 32;
const MAX_PATH_COMMANDS = 10_000;
const MAX_TOTAL_ELEMENTS = 5_000;
const MAX_ATTRIBUTE_LENGTH = 4_096;
const MAX_COORDINATE_VALUE = 1_000_000;
const _MAX_VIEWBOX_DIMENSION = 10_000;

/** Clamp a coordinate value to the safe range. */
function _clampCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_COORDINATE_VALUE, Math.min(MAX_COORDINATE_VALUE, value));
}

/** Elements that are always removed with their entire subtree. */
const DANGEROUS_TAGS = new Set([
  'script',
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
  'discard',
  'foreignObject',
  'style',
  'audio',
  'video',
  'iframe',
  'embed',
  'object',
  'portal',
]);

/** Attributes that are always removed (event handlers, etc.). */
const DANGEROUS_ATTR_PREFIXES = ['on'];

const DANGEROUS_ATTR_NAMES = new Set([
  'onbegin',
  'onend',
  'onrepeat',
  'onload',
  'onerror',
  'onclick',
  'onmouseover',
  'onmouseout',
  'onmousedown',
  'onmouseup',
  'onmousemove',
  'onfocus',
  'onblur',
  'onkeydown',
  'onkeyup',
  'onkeypress',
]);

/** Tags allowed in the sanitized SVG subset. */
const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'defs',
  'use',
  'symbol',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'image',
  'title',
  'desc',
  'metadata',
]);

/** Attributes allowed on any element (per-element below further restricts). */
const COMMON_ALLOWED_ATTRS = new Set([
  'id',
  'class',
  'transform',
  'style',
  'clip-path',
  'clip-rule',
  'mask',
  'opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
]);

const GEOMETRY_ALLOWED_ATTRS: Record<string, Set<string>> = {
  svg: new Set([
    'xmlns',
    'viewBox',
    'width',
    'height',
    'preserveAspectRatio',
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-opacity',
    'stroke-width',
  ]),
  path: new Set(['d', 'pathLength']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  polygon: new Set(['points']),
  polyline: new Set(['points']),
  g: new Set([]),
  defs: new Set([]),
  use: new Set(['href', 'xlink:href', 'x', 'y', 'width', 'height']),
  symbol: new Set(['viewBox', 'preserveAspectRatio']),
  clipPath: new Set(['clipPathUnits']),
  mask: new Set(['maskUnits', 'maskContentUnits', 'x', 'y', 'width', 'height']),
  linearGradient: new Set([
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'x1',
    'y1',
    'x2',
    'y2',
    'href',
    'xlink:href',
  ]),
  radialGradient: new Set([
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'cx',
    'cy',
    'r',
    'fx',
    'fy',
    'href',
    'xlink:href',
  ]),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  image: new Set(['href', 'xlink:href', 'x', 'y', 'width', 'height', 'preserveAspectRatio']),
  title: new Set([]),
  desc: new Set([]),
  metadata: new Set([]),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SanitizeOptions {
  /** Max nesting depth (default 32). */
  maxNestingDepth?: number;
  /** Max total elements in the tree (default 5000). */
  maxTotalElements?: number;
  /** Max path commands in a single <path> (default 10000). */
  maxPathCommands?: number;
  /** Allow <image> elements with href (default false for safety). */
  allowImages?: boolean;
  /** Allow <use> references (default true). */
  allowUse?: boolean;
  /** Allow gradient elements (default true). */
  allowGradients?: boolean;
  /** Allow clipPath/mask (default true). */
  allowClipMask?: boolean;
  /** Strip <title> and <desc> (default false — keep for accessibility). */
  stripAccessibility?: boolean;
}

export interface SanitizeResult {
  /** Sanitized SVG string. */
  svg: string;
  /** True if the SVG was modified during sanitization. */
  modified: boolean;
  /** Warnings about what was removed or modified. */
  warnings: SanitizeWarning[];
}

export interface SanitizeWarning {
  code: SanitizeWarningCode;
  message: string;
}

export type SanitizeWarningCode =
  | 'removed-dangerous-tag'
  | 'removed-event-handler'
  | 'removed-external-href'
  | 'removed-disallowed-tag'
  | 'removed-disallowed-attr'
  | 'removed-external-url'
  | 'trimmed-viewbox'
  | 'path-command-limit'
  | 'nesting-depth-limit'
  | 'element-count-limit'
  | 'attribute-length-truncated'
  | 'removed-data-url'
  | 'removed-javascript-url'
  | 'removed-style-element';

export class SanitizeError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'SanitizeError';
  }
}

// Parsed element shape (matches @strata/import svg/shared ParsedElement).
interface ParsedElement {
  tag: string;
  attrs: Record<string, string>;
  children: ParsedElement[];
  textContent: string;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

function isDangerousUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:')) return true;
  if (trimmed.startsWith('vbscript:')) return true;
  if (trimmed.startsWith('data:text/html')) return true;
  if (trimmed.startsWith('data:image/svg+xml')) return true; // nested SVG in data URL
  return false;
}

function isExternalUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('ftp://')
  );
}

// ---------------------------------------------------------------------------
// Attribute sanitization
// ---------------------------------------------------------------------------

function sanitizeAttrValue(
  key: string,
  value: string,
  tag: string,
  warnings: SanitizeWarning[],
): string | null {
  // Reject dangerous URLs in any attribute
  if (isDangerousUrl(value)) {
    warnings.push({
      code: 'removed-javascript-url',
      message: `Removed attribute "${key}" with javascript: URL`,
    });
    return null;
  }

  // Check URL-bearing attributes for external references
  if ((key === 'href' || key === 'xlink:href') && isExternalUrl(value) && tag !== 'image') {
    // External href in <use> — dangerous, could pull remote SVG
    if (tag === 'use') {
      warnings.push({
        code: 'removed-external-href',
        message: `Removed external href in <use>: ${value.slice(0, 60)}`,
      });
      return null;
    }
  }

  if (key === 'href' || key === 'xlink:href') {
    if (tag === 'image' && isExternalUrl(value)) {
      warnings.push({
        code: 'removed-external-url',
        message: `Removed external image reference: ${value.slice(0, 60)}`,
      });
      return null;
    }
  }

  // Truncate excessively long attributes
  if (value.length > MAX_ATTRIBUTE_LENGTH) {
    warnings.push({
      code: 'attribute-length-truncated',
      message: `Truncated attribute "${key}" from ${value.length} to ${MAX_ATTRIBUTE_LENGTH} chars`,
    });
    return value.slice(0, MAX_ATTRIBUTE_LENGTH);
  }

  return value;
}

function isAttrAllowed(key: string, tag: string): boolean {
  // Reject event handlers
  const lower = key.toLowerCase();
  if (DANGEROUS_ATTR_NAMES.has(lower)) return false;
  if (DANGEROUS_ATTR_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;

  // Reject SVG imports/expressions in style
  if (key === 'style') return true; // inline styles allowed, we keep simple ones

  const allowedForTag = GEOMETRY_ALLOWED_ATTRS[tag];
  if (allowedForTag) {
    return allowedForTag.has(key) || COMMON_ALLOWED_ATTRS.has(key);
  }

  // For unknown tags, only allow common attrs
  return COMMON_ALLOWED_ATTRS.has(key);
}

// ---------------------------------------------------------------------------
// Element sanitization
// ---------------------------------------------------------------------------

interface SanitizeContext {
  depth: number;
  elementCount: number;
  warnings: SanitizeWarning[];
  options: Required<SanitizeOptions>;
  modified: boolean;
}

function sanitizeElement(el: ParsedElement, ctx: SanitizeContext): ParsedElement | null {
  // Check nesting depth
  if (ctx.depth > ctx.options.maxNestingDepth) {
    ctx.warnings.push({
      code: 'nesting-depth-limit',
      message: `Stopped at nesting depth ${ctx.depth} (max ${ctx.options.maxNestingDepth})`,
    });
    ctx.modified = true;
    return null;
  }

  // Check total element count
  ctx.elementCount++;
  if (ctx.elementCount > ctx.options.maxTotalElements) {
    ctx.warnings.push({
      code: 'element-count-limit',
      message: `Stopped at ${ctx.elementCount} elements (max ${ctx.options.maxTotalElements})`,
    });
    ctx.modified = null as unknown as boolean; // signal hard stop
    return null;
  }

  // SVG tag names are case-sensitive — do NOT lowercase.
  const tag = el.tag;

  // Remove dangerous tags entirely
  if (DANGEROUS_TAGS.has(tag)) {
    ctx.warnings.push({
      code: 'removed-dangerous-tag',
      message: `Removed <${tag}>`,
    });
    ctx.modified = true;
    return null;
  }

  // Remove disallowed tags (but keep children for container-like ones)
  if (!ALLOWED_TAGS.has(tag)) {
    ctx.warnings.push({
      code: 'removed-disallowed-tag',
      message: `Removed <${tag}>, kept children`,
    });
    ctx.modified = true;
    // For unknown container tags, keep children
    if (el.children.length > 0) {
      const children = sanitizeChildren(el.children, ctx);
      if (children.length === 1) return children[0]!;
      if (children.length > 1) {
        return { tag: 'g', attrs: {}, children, textContent: '' };
      }
      return null;
    }
    return null;
  }

  // Conditional removals based on options
  if (tag === 'image' && !ctx.options.allowImages) {
    ctx.warnings.push({
      code: 'removed-disallowed-tag',
      message: 'Removed <image> (allowImages=false)',
    });
    ctx.modified = true;
    return null;
  }
  if (tag === 'use' && !ctx.options.allowUse) {
    ctx.warnings.push({
      code: 'removed-disallowed-tag',
      message: 'Removed <use> (allowUse=false)',
    });
    ctx.modified = true;
    return null;
  }
  if ((tag === 'linearGradient' || tag === 'radialGradient') && !ctx.options.allowGradients) {
    ctx.warnings.push({
      code: 'removed-disallowed-tag',
      message: `Removed <${tag}> (allowGradients=false)`,
    });
    ctx.modified = true;
    return null;
  }
  if ((tag === 'clipPath' || tag === 'mask') && !ctx.options.allowClipMask) {
    ctx.warnings.push({
      code: 'removed-disallowed-tag',
      message: `Removed <${tag}> (allowClipMask=false)`,
    });
    ctx.modified = true;
    return null;
  }
  if ((tag === 'title' || tag === 'desc') && ctx.options.stripAccessibility) {
    ctx.modified = true;
    return null;
  }

  // Sanitize attributes
  const cleanAttrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(el.attrs)) {
    if (!isAttrAllowed(key, tag)) {
      ctx.warnings.push({
        code: 'removed-disallowed-attr',
        message: `Removed attribute "${key}" from <${tag}>`,
      });
      ctx.modified = true;
      continue;
    }
    const cleanValue = sanitizeAttrValue(key, value, tag, ctx.warnings);
    if (cleanValue !== null) {
      cleanAttrs[key] = cleanValue;
    } else {
      ctx.modified = true;
    }
  }

  // Check path command limits
  if (tag === 'path') {
    const d = cleanAttrs.d ?? '';
    const cmdCount = (d.match(/[MLHVCSQTAZmlhvcsqtaz]/g) ?? []).length;
    if (cmdCount > ctx.options.maxPathCommands) {
      ctx.warnings.push({
        code: 'path-command-limit',
        message: `Path has ${cmdCount} commands (max ${ctx.options.maxPathCommands})`,
      });
      ctx.modified = true;
      // Truncate path data — remove commands beyond limit
      cleanAttrs.d = truncatePathCommands(d, ctx.options.maxPathCommands);
    }
  }

  // Sanitize children
  const children = sanitizeChildren(el.children, ctx);

  return {
    tag,
    attrs: cleanAttrs,
    children,
    textContent: el.textContent,
  };
}

function sanitizeChildren(children: ParsedElement[], ctx: SanitizeContext): ParsedElement[] {
  const result: ParsedElement[] = [];
  for (const child of children) {
    const childCtx: SanitizeContext = { ...ctx, depth: ctx.depth + 1 };
    const sanitized = sanitizeElement(child, childCtx);
    // Propagate mutation/count flags back to parent context
    ctx.elementCount = childCtx.elementCount;
    if (childCtx.modified) ctx.modified = true;
    if (sanitized === null) {
      // Check if this was a hard stop (element count limit)
      if (ctx.elementCount > ctx.options.maxTotalElements) {
        return result;
      }
      continue;
    }
    result.push(sanitized);
  }
  return result;
}

function truncatePathCommands(d: string, max: number): string {
  let count = 0;
  let result = '';
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let m: RegExpExecArray | null;
  m = re.exec(d);
  while (m !== null && count < max) {
    result += m[0];
    count++;
    m = re.exec(d);
  }
  // Close path if it was open
  if (!result.endsWith('Z') && !result.endsWith('z')) {
    result += 'Z';
  }
  return result;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeElement(el: ParsedElement, indent: number): string {
  const pad = '  '.repeat(indent);
  const attrStr = Object.entries(el.attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');

  const openTag = attrStr ? `<${el.tag} ${attrStr}>` : `<${el.tag}>`;

  if (el.children.length === 0 && !el.textContent) {
    return `${pad}<${el.tag}${attrStr ? ` ${attrStr}` : ''} />`;
  }

  if (el.children.length === 0) {
    return `${pad}${openTag}${escapeText(el.textContent)}</${el.tag}>`;
  }

  const childStr = el.children.map((c) => serializeElement(c, indent + 1)).join('\n');
  return `${pad}${openTag}\n${childStr}\n${pad}</${el.tag}>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// XML parsing (reuse from import)
// ---------------------------------------------------------------------------

function parseXml(xml: string): ParsedElement | null {
  const trimmed = xml.trim();
  return parseElement(trimmed, 0)?.el ?? null;
}

function parseElement(xml: string, start: number): { el: ParsedElement; endPos: number } | null {
  const info = nextTagInfo(xml, start);
  if (!info || info.type === 'close') return null;

  if (info.type === 'selfclose') {
    return {
      el: { tag: info.tag, attrs: info.attrs, children: [], textContent: '' },
      endPos: info.contentStart,
    };
  }

  const children: ParsedElement[] = [];
  let pos = info.contentStart;

  // Raw-text elements: content is taken verbatim until the closing tag.
  const rawTextTags = new Set(['style', 'script', 'title', 'desc']);
  const isRawText = rawTextTags.has(info.tag);

  if (isRawText) {
    const closeTag = `</${info.tag}>`;
    const closeIdx = xml.indexOf(closeTag, pos);
    if (closeIdx >= 0) {
      const textContent = xml.slice(pos, closeIdx);
      return {
        el: { tag: info.tag, attrs: info.attrs, children: [], textContent },
        endPos: closeIdx + closeTag.length,
      };
    }
  }

  while (pos < xml.length) {
    const childInfo = nextTagInfo(xml, pos);
    if (!childInfo) {
      const nextTag = xml.indexOf('<', pos);
      if (nextTag < 0) break;
      pos = nextTag;
      continue;
    }

    if (childInfo.type === 'close' && childInfo.tag === info.tag) {
      const innerText = xml.slice(info.contentStart, childInfo.contentStart);
      const textContent = innerText.replace(/<[^>]*>/g, '').trim();
      return {
        el: { tag: info.tag, attrs: info.attrs, children, textContent },
        endPos: childInfo.contentStart,
      };
    }

    const childResult = parseElement(xml, pos);
    if (childResult) {
      children.push(childResult.el);
      pos = childResult.endPos;
    } else {
      pos = xml.indexOf('<', pos + 1);
      if (pos < 0) break;
    }
  }

  return {
    el: { tag: info.tag, attrs: info.attrs, children, textContent: '' },
    endPos: xml.length,
  };
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  m = re.exec(attrStr);
  while (m !== null) {
    attrs[m[1]!] = m[2] ?? m[3] ?? '';
    m = re.exec(attrStr);
  }
  return attrs;
}

interface TagInfo {
  type: 'open' | 'close' | 'selfclose';
  tag: string;
  attrs: Record<string, string>;
  contentStart: number;
  endPos: number;
}

function nextTagInfo(xml: string, start: number): TagInfo | null {
  let pos = start;
  while (pos < xml.length && xml[pos] === ' ') pos++;
  if (pos >= xml.length || xml[pos] !== '<') return null;

  if (xml.startsWith('<!--', pos)) {
    const end = xml.indexOf('-->', pos + 4);
    if (end < 0) return null;
    return nextTagInfo(xml, end + 3);
  }

  // Skip XML declaration and DOCTYPE
  if (xml.startsWith('<?xml', pos)) {
    const end = xml.indexOf('?>', pos);
    if (end < 0) return null;
    return nextTagInfo(xml, end + 2);
  }
  if (xml.startsWith('<!DOCTYPE', pos) || xml.startsWith('<!doctype', pos)) {
    const end = xml.indexOf('>', pos);
    if (end < 0) return null;
    return nextTagInfo(xml, end + 1);
  }

  const isClose = xml[pos + 1] === '/';
  const nameStart = isClose ? pos + 2 : pos + 1;
  if (nameStart >= xml.length) return null;

  let nameEnd = nameStart;
  while (nameEnd < xml.length && /[\w:-]/.test(xml[nameEnd]!)) nameEnd++;
  if (nameEnd === nameStart) return null;

  const tag = xml.slice(nameStart, nameEnd);

  let inQuote: string | null = null;
  let endPos = nameEnd;
  let selfClose = false;
  let prevChar = '';

  while (endPos < xml.length) {
    const ch = xml[endPos]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '>') {
      if (prevChar === '/') selfClose = true;
      break;
    }
    prevChar = ch;
    endPos++;
  }

  if (endPos >= xml.length) return null;

  const attrStr = xml.slice(nameEnd, selfClose ? endPos - 1 : endPos).trim();
  const attrs = parseAttrs(attrStr);
  const contentStart = endPos + 1;

  return {
    type: isClose ? 'close' : selfClose ? 'selfclose' : 'open',
    tag,
    attrs,
    contentStart,
    endPos,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  maxNestingDepth: MAX_NESTING_DEPTH,
  maxTotalElements: MAX_TOTAL_ELEMENTS,
  maxPathCommands: MAX_PATH_COMMANDS,
  allowImages: false,
  allowUse: true,
  allowGradients: true,
  allowClipMask: true,
  stripAccessibility: false,
};

/**
 * Sanitize an SVG string, removing dangerous content.
 *
 * @param svg - Raw SVG string (untrusted).
 * @param options - Optional limits and feature flags.
 * @returns Sanitized SVG string, modification flag, and warnings.
 * @throws SanitizeError if the SVG is fundamentally malformed.
 */
export function sanitizeSvg(svg: string, options: SanitizeOptions = {}): SanitizeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: SanitizeWarning[] = [];

  if (!svg?.trim()) {
    throw new SanitizeError('Empty SVG input', 'empty-input');
  }

  const parsed = parseXml(svg);
  if (!parsed) {
    throw new SanitizeError('Failed to parse SVG XML', 'parse-error');
  }

  const ctx: SanitizeContext = {
    depth: 0,
    elementCount: 0,
    warnings,
    options: opts,
    modified: false,
  };

  const clean = sanitizeElement(parsed, ctx);

  if (!clean) {
    throw new SanitizeError('SVG root element was removed during sanitization', 'root-removed');
  }

  const result = serializeElement(clean, 0);

  return {
    svg: result,
    modified: ctx.modified,
    warnings,
  };
}

/**
 * Quick check if SVG contains dangerous content.
 * Returns true if the SVG is safe (no dangerous content detected).
 */
export function isSvgSafe(svg: string): boolean {
  try {
    const result = sanitizeSvg(svg, { allowImages: false });
    return result.warnings.length === 0;
  } catch {
    return false;
  }
}

/**
 * Normalize viewBox to a standard 24x24 grid if the SVG has no explicit viewBox
 * or has width/height only.
 */
export function normalizeViewBox(svg: string, targetSize = 24): SanitizeResult {
  const result = sanitizeSvg(svg);
  // If the SVG lacks a viewBox, add one
  if (!result.svg.includes('viewBox=')) {
    result.svg = result.svg.replace('<svg', `<svg viewBox="0 0 ${targetSize} ${targetSize}"`);
    result.modified = true;
    result.warnings.push({
      code: 'trimmed-viewbox',
      message: `Added viewBox="0 0 ${targetSize} ${targetSize}"`,
    });
  }
  return result;
}

/**
 * Convert all fill/stroke colors in an SVG to currentColor for theme inheritance.
 */
export function applyCurrentColor(svg: string): SanitizeResult {
  const result = sanitizeSvg(svg);
  // Replace fill and stroke attributes that have concrete color values
  result.svg = result.svg
    .replace(/fill="(?!none|currentColor)([^"]+)"/gi, 'fill="currentColor"')
    .replace(/stroke="(?!none|currentColor)([^"]+)"/gi, 'stroke="currentColor"');
  result.modified = true;
  return result;
}
