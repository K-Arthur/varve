# Drag & Drop, Import, File Types, Auto-Save & Recovery System Plan

## Research Findings

### Industry Comparison

| Tool | D&D Import | File Formats | Auto-Save | Recovery | Versioning |
|---|---|---|---|---|---|
| **Figma** | Drag to file browser or canvas; SVG, PNG, JPG, GIF, .fig, .sketch | SVG, PNG, JPG, GIF, PDF (export), .fig (binary kiwi format) | Delta-based saves to IndexedDB; per-node change tracking; stale change detection | Offline changes persisted to disk; restored on reload; user prompted in file browser | Flat node array + fractional indexing; schema embedded in binary format |
| **Affinity** | Open dialog; PSD, AI, PDF, SVG, EPS, DWG, IDML import | Native .afdesign/.afphoto; backward incompatible between major versions | Periodic snapshots | No robust crash recovery (user complaint: "finished work gone") | V1/V2/V3 files not cross-compatible; major pain point |
| **Sketch** | Drag to canvas or file browser; SVG, PNG, JPG, PDF | .sketch (ZIP-based); SVG, PNG, JPG, PDF import | Auto-save via macOS autosave | Versions via macOS versioning | Backward compatible within minor versions |
| **Canva** | Drag-drop onto canvas; images, PDFs, Word docs | PNG, JPG, SVG, PDF, MP4, GIF | Cloud-based continuous save | Cloud recovery; no local recovery | Server-side versioning |
| **Penpot** | Import .penpot files, SVG, images | .penpot (open format), SVG, PNG, JPG | Cloud-based | Cloud recovery | Open format, schema versioned |

### Key Architectural Insights (Figma Autosave Blog)

1. **Delta-based saves** are preferred over full-document serialization for large files
2. **IndexedDB** used for browser-side persistence (transactional, indexed, large capacity)
3. **Per-node change tracking** balances storage overhead vs IO frequency
4. **Stale change detection** is critical — changes must be cleared after server ack
5. **Conservative re-serialization** after reconnect is safer than incremental cleanup
6. **Atomic writes** (write-tmp + fsync + rename) prevent corruption on power loss
7. **Recovery prompts** should be transparent and user-initiated, not automatic

### Common User Pain Points

- Data loss after crash (Affinity: "finished work is gone")
- No backward compatibility between versions (Affinity V2/V3)
- Confusing recovery prompts that appear for already-saved changes
- Poor import fidelity for complex formats (gradients, effects, fonts)
- No feedback during large file imports
- Drag-drop failures with no error explanation

## Current System Assessment

### Bugs (Critical)

1. **Recovery uses `MemoryRecoveryStorage` everywhere in Shell.tsx** — recovery data is lost on page reload, making the entire recovery system non-functional for real crash scenarios
2. **Auto-save and recovery are disconnected** — auto-save saves to platform file system but doesn't create recovery points
3. **RecoveryManager instantiated separately in every handler** — no shared singleton, so different handlers see different storage

### Weaknesses

1. **Auto-save**: No incremental/delta saves, no save state callbacks for UI, no disk space detection
2. **Recovery**: No crash-during-save handling, no partial recovery, no session count limits, no verification
3. **Versioning**: Single-step migration only (0.9 to 1.0), no forward compatibility detection, no multi-step chain
4. **D&D**: No drop feedback UI, no batch progress, no error reporting, no file type filtering for unsupported formats
5. **Import**: No batch import integration with editor, no import report UI, limited bitmap format support (no TIFF/AVIF/GIF dimensions)
6. **File types**: No TIFF, AVIF dimension detection; GIF dimensions not parsed

### Technical Debt

- `collectFilesFromDataTransfer` reads all files into memory at once (no size limits)
- No file size validation before import
- No import cancellation
- PSD parser creates placeholder layers, not real layer extraction
- PDF parser uses regex on raw PDF stream (not proper PDF parsing)

## Proposed Architecture

### Drag & Drop System

```
DataTransfer
  → collectFilesFromDataTransfer (existing, enhanced)
    → validateFiles (size, type, count limits)
    → batchImport (existing, enhanced with progress)
      → ImportReport (new: per-file success/failure/warnings)
    → DropFeedbackOverlay (new: visual drop indicator)
```

