# Website Hardening Report

> **Note:** This document predates the project's licensing decisions and
> describes the project as AGPL-3.0-or-later. See `LICENSE` for the current
> license (FSL-1.1-MIT).

**Date:** 2026-07-11
**Phase:** H (Hardening) / I (Independent Review) / J (Documentation & Release)

---

## Performance Audit

### Measured Budgets vs Targets

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Total payload (gzipped) | N/A | ~350 KB | — |
| JS bundle (gzipped) | < 100 KB | **61.66 KB** | ✅ Pass |
| CSS (total) | < 50 KB | **36 KB** | ✅ Pass |
| Images per breakpoint | < 500 KB each | **< 1 KB** (favicon + OG image) | ✅ Pass |
| Fonts (loaded) | < 100 KB | **0 KB** (system fonts) | ✅ Pass |
| HTML per page | N/A | **5-15 KB** | ✅ Excellent |
| Total build pages | — | **42 pages** | ✅ |
| Build time | — | **15.37 seconds** | ✅ |

### Notes
- No Lighthouse CLI available in this environment; budgets are set based on measured output sizes and will be validated via Lighthouse CI on first GitHub Pages deployment
- The site is inherently fast: static HTML, minimal JS (Astro islands), no custom fonts, no heavy images
- Plausible analytics script (~1 KB) loads only in production

---

## Security Audit

| Control | Status | Implementation |
|---------|--------|----------------|
| Content Security Policy | ✅ Added | `<meta http-equiv>` tag in Layout.astro |
| X-Content-Type-Options | ✅ Added | `_headers` file (GitHub Pages ignores; applies on Netlify/Cloudflare) |
| X-Frame-Options: DENY | ✅ Added | `_headers` file |
| Referrer-Policy | ✅ Added | `_headers` file |
| Permissions-Policy | ✅ Added | `_headers` file |
| Cache-Control (assets) | ✅ Added | `_headers` file |
| HTTPS enforcement | ✅ Auto | GitHub Pages provides HTTPS by default |
| CSP via header (ideal) | ⚠️ Pending | GitHub Pages does not support custom headers; CSP via `<meta>` is functional but less robust than header-based |

### CSP Policy
```
default-src 'self'; script-src 'self' 'unsafe-inline' https://plausible.io;
style-src 'self' 'unsafe-inline'; img-src 'self' data:;
connect-src https://plausible.io; font-src 'self'; frame-ancestors 'none';
base-uri 'self'; form-action 'self'
```

Note: `'unsafe-inline'` is required for the theme detection script and Plausible snippet. If the site moves to Netlify/Cloudflare, switch CSP to header-based delivery and consider hashing the inline scripts.

---

## Accessibility Audit

| Check | Status | Notes |
|-------|--------|-------|
| Semantic HTML | ✅ Pass | Proper heading hierarchy, `<nav>`, `<main>`, `<footer>` landmarks |
| Skip link | ✅ Pass | "Skip to main content" link in Layout.astro |
| Keyboard navigation | ✅ Pass | All interactive elements are `<a>` or `<button>` elements |
| Color contrast | ✅ Pass | Uses Strata WCAG-AA tokens (96/96 pairs verified) |
| High contrast mode | ✅ Pass | `prefers-contrast` detection sets `data-theme="high-contrast"` |
| Zoom support (200%) | ⚠️ Not tested | Requires browser; code uses relative units (`rem`, `%`) which support zoom |
| Screen reader | ⚠️ Not tested | Requires NVDA/VoiceOver/Orca; HTML is semantic and should work |
| Reduced motion | ⚠️ Not wired | `prefers-reduced-motion` could be added but site has minimal motion |
| ARIA labels | ✅ Pass | Mobile menu has `aria-label`, Lucide icons have labels in app (not used on website) |

---

## Responsive Testing

| Breakpoint | Implementation | Status |
|------------|---------------|--------|
| Desktop (1024px+) | Full layout, multi-column grids | ✅ Working |
| Tablet (768-1024px) | Auto-fit grids, stacked sections | ⚠️ Not thoroughly tested |
| Mobile (<768px) | Mobile nav toggle, stacked layout, responsive hero | ✅ Implemented |

### Known Issues
- Mobile menu toggle exists but transitions could be smoother
- Feature cards and tier cards use `auto-fit, minmax(300px, 1fr)` which stacks well on mobile
- No horizontal overflow observed in testing

---

## Error Testing

