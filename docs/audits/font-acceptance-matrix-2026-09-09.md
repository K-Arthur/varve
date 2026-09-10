# Font acceptance matrix — 2026-09-09

This matrix is the review checklist for the font implementation. “Partial”
means the contract or a focused unit test exists but platform or integration
evidence is still required. A pending row is deliberately not presented as a
shipped capability.

| # | Scenario | Status | Evidence / next check |
| --- | --- | --- | --- |
| 1 | Static face parses from a real licensed fixture | Partial | Real host-font probe; commit fixture corpus |
| 2 | Variable face exposes a non-weight axis | Partial | Parser tests; add persisted-axis render case |
| 3 | Collection member keeps its member identity | Implemented | TTC parser and `fontReference` migration tests |
| 4 | Same family with different bytes remains distinct | Implemented | SHA-256 identity tests |
| 5 | Multilingual and missing-glyph diagnostics | Partial | Resolver coverage; add canvas glyph oracle |
| 6 | Malformed input is rejected and quarantined | Implemented | Parser bounds tests |
| 7 | Browser stored font restores after reload | Implemented | IndexedDB restore tests |
| 8 | Native stored font restores after restart | Partial | Native adapter path; WebKitGTK run pending |
| 9 | Removing one face preserves shared artifact users | Partial | Content-addressed key; reference-count test pending |
| 10 | Interrupted migration resumes without resurrection | Partial | Rehash path exists; durable journal test pending |
| 11 | Cancellation during validation/storage/loading | Implemented | Download-manager race tests |
| 12 | Permission revocation has an actionable fallback | Partial | Browser denial fallback; native denial E2E pending |
| 13 | Offline retry does not fetch during search/hover | Implemented | Local preview tests and catalog policy |
| 14 | Range formatting preserves unrelated runs | Partial | Existing rich-text command tests; toolbar E2E pending |
| 15 | One toolbar choice is one undo step | Implemented | `groupCompoundOperation` in text toolbar path |
| 16 | Save/reopen preserves exact face reference | Implemented | Schema 2.27 and manifest v2 tests |
| 17 | Two documents keep project-font lifetimes isolated | Partial | Storage API scoped by artifact; integration test pending |
| 18 | Explicit OS refresh updates the catalog | Partial | Native request fixed; Refresh UI wiring pending |
| 19 | Worker and main thread render the same face | Partial | Synchronous worker admission; canvas hash oracle pending |
| 20 | Package export writes bytes before claiming bundled | Implemented | Package ZIP test and manifest contract |
| 21 | Rich runs outline with their own faces | Pending | Requires run-level outline/export integration |
| 22 | Select by Font scopes page/canvas and excludes hidden content | Partial | Usage index exists; scoped UI assertion pending |
| 23 | Image identification uses crop and explicit target choice | Pending | Crop/classifier/OCR integration remains |
| 24 | Public website describes only evidenced behavior | Implemented | Website copy, docs audit, and typecheck |

## Evidence ownership

Linux Chromium owns the focused editor screenshots and typography E2E. Linux
Tauri/WebKitGTK owns native enumeration and restart evidence. Windows WebView2
and macOS WKWebView remain platform CI/manual owners. Collaboration transport
is outside this matrix; only portable font references and authorized asset
descriptors are in scope.
