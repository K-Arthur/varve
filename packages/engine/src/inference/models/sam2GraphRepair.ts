/**
 * SAM2 encoder graph repair for onnxruntime-web compatibility.
 *
 * The upstream sam2_hiera_tiny/small encoder exports declare EMPTY shapes
 * (`{}`) for the `/conv_s0/Conv_output_0` and `/conv_s1/Conv_output_0`
 * value_info entries. onnxruntime-node tolerates this with a lenient merge;
 * ort-web's wasm shape inference rejects the graph at session creation:
 *
 *   [ShapeInferenceError] Mismatch between number of inferred and declared
 *   dimensions. inferred=4 declared=0
 *
 * This module removes those two metadata-only entries from a downloaded
 * model before install (see scripts/models/repair-sam2-graph.mjs for the
 * identical standalone tool). It is a minimal wire-format protobuf editor:
 * nothing outside the two value_info entries is touched, and the repaired
 * graph produces bit-identical encoder outputs (verified against the
 * upstream graph with ort-node).
 */

const EMPTY_SHAPE_NAMES = new Set(['/conv_s0/Conv_output_0', '/conv_s1/Conv_output_0']);

function readVarint(buf: Uint8Array, pos: number): { value: number; pos: number } {
  let result = 0;
  let shift = 0;
  while (true) {
    const b = buf[pos++]!;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, pos };
}

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return bytes;
}

interface Field {
  fieldNum: number;
  wireType: number;
  start: number;
  tagEnd: number;
  end: number;
  payload: Uint8Array;
}

function readField(buf: Uint8Array, pos: number): Field {
  const tagStart = pos;
  const { value: tag, pos: afterTag } = readVarint(buf, pos);
  const fieldNum = tag >>> 3;
  const wireType = tag & 7;
  if (wireType === 2) {
    const { value: len, pos: afterLen } = readVarint(buf, afterTag);
    return {
      fieldNum,
      wireType,
      start: tagStart,
      tagEnd: afterTag,
      end: afterLen + len,
      payload: buf.subarray(afterLen, afterLen + len),
    };
  }
  if (wireType === 0) {
    const { pos: afterVal } = readVarint(buf, afterTag);
    return {
      fieldNum,
      wireType,
      start: tagStart,
      tagEnd: afterTag,
      end: afterVal,
      payload: buf.subarray(afterTag, afterTag),
    };
  }
  throw new Error(`unsupported protobuf wire type ${wireType}`);
}

function readFields(buf: Uint8Array, start = 0, end = buf.length): Field[] {
  const out: Field[] = [];
  let pos = start;
  while (pos < end) {
    const f = readField(buf, pos);
    out.push(f);
    pos = f.end;
  }
  return out;
}

function valueInfoName(payload: Uint8Array): string {
  for (const f of readFields(payload)) {
    if (f.fieldNum === 1) return new TextDecoder().decode(f.payload);
  }
  return '';
}

/**
 * Remove the empty-shape value_info entries the ort-web wasm shape
 * inference rejects. Returns the repaired model bytes, or the input bytes
 * unchanged when there is nothing to repair.
 */
export function repairSam2EncoderGraph(model: Uint8Array): Uint8Array {
  const modelFields = readFields(model);
  const graphField = modelFields.find((f) => f.fieldNum === 7);
  if (!graphField) return model;

  const graphFields = readFields(graphField.payload);
  const toRemove = graphFields.filter(
    (f) => f.fieldNum === 13 && EMPTY_SHAPE_NAMES.has(valueInfoName(f.payload)),
  );
  if (toRemove.length === 0) return model;

  const sorted = [...toRemove].sort((a, b) => a.start - b.start);
  let cursor = 0;
  const chunks: Uint8Array[] = [];
  for (const entry of sorted) {
    chunks.push(graphField.payload.subarray(cursor, entry.start));
    cursor = entry.end;
  }
  chunks.push(graphField.payload.subarray(cursor));

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const newGraphPayload = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    newGraphPayload.set(c, offset);
    offset += c.length;
  }

  const lenBytes = encodeVarint(newGraphPayload.length);
  const out = new Uint8Array(
    graphField.tagEnd + lenBytes.length + newGraphPayload.length + (model.length - graphField.end),
  );
  let o = 0;
  out.set(model.subarray(0, graphField.tagEnd), o);
  o += graphField.tagEnd;
  out.set(lenBytes, o);
  o += lenBytes.length;
  out.set(newGraphPayload, o);
  o += newGraphPayload.length;
  out.set(model.subarray(graphField.end), o);
  return out;
}

/** True when the model declares the empty value_info entries. */
export function needsSam2GraphRepair(model: Uint8Array): boolean {
  try {
    const graph = readFields(model).find((f) => f.fieldNum === 7);
    if (!graph) return false;
    return readFields(graph.payload).some(
      (f) => f.fieldNum === 13 && EMPTY_SHAPE_NAMES.has(valueInfoName(f.payload)),
    );
  } catch {
    return false;
  }
}
