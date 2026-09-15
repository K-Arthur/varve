/**
 * Headless Varve tooling (M13, ADR-0039): canonicalization, validation,
 * semantic diff, three-way merge driver, review bundles, and git
 * integration commands.
 *
 * All commands are deterministic and dependency-free at runtime (no
 * network, no browser) and operate on the canonical document JSON format
 * produced by `DocumentCodec.encode`.
 *
 * Git integration (ADR-0040):
 *   diff.varve.textconv  "varve textconv"
 *   merge.varve.driver   "varve merge-driver %O %A %B %P"
 *   .gitattributes       *.varve diff=varve merge=varve
 *
 * The merge driver implements the standard git contract: it writes the
 * merged document into %A (current), writes a conflict manifest sidecar,
 * and exits 0 on clean merges, 1 on conflicted merges (git records the
 * conflict), and 2 on errors.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DocumentDiff, diffDocuments, mergeDocuments } from '@varve/history';
import type { Document } from '@varve/scene';
import { canonicalHash, canonicalizeDocument, DocumentCodec } from '@varve/scene';
import { buildReviewBundle } from './review';

export interface CliError extends Error {
  exitCode: number;
}

function cliError(message: string, exitCode = 2): CliError {
  return Object.assign(new Error(message), { exitCode });
}

export interface LoadedDocument {
  document: Document;
  warnings: string[];
}

export function loadDocumentFile(path: string): LoadedDocument {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    throw cliError(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const decoded = DocumentCodec.decode(source);
  if (!decoded.ok) {
    throw cliError(`invalid document ${path}: ${decoded.error ?? 'decode failed'}`);
  }
  const warnings = (decoded.warnings ?? []).map((w) => w.message);
  return { document: decoded.document, warnings };
}

// ── Commands ─────────────────────────────────────────────────────────────────

export interface ValidateResult {
  file: string;
  hash: string;
  name: string;
  formatVersion: string;
  nodeCount: number;
  warnings: string[];
}

export function runValidate(file: string): ValidateResult {
  const { document, warnings } = loadDocumentFile(file);
  return {
    file,
    hash: canonicalHash(document),
    name: document.name,
    formatVersion: document.formatVersion,
    nodeCount: Object.keys(document.nodes ?? {}).length,
    warnings,
  };
}

export function runCanonicalize(file: string, options: { hash?: boolean } = {}): string {
  const { document } = loadDocumentFile(file);
  if (options.hash) return canonicalHash(document);
  return canonicalizeDocument(document);
}

export function runDiff(
  baseFile: string,
  targetFile: string,
  options: { format: 'text' | 'json' | 'summary' },
): string {
  const base = loadDocumentFile(baseFile);
  const target = loadDocumentFile(targetFile);
  const diff = diffDocuments(base.document, target.document);
  return formatDiff(diff, options.format);
}

export function formatDiff(diff: DocumentDiff, format: 'text' | 'json' | 'summary'): string {
  if (format === 'json') return JSON.stringify(diff, null, 2);
  if (format === 'summary') {
    const s = diff.summary;
    return [
      `${diff.changed ? 'CHANGED' : 'UNCHANGED'}: ${s.total} change(s)`,
      `  added: ${s.added}, removed: ${s.removed}, modified: ${s.modified},`,
      `  renamed: ${s.renamed}, reordered: ${s.reordered}, text: ${s.text}`,
    ].join('\n');
  }
  if (!diff.changed) return 'No changes.';
  return diff.changes
    .map((change) => {
      const path = change.propertyPath ?? change.entityId;
      return `[${change.changeType}] ${change.entityType} ${path}: ${change.summary}`;
    })
    .join('\n');
}

export interface MergeDriverResult {
  status: 'clean' | 'conflicted' | 'error';
  exitCode: number;
  conflictCount: number;
  warnings: string[];
}

/**
 * Git merge driver: merge base/current/incoming, write the merged document
 * into the current path (git contract), and write the conflict manifest.
 */
