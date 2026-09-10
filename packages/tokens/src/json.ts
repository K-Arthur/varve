/**
 * Source-aware JSON parser (2025.10 pipeline stage 2).
 *
 * Produces the parsed value plus two location maps keyed by JSON pointer:
 * - keyLocations: span of each key + its value (for diagnostics and value
 *   replacement),
 * - objectSpans: brace span of every object/array value (for insertion).
 *
 * Security: parsed objects are null-prototype (no __proto__ pollution),
 * depth/bytes/string-size bounded, numbers that overflow to Infinity are
 * rejected, duplicate keys are reported with the later location.
 */

export interface JsonSyntaxDiagnostic {
  code: string;
  message: string;
  line: number;
  column: number;
  offset: number;
}

export interface KeyLocation {
  /** Offset of the key's opening quote (objects) or item start (arrays). */
  keyStart: number;
  /** Offset after the key's closing quote. */
  keyEnd: number;
  /** Offset of the first character of the value. */
  valueStart: number;
  /** Offset after the last character of the value. */
  valueEnd: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /** Offset of the containing object's opening brace. */
  objectOpen: number;
  /** Offset of the containing object's closing brace (backfilled). */
  objectClose: number;
}

export interface ObjectSpan {
  open: number;
  close: number;
  /** 1-based line of the opening brace. */
  line: number;
}

export interface JsonSourceResult {
  value: unknown;
  /** Pointer ('' = document root) → key/value span. */
  keyLocations: Map<string, KeyLocation>;
  /** Pointer → brace span, present for object/array values. */
  objectSpans: Map<string, ObjectSpan>;
  diagnostics: JsonSyntaxDiagnostic[];
}

export const JSON_MAX_BYTES = 16 * 1024 * 1024;
export const JSON_MAX_DEPTH = 256;
export const JSON_MAX_STRING = 1024 * 1024;

export class JsonSyntaxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly line: number,
    readonly column: number,
    readonly offset: number,
  ) {
    super(message);
    this.name = 'JsonSyntaxError';
  }
}

class JsonParser {
  private pos = 0;
  private line = 1;
  private column = 1;
  readonly diagnostics: JsonSyntaxDiagnostic[] = [];
  readonly keyLocations = new Map<string, KeyLocation>();
  readonly objectSpans = new Map<string, ObjectSpan>();

  constructor(
    private readonly text: string,
    private readonly maxDepth: number,
  ) {}

