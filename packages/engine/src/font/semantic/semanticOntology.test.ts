import { describe, expect, it } from 'vitest';
import {
  FONT_SEMANTIC_TAGS,
  tagDefinition,
  tagIdForTerm,
  validateFontSemanticOntology,
} from './semanticOntology';

describe('font semantic ontology', () => {
  it('has unique namespaced ids and a valid parent graph', () => {
    expect(() => validateFontSemanticOntology()).not.toThrow();
    expect(new Set(FONT_SEMANTIC_TAGS.map((tag) => tag.id)).size).toBe(FONT_SEMANTIC_TAGS.length);
    expect(tagDefinition('classification.sans.humanist')?.parent).toBe('classification.sans');
  });

  it('keeps aliases separate from canonical ids', () => {
    expect(tagIdForTerm('grotesk')).toBe('classification.sans.grotesque');
    expect(tagIdForTerm('fixed width')).toBe('classification.monospace');
    expect(tagIdForTerm('tabular numerals')).toBe('feature.tnum');
  });

  it('rejects duplicate ids and parent cycles', () => {
    const duplicate = [...FONT_SEMANTIC_TAGS, FONT_SEMANTIC_TAGS[0]!];
    expect(() => validateFontSemanticOntology(duplicate)).toThrow(/Duplicate/);
    expect(() =>
      validateFontSemanticOntology([
        { id: 'x.one', label: 'One', facet: 'tone', description: '', parent: 'x.two' },
        { id: 'x.two', label: 'Two', facet: 'tone', description: '', parent: 'x.one' },
      ]),
    ).toThrow(/cycle/i);
  });
});
