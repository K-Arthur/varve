# Application plugins: trust boundary and first contract

Status: local API v1 implemented on the source build. This document describes
the package and host contract; the acceptance matrix below records the
evidence and remaining platform gaps. Application plugins are distinct from
Tauri Rust plugins, build plugins, inference providers, and Figma import
adapters.

Current implementation update: 2026-09-27, on `master`. The reconnaissance
below is historical baseline evidence; the runtime now includes the package
store, manager, permission broker, Wasm worker, commands, and host-rendered
Inspector contributions described in this contract. The current validation
ledger is in
[`plugin-system-validation-2026-09-27.md`](../audits/plugin-system-validation-2026-09-27.md),
with user-reported failure patterns and mitigations in
[`plugin-system-evidence-2026-09-27.md`](../audits/plugin-system-evidence-2026-09-27.md).

## Baseline at `042508de` (2026-09-25)

The only application-level extension hook is an in-memory Inspector section
registry. It has no production registration caller, installer, package store,
permission broker, SDK, or manager. Its render and availability callbacks run
inside the privileged editor WebView. A small context argument and a React
error boundary do not confine those callbacks. The native `list_plugins`
command returns an empty list. Consequently, the existing hook is for trusted,
bundled code only and is not evidence of an installable third-party system.

The main Tauri window has global Tauri access and broad filesystem/dialog/
updater capability grants. Its CSP allows several remote connections and
images. On Linux, Tauri cannot distinguish embedded iframe IPC from its
parent window. Loading external JavaScript or HTML into that window, including
an iframe, would cross the host's trust boundary.

## Decision: bounded WebAssembly compute plus host-owned UI

The first executable package format is a local `.varveplugin` ZIP containing
only `manifest.json` and `module.wasm`. Installation parses and validates both
before retaining bytes; it never runs npm scripts or fetches dependencies.
The WebAssembly module runs on demand in a dedicated, host-authored Worker.
It may import only a host-created, fixed-maximum `env.memory`, with no WASI,
JavaScript, DOM, filesystem, network, Tauri, clock, or random imports. The
Worker is terminated on Stop, disable, timeout, update, and removal. This is
an execution capability boundary and a hard stop for runaway CPU work; it is
not an OS process sandbox or a claim that workers generally lack network APIs.
The guest has no way to call those APIs through its import table. Worker
termination and fixed memory limit are tested separately from authorization.

The trusted editor owns the package manager, permission review, commands,
Inspector chrome, declarative result rendering, document snapshots, and
document mutations. A guest receives a bounded JSON snapshot of selected
nodes only after `selection.read` is granted. It returns bounded JSON with
analysis text or a rename proposal. Text is rendered by React as text, never
HTML. A rename is previewed, revalidated against the same document and node
names, then applied in one canonical undoable document update only while
`document.write` remains granted. Untrusted bytes never become a React
factory, action handler, URL, script, or native command argument.

The package API version is 1. The guest ABI imports `env.memory` and exports
`alloc(length) -> pointer`, `run(pointer, length) -> pointer`, and
`result_len() -> length`; UTF-8 JSON is the wire format. The host rejects
extra exports, extra imports, guest-defined memory, and unbounded tables. One
guest-defined function table with a declared maximum of at most 1,024 entries
is permitted for compiled Rust code. The host validates the result schema,
identity, command kind, output size, target IDs, current grants, document
identity, and runtime generation before accepting it. The manifest declares
commands and contextual Inspector sections, with no runtime callbacks.

The pre-compilation validator accepts only numeric Wasm function types and
checks the three export signatures against the API ABI before the engine sees
the module. Recursive/aggregate types, subtyping, GC types, and reference
parameters or results are unsupported. The imported memory instance is
created by the host with a 4 MiB initial and 16 MiB maximum linear-memory
size. That ceiling does not cap engine tables, runtime metadata, Worker
overhead, or total process memory; Worker termination bounds runaway work but
is not a process-level memory quota.

Package review and installation compile and inspect the Wasm module without
instantiating it. Instantiation would execute a guest start section; that is
deferred until the user runs a command in the short-lived Worker. An
instantiation-only ABI mismatch can therefore appear on first Run; the worker
reports it, the manager quarantines that package, and no document edit occurs.

`selection.read` and `document.write` are the only v1 permissions. There is no
filesystem, network, clipboard, secret, custom node, background event, native
binary, GPU, custom HTML, or remote marketplace API. A document never causes
package installation or activation. Generated artwork remains canonical
Varve content so it survives plugin removal. No plugin-owned document schema
is added in v1.

