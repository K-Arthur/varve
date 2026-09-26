# Plugin system evidence ledger — 2026-09-25

Baseline revision: `042508de`. The repository pins Tauri 2.11.5 in Cargo.lock
and `@tauri-apps/api` 2.11.1 in pnpm-lock.yaml. Online documents below were
checked on 2026-09-25; their latest text still needs packaged-runtime proof
against those pinned versions.

| Evidence | Requirement or observed problem | Varve mitigation and acceptance test |
| --- | --- | --- |
| [Figma execution model](https://developers.figma.com/docs/plugins/how-plugins-run/) and [manifest](https://developers.figma.com/docs/plugins/manifest/) | Logic and UI have separate capabilities; a visible running/cancel route, API compatibility, and network declarations matter. | Keep guest logic separate from host UI, validate API/entry before install, and test visible Stop on a runaway job. Do not claim Figma API compatibility. |
| [Figma network requests](https://developers.figma.com/docs/plugins/making-network-requests/) | Network allowlists have iframe/subresource limits. | V1 has no network import or arbitrary HTML. Probe direct and indirect egress in native WebViews before adding either. |
| [VS Code extension host](https://code.visualstudio.com/api/advanced-topics/extension-host), [runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security), and [webviews](https://code.visualstudio.com/api/extension-guides/webview) | Desktop extensions can inherit broad OS access; webviews need CSP and resource limits. | Do not load external JS in the main WebView or claim a Worker alone is a sandbox. Verify the Wasm import table and host bridge. |
| [Tauri 2 capabilities](https://v2.tauri.app/security/capabilities/) | Capabilities combine on one window; custom commands are broadly reachable unless configured; Linux embedded-frame IPC is not separable. | Keep plugins out of host/iframe realms. Test forged native-command attempts in packaged WebKitGTK, and audit custom commands independently. |
| [MDN Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) | Workers can use network/storage APIs but `terminate()` stops their thread. | Guest is Wasm with no relevant imports; test tight-loop Stop and each egress route rather than relying on Worker separation. |
| [Adobe UXP modal execution](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal) and [developer cancellation complaint, 2025-03-23](https://community.adobe.com/questions-712/abort-processing-in-a-non-modal-state-for-uxp-plugins-1177644) | A developer reported inaccessible in-panel cancellation for long processing. Adobe does have Escape/progress cancellation; tight synchronous work remains hard to interrupt. | Keep host-owned Stop visible; terminate a blocked guest and verify no partial edit/history entry. The complaint is UX evidence, not proof Adobe lacks cancellation. |
| [Adobe missing plugin discussion, 2023-01-10](https://community.adobe.com/questions-712/plugin-vanished-from-photoshop-despite-uxp-developer-tool-saying-it-loaded-successfully-1148726) | The reported “loaded but vanished” plugin was found under Plugins rather than Window. | An installed card must show exact Run/Open routes even when no selection applies. Test discovery after restart. This was navigation confusion, not a proven load failure. |
| [Photoshop blank panel discussion, 2025-07-01](https://community.adobe.com/questions-712/uxp-plugin-panel-loads-empty-html-in-photoshop-26-8-1-despite-manual-dom-injection-working-1181050) | Author resolved a blank panel by changing an unsupported manifest version. | Reject incompatible API before activation and distinguish ready runtime from rendered UI. |
| [VS Code restricted-workspace report, 2025-02-15](https://github.com/microsoft/vscode/issues/240856) and [marketplace lifecycle docs](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace) | Commands can disappear when an extension is disabled; users interpret it as breakage. Manager keeps disabled extensions visible. | Keep every installed plugin discoverable with an actionable reason, and leave optional-denial-safe commands available. |
| [VS Code update webview report, 2026-07-14](https://github.com/microsoft/vscode/issues/325767) | Reporter traced a blank panel after update to stale asset paths; maintainer resolution was not established when checked. | Version all package bytes, tear down the old generation, and test update/restart. Treat causal account as unconfirmed. |
| [VS Code keybinding guidance](https://github.com/microsoft/vscode/wiki/Keybinding-Issues) and [publisher prompt complaint, 2025-02-10](https://github.com/microsoft/vscode/issues/240283) | Extension keys can shadow editor/text input; repeated generic trust prompts invite blind clicking. | Do not grant v1 plugin shortcuts. Show a concise access diff only when installing/updating/granting. |
| [VS Code disabled extension report, 2025-10](https://github.com/microsoft/vscode/issues/270982) | A disabled extension still prompted activation in one workspace; linked fix later verified. | Test disabled preference across restart/document/workspace changes and reject queued runs by generation. |
| [Adobe settings disappearance discussion, 2023-01-04](https://community.adobe.com/questions-712/installation-of-ps-24-1-does-not-inherit-previous-versions-settings-1149493) | Reporter ultimately attributed a missing-settings case to relocated AppData; another machine worked. | Test alternate profile paths and recovery. Do not generalize this as an Adobe migration defect. |

## Repository observations and reproduction status

| Finding at baseline | Evidence | Status |
| --- | --- | --- |
| No package installer, SDK, or manager path | No production `registerPlugin` caller; native `list_plugins` returns `[]` | Static trace |
| In-process callback is not confined | `pluginSections.ts` stores `render` and `predicate`; `InspectorPluginSections.tsx` invokes them in React | Static trace |
| Empty `modes` contradicts “all modes” comment | `isContributionAvailable` checks `!modes.includes` even for `[]` | Unit regression needed |
| Deprecated target-tab mapping is not used | `getContributionsForTab` compares strings exactly; only Properties mounts a plugin host | Static trace |
| Manifest lacks owner/ID/semver/duplicate validation | `registerPlugin` stores caller object directly | Unit regression needed |
| Error route loses recovery surface | `markPluginError` removes all active contributions, including failed section | Existing unit test confirms removal; UI recovery route needed |
| Disable removes only sections | Registry has no command/worker ownership | Static trace; lifecycle test needed |

The two Inspector unit files passed 30/30 at baseline. They use in-process
test callbacks and establish no package, permission, or native isolation
behavior. No baseline manager screenshot exists because there is no manager
to open. Other ongoing checkout changes at this revision are unrelated and
remain outside this audit.
