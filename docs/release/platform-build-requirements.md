# Native release requirements

Reviewed 2026-10-07 against the actual 0.5.0 build and qualification failures.
The product remains the certified tag; recovery tooling comes from the exact
accepted `master` workflow revision. A successful contract probe establishes
dependency compatibility, not installed-product qualification.

## Runner and package contract

| Target | Build runner / Rust target | Required build and installed-test facilities |
|---|---|---|
| Linux x64 | `ubuntu-22.04` / `x86_64-unknown-linux-gnu` | GTK 3, WebKitGTK 4.1, OpenSSL, librsvg, fontconfig, GLib, Soup 3, GDK-Pixbuf, Cairo, Pango; CMake, pkg-config, patchelf, squashfs-tools, xdg-utils. Qualification adds WebKitWebDriver, Xvfb, a session D-Bus, accessibility libraries, Mesa, fonts and media dependencies. |
| Linux ARM64 | `ubuntu-22.04-arm` / `aarch64-unknown-linux-gnu` | Same package families, installed for ARM64. AppImage packaging and native inference run on ARM64; an x64/QEMU build is not substituted. |
| Windows x64 | `windows-latest` / `x86_64-pc-windows-msvc` | Visual Studio C++ tools, Windows SDK and Microsoft linker. NSIS plus Evergreen WebView2; inspect the runtime registration, not the Edge browser version. |
| Windows ARM64 | `windows-11-arm` / `aarch64-pc-windows-msvc` | Native ARM64 VC tools/SDK, LLVM `clang-cl`, Ninja and CMake. Explicit ARM64 Microsoft linker, `rc.exe` and `mt.exe`; ARM NEON and C++ exception support. NSIS bootstrapper runs under emulation; the installed application must be ARM64. |
| macOS ARM64 | `macos-latest` / `aarch64-apple-darwin` | Apple SDK/compiler and Xcode tools for build; full Xcode/XCTest, an active desktop and Accessibility permissions for external Mac2 qualification. Native ONNX payload is ARM64; this is not a universal Intel bundle. |

