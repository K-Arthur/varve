# Email routing and outbound identity

Operational reference for Varve's public email channels: what exists, how
inbound mail is routed, what is deliberately not written down here, and what
must be true before Varve can *send* mail as `@varve.studio`.

> **This file is published in a public repository.** It documents the
> architecture, never the credentials or the destination. The forwarding
> mailbox address, provider passwords, app passwords, and API keys belong in
> the operator's own password manager — not here, not in a comment, and not in
> a commit message. `pnpm audit:contacts` fails the build if a concrete
> forwarding destination or a consumer mailbox appears anywhere in the repo or
> in the built site.

## Public identities

Seven role addresses on `varve.studio`. These are the only Varve contact
identities that may appear in the website, the application, the README, or
packaging metadata. The canonical definition lives in
[`packages/shared/src/contact.ts`](../../packages/shared/src/contact.ts) and
every surface reads from it.

| Purpose | Address | Primary surfaces |
|---|---|---|
| General inquiries | `hello@varve.studio` | `/contact`, Organization JSON-LD, README |
| Product support | `support@varve.studio` | `/contact`, `/support`, footer, Help > Contact Support, Settings > About |
| Product feedback | `feedback@varve.studio` | `/contact`, Help > Send Feedback |
| Security | `security@varve.studio` | `/contact`, `/security`, `security.txt`, `SECURITY.md`, Help > Report a Security Issue |
| Privacy | `privacy@varve.studio` | `/contact`, `/about/privacy`, Settings > Privacy & Diagnostics |
| Press and media | `press@varve.studio` | `/contact`, `/press` |
| Partnerships | `partnerships@varve.studio` | `/contact`, `/press` |

Each address has exactly one documented purpose. Adding an alias whose purpose
overlaps an existing one removes the reader's ability to choose correctly,
which is the whole point of publishing seven instead of one.

## Inbound routing

```text
hello@varve.studio         ─┐
support@varve.studio        │
feedback@varve.studio       │
security@varve.studio       ├──→  configured forwarding mailbox in Porkbun
privacy@varve.studio        │
press@varve.studio          │
partnerships@varve.studio  ─┘
```

