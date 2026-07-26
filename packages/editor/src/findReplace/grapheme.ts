export function graphemeClusterOffsets(text: string): number[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segments = segmenter.segment(text);
  const offsets: number[] = [];
  for (const seg of segments) {
    offsets.push(seg.index);
  }
  return offsets;
}

export function snapToGraphemeBoundary(
  text: string,
  charOffset: number,
  side: 'start' | 'end',
): number {
  const offsets = graphemeClusterOffsets(text);
  if (offsets.length === 0) return charOffset;

  if (side === 'start') {
    for (let i = offsets.length - 1; i >= 0; i--) {
      if (offsets[i] <= charOffset) return offsets[i];
    }
  } else {
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i] >= charOffset) return offsets[i];
    }
  }
  return charOffset;
}

export function normalizeAndSegment(text: string): {
  normalized: string;
  graphemeToUtf16: number[];
} {
  const nf = text.normalize('NFC');
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segments = segmenter.segment(nf);
  const mapping: number[] = [];
  let _idx = 0;
  for (const seg of segments) {
    mapping.push(seg.index);
    _idx = seg.index + seg.segment.length;
  }
  return { normalized: nf, graphemeToUtf16: mapping };
}
