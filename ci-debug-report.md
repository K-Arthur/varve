# CI Failure Debug Report

**Repository:** K-Arthur/varve
**Workflow:** CI
**Run:** [31300863752](https://github.com/K-Arthur/varve/actions/runs/31300863752)
**Branch:** master
**Commit:** 99e6b0877d0ae1051bbd42e9ba875305d3b2b93f
**Conclusion:** failure
**Created:** 2026-08-09T07:18:55Z

## Failed jobs

- **Rust (windows-latest)** (failure)
  - 14. cargo test (desktop): failure
- **JS (pnpm)** (failure)
  - 10. test: failure

## Failure snippets

### 2_Rust (macos-latest)
- line 275: `2026-08-09T07:19:27.4765020Z [36;1m# https://rust-lang.zulipchat.com/#narrow/stream/246057-t-cargo/topic/timeout.20inve`
  <details><summary>context</summary>

```
2026-08-09T07:19:27.4764220Z ##[group]Run : work around spurious network errors in curl 8.0
2026-08-09T07:19:27.4764570Z [36;1m: work around spurious network errors in curl 8.0[0m
2026-08-09T07:19:27.4765020Z [36;1m# https://rust-lang.zulipchat.com/#narrow/stream/246057-t-cargo/topic/timeout.20investigation[0m
2026-08-09T07:19:27.4765520Z [36;1mif rustc +stable --version --verbose | grep -q '^release: 1\.7[01]\.'; then[0m
2026-08-09T07:19:27.4765880Z [36;1m  echo CARGO_HTTP_MULTIPLEXING=false >> $GITHUB_ENV[0m
```
  </details>

- line 739: `2026-08-09T07:20:43.1500190Z [1m[92m  Downloaded[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:20:43.1482400Z [1m[92m  Downloaded[0m unicode-ccc v0.3.0
2026-08-09T07:20:43.1483240Z [1m[92m  Downloaded[0m version_check v0.9.5
2026-08-09T07:20:43.1500190Z [1m[92m  Downloaded[0m wait-timeout v0.2.1
2026-08-09T07:20:43.1532980Z [1m[92m  Downloaded[0m wasm-bindgen-macro v0.2.126
2026-08-09T07:20:43.1570210Z [1m[92m  Downloaded[0m wasm-bindgen-shared v0.2.126
```
  </details>

- line 1019: `2026-08-09T07:21:44.1242520Z [1m[92m    Checking[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:21:43.9403130Z [1m[92m    Checking[0m crypto-common v0.1.7
2026-08-09T07:21:43.9808520Z [1m[92m   Compiling[0m slotmap v1.1.1
2026-08-09T07:21:44.1242520Z [1m[92m    Checking[0m wait-timeout v0.2.1
2026-08-09T07:21:44.1789640Z [1m[92m    Checking[0m futures-task v0.3.32
2026-08-09T07:21:44.2437100Z [1m[92m    Checking[0m bit-vec v0.8.0
```
  </details>

- line 1211: `2026-08-09T07:23:18.6865430Z [1m[92m   Compiling[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:23:18.4057540Z [1m[92m   Compiling[0m block-buffer v0.10.4
2026-08-09T07:23:18.5197100Z [1m[92m   Compiling[0m qoi v0.4.1
2026-08-09T07:23:18.6865430Z [1m[92m   Compiling[0m wait-timeout v0.2.1
2026-08-09T07:23:19.0902270Z [1m[92m   Compiling[0m dirs-sys-next v0.1.2
2026-08-09T07:23:19.1760140Z [1m[92m   Compiling[0m quick-error v1.2.3
```
  </details>

### 3_JS (pnpm)
- line 726: `2026-08-09T07:22:03.2828519Z [22m[39mError: Not implemented: window.open`
  <details><summary>context</summary>

```
2026-08-09T07:22:03.0180760Z    [33m[2m✓[22m[39m Shell[2m > [22mrenders without canvas environment errors [33m382[2mms[22m[39m
2026-08-09T07:22:03.2818651Z [90mstderr[2m | packages/platform/src/windows/__tests__/contract.test.ts[2m > [22m[2mbrowser window service: honest popup capability (ADR-0034)[2m > [22m[2mdegrades honestly when the popup is blocked at open time
2026-08-09T07:22:03.2828519Z [22m[39mError: Not implemented: window.open
2026-08-09T07:22:03.2830131Z     at module.exports (/home/runner/work/varve/varve/node_modules/.pnpm/jsdom@25.0.1_supports-color@8.1.1/node_modules/jsdom/lib/jsdom/browser/not-implemented.js:9:17)
2026-08-09T07:22:03.2832210Z     at /home/runner/work/varve/varve/node_modules/.pnpm/jsdom@25.0.1_supports-color@8.1.1/node_modules/jsdom/lib/jsdom/browser/Window.js:960:7
```
  </details>

- line 785: `2026-08-09T07:22:35.2624683Z [22m[39m[icon] sanitize failed (empty-input) SanitizeError: Empty SVG input`
  <details><summary>context</summary>

```
2026-08-09T07:22:34.4077898Z  [32m✓[39m packages/editor/src/components/Settings/BgRemovalModelsTab.test.tsx [2m([22m[2m8 tests[22m[2m)[22m[90m 250[2mms[22m[39m
2026-08-09T07:22:35.2615025Z [90mstderr[2m | packages/editor/src/context/useIconAssets.test.tsx[2m > [22m[2museIconAssets — insertIconAsset[2m > [22m[2mrejects empty SVG without touching the document
2026-08-09T07:22:35.2624683Z [22m[39m[icon] sanitize failed (empty-input) SanitizeError: Empty SVG input
2026-08-09T07:22:35.2649076Z     at Module.sanitizeSvg [90m(/home/runner/work/varve/varve/[39mpackages/engine/src/icon/svgSanitize.ts:1066:11[90m)[39m
2026-08-09T07:22:35.2679399Z     at sanitizeIconSvg [90m(/home/runner/work/varve/varve/[39mpackages/editor/src/context/useIconAssets.ts:116:23[90m)[39m
```
  </details>

- line 834: `2026-08-09T07:22:59.2619316Z [22m[39m[recentFiles] failed to read from localStorage SyntaxError: Expected property nam`
  <details><summary>context</summary>

```
2026-08-09T07:22:58.3520172Z  [32m✓[39m packages/editor/src/components/SelectionQuickBar/resolveQuickBarProfile.test.ts [2m([22m[2m16 tests[22m[2m)[22m[90m 11[2mms[22m[39m
2026-08-09T07:22:59.2613004Z [90mstderr[2m | packages/editor/src/recentFiles/__tests__/store.test.ts[2m > [22m[2mrecentFiles store[2m > [22m[2mlocalStorage error handling[2m > [22m[2mreturns empty on corrupt JSON
2026-08-09T07:22:59.2619316Z [22m[39m[recentFiles] failed to read from localStorage SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
2026-08-09T07:22:59.2620825Z     at JSON.parse (<anonymous>)
2026-08-09T07:22:59.2622125Z  [32m✓[39m packages/editor/src/recentFiles/__tests__/store.test.ts [2m([22m[2m23 tests[22m[2m)[22m[90m 41[2mms[22m[39m
```
  </details>

- line 908: `2026-08-09T07:23:24.3299461Z [22m[39mError: Not implemented: navigation (except hash changes)`
  <details><summary>context</summary>

```
2026-08-09T07:23:23.5070474Z  [32m✓[39m packages/editor/src/intelligence/componentVariantDetector.test.ts [2m([22m[2m8 tests[22m[2m)[22m[90m 10[2mms[22m[39m
2026-08-09T07:23:24.3297363Z [90mstderr[2m | packages/editor/src/shortcuts/ShortcutPalette.test.tsx[2m > [22m[2mexport/import[2m > [22m[2mexport button triggers keymap generation
2026-08-09T07:23:24.3299461Z [22m[39mError: Not implemented: navigation (except hash changes)
2026-08-09T07:23:24.3301107Z     at module.exports (/home/runner/work/varve/varve/node_modules/.pnpm/jsdom@25.0.1_supports-color@8.1.1/node_modules/jsdom/lib/jsdom/browser/not-implemented.js:9:17)
2026-08-09T07:23:24.3303180Z     at navigateFetch (/home/runner/work/varve/varve/node_modules/.pnpm/jsdom@25.0.1_supports-color@8.1.1/node_modules/jsdom/lib/jsdom/living/window/navigation.js:77:3)
```
  </details>

- line 1460: `2026-08-09T07:27:05.5203650Z [22m[39mError: Boom`
  <details><summary>context</summary>

```
2026-08-09T07:27:05.2020353Z  [32m✓[39m packages/editor/src/components/Inspector/sections/__tests__/TypographySection.test.tsx [2m([22m[2m4 tests[22m[2m)[22m[33m 656[2mms[22m[39m
2026-08-09T07:27:05.5196714Z [90mstderr[2m | packages/editor/src/components/ErrorBoundary.test.tsx[2m > [22m[2mErrorBoundary[2m > [22m[2mrenders fallback on error
2026-08-09T07:27:05.5203650Z [22m[39mError: Boom
2026-08-09T07:27:05.5219132Z     at Bomb [90m(/home/runner/work/varve/varve/[39mpackages/editor/src/components/ErrorBoundary.test.tsx:6:26[90m)[39m
2026-08-09T07:27:05.5220721Z  [32m✓[39m packages/editor/src/components/ErrorBoundary.test.tsx [2m([22m[2m6 tests[22m[2m)[22m[90m 108[2mms[22m[39m
```
  </details>

- line 1480: `2026-08-09T07:27:05.5338184Z Error: Boom`
  <details><summary>context</summary>

```
2026-08-09T07:27:05.5336918Z React will try to recreate this component tree from scratch using the error boundary you provided, ErrorBoundary.
2026-08-09T07:27:05.5337948Z 
2026-08-09T07:27:05.5338184Z Error: Boom
2026-08-09T07:27:05.5339347Z     at Bomb [90m(/home/runner/work/varve/varve/[39mpackages/editor/src/components/ErrorBoundary.test.tsx:6:26[90m)[39m
2026-08-09T07:27:05.5341729Z     at Object.react_stack_bottom_frame [90m(/home/runner/work/varve/varve/[39mnode_modules/[4m.pnpm[24m/react-dom@19.2.7_react@19.2.7/node_modules/[4mreact-dom[24m/cjs/react-dom-client.development.js:25904:20[90m)[39m
```
  </details>

- line 1493: `2026-08-09T07:27:05.5377939Z [22m[39mError: Boom`
  <details><summary>context</summary>

```
2026-08-09T07:27:05.5374835Z 
2026-08-09T07:27:05.5376303Z [90mstderr[2m | packages/editor/src/components/ErrorBoundary.test.tsx[2m > [22m[2mErrorBoundary[2m > [22m[2mrenders custom fallback when provided
2026-08-09T07:27:05.5377939Z [22m[39mError: Boom
2026-08-09T07:27:05.5379489Z     at Bomb [90m(/home/runner/work/varve/varve/[39mpackages/editor/src/components/ErrorBoundary.test.tsx:6:26[90m)[39m
2026-08-09T07:27:05.5389297Z     at Object.react_stack_bottom_frame [90m(/home/runner/work/varve/varve/[39mnode_modules/[4m.pnpm[24m/react-dom@19.2.7_react@19.2.7/node_modules/[4mreact-dom[24m/cjs/react-dom-client.development.js:25904:20[90m)[39m
```
  </details>

- line 1512: `2026-08-09T07:27:05.5453744Z Error: Boom`
  <details><summary>context</summary>

```
2026-08-09T07:27:05.5452655Z React will try to recreate this component tree from scratch using the error boundary you provided, ErrorBoundary.
2026-08-09T07:27:05.5453498Z 
2026-08-09T07:27:05.5453744Z Error: Boom
2026-08-09T07:27:05.5454940Z     at Bomb [90m(/home/runner/work/varve/varve/[39mpackages/editor/src/components/ErrorBoundary.test.tsx:6:26[90m)[39m
2026-08-09T07:27:05.5457889Z     at Object.react_stack_bottom_frame [90m(/home/runner/work/varve/varve/[39mnode_modules/[4m.pnpm[24m/react-dom@19.2.7_react@19.2.7/node_modules/[4mreact-dom[24m/cjs/react-dom-client.development.js:25904:20[90m)[39m
```
  </details>

- line 1525: `2026-08-09T07:27:05.5485177Z [22m[39mError: Boom`
  <details><summary>context</summary>

```
2026-08-09T07:27:05.5482654Z 
2026-08-09T07:27:05.5483920Z [90mstderr[2m | packages/editor/src/components/ErrorBoundary.test.tsx[2m > [22m[2mErrorBoundary[2m > [22m[2mcalls onError when error occurs
2026-08-09T07:27:05.5485177Z [22m[39mError: Boom
2026-08-09T07:27:05.5486354Z     at Bomb [90m(/home/runner/work/varve/varve/[39mpackages/editor/src/components/ErrorBoundary.test.tsx:6:26[90m)[39m
2026-08-09T07:27:05.5488950Z     at Object.react_stack_bottom_frame [90m(/home/runner/work/varve/varve/[39mnode_modules/[4m.pnpm[24m/react-dom@19.2.7_react@19.2.7/node_modules/[4mreact-dom[24m/cjs/react-dom-client.development.js:25904:20[90m)[39m
```
  </details>

- line 1544: `2026-08-09T07:27:05.5518385Z Error: Boom`
  <details><summary>context</summary>

```
2026-08-09T07:27:05.5517083Z React will try to recreate this component tree from scratch using the error boundary you provided, ErrorBoundary.
2026-08-09T07:27:05.5518134Z 
2026-08-09T07:27:05.5518385Z Error: Boom
2026-08-09T07:27:05.5519894Z     at Bomb [90m(/home/runner/work/varve/varve/[39mpackages/editor/src/components/ErrorBoundary.test.tsx:6:26[90m)[39m
2026-08-09T07:27:05.5522329Z     at Object.react_stack_bottom_frame [90m(/home/runner/work/varve/varve/[39mnode_modules/[4m.pnpm[24m/react-dom@19.2.7_react@19.2.7/node_modules/[4mreact-dom[24m/cjs/react-dom-client.development.js:25904:20[90m)[39m
```
  </details>

_... and 14 more matches._
### 4_Rust (windows-latest)
- line 2654: `2026-08-09T07:42:41.7938505Z ##[error]Process completed with exit code 1.`
  <details><summary>context</summary>

```
2026-08-09T07:42:41.6719390Z   process didn't exit successfully: `D:\a\varve\varve\apps\desktop\src-tauri\target\debug\deps\varve_desktop_lib-8b904efb6f3dfbd1.exe` (exit code: 0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND)
2026-08-09T07:42:41.6720592Z [1m[92mnote[0m: test exited abnormally; to see the full output pass --no-capture to the harness.
2026-08-09T07:42:41.7938505Z ##[error]Process completed with exit code 1.
2026-08-09T07:42:41.8123754Z ##[group]Run pwsh -File "$env:GITHUB_WORKSPACE/scripts/ci/diagnose-entrypoint.ps1"
2026-08-09T07:42:41.8124510Z [36;1mpwsh -File "$env:GITHUB_WORKSPACE/scripts/ci/diagnose-entrypoint.ps1"[0m
```
  </details>

- line 2651: `2026-08-09T07:42:41.6718529Z Caused by:`
  <details><summary>context</summary>

```
2026-08-09T07:42:41.6718036Z [1m[91merror[0m: test failed, to rerun pass `--lib`
2026-08-09T07:42:41.6718417Z 
2026-08-09T07:42:41.6718529Z Caused by:
2026-08-09T07:42:41.6719390Z   process didn't exit successfully: `D:\a\varve\varve\apps\desktop\src-tauri\target\debug\deps\varve_desktop_lib-8b904efb6f3dfbd1.exe` (exit code: 0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND)
2026-08-09T07:42:41.6720592Z [1m[92mnote[0m: test exited abnormally; to see the full output pass --no-capture to the harness.
```
  </details>

- line 2649: `2026-08-09T07:42:41.6718036Z [1m[91merror[0m: test failed, to rerun pass `--lib``
  <details><summary>context</summary>

```
2026-08-09T07:42:41.5304516Z [1m[92m    Finished[0m `test` profile [unoptimized + debuginfo] target(s) in 4m 52s
2026-08-09T07:42:41.6580421Z [1m[92m     Running[0m unittests src\lib.rs (apps\desktop\src-tauri\target\debug\deps\varve_desktop_lib-8b904efb6f3dfbd1.exe)
2026-08-09T07:42:41.6718036Z [1m[91merror[0m: test failed, to rerun pass `--lib`
2026-08-09T07:42:41.6718417Z 
2026-08-09T07:42:41.6718529Z Caused by:
```
  </details>

- line 362: `2026-08-09T07:27:37.1095179Z [36;1m# https://rust-lang.zulipchat.com/#narrow/stream/246057-t-cargo/topic/timeout.20inve`
  <details><summary>context</summary>

```
2026-08-09T07:27:37.1094203Z ##[group]Run : work around spurious network errors in curl 8.0
2026-08-09T07:27:37.1094634Z [36;1m: work around spurious network errors in curl 8.0[0m
2026-08-09T07:27:37.1095179Z [36;1m# https://rust-lang.zulipchat.com/#narrow/stream/246057-t-cargo/topic/timeout.20investigation[0m
2026-08-09T07:27:37.1095799Z [36;1mif rustc +stable --version --verbose | grep -q '^release: 1\.7[01]\.'; then[0m
2026-08-09T07:27:37.1096255Z [36;1m  echo CARGO_HTTP_MULTIPLEXING=false >> $GITHUB_ENV[0m
```
  </details>

- line 895: `2026-08-09T07:29:29.6581840Z [1m[92m  Downloaded[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:29:29.4572455Z [1m[92m  Downloaded[0m pxfm v0.1.29
2026-08-09T07:29:29.6475963Z [1m[92m  Downloaded[0m slab v0.4.12
2026-08-09T07:29:29.6581840Z [1m[92m  Downloaded[0m wait-timeout v0.2.1
2026-08-09T07:29:29.6732304Z [1m[92m  Downloaded[0m ravif v0.13.0
2026-08-09T07:29:29.6821414Z [1m[92m  Downloaded[0m shlex v2.0.1
```
  </details>

- line 1105: `2026-08-09T07:30:51.0522297Z [1m[92m    Checking[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:30:50.8954801Z [1m[92m    Checking[0m tintbox v0.4.0
2026-08-09T07:30:50.9867447Z [1m[92m   Compiling[0m cfg_aliases v0.2.1
2026-08-09T07:30:51.0522297Z [1m[92m    Checking[0m wait-timeout v0.2.1
2026-08-09T07:30:51.1316204Z [1m[92m    Checking[0m slab v0.4.12
2026-08-09T07:30:51.3191860Z [1m[92m    Checking[0m fnv v1.0.7
```
  </details>

- line 1316: `2026-08-09T07:35:10.4716143Z [1m[92m   Compiling[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:35:09.9516244Z [1m[92m   Compiling[0m bit-vec v0.8.0
2026-08-09T07:35:10.3734620Z [1m[92m   Compiling[0m equivalent v1.0.2
2026-08-09T07:35:10.4716143Z [1m[92m   Compiling[0m wait-timeout v0.2.1
2026-08-09T07:35:10.5992974Z [1m[92m   Compiling[0m rusty-fork v0.3.1
2026-08-09T07:35:11.3360481Z [1m[92m   Compiling[0m indexmap v2.14.0
```
  </details>

### 5_Rust (ubuntu-latest)
- line 3917: `2026-08-09T07:28:39.6526494Z [36;1m  printf '::error::install-action: %s\n' "$*"[0m`
  <details><summary>context</summary>

```
2026-08-09T07:28:39.6526010Z ##[group]Run bail() {
2026-08-09T07:28:39.6526254Z [36;1mbail() {[0m
2026-08-09T07:28:39.6526494Z [36;1m  printf '::error::install-action: %s\n' "$*"[0m
2026-08-09T07:28:39.6526790Z [36;1m  exit 1[0m
2026-08-09T07:28:39.6527007Z [36;1m}[0m
```
  </details>

- line 3983: `2026-08-09T07:28:39.9985255Z [36;1m  printf '::error::install-action: %s\n' "$*"[0m`
  <details><summary>context</summary>

```
2026-08-09T07:28:39.9984748Z ##[group]Run bail() {
2026-08-09T07:28:39.9985005Z [36;1mbail() {[0m
2026-08-09T07:28:39.9985255Z [36;1m  printf '::error::install-action: %s\n' "$*"[0m
2026-08-09T07:28:39.9985551Z [36;1m  exit 1[0m
2026-08-09T07:28:39.9985930Z [36;1m}[0m
```
  </details>

- line 272: `2026-08-09T07:19:26.1481567Z [36;1m# https://rust-lang.zulipchat.com/#narrow/stream/246057-t-cargo/topic/timeout.20inve`
  <details><summary>context</summary>

```
2026-08-09T07:19:26.1480571Z ##[group]Run : work around spurious network errors in curl 8.0
2026-08-09T07:19:26.1481008Z [36;1m: work around spurious network errors in curl 8.0[0m
2026-08-09T07:19:26.1481567Z [36;1m# https://rust-lang.zulipchat.com/#narrow/stream/246057-t-cargo/topic/timeout.20investigation[0m
2026-08-09T07:19:26.1482197Z [36;1mif rustc +stable --version --verbose | grep -q '^release: 1\.7[01]\.'; then[0m
2026-08-09T07:19:26.1482653Z [36;1m  echo CARGO_HTTP_MULTIPLEXING=false >> $GITHUB_ENV[0m
```
  </details>

- line 1896: `2026-08-09T07:21:11.9322139Z [1m[92m  Downloaded[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:21:11.9290857Z [1m[92m  Downloaded[0m gif v0.14.2
2026-08-09T07:21:11.9308000Z [1m[92m  Downloaded[0m grid v1.0.1
2026-08-09T07:21:11.9322139Z [1m[92m  Downloaded[0m wait-timeout v0.2.1
2026-08-09T07:21:11.9337950Z [1m[92m  Downloaded[0m wasm-bindgen-shared v0.2.126
2026-08-09T07:21:11.9348569Z [1m[92m  Downloaded[0m base64 v0.22.1
```
  </details>

- line 2082: `2026-08-09T07:21:47.2430620Z [1m[92m    Checking[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:21:47.1160753Z [1m[92m    Checking[0m crypto-common v0.1.7
2026-08-09T07:21:47.1740141Z [1m[92m    Checking[0m block-buffer v0.10.4
2026-08-09T07:21:47.2430620Z [1m[92m    Checking[0m wait-timeout v0.2.1
2026-08-09T07:21:47.3200320Z [1m[92m   Compiling[0m slotmap v1.1.1
2026-08-09T07:21:47.4280781Z [1m[92m    Checking[0m futures-task v0.3.32
```
  </details>

- line 2296: `2026-08-09T07:24:00.6930349Z [1m[92m   Compiling[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:24:00.4262830Z [1m[92m   Compiling[0m crypto-common v0.1.7
2026-08-09T07:24:00.4881052Z [1m[92m   Compiling[0m qoi v0.4.1
2026-08-09T07:24:00.6930349Z [1m[92m   Compiling[0m wait-timeout v0.2.1
2026-08-09T07:24:01.2200248Z [1m[92m   Compiling[0m dirs-sys-next v0.1.2
2026-08-09T07:24:01.8089933Z [1m[92m   Compiling[0m fnv v1.0.7
```
  </details>

- line 4167: `2026-08-09T07:31:36.9251251Z [1m[92m   Compiling[0m wait-timeout v0.2.1`
  <details><summary>context</summary>

```
2026-08-09T07:31:36.9250542Z [1m[92m   Compiling[0m block-buffer v0.10.4
2026-08-09T07:31:36.9250896Z [1m[92m   Compiling[0m qoi v0.4.1
2026-08-09T07:31:36.9251251Z [1m[92m   Compiling[0m wait-timeout v0.2.1
2026-08-09T07:31:36.9251635Z [1m[92m   Compiling[0m dirs-sys-next v0.1.2
2026-08-09T07:31:36.9252002Z [1m[92m   Compiling[0m cfg_aliases v0.2.1
```
  </details>

### Rust (windows-latest)
- line 0: `Job concluded as failure but no log text was downloaded.`
  <details><summary>context</summary>

```

```
  </details>

### JS (pnpm)
- line 0: `Job concluded as failure but no log text was downloaded.`
  <details><summary>context</summary>

```

```
  </details>


## Local reproduction

```bash
# Run the failing gate locally
just gate

# Or reproduce a specific job with act
just act-run js
```