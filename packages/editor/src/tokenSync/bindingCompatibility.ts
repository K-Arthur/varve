/**
 * Property compatibility for authored DTCG tokens linked to existing scene
 * bindings. This mirrors the fields currently resolved by
 * `packages/scene/src/bindings.ts`; token validity alone does not imply that a
 * token can drive a particular editor property.
 */

const COLOR_FIELDS = new Set([
  'fill',
  'table.headerFill',
  'table.bodyFill',
  'table.alternateFill',
  'table.borderColor',
  'table.dividerColor',
  'table.headerText',
  'table.bodyText',
  // TableAppearanceSection's transient BindingMenu targetField uses these
  // explicit paint names; onBind persists them as `table.<field>`.
  'headerFill',
  'bodyFill',
  'alternateFill',
  'borderColor',
  'dividerColor',
  'headerText',
  'bodyText',
]);

const NUMERIC_FIELDS = new Set([
  'opacity',
  'rotation',
  'cornerRadius',
  'x',
  'y',
  'w',
  'width',
  'h',
  'height',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'tracking',
  'paragraphSpacing',
]);

/** Numeric properties whose values represent lengths rather than ratios/angles. */
const DIMENSION_FIELDS = new Set([
  'cornerRadius',
  'x',
  'y',
  'w',
  'width',
  'h',
  'height',
  'fontSize',
  'letterSpacing',
  'paragraphSpacing',
]);

function isStrokeWeightField(property: string): boolean {
  return property.startsWith('strokeWeight:') && property.length > 'strokeWeight:'.length;
}

function isNumericField(property: string): boolean {
  return NUMERIC_FIELDS.has(property) || isStrokeWeightField(property);
}

function isDimensionField(property: string): boolean {
  return DIMENSION_FIELDS.has(property) || isStrokeWeightField(property);
}

/**
 * Explain why an authored DTCG token cannot drive a concrete scene property.
 * `undefined` means the existing scene resolver supports this pairing.
 *
 * This intentionally does not claim font family/weight or stroke-color
 * bindings: those values may be valid DTCG tokens, but the current scene
 * binding resolver has no corresponding property application path.
 */
export function tokenBindingCompatibilityReason(
  tokenType: string,
  property: string,
): string | undefined {
  if (tokenType === 'color') {
    return COLOR_FIELDS.has(property)
      ? undefined
      : `Color tokens can bind only to fill or table appearance colors; “${property}” has no supported color binding.`;
  }

  if (tokenType === 'number') {
    return isNumericField(property)
      ? undefined
      : `Number tokens can bind only to properties that accept numeric variable values; “${property}” is not mapped by the scene binding resolver.`;
  }

  if (tokenType === 'dimension') {
    if (isDimensionField(property)) return undefined;
    if (isNumericField(property)) {
      return `Dimension tokens require a length-valued property; “${property}” expects a unitless, ratio, or angle value.`;
    }
    return `Dimension tokens can bind only to supported length properties; “${property}” has no compatible scene binding.`;
  }

  if (tokenType === 'fontFamily') {
    return 'Font family tokens are retained, but the current scene binding resolver has no font-family property binding.';
  }

  if (tokenType === 'fontWeight') {
    return 'Font weight tokens are retained, but the current scene binding resolver has no font-weight property binding.';
  }

  if (tokenType === 'string' || tokenType === 'boolean') {
    return `${tokenType} tokens are retained in DTCG source, but linked property bindings for this type are not supported.`;
  }

  return `The ${tokenType} token type is retained in DTCG source, but has no supported scene property binding.`;
}
