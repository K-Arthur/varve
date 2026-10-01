import {
  type PatternRepeatParams,
  patternIndexRange,
  patternInstanceMatrix,
  resolvePatternLattice,
} from '@varve/shared';

export interface PatternSourceImage {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PatternSourceCell {
  width: number;
  height: number;
}

const MAX_PERIODIC_SOURCE_COPIES = 4096;

/**
 * Return bounded copies of source artwork that contribute to one repeat cell.
 * Copies use the exact authored lattice basis and mirror parity used by fills.
 */
export function periodicPatternSourceMarkup(
  images: readonly PatternSourceImage[],
  cell: PatternSourceCell,
  params: PatternRepeatParams,
): string[] {
  const lattice = resolvePatternLattice({ ...params, offsetX: 0, offsetY: 0 });
  if (!lattice) throw new Error('Pattern repeat geometry is invalid for this source tile.');

  const bleed = sourceFootprintOverflow(images, cell, lattice.mirrorX, lattice.mirrorY);
  const range = patternIndexRange(lattice, { x: 0, y: 0, w: cell.width, h: cell.height }, bleed);
  if (!range)
    throw new Error('Pattern source footprint could not be bounded on its repeat lattice.');
  const columns = range.iMax - range.iMin + 1;
  const rows = range.jMax - range.jMin + 1;
  const candidateCount = columns * rows;
  if (
    !Number.isSafeInteger(candidateCount) ||
    candidateCount < 1 ||
    candidateCount * images.length > MAX_PERIODIC_SOURCE_COPIES
  ) {
    throw new Error('Pattern source spans too many repeat cells to compile safely.');
  }

  const markup: string[] = [];
  for (let j = range.jMin; j <= range.jMax; j += 1) {
    for (let i = range.iMin; i <= range.iMax; i += 1) {
      const matrix = patternInstanceMatrix(lattice, i, j);
      for (const image of images) {
        if (!intersectsCell(image, matrix, cell)) continue;
        const transform = matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index])
          ? ''
          : ` transform="matrix(${matrix.map(formatSvgNumber).join(' ')})"`;
        markup.push(
          `<image href="${escapeXml(image.href)}" x="${formatSvgNumber(image.x)}" y="${formatSvgNumber(image.y)}" width="${formatSvgNumber(image.width)}" height="${formatSvgNumber(image.height)}" preserveAspectRatio="none"${transform}/>`,
        );
      }
    }
  }
  if (markup.length === 0) throw new Error('Pattern source has no artwork inside its repeat cell.');
  return markup;
}

function sourceFootprintOverflow(
  images: readonly PatternSourceImage[],
  cell: PatternSourceCell,
  mirrorX: boolean,
  mirrorY: boolean,
): number {
  let bleed = 0;
  for (const image of images) {
    const xPositions = mirrorX ? [image.x, cell.width - image.x - image.width] : [image.x];
    const yPositions = mirrorY ? [image.y, cell.height - image.y - image.height] : [image.y];
    for (const x of xPositions) {
      for (const y of yPositions) {
        bleed = Math.max(
          bleed,
          -x,
          x + image.width - cell.width,
          -y,
          y + image.height - cell.height,
        );
      }
    }
  }
  return Math.max(0, bleed);
}

function intersectsCell(
  image: PatternSourceImage,
  matrix: readonly number[],
  cell: PatternSourceCell,
): boolean {
  const [a, b, c, d, e, f] = matrix as [number, number, number, number, number, number];
  const corners: Array<[number, number]> = [
    [image.x, image.y],
    [image.x + image.width, image.y],
    [image.x, image.y + image.height],
    [image.x + image.width, image.y + image.height],
  ];
  const transformedCorners = corners.map<[number, number]>(([x, y]) => [
    a * x + c * y + e,
    b * x + d * y + f,
  ]);
  const xs = transformedCorners.map(([x]) => x);
  const ys = transformedCorners.map(([, y]) => y);
  return (
    Math.max(...xs) > 0 &&
    Math.min(...xs) < cell.width &&
    Math.max(...ys) > 0 &&
    Math.min(...ys) < cell.height
  );
}

function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Pattern source transform must be finite.');
  return Object.is(value, -0) ? '0' : String(value);
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