The Linux build baseline stays on Ubuntu 22.04 to preserve the glibc 2.35
floor. Do not replace it with a newer build host to solve a missing package.
System packages follow each distribution's security updates; the package
names, ABI baseline and actual resulting binaries are verified. Hosted image
labels are mutable, so `native-runtime.json` records image identity/version
when exposed by the runner. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
and [GitHub runner images](https://github.com/actions/runner-images).

The production workflow owns the executable package lists. Linux clean DEB/RPM
installation, AppImage launch and uninstall remain separate from the external
GUI save/reopen/export checks. Windows ARM64's early compiler probe actually
compiles, links and executes NEON and throwing/catching C++, then runs an
offline Rust linker probe in the production Bash environment.

## Pinned tooling and dependency ownership

The published 0.2.1 macOS upgrade seed must reopen through its real editor
File > Open action. Its Home handler assumes an object-array result from
`plugin:dialog|open`, although the native picker returns a path string, so that
old Home action closes the panel without loading the file. The qualification
adapter creates a real editor after baseline restart and opens its unchanged
saved file through the native panel. Current 0.5.0 must still pass Home opening,
native save/reopen, artwork retention, history, exports and profile continuity.
This baseline compatibility path changes no application or installer bytes.
The baseline can also lose its native save path after reopening. If Quit opens
Save As, qualification completes that real save only when the filename matches
the owned migration document. Replacement confirmation must name that same
file. Artwork is checked before saving and again after actual process exit.
Current 0.5.0 receives no historical save-path workaround.

| Dependency | Release contract |
|---|---|
| Node | `26.10.0` in integration, candidate, build, release and website workflows; verify both version and native architecture before packaging. |
| pnpm | `11.9.0`; install the tagged frozen lockfile independently on each target. Never reuse another OS/CPU's `node_modules`. |
| Rust | `1.97.1`, including `rustfmt` for the native binding generator; target triple explicit. |
| Browser harness | Playwright `1.62.1`; browser executable and Linux visual image/font identity are retained with evidence. |
| Linux driver | `tauri-driver 2.1.0 --locked`; actual WebKit driver owns browser selection. |
| macOS driver | Appium `3.8.0` + Mac2 `4.3.6` in isolated runner-temp directories; run the driver's doctor before native sessions. |
| Native inference | ONNX Runtime `1.27.1` and optional WebGPU plugin `0.3.0`, checksum-pinned archives/libraries; prune foreign payloads before bundling. Availability is target-specific. |
| PDF oracle | Tagged lock resolves PDF.js `6.2.108`, its owned `@napi-rs/canvas 1.0.5`, and engine-owned `pngjs 7.0.0`; actual runtime versions and native canvas loading are recorded before packaging. |

Native `pdfjs-dist` dependencies must resolve from the renderer's package
owner. Workspace hoisting is not a dependency contract. Optional native
dependencies must remain installed for the executing OS/CPU/libc; copying the
renderer to a temporary URL-path fixture requires explicit ownership of its
real native canvas. The regression uses actual renderer/worker modules,
native binary and artwork pixels, including Windows cross-drive temporary
paths containing `#`. It uses normal Node resolution, without global
symlink-preservation flags. See [pnpm dependency resolution](https://pnpm.io/settings/dependency-resolution).

Existing workspace overrides are deliberate compatibility constraints:
`@wdio/native-utils 2.5.0` provides the API required by Tauri service `1.3.0`;
Astro language-server `2.16.11` avoids the observed newer resolver regression.
pnpm 11's `allowBuilds`, reviewed patches and narrow peer allowances remain
in `pnpm-workspace.yaml`. Changing a pin requires its owning compatibility
test, frozen-lock update and the appropriate platform probe; a broad update
to silence peer warnings is not a repair.

## Earlier failure detection

`native-contracts` runs on all five native runner architectures before
`bundle`. It installs the product lockfile, loads the real native canvas,
records runtime/product/workflow identities and executes the qualification
adapter regressions, including real rendered PDF positives and negatives.
Wrong Node version/architecture fails without producing an acceptance receipt.
Any failed contract blocks expensive compilation and artifact reuse.

The later installed gates still require the published 0.2.1 baseline,
same-profile 0.5.0 upgrade, edit/undo, disk save/reopen, pixel-correct PNG/SVG/PDF,
native architecture, resource/license payload and clean uninstall. A failed
control lookup stays a failure. Collect independent platform failures before
repairing the bounded set; retain already authenticated successful installers
instead of recompiling unchanged product bytes.

Failures have distinct owners: zero-step runner acquisition/billing errors
belong to GitHub startup; compiler/SDK failures belong to build setup; missing
native dependencies belong to the test runtime; an incorrect saved/exported
document belongs to product qualification. Do not change E2E expectations for
a job that never started.

Browser setup has its own eight-minute step deadline. Before Playwright asks
APT to install Linux browser dependencies, a final `zz-varve-network-bounds`
configuration sets `Acquire::Retries` to one and HTTP/HTTPS timeouts to 15
seconds, then records the effective values. These browser jobs use Ubuntu x64;
the settings follow the runner image's current x64 policy, not its distinct
ARM64 package-source policy. Configuration ordering matters: an earlier
numbered file can be overridden. Dependency failures remain fatal.

The [runner-image mirror report](https://github.com/actions/runner-images/issues/14594)
describes intermittent Azure mirror stalls before tests, including successful
and stalled jobs on the same revision. Our integration shard 18 showed that
same pattern: browser dependency installation consumed almost 40 minutes and
no E2E case executed. The bounded configuration follows the image's
[APT setup](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt.sh)
and [APT configuration ordering](https://manpages.ubuntu.com/manpages/noble/man5/apt.conf.5.html).
This distinguishes setup outages from product test failures without accepting
an incomplete shard.

Timeouts alone proved insufficient in integration run `37673154574`: four
browser setup steps still exhausted their eight-minute deadlines before any
test executed, and the Linux desktop setup consumed its job deadline. The
shared helper now removes the Azure mirror entry only when the runner already
provides the official HTTPS Ubuntu archive fallback. It preserves the remaining
mirror metadata, sources, suites and signing configuration; an absent fallback
is a fatal error. The browser, Linux compiler and Linux desktop setup steps use
that helper with an eight-minute bound. Ubuntu ARM package sources are outside
this x64 helper's scope.

A real Ubuntu 24.04 container probe fetched and verified 33.2 MB of package
indexes in six seconds using the transformed mirror list. Its missing-fallback
negative control failed as required. Mirror metadata retains the tab separator
required by [APT's mirror-list format](https://manpages.ubuntu.com/manpages/noble/man1/apt-transport-mirror.1.html).
This probe verifies APT behavior; the next exact-revision hosted checkpoint is
still required to establish that every complete CI lane passes.

## Native controls, runtime distribution and visual evidence

Actual macOS WebKit layer names appear as `StaticText.value`, sometimes with
empty label/title. Scope selection to the actual Layers tree and require one
hittable exact label. Number inputs can expose the native Stepper role;
edit with real XCTest pointer/key input. Native file pickers can be Dialog or
Sheet, with final controls scoped to the real picker. These are observed
native contracts, not browser DOM mocks. See [Mac2 attributes](https://appium.github.io/appium-mac2-driver/v4/reference/element-attributes/),
[key/pointer methods](https://appium.github.io/appium-mac2-driver/v4/reference/execute-methods/)
and [Xcode/Accessibility requirements](https://appium.github.io/appium-mac2-driver/v4/getting-started/).

Windows packages use the Evergreen bootstrapper, which chooses the device's
runtime architecture and requires a network connection when WebView2 is
missing. Offline first installation requires an explicitly delivered offline
runtime; the current small installer does not supply it. Current unsigned
Windows/macOS reports require truthful manual-download guidance. Updater
cryptographic signing remains a separate verified capability. See [Microsoft
runtime distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
and [Tauri Windows packaging](https://v2.tauri.app/distribute/windows-installer/).

An upstream [PDF.js issue](https://github.com/mozilla/pdf.js/issues/19145)
reports the same missing native-canvas/DOMMatrix failure pattern. Our early
real renderer probe catches that class of failure; accepting a PDF header
alone would miss a blank/placeholder export and leave users with lost artwork.

Every review must label the application version, source revision, platform
and baseline/current phase before displaying its images. The old-version
upgrade seed is useful migration evidence, never final 0.5.0 visual signoff.
Marketing producer receipts retain their real capture revision and image
hash; promotion does not relabel earlier pixels as a fresh capture. Refresh
affected scenes when visible controls change, and inspect the newly captured
pixels before publication.
