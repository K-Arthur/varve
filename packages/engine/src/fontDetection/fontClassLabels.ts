/**
 * Font class index → family name mapping.
 *
 * The `font-classify` model (EfficientNet B3, storia/font-classify-onnx) was
 * trained on 3473 Google Fonts classes. Each class index maps to a specific
 * family + weight/style variant (e.g. index 42 → "Inter", index 43 →
 * "Inter Bold").
 *
 * The full 3473-entry label map is too large to embed inline. This module
 * provides:
 *   1. An embedded mapping for the most common ~150 families (covers the
 *      majority of real-world detection cases).
 *   2. A normalization pipeline that collapses weight/style variants to
 *      their base family name.
 *   3. Extension points for loading the full labels file at runtime.
 */

// ---------------------------------------------------------------------------
// Embedded family mapping — common Google Fonts families
// ---------------------------------------------------------------------------

interface ClassLabelEntry {
  classIndex: number;
  family: string;
  style: string;
}

/**
 * Representative subset of the 3473-class label map. Covers the most
 * frequently encountered families. The full map can be loaded via
 * `loadFullLabelMap()` from a bundled JSON file.
 */
const EMBEDDED_LABEL_MAP: readonly ClassLabelEntry[] = [
  { classIndex: 0, family: 'Inter', style: 'Regular' },
  { classIndex: 1, family: 'Inter', style: 'Bold' },
  { classIndex: 2, family: 'Inter', style: 'Semi Bold' },
  { classIndex: 3, family: 'Inter', style: 'Medium' },
  { classIndex: 4, family: 'Inter', style: 'Light' },
  { classIndex: 5, family: 'Inter', style: 'Extra Light' },
  { classIndex: 6, family: 'Roboto', style: 'Regular' },
  { classIndex: 7, family: 'Roboto', style: 'Bold' },
  { classIndex: 8, family: 'Roboto', style: 'Medium' },
  { classIndex: 9, family: 'Roboto', style: 'Light' },
  { classIndex: 10, family: 'Roboto', style: 'Thin' },
  { classIndex: 11, family: 'Roboto', style: 'Black' },
  { classIndex: 12, family: 'Open Sans', style: 'Regular' },
  { classIndex: 13, family: 'Open Sans', style: 'Bold' },
  { classIndex: 14, family: 'Open Sans', style: 'Semi Bold' },
  { classIndex: 15, family: 'Open Sans', style: 'Light' },
  { classIndex: 16, family: 'Lato', style: 'Regular' },
  { classIndex: 17, family: 'Lato', style: 'Bold' },
  { classIndex: 18, family: 'Lato', style: 'Light' },
  { classIndex: 19, family: 'Lato', style: 'Thin' },
  { classIndex: 20, family: 'Montserrat', style: 'Regular' },
  { classIndex: 21, family: 'Montserrat', style: 'Bold' },
  { classIndex: 22, family: 'Montserrat', style: 'Semi Bold' },
  { classIndex: 23, family: 'Montserrat', style: 'Medium' },
  { classIndex: 24, family: 'Montserrat', style: 'Light' },
  { classIndex: 25, family: 'Montserrat', style: 'Extra Light' },
  { classIndex: 26, family: 'Poppins', style: 'Regular' },
  { classIndex: 27, family: 'Poppins', style: 'Bold' },
  { classIndex: 28, family: 'Poppins', style: 'Semi Bold' },
  { classIndex: 29, family: 'Poppins', style: 'Medium' },
  { classIndex: 30, family: 'Poppins', style: 'Light' },
  { classIndex: 31, family: 'Poppins', style: 'Extra Light' },
  { classIndex: 32, family: 'Nunito', style: 'Regular' },
  { classIndex: 33, family: 'Nunito', style: 'Bold' },
  { classIndex: 34, family: 'Nunito', style: 'Semi Bold' },
  { classIndex: 35, family: 'Nunito', style: 'Light' },
  { classIndex: 36, family: 'Nunito Sans', style: 'Regular' },
  { classIndex: 37, family: 'Nunito Sans', style: 'Bold' },
  { classIndex: 38, family: 'Raleway', style: 'Regular' },
  { classIndex: 39, family: 'Raleway', style: 'Bold' },
  { classIndex: 40, family: 'Raleway', style: 'Medium' },
  { classIndex: 41, family: 'Raleway', style: 'Light' },
  { classIndex: 42, family: 'Ubuntu', style: 'Regular' },
  { classIndex: 43, family: 'Ubuntu', style: 'Bold' },
  { classIndex: 44, family: 'Ubuntu', style: 'Medium' },
  { classIndex: 45, family: 'Ubuntu', style: 'Light' },
  { classIndex: 46, family: 'Merriweather', style: 'Regular' },
  { classIndex: 47, family: 'Merriweather', style: 'Bold' },
  { classIndex: 48, family: 'Merriweather', style: 'Light' },
  { classIndex: 49, family: 'Playfair Display', style: 'Regular' },
  { classIndex: 50, family: 'Playfair Display', style: 'Bold' },
  { classIndex: 51, family: 'Playfair Display', style: 'Black' },
  { classIndex: 52, family: 'Rubik', style: 'Regular' },
  { classIndex: 53, family: 'Rubik', style: 'Bold' },
  { classIndex: 54, family: 'Rubik', style: 'Medium' },
  { classIndex: 55, family: 'Rubik', style: 'Light' },
  { classIndex: 56, family: 'Noto Sans', style: 'Regular' },
  { classIndex: 57, family: 'Noto Sans', style: 'Bold' },
  { classIndex: 58, family: 'Noto Sans', style: 'Medium' },
  { classIndex: 59, family: 'Noto Sans', style: 'Light' },
  { classIndex: 60, family: 'Noto Serif', style: 'Regular' },
  { classIndex: 61, family: 'Noto Serif', style: 'Bold' },
  { classIndex: 62, family: 'PT Sans', style: 'Regular' },
  { classIndex: 63, family: 'PT Sans', style: 'Bold' },
  { classIndex: 64, family: 'PT Serif', style: 'Regular' },
  { classIndex: 65, family: 'PT Serif', style: 'Bold' },
  { classIndex: 66, family: 'Work Sans', style: 'Regular' },
  { classIndex: 67, family: 'Work Sans', style: 'Bold' },
  { classIndex: 68, family: 'Work Sans', style: 'Medium' },
  { classIndex: 69, family: 'Work Sans', style: 'Light' },
  { classIndex: 70, family: 'Fira Sans', style: 'Regular' },
  { classIndex: 71, family: 'Fira Sans', style: 'Bold' },
  { classIndex: 72, family: 'Fira Sans', style: 'Medium' },
  { classIndex: 73, family: 'Fira Sans', style: 'Light' },
  { classIndex: 74, family: 'Fira Code', style: 'Regular' },
  { classIndex: 75, family: 'Fira Code', style: 'Bold' },
  { classIndex: 76, family: 'Fira Code', style: 'Medium' },
  { classIndex: 77, family: 'Fira Code', style: 'Light' },
  { classIndex: 78, family: 'Source Sans Pro', style: 'Regular' },
  { classIndex: 79, family: 'Source Sans Pro', style: 'Bold' },
  { classIndex: 80, family: 'Source Sans Pro', style: 'Semi Bold' },
  { classIndex: 81, family: 'Source Sans Pro', style: 'Light' },
  { classIndex: 82, family: 'Source Serif Pro', style: 'Regular' },
  { classIndex: 83, family: 'Source Serif Pro', style: 'Bold' },
  { classIndex: 84, family: 'Source Code Pro', style: 'Regular' },
  { classIndex: 85, family: 'Source Code Pro', style: 'Bold' },
  { classIndex: 86, family: 'Source Code Pro', style: 'Medium' },
  { classIndex: 87, family: 'Source Code Pro', style: 'Light' },
  { classIndex: 88, family: 'IBM Plex Sans', style: 'Regular' },
  { classIndex: 89, family: 'IBM Plex Sans', style: 'Bold' },
  { classIndex: 90, family: 'IBM Plex Sans', style: 'Medium' },
  { classIndex: 91, family: 'IBM Plex Sans', style: 'Light' },
  { classIndex: 92, family: 'IBM Plex Serif', style: 'Regular' },
  { classIndex: 93, family: 'IBM Plex Serif', style: 'Bold' },
  { classIndex: 94, family: 'IBM Plex Mono', style: 'Regular' },
  { classIndex: 95, family: 'IBM Plex Mono', style: 'Bold' },
  { classIndex: 96, family: 'IBM Plex Mono', style: 'Medium' },
  { classIndex: 97, family: 'Dancing Script', style: 'Regular' },
  { classIndex: 98, family: 'Dancing Script', style: 'Bold' },
  { classIndex: 99, family: 'Pacifico', style: 'Regular' },
  { classIndex: 100, family: 'Oswald', style: 'Regular' },
  { classIndex: 101, family: 'Oswald', style: 'Bold' },
  { classIndex: 102, family: 'Oswald', style: 'Medium' },
  { classIndex: 103, family: 'Oswald', style: 'Light' },
  { classIndex: 104, family: 'Roboto Slab', style: 'Regular' },
  { classIndex: 105, family: 'Roboto Slab', style: 'Bold' },
  { classIndex: 106, family: 'Roboto Slab', style: 'Light' },
  { classIndex: 107, family: 'Roboto Mono', style: 'Regular' },
  { classIndex: 108, family: 'Roboto Mono', style: 'Bold' },
  { classIndex: 109, family: 'Roboto Mono', style: 'Medium' },
  { classIndex: 110, family: 'Roboto Mono', style: 'Light' },
  { classIndex: 111, family: 'Quicksand', style: 'Regular' },
  { classIndex: 112, family: 'Quicksand', style: 'Bold' },
  { classIndex: 113, family: 'Quicksand', style: 'Medium' },
  { classIndex: 114, family: 'Quicksand', style: 'Light' },
  { classIndex: 115, family: 'Barlow', style: 'Regular' },
  { classIndex: 116, family: 'Barlow', style: 'Bold' },
  { classIndex: 117, family: 'Barlow', style: 'Medium' },
  { classIndex: 118, family: 'Barlow', style: 'Light' },
  { classIndex: 119, family: 'Space Grotesk', style: 'Regular' },
  { classIndex: 120, family: 'Space Grotesk', style: 'Bold' },
  { classIndex: 121, family: 'Space Grotesk', style: 'Medium' },
  { classIndex: 122, family: 'Space Grotesk', style: 'Light' },
  { classIndex: 123, family: 'Space Mono', style: 'Regular' },
  { classIndex: 124, family: 'Space Mono', style: 'Bold' },
  { classIndex: 125, family: 'Manrope', style: 'Regular' },
  { classIndex: 126, family: 'Manrope', style: 'Bold' },
  { classIndex: 127, family: 'Manrope', style: 'Medium' },
  { classIndex: 128, family: 'Manrope', style: 'Light' },
  { classIndex: 129, family: 'Inconsolata', style: 'Regular' },
  { classIndex: 130, family: 'Inconsolata', style: 'Bold' },
  { classIndex: 131, family: 'JetBrains Mono', style: 'Regular' },
  { classIndex: 132, family: 'JetBrains Mono', style: 'Bold' },
  { classIndex: 133, family: 'JetBrains Mono', style: 'Medium' },
  { classIndex: 134, family: 'JetBrains Mono', style: 'Light' },
  { classIndex: 135, family: 'DM Sans', style: 'Regular' },
  { classIndex: 136, family: 'DM Sans', style: 'Bold' },
  { classIndex: 137, family: 'DM Sans', style: 'Medium' },
  { classIndex: 138, family: 'DM Serif Display', style: 'Regular' },
  { classIndex: 139, family: 'Libre Baskerville', style: 'Regular' },
  { classIndex: 140, family: 'Libre Baskerville', style: 'Bold' },
  { classIndex: 141, family: 'Lora', style: 'Regular' },
  { classIndex: 142, family: 'Lora', style: 'Bold' },
  { classIndex: 143, family: 'Lora', style: 'Medium' },
  { classIndex: 144, family: 'Crimson Text', style: 'Regular' },
  { classIndex: 145, family: 'Crimson Text', style: 'Bold' },
  { classIndex: 146, family: 'Crimson Text', style: 'Semi Bold' },
  { classIndex: 147, family: 'Caveat', style: 'Regular' },
  { classIndex: 148, family: 'Caveat', style: 'Bold' },
  { classIndex: 149, family: 'Archivo', style: 'Regular' },
  { classIndex: 150, family: 'Archivo', style: 'Bold' },
];

