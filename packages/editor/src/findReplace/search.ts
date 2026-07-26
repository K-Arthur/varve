import type { Document } from '@strata/scene';
import {
  activePageNodes,
  flatTextFromRichText,
  flatToRichSelection,
  plainTextToRichText,
  richTextToPlainText,
  walkNodes,
} from '@strata/scene';
import type { MatchResult, SearchOptions, TextNodeContent } from './types';

export function hasCatastrophicBacktracking(pattern: string): boolean {
  const dangerousPatterns = [
    /\(\S*\+\)\s*\+/,
    /\(\S*\*\)\s*[+*]/,
    /\([^)]*\*\)\s*[+*]/,
    /\(\S*\?\)\s*[+*]/,
    /\(\S*\+\)\s*\*/,
    /(\+|\*)\s*\{/,
    /\+\s*\+\s*/,
    /\*\s*\+\s*/,
    /\*\s*\*\s*/,
    /\+\s*\*\s*/,
    /\{\d+,\}\s*\+/,
    /\[\s*\]\s*\+/,
  ];
  return dangerousPatterns.some((p) => p.test(pattern));
}

export function validateRegex(pattern: string): string | null {
  if (!pattern) return 'Pattern is empty';
  try {
    new RegExp(pattern);
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid regular expression';
  }
  if (hasCatastrophicBacktracking(pattern)) {
    return 'Pattern may cause catastrophic backtracking (nested quantifiers)';
  }
  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchPattern(
  needle: string,
  options: SearchOptions,
): {
  pattern: string;
  flags: string;
} | null {
  let pattern: string;
  let flags = 'g';

  if (options.useRegex) {
    pattern = needle;
    if (!options.caseSensitive) flags += 'i';
  } else {
    pattern = escapeRegex(needle);
    if (!options.caseSensitive) flags += 'i';
  }

  if (options.wholeWord) {
    pattern = `(?:^|[^\\p{L}\\p{N}_])(${pattern})(?:$|[^\\p{L}\\p{N}_])`;
  }

  return { pattern, flags };
}

function buildCollator(options: SearchOptions): Intl.Collator | null {
  if (options.caseSensitive && options.matchDiacritics) return null;
  let sensitivity: Intl.CollatorOptions['sensitivity'];
  if (options.caseSensitive) {
    sensitivity = 'accent';
  } else if (options.matchDiacritics) {
    sensitivity = 'case';
  } else {
    sensitivity = 'base';
  }
  return new Intl.Collator('en', { sensitivity, usage: 'search' });
}

function normalizeNFC(s: string): string {
  return s.normalize('NFC');
}

function flatSearch(
  text: string,
  needle: string,
  options: SearchOptions,
): { start: number; end: number }[] {
  if (!needle) return [];
  const results: { start: number; end: number }[] = [];
  const normalizedText = normalizeNFC(text);
  const normalizedNeedle = normalizeNFC(needle);

  if (options.useRegex) {
    const spec = buildSearchPattern(needle, options);
    if (!spec) return [];
    try {
      const re = new RegExp(spec.pattern, spec.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(normalizedText)) !== null) {
        const wholeWordOffset = options.wholeWord ? 1 : 0;
        const mstart = match.index + wholeWordOffset;
        const mend = mstart + (match[0].length - wholeWordOffset * 2);
        results.push({ start: mstart, end: mend });
        if (match.index === re.lastIndex) re.lastIndex++;
      }
    } catch {
      return [];
    }
  } else {
    const collator = buildCollator(options);
    if (collator) {
      const matchLen = normalizedNeedle.length;
      if (matchLen === 0) return [];
      for (let i = 0; i <= normalizedText.length - matchLen; ) {
        const candidate = normalizedText.slice(i, i + matchLen);
        if (collator.compare(candidate, normalizedNeedle) === 0) {
          if (options.wholeWord) {
            const before = i > 0 ? normalizedText[i - 1] : ' ';
            const after = i + matchLen < normalizedText.length ? normalizedText[i + matchLen] : ' ';
            const isWordBoundary = !/\p{L}/u.test(before) && !/\p{L}/u.test(after);
            if (isWordBoundary) {
              results.push({ start: i, end: i + matchLen });
            }
          } else {
            results.push({ start: i, end: i + matchLen });
          }
          i += matchLen;
        } else {
          i++;
        }
      }
    } else {
      const matchLen = normalizedNeedle.length;
      if (matchLen === 0) return [];
      let pos = 0;
      while (true) {
        const idx = normalizedText.indexOf(normalizedNeedle, pos);
        if (idx < 0) break;
        if (options.wholeWord) {
          const before = idx > 0 ? normalizedText[idx - 1] : ' ';
          const after =
            idx + matchLen < normalizedText.length ? normalizedText[idx + matchLen] : ' ';
          const isWordBoundary = !/\p{L}/u.test(before) && !/\p{L}/u.test(after);
          if (isWordBoundary) {
            results.push({ start: idx, end: idx + matchLen });
          }
        } else {
          results.push({ start: idx, end: idx + matchLen });
        }
        pos = idx + matchLen;
      }
    }
  }

  return results;
}

