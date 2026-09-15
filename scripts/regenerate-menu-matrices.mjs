#!/usr/bin/env node
/**
 * Regenerate docs/menu-capability-matrix.md and docs/menu-workspace-matrix.md
 * from the menu registry.
 *
 * Source of truth: `packages/editor/src/menu/defs.ts` (item ids, kinds,
 * capability gates, workspace filters) + `packages/editor/src/menu/
 * localization.ts` (display labels). The two matrices are generated output —
 * never hand-edit the item tables, and regenerate whenever defs.ts changes.
 *
 *   node scripts/regenerate-menu-matrices.mjs          # write both files
 *   node scripts/regenerate-menu-matrices.mjs --check  # exit 1 if stale
 *
 * The curated prose (legends, per-menu summaries, edge cases) lives in the
 * templates below; the item tables are parsed from defs.ts. The parser is a
 * deliberate lightweight text scanner (brace/string-aware, no TS toolchain):
 * item objects in defs.ts are regular object literals, which keeps this
 * dependency-free and runnable from `pnpm test:ci:tools`.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFS = join(ROOT, 'packages/editor/src/menu/defs.ts');
const LOCALIZATION = join(ROOT, 'packages/editor/src/menu/localization.ts');
const CAP_MATRIX = join(ROOT, 'docs/menu-capability-matrix.md');
const WORKSPACE_MATRIX = join(ROOT, 'docs/menu-workspace-matrix.md');

const MENUS = ['file', 'edit', 'text', 'view', 'object', 'arrange', 'page', 'help'];
const MENU_TITLES = {
  file: 'File',
  edit: 'Edit',
  text: 'Text',
  view: 'View',
  object: 'Object',
  arrange: 'Arrange',
  page: 'Page',
  help: 'Help',
};
const MODES = ['design', 'print', 'drawing', 'image', 'motion', 'logo', 'codegen'];

// Capability -> [web, tauri, mem] visibility, mirroring the legend in the
// capability matrix and capabilities.ts. Capabilities "never in browser"
// (archive, nativeMenu, multiWindow) are hidden on web; everything else is
// feature-detected with a sane fallback and treated as available.
const CAP_PLATFORM = {
  'fs.read': [true, true, true],
  'fs.write': [true, true, true],
  'fs.watch': [true, true, true],
  'fs.recentPaths': [true, true, true],
  archive: [false, true, false],
  backup: [true, true, true],
  nativeMenu: [false, true, false],
  multiWindow: [false, true, false],
  'shell.open': [true, true, true],
  'fonts.local': [true, true, true],
  'clipboard.image': [true, true, true],
  notifications: [true, true, true],
  autoUpdate: [true, true, true],
};
const NEGATED_NOTE = 'Visible when capability absent';

// ---------------------------------------------------------------------------
// Text scanning primitives (string/comment-aware)
// ---------------------------------------------------------------------------

/** Skip the character at `i` when it starts a string or line/block comment. */
function skipToEndOfLexeme(text, i) {
  const ch = text[i];
  if (ch === "'" || ch === '"' || ch === '`') {
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === '\\') j += 2;
      else if (text[j] === ch) return j + 1;
      else j += 1;
    }
    return text.length;
  }
  if (ch === '/' && text[i + 1] === '/') {
    const nl = text.indexOf('\n', i + 2);
    return nl === -1 ? text.length : nl + 1;
  }
  if (ch === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return i + 1;
}