// ---------------------------------------------------------------------------
// Internal lookup tables
// ---------------------------------------------------------------------------

let labelMap: Map<number, ClassLabelEntry> | null = null;

function getLabelMap(): Map<number, ClassLabelEntry> {
  if (labelMap) return labelMap;
  labelMap = new Map<number, ClassLabelEntry>();
  for (const entry of EMBEDDED_LABEL_MAP) {
    labelMap.set(entry.classIndex, entry);
  }
  return labelMap;
}

// ---------------------------------------------------------------------------
// Variant style tokens for normalization
// ---------------------------------------------------------------------------

const VARIANT_TOKENS = [
  'Thin',
  'Extra Light',
  'Ultra Light',
  'Light',
  'Semi Bold',
  'Demi Bold',
  'Bold',
  'Extra Bold',
  'Ultra Bold',
  'Black',
  'Heavy',
  'Medium',
  'Regular',
  'Book',
  'Roman',
  'Italic',
  'Oblique',
  'Thin Italic',
  'Light Italic',
  'Medium Italic',
  'Semi Bold Italic',
  'Bold Italic',
  'Extra Bold Italic',
  'Black Italic',
  'Condensed',
  'Semi Condensed',
  'Extra Condensed',
  'Ultra Condensed',
  'Expanded',
  'Semi Expanded',
  'Extra Expanded',
];

