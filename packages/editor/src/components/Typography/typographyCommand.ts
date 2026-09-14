import type { CharacterFormat, NodeId, RichSelection, SceneNode, TextNode } from '@varve/scene';

/** The text-node properties exposed by compact typography controls. */
export type TypographyTextChanges = Partial<
  Pick<
    TextNode,
    | 'fontFamily'
    | 'fontReference'
    | 'fontWeight'
    | 'fontStyle'
    | 'fontSize'
    | 'lineHeight'
    | 'letterSpacing'
    | 'tracking'
    | 'textCase'
    | 'textDecoration'
    | 'fill'
    | 'openTypeFeatures'
    | 'variableAxes'
  >
>;

export interface TypographyCommandSurface {
  selectedIds: readonly NodeId[];
  selectionRange: RichSelection | null;
  pendingFormat: CharacterFormat | null;
  updateNode: (id: NodeId, updater: (node: SceneNode) => SceneNode) => void;
  applyFormatToSelection: (format: CharacterFormat) => void;
  setPendingFormat: (format: CharacterFormat) => void;
  groupCompoundOperation: (label: string, action: () => void) => void;
}

export type TypographyDisplayField =
  | 'fontFamily'
  | 'fontReference'
  | 'fontWeight'
  | 'fontStyle'
  | 'fontSize'
  | 'variableAxes';

/** Effective face data for each run addressed by the active range. */
export type TypographyDisplayNode = Pick<
  TextNode,
  'fontFamily' | 'fontReference' | 'fontWeight' | 'fontStyle' | 'variableAxes'
>;

export interface TypographyDisplayValues {
  values: Pick<
    TextNode,
    'fontFamily' | 'fontReference' | 'fontWeight' | 'fontStyle' | 'fontSize' | 'variableAxes'
  >;
  mixed: Partial<Record<TypographyDisplayField, boolean>>;
  /**
   * Resolved run faces in selection order. Empty means the control is reading
   * the text-node defaults or a browse-only node value.
   */
  effectiveNodes: readonly TypographyDisplayNode[];
}

const DISPLAY_FORMAT_FIELDS: readonly {
  node: TypographyDisplayField;
  format: keyof CharacterFormat;
}[] = [
  { node: 'fontFamily', format: 'fontFamily' },
  { node: 'fontReference', format: 'fontReference' },
  { node: 'fontWeight', format: 'fontWeight' },
  { node: 'fontStyle', format: 'fontStyle' },
  { node: 'fontSize', format: 'fontSize' },
  { node: 'variableAxes', format: 'variableFontSettings' },
];

function formatValueEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false;
  return JSON.stringify(first) === JSON.stringify(second);
}

function hasOwn(value: CharacterFormat | undefined, key: keyof CharacterFormat): boolean {
  return value !== undefined && Object.hasOwn(value, key);
}

function paragraphLength(para: { runs: { text: string }[] }): number {
  return para.runs.reduce((total, run) => total + run.text.length, 0);
}

/**
 * Resolve the values shown by compact typography controls.
 *
 * Rich runs use optional fields, so an absent field inherits the text-node
 * value while an own property containing `undefined` deliberately clears a
 * reference/axis. This keeps a mixed selection readable without changing the
 * authored document and lets the command adapter apply the next choice to the
 * active range.
 */
