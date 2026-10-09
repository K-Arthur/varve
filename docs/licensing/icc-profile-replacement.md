# ICC Profile Replacement — October 9, 2026

## Summary

Varve releases **v0.1.0 through v0.5.0** (August 8, 2026 – October 8, 2026) bundled two ICC color profiles from Artifex Software's Ghostscript distribution, licensed under AGPL-3.0-or-later:

- `sRGB.icc` — "Artifex Software sRGB ICC Profile" (Copyright 2011 Artifex Software)
- `default_cmyk.icc` — "Artifex CMYK SWOP Profile" (Copyright 2011 Artifex Software)

These profiles were compiled into the binary via `include_bytes!` in `crates/varve-colour/src/profiles.rs` and were also present in `crates/varve-print/profiles/`. They were inadvertently included without proper AGPL attribution in `THIRD_PARTY_NOTICES` or inclusion of the AGPL-3.0 license text in `THIRD_PARTY_LICENSES/`.

**As of v0.5.1 (next release after October 9, 2026), these AGPL profiles have been replaced** with permissively licensed alternatives:

- **sRGB:** `sRGB-v4.icc` from [Compact ICC Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles) by Clinton Ingram, licensed under **CC0-1.0** (public domain)
- **CMYK:** `ISOcoated_v2_bas.ICC` from [basICColor printing profiles](https://salsa.debian.org/debian/icc-profiles-free) (FOGRA39, ISO 12647-2:2004), licensed under **Zlib**

## Source and License Information

### Original Artifex Profiles (v0.1.0–v0.5.0)

- **Source:** Ghostscript distribution
  - Debian package: `ghostscript` (versions 10.0.0+)
  - Upstream: https://git.ghostscript.com/?p=ghostscript.git
- **License:** AGPL-3.0-or-later
- **Location in Ghostscript source:** `iccprofiles/` directory
- **Debian copyright reference:** https://sources.debian.org/data/main/g/ghostscript/10.0.0~dfsg-11+deb12u8/debian/copyright

The AGPL-3.0-or-later license text can be found at:
- https://www.gnu.org/licenses/agpl-3.0.txt
- https://spdx.org/licenses/AGPL-3.0-or-later.html

### Replacement Profiles (v0.5.1+)

#### sRGB Profile

- **Source:** Compact ICC Profiles (https://github.com/saucecontrol/Compact-ICC-Profiles)
- **File:** `profiles/sRGB-v4.icc` (480 bytes, ICC v4 parametric curve)
- **Author:** Clinton Ingram
- **License:** CC0-1.0 Universal (Public Domain)
- **License reference:** https://creativecommons.org/publicdomain/zero/1.0/
- **Technical details:** ICC v4 profile with parametric curve encoding precise gamma 2.2 (slope-limited per Adobe recommendations), true sRGB primaries per ICC extension spec

#### CMYK Profile

- **Source:** basICColor printing profiles via icc-profiles-free (Debian)
  - Repository: https://salsa.debian.org/debian/icc-profiles-free
  - Upstream: http://www.color.org/ and http://www.basiccolor.de/
- **File:** `icc-profiles-basiccolor-printing2009/default_profiles/printing/ISOcoated_v2_bas.ICC`
- **Profile name:** ISO Coated v2 (basICColor)
- **Standard:** FOGRA39, ISO 12647-2:2004/Amd 1
- **Copyright:** Copyright (c) 2006-2007 Color Solutions, All Rights Reserved; Copyright (c) 2007-2010 basICColor GmbH
- **License:** Zlib
- **License reference:** https://opensource.org/licenses/Zlib
- **Technical details:** Full bidirectional CMYK↔RGB conversion with A2B0/A2B1/A2B2 (perceptual/relative/saturation) and B2A0/B2A1/B2A2 transforms

## Impact and Compatibility

### Color Accuracy

Both replacement profiles provide **equivalent or better color accuracy** for their intended use:

- The CC0 sRGB profile uses the ICC-recommended parametric curve with slope limiting, matching or exceeding the precision of the Artifex profile
- The basICColor ISO Coated v2 profile is a widely-used industry-standard CMYK profile (FOGRA39), suitable for European coated paper printing and broader than the original US SWOP profile

### Compatibility

- **File size:** The new sRGB profile is **480 bytes** (vs. 2.6 KB for the Artifex profile), significantly smaller while maintaining full ICC v4 compatibility
- **CMYK profile:** The replacement is **1.1 MB** (vs. 184 KB), larger due to comprehensive bidirectional transforms, but provides full RGB→CMYK conversion support required for PDF/X export
- Both profiles are validated against ICC.1:2010 (Profile Version 4.3) via `varve-colour`'s existing ICC validation functions

### License Compatibility

The replacement profiles are compatible with Varve's licensing:

- **CC0-1.0** (sRGB) is public domain and imposes no restrictions
- **Zlib** (CMYK) is OSI-approved, permissive, and compatible with MIT/Apache-2.0 (used in `varve-colour`) and FSL-1.1-MIT (used in `varve-print`)

## For Users of v0.1.0–v0.5.0

If you are using Varve v0.1.0 through v0.5.0:

1. **The bundled ICC profiles are AGPL-licensed.** Under AGPL-3.0-or-later terms, you have the right to:
   - Use the software for any purpose
   - Study and modify the source code (including the ICC profiles)
   - Distribute copies and modifications

2. **Source code availability:** The complete source code for these releases, including the ICC profile files, is available at:
   - https://github.com/K-Arthur/varve
   - Tagged releases: https://github.com/K-Arthur/varve/releases

3. **Upgrade path:** To use Varve with permissively-licensed ICC profiles, upgrade to v0.5.1 or later.

## Technical Details of the Replacement

### Deduplication

The duplicate copies in `crates/varve-print/profiles/` were removed and replaced with a symbolic link to `crates/varve-colour/profiles/`, eliminating redundancy and ensuring both crates use identical profile data.

### Validation

The replacement profiles pass all existing ICC validation:
- ICC magic signature (`acsp` at bytes 36-39)
- Valid profile class (v4 `mntr` for sRGB, `prtr` for CMYK)
- Correct color space signatures (`RGB ` and `CMYK`)
- Valid profile connection space (PCS)
- Existing unit tests in `crates/varve-colour/src/profiles.rs::tests`

### Integration Points

The ICC profiles are used in:
- `crates/varve-colour/src/profiles.rs` — bundled via `include_bytes!`
- `crates/varve-print/` — PDF/X color space embedding and CMYK conversion
- Color management throughout the editor for accurate display and export

## Acknowledgments

- **Artifex Software** and the Ghostscript project for making their profiles available under AGPL
- **Clinton Ingram** for creating and releasing the Compact ICC Profiles under CC0
- **basICColor GmbH** and **Color Solutions** for the ISO Coated v2 profile under Zlib
- The Debian `icc-profiles-free` package maintainers for curating freely redistributable profiles

## References

- License review that identified the issue: (internal document, October 9, 2026)
- Compact ICC Profiles: https://github.com/saucecontrol/Compact-ICC-Profiles
- icc-profiles-free (Debian): https://salsa.debian.org/debian/icc-profiles-free
- ICC specifications: https://www.color.org/
- SPDX License List: https://spdx.org/licenses/

---

*This notice is provided for transparency and to fulfill the spirit of good-faith licensing practices. Users of Varve v0.1.0–v0.5.0 have all rights granted by the AGPL-3.0-or-later license for the ICC profiles bundled in those releases.*