function getTextNodeContent(doc: Document, nodeId: string): TextNodeContent | null {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'text') return null;
  const textNode = node as import('@strata/scene').TextNode;
  const rt = textNode.richText ?? plainTextToRichText(textNode.text);
  const plain = richTextToPlainText(rt);

  const isInstance = (() => {
    const parent = findParentFrame(doc, nodeId);
    return parent ? !!parent.componentId : false;
  })();

  return {
    nodeId,
    richText: rt,
    plainText: plain,
    isInstance,
    isLocked: !!textNode.locked,
    isHidden: !textNode.visible,
    nodeName: textNode.name || 'Text',
  };
}

function findParentFrame(doc: Document, nodeId: string): import('@strata/scene').FrameNode | null {
  const entries = walkNodes(doc);
  for (const [, entry] of entries) {
    if (entry.node.kind === 'frame' && entry.node.children?.includes(nodeId)) {
      return entry.node as import('@strata/scene').FrameNode;
    }
  }
  return null;
}

function collectTargetNodeIds(
  doc: Document,
  scope: 'selection' | 'page' | 'document',
  selection: readonly string[],
): string[] {
  if (scope === 'selection') {
    return selection.filter((id) => {
      const n = doc.nodes[id];
      return n?.kind === 'text';
    }) as string[];
  }

  const startIds = scope === 'page' ? activePageNodes(doc) : doc.rootChildren;

  const entries = walkNodes(doc, startIds);
  const textIds: string[] = [];
  for (const [id, entry] of entries) {
    if (entry.node.kind === 'text') {
      textIds.push(id);
    }
  }
  return textIds;
}

export function searchInDocument(
  doc: Document,
  needle: string,
  options: SearchOptions,
  scope: 'selection' | 'page' | 'document',
  selection: readonly string[],
  excludeInstances: boolean,
  excludeLocked: boolean,
  excludeHidden: boolean,
): {
  results: MatchResult[];
  skippedCount: { instances: number; locked: number; hidden: number };
} {
  const results: MatchResult[] = [];
  const skipped = { instances: 0, locked: 0, hidden: 0 };

  const targetIds = collectTargetNodeIds(doc, scope, selection);

  for (const id of targetIds) {
    const content = getTextNodeContent(doc, id);
    if (!content) continue;

    if (excludeInstances && content.isInstance) {
      skipped.instances++;
      continue;
    }
    if (excludeLocked && content.isLocked) {
      skipped.locked++;
      continue;
    }
    if (excludeHidden && content.isHidden) {
      skipped.hidden++;
      continue;
    }

    const text = content.plainText;
    const matches = flatSearch(text, needle, options);

    for (const m of matches) {
      const _flatInfo = flatTextFromRichText(content.richText);
      const segments = flatToRichSelection(content.richText, m.start, m.end).paraSegments;
      const snippetStart = Math.max(0, m.start - 20);
      const _snippetEnd = Math.min(text.length, m.end + 20);
      const snippet =
        (snippetStart > 0 ? '…' : '') +
        text.slice(snippetStart, m.end) +
        (m.end < text.length ? '…' : '');

      results.push({
        nodeId: id,
        flatStart: m.start,
        flatEnd: m.end,
        contextSnippet: snippet,
        segments,
        nodeName: content.nodeName,
      });
    }
  }

  return { results, skippedCount: skipped };
}

export { buildSearchPattern, flatSearch };
