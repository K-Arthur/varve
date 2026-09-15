/**
 * What an imported SVG is allowed to reference.
 *
 * SVG is active document content from an untrusted file, and its `<image>`
 * href is the one place where a purely declarative-looking attribute turns
 * into a network request. Varve's SVG parser never injects markup into the
 * DOM — it walks the XML and builds scene nodes — so `<script>` and inline
 * event handlers cannot execute. A remote href is different: it survives
 * parsing as an image fill `src`, and the renderer's image cache loads any
 * non-inline source with `new Image()`. That turns opening a file someone
 * sent you into a silent outbound request carrying the referrer and whatever
 * identifier the URL encodes, which is a tracking beacon and a plausible
 * exfiltration channel.
 *
 * The policy is therefore: inline the bytes the file actually carries, and
 * refuse to fetch anything else. `data:` images are self-contained and become
 * managed assets. Everything else — http(s), protocol-relative, file paths,
 * and script-bearing schemes — is dropped, and the reason is recorded so the
 * import report can tell the user what was lost rather than leaving a
 * mysteriously empty rectangle.
 *
 * `/try` additionally has `img-src 'self' data: blob:` in its CSP, which
 * would block a remote load anyway. Desktop and the ordinary web build have
 * no such backstop, which is why this has to be enforced in the parser.
 */

/** Only raster payloads that travel inside the file itself are honoured. */
const INLINE_IMAGE_PATTERN = /^data:image\//i;

/** Schemes that can execute or read local state if anything ever resolves them. */
const DANGEROUS_SCHEME_PATTERN = /^(?:javascript|vbscript|data:text\/html|file):/i;

export type SvgResourceDecision =
  | { allowed: true; href: string }
  | { allowed: false; reason: string; feature: string };

/**
 * Decide whether an `<image>` href may be carried into the scene.
 *
 * Returns the href to embed, or the reason it was refused. Callers record
 * the refusal on the import result's `unsupportedFeatures` so it reaches the
 * Import Results dialog.
 */
export function resolveSvgImageHref(rawHref: string): SvgResourceDecision {
  const href = rawHref.trim();

  if (href === '') {
    return {
      allowed: false,
      reason: '<image> has no href',
      feature: 'SVG image without a source',
    };
  }

  if (DANGEROUS_SCHEME_PATTERN.test(href)) {
    return {
      allowed: false,
      reason: `<image> href uses a disallowed scheme: ${schemeOf(href)}`,
      feature: 'SVG image with an executable or local-file href',
    };
  }

  if (INLINE_IMAGE_PATTERN.test(href)) {
    return { allowed: true, href };
  }

  if (/^data:/i.test(href)) {
    return {
      allowed: false,
      reason: '<image> data: URL does not carry an image payload',
      feature: 'SVG image with a non-image data URL',
    };
  }

  // Everything left is a reference Varve would have to go and fetch:
  // absolute URLs, protocol-relative "//host/x", and relative paths that
  // resolve against whatever origin the editor happens to be served from.
  return {
    allowed: false,
    reason: `<image> references an external resource, which is not fetched on import: ${truncate(href)}`,
    feature: 'SVG image referencing an external resource',
  };
}

/**
 * Constructs that the parser drops on the floor. They are inert — nothing is
 * ever inserted into the DOM — but a silent drop is indistinguishable from
 * corrupt output, so each one is named in the report.
 */
const REPORTED_DROPPED_TAGS: Record<string, string> = {
  script: 'SVG <script> (removed; imported artwork never executes script)',
  foreignObject: 'SVG <foreignObject> (HTML content is not imported)',
  style: 'SVG <style> element (CSS rules are not applied)',
  filter: 'SVG <filter> effects',
  pattern: 'SVG <pattern> fills',
  animate: 'SVG animation',
  animateTransform: 'SVG animation',
  animateMotion: 'SVG animation',
  set: 'SVG animation',
};

/** The report label for a dropped element, or null if it needs no mention. */
export function droppedElementFeature(tag: string): string | null {
  return REPORTED_DROPPED_TAGS[tag] ?? null;
}

function schemeOf(href: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  return match?.[1] ?? 'unknown';
}

function truncate(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
