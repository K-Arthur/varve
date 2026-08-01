# `.grd` test fixtures — provenance

All fixture files in this directory are **synthesized by a clean-room writer**
(`packages/import/src/gradient/testFixtures.ts`). No proprietary Adobe presets
are shipped. Each fixture's byte layout mirrors the publicly documented
`.grd` structure (Adobe Photoshop File Formats Specification — descriptor
format; the classic "Gradient Set" layout; and the MIT-licensed clean-room
implementations `hi104/psd-grd` and `firasb7323/grdconverter`).

| File | Layout | Contents |
|---|---|---|
| `two-stop.grd` | descriptor ("8BGR", v5) | One gradient, two RGBC stops (black → white) |
| `multi-gradient.grd` | descriptor | 4 gradients: two-stop, 3-stop with midpoint 0.3 + 3 opacity stops (0.25 at 50%) + smoothness 0.75, unicode name, empty name |
| `mixed-color-models.grd` | descriptor | 4 stops: RGBC, HSBC (H30 S100 V100), CMYC (C100 M100 Y0 K0), Grsc (50%) |
| `noise-gradient.grd` | descriptor | One noise gradient (`Noise` bool + `Mode` enum) → imported read-only |
| `unicode-names.grd` | descriptor | `Ünïcödé 名称` and empty-name gradients |
| `legacy-v1.grd` | legacy ("Grad", v1) | Two gradients, RGB stops, full opacity |
| `legacy-v2.grd` | legacy ("Grad", v2) | One gradient with smoothness 0.5 |
| `truncated.grd` | descriptor | First half of `two-stop.grd` → controlled truncated error |
| `empty.grd` | — | 0 bytes → rejected as unsupported |

Regenerate with:
```
pnpm vitest run packages/import/src/gradient/generateFixtures.spec.ts
```
then delete `generateFixtures.spec.ts` (it writes files and is excluded from
the normal suite). The parser contract is validated by
`__fixtures__/fixtures.test.ts` and `photoshopGrd.test.ts`.
