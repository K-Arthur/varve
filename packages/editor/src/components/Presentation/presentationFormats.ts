import { zipSync, zlibSync } from 'fflate';

export interface PresentationRasterPage {
  width: number;
  height: number;
  pixels: Uint8Array | Uint8ClampedArray;
}

interface CompressedPage {
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha: Uint8Array;
}

const MAX_COMPRESSED_PDF_BYTES = 256 * 1024 * 1024;

function validatePage(page: PresentationRasterPage): void {
  const pixels = page.width * page.height;
  if (
    !Number.isInteger(page.width) ||
    !Number.isInteger(page.height) ||
    page.width <= 0 ||
    page.height <= 0 ||
    !Number.isSafeInteger(pixels) ||
    pixels > 64_000_000 ||
    page.pixels.length !== pixels * 4
  ) {
    throw new Error('Presentation slide exceeds the 64 million pixel delivery limit');
  }
}

function buildPdf(pages: readonly CompressedPage[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let position = 0;
  const bytes = (chunk: Uint8Array) => {
    chunks.push(chunk);
    position += chunk.length;
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
  const pageIds = pages.map((_, index) => 3 + index * 4);
  object(
    2,
    `<< /Type /Pages /Kids [ ${pageIds.map((id) => `${id} 0 R`).join(' ')} ] /Count ${pages.length} >>`,
  );

  for (const [index, page] of pages.entries()) {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const alphaId = pageId + 3;
    const widthPt = (page.width * 72) / 96;
    const heightPt = (page.height * 72) / 96;
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${widthPt} ${heightPt} ] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> >> >>`,
    );
    stream(contentId, '', encoder.encode(`q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ`));
    stream(
      imageId,
      `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${alphaId} 0 R`,
      page.rgb,
    );
    stream(
      alphaId,
      `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
      page.alpha,
    );
  }

  const xref = position;
  text(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) {
    text(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  text(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const output = new Uint8Array(position);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

/**
 * Encodes pages as they arrive, retaining only compressed image streams. This
 * lets export release each decoded pixel buffer before capturing the next slide.
 */
export class PresentationPdfBuilder {
  private readonly pages: CompressedPage[] = [];
  private compressedBytes = 0;

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(page: PresentationRasterPage): void {
    validatePage(page);
    const pixelCount = page.width * page.height;
    const rgb = new Uint8Array(pixelCount * 3);
    const alpha = new Uint8Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const source = pixel * 4;
      const target = pixel * 3;
      rgb[target] = page.pixels[source]!;
      rgb[target + 1] = page.pixels[source + 1]!;
      rgb[target + 2] = page.pixels[source + 2]!;
      alpha[pixel] = page.pixels[source + 3]!;
    }
    const compressedRgb = zlibSync(rgb, { level: 6 });
    const compressedAlpha = zlibSync(alpha, { level: 6 });
    const nextByteCount = this.compressedBytes + compressedRgb.length + compressedAlpha.length;
    if (nextByteCount > MAX_COMPRESSED_PDF_BYTES) {
      throw new Error(
        'Presentation PDF exceeds the 256 MB compressed image limit. Export fewer slides.',
      );
    }
    this.compressedBytes = nextByteCount;
    this.pages.push({
      width: page.width,
      height: page.height,
      rgb: compressedRgb,
      alpha: compressedAlpha,
    });
  }

  finish(): Uint8Array {
    if (this.pages.length === 0)
      throw new Error('Add at least one included slide before exporting');
    return buildPdf(this.pages);
  }
}

/** Create a compressed, raster-only screen PDF. Each slide keeps its own page size. */
export function makePresentationPdf(pages: readonly PresentationRasterPage[]): Uint8Array {
  const builder = new PresentationPdfBuilder();
  for (const page of pages) builder.addPage(page);
  return builder.finish();
}

function safeSlideName(name: string): string {
  const clean = name
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replaceAll('\u0000', '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return clean || 'slide';
}

/** Create an ordered PNG archive; the numeric prefix preserves deck order in file browsers. */
export function makePresentationPngArchive(
  slides: readonly { title: string; png: Uint8Array }[],
): Uint8Array {
  if (slides.length === 0) throw new Error('Add at least one included slide before exporting');
  const files: Record<string, Uint8Array> = {};
  for (const [index, slide] of slides.entries()) {
    const sequence = String(index + 1).padStart(Math.max(2, String(slides.length).length), '0');
    const fileName = `${sequence}-${safeSlideName(slide.title)}.png`;
    if (files[fileName]) throw new Error(`Slide filenames are not unique: ${fileName}`);
    files[fileName] = slide.png;
  }
  return zipSync(files, { level: 6 });
}
