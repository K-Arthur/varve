/**
 * SVG sanitization for untrusted icon content.
 *
 * All imported and downloaded SVG is treated as untrusted. This module walks
 * the parsed element tree (from the string-based XML parser in @varve/import)
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
/** Maximum raw SVG input size accepted before parsing (default 1 MiB). */
const MAX_INPUT_SIZE = 1_048_576;
/** Maximum absolute value accepted for numeric geometry attributes. */
const MAX_NUMERIC_VALUE = 1_000_000;

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
  | 'removed-style-element'
  | 'removed-style-declaration'
  | 'removed-use-cycle'
  | 'removed-non-finite-number'
  | 'input-too-large';

export class SanitizeError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'SanitizeError';
  }
}

// Parsed element shape (matches @varve/import svg/shared ParsedElement).
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
  if (trimmed.startsWith('data:')) return true; // all data: URLs — no exceptions
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

/**
 * Check a CSS-ish value for external or data references: `url(http://…)`,
 * `url(data:…)`, or `url(//…)`. Used for attributes such as clip-path,
 * mask, fill, and stroke that may carry url() paint servers.
 */
function hasExternalUrlRef(value: string): boolean {
  const re = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let m: RegExpExecArray | null;
  m = re.exec(value);
  while (m !== null) {
    const ref = (m[1] ?? '').trim().toLowerCase();
    if (ref === '#' || ref.startsWith('#')) {
      m = re.exec(value);
      continue;
    }
    if (
      ref.startsWith('http://') ||
      ref.startsWith('https://') ||
      ref.startsWith('//') ||
      ref.startsWith('data:')
    ) {
      return true;
    }
    m = re.exec(value);
  }
  return false;
}

/** Numeric geometry attributes that must be finite and bounded. */
const NUMERIC_ATTRS = new Set([
  'x',
  'y',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'fx',
  'fy',
  'offset',
  'stroke-width',
  'stroke-opacity',
  'fill-opacity',
  'opacity',
  'x1',
  'y1',
  'x2',
  'y2',
]);

function isFiniteNumber(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  // Gradient stop offsets are commonly percentages ("50%") — allow one
  // trailing percent sign.
  const numericPart = trimmed.endsWith('%') ? trimmed.slice(0, -1) : trimmed;
  if (numericPart === '') return false;
  return Number.isFinite(Number(numericPart));
}

/** Inline style declarations allowed to survive sanitization. */
const STYLE_PROPERTY_ALLOWLIST = new Set([
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
  'opacity',
  'vector-effect',
  'color',
  'mix-blend-mode',
  'filter',
  'clip-path',
]);

const STYLE_PROPERTY_BLOCKLIST = new Set([
  'behavior',
  '-moz-binding',
  'position',
  'z-index',
  'pointer-events',
  'display',
  'visibility',
  'overflow',
  'transform',
  'transition',
  'animation',
  'background',
  'background-image',
  'cursor',
  'content',
  'clip',
  'top',
  'left',
  'right',
  'bottom',
  'width',
  'height',
  'margin',
  'padding',
  'border',
  'font-family',
  'font',
  'text-anchor',
  'white-space',
]);

/** Allowed SVG `filter` attribute values (built-in keywords only). */
const FILTER_FUNCTION_ALLOWLIST = new Set([
  'blur',
  'brightness',
  'contrast',
  'drop-shadow',
  'grayscale',
  'hue-rotate',
  'invert',
  'opacity',
  'saturate',
  'sepia',
  'url',
  'none',
]);

/**
 * Sanitize an inline style attribute. Declarations that reference external
 * resources (`url(...)`), use blocked properties, or contain suspicious
 * characters are removed; the rest survive.
 */
