/** Read only bounded, allowlisted JSON entries; never extract archive paths. */
import { createHash } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;
const hash = (value) => createHash('sha256').update(value).digest('hex');

function evidenceJson(bytes) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    // Parser excerpts may contain signed URLs or other credential-bearing data.
    throw new Error('evidence ZIP JSON is malformed or not valid UTF-8');
  }
}

function endRecord(bytes) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    )
      return offset;
  }
  throw new Error('evidence ZIP end record is missing');
}

export function readEvidenceZip(bytes, allowedNames) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_BYTES)
    throw new Error('evidence ZIP size is invalid');
  const end = endRecord(bytes);
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== count ||
    count !== allowedNames.length ||
    offset + size !== end
  )
    throw new Error('evidence ZIP directory is invalid');
  const found = {};
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('evidence ZIP entry is invalid');
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const expectedCrc = bytes.readUInt32LE(offset + 16);
    const compressed = bytes.readUInt32LE(offset + 20);
    const uncompressed = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extraSize = bytes.readUInt16LE(offset + 30);
    const commentSize = bytes.readUInt16LE(offset + 32);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16;
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    const next = offset + 46 + nameSize + extraSize + commentSize;
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      !allowedNames.includes(name) ||
      Object.hasOwn(found, name) ||
      uncompressed > MAX_ENTRY_BYTES ||
      (mode & 0xf000) === 0xa000 ||
      local + 30 > offset ||
      bytes.readUInt32LE(local) !== 0x04034b50
    )
      throw new Error('evidence ZIP contains an unsupported or unexpected entry');
    const localNameSize = bytes.readUInt16LE(local + 26);
    const localExtraSize = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameSize + localExtraSize;
    if (
      bytes.subarray(local + 30, local + 30 + localNameSize).toString('utf8') !== name ||
      bytes.readUInt16LE(local + 8) !== method ||
      start + compressed > offset
    )
      throw new Error('evidence ZIP local header mismatch');
    const data = bytes.subarray(start, start + compressed);
    const text = method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }) : data;
    if (text.length !== uncompressed || crc32(text) !== expectedCrc)
      throw new Error('evidence ZIP entry checksum mismatch');
    found[name] = evidenceJson(text);
    offset = next;
  }
  if (offset !== end || allowedNames.some((name) => !Object.hasOwn(found, name)))
    throw new Error('evidence ZIP file set mismatch');
  return found;
}

async function boundedBody(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('evidence download has no body');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('evidence download exceeded its byte limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadRequest(fetcher, url, options) {
  try {
    return await fetcher(url, options);
  } catch {
    throw Object.assign(new Error('GitHub evidence download timed out or could not connect'), {
      external: true,
    });
  }
}

export async function readCertificationArtifact({
  repo,
  token,
  artifact,
  names,
  now = Date.now(),
  fetcher = fetch,
}) {
  if (
    artifact?.expired !== false ||
    !Number.isSafeInteger(artifact?.id) ||
    artifact.id <= 0 ||
    !Number.isFinite(Date.parse(artifact.expires_at)) ||
    Date.parse(artifact.expires_at) <= now ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '') ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes < 22 ||
    artifact.size_in_bytes > MAX_BYTES
  )
    throw new Error('certification artifact metadata is incomplete or expired');
  const response = await downloadRequest(
    fetcher,
    `https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`,
    {
      headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status !== 302)
    throw new Error(`certification artifact redirect failed (${response.status})`);
  const location = new URL(response.headers.get('location'));
  if (location.protocol !== 'https:' || location.username || location.password || location.hash)
    throw new Error('certification artifact redirect is unsafe');
  // GitHub owns the signed redirect. Never forward the GitHub token to storage,
  // and never include the credential-bearing Location URL in diagnostics.
  const download = await downloadRequest(fetcher, location.href, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!download.ok) throw new Error(`certification artifact download failed (${download.status})`);
  const bytes = await boundedBody(download);
  if (`sha256:${hash(bytes)}` !== artifact.digest)
    throw new Error('certification artifact digest mismatch');
  return {
    documents: readEvidenceZip(bytes, names),
    artifactId: artifact.id,
    digest: artifact.digest,
  };
}
