# C2PA / Content Credentials Feasibility Assessment

**Date:** 2026-10-09  
**Status:** Research & feasibility assessment  
**Scope:** Technical evaluation of C2PA integration for Varve's AI transparency system

## Executive Summary

Content Credentials (C2PA) provide cryptographic provenance for digital media through signed manifests embedded in files. While technically feasible for Varve, full C2PA implementation requires significant infrastructure (signing keys, timestamp authorities, manifest generation) beyond the current AI transparency scope. The existing XMP/IPTC disclosure approach provides immediate transparency without cryptographic complexity.

**Recommendation:** Continue with XMP/IPTC disclosure as implemented. Revisit C2PA when:
1. User demand demonstrates need for cryptographic proof
2. Signing infrastructure is available
3. Export volume justifies the implementation cost

## What is C2PA?

The Coalition for Content Provenance and Authenticity (C2PA) is a technical standard for:
- **Cryptographic signing** of content provenance claims
- **Tamper-evident manifests** embedded in media files
- **Chain-of-custody tracking** through content lifecycle
- **Tool and AI model disclosure** with verifiable signatures

### Key Components

1. **Manifest Store**: JSON-LD data structure describing content history
2. **Claim**: Signed assertion about content (e.g., "AI was used here")
3. **Claim Signature**: Cryptographic signature over the claim and asset
4. **C2PA Box/Chunk**: Binary container embedded in the file (JPEG, PNG, WebP, PDF, etc.)

## Technical Requirements

### 1. Signing Infrastructure

**Required:**
- **Signing certificate** — X.509 certificate from a trusted CA
  - Cost: $300-900/year for code signing certificates
  - Or self-signed for testing (not trusted by validators)
- **Private key management** — secure storage, ideally HSM/KMS
- **Timestamp authority** — RFC 3161 TSA for long-term validity
  - Often bundled with certificate or separate service

**Implementation impact:**
- Cannot sign exports without certificate acquisition
- Key compromise requires certificate revocation and user notification
- Unsigned exports would show "unverified" in validators (worse than no C2PA)

### 2. Manifest Generation

**Required libraries/tools:**
- **c2pa-rs** (Rust) — official C2PA SDK from CAI/Adobe
  - Well-maintained, used in Photoshop, Lightroom
  - Handles manifest creation, signing, embedding
  - ~500KB compiled size
- **c2pa-node** — Node.js bindings (alternative)

**Implementation work:**
- Map Varve's `Document.generativeEdits` to C2PA assertions
- Build manifest JSON-LD structure
- Embed signed manifest in export bytes (post-encode step)
- Validate existing manifests on import (optional)

### 3. Per-Format Support

| Format | C2PA Support | Implementation Complexity |
|--------|--------------|---------------------------|
| JPEG | ✅ Well-supported | Low — APP11 segment |
| PNG | ✅ Supported | Medium — custom chunk after IEND |
| WebP | ✅ Supported | Medium — RIFF chunk, extended VP8X |
| PDF | ✅ Supported | High — XMP packet + signature field |
| SVG | ❌ Not standardized | N/A — would need custom approach |

SVG's exclusion means we'd have format-specific disclosure (C2PA for raster, XMP for SVG).

## Current Varve AI Provenance Model

Varve already tracks:
- **Tool used** — Generative Edit, Background Removal, Upscale, etc.
- **Model ID** — LaMa, PatchMatch, IS-Net, BiRefNet, etc.
- **Timestamp** — When the AI edit was applied
- **Mode** — fill, remove, replace, expand
- **Result node** — Which layer was created/modified

**Stored in:** `Document.generativeEdits` (schema v2.16+)

### Mapping to C2PA

C2PA assertions Varve could make:
1. **`c2pa.ai_generative_content`** — Declares AI was used
   - `version`: "1.0"
   - `softwareAgent`: "Varve/{version}"
   - `algorithms`: array of model IDs used
   - `actions`: "fill", "remove", etc.
2. **`c2pa.edited`** — General editing assertion
   - `softwareAgent`: "Varve/{version}"
