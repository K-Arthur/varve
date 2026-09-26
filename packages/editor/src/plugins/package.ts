/** Data-only validation for locally installed .varveplugin packages. */
import type { WorkspaceMode } from '@varve/shared';

export type PluginPermission = 'selection.read' | 'document.write';
export type PluginCommandKind = 'analysis' | 'rename';

export interface PluginCommandManifest {
  id: string;
  title: string;
  kind: PluginCommandKind;
}

export interface PluginInspectorManifest {
  id: string;
  title: string;
  command: string;
  tab: 'properties';
  modes?: WorkspaceMode[];
}

export interface PluginPackageManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  publisher: string;
  version: string;
  apiVersion: 1;
  entry: 'module.wasm';
  permissions: { required: PluginPermission[]; optional: PluginPermission[] };
  commands: PluginCommandManifest[];
  inspector?: PluginInspectorManifest[];
}

export interface PluginPackage {
  manifest: PluginPackageManifest;
  wasm: Uint8Array;
  /** SHA-256 of the exact package bytes, including ZIP metadata. */
  sha256: string;
}

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_WASM_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 128;
const MAX_JSON_DEPTH = 32;
const UTF8_FLAG = 1 << 11;
const decoder = new TextDecoder('utf-8', { fatal: true });
const PERMISSIONS = new Set<PluginPermission>(['selection.read', 'document.write']);
const MODES = new Set<WorkspaceMode>([
  'design',
  'print',
  'drawing',
  'image',
  'motion',
  'codegen',
  'logo',
  'email',
]);
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

interface ZipEntry {
  name: string;
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  localOffset: number;
  flags: number;
  data?: Uint8Array;
}

function fail(message: string): never {
  throw new Error(`Invalid plugin package: ${message}`);
}

function boundedRange(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.byteLength
  ) {
    fail('truncated or out-of-bounds ZIP record');
  }
  return bytes.subarray(offset, offset + length);
}

