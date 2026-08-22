# Updater Signing Repair

Root cause, verification, and exact steps to restore Linux AppImage auto-updates.

## Root Cause

`release.yml` pipeline order:

1. `pnpm tauri build` signs the AppImage → produces `.AppImage.sig` over original bytes
2. `prune-appimage-bundled-libs.mjs` replaces the AppImage via linuxdeploy reassembly
3. `collect-artifacts.mjs` ships the stale `.sig` alongside the modified artifact

The Windows NSIS installer is never pruned, so its signature remains valid.
Linux AppImage and aarch64 AppImage are both affected.

## Verification

```bash
# Download the live feed and the AppImage
curl -s https://varve.studio/updates/stable.json > /tmp/feed.json
gh release download v0.2.0 --repo K-Arthur/varve --pattern "Varve-0.2.0-linux-x86_64.AppImage"

# Run the regression gate (will FAIL for v0.2.0 AppImage)
node scripts/release/verify-updater-feed-signatures.mjs \
  --feed /tmp/feed.json \
  --release-dir . \
  --tauri-conf apps/desktop/src-tauri/tauri.conf.json
```

Expected: `PASS windows-x86_64`, `FAIL linux-x86_64: inner Ed25519 signature invalid`.

## Pipeline Fix

A re-sign step has been added to `release.yml` between "Prune bundled libraries
from AppImage" and "Verify native executable architecture". It calls
`pnpm tauri signer sign` on the pruned AppImage, producing a fresh `.sig` that
matches the final artifact bytes.

## Restoring v0.2.0 Linux AppImage Auto-Updates

Without rebuilding the AppImage, re-sign the current published artifact:

### 1. Download the current AppImage

```bash
gh release download v0.2.0 --repo K-Arthur/varve \
  --pattern "Varve-0.2.0-linux-x86_64.AppImage"
```

### 2. Re-sign with the Tauri updater key

```bash
# Requires TAURI_SIGNING_PRIVATE_KEY in your environment
# (same secret used by the release workflow)
pnpm tauri signer sign Varve-0.2.0-linux-x86_64.AppImage \
  --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
```

This produces `Varve-0.2.0-linux-x86_64.AppImage.sig` over the current bytes.

### 3. Verify the new signature locally

```bash
# Create a minimal feed pointing at local file
cat > /tmp/verify-feed.json <<EOF
{
  "version": "0.2.0",
  "platforms": {
    "linux-x86_64": {
      "url": "file://$(pwd)/Varve-0.2.0-linux-x86_64.AppImage",
      "signature": "$(cat Varve-0.2.0-linux-x86_64.AppImage.sig)"
    }
  }
}
EOF

node scripts/release/verify-updater-feed-signatures.mjs \
  --feed /tmp/verify-feed.json \
  --release-dir . \
  --tauri-conf apps/desktop/src-tauri/tauri.conf.json
```

Expected: `PASS linux-x86_64`.

### 4. Replace the .sig asset on GitHub

```bash
gh release upload v0.2.0 --repo K-Arthur/varve \
  "Varve-0.2.0-linux-x86_64.AppImage.sig" --clobber
```

### 5. Regenerate the updater feed

```bash
node scripts/release/generate-updater-feed.mjs \
  --dir . \
  --version 0.2.0 \
  --channel stable \
  --base-url "https://github.com/K-Arthur/varve/releases/download/v0.2.0"
```

This writes `varve-update-stable.json` to the current directory (or `--out`).

### 6. Deploy the feed to the website

Copy the regenerated `varve-update-stable.json` to:
```
apps/website/public/updates/stable.json
```

Then deploy the website (push to `master` triggers the deploy workflow).

### 7. Verify

```bash
# Re-run the gate
node scripts/release/verify-updater-feed-signatures.mjs \
  --dir apps/website/public/updates \
  --tauri-conf apps/desktop/src-tauri/tauri.conf.json

# Confirm live feed serves correct signatures
curl -s https://varve.studio/updates/stable.json | node -e "
  const d=require('fs').readFileSync('/dev/stdin','utf8');
  console.log(JSON.parse(d).platforms['linux-x86_64'] ? 'AppImage entry present' : 'MISSING');
"
```

## What Requires Private Keys

- **Re-signing artifacts**: needs `TAURI_SIGNING_PRIVATE_KEY` (GitHub Secret)
- **All other steps**: no secrets needed (public verification, feed generation, website deploy)

## Prevention

The regression gate (`verify-updater-feed-signatures.mjs`) now runs in
`release.yml` after feed generation. It verifies every feed entry's
cryptographic signature against the embedded pubkey and the on-disk
artifacts before the release can proceed. Any future pipeline step that
modifies an artifact after signing will be caught at CI time.