Every API v1 command receives a selection snapshot, so every runnable package
must declare `selection.read` as required or optional. A command that proposes
document changes must also declare `document.write`; that grant is checked
again when the user applies the preview. The static package validator checks
the same manifest and binary contract as installation without executing the
guest.

## Ownership and lifecycle

An installed package, user enable preference, individual permission grants,
command registration, and a running Worker are separate states. Installation
does not run the guest. A ready package contributes namespaced actions and
host-rendered Inspector sections. A command launches one short-lived Worker;
the worker is not kept resident between operations. Disable immediately
invalidates its generation, removes owned actions and sections, and terminates
running work. Stale replies cannot commit changes. A failed run retains a
diagnostic and a visible retry route. A startup recovery route must work
without activating packages.

Hiding a contributed Inspector panel is a third user-local preference beside
the enable flag and grants. It lives on the installation record (never in the
document), is mirrored into the section registry on every reconciliation,
survives reload, is retained across update and rollback when the panel is
still declared, and is dropped with the installation itself. Hiding or
showing a panel never enters undo history or marks artwork dirty.

Package bytes and local grants belong to the application profile, never the
document. The initial local store uses IndexedDB under the application
origin, which is available in the supported desktop WebViews. This choice
keeps package bytes out of the Tauri asset protocol and avoids adding a
plugin-readable native file command. Transactional IndexedDB replacement
retains the prior package and grants until a new package is validated; an
update must not silently add grants. Checksums detect local byte changes but
do not authenticate a publisher. A local file's displayed publisher is a
self-assertion, not a verified badge.

Database version 2 adds a durable revision store while preserving the existing
package object store and all installation fields. Migration assigns revision
1 to existing records; writes and removals update package and revision in the
same transaction. Removal leaves a revision tombstone to prevent uninstall /
reinstall ABA races. The 32-installation limit is checked inside the same
write transaction. Web Locks may serialize higher-level work when available,
but correctness relies on the authoritative IndexedDB transaction and
revision, not on Web Locks or BroadcastChannel. Cross-window messages are
invalidation hints only: each guarded selection read and document commit
rechecks the authoritative record and revision. The guarded host callback is
synchronous and revalidates document, editor session, selection, generation,
and grants immediately before applying one canonical undoable mutation.

The Settings → Plugins manager is the recovery surface and remains available
when plugins are disabled in safe mode. The File menu and command palette open
that same Settings section. Failed, disabled, and incompatible installations
stay in the inventory with their reason and available recovery actions. Safe
mode pauses contributions and execution without changing the saved enabled
preference; dismissing its startup screen does not exit safe mode. Execution
returns an explicit completed, stopped, or stale outcome. Stop does not mark a
plugin failed, and a stale result is discarded without document/history edits.

## Threat model and remaining platform evidence

The adversary controls package bytes, manifest text, guest Wasm behavior, and
guest JSON output. They may try archive traversal, decompression bombs, malformed
Wasm, forged results, output floods, infinite loops, memory growth, stale
write proposals, UI spoofing, and permission expansion. The host and Tauri
native commands are trusted, but other first-party content in the main
WebView shares its privilege; this plugin boundary does not fix broader host
XSS or native path authorization assumptions. The primary defense is that
guest code receives no host imports beyond bounded linear memory, and all
effects require host-side validation at use time.

Chromium E2E is necessary for design interactions, but is not evidence for
WebKitGTK, WebView2, or WKWebView. Before calling this contract cross-platform
verified, install and run adversarial packages in packaged desktop builds on
each supported OS, test Worker/Wasm memory import and termination behavior,
and verify that no guest-origin native IPC or network request is possible.
There is no signature/provenance infrastructure or remote update service in
this local format; the manager must describe local source and checksum without
implying verification.

## Packaged native validation procedure

Native evidence must identify the source and executable, not only the browser
test result. On each platform, record `git rev-parse HEAD`, the local worktree
diff, the test binary's SHA-256, the fixture archive's SHA-256, the OS/WebView
version from `pnpm desktop:preflight`, the command output, and a screenshot of
the manager result. The debug test build uses the distinct Tauri identifier
`dev.varve.desktop.wdio`, keeping its application profile separate from the
release identifier `dev.varve.desktop`.

