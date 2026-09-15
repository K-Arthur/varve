# Quick font picker favorites and recents evidence — 2026-09-13

## Change

The compact family picker now shares the full browser's personal font state:

- favorited installed families appear in a dedicated **Favorites** section;
- a successful family selection records that family as recently used;
- the picker keeps its existing local-only search and exact-face warning behavior;
- a small star badge makes a favorite discoverable without changing the option's
  accessible name or its keyboard semantics.

This closes a common font-menu complaint found in the comparative research:
frequently used faces disappear behind a long alphabetical list, while a
favorite saved in the full manager is unavailable from the quick editing path.
The implementation is deliberately local. Opening, searching, hovering, and
selecting a result never downloads a font or asks for local-font permission.

## Validation

Component coverage:

- `FontSelector.test.tsx` verifies the Favorites section, family selection,
  recent-use notification, and the existing APG combobox contracts.

Browser coverage:

- `tests/e2e/canvas/font-selector.spec.ts` —
  `compact picker exposes a favorited family and records it as recent`.
- The scenario favorites **IBM Plex Sans Variable** in the full browser,
  dismisses the modal, opens the quick picker, verifies the Favorites section
  and option, then applies the option to the active text layer.

The exact command, commit SHA, screenshots, and hashes are recorded below after
the post-commit browser run. The full-browser captures are linked from the
earlier favorites evidence; the compact capture below verifies the section
header, star badge, option bounds, and portal clipping in the quick path.

| Artifact | Launch SHA | Completion SHA | Command | Result | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| full browser favorite | `6b4a2340927c5bb8bb60e1c4cb54b86443131f4a` | `6b4a2340927c5bb8bb60e1c4cb54b86443131f4a` | `font-selector.spec.ts -g full browser favorites` | 1 passed | [`available.png`](../screenshots/fonts/2026-09-13-font-browser-favorites/available.png) — `163367cc89d56505afac9982531dfb6aeb9feb14732051fb32a903d9bdc8ac09`; [`favorites-filter.png`](../screenshots/fonts/2026-09-13-font-browser-favorites/favorites-filter.png) — `02d42d117cff056d2d249cf0cf60facef7e3f6e38dcb1648bfe9efdb6d917e6a` |
| compact picker favorite/recent | `0f26a19f76d51ea71e5aef29f6865af273e139de` | `0f26a19f76d51ea71e5aef29f6865af273e139de` | same | 1 passed | [`compact-picker-favorites.png`](../screenshots/fonts/2026-09-13-quick-picker-favorites/compact-picker-favorites.png) — `0773216419daab4a8f6931ef56aa4ec4e7470cefec7ea60bbdf82d0fc172f720` |

## Research basis

The interaction follows the local-first, explicit-action recommendations in
[`docs/research/font-typography-ux-research-2026-09-12.md`](../research/font-typography-ux-research-2026-09-12.md):
favorites and recents are user state, search is bounded and local, and font
installation is kept separate from browsing. Figma's recent/favorite access
and the explicit missing-font workflows in Adobe and Affinity informed the
scope; Varve retains its exact artifact/member identity instead of treating a
family label as proof of the installed bytes.
