# Varve — Code Signing Setup (human checklist)

**Date:** 2026-08-08
**Scope:** everything a human must do — payment, identity verification, legal
agreements, certificate issuance — to make the release pipeline actually sign.
The repository and CI are already certificate-ready; this checklist is the only
remaining blocker.

**Nothing in this document contains secrets.** Certificate material, API keys
and passwords are stored only in GitHub secrets, Azure Key Vault / Artifact
Signing, or offline backups.

Decision context: [signing-decision-record.md](signing-decision-record.md).
Runtime procedures: [signing-rotation-runbook.md](signing-rotation-runbook.md),
[signing-incident-runbook.md](signing-incident-runbook.md).

---

## Part A — HUMAN ACTIONS

### A.0 Preflight reading (10 minutes)

- [ ] Read `signing-decision-record.md` §1 (Windows), §2 (macOS), §3 (Linux)
- [ ] Decide the **publisher identity** that will appear on certificates:
      Microsoft sets the CN to your **validated legal name** — you cannot use
      "Varve" or "K-Arthur" as the certificate subject. Document what users
      will actually see (your legal name), because the installer UAC prompt and
      the download page will show it.
- [ ] Decide **individual vs organization** enrolment per platform:
      - Windows Artifact Signing supports individual identity validation
        (government ID + FaceCheck via Verified ID).
      - Apple Developer Program: individual enrolment is normal for a solo
        developer; the certificate carries the legal name.
      - The Microsoft Store (future) needs Individual or Company — Company
        requires a D-U-N-S or business documents + a work email on a domain you
        own.

### A.1 Apple Developer Program (USD $99/yr)

- [ ] Create an Apple ID and enrol at https://developer.apple.com/programs/enroll/
      (payment + legal agreement + identity verification)
- [ ] Confirm membership is **paid** (free tier cannot notarize)
- [ ] Find your **Team ID**: https://developer.apple.com/account → Membership
      Details (10-character ID)

**Certificate issuance (needs a Mac — borrow, rent, or buy one):**

- [ ] From a Mac, create a CSR:
      Keychain Access → Certificate Assistant → Request a Certificate from a
      Certificate Authority (name = your legal name, email = your Apple ID,
      save to disk)
