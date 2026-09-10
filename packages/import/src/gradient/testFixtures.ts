/**
 * Test-only generator for Photoshop `.grd` fixtures.
 *
 * Clean-room writer that mirrors the documented file layouts so tests can
 * exercise the parser without shipping proprietary Adobe presets. Two
 * generators:
 *
 *  - `buildModernGrd` — descriptor-based format ("8BGR" signature, `GrdL`
 *    descriptor list), the format Photoshop CS6+ writes.
 *  - `buildLegacyGrd` — classic fixed-layout format ("Grad" signature).
 *
 * The byte layouts intentionally mirror `photoshopGrd.ts` (reader) and the
 * public documentation (Adobe PSD spec descriptor format; hi104/psd-grd;
 * grdconverter). All multi-byte values are big-endian.
 */
import { GRD_LIMITS } from './descriptor';

export interface FixtureColorStop {
  position: number; // 0-1
  midpoint?: number; // 0-1
  color: readonly [number, number, number, number]; // 0-255 RGBA
  colorModel?: 'RGBC' | 'HSBC' | 'CMYC' | 'Grsc';
  /** Raw components for non-RGBC models. */
  raw?: {
    h?: number;
    s?: number;
    v?: number;
    c?: number;
    m?: number;
    y?: number;
    k?: number;
    gray?: number;
  };
}

export interface FixtureOpacityStop {
  position: number; // 0-1
  midpoint?: number; // 0-1
  opacity: number; // 0-1
}

export interface FixtureGradientSpec {
  name: string;
  colorStops: FixtureColorStop[];
  opacityStops?: FixtureOpacityStop[];
  smoothness?: number; // 0-1
  isNoise?: boolean;
}

// ── Descriptor writer (big-endian) ───────────────────────────────────────────

class ByteSink {
  private out: number[] = [];

  get bytes(): Uint8Array {
    return new Uint8Array(this.out);
  }

  u8(v: number): void {
    this.out.push(v & 0xff);
  }

  u16(v: number): void {
    this.out.push((v >> 8) & 0xff, v & 0xff);
  }

  u32(v: number): void {
    this.out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }

  f64(v: number): void {
    const buf = new Uint8Array(new ArrayBuffer(8));
    new DataView(buf.buffer).setFloat64(0, v, false);
    for (let i = 0; i < 8; i++) this.out.push(buf[i]!);
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.out.push(s.charCodeAt(i) & 0xff);
  }

  utf16(s: string): void {
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
  }
}

function writeObjc(
  s: ByteSink,
  name: string,
  typename: string,
  props: [string, () => void][],
): void {
  s.ascii('Objc');
  s.u32(name.length);
  s.utf16(name);
  s.u32(typename.length || 4);
  s.ascii(typename.length > 0 ? typename : '    ');
  s.u32(props.length);
  for (const [key, writeValue] of props) {
    s.u32(key.length || 4);
    s.ascii(key.length > 0 ? key : '    ');
    writeValue();
  }
}

function writeVlLs(s: ByteSink, items: (() => void)[]): void {
  s.ascii('VlLs');
  s.u32(items.length);
  for (const item of items) item();
}

function writeLong(s: ByteSink, v: number): void {
  s.ascii('long');
  s.u32(v);
}

function writeDouble(s: ByteSink, v: number): void {
  s.ascii('doub');
  s.f64(v);
}

function writeText(s: ByteSink, v: string): void {
  s.ascii('TEXT');
  s.u32(v.length);
  s.utf16(v);
}

function writeEnum(s: ByteSink, type: string, value: string): void {
  s.ascii('enum');
  s.u32(type.length || 4);
  s.ascii(type.length > 0 ? type : '    ');
  s.u32(value.length || 4);
  s.ascii(value.length > 0 ? value : '    ');
}

function writeUntF(s: ByteSink, unit: string, value: number): void {
  s.ascii('UntF');
  s.ascii(unit);
  s.f64(value);
}

function writeBool(s: ByteSink, v: boolean): void {
  s.ascii('bool');
  s.u8(v ? 1 : 0);
}

function writeColorStop(s: ByteSink, stop: FixtureColorStop): void {
  const model = stop.colorModel ?? 'RGBC';
  writeObjc(s, '', 'Cstp', [
    ['Type', () => writeEnum(s, 'Clry', 'usrS')],
    ['Clr ', () => writeColor(s, model, stop)],
    ['Lctn', () => writeLong(s, Math.round(stop.position * 4096))],
    ['Mdpn', () => writeLong(s, Math.round((stop.midpoint ?? 0.5) * 100))],
  ]);
}

function writeColor(
  s: ByteSink,
  model: NonNullable<FixtureColorStop['colorModel']>,
  stop: FixtureColorStop,
): void {
  const raw = stop.raw ?? {};
  switch (model) {
    case 'RGBC':
      writeObjc(s, '', 'RGBC', [
        ['Rd  ', () => writeDouble(s, stop.color[0])],
        ['Grn ', () => writeDouble(s, stop.color[1])],
        ['Bl  ', () => writeDouble(s, stop.color[2])],
      ]);
      break;
    case 'HSBC':
      writeObjc(s, '', 'HSBC', [
        ['H   ', () => writeUntF(s, '#Ang', raw.h ?? 0)],
        ['Strt', () => writeDouble(s, raw.s ?? 0)],
        ['Brgh', () => writeDouble(s, raw.v ?? 0)],
      ]);
      break;
    case 'CMYC':
      writeObjc(s, '', 'CMYC', [
        ['Cyn ', () => writeDouble(s, raw.c ?? 0)],
        ['Mgnt', () => writeDouble(s, raw.m ?? 0)],
        ['Yel ', () => writeDouble(s, raw.y ?? 0)],
        ['Blck', () => writeDouble(s, raw.k ?? 0)],
      ]);
      break;
    case 'Grsc':
      writeObjc(s, '', 'Grsc', [['Gry ', () => writeDouble(s, raw.gray ?? 0)]]);
      break;
  }
}

