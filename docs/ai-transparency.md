# AI Transparency Controls

Varve provides comprehensive controls over AI features and clear disclosure of AI-edited content, giving you full transparency and control over how artificial intelligence is used in your designs.

## Global AI Features Toggle

Control all AI/ML features from a single switch.

### How to Access

**Via Settings:**
1. Open **Settings** (File → Settings or `Ctrl+,` / `Cmd+,`)
2. Navigate to the **AI** section
3. Toggle **Enable AI Features** on or off

**Via Command Palette:**
- Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
- Search for "Toggle AI Features"
- Or use the keyboard shortcut: `Ctrl+Alt+Shift+A`

### What's Controlled

When AI features are **disabled**, the following operations are blocked:

1. **Generative Edit** — AI-powered fill, remove, replace, and expand tools
2. **Background Removal** — AI-powered object segmentation and masking
3. **Image Upscaling** — AI-enhanced resolution upscaling
4. **Object Selection** — SAM2 intelligent selection tool
5. **Depth Map Generation** — AI depth estimation for lens blur effects
6. **Semantic Search** — AI-powered content indexing and search
7. **Model Downloads** — Downloading optional AI models
8. **Cloud AI Providers** — Any cloud-based AI services (when configured)

### What's NOT Affected

- **Existing AI-edited content** — Layers that were previously edited with AI tools remain visible and fully editable. The toggle only prevents *new* AI operations.
- **Manual tools** — Vector drawing, text, shapes, transformations, and all non-AI editing features work normally.
- **Imports and exports** — You can still import and export files regardless of AI settings.

### Default State

AI features are **enabled by default**. Disable them if you:
- Need to ensure no AI was used in a project (for contests, client requirements, etc.)
- Want to work offline without optional model downloads
- Prefer manual control over all editing operations

## AI-Edited Layer Badges

Layers that have been modified by AI tools show a visual indicator in the Layers panel.

### The Badge

- **Icon:** a small sparkles mark next to the layer name
- **Tooltip:** Hover over the badge to see:
  - Which AI tool was used (AI Fill, AI Remove, Background Removal, etc.)
  - Which model processed the layer (LaMa, PatchMatch, IS-Net, BiRefNet, etc.)
  - When the edit was made (e.g., "2h ago", "Oct 9, 2026")

### What Triggers the Badge

The badge appears when a layer has been created or modified by:
- **Generative Edit** (fill, remove, replace, expand modes)
- **Background Removal** (when using AI models, not Quick mode)
- **Image Upscaling** (AI-enhanced upscaling)
- Other AI tools that persist provenance data

### Limitations

- **Manual edits tracked separately** — If you paint over an AI-edited layer with manual tools, the AI badge remains (the layer still contains AI-generated pixels).
- **Import provenance** — AI edits made in other applications are not tracked unless the imported file includes compatible metadata.
- **Grouped layers** — Individual layers within a group show their own badges; the group itself does not inherit the badge.

## Inspector AI Details Section

When you select an AI-edited layer, the Inspector shows an **AI Edit History** section with:
- Tool name (AI Fill, AI Remove, and so on)
- Model ID
- Timestamp
- Edit mode

This is the same provenance stored on the document, not a second history stack.

## Export Disclosure

When you export a document that contains AI-edited content, Varve can embed metadata disclosing AI usage.

### Metadata Format

Different export formats use different metadata standards:

- **PNG, JPEG, WebP:** XMP metadata with IPTC `DigitalSourceType`
  - Value: `compositeWithTrainedAlgorithmicMedia`
  - Description: Lists which AI tools were used
- **PDF:** XMP packet in document metadata
  - Same IPTC fields as raster formats
  - Survives PDF viewers and re-exports
- **SVG:** `<metadata>` element in the SVG root
  - Dublin Core and custom Varve namespace
  - Human-readable and machine-parseable

### Export Option

The **Include AI Disclosure** checkbox in export dialogs controls metadata embedding:
- **Enabled (default):** Exports include AI provenance metadata
- **Disabled:** Exports do not include AI metadata (pixels unchanged, only metadata stripped)

Use this when:
- **Enabled:** Sharing work publicly, submitting to contests that require disclosure, or archiving with full provenance
- **Disabled:** Privacy concerns, or when the recipient's tools don't handle metadata correctly

### Reading the Metadata

Most image viewers and photo managers can display embedded metadata:
- **Windows:** Right-click → Properties → Details
- **macOS:** Get Info → More Info
- **Photo managers:** Lightroom, Bridge, Exiv2, ExifTool
- **Validators:** Content Credentials Verify (contentcredentials.org)

### Important Notes

- **Metadata is not encryption** — It's a declaration, not a tamper-proof seal. Anyone with an editor can remove or alter metadata.
- **C2PA / Content Credentials:** Varve's current implementation uses standard XMP/IPTC disclosure. Cryptographically-signed Content Credentials (C2PA) are under evaluation for future versions. See `docs/research/c2pa-content-credentials-feasibility.md` for technical details.
- **Social media stripping:** Most social platforms (Instagram, Twitter, Facebook) remove all metadata when you upload images. The disclosure is visible in the file you export, but may not survive platform uploads.

## Privacy & Data

### What's Stored