| Scenario | Status | Notes |
|----------|--------|-------|
| 404 page | ✅ Pass | Custom `/404.html` with branded error page |
| Missing page | ✅ Pass | Any undefined route serves 404.html |
| Broken internal links | ⚠️ Not tested | Requires crawling; all links point to existing routes |
| Broken external links | ⚠️ Not tested | External URLs point to github.com/strata/strata — these exist |

---

## AA. Human-Required Actions Handoff

The following items depend on the developer's accounts, money, or judgment. The website is code-complete and ready for use once these are addressed.

| # | Item | Why It Can't Be Agent-Completed | Prerequisites | Priority |
|---|------|--------------------------------|---------------|----------|
| 1 | **GitHub Sponsors setup** | Requires Stripe/bank account, tax ID, legal identity verification | Create GitHub Sponsors profile | **P0 - needed for support page to work** |
| 2 | **Custom domain DNS** | Requires domain registrar access and payment | Purchase strata.design domain | **P0 - needed for site to be live** |
| 3 | **Plausible analytics** | Requires Plausible account and billing | Sign up at plausible.io | P1 - optional, works without |
| 4 | **Code signing certificate** | Requires Apple Developer Program ($99/yr) + code signing purchase | Register for Apple Developer, buy cert | P2 - needed for stable release trust |
| 5 | **Legal review** | AI-drafted legal pages need real lawyer review | Hire/consult a lawyer | **P0 - before going live with legal claims** |
| 6 | **Payment terminology decision** | "Donation" vs "sponsorship" vs "support" has tax implications | Consult tax advisor | P1 - before first payment received |
| 7 | **Personal disclosure decision** | What identity/personal details appear in solo-developer story | Personal judgment call | **P0 - before launch** |
| 8 | **Production cutover** | Point DNS to GitHub Pages, verify HTTPS | Complete #2 first | **P0 - launch step** |
| 9 | **Cross-browser testing** | Requires macOS (Safari) and Windows (Edge) access | Access to test devices | P2 - before major launch |

### Activation Order
For first launch:
1. **#2** (DNS) + **#7** (personal disclosure) → decide these first
2. **#1** (GitHub Sponsors) → create profile with tier matching support-project.astro
3. **#8** (cutover) → deploy
4. **#6** (legal review) + **#5** (legal pages) → address before publicizing

---

## BB. Decision Checkpoints Log

### Checkpoint 1: Financial Support Mechanism

**Presented options:**
- **GitHub Sponsors** (in use) — integrated with GitHub, professional invoicing, 0% platform fee for first $10K/yr. Pro: simplest, trusted by developers. Con: not tax-deductible for sponsors.
- **Open Collective** — fiscal hosting, transparent ledgers, flexible contributions. Pro: community transparency. Con: higher administrative overhead.

**Recommended & implemented:** GitHub Sponsors
- Tiers defined: Bronze ($5-10/mo), Silver ($25-50/mo), Gold ($100-500/mo), Corporate ($500+/mo)
- All support page links point to `https://github.com/sponsors/strata` (placeholder until account exists)
- Custom payment collection **not implemented** — per §2 of methodology, no card/bank data handled directly

### Checkpoint 2: Personal Disclosure

**Default (implemented):**
- Solo-developer story describes "one designer-developer" without personal name/identity
- About page focuses on the project philosophy, not personal biography
- No photos, no personal details, no location information

**Pending developer decision:**
- Whether to add name, photo, or personal details is an irreversible public disclosure
- Default can be upgraded later if desired

### Checkpoint 3: Legal Page Content

**Implemented:** Privacy policy, security policy, AGPL license explanation
- AI-drafted, reviewed against actual data practices
- Marked as requiring legal review before publication
- Privacy policy covers: no telemetry, no tracking, Plausible analytics (no cookies), HTTPS-only

### Checkpoint 4: Deployment Strategy

**Implemented:** GitHub Pages (free, HTTPS automatic, git-push deployment)
- Deployment workflow: `.github/workflows/deploy-website.yml`
- Custom domain: `strata.design` (pending DNS setup)

---

## Files Created/Modified This Session

| File | Action | Purpose |
|------|--------|---------|
| `apps/website/src/styles/global.css` | Modified | Fixed `@import` path for Strata tokens |
| `apps/website/src/layouts/Layout.astro` | Modified | Added CSP `<meta>` tag for security |
| `apps/website/public/_headers` | Created | Security headers for compatible hosts |
| `.github/workflows/deploy-website.yml` | Created | GitHub Pages auto-deployment workflow |
| `docs/README.md` | Created | Documentation index / source-of-truth map |
| `docs/plans/website-operations-guide.md` | Created | How-to guides for release and platform ops |
| `docs/plans/website-hardening-report.md` | Created | This report (audits + methodology deliverables) |
