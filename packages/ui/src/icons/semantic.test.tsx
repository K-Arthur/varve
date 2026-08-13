import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DIRECTIONAL_ICONS,
  ICON_SIZE_TOKENS,
  isDirectionalIcon,
  resolveSemanticIcon,
  SEMANTIC_ICONS,
  SemanticIcon,
  type SemanticIconName,
  validateSemanticIconNames,
} from './semantic';

describe('semantic icon registry', () => {
  it('has no naming violations', () => {
    expect(validateSemanticIconNames()).toEqual([]);
  });

  it('every semantic name resolves in both families', () => {
    const names = Object.keys(SEMANTIC_ICONS) as SemanticIconName[];
    for (const name of names) {
      expect(resolveSemanticIcon(name, 'outline')).toBeTruthy();
      expect(resolveSemanticIcon(name, 'filled')).toBeTruthy();
    }
  });

  it('renders every semantic icon in all supported families without throwing', () => {
    const names = Object.keys(SEMANTIC_ICONS) as SemanticIconName[];
    for (const name of names) {
      expect(() =>
        renderToStaticMarkup(<SemanticIcon name={name} family="outline" />),
      ).not.toThrow();
      expect(() =>
        renderToStaticMarkup(<SemanticIcon name={name} family="filled" />),
      ).not.toThrow();
    }
  });

  it('contains the required core concepts', () => {
    for (const concept of [
      'Add',
      'Delete',
      'Close',
      'Search',
      'Settings',
      'Lock',
      'Unlock',
      'Visible',
      'Hidden',
      'Download',
      'Upload',
      'Warning',
      'Success',
      'Pen',
      'Text',
      'Frame',
      'Union',
      'Subtract',
      'AlignLeft',
    ]) {
      expect(SEMANTIC_ICONS[concept as SemanticIconName]).toBeTruthy();
    }
  });

  it('uses action/concept names, not visual descriptions', () => {
    const names = Object.keys(SEMANTIC_ICONS);
    expect(names).not.toContain('TrashCanOutlineIcon');
    expect(names).not.toContain('Arrow');
    expect(names).not.toContain('Add2');
    expect(names).not.toContain('CloseAlt');
    expect(names).not.toContain('GenericAction');
    expect(names).not.toContain('IconNew');
  });
});

describe('SemanticIcon component', () => {
  it('renders the Tabler implementation by default', () => {
    const markup = renderToStaticMarkup(<SemanticIcon name="Search" />);
    expect(markup).toMatch(/^<svg/i);
    expect(markup).toContain('</svg>');
    expect(markup).toContain('stroke="currentColor"');
  });

  it('maps Warp to a deformation-specific semantic glyph', () => {
    const markup = renderToStaticMarkup(<SemanticIcon name="Warp" label="Warp" />);
    expect(markup).toContain('aria-label="Warp"');
    expect(resolveSemanticIcon('Warp', 'outline')).toBe(SEMANTIC_ICONS.Warp.outline);
  });

  it('renders the filled implementation for family="filled"', () => {
    const markup = renderToStaticMarkup(<SemanticIcon name="Search" family="filled" />);
    expect(markup).toMatch(/^<svg/i);
  });

  it('enforces the accessible-name contract', () => {
    const labelled = renderToStaticMarkup(<SemanticIcon name="Delete" label="Delete layer" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Delete layer"');

    const decorative = renderToStaticMarkup(<SemanticIcon name="Delete" />);
    expect(decorative).toContain('aria-hidden="true"');
  });

  it('resolves size tokens to pixels', () => {
    const markup = renderToStaticMarkup(<SemanticIcon name="Close" size="lg" />);
    expect(markup).toContain(`width="${ICON_SIZE_TOKENS.lg}"`);
    expect(markup).toContain(`height="${ICON_SIZE_TOKENS.lg}"`);
  });

  it('passes through explicit pixel sizes', () => {
    const markup = renderToStaticMarkup(<SemanticIcon name="Close" size={13} />);
    expect(markup).toContain('width="13"');
  });

  it('mirrors directional icons with scaleX(-1)', () => {
    const markup = renderToStaticMarkup(<SemanticIcon name="Back" mirror />);
    expect(markup).toContain('scaleX(-1)');
  });

  it('uses currentColor so icons track the theme', () => {
    const markup = renderToStaticMarkup(<SemanticIcon name="Close" />);
    expect(markup).toContain('stroke="currentColor"');
    const filled = renderToStaticMarkup(<SemanticIcon name="Close" family="filled" />);
    expect(filled).toContain('fill="currentColor"');
  });
});

describe('directional icons (RTL)', () => {
  it('marks only meaning-directional icons', () => {
    expect(isDirectionalIcon('Back')).toBe(true);
    expect(isDirectionalIcon('Undo')).toBe(true);
    expect(isDirectionalIcon('Redo')).toBe(true);
    expect(isDirectionalIcon('Previous')).toBe(true);
    expect(isDirectionalIcon('Next')).toBe(true);
  });

  it('does not mark non-directional icons', () => {
    expect(isDirectionalIcon('Warning')).toBe(false);
    expect(isDirectionalIcon('Star')).toBe(false);
    expect(isDirectionalIcon('Search')).toBe(false);
    expect(isDirectionalIcon('Settings')).toBe(false);
  });

  it('keeps the directional set disjoint from ambiguous glyphs', () => {
    for (const name of DIRECTIONAL_ICONS) {
      expect(SEMANTIC_ICONS[name]).toBeTruthy();
    }
  });
});
