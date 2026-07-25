export type Accelerator = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type Capability =
  | 'fs.read'
  | 'fs.write'
  | 'fs.watch'
  | 'fs.recentPaths'
  | 'archive'
  | 'backup'
  | 'nativeMenu'
  | 'multiWindow'
  | 'shell.open'
  | 'fonts.local'
  | 'clipboard.image'
  | 'notifications'
  | 'autoUpdate';

export type MenuContextId = 'menubar' | 'canvas' | 'layers' | 'inspector' | 'floatingToolbar';

export type MenuItemKind = 'command' | 'checkbox' | 'radio' | 'separator' | 'submenu';

export interface SelectionFacts {
  count: number;
  isEmpty: boolean;
  isSingle: boolean;
  isMultiple: boolean;
  kinds: Set<string>;
  hasText: boolean;
  hasVector: boolean;
  hasImage: boolean;
  hasFrame: boolean;
  hasGroup: boolean;
  allSameType: boolean;
  hasComponentInstance: boolean;
  isLocked: boolean;
  boundsCount: number;
  canGroup: boolean;
  canUngroup: boolean;
  hasMask: boolean;
  hasAdjustment: boolean;
}

export interface DocumentFacts {
  nodeCount: number;
  pageCount: number;
  hasMasterPages: boolean;
  currentPageHasMaster: boolean;
  currentPageMaster: { id: string; name: string } | null;
  currentPageIsMaster: boolean;
  masterPages: { id: string; name: string }[];
  activePageId: string | null;
  hasSelection: boolean;
  hasMultipleSelection: boolean;
}

export interface PlatformFacts {
  os: 'mac' | 'windows' | 'linux' | 'unknown';
  capabilities: ReadonlySet<Capability>;
}

export interface IntelFacts {
  findingCount: number;
  findingCountBySeverity: Record<string, number>;
  lastScanAt: number | null;
  scanInProgress: boolean;
}

export interface MenuContext {
  selection: SelectionFacts;
  document: DocumentFacts;
  workspace: import('../workspace/workspaceTypes').WorkspaceMode;
  platform: PlatformFacts;
  intelligence: IntelFacts;
}

export interface MenuItemDef {
  id: string;
  labelKey?: string;
  /** Dynamic label override — if set, takes precedence over labelKey. */
  label?: (ctx: MenuContext) => string;
  accelerator?: Accelerator;
  kind: MenuItemKind;
  group?: string;
  items?: MenuItemDef[] | ((ctx: MenuContext) => MenuItemDef[]);
  radioGroup?: string;
  visible?: (ctx: MenuContext) => boolean;
  enabled?: (ctx: MenuContext) => true | { reason: string };
  checked?: (ctx: MenuContext) => boolean;
  badge?: (ctx: MenuContext) => string | undefined;
  run?: (ctx: MenuContext) => void | Promise<void>;
  capabilities?: Capability[];
  workspaces?: import('../workspace/workspaceTypes').WorkspaceMode[];
  contexts?: MenuContextId[];
}

export interface MenuGroup {
  id: string;
  labelKey: string;
  items: MenuItemDef[];
  context?: MenuContextId;
}
