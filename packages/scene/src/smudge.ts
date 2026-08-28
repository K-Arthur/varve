/**
 * Smudge — pigment transport with a carried reservoir.
 *
 * A smudge is not low-opacity paint. The brush picks colour up from the canvas
 * into a reservoir, carries it as it moves, and lays part of it back down;
 * that pickup/carry/deposit cycle is what makes a smudge trail fade with
 * distance and pull colour across boundaries the way a finger does.
 *
 * The reservoir also gives finger paint somewhere honest to live: instead of
 * stamping one foreground dab before an otherwise normal smudge, the
 * foreground colour is mixed into the reservoir on every pickup, so pressure,
 * flow and load act on it exactly as they act on picked-up pigment.
 */

import type { BrushDab } from './brush';
import { type CoverageMask, sampleCoverage } from './paintCoverage';
import {
  createBrushDabMask,
  makeTileKey,
  rasterBoundsForDab,
  sampleBrushMask,
  TILE_SIZE,
  tilesForDab,
} from './rasterLayer';
import type { RasterLayerNode, RasterTile } from './types';

export type SmudgeMode = 'pure' | 'fingerPaint' | 'loaded';

/**
 * Mean brush-mask coverage over a tip, used to convert a centre-of-tip deposit
 * fraction into the fraction of the reservoir a whole dab actually transfers.
 */
const TIP_DEPOSIT_FRACTION = 0.5;

export interface SmudgeState {
  /** Straight (unpremultiplied) carried colour, 0-255. */
  r: number;
  g: number;
  b: number;
  a: number;
  /** How full the reservoir is, 0-1. Zero means nothing has been picked up. */
  load: number;
}

export interface SmudgeOptions {
  mode: SmudgeMode;
  /** How much pigment moves per dab, 0-1. */
  strength: number;
  /**
   * How much of the canvas is taken into the reservoir per dab, 0-1.
   * Low values give a long trail, high values a short one.
   */
  pickup: number;
  /** Foreground colour, used by fingerPaint and loaded modes. */
  foreground: readonly [number, number, number, number];
  /** Starting reservoir fill for `loaded` mode, 0-1. */
  initialLoad?: number;
  coverage?: CoverageMask | null;
  alphaLock?: boolean;
  /**
   * Tiles to pick colour up from. Defaults to the target layer's own tiles.
   *
   * "Sample all layers" passes a flattened composite of the visible stack here.
   * Deposits still land on the target alone, so smudging across a stack never
   * bakes it into one layer.
   */
  sampleTiles?: Map<string, RasterTile> | null;
}

