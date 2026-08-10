# CLA Administration Guide — Maintainer Reference

> **Status note (2026-07-25):** This guide describes the *intended* CLA
> operations once the infrastructure below is actually built. As of this
> writing, `.github/workflows/cla.yml`, `.github/pull_request_template.md`,
> and `.github/ISSUE_TEMPLATE/` do not exist in the repository, and Varve
> is not currently accepting external contributions. Treat this document as
> a reference for future setup, not a description of an active system.

This document covers the operational procedures for managing the Varve
Contributor Licence Agreement system. It is intended for the project owner
and any future maintainers.

---

## How the CLA System Works

The CLA workflow uses the **CLA Assistant GitHub Action** to:

1. Detect new pull requests from contributors who have not yet signed.
2. Post a comment with instructions and a signing link.
3. Verify the signature via a signed commit to the signature storage branch.
4. Update the PR status check to `success` or `failure`.
5. Lock the PR conversation after merge (to prevent signature tampering).

Signature data is stored in a JSON file (`signatures/version1/cla.json`)
on a dedicated `_clasignatures` branch in the same repository. This keeps
all records version-controlled, auditable, and independent of any external
service.

## Setup

### First-time setup (one-time per repository)

1. Ensure the `.github/workflows/cla.yml` workflow file is present.

2. Ensure the signature storage branch is created.
   The workflow will create it automatically on first run, but you can
   pre-create it:
   ```bash
   git checkout --orphan _clasignatures
   git reset --hard
   git commit --allow-empty -m "Initialise CLA signature storage"
   git push origin _clasignatures
   ```

3. Store the CLA documents in the repository:
   - `CLA.md` — overview and FAQ
   - `ICLA.md` — Individual CLA (draft for legal review)
   - `CCLA.md` — Corporate CLA (draft for legal review)

4. Verify the `path-to-document` input in `cla.yml` points to the correct
   document URL (it should reference `ICLA.md` in the repository).

5. Configure branch protection:
   - **Settings → Branches → Add rule** for `master`
   - Require status checks before merging
   - Add `CLA Assistant` as a required check
   - Require pull request reviews
   - Require signed commits (for DCO enforcement)

6. If the repository transitions to a GitHub organisation, migrate the
   CLA setup (see "Organisation Migration" below).

### Verify the workflow is working

1. Fork the repository (or use a test account).
2. Open a pull request with a trivial change.
3. Confirm the CLA Assistant bot:
   - Posts a comment within ~30 seconds
   - Shows a failing status check
4. Sign the CLA by posting the signing comment.
5. Confirm the status check transitions to passing.

## Daily Operations

### Accepting a new individual signatory

The workflow handles this automatically. When a new contributor signs:

1. A commit is added to the `_clasignatures` branch recording the
   signature with metadata (GitHub username, timestamp, agreement version).
2. The PR status check transitions to `success`.
3. Subsequent PRs from the same contributor skip the signing prompt.

No manual action needed.

### Accepting a new corporate signatory

Corporate CLAs require manual steps:

1. The corporation's authorised officer contacts you to initiate signing.
2. Provide the current `CCLA.md` and request a signed copy.
3. Verify the signatory's authority (check company domain, role, etc.).
4. Store the signed CCLA in a secure location (e.g., a private repository
   or encrypted storage — **not** in the public repository).
5. Add the corporation's authorised contributors to the workflow's
   `allowlist` (see "Updating the allowlist" below).
6. Confirm with the corporation that the agreement is active.

### Updating the allowlist

The `allowlist` input in `.github/workflows/cla.yml` accepts a
comma-separated list of GitHub usernames and glob patterns. To add
corporate contributors:

1. Edit `.github/workflows/cla.yml`.
2. Add the GitHub usernames to the `allowlist` field.
   ```yaml
   with:
     allowlist: bot*,github-actions[bot],dependabot[bot],corpuser1,corpuser2
   ```
3. Commit and push.

Alternatively, for many corporate contributors, maintain a private
`CLA-SIGNED-CORPORATE.md` file and add them as needed.