/** Scan forward from `openIdx` (an opening brace/paren/bracket) to its match. */
function findMatching(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : open === '[' ? ']' : ')';
  let depth = 0;
  for (let i = openIdx; i < text.length; i = skipToEndOfLexeme(text, i)) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced '${open}' in defs.ts at index ${openIdx}`);
}

/** Split an array-literal body on top-level commas, returning element strings. */
function splitTopLevel(text, start, end) {
  const parts = [];
  let depth = 0;
  let partStart = start;
  for (let i = start; i <= end; i = skipToEndOfLexeme(text, i)) {
    if (i >= end) break;
    if (text[i] === '{' || text[i] === '[' || text[i] === '(') depth += 1;
    else if (text[i] === '}' || text[i] === ']' || text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(partStart, i));
      partStart = i + 1;
    }
  }
  parts.push(text.slice(partStart, end));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function firstMatch(re, text) {
  const m = text.match(re);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// defs.ts parsing
// ---------------------------------------------------------------------------

function parseItems(itemsText, resolveHelper) {
  const items = [];
  const end = findMatching(itemsText, itemsText.indexOf('['));
  for (const element of splitTopLevel(itemsText, 1, end)) {
    const id = firstMatch(/id:\s*'([^']+)'/, element);
    if (!id) continue; // separators and other non-item entries
    const kind = firstMatch(/kind:\s*'([^']+)'/, element) ?? 'command';
    const labelKey = firstMatch(/labelKey:\s*'([^']+)'/, element);
    const workspacesRaw = firstMatch(/workspaces:\s*\[([^\]]*)\]/, element);
    const workspaces = workspacesRaw
      ? [...workspacesRaw.matchAll(/'([^']+)'/g)].map((m) => m[1])
      : null;

    let cap = null; // { name, negated } | 'os-not-mac' | 'special'
    const simpleCap = element.match(/visible:\s*\(ctx\)\s*=>\s*hasCapability\(ctx,\s*'([^']+)'\)/);
    const negatedCap = element.match(
      /visible:\s*\(ctx\)\s*=>\s*!hasCapability\(ctx,\s*'([^']+)'\)/,
    );
    const osMac = /visible:\s*\(ctx\)\s*=>\s*ctx\.platform\.os\s*!==\s*'mac'/.test(element);
    const multiline = /visible:\s*\(ctx\)\s*=>\s*\{/.test(element);
    if (simpleCap) cap = { name: simpleCap[1], negated: false };
    else if (negatedCap) cap = { name: negatedCap[1], negated: true };
    else if (osMac) cap = 'os-not-mac';
    else if (multiline) {
      // Multiline predicates: inspect the body for the capability they
      // negate (e.g. installDesktopApp: hidden whenever nativeMenu exists).
      const m = element.match(/hasCapability\(ctx,\s*'([^']+)'\)\s*\)\s*return false/);
      cap = m ? { name: m[1], negated: true } : 'special';
    }

    const item = { id, kind, labelKey, workspaces, cap };
    items.push(item);

    if (kind === 'submenu') {
      const itemsKey = element.indexOf('items:');
      if (itemsKey !== -1) {
        const after = element.slice(itemsKey + 'items:'.length).trimStart();
        if (after.startsWith('[')) {
          // Inline array literal: recurse.
          const arrStart = element.indexOf('[', itemsKey);
          const arrEnd = findMatching(element, arrStart);
          items.push(...parseItems(element.slice(arrStart, arrEnd + 1), resolveHelper));
        } else {
          // Reference to a helper function (getXxxSubmenuItems) or a
          // function-valued items (e.g. dynamic recent-files). Only helper
          // references with a resolvable definition contribute children.
          const fnCall = element.match(/items:\s*([a-zA-Z_$][\w$]*)\s*\(/);
          if (fnCall) {
            const children = resolveHelper(fnCall[1]);
            if (children) items.push(...children);
          }
        }
      }
    }
  }
  return items;
}

/** Parse every menu function body in defs.ts into ordered item lists. */
export function parseDefs(text) {
  const helperCache = new Map();

  /** Parse a `getXxxSubmenuItems`-style helper's `return [...]` body. */
  function resolveHelper(name) {
    if (helperCache.has(name)) return helperCache.get(name);
    helperCache.set(name, null); // guard against recursion
    const fnRe = new RegExp(`function ${name}\\s*\\(`);
    const fnStart = text.search(fnRe);
    if (fnStart === -1) return null;
    const returnIdx = text.indexOf('return [', fnStart);
    if (returnIdx === -1) return null;
    const openIdx = text.indexOf('[', returnIdx);
    const closeIdx = findMatching(text, openIdx);
    const children = parseItems(text.slice(openIdx, closeIdx + 1), resolveHelper);
    helperCache.set(name, children);
    return children;
  }

  const menus = {};
  for (const menu of MENUS) {
    const fnRe = new RegExp(`export function get${menu[0].toUpperCase()}${menu.slice(1)}Menu\\(`);
    const fnStart = text.search(fnRe);
    if (fnStart === -1) throw new Error(`missing get${menu}Menu in defs.ts`);
    const returnIdx = text.indexOf('return [', fnStart);
    const openIdx = text.indexOf('[', returnIdx);
    const closeIdx = findMatching(text, openIdx);
    menus[menu] = parseItems(text.slice(openIdx, closeIdx + 1), resolveHelper);
  }
  return menus;
}

/** Parse the MENU_LABELS dictionary into a key -> label map. */
export function parseLabels(text) {
  const labels = {};
  const start = text.indexOf('export const MENU_LABELS');
  const dictStart = text.indexOf('{', start);
  const dictEnd = findMatching(text, dictStart);
  for (const m of text.slice(dictStart + 1, dictEnd).matchAll(/^\s*'([^']+)':\s*'([^']*)',?$/gm)) {
    labels[m[1]] = m[2];
  }
  return labels;
}

function humanize(key) {
  const last = key.split('.').pop();
  return last
    .replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/(^|\s)([a-z])/g, (_m, space, c) => `${space}${c.toUpperCase()}`);
}

export function resolveLabel(labelKey, labels) {
  if (!labelKey) return '(unlabeled)';
  if (!labelKey.startsWith('menu.')) return labelKey;
  return labels[labelKey] ?? humanize(labelKey);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function capColumns(item) {
  if (item.cap === 'os-not-mac')
    return { cap: '—', cols: [true, true, true], note: 'Hidden on macOS' };
  if (item.cap === 'special')
    return { cap: '—', cols: [true, true, true], note: 'Special predicate' };
  if (!item.cap) return { cap: '—', cols: [true, true, true], note: '' };
  const base = CAP_PLATFORM[item.cap.name];
  if (!base) return { cap: item.cap.name, cols: [true, true, true], note: '' };
  const cols = item.cap.negated ? base.map((v) => !v) : base;
  return {
    cap: item.cap.negated ? `¬${item.cap.name}` : item.cap.name,
    cols,
    note: item.cap.negated ? NEGATED_NOTE : item.cap.name === 'archive' ? 'Hidden in browser' : '',
  };
}

const tick = (v) => (v ? '✓' : '—');

function renderCapabilityMatrix(menus) {
  const sections = [];
  for (const menu of MENUS) {
    const rows = [];
    for (const item of menus[menu]) {
      const { cap, cols, note } = capColumns(item);
      rows.push(`| \`${item.id}\` | \`${cap}\` | ${cols.map(tick).join(' | ')} | ${note} |`);
    }
    sections.push(
      `## ${MENU_TITLES[menu]} menu\n\n| Item | Cap | Web | Tauri | Mem | Notes |\n|------|-----|-----|-------|-----|-------|\n${rows.join('\n')}`,
    );
  }
  return CAP_TEMPLATE.replace('<!-- MENU_SECTIONS -->', sections.join('\n\n'));
}