The same platform-native scenario is
[`tests/wdio/plugin-native.e2e.ts`](../../tests/wdio/plugin-native.e2e.ts).
It creates artwork through the native window, reviews a package's permissions,
runs analysis, denies and then grants document-write access, previews and
applies a rename, checks undo/redo, and removes both packages. It saves named
screen states beside the path supplied in `VARVE_PLUGIN_NATIVE_SCREENSHOT`.
Native reload, revoke/disable during active work, rollback, and long-session
resource scenarios remain separate acceptance work; browser results do not
substitute for them. On a platform with the supported Rust and Tauri
toolchains, run:

```sh
pnpm desktop:preflight
pnpm desktop:build:test
mkdir -p artifacts/plugin-native
VARVE_PLUGIN_NATIVE_SCREENSHOT=artifacts/plugin-native/result.png \
  VARVE_WDIO_SPECS=./tests/wdio/plugin-native.e2e.ts pnpm exec wdio run wdio.conf.ts
```

Linux must use the packaged debug app under WebKitGTK and a real GUI session;
the preflight output records GTK/WebKitGTK and display dependencies. Windows
must run the same test app under WebView2 and retain the preflight-reported
WebView2 runtime version. macOS must use the system WKWebView and record the
macOS and Xcode versions. For each platform, start with an isolated OS test
account or a cleared `dev.varve.desktop.wdio` application-data directory, then
verify install/reload, permission denial, analysis, rename preview/apply,
revoke/disable during work, rollback, and removal. Browser Playwright WebKit
does not satisfy the Linux native check; WebKitGTK, WebView2, and WKWebView
results must be recorded separately. Windows and macOS procedure readiness is
not evidence that either platform has been run.

## Acceptance matrix: previous browser baseline

The browser results in the table below are from the 2026-09-25 baseline. They
do not validate the 2026-09-27 storage, authorization, safe-mode, or recovery
changes. The current run and any reruns are recorded separately in
`docs/audits/plugin-system-validation-2026-09-27.md`.

| Capability | Code | Browser E2E | Native Linux | Native Windows/macOS |
| --- | --- | --- | --- | --- |
| Package validation and local installation | Implemented; parser unit tests and SDK smoke pass | Real Rust sample ZIP installed on 2026-09-25; current changes pending | Prior local native build hit OOM; current attempt pending | Not run |
| On-demand Wasm execution and Stop | Implemented; bounded Worker contract | Analysis and noncooperative Stop/timeout passed on 2026-09-25; current changes pending | Prior local native build hit OOM; current attempt pending | Not run |
| Permission revoke and stale-result rejection | Implemented; generation/revision/grant checks | Revocation during run passed on 2026-09-25; current two-window checks pending | Prior local native build hit OOM; current attempt pending | Not run |
| Undoable rename, save/reopen without plugin | Implemented with canonical node update | Apply, remove, undo/redo, and save/reopen passed on 2026-09-25; current changes pending | Prior local native build hit OOM; current attempt pending | Not run |
| Manager and contextual Inspector rendering | Implemented with host-owned controls | Manager, review, and Inspector visibility passed on 2026-09-25; current changes pending | Prior local native build hit OOM; current attempt pending | Not run |
| Update/recovery and resource plateau | Update, rollback, Retry implemented | Permission diff and rollback passed on 2026-09-25; current checks and long-session plateau pending | Prior local native build hit OOM; current attempt pending | Not run |
| Manager panel hide/show preference | Persisted on the installation record, mirrored into the section registry, applied on registration | Hide/show round-trip passed on 2026-09-25; current changes pending | Prior local native build hit OOM; current attempt pending | Not run |
| Mixed selection, locked targets, competing plugins | Snapshot and revalidation checks are source-enforced | Mixed selection and locked rename passed on 2026-09-25; two-window and two-plugin cases pending | Prior local native build hit OOM; current attempt pending | Not run |

See [the 2026-09-27 failure-mode evidence ledger](../audits/plugin-system-evidence-2026-09-27.md)
for the source-to-requirement trail. [The current validation report](../audits/plugin-system-validation-2026-09-27.md)
lists commands, screenshots, limits, and unexercised scenarios; the
[2026-09-25 report](../audits/plugin-system-validation-2026-09-25.md) remains
the earlier baseline. The static validator is
`node --experimental-strip-types scripts/plugins/validate.mjs <file.varveplugin>`;
it checks package structure without executing guest code.
