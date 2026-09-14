/**
 * Document font readiness for the canvas.
 *
 * Two halves of one contract:
 *
 * 1. **Prefetch** — request the exact faces this document references, as soon
 *    as the document is known. `document.fonts.ready` resolves once the loads
 *    that already started have finished, and an unreferenced `@font-face`
 *    never starts one, so waiting on it proves nothing about a bundled family
 *    the document happens to use. Requesting only the referenced faces avoids
 *    the opposite failure of pulling in every installed family.
 *
 * 2. **Invalidate** — when the usable face set changes, tell the canvas that
 *    every derived text geometry is stale. This is presentation state: it
 *    never edits the document, marks it dirty, or creates an undo entry.
 */

import { type DocumentFontFace, fontReferenceKey, getFontRegistry } from '@varve/engine';
import type { Document } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';
import { useEffect, useRef } from 'react';

/** Every face a document references, deduplicated by family/weight/style. */
export function collectDocumentFontFaces(doc: Document): DocumentFontFace[] {
  const faces = new Map<string, DocumentFontFace>();
  const add = (
    family: string | undefined,
    weight: number | undefined,
    style: string | undefined,
    fontReference: DocumentFontFace['fontReference'] | undefined,
  ): void => {
    const face: DocumentFontFace = {
      family: family ?? DEFAULT_ARTWORK_FONT_FAMILY,
      weight: weight ?? 400,
      style: style === 'italic' ? 'italic' : 'normal',
      ...(fontReference ? { fontReference } : {}),
    };
    const reference = face.fontReference ? fontReferenceKey(face.fontReference) : '';
    faces.set(`${face.style}:${face.weight}:${face.family}:${reference}`, face);
  };
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;
    const style = node.styleId ? doc.styles?.[node.styleId] : undefined;
    const textStyle = style?.type === 'text' ? style : undefined;
    const family = node.fontFamily ?? textStyle?.fontFamily;
    const weight = node.fontWeight ?? textStyle?.fontWeight;
    const fontStyle = node.fontStyle ?? textStyle?.fontStyle;
    const fontReference = node.fontReference ?? textStyle?.fontReference;
    add(family, weight, fontStyle, fontReference);
    for (const paragraph of node.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs) {
        // A run inherits whatever it does not override, so a bold run in an
        // otherwise regular node still needs the bold face requested.
        add(
          run.format?.fontFamily ?? family,
          run.format?.fontWeight ?? weight,
          run.format?.fontStyle ?? fontStyle,
          run.format?.fontReference ?? fontReference,
        );
      }
    }

    // Story frames keep their authoritative runs on the story rather than on
    // the frame node. Request those faces too; otherwise a linked frame can
    // paint fallback glyphs even though its document references the real face.
    const story = node.storyBinding ? doc.stories?.[node.storyBinding.storyId] : undefined;
    for (const paragraph of story?.content.paragraphs ?? []) {
      for (const run of paragraph.runs) {
        add(
          run.format?.fontFamily ?? family,
          run.format?.fontWeight ?? weight,
          run.format?.fontStyle ?? fontStyle,
          run.format?.fontReference ?? fontReference,
        );
      }
    }
  }
  return [...faces.values()];
}

/** Stable identity of a face set, for skipping redundant prefetches. */
export function documentFontFaceKey(faces: readonly DocumentFontFace[]): string {
  return faces
    .map((face) => {
      const reference = face.fontReference ? fontReferenceKey(face.fontReference) : '';
      return `${face.style}:${face.weight}:${face.family}:${reference}`;
    })
    .sort()
    .join('\0');
}

/**
 * Prefetch the document's faces and run `onFontGeometryChanged` whenever the
 * usable face set moves. The callback may change every render; it is read
 * through a ref so font subscription is not torn down and rebuilt each time.
 */
export function useDocumentFontReadiness(doc: Document, onFontGeometryChanged: () => void): void {
  const handlerRef = useRef(onFontGeometryChanged);
  handlerRef.current = onFontGeometryChanged;
  const prefetchedKeyRef = useRef('');

  useEffect(() => {
    return getFontRegistry().subscribe(() => handlerRef.current());
  }, []);

  useEffect(() => {
    const faces = collectDocumentFontFaces(doc);
    const key = documentFontFaceKey(faces);
    if (key === prefetchedKeyRef.current) return;
    prefetchedKeyRef.current = key;
    void getFontRegistry().ensureDocumentFonts(faces);
  }, [doc]);
}
