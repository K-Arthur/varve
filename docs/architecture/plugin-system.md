# Application plugins: trust boundary and first contract

Status: implementation in progress. This document describes the intended
package and host contract; the acceptance matrix below is the source of truth
for what has actually been verified. Application plugins are distinct from
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
unknown exports only when they imply a privileged import; extra pure guest
functions cannot acquire host authority. The host validates the result schema,
identity, command kind, output size, target IDs, current grants, document
identity, and runtime generation before accepting it. The manifest declares
commands and contextual Inspector sections, with no runtime callbacks.

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
| Package validation and local installation | Pending | Pending | Pending | Pending |
| On-demand Wasm execution and Stop | Pending | Pending | Pending | Pending |
| Permission revoke and stale-result rejection | Pending | Pending | Pending | Pending |
| Undoable rename, save/reopen without plugin | Pending | Pending | Pending | Pending |
| Manager and contextual Inspector rendering | Pending | Pending | Pending | Pending |
| Update/recovery and resource plateau | Pending | Pending | Pending | Pending |

See [the dated research and defect ledger](../audits/plugin-system-evidence-2026-09-25.md)
for the source-to-requirement trail. Update this matrix with actual results,
including failures and hardware gaps, rather than treating a passing unit
test as native confinement evidence.
