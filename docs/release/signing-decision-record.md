# Varve — Code Signing Decision Record

**Date:** 2026-08-08
**Status:** Decision — implementation shipped certificate-ready; acquisition is
the only remaining step.

This record answers one question: *what is the cheapest production-grade way for
Varve to prove who built each installer, per platform?* It is not a tutorial —
the setup checklist lives in [code-signing-setup.md](code-signing-setup.md).

> **Revalidation rule.** Code-signing rules, vendor names, costs, CA
> requirements, Microsoft/Apple services, and Tauri integration details change
> over time. Everything below carries its source and access date. Revalidate
> before acting on it; treat anything older than ~6 months as suspect.

---

## 0. The four systems that must never be conflated

| System | What it establishes | Varve's tool |
|---|---|---|
| **A. Windows Authenticode** | Publisher identity + file integrity on Windows | Azure Artifact Signing (Public Trust) via Tauri `signCommand` |
| **B. Apple Developer ID + notarization** | Gatekeeper acceptance on macOS | Developer ID Application cert + App Store Connect API key |
| **C. Linux artifact trust** | Integrity + build provenance | SHA-256 checksums + SBOM + GitHub artifact attestations (+ optional GPG later) |
| **D. Tauri updater signing** | Update-manifest authenticity for installed clients | Not in use (see `update-strategy.md`); keys kept separate when it lands |

A `.sig` for the updater is not Authenticode. A checksum is not notarization. A
GitHub attestation is not a trusted Windows publisher. The release pipeline
(`scripts/release/signing-policy.mjs`) treats them as separate systems and the
website never labels one as another.

---

## 1. Windows decision matrix

All prices USD, gathered 2026-08-08.

| Option | Cost | Individual? | Org? | Identity check | CI-friendly | HSM/token | SmartScreen | Renewal | Fits NSIS? |
|---|---|---|---|---|---|---|---|---|---|
| **Azure Artifact Signing (Public Trust)** | ~$9.99/mo Basic, 5,000 sigs/mo; Premium ~$99.99/mo, 100k sigs/mo (azure.microsoft.com/pricing/details/artifact-signing/, JS-rendered; FAQ: no free/trial/sponsored subscriptions) | **Yes** (individual identity validation: government ID with address + FaceCheck via Verified ID) | Yes | Microsoft validates identity; CN is set by Microsoft to the validated legal name — **no custom CN/O allowed** (learn.microsoft.com/en-us/azure/artifact-signing/faq, accessed 2026-08-08) | **Yes** — official Tauri v2 integration via `bundle.windows.signCommand` + `artifact-signing-cli` (v2.tauri.app/distribute/sign/windows/, updated 2026-07-08) | **None** — keys live in FIPS 140-3 L3 HSMs | Valid signature shows verified publisher; SmartScreen reputation builds from download volume — no instant silence (learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation, accessed 2026-08-08) | None — Microsoft rotates certificates; identity validation expires (~yearly, reminders from T-60 days) | **Yes** |
| Conventional OV certificate | ~$150–300/yr typical | Varies by CA (many now require org) | Yes | CA validation | Poor — private key on USB token/HSM; Tauri's built-in path is legacy-only (Tauri docs: built-in `certificateThumbprint` path applies only to OV certs acquired **before 2023-06-01**; newer certs need the CA's own tooling via `signCommand`) | USB token / cloud HSM | Same reputation model as Artifact Signing | Yearly certificate renewal | Yes, via `signCommand` |
| EV certificate | ~$500+/yr | Rarely | Yes | Extended validation | Poor — hardware token mandatory | Yes | **EV no longer bypasses SmartScreen** — "EV certificates may matter for enterprise procurement, but they no longer impact SmartScreen behavior" (Microsoft Learn, accessed 2026-08-08). Do not buy EV for SmartScreen | Yearly | Yes |
| Microsoft Store + MSIX | **$0** | Yes (Individual account; Company needs D-U-N-S/work email on owned domain) | Yes | Government ID + selfie | Medium — MSIX build never produced in this repo; Store submission is a separate workflow | None | **No warning at all** — Store apps are re-signed by Microsoft | N/A | No — requires MSIX packaging, changes install/update model |
| Community/free signing programs | $0 | — | — | — | — | — | — | — | — |

**Verdict: Azure Artifact Signing, Basic SKU, Public Trust.** It is the only
option that combines a genuine Microsoft-trusted publisher identity, no hardware
token, a first-class GitHub Actions story, and the officially documented Tauri
integration. Cost: ~$120/yr. It does **not** promise SmartScreen silence — that
is handled honestly in the docs and on the download page (reputation builds; the
Microsoft Security Intelligence file submission exists for enterprise/managed
use).

**Why not the Microsoft Store as the primary path (yet):** the Store would
eliminate SmartScreen entirely at $0, and remains the documented future option —
but it requires an MSIX package this repo has never built, a Store account with
identity verification, and it changes the installation/update model (Store
updates instead of manual downloads). Artifact Signing keeps today's NSIS
distribution intact. The Store stays on the roadmap; nothing here blocks it.

**Why not EV:** Microsoft's own documentation states EV no longer affects
SmartScreen. Paying a premium for it would be a mistake.

**Auth chain (as of 2026-08-08):** `artifact-signing-cli` 0.11.0 authenticates by
running `az login --service-principal` with a client secret and drives
`signtool` with the `Microsoft.ArtifactSigning.Client` dlib (source audited
2026-08-08: github.com/Levminer/artifact-signing-cli `src/main.rs`). **OIDC /
workload identity federation is not supported by this tool** — a client secret
is required. Mitigations are documented in `ci-secrets.md` §8: rotate the secret,
scope it to a single app registration, grant only the *Artifact Signing
Certificate Profile Signer* role, and store it only in GitHub secrets for the
tag-only release workflow. Re-evaluate OIDC when Microsoft or the CLI supports
it.

