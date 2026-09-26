# Application plugins: trust boundary and first contract

Status: local API v1 implemented on the source build. This document describes
the package and host contract; the acceptance matrix below records the
evidence and remaining platform gaps. Application plugins are distinct from
Tauri Rust plugins, build plugins, inference providers, and Figma import
adapters.

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

Package bytes and local grants belong to the application profile, never the
document. The initial local store uses IndexedDB under the application
origin, which is available in the supported desktop WebViews. This choice
keeps package bytes out of the Tauri asset protocol and avoids adding a
plugin-readable native file command. Transactional IndexedDB replacement
retains the prior package and grants until a new package is validated; an
update must not silently add grants. Checksums detect local byte changes but
do not authenticate a publisher. A local file's displayed publisher is a
self-assertion, not a verified badge.

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

## Acceptance matrix

| Capability | Code | Browser E2E | Native Linux | Native Windows/macOS |
| --- | --- | --- | --- | --- |
| Package validation and local installation | Implemented; parser unit tests and SDK smoke pass | Real Rust sample ZIP installed | Blocked by local native build OOM | Not run |
| On-demand Wasm execution and Stop | Implemented; bounded Worker contract | Analysis and noncooperative Stop/timeout pass | Blocked by local native build OOM | Not run |
| Permission revoke and stale-result rejection | Implemented; generation/revision/grant checks | Revocation during run passes; multi-window not exercised | Blocked by local native build OOM | Not run |
| Undoable rename, save/reopen without plugin | Implemented with canonical node update | Apply, remove, undo/redo, and save/reopen pass | Blocked by local native build OOM | Not run |
| Manager and contextual Inspector rendering | Implemented with host-owned controls | Manager, review, and Inspector text visibility pass | Blocked by local native build OOM | Not run |
| Update/recovery and resource plateau | Update, rollback, Retry implemented | Permission diff and rollback pass; long-session plateau not run | Blocked by local native build OOM | Not run |

See [the dated research and defect ledger](../audits/plugin-system-evidence-2026-09-25.md)
for the source-to-requirement trail. [The dated validation report](../audits/plugin-system-validation-2026-09-25.md)
lists commands, screenshots, limits, and unexercised scenarios. The static
validator is `node --experimental-strip-types scripts/plugins/validate.mjs
<file.varveplugin>`; it checks package structure without executing guest code.
