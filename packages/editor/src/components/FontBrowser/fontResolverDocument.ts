import type { ResolverDocument } from '@varve/engine/font';
import type { Document } from '@varve/scene';

/** Project the document's authoritative text sources into the resolver's small model. */
export function toFontResolverDocument(doc: Document): ResolverDocument {
  const nodes: ResolverDocument['nodes'] = {};
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (node.kind !== 'text') continue;
    nodes[nodeId] = {
      id: node.id,
      kind: 'text',
      styleOverrides: node.styleOverrides,
      fontFamily: node.fontFamily,
      fontReference: node.fontReference,
      fontWeight: node.fontWeight,
      fontStyle: node.fontStyle,
      text: node.text,
      richText: node.richText,
    };
  }

  const styles: ResolverDocument['styles'] = doc.styles
    ? Object.fromEntries(
        Object.entries(doc.styles).map(([styleId, style]) => [
          styleId,
          style.type === 'text'
            ? {
                type: 'text',
                fontFamily: style.fontFamily,
                fontReference: style.fontReference,
                fontWeight: style.fontWeight,
                fontStyle: style.fontStyle,
              }
            : { type: style.type },
        ]),
      )
    : undefined;

  return { nodes, styles, stories: doc.stories };
}