---

## 2. macOS decision

Direct DMG distribution requires:

1. **Apple Developer Program membership** — USD $99/yr (developer.apple.com
   support/compare-memberships; no free tier can notarize).
2. **Developer ID Application certificate** (created by the Account Holder; CSR
   from any Mac). `Apple Distribution` is for the App Store — wrong cert type is
   a hard CI failure, and the workflow matches the identity exactly
   (`Developer ID Application:` prefix enforced).
3. **Notarization** — mandatory with Developer ID; done by Tauri when the
   App Store Connect API key env vars are present.
4. **Stapling** — the notarization ticket is stapled into the artifact by Tauri;
   the release pipeline refuses to ship an unstapled DMG.
5. **Hardened runtime** — Tauri enables it by default; the pipeline verifies the
   `runtime` flag in the signature.

**Developer ID Installer certificate is NOT needed** — Varve ships a DMG, not a
`.pkg`. Do not acquire it.

**Blocker to document, not engineer around:** notarization requires Apple
credentials and a real Mac to validate against. There is no legitimate
workaround; the pipeline is fully wired and fails closed until the owner
enrolls.

---

## 3. Linux decision

Linux has no single "code signing certificate". Varve ships AppImage, `.deb`,
`.rpm` from GitHub Releases — no self-hosted APT/RPM repositories, so no
repository-metadata signing exists or is planned (`distribution-decision-matrix.md`
rejected self-hosted repos).

Layered trust, highest-value first:

1. **SHA-256 checksums** (already shipped, generated after all signing).
2. **SBOMs** (CycloneDX, already shipped).
3. **GitHub artifact attestations** on the final verified bytes (added 2026-08-08;
   `gh attestation verify <file> -R K-Arthur/varve`).
4. **GPG/AppImage signing** — evaluated and deferred. Tauri supports it
   (`SIGN=1`, `SIGN_KEY`, `APPIMAGETOOL_SIGN_PASSPHRASE`; v2.tauri.app
   /distribute/sign/linux/), but AppImage **does not verify** embedded
   signatures automatically — users must run an external validate tool against
   a published key fingerprint. Checksums + attestations give users a simpler,
   stronger verification story until a real package repository or Flathub
   exists (Flathub signs and verifies for us).

The download page says "SHA-256 + provenance" for Linux — never "OS-verified
package".

---

## 4. Annual cost estimate (as of 2026-08-08 pricing)

| Item | Year 1 | Year 2+ | Notes |
|---|---|---|---|
| Apple Developer Program | $99 | $99 | Recurring; required for any macOS distribution |
| Azure Artifact Signing Basic | ~$120 | ~$120 | Monthly SKU (5,000 sigs/mo — Varve uses a handful) |
| Azure subscription hosting | $0–~$5/mo | same | Pay-as-you-go subscription; the Artifact Signing account is the only paid resource. A free/trial subscription is ineligible |
| GitHub | $0 | $0 | Public repo |
| **Total** | **~$219–279/yr** | **~$219–279/yr** | Renewal burden: none for certificates (managed); identity validation + Apple membership are the recurring human tasks |

Compare: EV (~$500+/yr) buys nothing SmartScreen-relevant. The Microsoft Store
path ($0) remains viable later but costs integration time.

---

## 5. What was ruled out, and why

| Option | Why rejected |
|---|---|
| EV certificate | Microsoft: EV no longer bypasses SmartScreen. Hardware token + cost for no benefit |
| Conventional OV | Hardware-token friction, CA-specific tooling, no advantage over Artifact Signing |
| Microsoft Store primary | No MSIX build exists; changes install/update model; identity verification is a human step regardless. Kept as future option |
| Mac App Store | Sandbox conflicts with arbitrary-path documents, printing (`lp`/`lpstat`), fonts — see `distribution-decision-matrix.md` §4 |
| Self-hosted apt/rpm repos | No repo exists; GPG repo signing would be pure overhead |
| Free community signing programs | Eligibility (license/source-availability/governance/age/release-history/build-reproducibility) not established; license stays FSL-1.1-MIT regardless |
| Tauri updater signing keys | No updater (see `update-strategy.md`); keys are created only when the updater lands, and are stored/backed-up separately from Apple/Windows material |

---

## 6. Sources (all accessed 2026-08-08)

- Tauri v2: https://v2.tauri.app/distribute/sign/windows/ (updated 2026-07-08),
  https://v2.tauri.app/distribute/sign/macos/ (updated 2026-05-17),
  https://v2.tauri.app/distribute/sign/linux/ (updated 2025-02-22)
- Microsoft Learn — Artifact Signing overview + FAQ:
  https://learn.microsoft.com/en-us/azure/artifact-signing/overview,
  https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- Microsoft pricing: https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
  (dollar figures are JS-rendered; FAQ confirms free/trial/sponsored
  subscriptions are ineligible)
- Microsoft Learn — SmartScreen reputation:
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
  (updated 2026-05-04)
- Apple: https://developer.apple.com/support/compare-memberships/
- GitHub: artifact attestations —
  https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds
- `artifact-signing-cli` source (auth chain): https://github.com/Levminer/artifact-signing-cli
  (main.rs, audited 2026-08-08), crates.io `artifact-signing-cli` 0.11.0
- Microsoft Store developer account onboarding:
  https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account
