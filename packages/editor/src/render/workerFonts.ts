/**
 * Font provisioning for the render worker.
 *
 * A dedicated worker has its own `FontFaceSet`. `@font-face` rules declared in
 * the document's stylesheets — every bundled `@fontsource` family — are not
 * visible in it, and neither is anything added to `document.fonts`. So a frame
 * the worker draws resolves those families to whatever the platform happens to
 * substitute, while the identical frame on the main thread draws them
 * correctly. Same document, same IR, different typography, decided by which
 * path the frame took.
 *
 * This module harvests the document's declared faces so the worker can load
 * the same ones, and gives the render pipeline a synchronous answer to "does
 * the worker have the faces this frame needs yet?" — synchronous because an
 * asynchronous refusal lands after the frame has already chosen its branch
 * (see the render-pipeline invariant on reusing already-painted pixels).
 */

/** One `@font-face` rule, reduced to what a worker needs to reconstruct it. */
export interface WorkerFontFace {
  family: string;
  source: string;
  weight?: string;
  style?: string;
  stretch?: string;
  unicodeRange?: string;
}

/**
 * Read the document's `@font-face` rules.
 *
 * Cross-origin stylesheets throw on `cssRules` and are skipped: their faces
 * cannot be re-declared from here anyway. Data and blob sources are kept —
 * they are self-contained and work verbatim in a worker.
 */
export function harvestDocumentFontFaces(): WorkerFontFace[] {
  if (typeof document === 'undefined') return [];
  const faces: WorkerFontFace[] = [];
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // opaque cross-origin sheet
    }
    for (const rule of Array.from(rules)) {
      if (!isFontFaceRule(rule)) continue;
      const style = rule.style;
      const family = unquote(style.getPropertyValue('font-family').trim());
      const source = style.getPropertyValue('src').trim();
      if (!family || !source) continue;
      const absolute = absolutizeSources(source, sheet.href);
      const face: WorkerFontFace = {
        family,
        source: absolute,
        weight: style.getPropertyValue('font-weight').trim() || undefined,
        style: style.getPropertyValue('font-style').trim() || undefined,
        stretch: style.getPropertyValue('font-stretch').trim() || undefined,
        unicodeRange: style.getPropertyValue('unicode-range').trim() || undefined,
      };
      const key = faceKey(face);
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push(face);
    }
  }
  return faces;
}

function isFontFaceRule(rule: CSSRule): rule is CSSFontFaceRule {
  // `CSSFontFaceRule` is not defined in every realm this module is parsed in,
  // so identify by shape rather than by `instanceof`.
  return (
    typeof (rule as CSSFontFaceRule).style?.getPropertyValue === 'function' &&
    (rule as CSSFontFaceRule).style.getPropertyValue('src') !== ''
  );
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

/**
 * Rewrite relative `url()` sources against the stylesheet that declared them.
 *
 * The worker resolves relative URLs against its own script URL, which is a
 * different directory — the font would 404 and the family would silently stay
 * unavailable.
 */
function absolutizeSources(source: string, sheetHref: string | null): string {
  const base = sheetHref ?? (typeof location !== 'undefined' ? location.href : undefined);
  if (!base) return source;
  return source.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, url: string) => {
    if (/^(data:|blob:|https?:|\/\/)/.test(url)) return match;
    try {
      return `url(${quote}${new URL(url, base).href}${quote})`;
    } catch {
      return match;
    }
  });
}

function faceKey(face: WorkerFontFace): string {
  return [face.family, face.weight, face.style, face.stretch, face.unicodeRange, face.source].join(
    '|',
  );
}

/**
 * Identity of a face set. The worker echoes this back once it has finished
 * loading, which is what lets the pipeline compare the two realms without
 * asking the worker anything at frame time.
 */
export function fontFaceSetKey(faces: readonly WorkerFontFace[]): string {
  if (faces.length === 0) return 'fonts:none';
  let hash = 0;
  for (const face of faces) {
    const key = faceKey(face);
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash |= 0;
    }
  }
  return `fonts:${faces.length}:${hash}`;
}

/**
 * Load faces into the current realm's `FontFaceSet`.
 *
 * Used by the worker. A face that fails to load is skipped rather than
 * failing the batch: one unreachable payload must not cost the document every
 * other family.
 */
export async function adoptFontFaces(faces: readonly WorkerFontFace[]): Promise<void> {
  const set = (globalThis as { fonts?: FontFaceSet }).fonts;
  if (!set || typeof FontFace === 'undefined') return;
  await Promise.all(
    faces.map(async (face) => {
      try {
        const descriptors: FontFaceDescriptors = {};
        if (face.weight) descriptors.weight = face.weight;
        if (face.style) descriptors.style = face.style;
        if (face.stretch) descriptors.stretch = face.stretch;
        if (face.unicodeRange) descriptors.unicodeRange = face.unicodeRange;
        const loaded = await new FontFace(face.family, face.source, descriptors).load();
        set.add(loaded);
      } catch {
        // Unreachable or undecodable payload — the family stays on fallback in
        // this realm, which the readiness key cannot express per-family. The
        // batch still completes so the rest of the document is correct.
      }
    }),
  );
}

/**
 * Whether a document contains text that depends on a declared web face.
 *
 * Only such text can differ between realms, so only such text needs to hold
 * the worker back. A document whose text uses system families renders
 * identically either way and keeps the worker fast path.
 */
export function documentNeedsWorkerFonts(
  doc: { nodes: Record<string, { kind: string; fontFamily?: string; richText?: unknown }> },
  declaredFamilies: ReadonlySet<string>,
): boolean {
  if (declaredFamilies.size === 0) return false;
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;
    if (node.fontFamily && declaredFamilies.has(node.fontFamily)) return true;
    const paragraphs = (
      node.richText as
        | { paragraphs?: Array<{ runs: Array<{ format?: { fontFamily?: string } }> }> }
        | undefined
    )?.paragraphs;
    for (const paragraph of paragraphs ?? []) {
      for (const run of paragraph.runs) {
        if (run.format?.fontFamily && declaredFamilies.has(run.format.fontFamily)) return true;
      }
    }
  }
  return false;
}
