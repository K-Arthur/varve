/** Browser raster fallback: straight RGBA8 to DeviceRGB + optional soft mask.
 * Binary stream lengths and xref offsets are measured in bytes, not characters.
 * This is an ordinary PDF 1.4 image page, not a PDF/X or ICC-managed print path. */
export function makeRasterImagePdf(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const count = width * height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(count) ||
    pixels.length !== count * 4
  )
    throw new Error('Invalid RGBA raster PDF dimensions');
  const rgb = new Uint8Array(count * 3);
  let hasAlpha = false;
  for (let i = 0; i < count; i++) {
    const source = i * 4,
      target = i * 3;
    rgb[target] = pixels[source]!;
    rgb[target + 1] = pixels[source + 1]!;
    rgb[target + 2] = pixels[source + 2]!;
    if (pixels[source + 3] !== 255) hasAlpha = true;
  }
  const alpha = hasAlpha ? new Uint8Array(count) : null;
  if (alpha) for (let i = 0; i < count; i++) alpha[i] = pixels[i * 4 + 3]!;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let position = 0;
  const bytes = (value: Uint8Array) => {
    chunks.push(value);
    position += value.length;
  };
  const text = (value: string) => bytes(encoder.encode(value));
  const object = (id: number, content: string) => {
    offsets[id] = position;
    text(`${id} 0 obj\n${content}\nendobj\n`);
  };
  const stream = (id: number, dictionary: string, data: Uint8Array) => {
    offsets[id] = position;
    text(`${id} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`);
    bytes(data);
    text('\nendstream\nendobj\n');
  };
  text('%PDF-1.4\n');
  bytes(new Uint8Array([37, 128, 129, 130, 131, 10]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${width} ${height} ] /Contents 5 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>`,
  );
  stream(
    4,
    `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8${alpha ? ' /SMask 6 0 R' : ''}`,
    rgb,
  );
  stream(5, '', encoder.encode(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`));
  if (alpha)
    stream(
      6,
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8`,
      alpha,
    );
  const xref = position,
    size = offsets.length;
  text(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) text(`${String(offset).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result = new Uint8Array(position);
  let next = 0;
  for (const chunk of chunks) {
    result.set(chunk, next);
    next += chunk.length;
  }
  return result;
}
