export type MenuId = 'File' | 'Edit' | 'Text' | 'View' | 'Object' | 'Arrange' | 'Page' | 'Help';

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: string;
  disabled?: boolean;
  ariaKeyshortcut?: string;
  items?: MenuItem[];
}

export interface MenuBuildState {
  selection: string[];
  document: {
    activePageId?: string;
    pages?: Array<{ id: string; masterPageId?: string }>;
    masters?: Record<string, { name?: string }>;
    name?: string;
    nodes?: Record<string, unknown>;
  };
  canvasMode: string;
  workspaceMode: string;
  colorBlindnessView: string;
  softProofEnabled: boolean;
  timelinePanelVisible: boolean;
  graphEditorVisible: boolean;
  stateMachinePanelVisible: boolean;
  guidesVisible: boolean;
  distractionFreeMode: boolean;
  beforeAfterCompare: boolean;
  rulerMode: string;
  snapEnabled: boolean;
  pixelGridEnabled: boolean;
  findingsOverlayVisible: boolean;
  documentGrid: {
    visible: boolean;
    spacingX: number;
    spacingY: number;
    subdivisions: number;
    offsetX: number;
    offsetY: number;
    color: string;
    opacity: number;
  };
}

export interface MenuBuildHelpers {
  dis: (action: string) => boolean | undefined;
  ks: (id: string) => string;
  fmt: (id: string) => string;
  fmtBinding: (binding: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }) => string;
  ariaShortcutBinding: (binding: {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
  }) => string;
}

export interface RecentEntry {
  id: string;
  label: string;
  locator: { kind: string; path?: string; handleKey?: string };
}