- Registrar and DNS: **Porkbun**.
- Mechanism: Porkbun **email forwarding** (inbound only — see
  [Outbound identity](#outbound-identity-not-yet-configured)).
- All seven aliases target a single mailbox. That is appropriate at this
  stage; it is also why website copy must never imply seven staffed
  departments. "For partnership inquiries, email …" is accurate; "our
  partnerships team" is not.

### Forwarding rules that must hold

1. **No alias forwards to another alias.** Every alias points directly at the
   receiving mailbox. Alias-to-alias chains are how forwarding loops start.
2. **No auto-forward back to the domain.** If the receiving mailbox has a
   filter that forwards to any `@varve.studio` address, mail ping-pongs until
   a provider breaks the loop.
3. **No catch-all.** A catch-all silently accepts typos and floods the mailbox
   with spam addressed to nonexistent names. Explicit aliases mean a
   misaddressed message bounces and the sender learns to correct it.
4. **No vacation auto-responder on `security@`.** An auto-reply confirms to an
   unknown sender that the address is live and monitored, and can leak
   internal detail into an unauthenticated conversation.

## Verification checklist

Run after any change to DNS or forwarding, and once per release cycle.
Record the date and result in this section's table.

For each of the seven addresses:

- [ ] A message sent from an external provider arrives.
- [ ] The original `From:` sender is preserved (replies reach the human, not
      the alias).
- [ ] The `Subject:` is intact.
- [ ] Delivery takes seconds-to-minutes, not hours.
- [ ] The message is not classified as spam.
- [ ] No duplicate copies arrive (a duplicate is the first symptom of a loop).

| Date | Verified by | Result |
|---|---|---|
| _pending_ | _pending_ | Aliases not yet verified end-to-end — see [Manual steps](#manual-steps-required-outside-the-repository) |

## Mailbox organisation

With seven aliases in one mailbox, filter on the **recipient** address
(`to:` / `deliveredto:`), never on a subject prefix — senders control subjects
and will not use a convention they were never told about.

Suggested labels:

```text
Varve/General        Varve/Support     Varve/Feedback
Varve/Security       Varve/Privacy     Varve/Press
Varve/Partnerships
```

`security@` warrants different handling from the rest:

- Label it prominently and mark it important so it is never triaged late.
- Do not auto-forward it anywhere else.
- Do not auto-reply with internal detail (version numbers, infrastructure,
  who is on call).
- Treat contents as sensitive until the report is resolved and disclosed.

## Outbound identity (not yet configured)

**Inbound forwarding does not give Varve the ability to send as
`@varve.studio`.** These are separate systems, and conflating them is the
usual way a project ends up answering support mail from a personal address.

Current state: replying from the receiving mailbox shows **that mailbox's own
address**, not the `@varve.studio` alias the user wrote to. A user who emails
`support@varve.studio` gets an answer from an unrelated-looking address —
confusing at best, and it trains people to distrust the reply.

Do **not** work around this by setting a `From:` header the sending server is
not authorised to use. Unauthenticated `From:` spoofing fails SPF/DKIM
alignment, lands in spam, and damages the domain's reputation.

### Recommended path (least complexity that is actually authenticated)

Gmail's **"Send mail as"** with an authenticated SMTP submission host for
`varve.studio`, so replies come **from** the alias while sending remains
authenticated and DKIM-signed by the sending provider:

1. Obtain SMTP submission credentials for `varve.studio` from a provider that
   supports authenticated sending for the domain (Porkbun forwarding alone
   does not — it is inbound only).
2. In Gmail: Settings > Accounts > **Add another email address**, enter the
   alias, and configure the provider's SMTP host with those credentials.
   Verify the confirmation message.
3. Publish the provider's DKIM record and include the provider in SPF (see
   below), then set the alias as the default reply identity if desired.
4. Send a test message to an external address and confirm the receiving side
   reports SPF **pass**, DKIM **pass**, and DMARC **pass**.

Alternatives, if branded sending becomes a larger need: a hosted mailbox for
the domain (replaces forwarding entirely, gives real mailboxes per alias), or
a transactional provider (appropriate for automated mail, overkill for human
replies).

## SPF, DKIM, DMARC

Inbound forwarding and outbound sending have different requirements. Audit
current DNS before changing anything, and never add a second SPF record.

- **SPF** — exactly **one** `TXT` record beginning `v=spf1` per domain.
  Multiple SPF records are a permanent error and cause receivers to fail the
  check outright. To authorise an additional sender, add an `include:` to the
  existing record; do not add a new record.
- **DKIM** — published per sending provider, as the selector record that
  provider specifies. Nothing to publish until outbound sending exists.
- **DMARC** — one `TXT` record at `_dmarc.varve.studio`. Start in monitoring
  mode and only tighten after reports confirm every legitimate sender aligns:

  ```text
  v=DMARC1; p=none; rua=mailto:<a varve.studio address>; fo=1; pct=100
  ```

  Move to `p=quarantine`, then `p=reject`, only once aggregate reports show no
  legitimate mail failing. Deploying `p=reject` before that silently destroys
  real mail.

### Forwarding interacts badly with SPF — know this before tightening DMARC

Forwarding rewrites the delivery path but not the message, so:

- **SPF breaks on forward.** The forwarding server is not in the original
  sender's SPF record, so SPF fails at the final destination. This is inherent
  to forwarding, not a misconfiguration.
- **DKIM usually survives**, because it signs the message rather than the
  path — which is why DMARC alignment for forwarded mail depends on DKIM.
- **SRS** (sender rewriting) and **ARC** (authentication results forwarded by
  a trusted intermediary) exist to mitigate this; whether they are applied
  depends on the forwarding provider, not on Varve.

Consequence: mail arriving through forwarding is **not** fully authenticated
end-to-end merely because it reached the mailbox. Do not treat a forwarded
message's apparent sender as verified, particularly for anything arriving at
`security@`.

## Spam handling

Public addresses attract spam; that is the accepted cost of being reachable.
Mitigate with provider-side filtering and mailbox filters.

Explicitly rejected mitigations, and why:

- **Publishing addresses as images** — unreadable to screen readers,
  uncopyable, unusable on mobile. The accessibility cost far exceeds the
  spam benefit.
- **JavaScript-assembled addresses** — breaks without scripting, hides the
  address from assistive technology, and defeats the goal of being findable
  by search and answer engines. These addresses are *meant* to be public.
- **A CAPTCHA-gated contact form** — adds a backend, a spam surface, and a
  privacy obligation (submitted content becomes data Varve stores) to solve a
  problem provider filtering already handles.

## Manual steps required outside the repository

These cannot be performed from the repository and need doing in the provider
consoles.

**Porkbun → Domain Management → varve.studio → Email Forwarding**
→ Confirm one forwarding entry exists for each of: `hello`, `support`,
`feedback`, `security`, `privacy`, `press`, `partnerships`, each targeting the
intended receiving mailbox. Add any that are missing. Do **not** create a
catch-all.

**Porkbun → Domain Management → varve.studio → DNS Records**
→ Confirm there is exactly one `v=spf1` TXT record. If two exist, merge them
into one before doing anything else.
→ Add a `_dmarc` TXT record with `p=none` and an `rua=` address to begin
collecting reports.

**Receiving mailbox → Filters/labels**
→ Create one filter per alias, matching on the **recipient** address, applying
the corresponding `Varve/...` label. Mark the `security@` filter important.
→ Confirm no filter forwards mail to any `@varve.studio` address.

**Test pass**
→ Send one message to each of the seven addresses from an external provider,
then complete the [verification checklist](#verification-checklist) and record
the date in the table.

**Before enabling branded replies**
→ Follow [Recommended path](#recommended-path-least-complexity-that-is-actually-authenticated),
then re-run the test pass and confirm SPF/DKIM/DMARC all pass at the receiver.

## Maintaining `security.txt`

`/.well-known/security.txt` is generated by
[`apps/website/src/pages/.well-known/security.txt.ts`](../../apps/website/src/pages/.well-known/security.txt.ts)
and carries an `Expires` field, which the specification requires and which
crawlers and caches honour. **An expired `security.txt` is treated as
invalid**, so it must be refreshed before the date passes — this is a
recurring obligation, not a one-time file.

Refresh it as part of release preparation: bump `Expires` to roughly a year
out and confirm `Contact`, `Canonical`, and `Policy` still resolve.
