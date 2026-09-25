import type { PluginCommandManifest } from './package';

export interface SelectedNodeSnapshot {
  id: string;
  name: string;
  kind: string;
  locked: boolean;
  style: {
    opacity: number;
    blendMode: string;
    paintCount: number;
    strokeCount: number;
    fontFamily?: string;
    fontSize?: number;
  };
}

export interface GuestInput {
  apiVersion: 1;
  commandId: string;
  documentId: string;
  revision: number;
  selection: SelectedNodeSnapshot[];
}

export interface RenameProposal {
  id: string;
  expectedName: string;
  name: string;
}

export interface GuestOutput {
  summary: string;
  lines: string[];
  renames: RenameProposal[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    [...value].every((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 || code === 9 || code === 10;
    })
  );
}

/** A guest result is a proposal, never an instruction executed directly. */
export function parseGuestOutput(
  raw: string,
  command: PluginCommandManifest,
  selection: readonly SelectedNodeSnapshot[],
): GuestOutput {
  if (new TextEncoder().encode(raw).byteLength > 64 * 1024) {
    throw new Error('Plugin result exceeds 64 KiB');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Plugin returned invalid JSON');
  }
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['summary', 'lines', 'renames'].includes(key))
  ) {
    throw new Error('Plugin returned an unsupported result field');
  }
  if (!isBoundedText(value.summary, 300)) throw new Error('Plugin summary is invalid');
  if (
    !Array.isArray(value.lines) ||
    value.lines.length > 20 ||
    value.lines.some((line) => !isBoundedText(line, 300)) ||
    new Set(value.lines).size !== value.lines.length
  ) {
    throw new Error('Plugin analysis lines are invalid');
  }
  const rawRenames = value.renames ?? [];
  if (!Array.isArray(rawRenames) || rawRenames.length > 100) {
    throw new Error('Plugin rename proposal is too large');
  }
  if (command.kind === 'analysis' && rawRenames.length > 0) {
    throw new Error('Read-only command proposed a document edit');
  }
  const selected = new Map(selection.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const renames: RenameProposal[] = [];
  for (const item of rawRenames) {
    if (
      !isRecord(item) ||
      Object.keys(item).some((key) => !['id', 'expectedName', 'name'].includes(key))
    ) {
      throw new Error('Plugin rename proposal has invalid fields');
    }
    if (
      !isBoundedText(item.id, 128) ||
      !isBoundedText(item.expectedName, 256) ||
      !isBoundedText(item.name, 256) ||
      item.name.trim().length === 0 ||
      seen.has(item.id)
    ) {
      throw new Error('Plugin rename proposal is invalid');
    }
    const target = selected.get(item.id);
    if (!target || target.locked || target.name !== item.expectedName) {
      throw new Error('Plugin proposed an inaccessible or stale node');
    }
    seen.add(item.id);
    renames.push({ id: item.id, expectedName: item.expectedName, name: item.name });
  }
  return { summary: value.summary, lines: value.lines as string[], renames };
}
