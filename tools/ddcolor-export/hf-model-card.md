# varve-ddcolor-onnx

Apache-2.0 ONNX exports of the official DDColor weights, produced for the
[Varve](https://github.com/K-Arthur/varve) design suite's optional local photo
colorization feature.

These files are reproducible derivatives of the upstream Apache-2.0 project:

- Code and weights: [piddnad/DDColor](https://github.com/piddnad/DDColor)
  ("DDColor: Towards Photo-Realistic Image Colorization via Dual Decoders",
  ICCV 2023), pinned at commit
  `2adb63f2656ac41cbdfb7b894cddd94121a3faf13`.
- Checkpoints: `piddnad/ddcolor_paper_tiny` and `piddnad/ddcolor_modelscope`
  on HuggingFace (Apache-2.0).

| File | Input | Output | SHA-256 |
|---|---|---|---|
| `ddcolor-tiny.onnx` | `[1, 3, 256, 256]` float32 grayscale-derived RGB | `[1, 2, 256, 256]` raw a*b* | `1410b455cd230a587c38b5771a0193aa6f28bb89b0e29566fbdb791bb1310c47` |
| `ddcolor.onnx` | `[1, 3, 512, 512]` float32 grayscale-derived RGB | `[1, 2, 512, 512]` raw a*b* | `9c881551a0caf29ea283be09e863a841b5bf454b83299357f483f49f6ca18193` |

Exported and verified with `tools/ddcolor-export/export_ddcolor.py` in the
Varve repository: ONNX checker, ONNX Runtime CPU smoke test, and PyTorch
parity (mean absolute difference below 1e-4) all pass.

The model is fed grayscale-derived RGB (`Lab(L*, 0, 0) -> RGB`) squashed to
the square input, and its a*b* output is combined with the original source
lightness and alpha. It proposes plausible colors; it does not recover
historical color.
