#!/usr/bin/env python3
"""Generate SigLIP text-tokenization goldens for the TS tokenizer parity test.

Emits a fixture of (query -> input ids) pairs produced by the reference
transformers `SiglipTokenizer` over google/siglip-base-patch16-224 (the
pinned tokenizer.json, sha256 c6e405cb…). The vitest parity test compares
the TypeScript pipeline against these ids, catching normalizer/Viterbi
regressions.

When the text encoder weights are present in $VARVE_MODEL_CACHE the same
script also emits normalized pooler_output embeddings (onnxruntime-python),
which the embedding parity test checks against the TypeScript pipeline.

Usage:
    /tmp/opencode/ort-venv/bin/python scripts/semantic-corpus/reference-text-tokens.py \
        > packages/engine/src/semanticSimilarity/bench/__fixtures__/reference/siglip-text-tokens.json
"""

import base64
import json
import os
import sys
from pathlib import Path

import numpy as np
from transformers import AutoTokenizer

QUERIES = [
    "orange sunset over mountains",
    "woman standing beside a mountain",
    "blue abstract texture",
    "minimalist office photography",
    "photos containing cars",
    "invoice 8472",
    "IMG_4821",
    "presentation with Q3 revenue",
    "red geometric poster",
    "logo-final-blue.svg",
    "photo-final-v7.jpg",
    "2026-07-poster",
    "final-hero-mountain-v7",
    "annual report 2026",
    "Café Lumière",
    "café lumière",
    "東京タワー",
    "🚀 rocket",
    "héllo wörld",
    "HELLO   WORLD",
    "①⑫㍿",
    "ﬁﬂ ﬃ",
    "Straße ẞ",
    "",
    "a_b.c-d",
    "Q3 revenue growth",
]


def main() -> int:
    tok = AutoTokenizer.from_pretrained("google/siglip-base-patch16-224")
    out = {
        "runtime": f"transformers-{__import__('transformers').__version__}",
        "tokenizerSource": "google/siglip-base-patch16-224 tokenizer.json",
        "maxLength": 64,
        "queries": {},
    }
    embeddings = None
    model_cache = Path(os.environ.get("VARVE_MODEL_CACHE", Path.home() / ".cache" / "varve" / "models"))
    text_model = model_cache / "siglip-base-patch16-224-text.onnx"
    if text_model.exists():
        import onnxruntime as ort

        sess = ort.InferenceSession(str(text_model), providers=["CPUExecutionProvider"])
        embeddings = {}
    for query in QUERIES:
        enc = tok(query, padding="max_length", max_length=64, truncation=True)
        ids = enc["input_ids"]
        out["queries"][query] = ids
        if embeddings is not None:
            emb = sess.run(["pooler_output"], {"input_ids": np.array(ids, dtype=np.int64)[None, :]})[0][0]
            norm = np.linalg.norm(emb)
            emb = emb / norm if norm > 0 else emb
            embeddings[query] = base64.b64encode(emb.astype("<f4").tobytes()).decode()
    if embeddings is not None:
        out["embeddings"] = embeddings
        out["embeddingRuntime"] = f"onnxruntime-python-{__import__('onnxruntime').__version__}"
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
