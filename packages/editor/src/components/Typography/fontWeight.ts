import { getFontRegistry } from '@varve/engine';
import { fontReferenceKey } from '@varve/engine/font';
import type { TextNode } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';

/** Values shown by the compact and inspector weight controls. */
export interface FontWeightOption {
  value: number;
  label: string;
  /** A persisted value that the selected face cannot provide. */
  disabled?: boolean;
  disabledReason?: string;
}

type WeightNode = Pick<TextNode, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'fontReference'>;

const STANDARD_WEIGHT_STOPS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

function nodesList(nodeOrNodes: WeightNode | readonly WeightNode[]): readonly WeightNode[] {
  return Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes as WeightNode];
}

function supportedWeights(
  node: WeightNode,
  registry: ReturnType<typeof getFontRegistry>,
): Set<number> {
  const family = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  const entries = registry.getEntries(family);
  const requestedFaceKey = node.fontReference
    ? fontReferenceKey(node.fontReference).toLowerCase()
    : undefined;
  const entriesWithIdentity = entries.filter((entry) => entry.faceKey);
  const exactKeyEntries = requestedFaceKey
    ? entries.filter((entry) => entry.faceKey?.toLowerCase() === requestedFaceKey)
    : [];
  const postScriptEntries = node.fontReference?.postScriptName
    ? entries.filter(
        (entry) =>
          entry.postScriptName?.toLowerCase() === node.fontReference?.postScriptName?.toLowerCase(),
      )
    : [];
  const exactEntries = node.fontReference
    ? exactKeyEntries.length > 0
      ? exactKeyEntries
      : entriesWithIdentity.length === 0 && postScriptEntries.length > 0
        ? postScriptEntries
        : entriesWithIdentity.length === 0
          ? entries
          : []
    : [];
  // An exact reference is authoritative when the registry has identity data.
  // Older system enumeration records may only contain family/style metadata;
  // retain that usable fallback rather than hiding every control.
  const referenceCanUseFamilyMetadata =
    !node.fontReference || exactEntries.length > 0 || entriesWithIdentity.length === 0;
  const scopedEntries =
    exactEntries.length > 0 ? exactEntries : referenceCanUseFamilyMetadata ? entries : [];
  const axis = (
    scopedEntries.find((entry) => entry.axisDefinitions?.length)?.axisDefinitions ??
    (referenceCanUseFamilyMetadata ? registry.getAxisDefinitions(family) : undefined)
  )?.find((candidate) => candidate.tag === 'wght');
  if (axis) {
    const min = Math.min(axis.min, axis.max);
    const max = Math.max(axis.min, axis.max);
    const values = new Set<number>();
    for (const stop of STANDARD_WEIGHT_STOPS) {
      if (stop >= min && stop <= max) values.add(stop);
    }
    values.add(axis.default);
    values.add(min);
    values.add(max);
    return values;
  }

  const style = node.fontStyle ?? 'normal';
  const styledEntries = scopedEntries.filter((entry) => entry.style === style);
  const candidates = styledEntries.length > 0 ? styledEntries : scopedEntries;
  return new Set(candidates.map((entry) => entry.weight));
}

/**
 * Return only weights the selected face(s) can resolve.
 *
 * Variable faces expose their declared `wght` range at familiar 100-point
 * stops, plus the real minimum, default, and maximum. Static faces expose the
 * weights registered for their style. A persisted value outside that set is
 * retained as a disabled option so opening an old document never hides what
 * it requested or silently changes it.
 */
export function fontWeightOptions(
  nodeOrNodes: WeightNode | readonly WeightNode[],
  registry: ReturnType<typeof getFontRegistry> = getFontRegistry(),
): FontWeightOption[] {
  const nodes = nodesList(nodeOrNodes);
  if (nodes.length === 0) return [];

  const supported = nodes.map((node) => supportedWeights(node, registry));
  const values = new Set<number>();
  for (const weights of supported) for (const weight of weights) values.add(weight);
  for (const node of nodes) values.add(node.fontWeight ?? 400);

  return [...values]
    .filter((weight) => Number.isFinite(weight))
    .sort((a, b) => a - b)
    .map((weight) => {
      const availableForAll = supported.every((weights) => weights.has(weight));
      return {
        value: weight,
        label: String(weight),
        ...(availableForAll
          ? {}
          : {
              disabled: true,
              disabledReason: 'This weight is unavailable for the selected face',
            }),
      };
    });
}

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
