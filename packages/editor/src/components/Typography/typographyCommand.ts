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
    | 'letterSpacing'
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
  if ('letterSpacing' in changes) {
    format.letterSpacing = changes.letterSpacing;
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
