import type { CharacterFormat, Paragraph, RichText, TextRun } from '@varve/scene';

const MAX_CLIPBOARD_HTML_BYTES = 4 * 1024 * 1024;
const MAX_CLIPBOARD_HTML_DEPTH = 64;

export interface ClipboardRichTextResult {
  richText: RichText;
  plainText: string;
  warnings: string[];
}

export function clipboardRichTextWarning(result: ClipboardRichTextResult | null): string {
  const count = result?.warnings.length ?? 0;
  return count > 0 ? `; ${count} formatting warning${count === 1 ? '' : 's'}` : '';
}

interface WalkState {
  format: CharacterFormat;
  depth: number;
}

function colorFromCss(value: string): CharacterFormat['color'] | undefined {
  const hex = value.trim().match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length <= 4
        ? hex
            .split('')
            .map((part) => `${part}${part}`)
            .join('')
        : hex;
    const numbers = [0, 2, 4].map((offset) =>
      Number.parseInt(expanded.slice(offset, offset + 2), 16),
    );
    const alpha = expanded.length >= 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255;
    return {
      space: 'rgb',
      r: numbers[0]!,
      g: numbers[1]!,
      b: numbers[2]!,
      a: alpha,
    } as CharacterFormat['color'];
  }
  const rgb = value.trim().match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (!rgb) return undefined;
  const parts = rgb.split(',').map((part) => part.trim());
  if (parts.length < 3) return undefined;
  const channels = parts.slice(0, 3).map((part) => Number.parseFloat(part));
  if (!channels.every((channel) => Number.isFinite(channel))) return undefined;
  const alpha = parts[3] === undefined ? 255 : Math.round(Number.parseFloat(parts[3]) * 255);
  if (!Number.isFinite(alpha)) return undefined;
  return {
    space: 'rgb',
    r: Math.max(0, Math.min(255, channels[0]!)),
    g: Math.max(0, Math.min(255, channels[1]!)),
    b: Math.max(0, Math.min(255, channels[2]!)),
    a: Math.max(0, Math.min(255, alpha)),
  } as CharacterFormat['color'];
}

function inlineFormat(element: Element, inherited: CharacterFormat): CharacterFormat {
  const format: CharacterFormat = { ...inherited };
  const tag = element.tagName.toLowerCase();
  if (tag === 'strong' || tag === 'b') format.fontWeight = 700;
  if (tag === 'em' || tag === 'i') format.fontStyle = 'italic';
  if (tag === 'u') format.textDecoration = 'underline';
  if (tag === 's' || tag === 'strike' || tag === 'del') format.textDecoration = 'line-through';
  const style = element.getAttribute('style') ?? '';
  for (const declaration of style.split(';')) {
    const [property, rawValue] = declaration.split(':', 2);
    const value = rawValue?.trim();
    if (!property || !value) continue;
    switch (property.trim().toLowerCase()) {
      case 'font-weight':
        if (value === 'bold') format.fontWeight = 700;
        else if (/^\d+$/.test(value)) format.fontWeight = Number(value);
        break;
      case 'font-style':
        if (value === 'italic' || value === 'normal') format.fontStyle = value;
        break;
      case 'text-decoration':
        if (value.includes('line-through')) format.textDecoration = 'line-through';
        else if (value.includes('underline')) format.textDecoration = 'underline';
        break;
      case 'font-family':
        format.fontFamily = value.replace(/^['"]|['"]$/g, '');
        break;
      case 'color':
        format.color = colorFromCss(value);
        break;
    }
  }
  return format;
}

function appendRun(paragraph: Paragraph, text: string, format: CharacterFormat): void {
  if (!text) return;
  const previous = paragraph.runs[paragraph.runs.length - 1];
  if (previous && JSON.stringify(previous.format ?? {}) === JSON.stringify(format)) {
    previous.text += text;
    return;
  }
  const run: TextRun = Object.keys(format).length > 0 ? { text, format } : { text };
  paragraph.runs.push(run);
}

/** Parse the safe, local subset of HTML clipboard data without loading resources. */
export function parseClipboardRichText(html: string): ClipboardRichTextResult | null {
  if (!html || new TextEncoder().encode(html).byteLength > MAX_CLIPBOARD_HTML_BYTES) return null;
  if (typeof DOMParser === 'undefined') return null;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const warnings = new Set<string>();
  const paragraphs: Paragraph[] = [{ runs: [] }];
  const blockTags = new Set([
    'address',
    'article',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'p',
    'pre',
    'section',
  ]);
  const skippedTags = new Set([
    'img',
    'script',
    'style',
    'table',
    'video',
    'audio',
    'iframe',
    'object',
  ]);

  const newParagraph = (): Paragraph => {
    const current = paragraphs[paragraphs.length - 1]!;
    if (current.runs.length > 0) paragraphs.push({ runs: [] });
    return paragraphs[paragraphs.length - 1]!;
  };
  const walk = (node: Node, state: WalkState): void => {
    if (state.depth > MAX_CLIPBOARD_HTML_DEPTH) {
      warnings.add('Nested HTML content was truncated');
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      appendRun(paragraphs[paragraphs.length - 1]!, node.nodeValue ?? '', state.format);
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (skippedTags.has(tag)) {
      warnings.add(`${tag} content was omitted`);
      return;
    }
    if (tag === 'br') {
      appendRun(paragraphs[paragraphs.length - 1]!, '\n', state.format);
      return;
    }
    if (blockTags.has(tag) && paragraphs[paragraphs.length - 1]!.runs.length > 0) newParagraph();
    const next = inlineFormat(node, state.format);
    for (const child of Array.from(node.childNodes))
      walk(child, { format: next, depth: state.depth + 1 });
    if (blockTags.has(tag)) newParagraph();
  };
  const root = parsed.body ?? parsed.documentElement;
  for (const child of Array.from(root.childNodes)) walk(child, { format: {}, depth: 0 });
  while (paragraphs.length > 1 && paragraphs[paragraphs.length - 1]!.runs.length === 0)
    paragraphs.pop();
  if (paragraphs.length === 0 || paragraphs.every((paragraph) => paragraph.runs.length === 0))
    return null;
  const richText: RichText = { paragraphs };
  const plainText = paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n');
  return { richText, plainText, warnings: [...warnings] };
}