  private error(code: string, message: string): never {
    throw new JsonSyntaxError(code, message, this.line, this.column, this.pos);
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private advance(): void {
    const ch = this.text[this.pos];
    this.pos += 1;
    if (ch === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  parseRoot(): unknown {
    // Strip a leading UTF-8 BOM (it is preserved by the patcher because
    // splices only touch offsets inside the document).
    if (this.text.charCodeAt(0) === 0xfeff) {
      this.pos = 1;
      this.column = 2;
    }
    this.skipWhitespace();
    const value = this.parseValue(0, '');
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      this.error('trailing-content', 'Unexpected content after the JSON document');
    }
    return value;
  }

  private parseValue(depth: number, pointer: string): unknown {
    if (depth > this.maxDepth) {
      this.error('max-depth', `Maximum nesting depth (${this.maxDepth}) exceeded`);
    }
    const ch = this.peek();
    if (ch === '{') return this.parseObject(depth, pointer);
    if (ch === '[') return this.parseArray(depth, pointer);
    if (ch === '"') return this.parseString();
    if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) return this.parseNumber();
    if (this.text.startsWith('true', this.pos)) {
      this.consumeLiteral('true');
      return true;
    }
    if (this.text.startsWith('false', this.pos)) {
      this.consumeLiteral('false');
      return false;
    }
    if (this.text.startsWith('null', this.pos)) {
      this.consumeLiteral('null');
      return null;
    }
    this.error('unexpected-token', `Unexpected token '${ch ?? 'end of input'}'`);
  }

  private consumeLiteral(literal: string): void {
    for (let i = 0; i < literal.length; i += 1) {
      if (this.text[this.pos + i] !== literal[i]) {
        this.error('invalid-literal', `Invalid literal, expected '${literal}'`);
      }
    }
    for (let i = 0; i < literal.length; i += 1) this.advance();
  }

  private recordValueSpan(pointer: string, start: number, end: number): void {
    const loc = this.keyLocations.get(pointer);
    if (loc) {
      loc.valueStart = start;
      loc.valueEnd = end;
      loc.endLine = this.line;
      loc.endColumn = this.column;
    }
  }

  private parseObject(depth: number, pointer: string): Record<string, unknown> {
    const open = this.pos;
    this.advance(); // '{'
    const result: Record<string, unknown> = Object.create(null);
    if (!this.keyLocations.has(pointer)) {
      this.keyLocations.set(pointer, {
        keyStart: open,
        keyEnd: open,
        valueStart: open,
        valueEnd: -1,
        line: this.line,
        column: this.column,
        endLine: this.line,
        endColumn: this.column,
        objectOpen: open,
        objectClose: -1,
      });
    }
    this.objectSpans.set(pointer, { open, close: -1, line: this.line });
    const seenKeys = new Set<string>();
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.advance();
      this.objectSpans.set(pointer, { open, close: this.pos, line: this.line });
      this.recordValueSpan(pointer, open, this.pos);
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') {
        this.error('expected-key', 'Expected a string key');
      }
      const keyLine = this.line;
      const keyColumn = this.column;
      const keyStart = this.pos;
      const key = this.parseString();
      const keyEnd = this.pos;
      this.skipWhitespace();
      if (this.peek() !== ':') {
        this.error('expected-colon', `Expected ':' after key "${key}"`);
      }
      this.advance();
      this.skipWhitespace();
      const valueStart = this.pos;
      const childPointer =
        pointer === ''
          ? `/${escapePointerSegment(key)}`
          : `${pointer}/${escapePointerSegment(key)}`;
      const childLocation: KeyLocation = {
        keyStart,
        keyEnd,
        valueStart,
        valueEnd: -1,
        line: keyLine,
        column: keyColumn,
        endLine: keyLine,
        endColumn: keyColumn,
        objectOpen: open,
        objectClose: -1,
      };
      this.keyLocations.set(childPointer, childLocation);
      const value = this.parseValue(depth + 1, childPointer);
      childLocation.valueEnd = this.pos;
      childLocation.endLine = this.line;
      childLocation.endColumn = this.column;
      if (seenKeys.has(key)) {
        this.diagnostics.push({
          code: 'duplicate-key',
          message: `Duplicate key "${key}"`,
          line: keyLine,
          column: keyColumn,
          offset: keyStart,
        });
      }
      seenKeys.add(key);
      result[key] = value;
      this.skipWhitespace();
      const next = this.peek();
      if (next === ',') {
        this.advance();
        continue;
      }
      if (next === '}') {
        break;
      }
      this.error('expected-comma', "Expected ',' or '}' in object");
    }
    const close = this.pos;
    this.advance(); // '}'
    this.objectSpans.set(pointer, { open, close, line: this.line });
    for (const loc of this.keyLocations.values()) {
      if (loc.objectOpen === open) loc.objectClose = close;
    }
    this.recordValueSpan(pointer, open, close);
    return result;
  }

  private parseArray(depth: number, pointer: string): unknown[] {
    const open = this.pos;
    this.advance(); // '['
    const result: unknown[] = [];
    this.objectSpans.set(pointer, { open, close: -1, line: this.line });
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.advance();
      this.objectSpans.set(pointer, { open, close: this.pos, line: this.line });
      this.recordValueSpan(pointer, open, this.pos);
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      const itemStart = this.pos;
      const childPointer = `${pointer}/${result.length}`;
      const itemLocation: KeyLocation = {
        keyStart: itemStart,
        keyEnd: itemStart,
        valueStart: itemStart,
        valueEnd: -1,
        line: this.line,
        column: this.column,
        endLine: this.line,
        endColumn: this.column,
        objectOpen: open,
        objectClose: -1,
      };
      this.keyLocations.set(childPointer, itemLocation);
      const value = this.parseValue(depth + 1, childPointer);
      itemLocation.valueEnd = this.pos;
      itemLocation.endLine = this.line;
      itemLocation.endColumn = this.column;
      result.push(value);
      this.skipWhitespace();
      const next = this.peek();
      if (next === ',') {
        this.advance();
        continue;
      }
      if (next === ']') {
        break;
      }
      this.error('expected-comma', "Expected ',' or ']' in array");
    }
    const close = this.pos;
    this.advance(); // ']'
    this.objectSpans.set(pointer, { open, close, line: this.line });
    for (const loc of this.keyLocations.values()) {
      if (loc.objectOpen === open) loc.objectClose = close;
    }
    this.recordValueSpan(pointer, open, close);
    return result;
  }

  private parseString(): string {
    if (this.peek() !== '"') this.error('expected-string', 'Expected a string');
    this.advance();
    let out = '';
    let segmentStart = this.pos;
    for (;;) {
      const ch = this.peek();
      if (ch === undefined) this.error('unterminated-string', 'Unterminated string');
      if (ch === '"') {
        out += this.text.slice(segmentStart, this.pos);
        this.advance();
        break;
      }
      if (ch === '\\') {
        out += this.text.slice(segmentStart, this.pos);
        this.advance();
        const esc = this.peek();
        if (esc === undefined) this.error('unterminated-string', 'Unterminated escape sequence');
        switch (esc) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const hex = this.text.slice(this.pos + 1, this.pos + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error('invalid-escape', 'Invalid \\u escape');
            out += String.fromCharCode(parseInt(hex, 16));
            for (let i = 0; i < 4; i += 1) this.advance();
            break;
          }
          default:
            this.error('invalid-escape', `Invalid escape '\\${esc}'`);
        }
        this.advance();
        segmentStart = this.pos;
        continue;
      }
      if (out.length + (this.pos - segmentStart) > JSON_MAX_STRING) {
        this.error('string-too-long', `String exceeds ${JSON_MAX_STRING} characters`);
      }
      this.advance();
    }
    return out;
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.peek() === '-') this.advance();
    if (this.peek() === '0') {
      this.advance();
    } else if (this.peek() !== undefined && this.peek()! >= '1' && this.peek()! <= '9') {
      this.advance();
      while (this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9')
        this.advance();
    } else {
      this.error('invalid-number', 'Invalid number literal');
    }
    if (this.peek() === '.') {
      this.advance();
      if (this.peek() === undefined || this.peek()! < '0' || this.peek()! > '9') {
        this.error('invalid-number', 'Invalid fractional part');
      }
      while (this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9')
        this.advance();
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') this.advance();
      if (this.peek() === undefined || this.peek()! < '0' || this.peek()! > '9') {
        this.error('invalid-number', 'Invalid exponent');
      }
      while (this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9')
        this.advance();
    }
    const raw = this.text.slice(start, this.pos);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.error('number-overflow', `Number literal overflows to ${value}`);
    }
    return value;
  }
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export interface ParseJsonSourceOptions {
  maxBytes?: number;
  maxDepth?: number;
}

/**
 * Parse JSON text into a value plus pointer→location maps.
 * Throws JsonSyntaxError on malformed JSON; duplicate keys are reported as
 * syntax diagnostics (non-fatal).
 */
export function parseJsonSource(
  text: string,
  options: ParseJsonSourceOptions = {},
): JsonSourceResult {
  const maxBytes = options.maxBytes ?? JSON_MAX_BYTES;
  if (text.length > maxBytes) {
    throw new JsonSyntaxError('max-bytes', `JSON document exceeds ${maxBytes} bytes`, 1, 1, 0);
  }
  const parser = new JsonParser(text, options.maxDepth ?? JSON_MAX_DEPTH);
  const value = parser.parseRoot();
  return {
    value,
    keyLocations: parser.keyLocations,
    objectSpans: parser.objectSpans,
    diagnostics: parser.diagnostics.slice(),
  };
}

/** Convenience: line/column for a byte offset. */
export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
