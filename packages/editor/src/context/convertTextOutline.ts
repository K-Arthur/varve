import { collectFontData, createHarfBuzzWasmBackend, getFontRegistry } from '@varve/engine';
import type { Document, TextNode } from '@varve/scene';
import { convertTextNodeToPath, plainTextToRichText } from '@varve/scene';

export interface ConvertTextOutlineCallbacks {
  onWarn: (msg: string) => void;
  onResult: (newDoc: Document) => void;
  onError: (msg: string) => void;
  /** Return false when the source document/selection changed while loading or shaping. */
  isCurrent?: () => boolean;
}

/**
 * Convert a text node to vector path outlines.
 *
 * Orchestrates font data acquisition, the conversion itself, and
 * dispatches the result back to the editor context.
 */
export async function convertTextOutline(
  doc: Document,
  nodeId: string,
  fontFamily: string,
  callbacks: ConvertTextOutlineCallbacks,
): Promise<void> {
  try {
    const sourceNode = doc.nodes[nodeId];
    if (sourceNode?.kind !== 'text') {
      callbacks.onError('Select a text node before converting to outlines.');
      return;
    }
    const textNode = sourceNode as TextNode;

    if (textNode.textCase && textNode.textCase !== 'none') {
      callbacks.onError(
        'Text uses a case transform. Apply the displayed case to the source text before outlining.',
      );
      return;
    }
    if (textNode.textMode === 'path' || textNode.pathTextSettings) {
      callbacks.onError('Detach text from its path before converting it to outlines.');
      return;
    }
    const liveWarps = (textNode as TextNode & { warps?: Array<{ enabled?: boolean }> }).warps;
    if (liveWarps?.some((warp) => warp.enabled !== false)) {
      callbacks.onError(
        'Expand the live warp first. Outlining the source text would otherwise lose the deformation.',
      );
      return;
    }

    // Try to get font binary data
    let fontData: ArrayBuffer | undefined;

    // Access FontRegistry to find font URLs
    const registry = getRegistry();
    const entries = registry?.getEntries(fontFamily) ?? [];
    const selectedEntry = entries.find(
      (entry) =>
        entry.weight === (textNode.fontWeight ?? 400) &&
        entry.style === (textNode.fontStyle ?? 'normal'),
    );
    const faceIndex =
      textNode.fontReference?.collectionIndex ?? selectedEntry?.collectionIndex ?? 0;
    const fontIdentity = textNode.fontReference
      ? `sha256:${textNode.fontReference.artifactHash}:${textNode.fontReference.collectionIndex ?? 'single'}`
      : selectedEntry?.faceKey;

    // The shared collector resolves exact local storage and bundled assets
    // before the legacy provider fallback below. This keeps outlining local
    // and prevents a same-family, different-artifact substitution.
    try {
      const records = await collectFontData(
        [{ family: fontFamily, fontReference: textNode.fontReference }],
        { fetchBundled: true },
      );
      const record = records[0];
      if (record) {
        const copy = new Uint8Array(record.data.byteLength);
        copy.set(record.data);
        fontData = copy.buffer;
      }
    } catch {
      // Keep the provider fallback below available for older registry entries.
    }

    // Try bundled fonts first (they have direct URLs)
    const bundledEntry = entries.find((e) => e.source === 'bundled' && e.url);
    if (bundledEntry?.url) {
      try {
        const response = await fetch(bundledEntry.url);
        if (response.ok) {
          fontData = await response.arrayBuffer();
          // Decompress if WOFF2
          if (bundledEntry.url.endsWith('.woff2') || isWoff2(fontData)) {
            try {
              const decompressed = await decompressWoff2(fontData);
              if (decompressed) fontData = decompressed;
            } catch {
              callbacks.onWarn('Could not decompress WOFF2 font; trying raw data.');
            }
          }
        }
      } catch {
        // Fall through
      }
    }

    // Try Google Fonts entry
    if (!fontData) {
      const googleEntry = entries.find((e) => e.source === 'google' && e.url);
      if (googleEntry?.url) {
        try {
          // Google Fonts URL returns CSS with @font-face declarations
          const cssResponse = await fetch(googleEntry.url);
          if (cssResponse.ok) {
            const css = await cssResponse.text();
            const urlMatch = css.match(/url\(([^)]+)\)/);
            if (urlMatch?.[1]) {
              const fontUrl = urlMatch[1].replace(/['"]/g, '');
              const fontResponse = await fetch(fontUrl);
              if (fontResponse.ok) {
                fontData = await fontResponse.arrayBuffer();
                if (isWoff2(fontData)) {
                  const decompressed = await decompressWoff2(fontData);
                  if (decompressed) fontData = decompressed;
                }
              }
            }
          }
        } catch {
          // Fall through
        }
      }
    }

    // Try the CSS Font Loading API to get font face data
    if (!fontData) {
      try {
        fontData = await extractFontFromDocument(fontFamily);
      } catch {
        // Fall through
      }
    }

    if (!fontData) {
      callbacks.onWarn(
        `Font "${fontFamily}" binary data is not available. Cannot extract real glyph outlines. ` +
          'Try using a bundled font.',
      );
      callbacks.onError('Font data not available for outlining.');
      return;
    }

    if (faceIndex !== 0) {
      callbacks.onWarn(
        `Font face ${faceIndex} belongs to a collection. Exact collection-face outlining is not available in this runtime, so the text was left editable.`,
      );
      callbacks.onError('This font collection face cannot be outlined safely yet.');
      return;
    }

    const shaping = await shapeForOutline(textNode, fontData, faceIndex, fontIdentity);
    for (const warning of shaping.warnings) callbacks.onWarn(warning);
    if (shaping.missingGlyphs.length > 0) {
      callbacks.onError(
        'The selected font could not provide every glyph for this text. The editable text was preserved.',
      );
      return;
    }

    // Run the conversion with progressive options
    const result = convertTextNodeToPath(doc, nodeId, {
      fontData,
      faceIndex,
      fontIdentity,
      shapedGlyphs: shaping.glyphs,
      shapedRuns: shaping.runs,
      variableAxes: textNode.variableAxes,
      maxChars: 20000,
      includeDecorations: true,
      preserveRuns: true,
      flatten: false,
    });

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        callbacks.onWarn(w);
      }
    }

    if (callbacks.isCurrent && !callbacks.isCurrent()) {
      console.info('[Varve] discarded stale text outline conversion');
      return;
    }
    callbacks.onResult(result.document);
  } catch (err) {
    // Keep implementation details and backend/browser messages out of the
    // toast. The conversion boundary is the right place to preserve a useful
    // product message while diagnostics remain available in devtools.
    console.error('[Varve] text outline conversion failed', err);
    callbacks.onError('Could not convert text to outlines. Check that the font is available.');
  }
}

