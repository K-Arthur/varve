# Varve — Signing Key / Certificate Rotation Runbook

**Date:** 2026-08-08
**Applies to:** Azure Artifact Signing (Windows), Apple Developer ID (macOS),
App Store Connect API key, and (when it lands) the Tauri updater minisign key.

The goal of this runbook is simple: **a certificate or credential must never
expire mid-release.** Everything here is calendar work, not incident work —
incidents are handled by [signing-incident-runbook.md](signing-incident-runbook.md).

---

## 1. The calendar (add these to the maintainer's calendar)

### 1.1 Apple Developer Program membership — renews annually

- [ ] **T-90 days:** confirm the renewal card/Apple ID is valid. Membership
      lapse = signing stops instantly, and existing Developer ID signatures
      keep working but new builds cannot be notarized
- [ ] **T-30 days:** renew at https://developer.apple.com/account

### 1.2 Developer ID Application certificate — ~3-year lifetime, non-renewable in place

Developer ID certificates cannot be renewed — they must be **re-issued**.

- [ ] **T-120 days:** open Keychain Access → My Certificates → check the
      Developer ID certificate's expiry
- [ ] **T-90 days:** create the replacement (same procedure as the original:
      CSR → Developer ID Application → download → install → export `.p12`)
- [ ] **T-60 days:** update the `APPLE_CERTIFICATE` /
      `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` GitHub secrets
- [ ] **T-30 days:** run one signed prerelease on the new identity and verify
      `signing-report-macos.json` (publisher should show the same legal name;
      Team ID unchanged)
- [ ] After the first successful signed release on the new certificate, retire
      the old `.p12` from CI and offline storage (keep a copy until any
      outstanding signed releases' timestamps are past the old cert's expiry —
      timestamps preserve validity, but do not rely on it)

> Because all signatures are timestamped, **old releases remain verifiable
> after the certificate expires** — expiry only blocks new signing.

### 1.3 App Store Connect API key (`.p8`) — revocable; no fixed expiry

- [ ] **Every 6 months:** verify the key still exists in
      App Store Connect → Users and Access → Integrations
- [ ] **Every 12 months (or on suspicion):** rotate — create a new key,
      update `APPLE_API_KEY` / `APPLE_API_KEY_P8_BASE64`, run one notarized
      prerelease, then revoke the old key
- [ ] If a key is ever uploaded to a chat log, a public paste, or a fork's CI:
      revoke it immediately and rotate (see incident runbook)

### 1.4 Azure Artifact Signing

- [ ] **Identity validation expiry:** Microsoft emails reminders from
      **T-60 days**. Renewal requires the same identity-validation flow
      (Verified ID / FaceCheck / documents). Signing **stops** when validation
      expires — calendar it the day the reminder arrives
- [ ] **Certificate profile:** Microsoft manages certificates (FIPS HSM,
      automatic rotation). Nothing to renew — verify quarterly that the profile
      is still `Active` and that a test signature works
- [ ] **Azure subscription / billing:** confirm the card on the subscription
      stays valid; a billing block stops signing with no warning
- [ ] **Client secret:** create with max validity; set a calendar reminder for
      **T-60 days before its listed expiry**. Rotation: create new secret →
      update `AZURE_SIGNING_CLIENT_SECRET` → verify one signed run → delete old
      secret after 30 days
- [ ] **Quarterly smoke:** run one signed Windows build outside a release
      window (or the next prerelease) and confirm
      `signing-report-windows.json` shows `verification: valid`

### 1.5 Tauri updater minisign key

- [ ] Private key offline backup in two locations; CI copy in
      `TAURI_SIGNING_PRIVATE_KEY`; rotation is a two-release operation (old key
      signs a release embedding the new public key first). Losing the private
      key permanently blocks updates for all installed clients

---

## 2. The 90/60/30/7 drill (any expiring credential)

| Horizon | Action |
|---|---|
| **T-90 days** | Identify the expiring item (membership / cert / validation / secret); open a tracking issue; gather replacement materials |
| **T-60 days** | Issue/renew the replacement (Apple cert re-issue, Azure identity validation, new client secret); update GitHub secrets/variables |
| **T-30 days** | Run a full signed prerelease on the new material; confirm all three reports (windows valid, macos signed+notarized+stapled) and the manifest `signing` block |
| **T-7 days** | If the replacement is still not live: **stop tagging stable releases**. The `signing-preflight` gate fails them anyway — do not let that be how you find out |

---

## 3. Rotation procedure (full, step by step)

1. Prepare the replacement material (per platform above).
2. Update GitHub secrets/variables (`ci-secrets.md` §2–§5 for the names).
3. Trigger a **prerelease** (never a stable) and wait for the draft.
4. Verify:
   - `signing-preflight` resolves `signed` for the platforms involved;
   - `signing-report-*.json` files show valid verification;
   - `release-manifest.json` `signing` block reflects it;
   - the draft's checksums re-verify after download (`verify-downloaded`).
5. Publish, and delete the draft only after everything above passes.
6. Retire the old material: delete old secrets, revoke old API keys, archive
   old `.p12` copies per the Apple section above.

---

## 4. What NOT to do

- Never store the `.p12`/`.p8`/client secret in the repository, an artifact
  upload, a step summary, or a chat.
- Never sign with the wrong certificate type (Apple Development / Distribution
  for a Developer ID path) — the workflow refuses these, do not work around it.
- Never skip the verification step "because the build exited 0".
- Never wait for the CI to fail before renewing.
