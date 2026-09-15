/**
 * Icon variant model — typed definitions for icon style variants and state transitions.
 */

export type IconVariantStyle =
  | 'outline'
  | 'filled'
  | 'sharp'
  | 'rounded'
  | 'duotone'
  | 'thin'
  | 'regular'
  | 'bold';

export type IconState =
  | 'default'
  | 'active'
  | 'inactive'
  | 'checked'
  | 'unchecked'
  | 'indeterminate'
  | 'open'
  | 'closed'
  | 'enabled'
  | 'disabled';

export interface IconVariantDefinition {
  id: string;
  name: string;
  style: IconVariantStyle;
  weight?: 'thin' | 'light' | 'regular' | 'bold';
  state?: IconState;
  svg: string;
  viewBox: string;
}

export interface IconVariantFamily {
  concept: string;
  variants: IconVariantDefinition[];
  defaultVariantId: string;
}

export function createIconVariant(
  concept: string,
  style: IconVariantStyle,
  svg: string,
  options: Partial<Omit<IconVariantDefinition, 'concept' | 'style' | 'svg'>> = {},
): IconVariantDefinition {
  const id = options.id ?? `${concept}-${style}`;
  return {
    id,
    name: options.name ?? `${concept} (${style})`,
    style,
    weight: options.weight,
    state: options.state ?? 'default',
    svg,
    viewBox: options.viewBox ?? '0 0 24 24',
  };
}

export function createIconVariantFamily(
  concept: string,
  variants: Array<{ style: IconVariantStyle; svg: string; state?: IconState }>,
  defaultStyle: IconVariantStyle = 'outline',
): IconVariantFamily {
  const variantDefs = variants.map((v) =>
    createIconVariant(concept, v.style, v.svg, { state: v.state }),
  );
  return {
    concept,
    variants: variantDefs,
    defaultVariantId: `${concept}-${defaultStyle}`,
  };
}

export function resolveVariant(
  family: IconVariantFamily,
  preferences: { style?: IconVariantStyle; state?: IconState } = {},
): IconVariantDefinition | null {
  const { style, state } = preferences;
  if (!style && !state) {
    return family.variants.find((v) => v.id === family.defaultVariantId) ?? null;
  }
  if (style && state) {
    const match = family.variants.find((v) => v.style === style && v.state === state);
    if (match) return match;
  }
  if (style) {
    const match = family.variants.find((v) => v.style === style);
    if (match) return match;
    return null;
  }
  if (state) {
    const defaultStyle = getDefaultStyle(family);
    const match = family.variants.find((v) => v.style === defaultStyle && v.state === state);
    if (match) return match;
  }
  return family.variants.find((v) => v.id === family.defaultVariantId) ?? null;
}

function getDefaultStyle(family: IconVariantFamily): IconVariantStyle {
  const defaultVariant = family.variants.find((v) => v.id === family.defaultVariantId);
  return defaultVariant?.style ?? 'outline';
}

export function getAvailableStyles(family: IconVariantFamily): IconVariantStyle[] {
  return [...new Set(family.variants.map((v) => v.style))];
}

export function getAvailableStates(family: IconVariantFamily): IconState[] {
  return [...new Set(family.variants.map((v) => v.state ?? 'default'))];
}
