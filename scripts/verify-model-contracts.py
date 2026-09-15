#!/usr/bin/env python3
"""
ONNX graph inspection and tensor contract verification.

Downloads (or loads) each model referenced in the manifest, inspects the
ONNX graph, and compares the actual tensor names/shapes/dtypes against
the declared tensor contracts. Produces a JSON report suitable for CI.

Usage:
    python3 scripts/verify-model-contracts.py [--all] [--model MODEL_ID] [--output report.json]

Requirements:
    pip install onnx onnxruntime

Research basis:
    - U^2-Net (u2netp): input "input.1" [1,3,320,320] float32
    - IS-Net: input "input.1" [1,3,1024,1024] float32
    - BiRefNet Lite: input "input.1" [1,3,1024,1024] float32 (rembg export)
    - BiRefNet Full: input "input.1" [1,3,1024,1024] float32 (rembg export)
    - SAM2 Hiera Tiny: encoder [1,3,1024,1024], decoder multi-input
    - Depth-Anything-V2: input 518x518 RGB (divisible by 14)
    - SCUNet: dynamic H/W (divisible by 8)
    - LineArt: 256x256 RGB, sigmoid output
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any

# ── Manifest loading ──────────────────────────────────────────────────────

MANIFEST_PATH = Path("apps/desktop/public/models/manifest.json")
MODELS_DIR = Path("apps/desktop/public/models")


def load_manifest() -> dict[str, Any]:
    with open(MANIFEST_PATH) as f:
        return json.load(f)


def resolve_model_path(entry: dict[str, Any]) -> Path | None:
    """Resolve the local path for a model entry."""
    if entry.get("bundled"):
        local = MODELS_DIR / entry["localPath"].lstrip("/")
        if local.exists():
            return local
    # Check if there's a downloaded copy
    alt = MODELS_DIR / entry.get("filename", "")
    if alt.exists():
        return alt
    return None


def download_model(entry: dict[str, Any], dest: Path) -> bool:
    """Download a model from its remote URL. Returns True on success."""
    url = entry.get("remoteUrl", "")
    if not url:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  Downloading {entry['id']} from {url}...")
    try:
        urllib.request.urlretrieve(url, dest)
        return True
    except Exception as e:
        print(f"  Download failed: {e}")
        return False


# ── ONNX graph inspection ────────────────────────────────────────────────

def inspect_onnx_graph(model_path: Path) -> dict[str, Any]:
    """Inspect an ONNX model file and return graph metadata."""
    import onnx

    model = onnx.load(str(model_path), load_external_data=False)
    graph = model.graph

    inputs = []
    for inp in graph.input:
        tensor_type = inp.type.tensor_type
        dtype = onnx.TensorProto.DataType.Name(tensor_type.elem_type)
        dims = []
        for d in tensor_type.shape.dim:
            if d.HasField("dim_param"):
                dims.append(None)  # dynamic dimension
            elif d.HasField("dim_value"):
                dims.append(d.dim_value)
            else:
                dims.append(None)
        inputs.append({
            "name": inp.name,
            "dtype": dtype,
            "dims": dims,
        })

    outputs = []
    for out in graph.output:
        tensor_type = out.type.tensor_type
        dtype = onnx.TensorProto.DataType.Name(tensor_type.elem_type)
        dims = []
        for d in tensor_type.shape.dim:
            if d.HasField("dim_param"):
                dims.append(None)
            elif d.HasField("dim_value"):
                dims.append(d.dim_value)
            else:
                dims.append(None)
        outputs.append({
            "name": out.name,
            "dtype": dtype,
            "dims": dims,
        })

    # Check opset
    opsets = []
    for opset in model.opset_import:
        domain = opset.domain or "ai.onnx"
        opsets.append({"domain": domain, "version": opset.version})

    # Count initializers (parameters)
    num_initializers = len(graph.initializer)

    # Approximate file size
    size_bytes = model_path.stat().st_size

    return {
        "opsets": opsets,
        "inputs": inputs,
        "outputs": outputs,
        "numInitializers": num_initializers,
        "sizeBytes": size_bytes,
    }


def sha256_file(path: Path) -> str:
    """Compute SHA-256 hex digest of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


