import { describe, expect, it } from 'vitest';
import { tokenBindingCompatibilityReason } from './bindingCompatibility';

describe('tokenBindingCompatibilityReason', () => {
  it('allows color tokens only on currently resolved fill and table color fields', () => {
    for (const field of [
      'fill',
      'table.headerFill',
      'table.bodyFill',
      'table.alternateFill',
      'table.borderColor',
      'table.dividerColor',
      'table.headerText',
      'table.bodyText',
      'headerFill',
      'bodyFill',
      'alternateFill',
      'borderColor',
      'dividerColor',
      'headerText',
      'bodyText',
    ]) {
      expect(tokenBindingCompatibilityReason('color', field)).toBeUndefined();
    }

    expect(tokenBindingCompatibilityReason('color', 'stroke')).toMatch(
      /no supported color binding/,
    );
    expect(tokenBindingCompatibilityReason('color', 'strokeColor')).toMatch(
      /no supported color binding/,
    );
  });

  it('allows number tokens on every currently resolved numeric field', () => {
    for (const field of [
      'opacity',
      'rotation',
      'cornerRadius',
      'x',
      'y',
      'width',
      'height',
      'fontSize',
      'lineHeight',
      'letterSpacing',
      'tracking',
      'paragraphSpacing',
      'strokeWeight:stroke-1',
    ]) {
      expect(tokenBindingCompatibilityReason('number', field)).toBeUndefined();
    }
    expect(tokenBindingCompatibilityReason('number', 'textContent')).toMatch(
      /not mapped by the scene binding resolver/,
    );
  });

  it('limits dimensions to lengths and rejects opacity and rotation', () => {
    for (const field of [
      'cornerRadius',
      'x',
      'y',
      'width',
      'height',
      'fontSize',
      'letterSpacing',
      'paragraphSpacing',
      'strokeWeight:stroke-1',
    ]) {
      expect(tokenBindingCompatibilityReason('dimension', field)).toBeUndefined();
    }

    expect(tokenBindingCompatibilityReason('dimension', 'opacity')).toMatch(
      /require a length-valued property/,
    );
    expect(tokenBindingCompatibilityReason('dimension', 'rotation')).toMatch(
      /require a length-valued property/,
    );
    expect(tokenBindingCompatibilityReason('dimension', 'lineHeight')).toMatch(
      /require a length-valued property/,
    );
  });

  it('does not imply font-family, font-weight, string, or boolean bindings', () => {
    expect(tokenBindingCompatibilityReason('fontFamily', 'textContent')).toMatch(
      /no font-family property binding/,
    );
    expect(tokenBindingCompatibilityReason('fontWeight', 'width')).toMatch(
      /no font-weight property binding/,
    );
    expect(tokenBindingCompatibilityReason('fontWeight', 'rotation')).toMatch(
      /no font-weight property binding/,
    );
    expect(tokenBindingCompatibilityReason('string', 'text')).toMatch(/not supported/);
    expect(tokenBindingCompatibilityReason('boolean', 'visible')).toMatch(/not supported/);
    expect(tokenBindingCompatibilityReason('typography', 'fontSize')).toMatch(/no supported scene/);
  });
});
