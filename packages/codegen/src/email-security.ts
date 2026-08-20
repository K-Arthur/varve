import type { EmailLink, EmailTrackingParams } from '@varve/scene';

export interface EmailUrlResult {
  valid: boolean;
  value: string;
  reason?: string;
}

const ALLOWED_TAGS = new Set([
  'a',
  'br',
  'center',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'align',
  'alt',
  'border',
  'cellpadding',
  'cellspacing',
  'class',
  'colspan',
  'dir',
  'height',
  'href',
  'role',
  'rowspan',
  'src',
  'style',
  'target',
  'title',
  'valign',
  'width',
]);

const SAFE_CSS_PROPERTIES = new Set([
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-collapse',
  'border-radius',
  'border-top',
  'color',
  'display',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'letter-spacing',
  'line-height',
  'margin',
  'max-height',
  'max-width',
  'min-height',
  'opacity',
  'padding',
  'text-align',
  'text-decoration',
  'text-transform',
  'vertical-align',
  'width',
]);

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const TEMPLATE_TOKEN = /^(?:\{\{[A-Za-z][A-Za-z0-9_.-]*\}\}|\*\|[A-Z][A-Z0-9_.-]*\|\*)$/i;
const MAX_CUSTOM_HTML_LENGTH = 512_000;
const MAX_CUSTOM_CSS_LENGTH = 128_000;

function hasUnsafeCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export function validateEmailUrl(link: EmailLink): EmailUrlResult {
  const raw = link.url.trim();
  if (!raw || hasUnsafeCharacters(raw)) {
    return { valid: false, value: '', reason: 'URL is empty or contains control characters' };
  }

  if (link.kind === 'merge-tag') {
    if (!/^\*\|[A-Z0-9_.-]+\|\*(?:[?#][^\s]*)?$/i.test(raw)) {
      return { valid: false, value: '', reason: 'Merge-tag URL has an invalid shape' };
    }
    return { valid: true, value: raw };
  }

  // Provider-neutral and provider-specific merge tags are data placeholders,
  // not executable URLs. Permit them only as a complete token or as part of
  // an already-safe http(s) URL; never accept a token in a javascript/file
  // URL or an arbitrary template expression.
  if (TEMPLATE_TOKEN.test(raw)) return { valid: true, value: raw };

  if (link.kind === 'anchor') {
    return raw.startsWith('#') && /^#[A-Za-z][\w:.-]*$/.test(raw)
      ? { valid: true, value: raw }
      : { valid: false, value: '', reason: 'Anchor links must use a valid #fragment' };
  }

  const normalized =
    link.kind === 'email' && !/^mailto:/i.test(raw)
      ? `mailto:${raw}`
      : link.kind === 'tel' && !/^tel:/i.test(raw)
        ? `tel:${raw}`
        : raw;

  try {
    const parsed = new URL(normalized);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
      return { valid: false, value: '', reason: `Protocol ${parsed.protocol} is not allowed` };
    }
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
      return { valid: false, value: '', reason: 'Web URL has no hostname' };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, value: '', reason: 'Credential-bearing URLs are not allowed' };
    }
    return { valid: true, value: parsed.toString() };
  } catch {
    return { valid: false, value: '', reason: 'URL is malformed' };
  }
}

export function appendTrackingParams(url: string, tracking?: EmailTrackingParams): string {
  if (!tracking || !url || url.startsWith('#') || url.startsWith('*|')) return url;
  try {
    const parsed = new URL(url);
    const entries: Array<[string, string | undefined]> = [
      ['utm_source', tracking.source],
      ['utm_medium', tracking.medium],
      ['utm_campaign', tracking.campaign],
      ['utm_content', tracking.content],
      ['utm_term', tracking.term],
    ];
    for (const [key, value] of entries) {
      if (value && !parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function sanitizeStyle(value: string): string {
  if (/<|>|url\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i.test(value)) return '';
  return value
    .split(';')
    .map((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator <= 0) return '';
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const cssValue = declaration.slice(separator + 1).trim();
      return SAFE_CSS_PROPERTIES.has(property) && cssValue ? `${property}: ${cssValue}` : '';
    })
    .filter(Boolean)
    .join('; ');
}

export function sanitizeEmailCss(css: string): { css: string; removed: string[] } {
  const removed: string[] = [];
  if (css.length > MAX_CUSTOM_CSS_LENGTH) {
    return { css: '', removed: ['size-limit'] };
  }
  const withoutBlocks = css
    .replace(/<\/style/gi, '<\\/style')
    .replace(/@import[^;]+;?/gi, () => {
      removed.push('@import');
      return '';
    })
    .replace(/url\s*\([^)]*\)/gi, () => {
      removed.push('url()');
      return 'none';
    });

  const sanitized = withoutBlocks.replace(
    /([^{}]+)\{([^{}]*)\}/g,
    (_match, selector: string, body: string) => {
      if (/[<>]|javascript:|expression\s*\(/i.test(selector)) {
        removed.push('unsafe selector');
        return '';
      }
      const declarations = sanitizeStyle(body);
      if (!declarations) return '';
      return `${selector.trim()} { ${declarations}; }`;
    },
  );
  return { css: sanitized, removed };
}

function sanitizeAttribute(name: string, value: string): string | null {
  const lower = name.toLowerCase();
  if (!ALLOWED_ATTRIBUTES.has(lower) || /^on/i.test(lower)) return null;
  if (lower === 'style') {
    const style = sanitizeStyle(value);
    return style ? `style="${escapeAttribute(style)}"` : null;
  }
  if (lower === 'href') {
    const link: EmailLink = {
      kind: value.startsWith('mailto:') ? 'email' : value.startsWith('tel:') ? 'tel' : 'web',
      url: value,
    };
    const result = validateEmailUrl(link);
    return result.valid ? `href="${escapeAttribute(result.value)}"` : null;
  }
  if (lower === 'src') {
    if (!/^(?:https?:|data:image\/(?:png|jpe?g|gif|webp);base64:)/i.test(value.trim())) return null;
  }
  return `${lower}="${escapeAttribute(value)}"`;
}

export function sanitizeEmailHtml(html: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  if (html.length > MAX_CUSTOM_HTML_LENGTH) {
    return { html: '', removed: ['size-limit'] };
  }
  let safe = html.replace(/<!--[\s\S]*?-->/g, '');
  safe = safe.replace(
    /<\/?([A-Za-z][\w:-]*)([^>]*)>/g,
    (full, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        removed.push(`<${tag}>`);
        return '';
      }
      if (full.startsWith('</')) return `</${tag}>`;
      const attrs: string[] = [];
      rawAttrs.replace(
        /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
        (
          _match: string,
          name: string,
          doubleValue?: string,
          singleValue?: string,
          bareValue?: string,
        ) => {
          const value = doubleValue ?? singleValue ?? bareValue ?? '';
          const attribute = sanitizeAttribute(name, value);
          if (attribute) attrs.push(attribute);
          else if (name.toLowerCase() !== 'xmlns') removed.push(`${tag}[${name}]`);
          return '';
        },
      );
      return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
    },
  );
  return { html: safe, removed };
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