export function typographyDisplayValues(
  node: TextNode,
  selectionRange: RichSelection | null,
  pendingFormat: CharacterFormat | null = null,
): TypographyDisplayValues {
  const values = {
    fontFamily: node.fontFamily,
    fontReference: node.fontReference,
    fontWeight: node.fontWeight,
    fontStyle: node.fontStyle,
    fontSize: node.fontSize,
    variableAxes: node.variableAxes,
  } satisfies TypographyDisplayValues['values'];
  const mixed: Partial<Record<TypographyDisplayField, boolean>> = {};
  const rich = node.richText;
  if (!selectionRange || !rich) {
    return { values, mixed, effectiveNodes: [] };
  }

  const startBeforeEnd =
    selectionRange.start.paragraphIndex < selectionRange.end.paragraphIndex ||
    (selectionRange.start.paragraphIndex === selectionRange.end.paragraphIndex &&
      selectionRange.start.offset <= selectionRange.end.offset);
  const start = startBeforeEnd ? selectionRange.start : selectionRange.end;
  const end = startBeforeEnd ? selectionRange.end : selectionRange.start;
  const selectedRuns: (typeof rich.paragraphs)[number]['runs'] = [];
  const collapsed = start.paragraphIndex === end.paragraphIndex && start.offset === end.offset;

  for (
    let paragraphIndex = start.paragraphIndex;
    paragraphIndex <= end.paragraphIndex;
    paragraphIndex += 1
  ) {
    const paragraph = rich.paragraphs[paragraphIndex];
    if (!paragraph) continue;
    const length = paragraphLength(paragraph);
    const rangeStart = paragraphIndex === start.paragraphIndex ? Math.max(0, start.offset) : 0;
    const rangeEnd = paragraphIndex === end.paragraphIndex ? Math.min(length, end.offset) : length;
    let cursor = 0;
    for (const run of paragraph.runs) {
      const runEnd = cursor + run.text.length;
      const intersects = collapsed
        ? paragraphIndex === start.paragraphIndex &&
          (start.offset < runEnd || (start.offset === length && start.offset === runEnd)) &&
          start.offset >= cursor
        : runEnd > rangeStart && cursor < rangeEnd;
      if (intersects) selectedRuns.push(run);
      cursor = runEnd;
    }
  }

  if (selectedRuns.length === 0) {
    // An empty paragraph or a caret at the end of a story has no run to read;
    // pending formatting still represents the next insertion.
    if (collapsed && pendingFormat) {
      for (const field of DISPLAY_FORMAT_FIELDS) {
        if (!hasOwn(pendingFormat, field.format)) continue;
        const next = pendingFormat[field.format];
        (values as Record<string, unknown>)[field.node] =
          field.node === 'variableAxes' && next ? { ...(next as Record<string, number>) } : next;
      }
    }
    return { values, mixed, effectiveNodes: [] };
  }

  const effectiveNodes: TypographyDisplayNode[] = selectedRuns.map((run) => ({
    fontFamily: hasOwn(run.format, 'fontFamily') ? run.format?.fontFamily : values.fontFamily,
    fontReference: hasOwn(run.format, 'fontReference')
      ? run.format?.fontReference
      : values.fontReference,
    fontWeight: hasOwn(run.format, 'fontWeight') ? run.format?.fontWeight : values.fontWeight,
    fontStyle: hasOwn(run.format, 'fontStyle') ? run.format?.fontStyle : values.fontStyle,
    variableAxes: hasOwn(run.format, 'variableFontSettings')
      ? run.format?.variableFontSettings
      : values.variableAxes,
  }));

  for (const field of DISPLAY_FORMAT_FIELDS) {
    const runValues = selectedRuns.map((run) => {
      if (hasOwn(run.format, field.format)) return run.format?.[field.format];
      return values[field.node];
    });
    const first = runValues[0];
    (values as Record<string, unknown>)[field.node] =
      field.node === 'variableAxes' && first ? { ...(first as Record<string, number>) } : first;
    if (runValues.some((candidate) => !formatValueEqual(candidate, first))) {
      mixed[field.node] = true;
    }
  }

  if (collapsed && pendingFormat) {
    for (const field of DISPLAY_FORMAT_FIELDS) {
      if (!hasOwn(pendingFormat, field.format)) continue;
      const next = pendingFormat[field.format];
      (values as Record<string, unknown>)[field.node] =
        field.node === 'variableAxes' && next ? { ...(next as Record<string, number>) } : next;
      delete mixed[field.node];
    }
    return {
      values,
      mixed,
      effectiveNodes: [
        {
          fontFamily: values.fontFamily,
          fontReference: values.fontReference,
          fontWeight: values.fontWeight,
          fontStyle: values.fontStyle,
          variableAxes: values.variableAxes,
        },
      ],
    };
  }

  return { values, mixed, effectiveNodes };
}

