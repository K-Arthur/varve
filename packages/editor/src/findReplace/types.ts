import type { NodeId, RichText } from '@strata/scene';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  matchDiacritics: boolean;
}

export type SearchScope = 'selection' | 'page' | 'document';

export interface RichTextMatchSegment {
  paragraphIndex: number;
  runIndex: number;
  runOffset: number;
  length: number;
}

export interface TextNodeContent {
  nodeId: NodeId;
  richText: RichText;
  plainText: string;
  isInstance: boolean;
  isLocked: boolean;
  isHidden: boolean;
  nodeName: string;
}

export interface MatchResult {
  nodeId: NodeId;
  flatStart: number;
  flatEnd: number;
  contextSnippet: string;
  segments: RichTextMatchSegment[];
  nodeName: string;
}

export interface SkipedCount {
  instances: number;
  locked: number;
  hidden: number;
}

export interface FindReplaceState {
  open: boolean;
  searchText: string;
  replaceText: string;
  options: SearchOptions;
  scope: SearchScope;
  excludeInstances: boolean;
  excludeLocked: boolean;
  excludeHidden: boolean;
  results: MatchResult[];
  currentIndex: number;
  status: 'idle' | 'searching' | 'ready' | 'stale';
  error: string | null;
  skippedCount: SkipedCount;
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
  results: [],
  currentIndex: 0,
  status: 'idle',
  error: null,
  skippedCount: { instances: 0, locked: 0, hidden: 0 },
};