export function createSmudgeState(options: SmudgeOptions): SmudgeState {
  if (options.mode === 'loaded') {
    const load = Math.max(0, Math.min(1, options.initialLoad ?? 1));
    return {
      r: options.foreground[0],
      g: options.foreground[1],
      b: options.foreground[2],
      a: options.foreground[3],
      load,
    };
  }
  return { r: 0, g: 0, b: 0, a: 0, load: 0 };
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Mean colour under a dab, weighted by the brush mask. Null if nothing there. */
function averageUnderDab(
  tiles: Map<string, RasterTile>,
  dab: BrushDab,
  mask: Float64Array,
  size: number,
): Rgba | null {
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let wa = 0;
  let weight = 0;
  const { minX: startX, minY: startY, maxX: endX, maxY: endY } = rasterBoundsForDab(dab);

  for (let py = startY; py < endY; py++) {
    for (let px = startX; px < endX; px++) {
      const m = sampleBrushMask(
        mask,
        size,
        px - (dab.x - dab.radius),
        py - (dab.y - dab.radius),
        dab,
      );
      if (m <= 0) continue;
      const col = Math.floor(px / TILE_SIZE);
      const row = Math.floor(py / TILE_SIZE);
      const tile = tiles.get(makeTileKey(col, row));
      if (!tile) continue;
      const ox = px - col * TILE_SIZE;
      const oy = py - row * TILE_SIZE;
      const i = (oy * TILE_SIZE + ox) * 4;
      wr += tile.pixels[i]! * m;
      wg += tile.pixels[i + 1]! * m;
      wb += tile.pixels[i + 2]! * m;
      wa += tile.pixels[i + 3]! * m;
      weight += m;
    }
  }
  if (weight === 0) return null;
  return { r: wr / weight, g: wg / weight, b: wb / weight, a: wa / weight };
}

/**
 * Apply one smudge dab, mutating `state` to reflect what the brush now carries.
 *
 * Order matters: pickup happens before deposit, so a dab both takes colour from
 * where it lands and leaves what it was already carrying. Depositing first
 * would make the brush immediately re-collect its own output and the trail
 * would never fade.
 */
export function compositeSmudgeDab(
  node: RasterLayerNode,
  dab: BrushDab,
  state: SmudgeState,
  options: SmudgeOptions,
): RasterLayerNode {
  const mask = createBrushDabMask(dab);
  const size = Math.ceil(dab.radius * 2);
  const coverage = options.coverage ?? null;
  const alphaLock = options.alphaLock ?? false;
  const strength = Math.max(0, Math.min(1, options.strength));
  const pickup = Math.max(0, Math.min(1, options.pickup));

  // ── Pickup ──────────────────────────────────────────────────────────────
  const pickupSource = options.sampleTiles ?? node.tiles;
  const sampled = averageUnderDab(pickupSource, dab, mask, size);
  if (sampled) {
    const take = pickup * dab.opacity;
    mixInto(state, sampled, take);
    state.load = Math.min(1, state.load + take);
  }
  if (options.mode === 'fingerPaint') {
    // Foreground participates in the reservoir rather than being stamped once,
    // so it fades and mixes under pressure like any other carried pigment.
    const fg = options.foreground;
    const contribution = pickup * dab.opacity;
    mixInto(state, { r: fg[0], g: fg[1], b: fg[2], a: fg[3] }, contribution);
    state.load = Math.min(1, state.load + contribution);
  }
  if (state.load <= 0) return node;

  // ── Deposit ─────────────────────────────────────────────────────────────
  const tileKeys = tilesForDab(dab);
  const newTiles = new Map(node.tiles);
  const { minX: startX, minY: startY, maxX: endX, maxY: endY } = rasterBoundsForDab(dab);

  for (const { col, row } of tileKeys) {
    const key = makeTileKey(col, row);
    const tile = newTiles.get(key);
    if (!tile && alphaLock) continue;
    const pixels = tile
      ? new Uint8ClampedArray(tile.pixels)
      : new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    const originX = col * TILE_SIZE;
    const originY = row * TILE_SIZE;
    let wrote = false;

    for (let layerY = startY; layerY < endY; layerY++) {
      const py = layerY - originY;
      if (py < 0 || py >= TILE_SIZE) continue;
      for (let layerX = startX; layerX < endX; layerX++) {
        const m = sampleBrushMask(
          mask,
          size,
          layerX - (dab.x - dab.radius),
          layerY - (dab.y - dab.radius),
          dab,
        );
        if (m <= 0) continue;
        const px = layerX - originX;
        if (px < 0 || px >= TILE_SIZE) continue;

        const selection = coverage ? sampleCoverage(coverage, layerX, layerY) : 1;
        if (selection <= 0) continue;

        const idx = (py * TILE_SIZE + px) * 4;
        const destAlpha = pixels[idx + 3]!;
        let t = m * strength * dab.opacity * dab.flow * state.load * selection;
        if (alphaLock) {
          if (destAlpha === 0) continue;
          t *= destAlpha / 255;
        }
        if (t <= 0) continue;
        // Pure smudge only moves pigment that already exists; it must not
        // conjure colour into transparent pixels.
        if (options.mode === 'pure' && destAlpha === 0) continue;

        const inv = 1 - t;
        pixels[idx] = clampByte(pixels[idx]! * inv + state.r * t);
        pixels[idx + 1] = clampByte(pixels[idx + 1]! * inv + state.g * t);
        pixels[idx + 2] = clampByte(pixels[idx + 2]! * inv + state.b * t);
        pixels[idx + 3] = alphaLock ? destAlpha : clampByte(destAlpha * inv + state.a * t);
        wrote = true;
      }
    }

    if (!tile && !wrote) continue;
    newTiles.set(key, { pixels, version: (tile?.version ?? 0) + 1 });
  }

  // The reservoir loses what it laid down. `strength * flow` is the deposit
  // fraction at the centre of the tip, but coverage falls off across the mask,
  // so the amount actually transferred integrates to roughly half that —
  // draining by the peak instead emptied the brush within two or three dabs
  // and the trail died before it left the shape it started in.
  //
  // Pickup replenishes on the next dab, so over painted canvas the reservoir
  // reaches an equilibrium and the smear carries; over bare canvas there is
  // nothing to replenish it, and the trail fades out on its own.
  state.load = Math.max(0, state.load * (1 - strength * dab.flow * TIP_DEPOSIT_FRACTION));
  return { ...node, tiles: newTiles };
}

function mixInto(state: SmudgeState, incoming: Rgba, amount: number): void {
  if (amount <= 0) return;
  const t = Math.max(0, Math.min(1, amount));
  const inv = 1 - t;
  state.r = state.r * inv + incoming.r * t;
  state.g = state.g * inv + incoming.g * t;
  state.b = state.b * inv + incoming.b * t;
  state.a = state.a * inv + incoming.a * t;
}

function clampByte(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}
