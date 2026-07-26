import type { Document } from '@strata/scene';
import { plainTextToRichText, richTextReplace, richTextToPlainText } from '@strata/scene';
import { searchInDocument } from './search';
import type { MatchResult, SearchOptions } from './types';

export function replaceSingle(doc: Document, match: MatchResult, replacement: string): Document {
  const node = doc.nodes[match.nodeId];
  if (node?.kind !== 'text') return doc;
  const textNode = node as import('@strata/scene').TextNode;
  const rt = textNode.richText ?? plainTextToRichText(textNode.text);

  const updatedRich = richTextReplace(rt, match.flatStart, match.flatEnd, replacement);
  const updatedPlain = richTextToPlainText(updatedRich);

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [match.nodeId]: {
        ...textNode,
        text: updatedPlain,
        richText: updatedRich,
      } as import('@strata/scene').SceneNode,
    },
  };
}

export function replaceAll(
  doc: Document,
  needle: string,
  replacement: string,
  options: SearchOptions,
  scope: 'selection' | 'page' | 'document',
  selection: readonly string[],
  excludeInstances: boolean,
  excludeLocked: boolean,
  excludeHidden: boolean,
): { doc: Document; count: number } {
  const { results } = searchInDocument(
    doc,
    needle,
    options,
    scope,
    selection,
    excludeInstances,
    excludeLocked,
    excludeHidden,
  );

  if (results.length === 0) return { doc, count: 0 };

  let result = doc;
  let count = 0;

  // Work backwards within each text node so replacements that change string
  // length cannot invalidate the offsets of matches that are still pending.
  const matchesInReverseDocumentOrder = [...results].sort(
    (left, right) => right.nodeId.localeCompare(left.nodeId) || right.flatStart - left.flatStart,
  );

  for (const match of matchesInReverseDocumentOrder) {
    const node = result.nodes[match.nodeId];
    if (node?.kind !== 'text') continue;

    let expandedReplacement = replacement;
    if (options.useRegex && replacement.includes('$')) {
      const textNode = node as import('@strata/scene').TextNode;
      const matchedText = textNode.text.slice(match.flatStart, match.flatEnd);
      expandedReplacement = expandRegexReplacement(
        matchedText,
        needle,
        replacement,
        options.caseSensitive,
      );
    }

    result = replaceSingle(result, match, expandedReplacement);
    count++;
  }

  return { doc: result, count };
}

function expandRegexReplacement(
  matchText: string,
  pattern: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  try {
    const regex = new RegExp(pattern, caseSensitive ? '' : 'i');
    return matchText.replace(regex, replacement);
  } catch {
    return replacement;
  }
}
