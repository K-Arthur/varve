/**
 * Extract one exact face from a TrueType/OpenType collection.
 *
 * Native enumeration returns the original TTC/OTC artifact for an opaque
 * handle. `FontFace` does not expose a portable member selector, so the
 * selected member is rebuilt as a standalone SFNT before registration.
 */

import { detectFontFormat } from './fontIdentity';

const TTC_SIGNATURE = 0x74746366; // "ttcf"
const MAX_COLLECTION_MEMBERS = 64;
const MAX_TABLES = 4096;
const DEFAULT_DEADLINE_MS = 2_000;

function deadlineCheck(deadline: number): void {
  if (Date.now() >= deadline) throw new Error('Font collection extraction timed out');
}

/** Return a standalone TTF/OTF face; non-collections are copied unchanged. */
export async function extractFontCollectionMember(
  data: ArrayBuffer,
  collectionIndex = 0,
): Promise<ArrayBuffer> {
  const deadline = Date.now() + DEFAULT_DEADLINE_MS;
  if (!Number.isInteger(collectionIndex) || collectionIndex < 0) {
    throw new Error('Invalid font collection member index');
  }

  const format = detectFontFormat(data);
  if (format !== 'ttc' && format !== 'otc') {
    if (collectionIndex !== 0) throw new Error('A non-collection font has only member 0');
    return data.slice(0);
  }

  if (data.byteLength < 12) throw new Error('Invalid font collection header');
  const view = new DataView(data);
  if (view.getUint32(0) !== TTC_SIGNATURE) throw new Error('Invalid font collection header');
  const version = view.getUint32(4);
  if (version !== 0x00010000 && version !== 0x00020000) {
    throw new Error('Unsupported font collection version');
  }
  const count = view.getUint32(8);
  if (count === 0 || count > MAX_COLLECTION_MEMBERS || collectionIndex >= count) {
    throw new Error('Invalid font collection member index');
  }

  const offsetPosition = 12 + collectionIndex * 4;
  if (offsetPosition + 4 > data.byteLength) {
    throw new Error('Truncated font collection offset table');
  }
  const sfntOffset = view.getUint32(offsetPosition);
  if (sfntOffset > data.byteLength || sfntOffset + 12 > data.byteLength) {
    throw new Error('Font collection member header is outside the artifact');
  }

  const flavor = view.getUint32(sfntOffset);
  const numTables = view.getUint16(sfntOffset + 4);
  if (numTables === 0 || numTables > MAX_TABLES) {
    throw new Error('Invalid font collection member table count');
  }
  const directoryEnd = sfntOffset + 12 + numTables * 16;
  if (directoryEnd > data.byteLength) {
    throw new Error('Truncated font collection member table directory');
  }

  const tables = new Map<string, ArrayBuffer>();
  const seen = new Set<string>();
  for (let i = 0; i < numTables; i++) {
    deadlineCheck(deadline);
    const entryOffset = sfntOffset + 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(entryOffset),
      view.getUint8(entryOffset + 1),
      view.getUint8(entryOffset + 2),
      view.getUint8(entryOffset + 3),
    );
    if (seen.has(tag)) throw new Error(`Duplicate font table: ${tag}`);
    seen.add(tag);
    const tableOffset = view.getUint32(entryOffset + 8);
    const tableLength = view.getUint32(entryOffset + 12);
    if (tableOffset > data.byteLength || tableLength > data.byteLength - tableOffset) {
      throw new Error(`Font table ${tag} is outside the artifact`);
    }
    tables.set(tag, data.slice(tableOffset, tableOffset + tableLength));
  }

  return reconstructSFNT(tables, flavor);
}

function reconstructSFNT(tables: Map<string, ArrayBuffer>, flavor: number): ArrayBuffer {
  if (tables.size === 0) throw new Error('Font collection member has no tables');
  const tags = [...tables.keys()].sort();
  const headerSize = 12;
  const directorySize = tags.length * 16;
  let offset = headerSize + directorySize;
  const records: Array<{ tag: string; offset: number; length: number; checksum: number }> = [];

  for (const tag of tags) {
    const table = tables.get(tag)!;
    records.push({
      tag,
      offset,
      length: table.byteLength,
      checksum: tableChecksum(table, tag === 'head'),
    });
    offset += (table.byteLength + 3) & ~3;
  }

  const output = new ArrayBuffer(offset);
  const bytes = new Uint8Array(output);
  const out = new DataView(output);
  const entrySelector = Math.floor(Math.log2(tags.length));
  const searchRange = 2 ** entrySelector * 16;
  out.setUint32(0, flavor);
  out.setUint16(4, tags.length);
  out.setUint16(6, searchRange);
  out.setUint16(8, entrySelector);
  out.setUint16(10, tags.length * 16 - searchRange);

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const directoryOffset = headerSize + i * 16;
    for (let j = 0; j < 4; j++) bytes[directoryOffset + j] = record.tag.charCodeAt(j);
    out.setUint32(directoryOffset + 4, record.checksum);
    out.setUint32(directoryOffset + 8, record.offset);
    out.setUint32(directoryOffset + 12, record.length);
    bytes.set(new Uint8Array(tables.get(record.tag)!), record.offset);
  }

  const head = records.find((record) => record.tag === 'head');
  if (head && head.length >= 12) {
    out.setUint32(head.offset + 8, 0);
    out.setUint32(head.offset + 8, (0xb1b0afba - tableChecksum(output)) >>> 0);
  }
  return output;
}

function tableChecksum(data: ArrayBuffer, skipAdjustment = false): number {
  const paddedLength = (data.byteLength + 3) & ~3;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(new Uint8Array(data));
  const view = new DataView(bytes.buffer);
  let sum = 0;
  for (let offset = 0; offset < paddedLength; offset += 4) {
    if (skipAdjustment && offset === 8) continue;
    sum = (sum + view.getUint32(offset)) >>> 0;
  }
  return sum;
}
