declare module 'bidi-js' {
  interface BidiParagraphResult {
    start: number;
    end: number;
    level: number;
  }

  interface BidiEmbeddingLevels {
    levels: Uint8Array;
    paragraphs: BidiParagraphResult[];
  }

  interface BidiEngine {
    getEmbeddingLevels(text: string, baseDirection?: 'ltr' | 'rtl' | 'auto'): BidiEmbeddingLevels;
    getReorderedIndices(
      text: string,
      levels: BidiEmbeddingLevels,
      start?: number,
      end?: number,
    ): number[];
    getMirroredCharactersMap(
      text: string,
      levels: Uint8Array,
      start?: number,
      end?: number,
    ): Map<number, string>;
  }

  const bidiFactory: () => BidiEngine;
  export default bidiFactory;
}