export function runMergeDriver(
  baseFile: string,
  currentFile: string,
  incomingFile: string,
  options: { manifestPath?: string } = {},
): MergeDriverResult {
  const base = loadDocumentFile(baseFile);
  const current = loadDocumentFile(currentFile);
  const incoming = loadDocumentFile(incomingFile);
  const result = mergeDocuments(base.document, current.document, incoming.document);
  writeFileSync(currentFile, canonicalizeDocument(result.mergedDocument), 'utf8');
  const manifestPath = options.manifestPath ?? `${currentFile}.conflicts.json`;
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schema: 'varve-merge-manifest/1',
        status: result.status,
        baseHash: result.baseHash,
        oursHash: result.oursHash,
        theirsHash: result.theirsHash,
        mergedHash: result.mergedHash,
        conflictCount: result.conflicts.length,
        conflicts: result.conflicts,
        warnings: result.warnings,
      },
      null,
      2,
    ),
    'utf8',
  );
  return {
    status: result.status,
    exitCode: result.status === 'clean' ? 0 : 1,
    conflictCount: result.conflicts.length,
    warnings: result.warnings,
  };
}

export interface ReviewBundleResult {
  outputDir: string;
  files: string[];
  changeCount: number;
}

export function runReview(
  baseFile: string,
  targetFile: string,
  outputDir: string,
): ReviewBundleResult {
  const base = loadDocumentFile(baseFile);
  const target = loadDocumentFile(targetFile);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const { files, changeCount } = buildReviewBundle(base.document, target.document, outputDir);
  return { outputDir, files, changeCount };
}

// ── Git setup ────────────────────────────────────────────────────────────────

export const GIT_ATTRIBUTES_LINE = '*.varve diff=varve merge=varve';

export const GIT_CONFIG_LINES = [
  'diff.varve.textconv varve textconv',
  'merge.varve.driver varve merge-driver %O %A %B %P',
];

export function gitSetupInstructions(): string {
  return [
    '# 1. Add to .gitattributes (repository root):',
    GIT_ATTRIBUTES_LINE,
    '',
    '# 2. Configure git (per-repository):',
    ...GIT_CONFIG_LINES,
    '',
    '# Or run: varve git-setup --apply',
  ].join('\n');
}

// ── Entry point ──────────────────────────────────────────────────────────────

export interface ParsedCommand {
  name: string;
  args: string[];
  options: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedCommand {
  const name = argv[0] ?? 'help';
  const args: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq >= 0) {
        options[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          options[arg.slice(2)] = next;
          i += 1;
        } else {
          options[arg.slice(2)] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short option: `-o <value>` or `-x` (boolean).
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        options[arg.slice(1)] = next;
        i += 1;
      } else {
        options[arg.slice(1)] = true;
      }
    } else {
      args.push(arg);
    }
  }
  return { name, args, options };
}

