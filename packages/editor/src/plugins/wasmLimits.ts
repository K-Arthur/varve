/** Bound guest-defined allocations before WebAssembly.instantiate. */
export function assertBoundedWasmSections(bytes: ArrayBuffer): void {
  const data = new Uint8Array(bytes);
  if (
    data.length < 8 ||
    data[0] !== 0 ||
    data[1] !== 97 ||
    data[2] !== 115 ||
    data[3] !== 109 ||
    data[4] !== 1 ||
    data[5] !== 0 ||
    data[6] !== 0 ||
    data[7] !== 0
  )
    throw new Error('Invalid WebAssembly header');

  let offset = 8;
  const readU32 = (limit: number): number => {
    let value = 0;
    let shift = 0;
    for (let index = 0; index < 5; index++) {
      if (offset >= limit) throw new Error('Truncated WebAssembly section');
      const byte = data[offset++]!;
      value += (byte & 0x7f) * 2 ** shift;
      if (value > 0xffffffff) throw new Error('Invalid WebAssembly section size');
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    throw new Error('Invalid WebAssembly section size');
  };

  while (offset < data.length) {
    const id = data[offset++]!;
    const size = readU32(data.length);
    const end = offset + size;
    if (end > data.length) throw new Error('Truncated WebAssembly section');
    if (id === 4) {
      const count = readU32(end);
      if (count > 1) throw new Error('Guest may define at most one table');
      for (let i = 0; i < count; i++) {
        if (offset >= end || data[offset++] !== 0x70) {
          throw new Error('Guest table must contain function references');
        }
        const flags = readU32(end);
        const minimum = readU32(end);
        const maximum = flags === 1 ? readU32(end) : undefined;
        if (maximum === undefined || minimum > maximum || maximum > 1024) {
          throw new Error('Guest table must have a maximum of at most 1024 entries');
        }
      }
    }
    if (id === 5 && readU32(end) !== 0) {
      throw new Error('Guest-defined memories are not allowed');
    }
    offset = end;
  }
}
