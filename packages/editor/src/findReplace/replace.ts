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

  if (replacement.includes('$') && options.useRegex) {
    for (const match of results) {
      const node = result.nodes[match.nodeId];
      if (node?.kind !== 'text') continue;
      const textNode = node as import('@strata/scene').TextNode;
      const fullText = textNode.text;
      const matchedText = fullText.slice(match.flatStart, match.flatEnd);
      const _expandedReplace = expandRegexReplacement(matchedText, replacement);
      result = replaceSingle(result, match, expandReplace);
      count++;
    }
  } else {
    for (const match of results) {
      result = replaceSingle(result, match, replacement);
      count++;
    }
  }

  return { doc: result, count };
}

function expandRegexReplacement(matchText: string, replacement: string): string {
  return replacement.replace(/\$(\d+|\$|&|`|')/g, (_, ref) => {
    if (ref === '$') return '$';
    if (ref === '&') return matchText;
    if (ref === '`') return '';
    if (ref === "'") return '';
    return matchText;
  });
}