function sanitizeStyleDeclarations(style: string, warnings: SanitizeWarning[]): string {
  const declarations = style.split(';');
  const kept: string[] = [];
  for (const decl of declarations) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (prop === '' || value === '') continue;
    if (STYLE_PROPERTY_BLOCKLIST.has(prop)) {
      warnings.push({
        code: 'removed-style-declaration',
        message: `Removed style declaration "${prop}"`,
      });
      continue;
    }
    if (!STYLE_PROPERTY_ALLOWLIST.has(prop)) {
      warnings.push({
        code: 'removed-style-declaration',
        message: `Removed unknown style declaration "${prop}"`,
      });
      continue;
    }
    if (hasExternalUrlRef(value)) {
      warnings.push({
        code: 'removed-style-declaration',
        message: `Removed style declaration "${prop}" with external url() reference`,
      });
      continue;
    }
    if (prop === 'filter') {
      const fn = value.split('(')[0]?.trim().toLowerCase() ?? '';
      if (!FILTER_FUNCTION_ALLOWLIST.has(fn)) {
        warnings.push({
          code: 'removed-style-declaration',
          message: `Removed style declaration "filter: ${value}"`,
        });
        continue;
      }
    }
    kept.push(`${prop}:${value}`);
  }
  return kept.join(';');
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
      code: 'removed-data-url',
      message: `Removed attribute "${key}" with data: URL`,
    });
    return null;
  }

  // Numeric geometry attributes must be finite and bounded
  if (NUMERIC_ATTRS.has(key)) {
    if (!isFiniteNumber(value)) {
      warnings.push({
        code: 'removed-non-finite-number',
        message: `Removed non-finite number in attribute "${key}"`,
      });
      return null;
    }
    const num = Number(value.trim());
    if (Math.abs(num) > MAX_NUMERIC_VALUE) {
      warnings.push({
        code: 'removed-non-finite-number',
        message: `Removed out-of-range number in attribute "${key}"`,
      });
      return null;
    }
  }

  // url() paint-server references (clip-path, mask, fill, stroke) must be
  // internal fragment references only
  if (
    (key === 'clip-path' || key === 'mask' || key === 'fill' || key === 'stroke') &&
    hasExternalUrlRef(value)
  ) {
    warnings.push({
      code: 'removed-external-url',
      message: `Removed external url() reference in attribute "${key}"`,
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

  // Sanitize inline styles
  if (key === 'style') {
    const clean = sanitizeStyleDeclarations(value, warnings);
    return clean;
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
  /** Hard stop: resource limit exceeded — stop processing entirely. */
  stopped: boolean;
  /** Symbol ids that are part of a recursive <use>/<symbol> cycle. */
  cyclicSymbolIds: Set<string>;
}

/**
 * Find symbol ids involved in recursive <use> reference cycles.
 * Builds a graph symbol -> referenced symbol ids (transitive use targets)
 * and returns every symbol that can reach itself.
 */
function findCyclicSymbolIds(root: ParsedElement): Set<string> {
  const symbols = new Map<string, ParsedElement>();
  const walkCollect = (el: ParsedElement): void => {
    if (el.tag === 'symbol' && el.attrs.id) symbols.set(el.attrs.id, el);
    for (const child of el.children) walkCollect(child);
  };
  walkCollect(root);

  const collectUseTargets = (el: ParsedElement, targets: Set<string>): void => {
    if (el.tag === 'use') {
      const href = el.attrs.href ?? el.attrs['xlink:href'] ?? '';
      const ref = href.trim().replace(/^#/, '');
      if (ref) targets.add(ref);
    }
    for (const child of el.children) collectUseTargets(child, targets);
  };

  const edges = new Map<string, Set<string>>();
  for (const [id, el] of symbols) {
    const targets = new Set<string>();
    collectUseTargets(el, targets);
    edges.set(id, targets);
  }

  const cyclic = new Set<string>();
  for (const id of symbols.keys()) {
    const visited = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const next of edges.get(cur) ?? []) {
        if (next === id) {
          cyclic.add(id);
          stack.length = 0;
          break;
        }
        if (!visited.has(next) && symbols.has(next)) stack.push(next);
      }
    }
  }
  return cyclic;
}

function sanitizeElement(el: ParsedElement, ctx: SanitizeContext): ParsedElement | null {
  if (ctx.stopped) return null;

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
    ctx.modified = true;
    ctx.stopped = true; // signal hard stop
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

  // Detect recursive <use>/<symbol> reference cycles (pre-computed graph).
  if (tag === 'use') {
    const href = el.attrs.href ?? el.attrs['xlink:href'] ?? '';
    const refId = href.trim().replace(/^#/, '');
    if (refId && ctx.cyclicSymbolIds.has(refId)) {
      ctx.warnings.push({
        code: 'removed-use-cycle',
        message: `Removed <use> reference to cyclic symbol #${refId}`,
      });
      ctx.modified = true;
      return null;
    }
  }
  if (tag === 'symbol' && el.attrs.id && ctx.cyclicSymbolIds.has(el.attrs.id)) {
    ctx.warnings.push({
      code: 'removed-use-cycle',
      message: `Removed cyclic <symbol id="${el.attrs.id}">`,
    });
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

  // Validate svg viewBox: must be four finite numbers within bounds
  if (tag === 'svg' && cleanAttrs.viewBox !== undefined) {
    const parts = cleanAttrs.viewBox.trim().split(/[\s,]+/);
    const numeric = parts.map(Number);
    if (
      parts.length !== 4 ||
      numeric.some((n) => !Number.isFinite(n) || Math.abs(n) > MAX_NUMERIC_VALUE)
    ) {
      ctx.warnings.push({
        code: 'removed-non-finite-number',
        message: `Removed invalid viewBox "${cleanAttrs.viewBox}"`,
      });
      delete cleanAttrs.viewBox;
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
    if (ctx.stopped) break;
    const childCtx: SanitizeContext = { ...ctx, depth: ctx.depth + 1 };
    const sanitized = sanitizeElement(child, childCtx);
    // Propagate mutation/count flags back to parent context
    ctx.elementCount = childCtx.elementCount;
    if (childCtx.modified) ctx.modified = true;
    if (childCtx.stopped) ctx.stopped = true;
    if (sanitized === null) continue;
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
 * @throws SanitizeError if the SVG is fundamentally malformed or oversized.
 */
export function sanitizeSvg(svg: string, options: SanitizeOptions = {}): SanitizeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: SanitizeWarning[] = [];

  if (!svg?.trim()) {
    throw new SanitizeError('Empty SVG input', 'empty-input');
  }

  if (svg.length > MAX_INPUT_SIZE) {
    throw new SanitizeError(
      `SVG input is ${svg.length} bytes (max ${MAX_INPUT_SIZE})`,
      'input-too-large',
    );
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
    stopped: false,
    cyclicSymbolIds: findCyclicSymbolIds(parsed),
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
 * Rewrite all fragment ids (id attributes and #fragment references) with a
 * stable per-instance prefix. Prevents ID collisions when multiple icons are
 * inserted into one document.
 */
export function rewriteSvgIds(svg: string, prefix: string): SanitizeResult {
  const result = sanitizeSvg(svg);
  const safePrefix =
    prefix
      .replace(/[^a-z0-9-]/gi, '-')
      .toLowerCase()
      .slice(0, 24) || 'icon';

  let counter = 0;
  const idMap = new Map<string, string>();
  const rewritten = result.svg.replace(/\bid="([^"]+)"/g, (_match, id: string) => {
    const mapped = `${safePrefix}-${++counter}-${id.replace(/[^a-z0-9-_.]/gi, '')}`;
    idMap.set(id, mapped);
    return `id="${mapped}"`;
  });

  const withRefs = rewritten
    .replace(/(url\(\s*)#([^)\s"']+)/g, (_match, urlPrefix: string, refId: string) => {
      const mapped = idMap.get(refId);
      return mapped ? `${urlPrefix}#${mapped}` : `${urlPrefix}#${refId}`;
    })
    .replace(/\s(href|xlink:href)="#([^"]+)"/g, (_match, attr: string, refId: string) => {
      const mapped = idMap.get(refId);
      return mapped ? ` ${attr}="#${mapped}"` : ` ${attr}="#${refId}"`;
    });

  return {
    svg: withRefs,
    modified: result.modified || idMap.size > 0,
    warnings: result.warnings,
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