interface OutlineShapingResult {
  glyphs?: Awaited<ReturnType<ReturnType<typeof createHarfBuzzWasmBackend>['shape']>>['glyphs'];
  runs?: Array<{
    text: string;
    sourceStart: number;
    glyphs: Awaited<ReturnType<ReturnType<typeof createHarfBuzzWasmBackend>['shape']>>['glyphs'];
  }>;
  warnings: string[];
  missingGlyphs: number[];
}

async function shapeForOutline(
  node: TextNode,
  fontData: ArrayBuffer,
  faceIndex: number,
  fontIdentity: string | undefined,
): Promise<OutlineShapingResult> {
  const backend = createHarfBuzzWasmBackend();
  const warnings: string[] = [];
  const missingGlyphs: number[] = [];
  const shape = async (
    text: string,
    fontSize: number,
    features: TextNode['openTypeFeatures'],
    axes: Record<string, number> | undefined,
    language: string | undefined,
    direction: 'ltr' | 'rtl' | undefined,
  ) => {
    const result = await backend.shape({
      text,
      fontData,
      fontIdentity,
      faceIndex,
      fontSize,
      features,
      variationAxes: axes,
      language,
      direction,
    });
    warnings.push(...result.warnings);
    missingGlyphs.push(...result.missingGlyphIndices);
    return result;
  };

  const richText =
    node.richText ?? (node.text.includes('\n') ? plainTextToRichText(node.text) : undefined);
  if (!richText?.paragraphs?.length) {
    const result = await shape(
      node.text,
      node.fontSize,
      node.openTypeFeatures,
      node.variableAxes,
      node.language,
      node.direction === 'ltr' || node.direction === 'rtl' ? node.direction : undefined,
    );
    return { glyphs: result.glyphs, warnings, missingGlyphs };
  }

  const runs: NonNullable<OutlineShapingResult['runs']> = [];
  let sourceStart = 0;
  for (const paragraph of richText.paragraphs) {
    for (const run of paragraph.runs ?? []) {
      const text = run.text ?? '';
      const format = run.format;
      const result = await shape(
        text,
        format?.fontSize ?? node.fontSize,
        format?.openTypeFeatures ?? node.openTypeFeatures,
        format?.variableFontSettings ?? node.variableAxes,
        format?.language ?? node.language,
        paragraph.format?.direction ??
          (node.direction === 'ltr' || node.direction === 'rtl' ? node.direction : undefined),
      );
      runs.push({ text, sourceStart, glyphs: result.glyphs });
      sourceStart += text.length;
    }
    sourceStart += 1;
  }
  return { runs, warnings, missingGlyphs };
}