**Improvements:**
- File size limits (warn > 50MB, reject > 200MB)
- File count limits (warn > 100, batch process)
- Unsupported format detection with user feedback
- Drop overlay with visual feedback (copy/link/reject cursor states)
- Batch progress indicator for large imports
- Import report dialog showing per-file results

### Import Pipeline

```
File → Registry → Parser → ImportResult → ImportReport
                                         → Validation (pre-import)
                                         → Error isolation (per-file)
```

**Improvements:**
- Pre-import validation via `validateImport()` (already exists, wire it up)
- Per-file error isolation (already in `batchImport`, enhance)
- Import report with warnings, unsupported features, node counts
- TIFF/AVIF/GIF bitmap dimension detection
- File type detection by magic bytes (not just extension)

### Auto-Save Architecture

```
Edit → notifyEdit() → AutoSaveService
  → check() on interval
    → if dirty + idle + past interval → saveNow()
      → saveFn (platform save)
      → recoveryRef.createRecoveryPoint() (NEW: coordinated)
  → onSaveStateChange callback (NEW: for UI feedback)
```

**Improvements:**
- Recovery point creation coordinated with auto-save
- Save state callbacks for UI indicator (saving/saved/error)
- Disk space/permission error detection
- Max recovery sessions limit (prevent unbounded storage)
- Save debounce (don't save more than once per interval even if forced)

### Recovery Architecture

```
Startup → RecoveryManager (IndexedDbRecoveryStorage singleton)
  → listSessions()
  → if sessions exist → RecoveryDialog
    → restore → migrateDocument → loadDocument
    → discard → deleteSession
  → cleanup(maxAgeMs, maxSessions)
```

**Improvements:**
- Use `IndexedDbRecoveryStorage` as default (not Memory)
- Shared singleton across all handlers
- Max sessions limit (default 20)
- Recovery verification (validate document after restore)
- Crash-during-save: atomic write pattern (write new, delete old)
- Session metadata: document size, node count for display

### Versioning Strategy

```
File → parse → detect formatVersion
  → if older → migrate chain (0.9 → 1.0 → 1.1 → ...)
  → if current → load directly
  → if newer → warn user, attempt best-effort load
```

**Improvements:**
- Multi-step migration chain (apply sequentially)
- Forward compatibility detection (warn if file version > current)
- Version validation (reject invalid version strings)
- Feature downgrade warnings (file uses features not in current version)

## Implementation Roadmap

| Priority | Task | Risk | Dependencies |
|---|---|---|---|
| P0 | Fix recovery storage (Memory → IndexedDB singleton) | Low | None |
| P0 | Connect auto-save to recovery | Low | Recovery fix |
| P0 | Multi-step version migration + forward compat | Medium | None |
| P1 | Auto-save enhancements (callbacks, disk errors) | Low | None |
| P1 | Recovery enhancements (max sessions, verification) | Low | Recovery fix |
| P1 | Bitmap: TIFF/AVIF/GIF dimensions | Low | None |
| P2 | D&D: drop feedback, file validation | Medium | None |
| P2 | Import: batch integration, import report | Medium | None |

## TDD Strategy

### Test Coverage Plan

**Auto-Save:**
- Recovery point creation on save
- Save state callback notifications
- Disk error handling (quota, permission)
- Save debounce
- Large document save timing

**Recovery:**
- IndexedDB storage (shared singleton)
- Max sessions enforcement
- Recovery verification (corrupt document detection)
- Crash-during-save (partial write)
- Multiple recovery sessions
- Session metadata (size, node count)

**Versioning:**
- Multi-step migration chain (0.8 → 0.9 → 1.0)
- Forward compatibility warning
- Invalid version rejection
- Feature downgrade detection
- Round-trip migration preservation

**Drag & Drop:**
- File size validation
- File count limits
- Unsupported format feedback
- Batch import progress
- Mixed file type handling

**Import:**
- Corrupt file handling (per format)
- TIFF/AVIF/GIF dimension detection
- Batch import with failures
- Import report generation
