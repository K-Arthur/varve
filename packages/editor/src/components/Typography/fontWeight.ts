import { getFontRegistry } from '@varve/engine';
import { type FontReference, fontReferenceKey } from '@varve/engine/font';
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

function referenceFromFaceKey(
  faceKey: string | undefined,
  postScriptName?: string,
): FontReference | undefined {
  const match = /^sha256:([0-9a-f]{64}):(single|[0-9]+)$/i.exec(faceKey ?? '');
  if (!match) return undefined;
  return {
    artifactHash: match[1]!,
    ...(match[2] === 'single' ? {} : { collectionIndex: Number(match[2]) }),
    ...(postScriptName ? { postScriptName } : {}),
  };
}

function sameArtifact(faceKey: string | undefined, reference: FontReference): boolean {
  const match = /^sha256:([0-9a-f]{64}):(single|[0-9]+)$/i.exec(faceKey ?? '');
  return match?.[1]?.toLowerCase() === reference.artifactHash.toLowerCase();
}

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
  const artifactEntries = node.fontReference
    ? entries.filter((entry) => sameArtifact(entry.faceKey, node.fontReference!))
    : [];
  const exactEntries = node.fontReference
    ? artifactEntries.length > 0
      ? artifactEntries
      : exactKeyEntries.length > 0
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
  const referenceCanUseFamilyMetadata = !node.fontReference || entriesWithIdentity.length === 0;
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
  if (hasWeightAxis) {
    return { fontWeight: weight, variableAxes: { ...(node.variableAxes ?? {}), wght: weight } };
  }
  if (!node.fontReference || node.fontWeight === weight) return { fontWeight: weight };

  // Static collection members are separate faces. If the registry can find
  // the requested weight in the same artifact, move the member reference with
  // the authored choice; otherwise clear the stale exact face so a different
  // artifact cannot be mistaken for the selected one.
  const entries = registry.getEntries(family);
  const style = node.fontStyle ?? 'normal';
  const styledEntries = entries.filter((entry) => entry.style === style);
  const candidates = styledEntries.length > 0 ? styledEntries : entries;
  const target = candidates.find(
    (entry) => entry.weight === weight && sameArtifact(entry.faceKey, node.fontReference!),
  );
  const targetReference = target
    ? referenceFromFaceKey(target.faceKey, target.postScriptName)
    : undefined;
  return { fontWeight: weight, fontReference: targetReference };
}

/**
 * Apply a real style change without leaving the previous exact face attached.
 *
 * Static families encode italic as a sibling face, so an exact normal-face
 * reference must move to that sibling when it exists. If the registry cannot
 * prove the requested style for the same artifact, clear the reference rather
 * than claiming that the old bytes satisfy the new style. Family-only legacy
 * nodes retain their existing style-only behavior.
 */
export function fontStyleChanges(
  node: TextNode,
  style: TextNode['fontStyle'],
  registry: ReturnType<typeof getFontRegistry> = getFontRegistry(),
): Partial<TextNode> {
  const nextStyle = style ?? 'normal';
  if (!node.fontReference || nextStyle === (node.fontStyle ?? 'normal')) {
    return { fontStyle: style };
  }

  const family = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  const entries = registry.getEntries(family);
  const target = entries.find(
    (entry) =>
      entry.style === nextStyle &&
      entry.weight === (node.fontWeight ?? 400) &&
      sameArtifact(entry.faceKey, node.fontReference!),
  );
  return {
    fontStyle: style,
    fontReference: target ? referenceFromFaceKey(target.faceKey, target.postScriptName) : undefined,
  };
}
