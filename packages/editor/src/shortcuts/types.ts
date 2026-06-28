export interface ShortcutBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  binding: ShortcutBinding;
  label: string;
  category: string;
}

export interface ShortcutEntry {
  id: string;
  def: ShortcutDef;
  handler: () => void;
}