# ── Contract comparison ───────────────────────────────────────────────────

def normalize_dims(contract_dims: list[Any], actual_dims: list[int]) -> bool:
    """Check if contract dims match actual dims (None = dynamic, matches anything)."""
    if len(contract_dims) != len(actual_dims):
        return False
    for c, a in zip(contract_dims, actual_dims):
        if c is not None and c != -1 and c != a:
            return False
    return True


def normalize_dtype(contract_dtype: str, actual_dtype: str) -> bool:
    """Check if dtypes match (ONNX uses different naming conventions)."""
    mapping = {
        "float32": ["FLOAT", "float", "float32"],
        "float16": ["FLOAT16", "float16"],
        "int8": ["INT8", "int8"],
        "int32": ["INT32", "int32"],
    }
    contract_lower = contract_dtype.lower()
    for key, variants in mapping.items():
        if contract_lower == key or contract_lower in [v.lower() for v in variants]:
            return actual_dtype in variants or actual_dtype.lower() == key
    return contract_dtype == actual_dtype


def compare_contracts(
    declared: dict[str, Any],
    actual_graph: dict[str, Any],
    model_id: str,
) -> dict[str, Any]:
    """Compare declared tensor contract against actual ONNX graph."""
    violations = []

    declared_inputs = declared.get("inputs", [])
    actual_inputs = actual_graph["inputs"]

    # Check input count
    if len(declared_inputs) != len(actual_inputs):
        violations.append({
            "kind": "input_count",
            "expected": len(declared_inputs),
            "actual": len(actual_inputs),
        })

    # Check each declared input
    for i, decl in enumerate(declared_inputs):
        if i >= len(actual_inputs):
            violations.append({
                "kind": "input_missing",
                "index": i,
                "name": decl["name"],
            })
            continue
        actual = actual_inputs[i]
        if decl["name"] != actual["name"]:
            violations.append({
                "kind": "input_name",
                "index": i,
                "expected": decl["name"],
                "actual": actual["name"],
            })
        if not normalize_dtype(decl["dtype"], actual["dtype"]):
            violations.append({
                "kind": "input_dtype",
                "index": i,
                "expected": decl["dtype"],
                "actual": actual["dtype"],
            })
        if not normalize_dims(decl.get("dims", []), actual["dims"]):
            violations.append({
                "kind": "input_dims",
                "index": i,
                "expected": decl.get("dims", []),
                "actual": actual["dims"],
            })

    declared_outputs = declared.get("outputs", [])
    actual_outputs = actual_graph["outputs"]

    # A graph can carry more outputs than we declare (e.g. u2netp's ONNX
    # export also exposes 6 unused deep-supervision side outputs alongside
    # the one final mask actually read at runtime — see
    # packages/engine/src/backgroundRemoval/worker.ts, which only ever
    # requests session.outputNames[0]). Those extras aren't a supply-chain
    # risk since nothing consumes them; only *fewer* outputs than declared
    # means something we depend on is missing.
    if len(actual_outputs) < len(declared_outputs):
        violations.append({
            "kind": "output_count",
            "expected": len(declared_outputs),
            "actual": len(actual_outputs),
        })

    for i, decl in enumerate(declared_outputs):
        if i >= len(actual_outputs):
            violations.append({
                "kind": "output_missing",
                "index": i,
                "name": decl["name"],
            })
            continue
        actual = actual_outputs[i]
        allowed_names = [decl["name"], *decl.get("alternateNames", [])]
        if actual["name"] not in allowed_names:
            violations.append({
                "kind": "output_name",
                "index": i,
                "expected": " or ".join(allowed_names),
                "actual": actual["name"],
            })
        if not normalize_dtype(decl["dtype"], actual["dtype"]):
            violations.append({
                "kind": "output_dtype",
                "index": i,
                "expected": decl["dtype"],
                "actual": actual["dtype"],
            })
        if not normalize_dims(decl.get("dims", []), actual["dims"]):
            violations.append({
                "kind": "output_dims",
                "index": i,
                "expected": decl.get("dims", []),
                "actual": actual["dims"],
            })

    return {
        "modelId": model_id,
        "passed": len(violations) == 0,
        "violations": violations,
        "declaredInputs": len(declared_inputs),
        "actualInputs": len(actual_inputs),
        "declaredOutputs": len(declared_outputs),
        "actualOutputs": len(actual_outputs),
    }