- **AI edit history** — Stored in your document file (`.varve` format)
- **Settings preference** — The AI toggle state is stored locally in browser storage (`localStorage` or Tauri settings)
- **Export metadata** — Only included when "Include AI Disclosure" is enabled

### What's NOT Stored

- **Pixel data** — Export metadata describes *that* AI was used, not the actual image content
- **Model weights** — Optional models are stored locally, never uploaded
- **Usage analytics** — Varve does not track which AI features you use or how often

### Data Transmission

- **Cloud AI providers:** Disabled by default. When explicitly configured, image data is sent to your chosen endpoint (user-controlled).
- **On-device AI:** All bundled models run locally. No pixels leave your device.

## Use Cases

### Ensuring AI-Free Work

For contests, clients, or organizations that prohibit AI-generated content:

1. **Before starting:**
   - Disable AI features in Settings
   - Verify the toggle shows "Disabled"
2. **During work:**
   - AI tools are unavailable (grayed out or hidden)
   - If you accidentally try to use one, a toast notification reminds you AI is disabled
3. **Before export:**
   - Confirm no layers have the AI badge (none should, if toggle was off from the start)
   - Export with "Include AI Disclosure" enabled (will show no AI was used)

### Transparent AI Usage

When you want to show that AI was used responsibly:

1. **Keep AI features enabled** (default state)
2. **Use AI tools as needed** — Generative Edit, Background Removal, etc.
3. **Check layer badges** to confirm provenance is tracked
4. **Export with disclosure enabled** (default)
5. **Metadata in the exported file** declares which tools and models were used

### Privacy-Conscious Editing

If you used AI during editing but want to deliver without metadata:

1. **Edit normally** with AI features enabled
2. **Before exporting:**
   - Uncheck "Include AI Disclosure" in the export dialog
   - Export proceeds without embedding AI metadata
3. **Result:** File contains AI-edited pixels, but no provenance metadata

## FAQ

**Q: Can I selectively allow only some AI features?**  
A: Not yet. The toggle is all-or-nothing. Granular control (e.g., "allow Background Removal but not Generative Edit") may be added in a future version if users request it.

**Q: Does disabling AI features delete my existing AI-edited layers?**  
A: No. Disabling AI only prevents *new* AI operations. Your existing artwork remains untouched and fully editable.

**Q: What if I import an image that someone else AI-edited?**  
A: Varve can only track AI edits made *within Varve*. Imported images show no badge unless they carry compatible metadata (and even then, Varve doesn't parse external metadata for badges yet).

**Q: Does the badge appear in exported images?**  
A: No. The badge is a Layers panel UI indicator only. Export disclosure is handled via embedded metadata (XMP/IPTC), not visual watermarks.

**Q: Can I remove AI metadata from an already-exported file?**  
A: Yes, using ExifTool or similar metadata editors. Varve itself doesn't provide a metadata-stripping tool, but standard photo tools can remove XMP/IPTC data.

**Q: What about C2PA / Content Credentials?**  
A: Varve's current implementation uses standard XMP/IPTC metadata, which is self-reported (not cryptographically signed). C2PA support (signed, tamper-evident provenance) is under evaluation. See the C2PA feasibility document for details.

**Q: If I copy an AI-edited layer to a new document, does the badge follow?**  
A: Yes, if you copy within Varve. The provenance data is part of the layer, so it moves with the layer. However, external copy/paste (e.g., Varve → Photoshop → Varve) loses provenance.

## Technical Details

For developers and advanced users:

### Provenance Schema

AI edit history is stored in `Document.generativeEdits` (schema v2.16+):

```typescript
{
  generativeEdits: {
    "edit-abc123": {
      mode: "fill" | "remove" | "replace" | "expand",
      sourceNodeId: "node-xyz",
      resultNodeId: "node-abc",
      provider: {
        runtime: "onnx" | "native" | "patchmatch",
        modelId: "u2netp" | "isnet" | "birefnet" | null,
      },
      updatedAt: 1696789012345, // epoch milliseconds
      // ... other fields
    }
  }
}
```

### Export Metadata

XMP/IPTC example (PNG/JPEG):

```xml
<rdf:Description>
  <Iptc4xmpExt:DigitalSourceType>
    http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia
  </Iptc4xmpExt:DigitalSourceType>
  <dc:description>
    AI tools used: Generative Edit (LaMa), Background Removal (IS-Net)
  </dc:description>
</rdf:Description>
```

### Settings Storage

- **Web:** `localStorage` key `varve-editor-settings`, JSON object with `{ ai: { enabled: boolean } }`
- **Desktop:** Tauri settings (same JSON structure, persisted via platform-native storage)

### Audit Test

The codebase includes an automated test (`packages/editor/src/__tests__/ai-entry-point-gating.test.ts`) that verifies all AI entry points check the `ai.enabled` setting. This runs in CI and fails if a new AI feature bypasses the gate.

## See Also

- **C2PA Feasibility Assessment:** `docs/research/c2pa-content-credentials-feasibility.md`
- **Settings Documentation:** `packages/editor/src/settings.ts`
- **Provenance Schema:** `packages/scene/src/assets.ts`
- **Layer Badge Implementation:** `packages/editor/src/components/LayersPanel/aiEditedBadge.ts`
