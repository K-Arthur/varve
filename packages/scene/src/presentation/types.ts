import type { NodeId } from '../types';

/** Current on-disk version of the optional presentation metadata envelope. */
export const PRESENTATION_SCHEMA_VERSION = 1 as const;

export interface PresentationSlideLayoutBinding {
  /** Stable identifier for the reusable layout source. */
  sourceId: string;
  /** Ordinary editable frame holding the layout source. */
  sourceFrameId: NodeId;
  /** Source revision last applied to this slide. */
  appliedRevision: number;
  /** Stable role keys mapped to slide-local content node ids. */
  roleNodes: Record<string, NodeId>;
  /** Managed values captured at application time for override detection. */
  managedBaseline?: Record<NodeId, Record<string, unknown>>;
}

/** Theme roles chosen for one slide. Survives detach so re-applying works. */
export interface PresentationSlideThemeBinding {
  themeId: string;
  /** Theme role → slide object id, as chosen by the author. */
  roleNodes: Record<string, NodeId>;
}

export interface PresentationSlideEntry {
  /** Stable id for this deck entry, independent of the referenced frame. */
  id: string;
  /** May remain unresolved after its artwork is removed, for recovery. */
  frameId: NodeId;
  title: string;
  notes?: string;
  skipped?: boolean;
  sectionId?: string;
  layoutBinding?: PresentationSlideLayoutBinding;
  themeBinding?: PresentationSlideThemeBinding;
  /** A per-slide theme reference overrides the deck theme when present. */
  themeId?: string;
  /** Accessibility metadata is independent of paint and layer order. */
  language?: string;
  altText?: string;
  readingOrder?: NodeId[];
}

export interface PresentationSection {
  id: string;
  title: string;
}

export interface PresentationDeck {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Array order is the only slide sequence; canvas and paint order are ignored. */
  slides: PresentationSlideEntry[];
  sections: PresentationSection[];
  themeId?: string;
}

export interface PresentationLayoutSource {
  id: string;
  name: string;
  frameId: NodeId;
  revision: number;
  /** Stable role keys on the source frame; values are source node ids. */
  roleNodes: Record<string, NodeId>;
  /** Geometry captured at registration/refresh so edits can be surfaced as stale. */
  geometrySnapshot?: Record<string, Record<string, unknown>>;
}

export interface PresentationTheme {
  id: string;
  name: string;
  /** Role key to document variable id. */
  colorVariables: Record<string, string>;
  /** Role key to document text-style id. */
  textStyles: Record<string, string>;
}

/** Optional document-level deck metadata. Referenced artwork remains ordinary scene nodes. */
export interface PresentationMetadata {
  schemaVersion: typeof PRESENTATION_SCHEMA_VERSION;
  decks: PresentationDeck[];
  layouts: PresentationLayoutSource[];
  themes: PresentationTheme[];
}
