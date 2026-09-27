/**
 * Validate the small, memory-imported WebAssembly profile used by plugin API
 * v1 before compiling a guest. This bounds linear memory only; WebAssembly
 * engines and the host Worker do not provide a total process-memory cap.
 */
interface FunctionType {
  parameters: number[];
  results: number[];
}

const MAGIC = [0, 97, 115, 109, 1, 0, 0, 0];
const HOST_INITIAL_PAGES = 64;
const HOST_MAX_PAGES = 256;
const MAX_TABLE_ELEMENTS = 1024;
const NUMERIC_TYPES = new Set([0x7f, 0x7e, 0x7d, 0x7c, 0x7b]);

function sameSignature(type: FunctionType | undefined, parameters: number): boolean {
  return Boolean(
    type &&
      type.parameters.length === parameters &&
      type.parameters.every((value) => value === 0x7f) &&
      type.results.length === 1 &&
      type.results[0] === 0x7f,
  );
}

/** Parse the bounded binary framing shared by the handful of v1 sections. */
export function assertBoundedWasmSections(bytes: ArrayBuffer): void {
  const data = new Uint8Array(bytes);
  if (data.byteLength < 8 || !MAGIC.every((byte, index) => data[index] === byte)) {
    throw new Error('Invalid WebAssembly header');
  }

  let offset = 8;
  const readByte = (limit: number): number => {
    if (offset >= limit) throw new Error('Truncated WebAssembly section');
    return data[offset++]!;
  };
  const readU32 = (limit: number): number => {
    let value = 0;
    let shift = 0;
    for (let index = 0; index < 5; index++) {
      const byte = readByte(limit);
      value += (byte & 0x7f) * 2 ** shift;
      if (value > 0xffffffff) throw new Error('Invalid WebAssembly section size');
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    throw new Error('Invalid WebAssembly section size');
  };
  const readName = (limit: number): string => {
    const length = readU32(limit);
    if (offset + length > limit) throw new Error('Truncated WebAssembly section');
    const value = new TextDecoder('utf-8', { fatal: true }).decode(
      data.subarray(offset, offset + length),
    );
    offset += length;
    return value;
  };
  const readLimits = (limit: number) => {
    const flags = readU32(limit);
    if (flags !== 1) throw new Error('Plugin memory and tables require explicit maximums');
    const minimum = readU32(limit);
    const maximum = readU32(limit);
    return { minimum, maximum };
  };

  let types: FunctionType[] | undefined;
  let localFunctionTypes: number[] | undefined;
  let exports: Array<{ name: string; kind: number; index: number }> | undefined;
  let importedMemory = false;
  let definedMemory = false;
  let definedTable = false;
  let sectionMask = 0;

  while (offset < data.byteLength) {
    const id = readByte(data.byteLength);
    const size = readU32(data.byteLength);
    const end = offset + size;
    if (end > data.byteLength) throw new Error('Truncated WebAssembly section');
    if (id === 1 || id === 2 || id === 3 || id === 4 || id === 5 || id === 7) {
      const marker = 1 << id;
      if ((sectionMask & marker) !== 0) throw new Error('Duplicate WebAssembly section');
      sectionMask |= marker;
    }

    if (id === 1) {
      const count = readU32(end);
      if (count > 10_000) throw new Error('Plugin module has too many types');
      types = [];
      for (let typeIndex = 0; typeIndex < count; typeIndex++) {
        if (readByte(end) !== 0x60) {
          throw new Error('Plugin API v1 supports numeric function types only');
        }
        const parameterCount = readU32(end);
        if (parameterCount > 1_000) throw new Error('Plugin function type is too large');
        const parameters: number[] = [];
        for (let i = 0; i < parameterCount; i++) {
          const valueType = readByte(end);
          if (!NUMERIC_TYPES.has(valueType)) {
            throw new Error('Plugin API v1 supports numeric function types only');
          }
          parameters.push(valueType);
        }
        const resultCount = readU32(end);
        if (resultCount > 1_000) throw new Error('Plugin function type is too large');
        const results: number[] = [];
        for (let i = 0; i < resultCount; i++) {
          const valueType = readByte(end);
          if (!NUMERIC_TYPES.has(valueType)) {
            throw new Error('Plugin API v1 supports numeric function types only');
          }
          results.push(valueType);
        }
        types.push({ parameters, results });
      }
    } else if (id === 2) {
      const count = readU32(end);
      if (count !== 1) throw new Error('Plugin must import only env.memory');
      const module = readName(end);
      const name = readName(end);
      const kind = readByte(end);
      if (module !== 'env' || name !== 'memory' || kind !== 2) {
        throw new Error('Plugin must import only env.memory');
      }
      const { minimum, maximum } = readLimits(end);
      if (minimum > maximum || minimum > HOST_INITIAL_PAGES || maximum < HOST_MAX_PAGES) {
        throw new Error('Plugin memory limits do not match the v1 host memory');
      }
      importedMemory = true;
    } else if (id === 3) {
      const count = readU32(end);
      if (count > 100_000) throw new Error('Plugin module has too many functions');
      localFunctionTypes = Array.from({ length: count }, () => readU32(end));
    } else if (id === 4) {
      const count = readU32(end);
      if (count > 1) throw new Error('Guest may define at most one table');
      if (count === 1) {
        if (readByte(end) !== 0x70) throw new Error('Guest table must contain function references');
        const { minimum, maximum } = readLimits(end);
        if (minimum > maximum || maximum > MAX_TABLE_ELEMENTS) {
          throw new Error(
            `Guest table must have a maximum of at most ${MAX_TABLE_ELEMENTS} entries`,
          );
        }
        definedTable = true;
      }
    } else if (id === 5) {
      const count = readU32(end);
      if (count !== 0) throw new Error('Guest-defined memories are not allowed');
      definedMemory = count !== 0;
    } else if (id === 7) {
      const count = readU32(end);
      if (count > 10_000) throw new Error('Plugin module has too many exports');
      exports = Array.from({ length: count }, () => ({
        name: readName(end),
        kind: readByte(end),
        index: readU32(end),
      }));
    }

    if (offset > end) throw new Error('Invalid WebAssembly section size');
    offset = end;
  }

  if (definedMemory) throw new Error('Guest-defined memories are not allowed');
  if (!importedMemory) throw new Error('Plugin must import only env.memory');
  if (!types || !localFunctionTypes || !exports) {
    throw new Error('Plugin must declare v1 types, functions, and exports');
  }
  if (definedTable && localFunctionTypes.length === 0) {
    throw new Error('Plugin table requires a defined function');
  }

  const exportedFunctions = exports.filter((entry) => entry.kind === 0);
  const requiredNames = ['alloc', 'run', 'result_len'];
  if (
    exports.length !== requiredNames.length ||
    exportedFunctions.length !== requiredNames.length ||
    !requiredNames.every((name) => exportedFunctions.some((entry) => entry.name === name))
  ) {
    throw new Error('Guest may export only alloc, run, and result_len');
  }
  const requiredParameters: Record<string, number> = { alloc: 1, run: 2, result_len: 0 };
  for (const entry of exportedFunctions) {
    const typeIndex = localFunctionTypes[entry.index];
    if (
      typeIndex === undefined ||
      !sameSignature(types[typeIndex], requiredParameters[entry.name]!)
    ) {
      throw new Error(`Guest export ${entry.name} does not match the v1 ABI`);
    }
  }
}
