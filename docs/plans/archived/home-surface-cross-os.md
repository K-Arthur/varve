# Cross-OS Verification Checklist

> Last updated 2026-06-29

Run these checks manually on each target OS after all feature work is complete.

## Pre-requisites

- `pnpm install` succeeds on a clean checkout
- `cargo test --workspace` passes
- `pnpm typecheck` passes on all packages
- `pnpm test` passes

---

## Linux (CachyOS/Arch — primary dev OS)

- [ ] `pnpm tauri:dev` launches the app window
- [ ] WebKitGTK renders correctly (Wayland + X11)
- [ ] `app_data_dir` resolves to `~/.local/share/dev.strata.desktop/`
- [ ] `documents.db` created in `app_data_dir`
- [ ] Native file picker opens via `Open...` button
- [ ] "Reveal in Files" label displays correctly
- [ ] Keyboard shortcuts work (Ctrl+N, Ctrl+F, Ctrl+O, Ctrl+Shift+T)
- [ ] Drag-and-drop file reorder in sidebar works
- [ ] File watcher detects external `.strata` file changes
- [ ] Search returns results via FTS5
- [ ] `pnpm test:e2e` passes (chromium)

---

## macOS

- [ ] `pnpm tauri:dev` launches the app window
- [ ] `app_data_dir` resolves to `~/Library/Application Support/dev.strata.desktop/`
- [ ] "Reveal in Finder" label appears
- [ ] Native file picker works
- [ ] Window decoration (traffic lights) doesn't clip content
- [ ] Cmd+N, Cmd+F, Cmd+O, Cmd+Shift+T shortcuts work
- [ ] Touchpad gestures work (scroll, pinch zoom)

---

## Windows

- [ ] `pnpm tauri:dev` launches the app window
- [ ] `app_data_dir` resolves to `%APPDATA%/dev.strata.desktop/`
- [ ] "Reveal in Explorer" label appears
- [ ] Native file picker works
- [ ] Backslash paths handled correctly in IPC
- [ ] Ctrl+N, Ctrl+F, Ctrl+O, Ctrl+Shift+T shortcuts work
- [ ] Window sizing and DPI scaling correct

---

## CI (GitHub Actions)

- [ ] Build matrix passes: `ubuntu-latest`, `macos-latest`, `windows-latest`
- [ ] Rust tests pass on all 3 OSes
- [ ] Playwright chromium tests pass on ubuntu
- [ ] No OS-specific test failures