export function main(argv: string[]): number {
  const { name, args, options } = parseArgs(argv);
  try {
    switch (name) {
      case 'validate': {
        const file = requireArg(args, 0, 'validate <file>');
        const result = runValidate(file);
        for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
        process.stdout.write(
          `OK ${result.file}\n  name: ${result.name}\n  format: ${result.formatVersion}\n  nodes: ${result.nodeCount}\n  hash: ${result.hash}\n`,
        );
        return 0;
      }
      case 'canonicalize': {
        const file = requireArg(args, 0, 'canonicalize <file> [--hash]');
        process.stdout.write(`${runCanonicalize(file, { hash: options.hash === true })}`);
        if (options.hash !== true) process.stdout.write('\n');
        return 0;
      }
      case 'hash': {
        const file = requireArg(args, 0, 'hash <file>');
        process.stdout.write(`${runCanonicalize(file, { hash: true })}\n`);
        return 0;
      }
      case 'diff': {
        const baseFile = requireArg(args, 0, 'diff <base> <target> [--format text|json|summary]');
        const targetFile = requireArg(args, 1, 'diff <base> <target>');
        const format =
          options.format === 'json' || options.format === 'summary' ? options.format : 'text';
        process.stdout.write(`${runDiff(baseFile, targetFile, { format })}\n`);
        return 0;
      }
      case 'textconv': {
        const file = requireArg(args, 0, 'textconv <file>');
        process.stdout.write(`${runCanonicalize(file)}\n`);
        return 0;
      }
      case 'merge-driver': {
        const baseFile = requireArg(
          args,
          0,
          'merge-driver <base> <current> <incoming> [--manifest <path>]',
        );
        const currentFile = requireArg(args, 1, 'merge-driver <base> <current> <incoming>');
        const incomingFile = requireArg(args, 2, 'merge-driver <base> <current> <incoming>');
        const manifestPath = typeof options.manifest === 'string' ? options.manifest : undefined;
        const result = runMergeDriver(baseFile, currentFile, incomingFile, { manifestPath });
        for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
        if (result.status === 'conflicted') {
          process.stderr.write(
            `merge conflicted: ${result.conflictCount} conflict(s); manifest written\n`,
          );
        }
        return result.exitCode;
      }
      case 'review': {
        const baseFile = requireArg(args, 0, 'review <base> <target> -o <dir>');
        const targetFile = requireArg(args, 1, 'review <base> <target>');
        const outputDir =
          typeof options.o === 'string'
            ? options.o
            : typeof options.output === 'string'
              ? options.output
              : requireArg(args, 2, 'review <base> <target> -o <dir>');
        const result = runReview(baseFile, targetFile, outputDir);
        process.stdout.write(
          `Review bundle written to ${join(result.outputDir, 'index.html')} (${result.changeCount} change(s))\n`,
        );
        return 0;
      }
      case 'git-setup': {
        if (options.apply === true) {
          return applyGitSetup();
        }
        process.stdout.write(`${gitSetupInstructions()}\n`);
        return 0;
      }
      case 'help':
      case '--help':
      case '-h': {
        process.stdout.write(HELP_TEXT);
        return 0;
      }
      case 'version':
      case '--version': {
        process.stdout.write('varve cli 0.0.0\n');
        return 0;
      }
      default: {
        process.stderr.write(`unknown command: ${name}\n`);
        process.stderr.write(HELP_TEXT);
        return 2;
      }
    }
  } catch (err) {
    if (err instanceof Error && 'exitCode' in err) {
      process.stderr.write(`varve ${name}: ${err.message}\n`);
      return (err as CliError).exitCode;
    }
    process.stderr.write(`varve ${name}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

function requireArg(args: string[], index: number, usage: string): string {
  const value = args[index];
  if (value === undefined) throw cliError(`missing argument — usage: varve ${usage}`, 2);
  return value;
}

function applyGitSetup(): number {
  if (existsSync('.gitattributes')) {
    const existing = readFileSync('.gitattributes', 'utf8');
    if (!existing.includes('*.varve')) {
      writeFileSync('.gitattributes', `${existing.trimEnd()}\n${GIT_ATTRIBUTES_LINE}\n`, 'utf8');
    }
  } else {
    writeFileSync('.gitattributes', `${GIT_ATTRIBUTES_LINE}\n`, 'utf8');
  }
  for (const line of GIT_CONFIG_LINES) {
    execSync(`git config ${line}`, { stdio: 'ignore' });
  }
  process.stdout.write('Git integration configured (.gitattributes + diff.varve + merge.varve).\n');
  return 0;
}

export const HELP_TEXT = `varve — headless Varve tooling

usage:
  varve validate <file>                      decode and validate a document
  varve canonicalize <file> [--hash]         print canonical JSON (or its SHA-256)
  varve hash <file>                          print the canonical SHA-256
  varve diff <base> <target> [--format text|json|summary]
                                             semantic diff between two documents
  varve textconv <file>                      git textconv conversion (canonical JSON)
  varve merge-driver <base> <current> <incoming> [--manifest <path>]
                                             git merge driver (writes <current>)
  varve review <base> <target> -o <dir>      generate a review bundle
  varve git-setup [--apply]                  print (or apply) git integration config
  varve help                                 show this help

exit codes: 0 clean, 1 conflicted merge, 2 error
`;

// Run only when executed directly (not when imported by tests or other
// tooling). `process.argv[1]` is the executed script; the bundled CLI and
// the source entry both compare equal to `import.meta.url` here.
function isDirectRun(): boolean {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exit(main(process.argv.slice(2)));
}
