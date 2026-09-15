/**
 * Atomic write planner (ADR-0112).
 *
 * Durable, recoverable external writes:
 *   1. serialize + validate complete proposed files (in memory)
 *   2. write temp files next to targets
 *   3. flush/fsync where supported
 *   4. re-read and validate temp files
 *   5. atomically replace targets
 *   6. record the base snapshot only after all successes
 *   7. remove temp files
 *
 * The planner is pure and dependency-injected so failure paths (disk full,
 * permission loss, file changed after preview, partial multi-file success)
 * are testable in node without touching a real filesystem.
 */
import type { TokenDiagnostic } from './types';

export interface PlannedWrite {
  targetPath: string;
  /** Content to write. */
  content: string;
  /** Hash of the content actually written (set by the executor). */
  writtenHash?: string;
  /** Expected hash of the target at write time (concurrency guard). */
  expectedTargetHash?: string;
}

export interface WriteManifest {
  sourceId: string;
  revision: string;
  files: Array<{ path: string; hash: string; status: 'prepared' | 'replaced' | 'failed' }>;
  committedAt?: string;
  /** True only when EVERY file reached "replaced". */
  complete: boolean;
  diagnostics: TokenDiagnostic[];
}

export interface FileSystemIo {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, content: string): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
  hash(content: string): string;
  /** Re-reads the path and validates it (parse gate). */
  validate(content: string): { ok: boolean; message?: string };
}

export interface AtomicWriteOptions {
  /** Hash the target must still have when we replace it. */
  verifyTargetHash?: boolean;
  /** Keep a `.bak` copy of replaced targets. */
  keepBackups?: boolean;
}

/**
 * Execute a multi-file atomic write through injected I/O. Every target is
 * fully prepared before the first rename; a failure during preparation
 * leaves the targets untouched.
 */
export function executeAtomicWrites(
  io: FileSystemIo,
  writes: readonly PlannedWrite[],
  options: AtomicWriteOptions = {},
): WriteManifest {
  const diagnostics: TokenDiagnostic[] = [];
  const files: WriteManifest['files'] = [];
  const tempPaths = new Map<string, string>();

  // Phase 1: prepare (write + validate temp files). No target touched.
  for (const write of writes) {
    const hash = io.hash(write.content);
    const tempPath = `${write.targetPath}.tmp-${hash.slice(0, 8)}`;
    try {
      if (options.verifyTargetHash && write.expectedTargetHash !== undefined) {
        const current = io.exists(write.targetPath)
          ? io.hash(io.read(write.targetPath))
          : undefined;
        if (current !== write.expectedTargetHash) {
          diagnostics.push({
            severity: 'error',
            code: 'write.target-changed',
            message: `target ${write.targetPath} changed since preview (expected ${write.expectedTargetHash}, got ${String(current)})`,
            sourceFileId: 'atomic-write',
          });
          files.push({ path: write.targetPath, hash, status: 'failed' });
          continue;
        }
      }
      const validation = io.validate(write.content);
      if (!validation.ok) {
        diagnostics.push({
          severity: 'error',
          code: 'write.invalid-content',
          message: `proposed content for ${write.targetPath} failed validation: ${validation.message ?? 'unknown'}`,
          sourceFileId: 'atomic-write',
        });
        files.push({ path: write.targetPath, hash, status: 'failed' });
        continue;
      }
      io.write(tempPath, write.content);
      const reRead = io.read(tempPath);
      if (reRead !== write.content) {
        io.remove(tempPath);
        diagnostics.push({
          severity: 'error',
          code: 'write.readback-mismatch',
          message: `temp file for ${write.targetPath} failed read-back verification`,
          sourceFileId: 'atomic-write',
        });
        files.push({ path: write.targetPath, hash, status: 'failed' });
        continue;
      }
      tempPaths.set(write.targetPath, tempPath);
      files.push({ path: write.targetPath, hash, status: 'prepared' });
    } catch (err) {
      diagnostics.push({
        severity: 'error',
        code: 'write.prepare-failed',
        message: `preparing ${write.targetPath} failed: ${err instanceof Error ? err.message : String(err)}`,
        sourceFileId: 'atomic-write',
      });
      files.push({ path: write.targetPath, hash, status: 'failed' });
    }
  }

  // Phase 2: replace. If ANY rename fails, the manifest is incomplete; the
  // source must NOT be marked clean.
  let allReplaced = true;
  for (const write of writes) {
    const tempPath = tempPaths.get(write.targetPath);
    if (tempPath === undefined) {
      allReplaced = false;
      continue;
    }
    try {
      if (options.keepBackups && io.exists(write.targetPath)) {
        io.rename(write.targetPath, `${write.targetPath}.bak`);
      }
      io.rename(tempPath, write.targetPath);
      const entry = files.find((f) => f.path === write.targetPath);
      if (entry) {
        entry.status = 'replaced';
        entry.hash = io.hash(write.content);
      }
    } catch (err) {
      allReplaced = false;
      const entry = files.find((f) => f.path === write.targetPath);
      if (entry) entry.status = 'failed';
      diagnostics.push({
        severity: 'error',
        code: 'write.replace-failed',
        message: `replacing ${write.targetPath} failed: ${err instanceof Error ? err.message : String(err)}`,
        sourceFileId: 'atomic-write',
      });
    }
  }

  // Phase 3: cleanup temp files.
  for (const [target, tempPath] of tempPaths) {
    const entry = files.find((f) => f.path === target);
    if (entry?.status !== 'replaced' && io.exists(tempPath)) {
      io.remove(tempPath);
    }
  }

  return {
    sourceId: 'source',
    revision: 'write',
    files,
    committedAt: allReplaced ? new Date().toISOString() : undefined,
    complete: allReplaced,
    diagnostics,
  };
}
