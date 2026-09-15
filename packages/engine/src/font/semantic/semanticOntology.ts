import type { FontSemanticFacet } from './semanticTypes';

export interface FontSemanticTagDefinition {
  id: string;
  label: string;
  facet: FontSemanticFacet;
  parent?: string;
  description: string;
  aliases?: string[];
  incompatibleWith?: string[];
}

const tag = (
  id: string,
  label: string,
  facet: FontSemanticFacet,
  description: string,
  extra: Pick<FontSemanticTagDefinition, 'parent' | 'aliases' | 'incompatibleWith'> = {},
): FontSemanticTagDefinition => ({ id, label, facet, description, ...extra });

/**
 * Small, versioned vocabulary for the deterministic search lane. The list is
 * intentionally curated: continuous measurements stay in the profile rather
 * than becoming hundreds of brittle boolean labels.
 */
export const FONT_SEMANTIC_TAGS: readonly FontSemanticTagDefinition[] = [
  tag('classification.serif', 'Serif', 'classification', 'Has serif construction.'),
  tag(
    'classification.serif.old-style',
    'Old-style serif',
    'classification',
    'Garalde or old-style serif construction.',
    { parent: 'classification.serif', aliases: ['garalde', 'old style'] },
  ),
  tag(
    'classification.serif.transitional',
    'Transitional serif',
    'classification',
    'Transitional serif construction.',
    { parent: 'classification.serif' },
  ),
  tag(
    'classification.serif.didone',
    'Didone',
    'classification',
    'High-contrast modern serif construction.',
    { parent: 'classification.serif', aliases: ['modern serif'] },
  ),
  tag(
    'classification.serif.slab',
    'Slab serif',
    'classification',
    'Slab or Egyptian serif construction.',
    { parent: 'classification.serif', aliases: ['slab'] },
  ),
  tag('classification.sans', 'Sans serif', 'classification', 'Sans-serif construction.', {
    aliases: ['sans', 'sans serif'],
  }),
  tag(
    'classification.sans.grotesque',
    'Grotesque sans',
    'classification',
    'Grotesque or neo-grotesque sans construction.',
    { parent: 'classification.sans', aliases: ['grotesk', 'grotesque'] },
  ),
  tag(
    'classification.sans.neo-grotesque',
    'Neo-grotesque',
    'classification',
    'Neutral neo-grotesque sans construction.',
    { parent: 'classification.sans' },
  ),
  tag(
    'classification.sans.geometric',
    'Geometric sans',
    'classification',
    'Geometric sans construction.',
    { parent: 'classification.sans', aliases: ['geometric'] },
  ),
  tag(
    'classification.sans.humanist',
    'Humanist sans',
    'classification',
    'Humanist sans construction.',
    { parent: 'classification.sans', aliases: ['humanist'] },
  ),
  tag(
    'classification.sans.rounded',
    'Rounded sans',
    'classification',
    'Rounded or softened sans construction.',
    { parent: 'classification.sans' },
  ),
  tag(
    'classification.sans.industrial',
    'Industrial sans',
    'classification',
    'Industrial or utilitarian sans construction.',
    { parent: 'classification.sans' },
  ),
  tag(
    'classification.monospace',
    'Monospace',
    'classification',
    'Fixed-width or monospaced construction.',
    { aliases: ['monospaced', 'fixed width', 'fixed-width'] },
  ),
  tag(
    'classification.script',
    'Script typeface',
    'classification',
    'Script-like typeface construction.',
    { aliases: ['script typeface'] },
  ),
  tag(
    'classification.handwriting',
    'Handwriting',
    'classification',
    'Handwritten or informal lettering construction.',
  ),
  tag('classification.blackletter', 'Blackletter', 'classification', 'Blackletter construction.'),
  tag('classification.display', 'Display', 'classification', 'Display or decorative construction.'),
  tag('classification.symbol', 'Symbol or icon', 'classification', 'Symbol or icon font behavior.'),
  tag('classification.pixel', 'Pixel or bitmap', 'classification', 'Pixel or bitmap construction.'),
  tag('classification.color', 'Color font', 'classification', 'Contains color glyph technology.'),
  tag(
    'morphology.width.condensed',
    'Condensed',
    'morphology',
    'Narrower-than-normal width evidence.',
    { aliases: ['narrow', 'compact'] },
  ),
  tag('morphology.width.expanded', 'Expanded', 'morphology', 'Wider-than-normal width evidence.'),
  tag(
    'morphology.aperture.open',
    'Open apertures',
    'morphology',
    'Open apertures in tested glyphs.',
  ),
  tag('morphology.rounded', 'Rounded forms', 'morphology', 'Rounded forms measured or curated.', {
    aliases: ['rounded'],
  }),
  tag('morphology.high-contrast', 'High contrast', 'morphology', 'High stroke-contrast evidence.'),
  tag('tone.neutral', 'Neutral', 'tone', 'Curated neutral visual impression.'),
  tag('tone.friendly', 'Friendly', 'tone', 'Curated friendly visual impression.', {
    aliases: ['approachable'],
  }),
  tag('tone.warm', 'Warm', 'tone', 'Curated warm visual impression.'),
  tag('tone.cold', 'Cool', 'tone', 'Curated cool visual impression.'),
  tag('tone.serious', 'Serious', 'tone', 'Curated serious visual impression.'),
  tag('tone.authoritative', 'Authoritative', 'tone', 'Curated authoritative visual impression.'),
  tag('tone.elegant', 'Elegant', 'tone', 'Curated elegant visual impression.'),
  tag('tone.playful', 'Playful', 'tone', 'Curated playful visual impression.'),
  tag('tone.technical', 'Technical', 'tone', 'Curated technical visual impression.'),
  tag('tone.editorial', 'Editorial', 'tone', 'Curated editorial visual impression.'),
  tag('tone.formal', 'Formal', 'tone', 'Curated formal visual impression.'),
  tag('tone.expressive', 'Expressive', 'tone', 'Curated expressive visual impression.'),
  tag('tone.contemporary', 'Contemporary', 'tone', 'Curated contemporary visual impression.'),
  tag('use.body', 'Body text', 'use', 'Likely body-text role based on evidence.', {
    aliases: ['long-form', 'reading'],
  }),
  tag('use.editorial-headline', 'Editorial headline', 'use', 'Likely editorial headline role.', {
    aliases: ['headline'],
  }),
  tag('use.display', 'Display role', 'use', 'Likely display role.', { aliases: ['poster'] }),
  tag('use.ui', 'UI', 'use', 'Likely interface role.', {
    aliases: ['interface', 'user interface'],
  }),
  tag('use.mobile-ui', 'Mobile UI', 'use', 'Likely mobile interface role.'),
  tag('use.dense-data-ui', 'Dense data UI', 'use', 'Likely dense data and table role.', {
    aliases: ['dashboard', 'data tables'],
  }),
  tag('use.code', 'Code', 'use', 'Likely programming and code role.', { aliases: ['programming'] }),
  tag('use.branding', 'Branding', 'use', 'Likely branding or logotype role.'),
  tag(
    'use.technical-documentation',
    'Technical documentation',
    'use',
    'Likely technical documentation role.',
  ),
  tag(
    'use.multilingual',
    'Multilingual publishing',
    'use',
    'Supports multiple evaluated writing systems.',
  ),
  tag('era.art-deco', 'Art Deco reference', 'era', 'Curated Art Deco design reference.'),
  tag('era.mid-century', 'Mid-century reference', 'era', 'Curated mid-century design reference.'),
  tag(
    'era.contemporary',
    'Contemporary reference',
    'era',
    'Curated contemporary design reference.',
  ),
  tag('feature.variable', 'Variable font', 'feature', 'Contains a variable font axis.', {
    aliases: ['variable'],
  }),
  tag('feature.axis-width', 'Width axis', 'feature', 'Contains a `wdth` variation axis.'),
  tag(
    'feature.axis-optical-size',
    'Optical-size axis',
    'feature',
    'Contains an `opsz` variation axis.',
  ),
  tag('feature.italic', 'Italic style', 'feature', 'An italic style is available.', {
    aliases: ['italic', 'italics'],
  }),
  tag('feature.small-caps', 'Small caps', 'feature', 'Small-cap feature was detected.'),
  tag('feature.liga', 'Standard ligatures', 'feature', 'Standard ligatures were detected.'),
  tag('feature.tnum', 'Tabular numerals', 'feature', 'Tabular lining numerals were detected.'),
  tag('feature.onum', 'Old-style numerals', 'feature', 'Old-style numerals were detected.'),
  tag('feature.color-glyphs', 'Color glyphs', 'feature', 'Color glyph tables were detected.'),
  tag('coverage.script.latn', 'Latin', 'coverage', 'Latin script coverage.'),
  tag('coverage.script.cyrl', 'Cyrillic', 'coverage', 'Cyrillic script coverage.'),
  tag('coverage.script.grek', 'Greek', 'coverage', 'Greek script coverage.'),
  tag('coverage.script.arab', 'Arabic', 'coverage', 'Arabic script coverage.'),
  tag('coverage.script.hebr', 'Hebrew', 'coverage', 'Hebrew script coverage.'),
  tag('coverage.script.deva', 'Devanagari', 'coverage', 'Devanagari script coverage.'),
  tag('coverage.script.hani', 'CJK', 'coverage', 'Han/CJK coverage.'),
  tag('coverage.script.hang', 'Hangul', 'coverage', 'Hangul coverage.'),
  tag('coverage.script.kana', 'Kana', 'coverage', 'Kana coverage.'),
  tag('coverage.script.thai', 'Thai', 'coverage', 'Thai coverage.'),
  tag('coverage.language.vietnamese', 'Vietnamese', 'coverage', 'Vietnamese language coverage.'),
  tag('source.installed', 'Installed', 'source', 'A usable local face is installed.'),
  tag(
    'source.downloadable',
    'Downloadable',
    'source',
    'An exact catalog artifact can be installed.',
  ),
  tag(
    'source.fontsource',
    'Fontsource',
    'source',
    'Family is present in the shipped Fontsource catalog.',
  ),
  tag(
    'source.open-source',
    'Open-source license',
    'source',
    'License permits commercial use and redistribution.',
  ),
] as const;

