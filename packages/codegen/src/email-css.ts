/**
 * Small, deterministic CSS inliner for email output.
 *
 * This intentionally handles only simple selectors. Media queries, pseudo
 * selectors, descendant selectors, and other rules that cannot be safely
 * represented as inline declarations remain in the stylesheet for clients
 * that support them.
 */

export interface EmailCssInlineResult {
  html: string;
  remainingCss: string;
  inlinedRules: number;
}

interface CssRule {
  selectors: string[];
  declarations: Array<[string, string]>;
  raw: string;
  inlineable: boolean;
}

export function inlineEmailCss(html: string, css: string): EmailCssInlineResult {
  const rules = parseTopLevelRules(css);
  let output = html;
  let inlinedRules = 0;
  const remaining: string[] = [];

  for (const rule of rules) {
    if (!rule.inlineable) {
      remaining.push(rule.raw);
      continue;
    }

    let matched = false;
    output = output.replace(
      /<([A-Za-z][\w:-]*)(\s[^<>]*?)?>/g,
      (full, rawTag: string, rawAttributes?: string) => {
        const attributes = rawAttributes ?? '';
        if (!rule.selectors.some((selector) => matchesSelector(rawTag, attributes, selector))) {
          return full;
        }
        matched = true;
        const merged = mergeInlineStyle(attributes, rule.declarations);
        return merged === attributes ? full : `<${rawTag}${merged}>`;
      },
    );

    if (matched) inlinedRules += 1;
    else remaining.push(rule.raw);
  }

  return { html: output, remainingCss: remaining.join('\n'), inlinedRules };
}

function parseTopLevelRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open < 0) break;
    const close = findMatchingBrace(css, open);
    if (close < 0) break;
    const selector = css.slice(cursor, open).trim();
    const body = css.slice(open + 1, close);
    const declarations = parseDeclarations(body);
    const selectorParts = selector
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const inlineable =
      selectorParts.length > 0 &&
      selectorParts.every((part) => isSimpleSelector(part)) &&
      declarations.length > 0;
    rules.push({
      selectors: selectorParts,
      declarations,
      inlineable,
      raw: `${selector} { ${body.trim()} }`,
    });
    cursor = close + 1;
  }
  return rules;
}

function findMatchingBrace(value: string, open: number): number {
  let depth = 0;
  for (let index = open; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseDeclarations(body: string): Array<[string, string]> {
  return body
    .split(';')
    .map((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator <= 0) return null;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (!/^[a-z][a-z0-9-]*$/i.test(property) || !value) return null;
      return [property, value] as [string, string];
    })
    .filter((declaration): declaration is [string, string] => declaration !== null);
}

function isSimpleSelector(selector: string): boolean {
  return /^(?:[A-Za-z][\w:-]*)?(?:#[A-Za-z][\w:-]*)?(?:\.[A-Za-z][\w-]*)*$/.test(selector);
}

function matchesSelector(tag: string, attributes: string, selector: string): boolean {
  const tagName = tag.toLowerCase();
  const selectorTag = selector.match(/^[A-Za-z][\w:-]*/)?.[0]?.toLowerCase();
  if (selectorTag && selectorTag !== tagName) return false;

  const selectorId = selector.match(/#([A-Za-z][\w:-]*)/)?.[1];
  if (selectorId && readAttribute(attributes, 'id') !== selectorId) return false;

  const requiredClasses = [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  if (requiredClasses.length === 0) return true;
  const classes = (readAttribute(attributes, 'class') ?? '').split(/\s+/).filter(Boolean);
  return requiredClasses.every((required) => classes.includes(required));
}

function readAttribute(attributes: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function mergeInlineStyle(attributes: string, declarations: Array<[string, string]>): string {
  const style = readAttribute(attributes, 'style');
  const existing = new Map(parseDeclarations(style ?? ''));
  let changed = false;
  for (const [property, value] of declarations) {
    if (!existing.has(property)) {
      existing.set(property, value);
      changed = true;
    }
  }
  if (!changed) return attributes;
  const styleValue = [...existing.entries()].map(([key, value]) => `${key}: ${value}`).join('; ');
  const stylePattern = /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
  if (stylePattern.test(attributes)) {
    return attributes.replace(stylePattern, ` style="${escapeAttribute(styleValue)}"`);
  }
  return `${attributes} style="${escapeAttribute(styleValue)}"`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