### Handling an unsigned PR

If a PR is submitted without CLA signing:

1. The workflow posts an automated comment asking the contributor to sign.
2. The PR status check shows `failure`.
3. Branch protection prevents merge unless bypassed.

Do NOT merge until the CLA check passes. If the contributor refuses to
sign, close the PR.

### Emergency override (unsigned merge)

If a critical fix is needed and the contributor cannot sign (e.g., bot
failure):

1. Verify the contribution's provenance independently.
2. Add a comment to the PR explaining the reason for override.
3. Use repo admin privileges to bypass the required status check.
4. Record the override in a maintainer log.

Overrides should be rare and documented.

## Troubleshooting

### Bot does not post a comment

Check:
- The `cla.yml` workflow ran successfully (Actions tab).
- The workflow has `pull-requests: write` permission.
- The `GITHUB_TOKEN` secret is available (it is by default).

### Status check shows "expected" but never runs

- Ensure the branch protection rule lists "CLA Assistant" as a required
  check (the exact name must match the workflow's check name).
- If the name differs, update the branch protection rule or the workflow.

### Signature file commit fails

- The `_clasignatures` branch must exist. If not, create it (see setup).
- The workflow needs `contents: write` permission to push to this branch.

### Bot says "recheck" but recheck does nothing

- The `custom-pr-sign-comment` input must match exactly. The default is
  `I have read the CLA Document and I hereby sign the CLA`. If you
  customised it, contributors must use the exact custom phrase.

## Security Considerations

### Permissions

The CLA workflow uses `pull_request_target`, which runs in the context of
the base repository and has access to repository secrets. This is necessary
for the workflow to:

- Post comments on PRs from forks
- Update status checks
- Push to the signature storage branch

The workflow is configured with **least-privilege permissions**:
```yaml
permissions:
  actions: write
  contents: write    # only to push to _clasignatures branch
  pull-requests: write
  statuses: write
```

### Fork safety

The `pull_request_target` event runs the workflow's code from the base
repository, not the fork. An attacker cannot modify the workflow to
exfiltrate secrets. The workflow only makes authenticated API calls using
the `GITHUB_TOKEN` with the above permissions.

### Signature integrity

Signatures are stored as commits on a protected branch. A contributor
cannot modify their signature commit after a PR is merged because the
workflow locks the PR conversation. A maintainer can always audit the
`_clasignatures` branch to verify records.

### Data retention

Signature records contain:
- GitHub username
- Signing timestamp
- Agreement version
- Any information provided in custom fields

These records are retained indefinitely in the `_clasignatures` branch.
If a contributor requests deletion of their personal data, a maintainer
must remove the record from the signature file and push an amended commit
to the `_clasignatures` branch.

## Changing the Agreement

If you revise `ICLA.md` or `CCLA.md`:

1. Update the agreement version number in the document header.
2. Update the `path-to-document` input in `cla.yml` if the URL changed.
3. Existing signatories will be prompted to accept the new version on
   their next PR. The `_clasignatures` branch stores which version each
   contributor accepted.

## Organisation Migration

If the repository moves from a personal account to a GitHub organisation:

1. Transfer the repository.
2. Transfer the CLA signature branch by pushing to the new remote:
   ```bash
   git push https://github.com/K-Arthur/varve _clasignatures
   ```
3. Update `GITHUB_TOKEN` — the new org's `GITHUB_TOKEN` is automatically
   available.
4. Update the `path-to-document` URL in `cla.yml` if the org changes the
   default branch name.
5. Verify the workflow runs on a test PR from the new repository.

## Records Export

To export all signature records:

1. Check out the `_clasignatures` branch:
   ```bash
   git fetch origin _clasignatures
   git checkout _clasignatures
   ```
2. Read the signature file:
   ```bash
   cat path-to-signatures  # default: signatures/version1/cla.json
   ```
3. The file is a JSON array of signature records. You can pipe it to
   `jq` for analysis or convert to CSV.

## Contact

For CLA administration questions, open an issue with the `cla` label in
the repository.
