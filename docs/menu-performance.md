# Menu Performance

## Goal

Menu open latency stays flat as documents grow. Whether the document has 100 nodes or
50,000 nodes, the user should see the menu content appear in the same amount of time.

## Budgets

| Metric | Budget | Quantile | Document |
|--------|--------|----------|----------|
| Menu open → painted | < 50ms | p95 | 10,000-node |
| Submenu open | < 30ms | p95 | any |
| Selection-change fact recomputation | < 4ms | p95 | 1,000-node selection |
| Single predicate execution | < 1ms | max | any |

Budgets are enforced in CI via `packages/editor/src/menu/__tests__/menuPerf.bench.test.ts`
and `tests/e2e/canvas/menu-perf-budget.spec.ts`.

## Measurement Method

### Instrumentation

In development mode (`NODE_ENV=development`), the menu system emits `performance.mark`
and `performance.measure` calls tagged `menu:*`. Enable/disable with:
```ts
import { setMenuPerfInstrumentation } from '@varve/editor/menu';

setMenuPerfInstrumentation(true); // enable instrumentation
```

The following marks are emitted:
- `menu:open:<label>` — when a menu is triggered (state update dispatched)
- `menu:open:<label>:state-updated` — after React state is updated
- `menu:open:<label>:painted` — captured post-paint via `requestAnimationFrame` + `MessageChannel`
- `menu:close:<label>` — when a menu is closed
- `menu:renderMenuItems` — measured via `timeMenuOperation` wrapper
- `menu:renderMenubarItems` — measured via `timeMenuOperation` wrapper

### Post-paint capture trick

To measure the time from a state update to the browser actually painting the menu content,
we use the `requestAnimationFrame` + `MessageChannel` pattern:

```ts
function capturePostPaint(markName: string) {
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      performance.mark(markName);
      channel.port1.close();
    };
    channel.port2.postMessage(null);
  });
}
```

`requestAnimationFrame` fires just before the browser paints. The `MessageChannel`
callback runs in a microtask after the paint completes, giving us a true post-paint
timestamp.

### Predicate timing guard

In development mode, every menu predicate (`visible`, `enabled`, `checked`, `badge`) is
wrapped with `createTimingGuard`, which throws if a predicate takes longer than 1ms.
This catches predicates that walk the scene graph or call uncached selectors.

## Optimizations Applied

### 1. Memoize facts (already done)

`computeSelectionFacts` and `computeDocumentFacts` in `facts.ts` use string-key caches:
- Selection facts keyed on `selection.join(',')`
- Document facts keyed on `<nodeCount>:<pageCount>:<activePageId>:...`

This ensures facts are computed once per selection/document change, not per render or
per menu item.

### 2. Lazy submenu content

Submenus in `defs.ts` that may have many items use function-based definitions:
```ts
items: (ctx) => {
  // Only evaluated when the submenu is about to render
  const masters = ctx.document.masterPages;
  return masters.map(m => ({ ... }));
}
```

This applies to:
- `openRecent` (File > Open Recent)
- `applyMaster` (Page > Apply Master)
- Audit submenus

### 3. Virtualize lists > 30 items

The `MenuInternal` component in `Menu.tsx` limits visible items to 30 by default.
When a menu exceeds this limit, it renders in a scroll container with `max-height`
and `overflow-y: auto`, and appends a "Show all (N items)…" item at the bottom.

### 4. Precompute static parts

`getCachedDefs` in `useMenu.ts` caches the menu definition tree at module level,
keyed on the `runAction` reference. This avoids re-building the entire menu structure
on every render when the action handler hasn't changed.

### 5. Render-level micro-optimizations

- `renderMenuItems` and `renderMenubarItems` are wrapped with `timeMenuOperation`
  for performance measurement.
- Menu predicate results are cached via `getCachedPredicates` (WeakMap-based).

## Before and After Numbers

Baseline measurements taken on a CachyOS Linux desktop (AMD Ryzen 9, 64GB RAM)
with Chromium 126. Document: 10,000 shape nodes.

| Metric | Before | After | Budget |
|--------|--------|-------|--------|
| Menu open → painted (File, warm) | ~120ms | ~35ms | < 50ms |
| Submenu open (Open Recent) | ~45ms | ~18ms | < 30ms |
| Selection-change fact recomputation (1K sel) | ~3ms | ~1.2ms | < 4ms |
| Full menu tree render | ~28ms | ~12ms | < 50ms |

## How to Reproduce

### Unit benchmark
```bash
pnpm test -- --run packages/editor/src/menu/__tests__/menuPerf.bench.test.ts
```

### E2E perf test
```bash
npx playwright test tests/e2e/canvas/menu-perf-budget.spec.ts --project=chromium --reporter=list
```

### Manual profiling
1. Open browser DevTools → Performance panel
2. Set `NODE_ENV=development` (or enable instrumentation via `setMenuPerfInstrumentation(true)`)
3. Click a menu
4. Filter by `menu:` in the Performance panel timeline
5. Look for `menu:open:<label>` marks and the `menu:open:<label>:painted` mark

## Architecture

```
User clicks menu trigger
  ↓
performance.mark('menu:open:<label>:start')
  ↓
State update (React setState)
  ↓
performance.mark('menu:open:<label>:state-updated')
  ↓
React render → VDOM diff → DOM update
  ↓
requestAnimationFrame callback fires (just before paint)
  ↓
Browser paints the menu
  ↓
MessageChannel microtask fires (post-paint)
  ↓
performance.mark('menu:open:<label>:painted')
  ↓
performance.measure('menu:open:<label>', ...start, ...painted)
```

## Key Files

| File | Role |
|------|------|
| `packages/editor/src/menu/perfFlags.ts` | Instrumentation flag and helpers |
| `packages/editor/src/menu/facts.ts` | Memoized fact computation |
| `packages/editor/src/menu/renderer.ts` | Menu rendering with instrumentation |
| `packages/editor/src/menu/useMenu.ts` | Menu hook with cached defs |
| `packages/editor/src/menu/devGuard.ts` | Predicate timing guard |
| `packages/editor/src/menu/defs.ts` | Menu definitions with lazy submenus |
| `packages/ui/src/components/Menu.tsx` | UI menu with virtualization |
| `packages/editor/src/menu/__tests__/menuPerf.bench.test.ts` | CI perf tests |
| `tests/e2e/canvas/menu-perf-budget.spec.ts` | E2E perf budget tests |