function writeOpacityStop(s: ByteSink, stop: FixtureOpacityStop): void {
  writeObjc(s, '', 'TrnS', [
    ['Lctn', () => writeLong(s, Math.round(stop.position * 4096))],
    ['Mdpn', () => writeLong(s, Math.round((stop.midpoint ?? 0.5) * 100))],
    ['Opct', () => writeUntF(s, '#Prc', stop.opacity * 100)],
  ]);
}

function gradientPropsOf(g: FixtureGradientSpec, sink: ByteSink): [string, () => void][] {
  const props: [string, () => void][] = [
    ['Nm  ', () => writeText(sink, g.name)],
    [
      'Clrs',
      () =>
        writeVlLs(
          sink,
          g.colorStops.map((stop) => () => writeColorStop(sink, stop)),
        ),
    ],
  ];
  if (g.opacityStops && g.opacityStops.length > 0) {
    const opacityStops = g.opacityStops;
    props.push([
      'Trns',
      () =>
        writeVlLs(
          sink,
          opacityStops.map((stop) => () => writeOpacityStop(sink, stop)),
        ),
    ]);
  }
  if (g.smoothness !== undefined) {
    const smoothness = g.smoothness;
    props.push(['Smoothness', () => writeLong(sink, Math.round(smoothness * 4096))]);
  }
  if (g.isNoise) {
    props.push(['Noise', () => writeBool(sink, true)]);
    props.push(['Mode', () => writeEnum(sink, 'GrMode', 'NseG')]);
  }
  return props;
}

/** Build a modern descriptor-format `.grd` file. */
export function buildModernGrd(gradients: FixtureGradientSpec[]): Uint8Array {
  const dataSink = new ByteSink();
  dataSink.ascii('GrdL');
  writeVlLs(
    dataSink,
    gradients.map((g) => () => {
      const gradSink = new ByteSink();
      writeObjc(gradSink, '', 'Gradient', gradientPropsOf(g, gradSink));
      const itemSink = new ByteSink();
      writeObjc(itemSink, '', 'Grad', [['Grad', () => appendBytes(itemSink, gradSink.bytes)]]);
      appendBytes(dataSink, itemSink.bytes);
    }),
  );

  const header = new ByteSink();
  header.ascii('8BGR');
  header.u32(5);
  header.ascii('8BIM');
  header.ascii('GrdL');
  header.u16(0); // empty pascal string
  header.u16(0); // padding
  header.u32(dataSink.bytes.length);
  header.u32(0); // descriptor version
  header.u32(0); // reserved
  const out = new ByteSink();
  appendBytes(out, header.bytes);
  appendBytes(out, dataSink.bytes);
  return out.bytes;
}

function appendBytes(sink: ByteSink, bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    sink.u8(bytes[i]!);
  }
}

/** Build a legacy fixed-layout `.grd` file (best-effort, version 1 or 2). */
export function buildLegacyGrd(gradients: FixtureGradientSpec[], version: 1 | 2 = 1): Uint8Array {
  const s = new ByteSink();
  s.ascii('Grad');
  s.u16(version);
  s.u16(gradients.length);
  for (const g of gradients) {
    s.u16(g.name.length);
    s.utf16(g.name);
    s.u16(g.colorStops.length);
    for (const stop of g.colorStops) {
      s.u16(0); // reserved
      s.u16(0); // color type RGB
      s.u16(4096); // opacity 0-4096
      s.u32(Math.round(stop.position * 4096));
      s.u16(Math.round((stop.midpoint ?? 0.5) * 100));
      s.u16(Math.round((stop.color[0] / 255) * 65535));
      s.u16(Math.round((stop.color[1] / 255) * 65535));
      s.u16(Math.round((stop.color[2] / 255) * 65535));
      s.u16(0); // color model RGB
    }
    const opacityStops = g.opacityStops ?? [
      { position: 0, opacity: 1 },
      { position: 1, opacity: 1 },
    ];
    s.u16(opacityStops.length);
    for (const stop of opacityStops) {
      s.u16(0); // reserved
      s.u16(0); // transparency type
      s.u16(Math.round(stop.opacity * 4096));
      s.u32(Math.round(stop.position * 4096));
      s.u16(Math.round((stop.midpoint ?? 0.5) * 100));
    }
    const gradientLength = version === 2 ? 4 : 0;
    s.u16(gradientLength);
    s.u8(0); // mode RGB
    s.u32(0); // random seed
    s.u8(1); // show transparency
    for (let i = 0; i < 8; i++) s.f64(0); // vectorColor0 (8 doubles)
    for (let i = 0; i < 8; i++) s.f64(0); // vectorColor1
    if (version === 2) {
      s.u32(Math.round((g.smoothness ?? 0) * 4096)); // smoothness
      s.u16(0); // extra padding (gradientLength > 2)
    }
    s.u8(g.isNoise ? 1 : 0); // noise flag
    if (g.isNoise) {
      for (let i = 0; i < 4; i++) s.u16(0);
      for (let i = 0; i < 4; i++) s.u16(65535);
      for (let i = 0; i < 4; i++) s.f64(0.5);
    }
  }
  return s.bytes;
}

/** The limits used by the parser, re-exported for fixture sanity checks. */
export { GRD_LIMITS };
