export interface ShortcutBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  binding: ShortcutBinding;
  keys?: string[];
  label: string;
  category: string;
  id?: string;
  platform?: 'all' | 'mac' | 'windows' | 'linux';
  context?: 'canvas' | 'text-edit' | 'global';
  repeatable?: boolean;
  remappable?: boolean;
  /** When present, this shortcut is only shown in the specified workspaces.
   *  Absent = all workspaces. Used for workspace-tag display in the command palette. */
  workspaces?: string[];
}

export interface ShortcutEntry {
  id: string;
  def: ShortcutDef;
  handler: () => void;
}

export interface KeymapExport {
  version: number;
  generated: string;
  shortcuts: Record<string, { binding: ShortcutBinding; label: string }>;
}
