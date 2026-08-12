# Website Operations Guide

> **Note:** This document predates the project's licensing decisions and
> describes the project as AGPL-3.0-or-later. See `LICENSE` for the current
> license (FSL-1.1-MIT).

**Purpose:** Step-by-step instructions for the two actions the solo developer will repeat most often.

---

## A. How to Add a New Release

### Prerequisites
- A tagged release exists on GitHub (e.g., `v0.1.0`)
- CI has built and uploaded artifacts for all platforms
- You have the release version, date, and GitHub release URL

### Steps

**1. Update `apps/website/public/releases.json`**

This is the single source of truth for all download data. Open it and update:

```json
{
  "latest": {
    "version": "0.1.0",
    "releaseDate": "2026-07-15",
    "description": "First public release with basic canvas and export",
    "isPrerelease": false,
    "githubUrl": "https://github.com/K-Arthur/varve",
    "releasesUrl": "https://github.com/K-Arthur/varve/releases",
    "discussionsUrl": "https://github.com/K-Arthur/varve/discussions"
  }
}
```

Key fields to update:
- `version` — exact semver from the git tag
- `releaseDate` — ISO date string
- `description` — 1-2 sentence summary of what changed
- `isPrerelease` — `true` for alpha/beta/rc, `false` for stable

**2. Update platform-specific download URLs**

If the release changed platform artifacts (package names, sizes, formats), update the corresponding entries:

```json
{
  "platforms": {
    "linux": {
      "x86_64": {
        "appimage": {
          "url": "https://github.com/K-Arthur/varve/releases/download/v0.1.0/Varve-0.1.0-linux-x86_64.AppImage",
          "size": "~210 MB",
          "format": "AppImage",
          "recommended": true
        }
      }
    }
  }
}
```

**3. Update system requirements (if changed)**

Only modify `systemRequirements` if minimum requirements changed (e.g., dropped Ubuntu 20.04 support).

**4. Update integrity info (if checksums are now available)**

Once CI generates checksums, change:
```json
"integrity": {
  "checksums": true,
  "codeSigning": false,
  "notarization": false,
  "note": "SHA256 checksums available on the GitHub release page."
}
```

**5. (Optional) Add release notes to the releases page**

Update `apps/website/src/pages/releases.astro` if you want version-specific notes to appear on the releases page.

**6. Build and verify**

```bash
pnpm --filter @varve/website build
# Verify: 0 errors, 42+ pages built
npx vitest run apps/website/src/test/releases.test.ts
# Verify: 9/9 tests pass
```

**7. Commit and push**

```bash
git add apps/website/public/releases.json
git commit -m "chore(website): update release manifest to v0.1.0"
git push
```

GitHub Actions will automatically deploy the updated website.

---

## B. How to Add a New Supported Platform

### Scenario
You added a new target to the CI matrix (e.g., Linux ARM64, macOS ARM-only, Windows ARM64). Now you need to surface it on the website.

### Steps

**1. Add the platform to `releases.json`**

```json
{
  "platforms": {
    "linux": {
      "x86_64": { /* existing */ },
      "arm64": {
        "appimage": {
          "url": "https://github.com/K-Arthur/varve/releases/download/v0.1.0/Varve-0.1.0-linux-aarch64.AppImage",
          "size": "~200 MB",
          "format": "AppImage",
          "recommended": true
        }
      }
    }
  }
}
```

**2. Update system requirements**

```json
"systemRequirements": {
  "linux": {
    "os": ["CachyOS", "Arch Linux", "Ubuntu 22.04+", "Fedora", "RHEL"],
    "cpu": "x86_64, ARM64",
    "ram": { "minimum": "4 GB", "recommended": "8 GB" }
  }
}
```

**3. Add platform tab to download page**

In `apps/website/src/pages/download.astro`:

a) Add platform tab button to the `.platform-selector`:
```html
<button class="platform-tab" data-platform="linux-arm64">Linux ARM64</button>
```

b) Add platform section:
```html
<div class="platform-section" id="platform-linux-arm64">
  <h2>Linux ARM64</h2>
  <div class="download-options">
    <div class="download-option recommended">
      <!-- Same pattern as other platforms -->
    </div>
  </div>
</div>
```

c) Update platform detection in the `<script>` block:
```javascript
function detectPlatform() {
  const ua = navigator.userAgent;
  if (ua.includes('Linux') && ua.includes('aarch64')) return 'linux-arm64';
  // ...existing detection
}
```

**4. Verify the build**

```bash
pnpm --filter @varve/website build
```

**5. Commit and push**

---

## C. How to Deploy the Website

### Automatic Deployment
The website deploys automatically via GitHub Actions when:
- Changes are pushed to the `master` branch under `apps/website/` or `packages/ui/src/tokens/`
- Or manually triggered via `workflow_dispatch`

### Manual Deployment
```bash
# Build locally
pnpm --filter @varve/website build

# Verify build output
ls apps/website/dist/

# Commit and push
git add apps/website/
git commit -m "feat(website): update content"
git push
```

### Domain Configuration
The site is configured via `SITE_URL` / `SITE_BASE` environment variables in
`astro.config.mjs`. Production defaults are the purchased custom domain
(`https://varve.studio`, base `/`); the legacy GitHub Pages project mode
(`https://k-arthur.github.io`, base `/varve`) is built by `build:website:pages`
for the CI dual-mode suite:

```js
site: process.env.SITE_URL ?? 'https://varve.studio'
base: process.env.SITE_BASE ?? '/'
```

The custom domain is configured in repo Settings > Pages (Custom domain =
`varve.studio`), DNS lives at Porkbun (see `docs/release/custom-domain-runbook.md`
for the exact records), Enforce HTTPS is on, and the deployment workflow
(`website-deploy.yml`) builds the production defaults and smoke-checks the
canonical origin after every deploy.

---

## D. Updates That Require the Developer (Human-Only)

These items depend on accounts, money, or personal judgment and cannot be automated:

| Item | What to Do |
|------|------------|
| **GitHub Sponsors setup** | Go to repo Settings > Sponsors, link Stripe/bank account, set up tiers |
| **Custom domain DNS** | Done 2026-08-12 — DNS records live at Porkbun; see `docs/release/custom-domain-runbook.md` |
| **Plausible analytics** | Sign up at plausible.io, set the `ANALYTICS_DOMAIN` build env var (Layout.astro gates the snippet and CSP on it; unset = no analytics) |
| **Code signing cert** | Purchase from DigiCert/Apple Developer, add to CI secrets |
| **Legal review** | Have a lawyer review terms of service, privacy policy, and AGPL licensing pages |
| **Payment terminology** | Decide whether to call payments "donations" vs "sponsorships" (has tax implications) |
| **Personal disclosure** | Decide what personal/identity information appears in the solo-developer story |
| **Production cutover** | Done 2026-08-12 — apex A/AAAA + `www` CNAME at Porkbun; see `docs/release/custom-domain-runbook.md` |
