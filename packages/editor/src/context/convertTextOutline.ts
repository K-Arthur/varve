import { getFontRegistry } from '@strata/engine';
import type { Document } from '@strata/scene';
import { convertTextNodeToPath } from '@strata/scene';

export interface ConvertTextOutlineCallbacks {
  onWarn: (msg: string) => void;
  onResult: (newDoc: Document) => void;
  onError: (msg: string) => void;
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
    // Try to get font binary data
    let fontData: ArrayBuffer | undefined;

    // Access FontRegistry to find font URLs
    const registry = getRegistry();
    const entries = registry?.getEntries(fontFamily) ?? [];

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

    // Run the conversion
    const result = convertTextNodeToPath(doc, nodeId, {
      fontData,
      maxChars: 20000,
    });

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        callbacks.onWarn(w);
      }
    }

    callbacks.onResult(result.document);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error during text outlining';
    callbacks.onError(msg);
  }
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