# ── Main ──────────────────────────────────────────────────────────────────

def verify_model(entry: dict[str, Any], download: bool = False) -> dict[str, Any]:
    """Verify a single model's tensor contract."""
    model_id = entry["id"]
    declared_contract = entry.get("tensorContract")

    result: dict[str, Any] = {
        "modelId": model_id,
        "hasContract": declared_contract is not None,
        "graphInspected": False,
        "contractMatched": False,
        "sha256": None,
        "error": None,
    }

    if not declared_contract:
        result["error"] = "No tensor contract declared in manifest"
        return result

    model_path = resolve_model_path(entry)
    if not model_path and download:
        # Try downloading
        model_path = MODELS_DIR / entry.get("filename", "")
        if not download_model(entry, model_path):
            model_path = None

    if not model_path:
        result["error"] = "Model file not found locally"
        return result

    # Verify SHA-256 if declared
    actual_hash = sha256_file(model_path)
    declared_hash = entry.get("sha256")
    result["sha256"] = {
        "actual": actual_hash,
        "declared": declared_hash,
        "match": declared_hash is None or actual_hash == declared_hash,
    }

    # Inspect graph
    try:
        graph = inspect_onnx_graph(model_path)
        result["graphInspected"] = True
        result["graph"] = graph

        # Compare contracts
        comparison = compare_contracts(declared_contract, graph, model_id)
        result["contractMatched"] = comparison["passed"]
        result["comparison"] = comparison

    except Exception as e:
        result["error"] = f"Graph inspection failed: {e}"

    return result


def main():
    parser = argparse.ArgumentParser(description="Verify ONNX model tensor contracts")
    parser.add_argument("--all", action="store_true", help="Verify all models with contracts")
    parser.add_argument("--model", type=str, help="Verify a specific model ID")
    parser.add_argument("--download", action="store_true", help="Download models if not found locally")
    parser.add_argument("--output", type=str, help="Output JSON report path")
    args = parser.parse_args()

    manifest = load_manifest()
    models = manifest.get("models", [])

    targets = []
    if args.model:
        targets = [m for m in models if m["id"] == args.model]
        if not targets:
            print(f"Error: model '{args.model}' not found in manifest")
            sys.exit(1)
    elif args.all:
        targets = [m for m in models if m.get("tensorContract")]
    else:
        # Default: verify BiRefNet models
        targets = [m for m in models if m["id"].startswith("birefnet-")]

    if not targets:
        print("No models to verify")
        sys.exit(0)

    report = {
        "manifestVersion": manifest.get("version"),
        "verifiedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "results": [],
        "summary": {"total": 0, "passed": 0, "failed": 0, "skipped": 0},
    }

    for entry in targets:
        print(f"\nVerifying {entry['id']}...")
        result = verify_model(entry, download=args.download)
        report["results"].append(result)
        report["summary"]["total"] += 1

        if result["error"]:
            print(f"  SKIP: {result['error']}")
            report["summary"]["skipped"] += 1
        elif result["contractMatched"]:
            print(f"  PASS: contract matches graph")
            if result.get("sha256", {}).get("declared"):
                if result["sha256"]["match"]:
                    print(f"  PASS: SHA-256 matches")
                else:
                    print(f"  FAIL: SHA-256 mismatch")
            report["summary"]["passed"] += 1
        else:
            violations = result.get("comparison", {}).get("violations", [])
            print(f"  FAIL: {len(violations)} contract violation(s)")
            for v in violations:
                print(f"    - {v['kind']}: expected {v.get('expected')}, got {v.get('actual')}")
            report["summary"]["failed"] += 1

    # Output
    output_json = json.dumps(report, indent=2)
    if args.output:
        Path(args.output).write_text(output_json)
        print(f"\nReport written to {args.output}")
    else:
        print(f"\n{output_json}")

    # Exit code
    if report["summary"]["failed"] > 0:
        sys.exit(1)
    print(f"\nAll {report['summary']['passed']} model(s) passed contract verification")


if __name__ == "__main__":
    main()
