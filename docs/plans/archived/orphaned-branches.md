# Orphaned Branch Recovery

Generated 2026-07-17 during branch consolidation (5-phase cascade).

## Assessment

| Branch | Type | Status | Action |
|--------|------|--------|--------|
| `remotes/origin/feat/canvas-invalidation` | Remote | **Already merged** into master | Stale ref — update fetch |
| `remotes/origin/feat/wasm-trace-effects-pdf-hardening` | Remote | **Already merged** into master | Stale ref — update fetch |
| `remotes/worktree/feat/webgpu-wasm-acceleration` | Local worktree remote | **Already merged** into master; worktree directory removed from disk | Stale remote removed |
| `feat/native-gui-runtime` | Local worktree | **Merged** into master (`221c61a4`) | Active worktree at `.worktrees/native-gui-runtime` |
| `cascade/repository-path-home-karthur-windsurf-094003` | Local worktree | **Cherry-picked** into master (`d5ac30ca`) | Active worktree at `.windsurf/worktrees/Strata/Strata-094003b9` |

## How to refresh stale remote refs

```bash
git fetch origin --prune
```

This updates the remote-tracking branches to match the remote. The stale refs
(`feat/canvas-invalidation`, `feat/wasm-trace-effects-pdf-hardening`) will be
removed if they no longer exist on the remote, or kept if they're still active branches.
