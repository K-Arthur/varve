# Varve — Signing Credential Compromise / Revocation Runbook

**Date:** 2026-08-08

A compromised signing identity lets an attacker produce malware that appears to
come from Varve. This runbook assumes the worst and moves fast. Read it BEFORE
an incident; the first three steps are minutes, not hours.

Companion documents: [signing-rotation-runbook.md](signing-rotation-runbook.md),
[code-signing-setup.md](code-signing-setup.md).

---

## 1. Escalation matrix — what counts as an incident

| Event | Severity | Immediate action |
|---|---|---|
| Apple `.p12` / password leaked (log, chat, fork, paste) | **Critical** | Revoke cert at Apple; rotate immediately |
| App Store Connect API key leaked | **Critical** | Revoke key in App Store Connect |
| Azure client secret leaked | **Critical** | Delete secret; create new one |
| Tauri updater private key leaked | **Critical** | Treat every update ever signed as suspect |
| GitHub secrets exposed (e.g. step summary echo, artifact upload) | **Critical** | Rotate the affected secret; treat logs as public |
| Suspicious signed artifacts on the release | **Critical** | Suspend publication; investigate |
| Identity validation/cert expiry | Medium | Normal rotation path, not an incident |

---

## 2. Incident procedure

### Phase 1 — Stop the bleeding (0–15 minutes)

1. [ ] **Stop the release workflow**: set `concurrency` group aside — the
       release workflow runs only on tags, so the fastest stop is to protect
       the tag: GitHub → Settings → Tags → add a rule that blocks new tags
       (or delete/re-protect the release tag being built). If a draft exists,
       do not publish it.
2. [ ] **Disable the signing environment**: remove the compromised GitHub
       secrets (or blank them) so no new run can obtain credentials. If a
       `production-signing` environment exists, remove its secrets and add
       required reviewers.
3. [ ] **Revoke the compromised credential**:
       - Apple certificate: Apple Developer → Certificates → Revoke. Revoked
         certificates stop verifying for new downloads.
       - App Store Connect key: delete it in Integrations.
       - Azure client secret: delete in the app registration; rotate the
         service principal identity only if the principal itself is suspect.
       - GitHub secrets: delete and re-create with new values.
4. [ ] **Rotate the identity** (see rotation runbook §3) and verify one
       signed prerelease before anything else ships.

### Phase 2 — Scope the blast radius (15–60 minutes)

5. [ ] List every release whose artifacts could have been signed with the
       compromised identity (GitHub → Releases; filter by date range).
6. [ ] For each affected release, record the published hashes from
       `SHA256SUMS.txt` BEFORE touching anything.
7. [ ] Check GitHub audit log (Settings → Security log) for repository
       access, environment approvals and secret updates around the exposure
       window.
8. [ ] Check whether the private key material ever reached a fork or a
       `pull_request` context: the release workflow never runs on PRs, but a
       leaked secret in a fork's settings would not appear here — ask the
       maintainer to check their fork settings if any exist.

### Phase 3 — Remediation (hours–days)

9. [ ] **Mark/revoke affected artifacts**: you cannot un-sign a file. For a
       revoked Apple/Windows certificate, signatures stop validating for new
       machines. Publish an advisory (GitHub Security Advisories) naming the
       affected versions and the **good hashes** so users can check.
10. [ ] **Re-sign and re-release** current versions with the new identity.
11. [ ] **Notify users**: release notes + advisory must say "verify the
        signature shows the new publisher/team before running", not just
        "update".
12. [ ] **Regenerate/update trust configuration**: new GitHub secrets, new
        `RELEASE_EXPECT_SIGNED` verification, new website trust labels derived
        from the new reports.
13. [ ] **Verify the new pipeline end-to-end** with a prerelease before the
        next stable.

### Phase 4 — Post-mortem (1 week)

14. [ ] Write the incident record: how the credential left its intended
        storage; which control failed (secret scanning? artifact upload? a
        log?); what changes prevent recurrence (e.g. environment-scoped
        secrets, `production-signing` environment with required reviewers).
15. [ ] Add regression tests for the failure mode if the pipeline can catch it.

---

## 3. The "how did this happen" checklist

- Was a secret echoed in a workflow step? (Never echo; the pipeline prints
  presence booleans only.)
- Was a `.p12`/`.p8` uploaded as a workflow artifact?
- Was a secret passed as a command-line argument? (Arguments appear in process
  listings.)
- Did a third-party action or downloaded tool receive secrets?
- Did anyone copy a secret into a chat, paste, issue, or fork?
- Did the GitHub Actions secrets get exposed via `pull_request_target`? (Varve
  has no such trigger in release.yml — verify any new workflow keeps it that
  way; `scripts/validate-workflows.mjs` enforces it.)

---

## 4. User-facing guidance template (advisory)

```
Affected versions: <versions>
What happened: <one paragraph>
What to do:
  1. Do not run artifacts signed with the old identity.
  2. Compare hashes: <good SHA256SUMS.txt link>.
  3. Install the new release <link> and verify the signature shows
     <new publisher / new Team ID>.
  4. Where you cannot verify, treat the download as untrusted.
```

---

## 5. Why this is not over-engineered

Signing credentials are the one secret class whose compromise is
indistinguishable from Varve itself: an attacker who can sign can make Windows
and macOS trust their malware under Varve's name. The revocation paths above
are deliberately exercised in the rotation runbook once a year (revoke a test
key, watch the verification reports fail, re-issue).
