# winget package identity

The intended Windows Package Manager Community Repository ID is
**`VarveStudio.Varve`**.

That replaces the earlier planned ID `K-Arthur.Varve`. Manifests, if and when
they are submitted, belong under:

```
manifests/v/VarveStudio/Varve/<version>/
```

Nothing in this directory is a live winget submission. The website and
download docs mention `winget install VarveStudio.Varve` only when the
`WINGET_LIVE` flag is turned on after the community repository accepts the
package.

Human steps (not done by this repository):

1. Fork `microsoft/winget-pkgs`.
2. Add the YAML manifest trio (version, installer, locale) pointing at the
   published NSIS `.exe` URLs and SHA-256 from `SHA256SUMS.txt`.
3. Open a PR. Do not publish from CI.

The Microsoft Store MSIX path is separate: Store installs are not the winget
NSIS installer, and Microsoft Store signing does not apply to the GitHub
`.exe`.