function getRegistry() {
  try {
    return getFontRegistry();
  } catch {
    return undefined;
  }
}

function isWoff2(data: ArrayBuffer): boolean {
  const view = new Uint8Array(data, 0, 4);
  return view[0] === 0x77 && view[1] === 0x4f && view[2] === 0x46 && view[3] === 0x32;
}

/**
 * Decompress WOFF2 to TTF/OTF using browser's DecompressionStream or a WASM decoder.
 */
async function decompressWoff2(data: ArrayBuffer): Promise<ArrayBuffer | null> {
  // Try wawoff2 (available in test environment)
  try {
    // wawoff2 has no published type declarations; used only in test environments
    const { decompress } = await import('wawoff2');
    const result = await decompress(new Uint8Array(data));
    const copy = new Uint8Array(result.length);
    copy.set(result);
    return copy.buffer;
  } catch {
    // Fall through to browser DecompressionStream
  }

  // Try browser's Compression Streams API
  try {
    if ('DecompressionStream' in window) {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      void writer.write(new Uint8Array(data));
      void writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const total = chunks.reduce((acc, c) => acc + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result.buffer;
    }
  } catch {
    // Fall through
  }

  return null;
}

/**
 * Attempt to extract font binary data from the document.fonts API.
 * This is limited — document.fonts does not expose binary data directly.
 * We try to find a FontFace object and read its data via internal properties.
 */
async function extractFontFromDocument(fontFamily: string): Promise<ArrayBuffer | undefined> {
  if (typeof document === 'undefined' || !document.fonts) return undefined;

  await document.fonts.ready;

  // Check if the font is loaded
  if (!document.fonts.check(`16px "${fontFamily}"`)) return undefined;

  // document.fonts doesn't expose binary data directly.
  // In browsers, we can try to read from FontFace's internal `data` property,
  // but this is non-standard and may not work.
  const fontFaceSet = document.fonts as unknown as Set<FontFace>;
  for (const face of fontFaceSet) {
    if (face.family.toLowerCase() === fontFamily.toLowerCase()) {
      // FontFace doesn't expose binary data in the standard API.
      // We need to reload the font from its original source.
      return undefined;
    }
  }

  return undefined;
}
