#!/usr/bin/env node
/**
 * Repair the SAM2 encoder graph for onnxruntime-web compatibility.
 *
 * Why this exists: the upstream `sam2_hiera_tiny.encoder.onnx` declares two
 * value_info entries (`/conv_s0/Conv_output_0`, `/conv_s1/Conv_output_0`)
 * with EMPTY shapes (`{}`). onnxruntime-node's C++ tolerates this with a
 * lenient merge, but the ort-web WASM build's shape inference rejects it at
 * session creation:
 *
 *   [ShapeInferenceError] Mismatch between number of inferred and declared
 *   dimensions. inferred=4 declared=0
 *
 * The repair removes those two metadata-only entries. Verified bit-identical
 * inference: encoder outputs match the upstream model to the last digit
 * (ort-node session.run on 1024x1024 input).
 *
 * Usage: node scripts/models/repair-sam2-graph.mjs <input.onnx> <output.onnx>
 * Then pin the output's SHA-256 in the manifest/catalog.
 *
 * This is a minimal wire-format protobuf editor (ONNX ModelProto): it parses
 * ModelProto -> GraphProto -> value_info, removes the empty-shape entries,
 * and rewrites the graph field's length prefix. Nothing else in the file is
 * touched.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const EMPTY_SHAPE_NAMES = new Set(['/conv_s0/Conv_output_0', '/conv_s1/Conv_output_0']);

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  while (true) {
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, pos };
}

function encodeVarint(value) {
  let v = BigInt(value);
  const bytes = [];
  while (v >= 0x80n) {
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function readField(buf, pos) {
  const tagStart = pos;
  const { value: tag, pos: afterTag } = readVarint(buf, pos);
  const fieldNum = Number(tag >> 3n);
  const wireType = Number(tag & 7n);
  if (wireType === 2) {
    const { value: len, pos: afterLen } = readVarint(buf, afterTag);
    return {
      fieldNum,
      wireType,
      start: tagStart,
      tagEnd: afterTag,
      end: afterLen + Number(len),
      payload: buf.subarray(afterLen, afterLen + Number(len)),
    };
  }
  if (wireType === 0) {
    const { pos: afterVal } = readVarint(buf, afterTag);
    return { fieldNum, wireType, start: tagStart, tagEnd: afterTag, end: afterVal, payload: null };
  }
  throw new Error(`unsupported wire type ${wireType} at ${tagStart}`);
}

function readFields(buf, start = 0, end = buf.length) {
  const out = [];
  let pos = start;
  while (pos < end) {
    const f = readField(buf, pos);
    out.push(f);
    pos = f.end;
  }
  return out;
}

function valueInfoName(payload) {
  for (const f of readFields(payload)) {
    if (f.fieldNum === 1) return Buffer.from(f.payload).toString('utf8');
  }
  return '';
}

function valueInfoShapeDims(payload) {
  const dims = [];
  for (const f of readFields(payload)) {
    if (f.fieldNum === 2) {
      // TypeProto -> tensor_type(1) -> shape(2) -> dim(1) -> dim_value(1)
      for (const tf of readFields(f.payload)) {
        if (tf.fieldNum === 1) {
          for (const tt of readFields(tf.payload)) {
            if (tt.fieldNum === 2) {
              for (const dim of readFields(tt.payload)) {
                if (dim.fieldNum === 1) {
                  const { value } = readVarint(dim.payload, 0);
                  dims.push(Number(value));
                }
              }
            }
          }
        }
      }
    }
  }
  return dims;
}

function repair(inputPath, outputPath) {
  const model = readFileSync(inputPath);
  const modelFields = readFields(model);
  const graphField = modelFields.find((f) => f.fieldNum === 7);
  if (!graphField) throw new Error('no GraphProto field found');

  const graphFields = readFields(graphField.payload);
  const toRemove = graphFields.filter(
    (f) => f.fieldNum === 13 && EMPTY_SHAPE_NAMES.has(valueInfoName(f.payload)),
  );
  if (toRemove.length === 0) {
    console.log('no empty-shape value_info entries to repair — nothing to do');
    return false;
  }

  for (const entry of toRemove) {
    console.log('removing value_info:', valueInfoName(entry.payload));
  }

  const sorted = [...toRemove].sort((a, b) => a.start - b.start);
  let cursor = 0;
  const chunks = [];
  for (const entry of sorted) {
    chunks.push(graphField.payload.subarray(cursor, entry.start));
    cursor = entry.end;
  }
  chunks.push(graphField.payload.subarray(cursor));
  const newGraphPayload = Buffer.concat(chunks);

  // Sanity: the new payload must still parse, and no other empty-shape
  // value_info may remain.
  const reparsed = readFields(newGraphPayload);
  for (const f of reparsed) {
    if (f.fieldNum === 13 && valueInfoShapeDims(f.payload).length === 0) {
      console.warn('remaining empty-shape value_info:', valueInfoName(f.payload));
    }
  }

  const out = Buffer.concat([
    model.subarray(0, graphField.tagEnd),
    encodeVarint(newGraphPayload.length),
    newGraphPayload,
    model.subarray(graphField.end),
  ]);
  writeFileSync(outputPath, out);
  console.log(`wrote ${outputPath} (${out.length} bytes, was ${model.length})`);
  return true;
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/models/repair-sam2-graph.mjs <input.onnx> <output.onnx>');
  process.exit(1);
}
repair(inputPath, outputPath);
