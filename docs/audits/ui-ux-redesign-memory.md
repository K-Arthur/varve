# UI/UX Neo-Bento Redesign — Session Memory

**Started:** 2026-07-08  
**Target:** Neo-Bento grid + Linear-esque precision (dark/light)  
**Branch:** master (working tree)

## Cascade Review Status

| Pass | Status | Notes |
|------|--------|-------|
| P1 Independent review | Done | Design + A11Y sub-agents |
| P2 Cross-challenge | Done | gpu-layer vs portal conflict resolved → portal + remove shell gpu-layer |
| P3 Conflict resolution | Done | Prioritize P0 clipping before aesthetic P1 |
| P4 TDD + headless | Done | Select/Menu portal tests added |

## P0 Findings (fix first)

1. **Menubar dropdown clipping** — `position:absolute` inside `overflow:hidden` shell (`Menubar.tsx`, `editor.css:103`)
2. **gpu-layer breaks fixed overlays** — `Shell.tsx` + `global.css` transform/contain creates containing block
3. **ShortcutPalette inline + hardcoded rgba** — invalid `--color-accent`, no tokens
4. **Menu/Select absolute in overflow panels** — need portal primitive

## P1 Findings (this session)

- Dual surface systems (`--color-surface-*` vs `--elevation-surface-*`)
- `.file-card` overrides `.bento-cell`
- Menubar/GradientEditor unstyled inline
- HC theme missing elevation overrides

## Implementation Log

| Item | Status | Commit |
|------|--------|--------|
| memory.md init | Done | — |
| FloatingPortal (`FloatingPortal`) | Done | 802d717 |
| Menubar portal menus + CSS | Done | 37e59e4 |
| gpu-layer moved to canvas | Done | 37e59e4 |
| ShortcutPalette CSS + portal | Done | 37e59e4 |
| Popover/Tooltip z-index tokens | Done | 37e59e4 |
| Dialog scrim token | Done | 37e59e4 |
| Headless overlay tests (8) | Done | 802d717 |

| Select listbox portal | Done | 1997a32 |
| Menu component portal | Done | 1997a32 |
| Home file-card bento fix | Done | 1997a32 |
| FloatingPortal matchAnchorWidth | Done | 1997a32 |
| Surface token unification | Done | — |
| HC theme elevation overrides | Done | — |
| GradientEditor CSS extraction | Done | — |
| BindingMenu portal + combobox | Done | — |

## P1 Remaining (next session)

- (none — slice 3 complete; next: Menubar/GradientEditor inline cleanup audit, full gate run)

## Verification Gates

- [x] FloatingPortal + Menubar tests (8/8)
- [x] Select/Menu/FloatingPortal tests (45/45)
- [x] `pnpm audit:tokens` (96/96)
- [ ] `pnpm audit:emoji`
