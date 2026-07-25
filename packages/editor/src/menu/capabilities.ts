import type { Capability } from './types';

let _overrides: ReadonlySet<Capability> | null = null;

export function setCapabilitiesForTest(caps: ReadonlySet<Capability> | null): void {
  _overrides = caps;
}

let _cached: ReadonlySet<Capability> | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}
function hasFileSystemAccessAPI(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';
}

function hasQueryLocalFonts(): boolean {
  if (typeof window === 'undefined') return false;
  return 'queryLocalFonts' in window;
}

function canReadClipboardImages(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as unknown as Record<string, unknown>;
  const clip = nav.clipboard as Record<string, unknown> | undefined;
  return typeof clip?.read === 'function';
}

function hasNotifications(): boolean {
  return typeof Notification !== 'undefined';
}

export function computeCapabilities(platformKind?: string): ReadonlySet<Capability> {
  if (_overrides) return _overrides;
  if (_cached && platformKind === undefined) return _cached;

  const caps = new Set<Capability>();

  const tauri = platformKind === 'tauri' || (platformKind === undefined && isTauri());

  caps.add('fs.read');
  caps.add('fs.write');
  caps.add('shell.open');
  caps.add('backup');

  if (tauri) {
    caps.add('fs.watch');
    caps.add('fs.recentPaths');
    caps.add('archive');
    caps.add('nativeMenu');
    caps.add('multiWindow');
    caps.add('autoUpdate');
  }

  if (hasQueryLocalFonts()) {
    caps.add('fonts.local');
  }

  if (canReadClipboardImages()) {
    caps.add('clipboard.image');
  }

  if (hasNotifications()) {
    caps.add('notifications');
  }

  if (hasFileSystemAccessAPI()) {
    caps.add('fs.watch');
  }

  if (platformKind === undefined) {
    _cached = caps;
  }
  return caps;
}

export function resetCapabilitiesCache(): void {
  _cached = null;
}