function renderWorkspaceMatrix(menus, labels) {
  const sections = [];
  for (const menu of MENUS) {
    const rows = [];
    for (const item of menus[menu]) {
      const show = item.workspaces ?? MODES;
      const cells = MODES.map((m) => (show.includes(m) ? '✓' : '–'));
      const label =
        item.kind === 'submenu'
          ? `${resolveLabel(item.labelKey, labels)} (submenu)`
          : resolveLabel(item.labelKey, labels);
      rows.push(`| ${item.id} | ${label} | ${cells.join(' | ')} |`);
    }
    sections.push(
      `## Items — ${MENU_TITLES[menu]}\n\n| ID | Label | design | print | drawing | image | motion | logo | codegen |\n|----|-------|--------|-------|---------|-------|--------|------|---------|\n${rows.join('\n')}`,
    );
  }
  return WORKSPACE_TEMPLATE.replace('<!-- WORKSPACE_SECTIONS -->', sections.join('\n\n'));
}

// ---------------------------------------------------------------------------
// Templates (curated prose — legends, summaries, edge cases)
// ---------------------------------------------------------------------------

const CAP_TEMPLATE = `# Menu Item × Capability Visibility Matrix

Every item in the Varve menu system, its required capability (if any), and its
visibility in browser (\`web\`) vs Tauri desktop (\`tauri\`) vs memory/test (\`mem\`).

**Generated output.** The item tables are produced from
\`packages/editor/src/menu/defs.ts\` by \`scripts/regenerate-menu-matrices.mjs\`
— do not hand-edit them. Regenerate after any change to \`defs.ts\`.

## Legend

| Column | Meaning |
|--------|---------|
| Menu | Top-level menu (File, Edit, etc.) |
| Item | Action ID |
| Cap | Required capability — empty means always visible |
| Web | Visible in browser (\`capabilities\` has no \`nativeMenu\` / \`archive\` etc.) |
| Tauri | Visible in Tauri desktop |
| Mem | Visible in memory/test/SSR |
| Notes | Special conditions |

## Capability keys

| Key | Feature-detected? | Fallback |
|-----|-------------------|----------|
| \`fs.read\` | Always true | — |
| \`fs.write\` | Always true | — |
| \`fs.watch\` | \`showOpenFilePicker\` in window | \`isTauri()\` |
| \`fs.recentPaths\` | \`showOpenFilePicker\` in window | \`isTauri()\` |
| \`archive\` | Never in browser | \`isTauri()\` |
| \`backup\` | Always true | — |
| \`nativeMenu\` | Never in browser | \`isTauri()\` |
| \`multiWindow\` | Never in browser | \`isTauri()\` |
| \`shell.open\` | Always true | — |
| \`fonts.local\` | \`queryLocalFonts\` in window | false |
| \`clipboard.image\` | \`navigator.clipboard.read\` | false |
| \`notifications\` | \`typeof Notification !== 'undefined'\` | false |
| \`autoUpdate\` | Never in browser | \`isTauri()\` |

<!-- MENU_SECTIONS -->
`;

