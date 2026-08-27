import type { ImportParser } from './types';

/**
 * Raster formats that are not backed by a dedicated parser but are decoded
 * through the content-sniffed raster fallback in `ImportService` /
 * `importImageAsFill`. Kept here as the single source of truth so the file
 * picker `accept` string and the service's fallback detection cannot drift.
 */
export const RASTER_IMPORT_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'avif',
] as const;

/**
 * Colour-lookup-table formats. These are not handled by `ImportService`
 * (which produces scene nodes); in the editor shell they are routed to the
 * LUT adjustment handler. The picker advertises them so users can select
 * them, but they are deliberately excluded from `listSupportedExtensions`.
 */
export const LUT_IMPORT_EXTENSIONS = ['cube', '3dl', 'clf', 'ctf'] as const;

const parsers = new Map<string, ImportParser>();

/**
 * Every extension that the import pipeline can turn into scene content:
 * registered parser extensions plus the content-sniffed raster fallback
 * extensions. Use this to build picker `accept` strings so the UI never
 * advertises a format the pipeline cannot actually import.
 */
export function listSupportedExtensions(): string[] {
  const set = new Set<string>(RASTER_IMPORT_EXTENSIONS);
  for (const [, parser] of parsers) {
    for (const ext of parser.supportedExtensions()) {
      set.add(ext.toLowerCase().replace(/^\./, ''));
    }
  }
  return [...set];
}

/**
 * Extensions whose bare form must not appear in the picker, mapped to what
 * the picker should advertise instead.
 *
 * The Figma parser claims `json` so that content lookup works, but File >
 * Open is the `.json` command: advertising bare `.json` under Import puts
 * Varve's own documents in the artwork picker, where they parse as a failed
 * Figma decode. Browsers match `accept` by filename suffix, so `.fig.json`
 * still offers real Figma exports without claiming every JSON file.
 */
const PICKER_EXTENSION_OVERRIDES: Record<string, string> = { json: 'fig.json' };

/**
 * The complete `accept` string for the import picker, including LUT formats
 * that the shell routes to a dedicated handler.
 */
export function getImportAcceptString(): string {
  const exts = [...listSupportedExtensions(), ...LUT_IMPORT_EXTENSIONS];
  return exts.map((e) => `.${PICKER_EXTENSION_OVERRIDES[e] ?? e}`).join(',');
}

export function registerParser(parser: ImportParser): void {
  parsers.set(parser.format, parser);
  buildExtensionIndex();
}

export function getParser(format: string): ImportParser | undefined {
  return parsers.get(format);
}

const extToFormat = new Map<string, string>();

function buildExtensionIndex(): void {
  extToFormat.clear();
  for (const [, parser] of parsers) {
    for (const ext of parser.supportedExtensions()) {
      extToFormat.set(ext.toLowerCase(), parser.format);
    }
  }
}

export function getParserForExtension(ext: string): ImportParser | undefined {
  const format = extToFormat.get(ext.toLowerCase().replace(/^\./, ''));
  return format ? parsers.get(format) : undefined;
}

export function getParserForData(data: string | Uint8Array): ImportParser | undefined {
  for (const [, parser] of parsers) {
    try {
      if (parser.canParse(data)) return parser;
    } catch {}
  }
  return undefined;
}

export function listSupportedFormats(): string[] {
  return [...parsers.keys()];
}

export function resetRegistry(): void {
  parsers.clear();
  extToFormat.clear();
}
