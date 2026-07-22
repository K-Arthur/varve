# Free APIs for Design Tools — Strata Research

> Structured reference: which public APIs are worth integrating into a
> local-first vector/raster design suite, and which aren't.
> July 2026.

---

## Decision framework

Every API below is rated on four axes:
- **Value to Strata** — does it enable a feature users would notice?
- **Risk** — rate limits, deprecation likelihood, maintenance burden
- **Auth burden** — API key needed? OAuth? Can we cache?
- **Default vs opt-in** — should we ship with it on, or only when the user
  explicitly enables it?

**Guiding principle:** Strata is local-first. Every network dependency is a
liability — a feature that degrades when offline is worse than no feature.
Network-backed features should be:
1. Non-blocking (app works without them)
2. Cacheable (results stored locally)
3. Degradable (graceful fallback when the API is unreachable)

---

## 1. Color / Accessibility

### The Color API
- **URL:** `https://www.thecolorapi.com`
- **Free tier:** Unlimited. No key. No rate limit documented.
- **Endpoints:** `/id` (parse any color → name, hex, rgb, cmyk, hsl, hsv, XYZ,
  contrast text), `/scheme` (monochrome, complement, triad, quad, etc.)
- **Format:** JSON, HTML, SVG
- **Value to Strata:** Color name display in picker ("Cerulean"), auto-generated
  color palettes from a seed color (monochrome/analogic/complement), contrast
  text suggestion. Reduces the need to ship a color-naming dataset.
- **Risk:** Low. Single-developer project (Josh Beckman, open source on GitHub).
  No SLA. Has been running since ~2016. If it goes down, the user just sees
  hex values instead of names — no functionality lost.
- **Auth:** None. Works from a browser or server.
- **Verdict:** **WORTH IT.** Very high value-per-effort ratio. Cache results
  locally (color name is deterministic for a given hex). Enable by default,
  with no-network fallback to hex display.

