import type { NodeId, RichText } from '@varve/scene';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  matchDiacritics: boolean;
}

export type SearchScope = 'selection' | 'page' | 'document';

/**
 * Immutable description of one search. A search session keeps its spec until
 * the user changes the query/options/scope or explicitly refreshes it, so
 * navigating results can never retarget what is being replaced.
 */
export interface SearchSpec {
  /** Monotonic request identity; stale responses are discarded by id. */
  id: string;
  /** Document revision the spec was built against. */
  revision: number;
  query: string;
  options: SearchOptions;
  scope: SearchScope;
  /** Frozen selection ids when `scope === 'selection'`. */
  selection: NodeId[];
  excludeInstances: boolean;
  excludeLocked: boolean;
  excludeHidden: boolean;
}

export interface RichTextMatchSegment {
  paragraphIndex: number;
  runIndex: number;
  runOffset: number;
  length: number;
}

export interface MatchResult {
  /** Stable identity under virtualization: `<targetKey>#<flatStart>`. */
  id: string;
  targetKey: string;
  targetKind: 'node' | 'story';
  /** Node id for node targets, story id for story targets. */
  targetId: NodeId;
  /** Nodes that render this target; length > 1 means the edit propagates. */
  frameIds: NodeId[];
  /** Node to select when navigating (the primary frame for story targets). */
  nodeId: NodeId;
  nodeName: string;
  /** Original UTF-16 offsets into the target's flat text. */
  flatStart: number;
  flatEnd: number;
  /** Matched text in its original code points. */
  original: string;
  zeroWidth: boolean;
  /** Find-only when the target is locked or hidden. */
  protected: boolean;
  protectedReason: 'locked' | 'hidden' | null;
  /** Story targets edit shared content shown in several frames. */
  shared: boolean;
  /** Text-on-path and similar modes are searchable but flagged. */
  onPath: boolean;
  contextSnippet: string;
  segments: RichTextMatchSegment[];
  /** Regex capture groups (index 0 is the whole match). */
  groups?: readonly (string | undefined)[];
  namedGroups?: Readonly<Record<string, string | undefined>>;
}

export interface SkippedCounts {
  instances: number;
  locked: number;
  hidden: number;
  unsupported: number;
}

export type SearchStatus = 'idle' | 'searching' | 'ready' | 'stale' | 'empty-selection' | 'error';

export interface FindReplaceState {
  open: boolean;
  searchText: string;
  replaceText: string;
  options: SearchOptions;
  scope: SearchScope;
  excludeInstances: boolean;
  excludeLocked: boolean;
  excludeHidden: boolean;
  /** Frozen spec for the live result set; null until a search runs. */
  spec: SearchSpec | null;
  results: MatchResult[];
  currentIndex: number;
  status: SearchStatus;
  error: string | null;
  /** True when the result list hit the match budget. */
  truncated: boolean;
  skippedCount: SkippedCounts;
  /** Count actually applied by the last committed replacement. */
  lastApplied: number | null;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  matchDiacritics: false,
};

export const DEFAULT_FIND_REPLACE_STATE: FindReplaceState = {
  open: false,
  searchText: '',
  replaceText: '',
  options: { ...DEFAULT_SEARCH_OPTIONS },
  scope: 'page',
  excludeInstances: true,
  excludeLocked: true,
  excludeHidden: true,
  spec: null,
  results: [],
  currentIndex: 0,
  status: 'idle',
  error: null,
  truncated: false,
  skippedCount: { instances: 0, locked: 0, hidden: 0, unsupported: 0 },
  lastApplied: null,
};

/**
 * Backwards-compatible alias. `SkippedCounts` replaced `SkipedCount` (the
 * misspelling) when find/replace moved to story-aware, protected-aware counts.
 * @deprecated Use {@link SkippedCounts}.
 */
export type SkipedCount = SkippedCounts;

export type { RichText };
