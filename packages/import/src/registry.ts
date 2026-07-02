import type { ImportParser } from './types';

const parsers = new Map<string, ImportParser>();

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