function u16(view: DataView, offset: number): number {
  if (offset + 2 > view.byteLength) fail('truncated ZIP field');
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) fail('truncated ZIP field');
  return view.getUint32(offset, true);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_PACKAGE_BYTES) {
    fail(`package must be between 22 bytes and ${MAX_PACKAGE_BYTES} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // No archive comments or trailing bytes are allowed. This also makes the
  // end-of-central-directory position unambiguous.
  const end = bytes.byteLength - 22;
  if (u32(view, end) !== END_SIGNATURE || u16(view, end + 20) !== 0) {
    fail('missing terminal ZIP directory or trailing data');
  }
  if (u16(view, end + 4) !== 0 || u16(view, end + 6) !== 0) fail('multi-disk ZIP is unsupported');
  const diskCount = u16(view, end + 8);
  const totalCount = u16(view, end + 10);
  if (diskCount !== 2 || totalCount !== 2) fail('package must contain exactly two entries');
  const centralSize = u32(view, end + 12);
  const centralOffset = u32(view, end + 16);
  if (centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('Zip64 is unsupported');
  if (centralOffset + centralSize !== end) fail('invalid central directory extent');

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  for (let i = 0; i < totalCount; i++) {
    if (cursor + 46 > end || u32(view, cursor) !== CENTRAL_SIGNATURE)
      fail('malformed central entry');
    const madeBy = u16(view, cursor + 4);
    const requiredVersion = u16(view, cursor + 6);
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const crc = u32(view, cursor + 16);
    const compressedSize = u32(view, cursor + 20);
    const size = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const disk = u16(view, cursor + 34);
    const externalAttributes = u32(view, cursor + 38);
    const localOffset = u32(view, cursor + 42);
    if (requiredVersion > 20 || flags & ~UTF8_FLAG || method !== 0) {
      fail('unsupported ZIP version, flags, encryption, descriptor, or compression');
    }
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      fail('Zip64 is unsupported');
    }
    if (compressedSize !== size) fail('stored entry size mismatch');
    if (!nameLength || nameLength > MAX_PATH_BYTES || extraLength || commentLength || disk) {
      fail('unsupported entry path, metadata, or disk');
    }
    // A UNIX mode declaring a link/device/directory must not be accepted as a
    // regular payload, even if its filename happens to match the allowlist.
    const unixType = madeBy >>> 8 === 3 ? (externalAttributes >>> 16) & 0xf000 : 0;
    if ((unixType !== 0 && unixType !== 0x8000) || externalAttributes & 0x10) {
      fail('links and directories are unsupported');
    }
    const recordLength = 46 + nameLength;
    if (cursor + recordLength > end) fail('truncated central entry');
    const nameBytes = boundedRange(bytes, cursor + 46, nameLength);
    let name: string;
    try {
      name = decoder.decode(nameBytes);
    } catch {
      fail('invalid UTF-8 entry path');
    }
    const canonical = name.normalize('NFC').toLocaleLowerCase('en-US');
    if (names.has(canonical)) fail('duplicate or colliding entry path');
    names.add(canonical);
    if (name !== 'manifest.json' && name !== 'module.wasm') {
      fail('package contains an unexpected or unsafe entry path');
    }
    const limit = name === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_WASM_BYTES;
    if (size > limit) fail(`${name} exceeds ${limit} bytes`);
    entries.push({ name, nameBytes, crc, size, localOffset, flags });
    cursor += recordLength;
  }
  if (cursor !== end || !names.has('manifest.json') || !names.has('module.wasm')) {
    fail('invalid ZIP directory or required entries');
  }

  let localCursor = 0;
  for (const entry of [...entries].sort((a, b) => a.localOffset - b.localOffset)) {
    const at = entry.localOffset;
    if (at !== localCursor || at + 30 > centralOffset || u32(view, at) !== LOCAL_SIGNATURE) {
      fail('malformed, overlapping, or prefixed local entry');
    }
    const requiredVersion = u16(view, at + 4);
    const flags = u16(view, at + 6);
    const method = u16(view, at + 8);
    const crc = u32(view, at + 14);
    const compressedSize = u32(view, at + 18);
    const size = u32(view, at + 22);
    const nameLength = u16(view, at + 26);
    const extraLength = u16(view, at + 28);
    if (
      requiredVersion > 20 ||
      flags !== entry.flags ||
      method !== 0 ||
      crc !== entry.crc ||
      compressedSize !== entry.size ||
      size !== entry.size ||
      nameLength !== entry.nameBytes.length ||
      extraLength !== 0
    ) {
      fail('local and central entry metadata disagree');
    }
    const nameBytes = boundedRange(bytes, at + 30, nameLength);
    if (!sameBytes(nameBytes, entry.nameBytes)) fail('local and central entry paths disagree');
    const dataStart = at + 30 + nameLength;
    const dataEnd = dataStart + entry.size;
    if (dataEnd > centralOffset) fail('entry payload overlaps central directory');
    entry.data = boundedRange(bytes, dataStart, entry.size);
    if (crc32(entry.data) !== entry.crc) fail(`CRC mismatch in ${entry.name}`);
    localCursor = dataEnd;
  }
  if (localCursor !== centralOffset) fail('junk between ZIP records');
  return new Map(entries.map((entry) => [entry.name, entry.data!]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): void {
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`missing manifest field ${key}`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) fail(`unsupported manifest field ${key}`);
}

function label(value: unknown, field: string, max = 120): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.trim() !== value ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    fail(`invalid ${field}`);
  }
  return value;
}

function stableId(value: unknown, field: string): string {
  const id = label(value, field, 80);
  if (!/^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/u.test(id)) fail(`invalid ${field}`);
  return id;
}

function semver(value: unknown): string {
  const version = label(value, 'version', 96);
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      version,
    );
  if (
    !match ||
    match.slice(1, 4).some((part) => part!.length > 1 && part!.startsWith('0')) ||
    match[4]
      ?.split('.')
      .some((part) => /^\d+$/u.test(part) && part.length > 1 && part.startsWith('0'))
  ) {
    fail('version must be strict semver');
  }
  return version;
}

/** Reject duplicate JSON keys before JSON.parse can silently keep the last one. */
function rejectDuplicateJsonKeys(source: string): void {
  let index = 0;
  const space = () => {
    while (/\s/u.test(source[index] ?? '')) index++;
  };
  const string = (): string => {
    const start = index++;
    while (index < source.length) {
      const char = source[index++];
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === '"') return JSON.parse(source.slice(start, index)) as string;
    }
    fail('unterminated JSON string');
  };
  const value = (depth: number): void => {
    if (depth > MAX_JSON_DEPTH) fail('manifest is too deeply nested');
    space();
    if (source[index] === '{') {
      index++;
      const keys = new Set<string>();
      space();
      while (source[index] !== '}' && index < source.length) {
        if (source[index] !== '"') fail('invalid JSON object key');
        const key = string();
        if (keys.has(key)) fail(`duplicate JSON key ${key}`);
        keys.add(key);
        space();
        if (source[index++] !== ':') fail('invalid JSON object separator');
        value(depth + 1);
        space();
        if (source[index] !== ',') break;
        index++;
        space();
      }
      if (source[index++] !== '}') fail('invalid JSON object');
    } else if (source[index] === '[') {
      index++;
      space();
      while (source[index] !== ']' && index < source.length) {
        value(depth + 1);
        space();
        if (source[index] !== ',') break;
        index++;
      }
      if (source[index++] !== ']') fail('invalid JSON array');
    } else if (source[index] === '"') {
      string();
    } else {
      const start = index;
      while (index < source.length && !/[\s,\]}]/u.test(source[index]!)) index++;
      if (index === start) fail('invalid JSON value');
    }
  };
  value(0);
  space();
  if (index !== source.length) fail('junk after manifest JSON');
}

function parseManifest(bytes: Uint8Array): PluginPackageManifest {
  let source: string;
  try {
    source = decoder.decode(bytes);
  } catch {
    fail('manifest is not UTF-8');
  }
  rejectDuplicateJsonKeys(source);
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    fail('manifest is not valid JSON');
  }
  if (!isRecord(raw)) fail('manifest must be an object');
  requireKeys(
    raw,
    [
      'schemaVersion',
      'id',
      'name',
      'publisher',
      'version',
      'apiVersion',
      'entry',
      'permissions',
      'commands',
    ],
    ['inspector'],
  );
  if (raw.schemaVersion !== 1 || raw.apiVersion !== 1 || raw.entry !== 'module.wasm') {
    fail('unsupported manifest schema, API version, or entry point');
  }
  const id = label(raw.id, 'id', 128);
  if (
    !/^(?:[a-z][a-z0-9-]*\.)+[a-z][a-z0-9-]*$/u.test(id) ||
    id.split('.').some((part) => part.endsWith('-'))
  ) {
    fail('id must be a lowercase reverse-domain identifier');
  }
  if (!isRecord(raw.permissions)) fail('permissions must be an object');
  requireKeys(raw.permissions, ['required', 'optional']);
  const seenPermissions = new Set<string>();
  const permissionList = (value: unknown): PluginPermission[] => {
    if (!Array.isArray(value)) fail('permissions must be arrays');
    return value.map((item: unknown) => {
      if (typeof item !== 'string' || !PERMISSIONS.has(item as PluginPermission))
        fail('unsupported permission');
      if (seenPermissions.has(item)) fail('duplicate permission');
      seenPermissions.add(item);
      return item as PluginPermission;
    });
  };
  const required = permissionList(raw.permissions.required);
  const optional = permissionList(raw.permissions.optional);
  if (seenPermissions.has('document.write') && !seenPermissions.has('selection.read')) {
    fail('document.write requires selection.read for API v1');
  }
  if (required.includes('document.write') && !required.includes('selection.read')) {
    fail('required document.write requires required selection.read for API v1');
  }
  if (!Array.isArray(raw.commands) || raw.commands.length < 1 || raw.commands.length > 8) {
    fail('commands must contain 1 to 8 entries');
  }
  const commandIds = new Set<string>();
  const commands = raw.commands.map((item: unknown): PluginCommandManifest => {
    if (!isRecord(item)) fail('command must be an object');
    requireKeys(item, ['id', 'title', 'kind']);
    const commandId = stableId(item.id, 'command id');
    if (commandIds.has(commandId)) fail('duplicate command id');
    commandIds.add(commandId);
    if (item.kind !== 'analysis' && item.kind !== 'rename') fail('unsupported command kind');
    if (item.kind === 'rename' && !seenPermissions.has('document.write')) {
      fail('rename commands require document.write');
    }
    return { id: commandId, title: label(item.title, 'command title'), kind: item.kind };
  });
  let inspector: PluginInspectorManifest[] | undefined;
  if (raw.inspector !== undefined) {
    if (!Array.isArray(raw.inspector) || raw.inspector.length > 8)
      fail('inspector must contain 0 to 8 entries');
    const inspectorIds = new Set<string>();
    inspector = raw.inspector.map((item: unknown): PluginInspectorManifest => {
      if (!isRecord(item)) fail('inspector entry must be an object');
      requireKeys(item, ['id', 'title', 'command', 'tab'], ['modes']);
      const sectionId = stableId(item.id, 'inspector id');
      if (inspectorIds.has(sectionId)) fail('duplicate inspector id');
      inspectorIds.add(sectionId);
      if (typeof item.command !== 'string' || !commandIds.has(item.command))
        fail('inspector references an unknown command');
      if (item.tab !== 'properties') fail('unsupported inspector tab');
      let modes: WorkspaceMode[] | undefined;
      if (item.modes !== undefined) {
        if (!Array.isArray(item.modes)) fail('inspector modes must be an array');
        const seen = new Set<string>();
        modes = item.modes.map((mode: unknown) => {
          if (typeof mode !== 'string' || !MODES.has(mode as WorkspaceMode) || seen.has(mode))
            fail('invalid or duplicate inspector mode');
          seen.add(mode);
          return mode as WorkspaceMode;
        });
      }
      return {
        id: sectionId,
        title: label(item.title, 'inspector title'),
        command: item.command,
        tab: 'properties',
        ...(modes ? { modes } : {}),
      };
    });
  }
  return {
    schemaVersion: 1,
    id,
    name: label(raw.name, 'name'),
    publisher: label(raw.publisher, 'publisher'),
    version: semver(raw.version),
    apiVersion: 1,
    entry: 'module.wasm',
    permissions: { required, optional },
    commands,
    ...(inspector ? { inspector } : {}),
  };
}

export async function parsePluginPackage(bytes: Uint8Array): Promise<PluginPackage> {
  // Realm-agnostic sanity check: a structured clone (IndexedDB in some
  // embeddings) can hand back a view from another realm. It is still bytes;
  // normalize below before validating anything.
  if (!ArrayBuffer.isView(bytes)) fail('package must be bytes');
  if (bytes.byteLength > MAX_PACKAGE_BYTES) fail(`package exceeds ${MAX_PACKAGE_BYTES} bytes`);
  // Keep validation, returned code, and integrity digest bound to one snapshot.
  const snapshot = Uint8Array.from(bytes);
  const files = parseZip(snapshot);
  const manifestBytes = files.get('manifest.json');
  const wasm = files.get('module.wasm');
  if (!manifestBytes || !wasm) fail('required package entries are missing');
  const manifest = parseManifest(manifestBytes);
  if (
    wasm.length < 8 ||
    !sameBytes(wasm.subarray(0, 8), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
  ) {
    fail('module.wasm is not a WebAssembly v1 module');
  }
  const digest = await crypto.subtle.digest('SHA-256', snapshot);
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return { manifest, wasm: Uint8Array.from(wasm), sha256 };
}
