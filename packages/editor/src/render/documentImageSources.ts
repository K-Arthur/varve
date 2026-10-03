import type { Document, Fill, SceneNode } from '@varve/scene';
import { maskRenderUrl } from '../backgroundRemoval/maskRenderCache';

function addSource(sources: Set<string>, source: string | undefined): void {
  if (source) sources.add(source);
}

function addFillSource(sources: Set<string>, fill: Fill, document: Document): void {
  if (fill.type === 'image' && fill.image) {
    const canonicalId = fill.image.src.startsWith('asset:')
      ? fill.image.src.slice('asset:'.length)
      : undefined;
    const asset =
      (canonicalId ? document.assets?.[canonicalId] : undefined) ??
      (fill.image.assetId ? document.assets?.[fill.image.assetId] : undefined);
    addSource(sources, asset?.dataUrl ?? fill.image.src);
  } else if (fill.type === 'pattern' && fill.pattern) {
    const definition = fill.pattern.definitionId
      ? document.patternDefinitions?.[fill.pattern.definitionId]
      : undefined;
    // A resolved definition owns the tile; an obsolete placement preview must
    // not keep a replaced bitmap alive. Missing definitions retain the legacy
    // inline fallback, matching resolvePatternDefinitionFill.
    if (!definition) addSource(sources, fill.pattern.tileSrc);
  }
}

function addNodeSources(sources: Set<string>, node: SceneNode, document: Document): void {
  for (const fill of node.fills ?? []) addFillSource(sources, fill, document);
  if (node.kind === 'shape') addSource(sources, node.backgroundRemoval?.maskDataUrl);
}

function computeDocumentImageSources(document: Document): readonly string[] {
  const sources = new Set<string>();
  for (const asset of Object.values(document.assets ?? {})) addSource(sources, asset.dataUrl);
  for (const mask of Object.values(document.rasterMaskAssets ?? {}))
    addSource(sources, mask.dataUrl);
  // Ownership includes hidden nodes and other pages. A view/solo change does
  // not close their resources, and retaining a source never starts a decode.
  for (const id of Object.keys(document.nodes))
    addNodeSources(sources, document.nodes[id]!, document);
  for (const paint of Object.values(document.paints ?? {})) {
    addFillSource(sources, paint.fill, document);
  }
  for (const style of Object.values(document.styles ?? {})) {
    if (style.type === 'color') addFillSource(sources, style.fill, document);
  }
  for (const definition of Object.values(document.patternDefinitions ?? {})) {
    if (definition.source.kind === 'vector') {
      for (const node of Object.values(definition.source.nodes)) {
        addNodeSources(sources, node, document);
      }
    }
    if (definition.source.kind !== 'raster' && definition.previewRevision === definition.revision) {
      addSource(sources, definition.previewSrc);
    }
  }
  return Object.freeze([...sources]);
}

/**
 * One immutable document per collector: camera/decode frames reuse the source
 * list, and switching documents releases the previous memo instead of pinning
 * resource payloads from document/history snapshots. Cache byte/entry limits
 * remain authoritative; this list expresses ownership, not residency.
 */
export function createDocumentImageSourceCollector(): (document: Document) => readonly string[] {
  let previousDocument: Document | null = null;
  let previousSources: readonly string[] = [];
  return (document) => {
    if (document !== previousDocument) {
      previousSources = computeDocumentImageSources(document);
      previousDocument = document;
    }
    return previousSources;
  };
}

export const documentImageSources = createDocumentImageSourceCollector();

/** Mask proxies may finish after the document memo was computed. */
export function documentImageSourcesForFrame(document: Document): Set<string> {
  const owned = documentImageSources(document);
  const sources = new Set(owned);
  for (const source of owned) addSource(sources, maskRenderUrl(source));
  return sources;
}