/** True when a selection addresses characters rather than a collapsed caret. */
export function hasSelectedCharacters(range: RichSelection | null): range is RichSelection {
  if (!range) return false;
  return (
    range.start.paragraphIndex !== range.end.paragraphIndex ||
    range.start.offset !== range.end.offset
  );
}

/**
 * Translate the shared text-node shape to the rich-text run shape. Keeping
 * this conversion in one adapter prevents the inspector, floating toolbar,
 * and contextual bar from accidentally treating a range as an object edit.
 */
export function toCharacterFormat(changes: TypographyTextChanges): CharacterFormat | null {
  const format: CharacterFormat = {};
  let recognized = false;

  if ('fontFamily' in changes) {
    format.fontFamily = changes.fontFamily;
    recognized = true;
  }
  if ('fontReference' in changes) {
    format.fontReference = changes.fontReference;
    recognized = true;
  }
  if ('fontWeight' in changes) {
    format.fontWeight = changes.fontWeight;
    recognized = true;
  }
  if ('fontStyle' in changes) {
    format.fontStyle = changes.fontStyle;
    recognized = true;
  }
  if ('fontSize' in changes) {
    format.fontSize = changes.fontSize;
    recognized = true;
  }
  if ('lineHeight' in changes) {
    format.lineHeight = changes.lineHeight;
    recognized = true;
  }
  if ('letterSpacing' in changes) {
    format.letterSpacing = changes.letterSpacing;
    recognized = true;
  }
  if ('tracking' in changes) {
    format.tracking = changes.tracking;
    recognized = true;
  }
  if ('textCase' in changes) {
    format.textCase = changes.textCase;
    recognized = true;
  }
  if ('textDecoration' in changes) {
    format.textDecoration = changes.textDecoration;
    recognized = true;
  }
  if ('fill' in changes) {
    format.color = changes.fill;
    recognized = true;
  }
  if ('openTypeFeatures' in changes) {
    format.openTypeFeatures = changes.openTypeFeatures;
    recognized = true;
  }
  if ('variableAxes' in changes) {
    format.variableFontSettings = changes.variableAxes;
    recognized = true;
  }

  return recognized ? format : null;
}

/**
 * Apply a compact typography edit at the right scope:
 *
 * - an expanded text range receives a rich-run edit;
 * - a collapsed caret records a pending format for the next insertion;
 * - everything else remains an ordinary text-node edit.
 *
 * A family-only edit deliberately carries `fontReference: undefined`, which
 * clears an old exact face from the affected run instead of leaving a stale
 * artifact identity attached to the new family.
 */
export function applyTypographyChanges(
  surface: TypographyCommandSurface,
  id: NodeId,
  changes: TypographyTextChanges,
): void {
  const format = toCharacterFormat(changes);
  const ownsTextRange =
    surface.selectedIds.length === 1 &&
    surface.selectedIds[0] === id &&
    surface.selectionRange !== null;

  if (format && ownsTextRange) {
    if (hasSelectedCharacters(surface.selectionRange)) {
      surface.groupCompoundOperation('Typography', () => {
        surface.applyFormatToSelection(format);
      });
    } else {
      // Pending formatting is transient and must not dirty the document or
      // create a history entry before a glyph is actually inserted.
      surface.setPendingFormat({ ...(surface.pendingFormat ?? {}), ...format });
    }
    return;
  }

  surface.groupCompoundOperation('Typography', () => {
    surface.updateNode(id, (node) =>
      node.kind === 'text' ? ({ ...node, ...changes } as TextNode) : node,
    );
  });
}
