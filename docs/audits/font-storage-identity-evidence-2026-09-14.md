# Font storage identity evidence — 2026-09-14

## Finding

IndexedDB stored distinct hash/member faces correctly, but the compatibility
`getStoredFont(family)` helper returned the first matching record. A family is
not a portable identity, so this could silently load the wrong artifact when
two files shared a family name.

## Change

Family-only lookup now succeeds only when exactly one stored record matches.
Ambiguous results return `null`, allowing the caller to show an explicit face
choice or recovery state. `getStoredFontByIdentity` and exact filesystem loads
continue to resolve a hash/member face directly, and legacy family-only
documents remain readable when there is one unambiguous record.

## Evidence

```text
pnpm exec biome check --write packages/engine/src/font/fontStorage.ts packages/editor/src/components/FontBrowser/fontStorage.test.ts
pnpm exec vitest run packages/editor/src/components/FontBrowser/fontStorage.test.ts --pool=threads --maxWorkers=1 --reporter=dot
```

The focused storage suite passed all eight tests, including two same-family
artifacts, exact member removal, shared artifact reference counting, byte
integrity quarantine, and interrupted migration retry.

## Limits

Native restart/uninstall and full render/reopen proof still require the desktop
font-specific run. Family-only compatibility APIs remain deliberately
conservative; callers that know an authored reference should always use the
exact lookup.