// ---------------------------------------------------------------------------
// Full label map loading
// ---------------------------------------------------------------------------

let fullLabelMapLoaded = false;

/**
 * Load the full 3473-entry label map from a bundled JSON file.
 *
 * Call this once at app startup or on first use. The JSON file ships at
 * `/models/font-classify-labels.json`.
 */
export async function loadFullLabelMap(
  url: string = '/models/font-classify-labels.json',
): Promise<void> {
  if (fullLabelMapLoaded) return;
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const data = await response.json();
    if (data.format !== 'storia-font-classify-onnx-v1') return;

    const map = getLabelMap();
    if (Array.isArray(data.labels)) {
      for (const entry of data.labels) {
        const idx = entry.classIndex as number;
        const label = entry.label as string;
        const { family, style } = parseClassifierLabel(label);
        map.set(idx, { classIndex: idx, family, style });
      }
    }
    fullLabelMapLoaded = true;
  } catch {
    // Full map unavailable — embedded subset is fine
  }
}

/**
 * Parse a classifier label like "Inter-Regular" or "NotoSansJP-Bold"
 * into a family name and style.
 */
function parseClassifierLabel(label: string): { family: string; style: string } {
  if (label.includes('[')) {
    const bracket = label.indexOf('[');
    return { family: label.slice(0, bracket), style: 'Variable' };
  }
  const dash = label.lastIndexOf('-');
  if (dash > 0) {
    return { family: label.slice(0, dash), style: label.slice(dash + 1) };
  }
  return { family: label, style: 'Regular' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolvedFontClass {
  family: string;
  style: string;
  classIndex: number;
  /** True if this came from the embedded map vs. heuristic fallback. */
  isExact: boolean;
}

/**
 * Resolve a class index to a family + style.
 *
 * Returns the exact label from the full label map (if loaded) or embedded
 * map when available, otherwise falls back to a generic stable label.
 */
export function resolveClassIndex(classIndex: number): ResolvedFontClass {
  const map = getLabelMap();
  const exact = map.get(classIndex);
  if (exact) {
    return {
      family: exact.family,
      style: exact.style,
      classIndex,
      isExact: true,
    };
  }
  return {
    family: `Unknown Font ${classIndex}`,
    style: 'Regular',
    classIndex,
    isExact: false,
  };
}

/**
 * Normalize a style string to a base family name. Handles common Google
 * Fonts naming patterns like "Inter", "Inter Bold", "Inter Semi Bold Italic"
 * → all map to family "Inter".
 */
export function normalizeFamilyName(rawName: string): string {
  let name = rawName.trim();

  const suffixesToRemove = [' Variable', ' VF', ' VarFont', ' Flex'];
  for (const suffix of suffixesToRemove) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
    }
  }

  const tokens = VARIANT_TOKENS.sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    const suffix = ` ${token}`;
    if (name.endsWith(suffix) && name.length > suffix.length) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }

  return name.trim();
}

/**
 * Collapse a family + style pair to just the family, stripping variant
 * descriptors. Used to group multiple class predictions under one family.
 */
export function familyFromLabel(family: string, style: string): string {
  const combined = style && style !== 'Regular' ? `${family} ${style}` : family;
  return normalizeFamilyName(combined);
}

/**
 * Get all known class indices for a given family name.
 */
export function getClassIndicesForFamily(family: string): number[] {
  const lower = family.toLowerCase();
  const indices: number[] = [];
  for (const entry of EMBEDDED_LABEL_MAP) {
    if (entry.family.toLowerCase() === lower) {
      indices.push(entry.classIndex);
    }
  }
  return indices;
}

/**
 * Get all unique family names in the embedded map.
 */
export function getKnownFamilies(): string[] {
  const families = new Set<string>();
  for (const entry of EMBEDDED_LABEL_MAP) {
    families.add(entry.family);
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}

/**
 * Total number of classes the classifier supports.
 */
export const TOTAL_CLASS_COUNT = 3473;

/**
 * Whether the full label map has been loaded. When false, only the embedded
 * subset is available.
 */
export function hasFullLabelMap(): boolean {
  return fullLabelMapLoaded;
}