export const FONT_SEMANTIC_TAGS_BY_ID = new Map(
  FONT_SEMANTIC_TAGS.map((definition) => [definition.id, definition]),
);

const SYNONYMS = new Map<string, string>();
for (const definition of FONT_SEMANTIC_TAGS) {
  SYNONYMS.set(definition.label.toLocaleLowerCase(), definition.id);
  for (const alias of definition.aliases ?? [])
    SYNONYMS.set(alias.toLocaleLowerCase(), definition.id);
}

export function tagDefinition(tagId: string): FontSemanticTagDefinition | undefined {
  return FONT_SEMANTIC_TAGS_BY_ID.get(tagId);
}

export function tagLabel(tagId: string): string {
  return tagDefinition(tagId)?.label ?? tagId;
}

export function tagIdForTerm(term: string): string | undefined {
  return SYNONYMS.get(term.trim().toLocaleLowerCase());
}

export function allSemanticSynonyms(): ReadonlyMap<string, string> {
  return SYNONYMS;
}

/** Validate the graph before generated or curated data is accepted. */
export function validateFontSemanticOntology(
  definitions: readonly FontSemanticTagDefinition[] = FONT_SEMANTIC_TAGS,
): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!/^([a-z][a-z0-9-]*\.)+[a-z][a-z0-9-]*$/.test(definition.id)) {
      throw new Error(`Invalid semantic tag id: ${definition.id}`);
    }
    if (ids.has(definition.id)) throw new Error(`Duplicate semantic tag id: ${definition.id}`);
    ids.add(definition.id);
  }
  for (const definition of definitions) {
    if (definition.parent && !ids.has(definition.parent)) {
      throw new Error(`Unknown semantic tag parent: ${definition.parent}`);
    }
    for (const incompatible of definition.incompatibleWith ?? []) {
      if (!ids.has(incompatible)) throw new Error(`Unknown incompatible tag: ${incompatible}`);
    }
  }
  for (const definition of definitions) {
    const visiting = new Set<string>();
    let current: string | undefined = definition.id;
    while (current) {
      if (visiting.has(current)) throw new Error(`Semantic tag parent cycle at ${current}`);
      visiting.add(current);
      current = definitions.find((candidate) => candidate.id === current)?.parent;
    }
  }
}

validateFontSemanticOntology();