3. **`c2pa.time`** — When edits were made

**Gap:** Varve's per-layer provenance doesn't naturally collapse into a single signed document claim — C2PA manifests describe the final asset, not individual layers.

## Implementation Estimate

### Minimal C2PA Support (JPEG/PNG only, desktop-first)

**Components:**
1. Certificate acquisition & key management — 1-2 weeks (procurement + integration)
2. `c2pa-rs` integration into Tauri backend — 1 week
3. Manifest generation from `generativeEdits` — 1-2 weeks
4. JPEG/PNG embedding (post-encode) — 1 week
5. Testing & validation — 1 week
6. Documentation — 3 days

**Total:** ~6-8 weeks, assuming straightforward certificate acquisition

**Dependencies:**
- Tauri desktop build (web exports cannot sign without server)
- Rust toolchain already present
- Decision on certificate authority and cost

### Full C2PA Support (all formats, import validation)

Add:
- WebP/PDF embedding — 2 weeks
- Import manifest parsing & display — 1-2 weeks
- Web export via signing service (optional) — 2-3 weeks
- Validation UI (show trust chain) — 1 week

**Total:** ~12-16 weeks

## Cost Analysis

### Direct Costs
- **Code signing certificate:** $300-900/year
- **Timestamp authority:** Often included, or ~$100/year
- **Optional: Signing service** (if supporting web) — variable, likely $0.05-0.10/export

### Maintenance Costs
- Certificate renewal annually
- Key rotation procedures
- Manifest format updates (C2PA spec evolves)
- Validator compatibility testing

### Opportunity Cost
- Implementation time diverted from other features
- Complexity added to export pipeline
- User confusion if validators show "unverified" during adoption

## Comparison: XMP/IPTC vs C2PA

| Aspect | XMP/IPTC Disclosure | C2PA Manifests |
|--------|---------------------|----------------|
| **Trust model** | Self-reported metadata | Cryptographically signed |
| **Tamper detection** | ❌ None | ✅ Signature invalidates if tampered |
| **Implementation** | ✅ Simple byte injection | ❌ Complex (cert, signing, embedding) |
| **Cost** | ✅ Free | ❌ Certificate fees, infra |
| **Validator ecosystem** | ❌ Limited (Exif viewers) | ✅ Growing (Adobe, Truepic, CAI) |
| **User transparency** | ✅ "This file used AI" | ✅ "Signed proof: AI was used" |
| **Format support** | ✅ All (PNG/JPEG/WebP/PDF/SVG) | ⚠️ JPEG/PNG/WebP/PDF (no SVG) |

**Key insight:** For users who trust Varve, XMP disclosure is sufficient. C2PA adds value when:
- Content leaves Varve's ecosystem (social media, news, legal evidence)
- Recipient needs to verify claims without trusting the source
- Regulatory/compliance requirements demand cryptographic proof

## Existing Tools & Ecosystem

### Validators
- **Content Credentials Verify** (contentcredentials.org) — web validator
- **Adobe CC apps** — show C2PA info natively
- **Truepic** — enterprise verification platform
- **c2pa-cli** — command-line validator

### Adoption
- **Adobe Creative Cloud** — Photoshop, Lightroom (full support)
- **Leica** — camera hardware embedding
- **News organizations** — BBC, NYT experimenting
- **Social platforms** — Limited adoption (X/Twitter pilot, Meta exploring)

**Gap:** Most social platforms strip metadata on upload, making C2PA less useful for typical sharing workflows.

## Risks & Considerations

### 1. Certificate Compromise
If Varve's signing key leaks:
- All exports could be forged
- Certificate must be revoked
- User trust damaged
- Requires immediate response plan

**Mitigation:** HSM/KMS, key rotation, monitoring

### 2. Incomplete Provenance
Varve tracks AI edits but not:
- Manual edits (pen tool, color adjustments)
- Imported content provenance (user brings AI-edited image)
- Cross-document copy/paste chains

C2PA manifests would be partial, potentially misleading.

