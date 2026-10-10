# Microsoft Store MSIX packaging

This directory is the Store/MSIX layout for the Windows Tauri app. Tauri 2
does not emit MSIX; CI stages the release binary and packs it with `makeappx`
(Windows SDK) or Microsoft's `winapp pack` when that CLI is installed.

Identity values that Partner Center assigns are **not** committed. Fill them
from Partner Center, or set the GitHub Actions variables of the same names,
before a Store submission.

| Field | Variable | Source |
|---|---|---|
| `Identity.Name` | `VARVE_STORE_PACKAGE_NAME` | Partner Center → Product identity |
| `Identity.Publisher` | `VARVE_STORE_PUBLISHER_CN` | Partner Center → Product identity (`CN=…`) |
| `PublisherDisplayName` | `VARVE_STORE_PUBLISHER_DISPLAY_NAME` | Intended value: `Varve`. Confirm an individual account can use it. |

`identity.json` keeps those slots empty on purpose. CI without the Partner
Center variables builds a **test identity** package (`Varve.Desktop.CI` /
`CN=Varve CI Test`) that is explicitly not Store-submittable.

See [docs/distribution/microsoft-store.md](../../docs/distribution/microsoft-store.md).
