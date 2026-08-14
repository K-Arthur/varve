#!/usr/bin/env python3
"""Generate the SigLIP T5 normalizer charmap table for the TS tokenizer.

The reference tokenizer (google/siglip-base-patch16-224, tokenizer.json,
sha256 c6e405cb7c670d56636a9402c81023a55bc6c3c53d89cf02b92f5c5005bfe920)
normalizes text with a sequence of steps ending in a precompiled
SentencePiece charsmap (nmt_nfkc). The charsmap is a byte-level Darts
trie that is impractical to port to TypeScript; instead this script
enumerates every Unicode code point once, applies the charsmap, and emits
the compact per-code-point mapping as a TypeScript module.

The mapping is per-code-point: the charsmap has no sequence-level rules
(verified by probing multi-character inputs, e.g. ligatures, combining
marks, and whitespace runs — the pipeline's whitespace collapsing is a
separate Replace step in the reference and is implemented directly in the
TS normalizer).

Usage (inside the venv that has `tokenizers`):
    python3 scripts/semantic-corpus/generate-siglip-charmap.py \
        /path/to/tokenizer.json > packages/engine/src/inference/models/siglipT5Charmap.ts

The output module is derived data: never hand-edit it. Regenerate from the
pinned tokenizer artifact instead and keep the sha256 in the header in
sync with the manifest entry (`siglip-tokenizer`).
"""

import base64
import json
import sys
from pathlib import Path

from tokenizers import normalizers


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    tokenizer_path = Path(sys.argv[1])
    tokenizer = json.loads(tokenizer_path.read_text(encoding="utf-8"))
    # Only the Precompiled charsmap is table-ized. The other reference steps
    # (Lowercase, punctuation removal, whitespace collapsing, stripping) are
    # implemented directly in the TypeScript normalizer.
    precompiled = [
        step for step in tokenizer["normalizer"]["normalizers"] if step["type"] == "Precompiled"
    ]
    if len(precompiled) != 1:
        print(f"expected exactly one Precompiled normalizer step, found {len(precompiled)}", file=sys.stderr)
        return 2
    normalizer = normalizers.Precompiled(base64.b64decode(precompiled[0]["precompiled_charsmap"]))

    mapping = {}
    for cp in range(0x110000):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        ch = chr(cp)
        out = normalizer.normalize_str(ch)
        if out != ch:
            mapping[ch] = out

    lines = [
        "/**",
        " * Generated SigLIP T5 normalizer charmap (derived data — do not edit).",
        " *",
        " * Source: google/siglip-base-patch16-224 tokenizer.json",
        " * sha256: c6e405cb7c670d56636a9402c81023a55bc6c3c53d89cf02b92f5c5005bfe920",
        " *",
        " * Regenerate with:",
        " *   python3 scripts/semantic-corpus/generate-siglip-charmap.py <tokenizer.json>",
        " *   > packages/engine/src/inference/models/siglipT5Charmap.ts",
        " *",
        " * Maps every Unicode code point the reference Precompiled normalizer",
        " * rewrites (nmt_nfkc) to its normalized form. Code points that pass",
        " * through unchanged are omitted. The mapping is exact: the charsmap",
        " * has no sequence-level rules (verified for ligatures, combining",
        " * marks, punctuation runs, and whitespace).",
        " *",
        " * All strings are emitted as ASCII \\uXXXX escapes so the derived data",
        " * never trips the repository's zero-emoji audit (the mapped code points",
        " * include dingbats and enclosed symbols).",
        " */",
        "",
        "/**",
        " * Map of code point -> normalized form. Keys are single characters.",
        " */",
        "export const SIGLIP_T5_CHARMAP: ReadonlyMap<string, string> = new Map([",
    ]
    for ch, out in mapping.items():
        lines.append(
            f"  [{json.dumps(ch, ensure_ascii=True)}, {json.dumps(out, ensure_ascii=True)}],"
        )
    lines.append("]);")
    lines.append("")
    print("\n".join(lines))
    print(f"// {len(mapping)} mappings", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
