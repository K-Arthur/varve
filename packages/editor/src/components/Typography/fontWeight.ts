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

type WeightNode = Pick<
  TextNode,
  'fontFamily' | 'fontWeight' | 'fontStyle' | 'fontReference' | 'variableAxes'
>;

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

function declaresAxis(
  entries: ReturnType<ReturnType<typeof getFontRegistry>['getEntries']>,
  tag: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.axisDefinitions?.some((axis) => axis.tag === tag) === true ||
      entry.variableAxes?.[tag] !== undefined,
  );
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
  const axisEntries = requestedFaceKey ? exactKeyEntries : scopedEntries;
  const axis = (
    axisEntries.find((entry) => entry.axisDefinitions?.length)?.axisDefinitions ??
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

/**
 * Return whether a selected family can provide the requested real style.
 *
 * A persisted exact reference narrows the answer to the same artifact. This
 * keeps the compact toolbar from offering a synthetic italic face merely
 * because another file with the same family name happens to have one. Older
 * family-only records continue to use the available family metadata.
 */
export function fontStyleAvailable(
  node: WeightNode,
  style: NonNullable<TextNode['fontStyle']>,
  registry: ReturnType<typeof getFontRegistry> = getFontRegistry(),
): boolean {
  if ((node.fontStyle ?? 'normal') === style) return true;

  const family = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  const entries = registry.getEntries(family);
  const entriesWithIdentity = entries.filter((entry) => entry.faceKey);
  const scopedEntries =
    node.fontReference && entriesWithIdentity.length > 0
      ? entries.filter((entry) => sameArtifact(entry.faceKey, node.fontReference!))
      : entries;
  const requestedFaceKey = node.fontReference
    ? fontReferenceKey(node.fontReference).toLowerCase()
    : undefined;
  const exactEntries = requestedFaceKey
    ? entries.filter((entry) => entry.faceKey?.toLowerCase() === requestedFaceKey)
    : [];
  const axisEntries =
    node.fontReference && entriesWithIdentity.length > 0 ? exactEntries : scopedEntries;

  if (scopedEntries.some((entry) => entry.style === style)) return true;

  // Variable fonts can expose italic as an `ital` axis rather than a sibling
  // static face. Treat only a declared axis (or an authored axis value) as a
  // supported style; a generic `font-style: italic` fallback is not enough.
  const axisDefinitions =
    axisEntries.find((entry) => entry.axisDefinitions?.length)?.axisDefinitions ??
    (node.fontReference && entriesWithIdentity.length > 0
      ? undefined
      : registry.getAxisDefinitions(family));
  const italicAxis = axisDefinitions?.find((axis) => axis.tag === 'ital');
  if (italicAxis) {
    const min = Math.min(italicAxis.min, italicAxis.max);
    const max = Math.max(italicAxis.min, italicAxis.max);
    return style === 'italic' ? max >= 1 && min <= 1 : min <= 0 && max >= 0;
  }
  const authoredAxesAreSupported =
    !node.fontReference || entriesWithIdentity.length === 0 || declaresAxis(exactEntries, 'ital');
  return style === 'italic' && authoredAxesAreSupported && node.variableAxes?.ital !== undefined;
}

/**
 * A family-only choice must not retain identity or variation data from a
 * different artifact. Axis tags are family-specific (for example, `wdth` or
 * `opsz` may not exist on the newly chosen face), so retaining them would
 * make the resolver apply unsupported coordinates or silently alter layout.
 */
export function fontFamilyChanges(
  family: string | undefined,
  currentFamily?: string,
  currentReference?: FontReference,
  currentAxes?: Record<string, number>,
): Partial<TextNode> {
  // Selecting a family row is an explicit family-level fallback, even when
  // the label matches the current node.  An exact face is only retained by
  // the expanded-face path, which calls onSelectFace instead.  This prevents
  // a missing artifact/member from remaining silently attached after the
  // user chooses the visible family again.
  if (family === currentFamily && currentReference === undefined && currentAxes === undefined) {
    return {};
  }
  return { fontFamily: family, fontReference: undefined, variableAxes: undefined };
}

/**
 * Apply the authored weight to a text node while keeping a declared weight
 * axis in sync. Other variation axes belong to the author and are retained.
 */
export function fontWeightChanges(
  node: WeightNode,
  weight: number,
  registry: ReturnType<typeof getFontRegistry> = getFontRegistry(),
): Partial<TextNode> {
  const family = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  const entries = registry.getEntries(family);
  const hasIdentity = entries.some((entry) => entry.faceKey);
  const entriesWithIdentity = entries.filter((entry) => entry.faceKey);
  const scopedEntries =
    node.fontReference && hasIdentity
      ? entries.filter((entry) => sameArtifact(entry.faceKey, node.fontReference!))
      : entries;
  const requestedFaceKey = node.fontReference
    ? fontReferenceKey(node.fontReference).toLowerCase()
    : undefined;
  const exactEntries = requestedFaceKey
    ? entries.filter((entry) => entry.faceKey?.toLowerCase() === requestedFaceKey)
    : [];
  const axisEntries = node.fontReference && hasIdentity ? exactEntries : scopedEntries;
  const axisDefinitions =
    axisEntries.find((entry) => entry.axisDefinitions?.length)?.axisDefinitions ??
    (node.fontReference && hasIdentity ? undefined : registry.getAxisDefinitions(family));
  const authoredWeightAxis =
    node.variableAxes?.wght !== undefined &&
    (!node.fontReference || entriesWithIdentity.length === 0 || declaresAxis(exactEntries, 'wght'));
  const hasWeightAxis =
    axisDefinitions?.some((axis) => axis.tag === 'wght') === true || authoredWeightAxis;
  if (hasWeightAxis) {
    return { fontWeight: weight, variableAxes: { ...(node.variableAxes ?? {}), wght: weight } };
  }
  if (!node.fontReference || node.fontWeight === weight) return { fontWeight: weight };

  // Static collection members are separate faces. If the registry can find
  // the requested weight in the same artifact, move the member reference with
  // the authored choice; otherwise clear the stale exact face so a different
  // artifact cannot be mistaken for the selected one.
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
  node: WeightNode,
  style: TextNode['fontStyle'],
  registry: ReturnType<typeof getFontRegistry> = getFontRegistry(),
): Partial<TextNode> {
  const nextStyle = style ?? 'normal';
  if (nextStyle === (node.fontStyle ?? 'normal')) {
    return { fontStyle: style };
  }

  const family = node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
  const entries = registry.getEntries(family);
  const hasIdentity = entries.some((entry) => entry.faceKey);
  const scopedEntries =
    node.fontReference && hasIdentity
      ? entries.filter((entry) => sameArtifact(entry.faceKey, node.fontReference!))
      : entries;
  const requestedFaceKey = node.fontReference
    ? fontReferenceKey(node.fontReference).toLowerCase()
    : undefined;
  const exactEntries = requestedFaceKey
    ? entries.filter((entry) => entry.faceKey?.toLowerCase() === requestedFaceKey)
    : [];
  const axisEntries = node.fontReference && hasIdentity ? exactEntries : scopedEntries;
  const axisDefinitions =
    axisEntries.find((entry) => entry.axisDefinitions?.length)?.axisDefinitions ??
    (node.fontReference && hasIdentity ? undefined : registry.getAxisDefinitions(family));
  const italicAxis = axisDefinitions?.find((axis) => axis.tag === 'ital');
  const authoredItalicAxis =
    node.variableAxes?.ital !== undefined &&
    (!node.fontReference || hasIdentity === false || declaresAxis(exactEntries, 'ital'));
  if (italicAxis || authoredItalicAxis) {
    return {
      fontStyle: style,
      variableAxes: {
        ...(node.variableAxes ?? {}),
        ital: nextStyle === 'italic' ? 1 : 0,
      },
    };
  }
  if (!node.fontReference) return { fontStyle: style };
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
