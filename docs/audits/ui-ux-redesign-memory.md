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
| P4 TDD + headless | In progress | |

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
| OverlayPortal (`FloatingPortal`) | Done | pending |
| Menubar portal menus + CSS | Done | pending |
| gpu-layer moved to canvas | Done | pending |
| ShortcutPalette CSS + portal | Done | pending |
| Popover/Tooltip z-index tokens | Done | pending |
| Dialog scrim token | Done | pending |
| Headless overlay tests (8) | Done | pending |

## P1 Remaining (next session)

- Unify `--color-surface-*` / `--elevation-surface-*`
- HC theme elevation overrides
- `.bento-grid` on home + file-card fix
- GradientEditor CSS extraction
- Select listbox portal
- BindingMenu combobox pattern

## Verification Gates

- [x] FloatingPortal + Menubar tests (8/8)
- [ ] full `pnpm typecheck` (pre-existing Button.tsx error in ui)
- [ ] `pnpm lint` touched files
- [ ] `pnpm audit:tokens`
- [ ] `pnpm audit:emoji`