### WebAIM Contrast Checker
- **URL:** `https://webaim.org/resources/contrastchecker/`
- **Free tier:** No documented API (there's a `/contrastchecker?fcolor=&bcolor=`
  format endpoint, but it's undocumented and may break). WebAIM explicitly
  provides tools, not a service API.
- **Value to Strata:** We already have built-in WCAG contrast checking in
  `@strata/scene/intelligence/audit.ts`. An external API would add nothing.
- **Verdict:** **SKIP.** We already implement this ourselves. No dependency needed.

### Color blindness simulation
- **Best approach:** Client-side Daltonization (LMS color-space matrix
  multiplication). No API needed — this is a ~50-line math function.
- **Verdict:** Build in-house, don't depend on an API.

---

## 2. Font / Typography

### Google Fonts API (Developer API)
- **URL:** `https://www.googleapis.com/webfonts/v1/webfonts`
- **Free tier:** 100,000 requests/day (standard GCP quota). API key required.
- **Data:** Full metadata for 1,500+ font families: variants, subsets, files
  (download URLs), category, version, axes (variable fonts).
- **Value to Strata:** Font browser/picker in the typography panel. Search by
  category, popularity, trend. Download URLs for instant font loading via
  `FontFace` API. Variable font axis metadata for slider controls.
- **Risk:** Low. Google-maintained, highly stable. API key is free, no credit
  card required for this specific API (it's not a GCP paid service). If quota
  exceeded or network down, use a bundled metadata snapshot.
- **Auth:** GCP API key (free, linked to Google account).
- **Verdict:** **WORTH IT** — but with a bundled fallback. Ship a
  `google-fonts-metadata.json` snapshot (updated at build time or quarterly)
  so the font picker works offline. The live API provides download URLs and
  freshness. Enable by default; degrade gracefully to bundled snapshot.

### Fontsource
- **URL:** `https://fontsource.org` — Fontsource packages are npm-installable
  (`@fontsource-variable/*`, `@fontsource/*`)
- **Free tier:** Entirely free, open-source (MIT). No API.
- **Data:** Self-hosted font files and CSS — 1,500+ Google Fonts as npm
  packages.
- **Value to Strata:** Download-once, never re-fetch. Already used in the
  codebase (`@fontsource-variable/geist`,
  `@fontsource-variable/ibm-plex-sans`). Full offline support.
- **Verdict:** **ALREADY IN USE.** Continue bundling project-specific fonts via
  Fontsource. Don't switch to API-based loading for core UI fonts.

### Unifont
- **URL:** `https://unifoundry.com/unifont/`
- **Free tier:** Free (GPL). Bitmap font covering the Unicode Basic
  Multilingual Plane. No API.
- **Value to Strata:** Fallback font for missing-glyph rendering in the design
  viewport. Useful for CJK, emoji, and rare scripts when the chosen font
  doesn't cover them.
- **Verdict:** **LOW PRIORITY.** Useful as a last-resort fallback, but font
  fallback chains already handle this via the OS. Only consider if we need
  deterministic Unicode coverage in SVG/PDF export.

---

## 3. Image / Icons

### Unsplash API
- **URL:** `https://api.unsplash.com`
- **Free tier:** Demo: 50 req/hour. Production: 1,000 req/hour (after approval).
  API key required. Images served via hotlink-required CDN (images.unsplash.com).
- **Data:** 7M+ high-res photos, search, collections, user stats. Imgix-powered
  dynamic resizing (`w=`, `h=`, `fit=`, `q=`, `fm=`).
- **Value to Strata:** "Stock photo" browser within the app — search and drag
  a photo onto the canvas. Huge for marketing designs, social media mockups,
  blog graphics.
- **Risk:** Moderate. **Demo mode is too slow for production** (50 req/hr).
  Production requires manual approval by Unsplash (they verify your app follows
  their attribution guidelines). API guidelines require visible photo credit
  (`Photo by X on Unsplash`). Attribution requirement means either: (a) a
  subtle overlay on each photo, (b) an "Unsplash" panel header + per-photo
  credit, or (c) a compliance layer. No SLA. Rate limit is per-hour, so burst
  usage is constrained.
- **Auth:** API key (Client-ID header). No OAuth needed for read-only.
- **Verdict:** **WORTH IT — BUT OPT-IN ONLY.** The attribution requirement
  and production approval gate mean this can't be a default-on feature.
  Users who want stock photos explicitly enable it, at which point they accept
  the attribution displayed in the UI. Cache results with 1-hour TTL.
  Re-evaluate if Unsplash changes their free-tier terms.

### Pixabay API
- **URL:** `https://pixabay.com/api/docs/`
- **Free tier:** 100 requests/hour (pixelbay.com, default, can get more via
  partnership). API key required. Contains images, vectors, illustrations,
  videos, and music.
- **Data:** 4M+ free images, vectors, illustrations. No per-download attribution
  required (unlike Unsplash — preferable).
- **Value to Strata:** Same use case as Unsplash but with less legal friction
  (no per-image attribution). Vectors and illustrations are especially useful
  for a design tool — users could import SVGs as editable shapes.
- **Risk:** Moderate. Pixabay is owned by Canva (acquired 2019). The API has
  been stable but not enthusiastically maintained. No SLA. 100 req/hour is
  quite restrictive for a multi-user app; but for a local-first desktop app
  with a single user, it's fine.
- **Auth:** API key (free, no OAuth).
- **Verdict:** **WORTH IT — OPT-IN.** Lower attribution burden than Unsplash,
  but rate-limited. Offer as an alternative/companion to Unsplash. Bundle
  both under a unified "Stock Photos" panel.

### Iconify API
- **URL:** `https://api.iconify.design` (public), can also self-host
- **Free tier:** Unlimited (public API, donation-supported). No key.
- **Data:** 300,000+ icons from 200+ open-source icon sets. SVG generation,
  CSS generation, search, collection listing, keyword lookup.
- **Endpoints:** `/search?query=`, `/collection?prefix=`,
  `/svg?prefix=icon&icon=name`, `/css?prefix=icon&icon=name`
- **Value to Strata:** In-app icon browser — search Material Design, FontAwesome,
  Phosphor, Lucide, Tabler, etc. and drag icons onto the canvas as SVG shapes.
  Huge for UI/UX design, app mockups, website wireframes.
- **Risk:** Low. Open-source (Apache 2.0), well-maintained by cyberalien.
  Multiple CDN hosts with automatic failover. Can self-host for zero external
  dependency. If public API is down, the icon browser shows no results but the
  rest of the app works. Very unlikely to be deprecated given the project's
  wide adoption.
- **Auth:** None (public API). Self-hosted can use API key if desired.
- **Verdict:** **STRONG YES.** First-class value for a design tool. Enable by
  default with bundled icon-set metadata for offline search. On first network
  availability, fetch individual icons by ID on demand. Cache rendered SVGs
  locally.

### Simple Icons
- **URL:** `https://simpleicons.org/` — brand SVGs, no formal API. Data at
  `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/_data/simple-icons.json`
- **Free tier:** Free (CC0). No key.
- **Data:** 3,100+ brand logos (GitHub, Twitter, Slack, etc.) as SVGs.
- **Value to Strata:** Brand icon library for social media graphics, app
  store screenshots, presentations. Import as SVG shapes.
- **Verdict:** **WORTH IT — BUNDLED.** Ship a subset (top 200 brands) as
  bundled SVG assets. No live API dependency. Refresh on release cycle.

### Emoji data (unicode.org / cldr)
- **URL:** `https://unicode.org/Public/emoji/latest/emoji-data.txt` |
  CLDR annotations at `https://raw.githubusercontent.com/unicode-org/cldr/main/common/annotations/`
- **Free tier:** Free. No key. Unicode standard.
- **Data:** Emoji sequence definitions, short names, keywords, categories.
- **Value to Strata:** Emoji picker in the text tool. Emoji rendering in design
  viewport (we already handle this via canvas `fillText`). Unicode CLDR
  annotations provide search keywords (e.g., "smile" → 😊).
- **Verdict:** **WORTH IT — BUNDLED.** Ship a processed `emoji.json` (compact
  version of the Unicode data). Update when we bump Unicode version support.
  No network needed.

---

## 4. Geographic / Map Data

### OpenStreetMap Overpass API
- **URL:** `https://overpass-api.de/api/interpreter`
- **Free tier:** Unlimited for reasonable use. No key (by default). Some
  instances require key for higher quotas.
- **Data:** Full OSM dataset — roads, buildings, land use, boundaries, POIs.
  Queried via Overpass QL (a custom query language).
- **Value to Strata:** Generate realistic map illustrations for design mockups
  (city maps, site plans, routing diagrams). Could power a "map screenshot"
  tool that imports OSM data as editable vector shapes.
- **Risk:** High. Overpass QL has a steep learning curve. Queries that return
  too much data get blocked. Public instances have variable uptime. The API is
  designed for data extraction, not design-tool integration. For a simple
  "show a map" feature, embedding a tile layer via URL is simpler.
- **Auth:** None (public instances).
- **Verdict:** **SKIP FOR NOW.** Too complex. If we want map data, use
  the static tile approach or a dedicated map screenshot service.

### Natural Earth Data
- **URL:** `https://www.naturalearthdata.com/downloads/`
- **Free tier:** Free (public domain). No API. Downloadable shapefiles/GeoJSON.
- **Data:** Vector map data at 1:10m, 1:50m, 1:110m scales — coastlines,
  countries, rivers, roads, etc.
- **Value to Strata:** Pre-built vector map shapes for design templates
  (world maps, country outlines). Import as editable vector layers.
- **Verdict:** **WORTH IT — BUNDLED.** Ship the 1:110m simplified coastline
  and country boundaries as bundled GeoJSON (~10MB compressed). Convert to
  Strata scene graph on import. No live API.

### Nominatim (OSM Geocoding)
- **URL:** `https://nominatim.openstreetmap.org`
- **Free tier:** 1 req/second (strict rate limit). No key for low volume. Must
  set a `User-Agent` header identifying your app. Commercial use requires
  a separate plan.
- **Data:** Forward geocoding (address → lat/lon), reverse geocoding
  (lat/lon → address).
- **Value to Strata:** Convert addresses to map coordinates for map
  illustrations. Low value unless we have a map-data feature.
- **Verdict:** **SKIP.** Would only be useful paired with a map rendering
  feature, which we're not building yet.

---

## 5. Weather / Environment

### Open-Meteo
- **URL:** `https://api.open-meteo.com/v1/forecast`
- **Free tier:** 10,000 calls/day (non-commercial). No key. CC BY 4.0 license.
  Self-hostable (AGPLv3).
- **Data:** 30+ weather models, forecast + historical from 1940, air quality,
  marine, geocoding, elevation, flood. ECMWF, NOAA, DWD, MeteoFrance, JMA, etc.
- **Value to Strata:** Weather data for design mockups — a "weather widget"
  component template that shows real data. Dashboard mockups, weather app
  UI designs, event planning graphics with actual weather context.
- **Risk:** Low. Well-maintained, open-source, self-hostable. The 10k/day
  non-commercial limit is generous. Commercial plans exist but reasonably
  priced. Attribution required (CC BY 4.0). Very stable project.
- **Auth:** None (no key for non-commercial). Commercial requires subscription.
- **Verdict:** **WORTH IT — OPT-IN, LAZY.** Useful for "data-driven mockup
  templates." Not a core feature. Enable only when user explicitly inserts a
  weather-driven widget or template. Cache results per-city for 1 hour.

### National Weather Service API (US)
- **URL:** `https://api.weather.gov`
- **Free tier:** Unlimited. No key. US Government data (public domain).
- **Data:** US weather forecasts, alerts, observations, radar metadata.
- **Value to Strata:** Same as Open-Meteo but US-specific. No license concerns
  (public domain).
- **Verdict:** **USEFUL FALLBACK.** If we implement weather data, prefer
  Open-Meteo (global), fall back to NWS for US locations when coordinates
  resolve to US territory.

### OpenWeatherMap
- **URL:** `https://api.openweathermap.org`
- **Free tier:** 1,000 calls/day (One Call API 3.0). API key required.
  Need credit card for activation (even for free tier).
- **Verdict:** **SKIP.** Open-Meteo offers better data with no key. The credit
  card requirement for OWM's free tier is a non-starter for an open-source tool.

---

## 6. Currency / Finance

### Frankfurter App
- **URL:** `https://api.frankfurter.dev/v2/`
- **Free tier:** Unlimited (rate-limited per-IP, no daily cap). No key.
  Open-source, self-hostable.
- **Data:** 201 currencies, 84 central banks, historical rates back to 1948.
  CSV, NDJSON, REST. Blended rates across providers.
- **Value to Strata:** "Live exchange rate" data widget for financial mockups
  (dashboards, fintech app designs, invoice templates, e-commerce prototypes).
  Very high-value for the "data visualization mockup" use case.
- **Risk:** Low. Open-source, no API key, no commercial restrictions (check
  each provider's terms). Self-hostable. Well-documented v2 API.
- **Auth:** None.
- **Verdict:** **STRONG YES.** Enable by default for "data widget" templates.
  Cache per-currency-pair for 24 hours (rates change daily). Degrade to "rates
  unavailable" with a timestamp when offline.

### ExchangeRate-API
- **URL:** `https://open.er-api.com/v6/latest/USD`
- **Free tier:** 1,500 requests/month. No key needed.
- **Verdict:** **SKIP.** Frankfurter is superior in every dimension — more
  currencies, no limit policy, self-hostable.

### Alpha Vantage
- **URL:** `https://www.alphavantage.co/query`
- **Free tier:** 25 API calls/day. API key required (free). Rate limited.
- **Data:** Stock prices, forex, crypto, economic indicators.
- **Value to Strata:** Stock ticker widget for fintech mockups. Lower priority.
- **Verdict:** **LOW VALUE.** Frankfurter covers forex. Stock data is niche.
  Only consider if we build a comprehensive "data-driven mockup" feature.

---

## 7. Country / Regional Data

### REST Countries
- **URL:** `https://api.restcountries.com/countries/v5/`
- **Free tier:** Demo key `rc_live_demo` — 100 requests/day? (unclear, but
  free tier exists). Paid plans for production.
- **Data:** 250+ countries, 90+ fields: names, codes, flags (SVG/PNG), capitals,
  currencies, languages, borders, calling codes, time zones, area, population,
  leaders, memberships (UN, NATO, EU, G7, etc.).
- **Value to Strata:** Country/flag picker components for design templates,
  map legend generation, automatic flag SVGs for travel or internationalization
  mockups, address forms.
- **Risk:** Moderate. The old `restcountries.com` (v3, no key needed) was
  deprecated. The v4/v5 API requires an API key even for free tier. The free
  tier rate limits are unclear. If the old free version disappears, we'd
  need to switch to a bundled dataset.
- **Auth:** API key required.
- **Verdict:** **WORTH IT — BUNDLED INSTEAD.** Rather than depending on
  an API key gate, bundle a `countries.json` (250 records, ~200KB compressed).
  The data changes infrequently (new leaders, updated population). Update at
  build time or monthly. No live API needed.

### Flag CDNs (Flagpedia / flagcdn.com)
- **URL:** `https://flagcdn.com/w320/ca.png` (or `.svg`)
- **Free tier:** Free CDN. No key. No rate limit.
- **Data:** Country flags in PNG and SVG, multiple sizes (16px–2560px).
- **Value to Strata:** Flag images for design mockups. Hotlink or download.
- **Verdict:** **WORTH IT — BUNDLED.** Ship common flag SVGs (UN member
  states ~193) as bundled assets. ~1MB compressed. Use CDN as fallback for
  less common territories. No API integration needed.

---

## 8. Charts / Data Visualization

### QuickChart.io
- **URL:** `https://quickchart.io/chart`
- **Free tier:** Limited (unspecified). The public API has usage limits but is
  free for reasonable personal/small-project use. No key for basic usage.
  Paid plans for higher volume. Open-source, self-hostable.
- **Data:** Chart.js chart rendering → PNG/WebP/SVG/PDF. Takes Chart.js config
  as URL parameter or POST body. Also generates QR codes.
- **Value to Strata:** Export charts from data-driven design templates. A user
  designs a dashboard mockup with placeholder chart data; QuickChart converts
  Chart.js configs into embeddable images for export. Could also power a
  "chart from data" import feature.
- **Risk:** Moderate. The free tier is vague ("reasonable use"). Self-hosting
  is always an option (open-source AGPL). If the hosted service goes down, the
  feature degrades. Self-hosting requires Node.js infrastructure.
  Chart.js support (v2 or v4) is good but not exhaustive.
- **Auth:** None (public API). Optional API key for higher limits.
- **Verdict:** **WORTH IT — OPT-IN.** Not a core feature but valuable for
  dashboard/infographic mockup workflows. Cache generated charts locally
  (by config hash) to avoid re-rendering the same chart. Enable on first
  chart insertion.

---

## 9. Machine Learning / AI (free tiers)

### Hugging Face Inference Providers
- **URL:** `https://router.huggingface.co/v1` (OpenAI-compatible)
- **Free tier:** Generous free credits for new users. No credit card required
  for the free tier. Token-based auth (HF token).
- **Models available:** Thousands of open models — LLMs (DeepSeek, Llama, Qwen),
  text-to-image (FLUX, SDXL), embeddings, image classification, speech-to-text.
- **Value to Strata:** AI design assistant — text-to-image generation ("generate
  a hero image for my design"), image captioning for accessibility, design
  critique, alternative layouts, copywriting for mockups.
- **Risk:** Lower than proprietary closed APIs because we can swap between
  providers (Cerebras, Groq, Together, Replicate, etc.) through the unified
  router. Hugging Face is well-established in ML. Free tier credits may change.
  Still requires network and a token.
- **Auth:** HF token (free). No OAuth.
- **Verdict:** **WORTH IT — OPT-IN.** The local-first principle suggests
  keeping AI features opt-in. Offer as "AI Assistant" in a panel, with a
  settings dialog where the user enters their own API key/token. Never embed
  a shared key in the binary. Cache results aggressively.

### Google Gemini API
- **URL:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
- **Free tier:** 1,500 requests/day (gemini-2.0-flash). 60 requests/minute.
  API key required (free, no credit card for free tier).
- **Data:** Text generation, multimodal (images + text), vision understanding.
- **Value to Strata:** AI text generation for mockup content, image
  understanding ("describe this design"), code generation for export.
  Gemini's free tier is notably generous for small projects.
- **Risk:** Low for Google service (stable, well-documented). Free tier terms
  could change. Rate limits are reasonable for a single-user desktop app.
  Google's privacy policy for API data has been scrutinized — don't send
  user design data without consent.
- **Auth:** API key (free, no credit card).
- **Verdict:** **WORTH IT — OPT-IN.** Offer alongside Hugging Face as an
  alternative AI backend. User provides their own API key. Highlight privacy
  implications prominently in settings.

### OpenAI API
- **URL:** `https://api.openai.com/v1/chat/completions`
- **Free tier:** **No longer free.** Free tier credits were discontinued in
  2024. Only paid API now.
- **Verdict:** **SKIP.** No free tier. Strata should not bake in paid API
  keys. Users who want OpenAI can configure it themselves.

### Anthropic Claude API
- **URL:** `https://api.anthropic.com/v1/messages`
- **Free tier:** $5 in free credits for new accounts (one-time). Pay-as-you-go
  after. API key required.
- **Verdict:** **SKIP for default.** Offer as user-configurable option only.

### Replicate
- **URL:** `https://api.replicate.com/v1`
- **Free tier:** Free tier exists for low-volume (essentially 0 rate).
  Token-based auth.
- **Models:** Image generation (FLUX, SD), image-to-image, upscaling,
  background removal, video generation.
- **Value to Strata:** Alternative AI image generation backend. Useful if
  user prefers Replicate over Hugging Face or Gemini.
- **Verdict:** **NIECE — User-configurable option.**

---

## 10. Translation / Language

### LibreTranslate
- **URL:** Public instances at `https://libretranslate.com/translate` or
  self-hosted.
- **Free tier:** Free for the public instance (rate-limited, ~50 requests/day
  without key). Self-hosted is free (AGPLv3). API key optional.
- **Data:** 30+ languages, text translation, file translation, language
  detection. Powered by Argos Translate (offline-capable NMT models).
- **Value to Strata:** Translate text layers in a design (great for mockups
  that need to show the same UI in multiple languages). Translate UI text
  for international design templates. Language detection for multi-language
  documents.
- **Risk:** Low. Open-source, AGPL but self-hosting avoids any remote
  dependency. Public instance rate limits are tight but sufficient for
  occasional use. Argos models are small enough to bundle for offline use
  (~50MB per language pair).
- **Auth:** Optional API key.
- **Verdict:** **WORTH IT — OPT-IN.** For online use, point to the public
  LibreTranslate instance with a 50-req/day count. For production, recommend
  self-hosting. As a stretch goal, consider bundling the most popular
  language pairs (EN→ES, EN→FR, EN→DE) as offline Argos models. Flag privacy:
  sending text to a public instance means the text leaves the local machine.

### Google Cloud Translation API
- **URL:** `https://translation.googleapis.com/language/translate/v2`
- **Free tier:** 500,000 characters/month. API key required (free, but
  credit card needed for GCP).
- **Value to Strata:** Same use case as LibreTranslate but with broader
  language coverage (100+ languages), higher quality on well-supported pairs.
- **Verdict:** **SECONDARY OPTION.** LibreTranslate is preferable for
  an open-source tool (no account, self-hostable). Offer Google as a
  configurable alternative for users who want higher quality.

---

## 11. Reference / Knowledge

### Wikipedia API
- **URL:** `https://en.wikipedia.org/w/api.php`
- **Free tier:** Unlimited (rate-limited per IP). No key.
- **Data:** Full Wikipedia content, summaries, images, categories, search.
  Available via REST API (`/api/rest_v1/`) or action API.
- **Value to Strata:** "Summarize this topic" for design moodboards, research
  panels, or automatic alt-text generation. Fetch topic summaries to fill
  content in templates. Wikipedia images (CC) for placeholder content.
- **Risk:** Low. Wikimedia Foundation is stable, well-maintained, has no
  deprecation risk. Rate limits are generous. Content is CC BY-SA. Be careful
  about displaying Wikipedia content — must attribute.
- **Auth:** None (public).
- **Verdict:** **WORTH IT — OPT-IN.** Useful for a "reference panel" where
  designers research topics without leaving the app. Not a core feature.
  Cache article summaries for 24 hours.

### DuckDuckGo Instant Answer API
- **URL:** `https://api.duckduckgo.com/?q=query&format=json`
- **Free tier:** Unlimited. No key. No rate limit documented.
- **Data:** Instant answers (definitions, summaries, infoboxes, disambiguation).
  Zero-click info from Wikipedia, Wikidata, and other sources.
- **Value to Strata:** Quick inline definitions, topic summaries, and data
  lookups without the full Wikipedia response. Lighter weight.
- **Verdict:** **WORTH IT — OPT-IN.** Use as a lighter alternative to
  Wikipedia API for inline reference lookups. Particularly good for "what is
  this?" queries in a design research context.

### Wolfram Alpha API
- **URL:** `https://api.wolframalpha.com/v2/query`
- **Free tier:** 2,000 calls/month (Wolfram Alpha AppID required, free).
  Requires an AppID. Very limited compared to paid.
- **Verdict:** **SKIP.** Low free tier, and the computational knowledge
  use case is too niche for a design tool.

---

## 12. QR / Barcode / Generation

### goQR.me
- **URL:** `https://api.qrserver.com/v1/create-qr-code/`
- **Free tier:** Free. No key. Rate-limited (overuse gets temporarily blocked).
- **Data:** QR code generation (sizes up to 1000x1000). PNG, GIF, JPG, SVG,
  EPS formats. Barcode generation (EAN, UPC, Code128, etc.).
- **Value to Strata:** QR code generation for print designs. A user designs
  a poster or brochure and wants to generate a QR code pointing to a URL.
  Generate it inline, import as embedded image or SVG.
- **Risk:** Moderate. Single-service, no SLA. For a print-design tool, SVG
  output is critical — goQR supports it. If the service goes down, QR
  generation breaks. Self-hostable alternative: `qrcode` npm package
  (qrcode-generator) works entirely offline.
- **Auth:** None.
- **Verdict:** **WORTH IT — BUT PREFER OFFLINE.** Use an npm package
  (`qrcode`, ~10KB) for client-side QR generation. No API needed at all.
  goQR is useful as a barcode generation fallback (more complex format).
  If using goQR, cache generated images.

### Barcode (offline npm packages)
- **Verdict:** **PREFER BUNDLED.** `javascript-barcode` or similar packages
  can generate all common linear/barcode formats entirely offline. No API
  needed for barcode generation in a print tool.

---

## 13. Statistics / Public Data

### World Bank API
- **URL:** `https://api.worldbank.org/v2/country/all/indicator/...`
- **Free tier:** Unlimited. No key. JSON, XML, CSV.
- **Data:** 30,000+ economic indicators across 200+ countries — GDP, population,
  trade, education, health, poverty, environment, etc. Data from 1960–present.
- **Value to Strata:** Data-driven templates for dashboards, infographics, and
  data journalism designs. "Show me GDP growth for G7 countries" → live chart.
  Very high value for a design tool that wants to support data visualization.
- **Risk:** Low. World Bank maintains this API professionally. Very stable.
  No SLA but it's been running for 15+ years. Data is public domain.
- **Auth:** None.
- **Verdict:** **WORTH IT — OPT-IN.** Cache results aggressively (indicator
  data changes infrequently — monthly or yearly). Format data into Chart.js
  config for QuickChart rendering. This is a genuinely differentiated feature:
  no other design tool offers live World Bank data integration.

### UN Data API
- **URL:** `https://data.un.org/ws/rest/data/` (SDMX-JSON format)
- **Free tier:** Unlimited. No key.
- **Data:** UN statistical datasets — population, SDGs, trade, environment,
  gender, health. SDMX format (complex).
- **Value to Strata:** Similar to World Bank but for UN-specific datasets
  (SDG indicators, human development, population projections).
- **Verdict:** **SECONDARY.** World Bank API is easier to use (REST, JSON,
  well-documented). UN Data uses SDMX which requires more parsing work.
  Implement World Bank first; add UN Data if demand exists.

### data.gov / EU Open Data Portal
- **URL:** `https://www.data.gov/developers/apis` | `https://data.europa.eu/api`
- **Free tier:** Free. Various formats. No key for most datasets.
- **Data:** US federal government data + EU institution data. Thousands of
  datasets — climate, agriculture, energy, health, transportation, finance.
- **Value to Strata:** Niche. The data is vast but inconsistent in format.
  Unless we build a general-purpose "import CSV" feature, direct API
  integration isn't worth the effort.
- **Verdict:** **SKIP.** Too broad. Prefer the curated World Bank datasets.

---

## Prioritization Matrix

| API | Value | Risk | Effort | Tier | Default/Opt-in |
|---|---|---|---|---|---|
| **The Color API** | High | Low | 2h | **TIER 1** | Default |
| **Fontsource** | High | Low | Already done | **TIER 1** | Default |
| **Google Fonts API** | High | Low | 4h | **TIER 1** | Default (with fallback) |
| **Iconify API** | Very High | Low | 6h | **TIER 1** | Default |
| **Simple Icons (bundled)** | High | Low | 2h | **TIER 1** | Default |
| **Emoji data (bundled)** | Medium | Low | 2h | **TIER 1** | Default |
| **Natural Earth (bundled)** | Medium | Low | 4h | **TIER 2** | Opt-in |
| **Open-Meteo** | Medium | Low | 3h | **TIER 2** | Opt-in |
| **Frankfurter** | Medium | Low | 2h | **TIER 2** | Default (widgets) |
| **World Bank API** | High | Low | 6h | **TIER 2** | Opt-in |
| **LibreTranslate** | High | Low-Med | 6h | **TIER 2** | Opt-in |
| **Wikipedia API/DDG** | Medium | Low | 2h | **TIER 2** | Opt-in |
| **QuickChart** | Medium | Moderate | 4h | **TIER 2** | Opt-in |
| **Hugging Face AI** | High | Moderate | 8h | **TIER 2** | Opt-in |
| **Gemini AI** | High | Moderate | 4h | **TIER 3** | Opt-in (configurable) |
| **Unsplash** | High | Moderate | 8h | **TIER 3** | Opt-in |
| **Pixabay** | Medium | Moderate | 4h | **TIER 3** | Opt-in |

**Tiers:**
- **TIER 1** — Build next. High value, low risk, low effort. Enable by default
  with offline fallback.
- **TIER 2** — Build after TIER 1. Medium-high value, manageable risk.
  Opt-in exposed behind user settings.
- **TIER 3** — Build if demand exists. Higher integration effort or auth burden.
  Deep opt-in requiring user action (API key, approval).

---

## Integration patterns

### Pattern A: Bundle a snapshot, refresh from API
Best for: Google Fonts, Country data, Emoji data

```
repo/
  packages/data/
    snapshots/
      fonts-metadata.json    # Updated monthly via CI
      countries.json         # Updated quarterly via CI
      emoji.json             # Updated per Unicode version
```

At build time or in CI, a script fetches the API and writes the snapshot.
The app loads from the snapshot; if network is available, it checks
`Last-Modified` and fetches an update in the background.

### Pattern B: Lazy fetch + local cache
Best for: Iconify, Unsplash, Open-Meteo, Frankfurter

```
user searches → fetch API → store result in IndexedDB (with TTL)
                ↓
         next search → check cache first → if stale, refresh
```

The user never waits for a network on repeated queries. Each cache entry
has a TTL appropriate to the data:
- Icon SVGs: 30 days (icons rarely change)
- Weather: 1 hour
- Currency rates: 24 hours
- Stock photos: 1 hour (search results) — downloaded images persist
- Chart renders: forever (by config hash)

### Pattern C: Require user API key
Best for: Hugging Face, Gemini, Unsplash (production)

Settings → API Keys → enter your key → validate → store in OS keychain

Never hardcode or ship API keys. The app works without them — features
that need the key show a "configure in Settings" prompt.

### Pattern D: Opt-in feature gate
Best for: AI, Stock photos, Map data

Features are hidden or disabled until the user toggles them on. On first
enable, show a brief explanation of what data is sent/received and the
privacy implications. Respect local-first: feature works with cached data
even when the network is unavailable.

---

## Privacy considerations

Every network API call from a design tool sends the user's data or context
to a third party. For each integration, document:

1. **What data is sent** — e.g., color hex value (The Color API), search text
   (Iconify), text content (LibreTranslate), design node data (if sent to AI)
2. **Where it goes** — server location, jurisdiction
3. **How long it's stored** — does the provider log it?
4. **Is encryption used?** — all modern APIs are HTTPS, but worth noting
5. **Can the user opt out?** — yes, by not using the feature

For AI APIs especially: **never send user design data without explicit
consent.** The first time a user triggers an AI feature, show a dialog:

> "This will send [specific data] to [provider]. Your design content will
> be processed by their servers. Do you want to proceed?"

---

## Quick-start implementation notes

### Highest priority (TIER 1) implementation sequence:

1. **Iconify API** — Search endpoint for in-app icon browser. Cache SVGs.
2. **Google Fonts API** — Font browser with bundled metadata fallback.
3. **The Color API** — Color naming + palette generation.
4. **Emoji picker** — Bundled unicode data, no API needed.
5. **Frankfurter** — Widget data source for financial/currency mockups.
6. **Simple Icons** — Brand icon library from bundled SVGs.

Each integration should:
- Be wrapped in an `ApiClient` class with fetch/retry/cache logic
- Have a `isAvailable()` method that checks network + token
- Have a `clearCache()` method for user settings
- Be mockable in tests (injectable client)
- Display appropriate attribution where required
