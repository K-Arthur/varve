/**
 * Multilingual text regression corpus.
 *
 * Every fixture is stored as logical Unicode source text — never visually
 * reordered. Shaping, BiDi, line breaking, caret, selection, and export tests
 * share these strings so one corpus covers the whole pipeline.
 */

export const BIDI_FIXTURES = {
  /** LTR paragraph with embedded RTL word and Arabic-Indic digits. */
  priceInArabic: 'The price is 125 دولار today.',
  /** RTL paragraph with embedded Latin word and European digits. */
  helloVarve: 'مرحبا Varve 2026!',
  /** LTR version line with an RTL phrase. */
  versionLine: 'Version 2.5 — الإصدار الجديد',
  /** LTR email line ending with an Arabic word. */
  emailAndArabic: 'Email: example@example.com مرحبا',
  /** Parenthesized mixed-direction phrase (bracket mirroring). */
  parensMixed: '(Hello שלום 123 مرحبا)',
  /** Pure RTL paragraph. */
  pureArabic: 'مرحبا بالعالم',
  /** Pure LTR paragraph. */
  pureLatin: 'Hello world',
  /** Numbers inside RTL. */
  numbersInRtl: 'سعر المنتج 125 دولار و ٩٩ سنت',
  /** URL inside RTL. */
  urlInRtl: 'راجع https://example.com/ar الآن',
  /** Explicit isolate controls around an embedded phrase. */
  isolates: 'قال: \u2066Hello \u2069 ثم \u2067مرحبا\u2069!',
  /** Leading/trailing punctuation in RTL. */
  rtlQuotes: '«مرحبا»',
} as const;

export const SCRIPT_FIXTURES = {
  /** Arabic: joining forms, lam-alef, harakat. */
  arabicJoining: 'العَرَبِيَّة',
  /** Arabic with ZWJ joining control. */
  arabicZwj: 'لن\u200dافتح',
  /** Persian (Farsi) text. */
  persian: 'سلام دنیا',
  /** Urdu text. */
  urdu: 'سلام دنیا',
  /** Devanagari: conjuncts, virama, pre-base matra. */
  devanagari: 'कर्मचारी के पास',
  /** Devanagari reph: r-rakar. */
  devanagariReph: 'दर्शन',
  /** Thai with vowels and tone marks. */
  thai: 'ภาษาไทยสวัสดีครับ',
  /** Thai wrapped sentence (no spaces between words). */
  thaiNoSpaces: 'นี่คือข้อความภาษาไทยที่ยาวพอจะถูกตัดแบ่งบรรทัดได้',
  /** CJK (Japanese). */
  cjk: '日本語のテキストです',
  /** Emoji ZWJ family sequence — must stay one grapheme. */
  emojiZwj: '👨‍👩‍👧‍👦',
  /** Regional indicators flag. */
  emojiFlag: '🇧🇷',
  /** Combining marks after base. */
  combining: 'e\u0301\u0300',
  /** Hebrew. */
  hebrew: 'שלום עולם',
} as const;

export const RICH_TEXT_FIXTURES = {
  /** Mixed-script single node analogous to the mandated rich-text fixture. */
  mixedScripts: 'Varve مرحبا दुनिया ภาษาไทย',
} as const;

/** Fixtures that must not split inside an extended grapheme cluster. */
export const GRAPHEME_INVARIANTS: readonly string[] = [
  SCRIPT_FIXTURES.emojiZwj,
  SCRIPT_FIXTURES.emojiFlag,
  SCRIPT_FIXTURES.combining,
  'a\u0301b\u0301',
  '\u0915\u094d\u0937', // ksha conjunct
];