const WORKSPACE_TEMPLATE = `# Menu × Workspace Visibility Matrix

**Status:** Implemented — menu visibility per workspace is applied at runtime
via the \`workspaces\` filter on item definitions
(\`packages/editor/src/menu/defs.ts\`, applied by \`renderer.ts\`); this matrix
is the consolidated view. The seven workspace ids are design, print, drawing,
image, motion, logo, codegen.
**Posture:** SHOW unless meaningless in that mode.

**Generated output.** The item tables are produced from
\`packages/editor/src/menu/defs.ts\` by \`scripts/regenerate-menu-matrices.mjs\`
— do not hand-edit them. Regenerate after any change to \`defs.ts\`.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✓ | SHOW (default) |
| – | HIDE (meaningless in this mode) |

## Menus

| Menu | design | print | drawing | image | motion | logo | codegen | Notes |
|------|--------|-------|---------|-------|--------|------|---------|-------|
| File | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Never hide file operations |
| Edit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Never hide Undo/Redo/clipboard |
| Text | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | Codegen and Logo have no text editing |
| View | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | View/zoom/navigation universal |
| Object | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Object manip universal; items filtered individually |
| Arrange | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Align/order/nudge universal |
| Page | ✓ | ✓ | – | – | – | – | – | Multi-page only meaningful in design + print |
| Help | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Never hide Help |

<!-- WORKSPACE_SECTIONS -->

## Edge Cases

- **"Show all menu items" preference** (default off): bypasses all workspace
  filtering, restoring the full menu tree. For power users who find workspace
  filtering disorienting.
- **Shortcut invocation for hidden items**: When a keyboard shortcut is
  pressed for a hidden item, the action runs normally (preferred). Hidden
  items keep their accelerator registration.
- **Command palette**: Shows all items regardless of workspace filter, with a
  workspace-mode tag appended (e.g. "Toggle Facing Pages [Print]").
- **Empty menus**: If workspace filtering empties a top-level menu entirely,
  that menu is removed from the menubar. The menubar reflows but uses
  \`visibility: hidden\` on removed entries briefly during transition to
  prevent jarring layout shifts.
- **Switching workspaces while a menu is open**: The open menu is closed
  immediately on workspace switch, preventing mutation under cursor.
`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generate() {
  const defsText = readFileSync(DEFS, 'utf8');
  const locText = readFileSync(LOCALIZATION, 'utf8');
  const menus = parseDefs(defsText);
  const labels = parseLabels(locText);
  return {
    capability: renderCapabilityMatrix(menus),
    workspace: renderWorkspaceMatrix(menus, labels),
  };
}

// Resolve argv[1] to its real path so the main-run check is cwd-independent
// (a guard based on join(cwd, argv[1]) silently no-ops when invoked from a
// subdirectory, which made regeneration look like it succeeded without
// writing anything).
const isMain =
  !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const check = process.argv.includes('--check');
  const generated = generate();
  const failures = [];
  for (const [file, content] of [
    [CAP_MATRIX, generated.capability],
    [WORKSPACE_MATRIX, generated.workspace],
  ]) {
    const current = readFileSync(file, 'utf8');
    if (current === content) {
      console.log(`ok: ${file}`);
    } else if (check) {
      failures.push(file);
      console.error(`stale: ${file} — run: node scripts/regenerate-menu-matrices.mjs`);
    } else {
      writeFileSync(file, content);
      console.log(`regenerated: ${file}`);
    }
  }
  if (check && failures.length > 0) {
    console.error('Menu matrices are out of sync with defs.ts.');
    process.exit(1);
  }
}