- [ ] https://developer.apple.com/account/resources/certificates/list →
      Create a certificate → **Developer ID Application** (NOT "Apple
      Distribution", NOT "Apple Development")
- [ ] Download the `.cer`, install into the login keychain
- [ ] Export the certificate + private key as a `.p12`:
      Keychain Access → My Certificates → right-click the key →
      Export → **strong, unique password** (record it in a password manager,
      never in the repo)
- [ ] Base64-encode the `.p12` for CI:
      `openssl base64 -A -in DevID.p12 -out DevID-base64.txt`
- [ ] Note the exact signing identity string:
      `security find-identity -v -p codesigning`
      → `Developer ID Application: <Legal Name> (TEAMID)`

**App Store Connect API key (preferred over Apple ID + app-specific password):**

- [ ] https://appstoreconnect.apple.com/access/users → Integrations → Add →
      name it (e.g. `varve-ci`), grant **Developer** access
- [ ] Record the **Issuer ID** and the **Key ID**
- [ ] Download the `.p8` file **once** (it cannot be re-downloaded)
- [ ] Base64-encode it: `base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n'`

**Offline backup (do this before configuring anything):**

- [ ] Copy the `.p12` + password + `.p8` to two physical media in different
      locations (e.g. an encrypted USB drive and a printed/dark-safe record of
      the password). These are the only copies that survive losing the Mac.

### A.2 Azure Artifact Signing, Public Trust (~$9.99/mo + paid Azure subscription)

Microsoft's current onboarding: https://learn.microsoft.com/en-us/azure/artifact-signing/
(quickstart: register the `Microsoft.CodeSigning` resource provider → create a
paid subscription resource group → create the account → identity validation →
certificate profile).

- [ ] Ensure a **paid** Azure subscription (pay-as-you-go or EA). Free, trial
      and sponsored subscriptions are rejected by the service
- [ ] Register the `Microsoft.CodeSigning` resource provider on the
      subscription
- [ ] Create the **Artifact Signing account** (Basic SKU) in a resource group
- [ ] **Identity validation** → choose **Individual** (or Organization):
      - Individual: email verification + Microsoft Authenticator **Verified
        ID** + government-issued ID with your address + FaceCheck. The email
        used must match your Azure sign-in email
      - Expect up to days/weeks for validation; reminders arrive from 60 days
        before expiry
- [ ] Create a **Public Trust certificate profile** (name it e.g.
      `varve-public-trust`); 3-year certificates with automatic renewal are
      standard
- [ ] Record the regional **endpoint** for your account, e.g.
      `https://wus2.codesigning.azure.net` (see your account overview)

**Service principal + role (the identity CI will use):**

- [ ] Register an app in Microsoft Entra ID
      (https://portal.azure.com → Microsoft Entra ID → App registrations)
- [ ] Create a **client secret** (at least 24 months validity), record its
      value — it is shown once
- [ ] Assign the app the **Artifact Signing Certificate Profile Signer** role
      on the certificate profile (Access control (IAM)). Nothing more.
- [ ] Record: Tenant ID, Client (application) ID, Client secret, Account name,
      Profile name, Endpoint

### A.3 GitHub configuration

- [ ] Create the `release-publish` environment (Settings → Environments):
      **Required reviewers** = yourself. Without reviewers the `publish` job's
      approval gate is decorative
- [ ] (Recommended) restrict the environment's deployment branches/tags to
      `v*`
- [ ] Add secrets and variables — full table in `ci-secrets.md` §2–§5:
      secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
      `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`,
      `APPLE_API_KEY_P8_BASE64`, `AZURE_SIGNING_CLIENT_ID`,
      `AZURE_SIGNING_CLIENT_SECRET`, `AZURE_SIGNING_TENANT_ID`; variables
      `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`,
      `AZURE_SIGNING_ENDPOINT`
- [ ] Set variable `RELEASE_EXPECT_SIGNED=true` before the first stable release

### A.4 Verification drive (after certificates exist)

- [ ] Tag a prerelease and confirm `signing-preflight` resolves
      `windows: signed, macos: signed`
- [ ] On the Windows bundle job, confirm the NSIS installer is signed and
      `signing-report-windows.json` says `verification: valid`
- [ ] On the macOS bundle job, confirm the DMG is signed, notarized AND
      stapled; `signing-report-macos.json` shows all three true
- [ ] Confirm `release-manifest.json`'s `signing` block matches the reports
- [ ] On a clean Windows machine: download the installer, check UAC shows the
      verified publisher, install, launch, uninstall
- [ ] On a clean Mac: download the DMG, mount, launch — **no** Gatekeeper
      override should be needed; check `spctl -a -vv -t exec Varve.app`
- [ ] Publish the release, then check the website download page shows the
      verified trust labels derived from the manifest

---

## Part B — AUTOMATED / REPOSITORY ACTIONS

Already implemented (nothing to do):

- [x] `signing-preflight` job fails the release BEFORE any build when a
      platform that requires signing has no credentials
- [x] Windows: Tauri `signCommand` wired to `artifact-signing-cli`
      (pinned 0.11.0), credentials via env, config merged from variables
- [x] macOS: temporary-keychain import (exact `Developer ID Application`
      identity enforced), notarization + stapling via App Store Connect API
      credentials
- [x] Post-build cryptographic verification on the exact uploaded bytes
      (`verify-windows-signature.ps1`, `verify-macos-signature.sh`)
- [x] Fail-closed trust gate (`verify-release-trust.mjs`) before checksums,
      attestation and draft creation
- [x] Signing state in `release-manifest.json` derived from reports, never
      from secret presence
- [x] GitHub artifact attestations on final bytes
- [x] Checksums generated after signing; uploaded bytes re-verified
- [x] Docs: decision record, rotation runbook, incident runbook, this checklist

---

## Part C — CHECKLIST TO TICK

- [ ] Apple Developer Program paid membership active
- [ ] Developer ID Application certificate issued and exported as `.p12`
- [ ] `.p12` + password + `.p8` backed up offline (two locations)
- [ ] App Store Connect API key created (Developer role), `.p8` saved
- [ ] Team ID / Issuer ID / Key ID recorded
- [ ] Paid Azure subscription confirmed
- [ ] Artifact Signing account (Basic) + identity validation completed
- [ ] Public Trust certificate profile created
- [ ] App registration + client secret created; Certificate Profile Signer
      role assigned
- [ ] Tenant ID / Client ID / secret / account / profile / endpoint recorded
- [ ] GitHub `release-publish` environment with required reviewers
- [ ] All secrets and variables from `ci-secrets.md` §2–§5 configured
- [ ] `RELEASE_EXPECT_SIGNED=true` set
- [ ] Prerelease run: both platforms verify signed/notarized/stapled
- [ ] Clean-machine install/launch verification on Windows and macOS
- [ ] Website download page shows verified trust labels
