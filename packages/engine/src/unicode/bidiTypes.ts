export type BidiDirection = 'ltr' | 'rtl';

export interface BidiRun {
  start: number;
  end: number;
  direction: BidiDirection;
  level: number;
}

export interface BidiParagraph {
  text: string;
  baseDirection: BidiDirection;
  baseLevel: number;
  runs: BidiRun[];
  visualRuns: BidiRun[];
  /** Character indices in line visual order, as resolved by UAX #9. */
  visualOrder?: readonly number[];
  /** Mirrored punctuation for visual presentation; source text is unchanged. */
  mirroredCharacters?: ReadonlyMap<number, string>;
}
