import { getFontRegistry } from '@varve/engine';
import type { TextNode } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';

/** A family-only choice must not retain a reference to a different artifact. */
export function fontFamilyChanges(family: string | undefined): Partial<TextNode> {
  return { fontFamily: family, fontReference: undefined };
}

/**
 * Apply the authored weight to a text node while keeping a declared weight
 * axis in sync. Other variation axes belong to the author and are retained.
 */
export function fontWeightChanges(
  node: TextNode,
  weight: number,
  registry: ReturnType<typeof getFontRegistry> = getFontRegistry(),
): Partial<TextNode> {
  const family = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  const hasWeightAxis =
    registry.getAxisDefinitions(family)?.some((axis) => axis.tag === 'wght') === true ||
    node.variableAxes?.wght !== undefined;
  return hasWeightAxis
    ? { fontWeight: weight, variableAxes: { ...(node.variableAxes ?? {}), wght: weight } }
    : { fontWeight: weight };
}