### 3. Performance Impact
- Manifest generation: ~10-50ms per export (negligible)
- Signing: ~50-200ms depending on key access (noticeable for batch exports)
- Size overhead: ~5-50KB per file (manifest + signature)

### 4. User Expectations
- Users may expect C2PA = "proof of authenticity"
- Reality: C2PA proves provenance claims, not truth of claims
- Education required to avoid false sense of security

## Alternative: Hybrid Approach

**Phase 1 (current):** XMP/IPTC disclosure
- Ship now, zero infrastructure cost
- Covers all formats including SVG
- Provides transparency without cryptographic claims

**Phase 2 (optional):** C2PA for desktop exports
- Add C2PA signing to Tauri desktop app
- JPEG/PNG/WebP only initially
- Opt-in via export settings (default: XMP only)
- Requires certificate acquisition

**Phase 3 (future):** Web signing service
- Hosted signing endpoint for web exports
- Rate-limited, authenticated
- Allows browser users to create signed exports

## Recommendation

**Short-term (v0.x - v1.0):**
- ✅ Ship XMP/IPTC disclosure as implemented
- ✅ Document C2PA as future enhancement
- ❌ Do not block on C2PA implementation

**Medium-term (v1.x):**
- Monitor user requests for C2PA support
- Evaluate signing service options
- Prototype desktop C2PA if demand warrants

**Long-term (v2.x+):**
- Full C2PA support if ecosystem matures
- Conditional on social platform adoption
- Tied to regulatory/compliance requirements

## Implementation Notes (if proceeding)

### Rust Integration

```rust
use c2pa::{Builder, Claim, Result};

pub fn sign_export(
    image_bytes: &[u8],
    format: &str, // "image/jpeg", "image/png"
    ai_info: AiEditMetadata,
    cert_path: &str,
    key_path: &str,
) -> Result<Vec<u8>> {
    let mut builder = Builder::from_bytes(format, image_bytes)?;
    
    let claim = Claim::new("Varve Editor", Some("https://varve.studio"));
    claim.add_assertion(&ai_info.to_c2pa_assertion())?;
    
    let signed = builder.sign(cert_path, key_path)?;
    Ok(signed.to_bytes()?)
}
```

### Key Management

- **Development:** Self-signed cert, stored in source (testing only)
- **Production:** Certificate from DigiCert, Sectigo, or similar
- **Storage:** macOS Keychain, Windows Certificate Store, Linux secret-service
- **Tauri access:** Via system keychain APIs or KMS

### Export Flow

```
1. Render node to ImageData (existing)
2. Encode to PNG/JPEG (existing)
3. IF C2PA enabled AND certificate available:
   a. Build manifest from Document.generativeEdits
   b. Sign manifest with certificate
   c. Embed signed manifest in bytes
4. ELSE: Inject XMP metadata (existing fallback)
5. Return bytes
```

## References

- **C2PA Specification:** https://c2pa.org/specifications/specifications/2.0/specs/C2PA_Specification.html
- **c2pa-rs SDK:** https://github.com/contentauth/c2pa-rs
- **Content Credentials Verify:** https://contentcredentials.org/verify
- **Adobe CAI Documentation:** https://opensource.contentauthenticity.org/
- **IPTC Photo Metadata:** https://iptc.org/standards/photo-metadata/

## Conclusion

C2PA is **technically feasible** for Varve but **not recommended for immediate implementation** due to:
1. Infrastructure requirements (certificates, signing, key management)
2. Cost (both direct and opportunity cost)
3. Format limitations (no SVG support)
4. Limited social platform adoption (metadata stripped on upload)

The **XMP/IPTC disclosure** implemented in this PR provides immediate transparency without cryptographic complexity. It satisfies the core user need ("show that AI was used") and can be extended to C2PA when ecosystem adoption justifies the investment.

**Next steps:**
1. Ship current XMP/IPTC implementation
2. Monitor user feedback and validator ecosystem
3. Revisit C2PA decision in 6-12 months with updated cost/benefit data
