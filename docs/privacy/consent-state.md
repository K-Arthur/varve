# Consent state specification — crash reporting

Reference: `packages/crash/src/consent.ts` (tests: `consent.test.ts`).
Policy version: **1**. Storage key: `varve:crash-consent`
(legacy read-only: `strata:crash-consent`).

## States

| State | Meaning | Upload | Dialog |
|---|---|---|---|
| `unknown` | no decision recorded (fresh install, storage cleared, corrupt record) | **never** | shown on crash |
| `askEachTime` | user chooses per report | only after explicit per-report send | shown on crash |
| `automaticAllowed` | user deliberately enabled automatic minimized reports | yes | not shown |
| `denied` | user declined crash reporting | never | never |
| `managedDisabled` | build/policy disabled reporting; user cannot override | never | never |
| `unavailable` | environment does not support reporting | never | never |

**Invariants**

1. `unknown` behaves exactly like `denied` for upload purposes.
2. No report, breadcrumb, log bundle, screenshot, or attachment is
   transmitted before explicit consent. Ever.
3. Consent is never inferred from continued use, from accepting unrelated
   terms, or from any analytics/telemetry preference (`ai.shareUsageData`,
   `varve-template-usage`, `strata:actions`, …). Only an explicit legacy
   `strata:crash-consent` decision record migrates.
4. Every transition happens through an explicit `ConsentAction`. There are
   no implicit transitions.
5. `sendOneReport` ("send this report") never enables automatic reporting.
6. Revocation stops future uploads immediately and aborts in-flight requests.
7. Consent lookup is synchronous; every upload dispatch re-checks consent.
8. A stored `automaticAllowed` decision recorded under an older policy
   version downgrades to `askEachTime` — renewed consent required. Denied or
   unknown records are never upgraded by a policy bump.
9. `managedDisabled` and `unavailable` are policy-locked: user actions are
   ignored; only the system can set or lift them.

## Actions

| Action | Allowed from | Result |
|---|---|---|
| `sendOneReport` | any non-locked state | `askEachTime` (or unchanged if already `automaticAllowed`) — records a decision with timestamp + app version |
| `enableAutomatic` | any non-locked state | `automaticAllowed` — deliberate, explicit |
| `chooseAskEachTime` | any non-locked state | `askEachTime` |
| `deny` / `revoke` | any non-locked state | `denied` |
| `disableByPolicy` | any state | `managedDisabled` |
| `markUnavailable` | any state | `unavailable` |

## Record

```jsonc
{
  "state": "askEachTime",
  "policyVersion": 1,
  "decidedAt": 1754300000000,   // epoch ms of the user's decision
  "appVersion": "0.1.0",        // version the decision was made in
  "scope": "both"               // "desktop" | "browser" | "both"
}
```

## Storage and failure modes

- localStorage primary (synchronous, survives restart, fails closed when
  unavailable).
- Corrupt or missing record ⇒ `unknown` ⇒ fail closed.
- Save failure ⇒ decision held in memory for the session; next launch fails
  closed — never the reverse.
- Desktop mirrors to the native settings KV on a best-effort basis; the
  localStorage copy is authoritative for the consent gate.

## Migration rules

- `strata:crash-consent` is read only when `varve:crash-consent` is absent,
  and only when it holds a valid explicit decision record. It is adopted as
  a snapshot; its policy version is never upgraded.
- Any other legacy preference is ignored.
