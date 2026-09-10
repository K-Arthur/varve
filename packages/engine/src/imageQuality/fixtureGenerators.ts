// @ts-nocheck
// Fixture generators are pure procedural pixel fills; bounds are explicit.
export function createCheckerboard(width: number, height: number, tileSize: number): ImageData {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const isWhite = (Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2 === 0;
      const v = isWhite ? 255 : 0;
      out.data[i] = v;
      out.data[i + 1] = v;
      out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

export function createSlantedEdge(width: number, height: number): ImageData {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const edgeX = x + y * 0.3;
      const v = edgeX < width / 2 ? 0 : 255;
      out.data[i] = v;
      out.data[i + 1] = v;
      out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

export function createGradient(width: number, height: number): ImageData {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = Math.round((x / width) * 255);
      const g = Math.round((y / height) * 255);
      const b = Math.round(((x + y) / (width + height)) * 255);
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

export function createSinglePixelLines(width: number, height: number): ImageData {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const isLine = y % 4 === 0 || x % 4 === 0 || x === y || x === height - y;
      out.data[i] = isLine ? 0 : 255;
      out.data[i + 1] = isLine ? 0 : 255;
      out.data[i + 2] = isLine ? 0 : 255;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

export function createAlphaRamp(width: number, height: number): ImageData {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out.data[i] = 128;
      out.data[i + 1] = 64;
      out.data[i + 2] = 192;
      out.data[i + 3] = Math.round((x / width) * 255);
    }
  }
  return out;
}

export function createColorPatches(width: number, height: number): ImageData {
  const out = new ImageData(width, height);
  const patches: { color: [number, number, number]; x: number; y: number }[] = [
    { color: [255, 0, 0], x: 0, y: 0 },
    { color: [0, 255, 0], x: width / 4, y: 0 },
    { color: [0, 0, 255], x: width / 2, y: 0 },
    { color: [255, 255, 0], x: 0, y: height / 4 },
    { color: [255, 0, 255], x: width / 4, y: height / 4 },
    { color: [0, 255, 255], x: width / 2, y: height / 4 },
    { color: [255, 255, 255], x: 0, y: height / 2 },
    { color: [128, 128, 128], x: width / 4, y: height / 2 },
    { color: [0, 0, 0], x: width / 2, y: height / 2 },
  ];
  const pw = width / 4;
  const ph = height / 3;
  for (const p of patches) {
    for (let dy = 0; dy < ph && p.y + dy < height; dy++) {
      for (let dx = 0; dx < pw && p.x + dx < width; dx++) {
        const i = ((p.y + dy) * width + (p.x + dx)) * 4;
        out.data[i] = p.color[0];
        out.data[i + 1] = p.color[1];
        out.data[i + 2] = p.color[2];
        out.data[i + 3] = 255;
      }
    }
  }
  return out;
}

export function createTileBoundaryProbe(
  width: number,
  height: number,
  tileSize: number,
): ImageData {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const tx = Math.floor(x / tileSize);
      const ty = Math.floor(y / tileSize);
      const r = (tx * 50 + ty * 30) % 256;
      const g = (tx * 70 + ty * 20) % 256;
      const b = (tx * 30 + ty * 80) % 256;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

export function createTransparentSubject(width: number, height: number): ImageData {
  const out = new ImageData(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < r) {
        out.data[i] = 64;
        out.data[i + 1] = 128;
        out.data[i + 2] = 255;
        out.data[i + 3] = 255;
      } else if (dist < r + 8) {
        const alpha = Math.round(Math.max(0, 1 - (dist - r) / 8) * 255);
        out.data[i] = 64;
        out.data[i + 1] = 128;
        out.data[i + 2] = 255;
        out.data[i + 3] = alpha;
      } else {
        out.data[i] = 0;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 0;
      }
    }
  }
  return out;
}

export function createCheckerboardWithAlpha(width: number, height: number): ImageData {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const isCheck = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      out.data[i] = isCheck ? 255 : 0;
      out.data[i + 1] = isCheck ? 128 : 0;
      out.data[i + 2] = isCheck ? 64 : 0;
      out.data[i + 3] = isCheck ? 255 : 0;
    }
  }
  return out;
}
