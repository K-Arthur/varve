import type { Document, NodeId, RichText, SceneNode } from '@varve/scene';
import type { Affine } from '@varve/shared';

/** Acquisition route that prepared a fragment. Placement remains route-owned. */
export type PreparedFragmentRoute = 'paste' | 'import' | 'drop';

export interface PreparedFragmentItem {
  /** Source document that owns the nodes and their resource tables. */
  sourceDoc: Document;
  /** Ordered visible roots. Descendants and dependency-only nodes stay internal. */
  rootIds: readonly NodeId[];
  /**
   * Additional source nodes required by those roots. They are cloned into the
   * destination mapping but are kept unattached so dependency-only content
   * (masks, table cell artwork, component masters, and linked targets) cannot
   * appear as extra visible paste roots.
   */
  dependencyIds?: readonly NodeId[];
  /** Optional explicit world placement for a file/drop item. */
  position?: { x: number; y: number };
  /** Source-world anchors used by same-document clipboard paste. */
  worldAnchors?: Readonly<Record<string, Affine>>;
}

export interface PreparedFragment {
  route: PreparedFragmentRoute;
  items: readonly PreparedFragmentItem[];
  /** Destination captured before an asynchronous acquisition step. */
  targetParentId: NodeId | null;
  /** World-space center captured for center/cascade placement. */
  center?: { x: number; y: number };
  /** Keep same-document clipboard roots at their captured world anchors. */
  preserveWorldPose?: boolean;
  /** Optional text item captured from the same clipboard snapshot. */
  text?: { plainText: string; richText?: RichText };
  /** Optional mask target for an all-image drop. */
  maskTargetId?: NodeId;
}

export interface PreparedFragmentClone {
  doc: Document;
  rootIds: readonly NodeId[];
  idMap: Map<string, string>;
}

export interface PreparedFragmentCommitHooks {
  /** Clone all roots in one source-to-destination mapping. */
  clone: (targetDoc: Document, item: PreparedFragmentItem) => PreparedFragmentClone | null;
  /** Apply route-specific placement after the clone has been attached. */
  place: (
    doc: Document,
    inserted: PreparedFragmentClone,
    item: PreparedFragmentItem,
    fragment: PreparedFragment,
    itemIndex: number,
  ) => Document;
}

export interface PreparedFragmentCommitResult {
  doc: Document;
  rootIds: NodeId[];
  resourceImports: { sourceDoc: Document; idMap: Map<string, string> }[];
}

/**
 * Commit prepared roots in acquisition order. Cloning and placement are
 * injected because Paste, Import, and Drop intentionally retain different
 * placement semantics while sharing the same atomic insertion loop.
 */
export function commitPreparedFragmentDocument(
  targetDoc: Document,
  fragment: PreparedFragment,
  hooks: PreparedFragmentCommitHooks,
): PreparedFragmentCommitResult {
  let doc = targetDoc;
  const rootIds: NodeId[] = [];
  const resourceImports: PreparedFragmentCommitResult['resourceImports'] = [];
  for (const [itemIndex, item] of fragment.items.entries()) {
    if (item.rootIds.length === 0) continue;
    const inserted = hooks.clone(doc, item);
    if (!inserted) continue;
    doc = hooks.place(inserted.doc, inserted, item, fragment, itemIndex);
    rootIds.push(...inserted.rootIds);
    resourceImports.push({ sourceDoc: item.sourceDoc, idMap: inserted.idMap });
  }
  return { doc, rootIds, resourceImports };
}

export function preparedFragmentFromNodes(
  route: PreparedFragmentRoute,
  items: readonly { node: SceneNode; sourceDoc: Document; position?: { x: number; y: number } }[],
  placement: Pick<PreparedFragment, 'targetParentId' | 'center' | 'maskTargetId'>,
): PreparedFragment {
  return preparedFragmentFromRootSets(
    route,
    items.map(({ node, sourceDoc, position }) => ({
      sourceDoc,
      rootIds: [node.id],
      ...(position ? { position } : {}),
    })),
    placement,
  );
}

/**
 * Build a fragment from already grouped artifact roots. Keeping the root set
 * together is significant for SVGs and other imports that produce a logical
 * group of sibling nodes; insertion must not flatten those siblings into
 * unrelated visible items.
 */
export function preparedFragmentFromRootSets(
  route: PreparedFragmentRoute,
  items: readonly {
    sourceDoc: Document;
    rootIds: readonly NodeId[];
    dependencyIds?: readonly NodeId[];
    position?: { x: number; y: number };
  }[],
  placement: Pick<PreparedFragment, 'targetParentId' | 'center' | 'maskTargetId'>,
): PreparedFragment {
  return {
    route,
    targetParentId: placement.targetParentId,
    ...(placement.center ? { center: placement.center } : {}),
    ...(placement.maskTargetId ? { maskTargetId: placement.maskTargetId } : {}),
    items: items.map(({ sourceDoc, rootIds, dependencyIds, position }) => ({
      sourceDoc,
      rootIds: [...rootIds],
      ...(dependencyIds && dependencyIds.length > 0 ? { dependencyIds: [...dependencyIds] } : {}),
      ...(position ? { position } : {}),
    })),
  };
}
