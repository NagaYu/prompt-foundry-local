#!/usr/bin/env bash
# =============================================================================
# download-model.sh — bundle a model locally for a FULLY offline first run.
#
# After running this, set  USE_LOCAL_MODEL = true  near the top of app.js and the
# very first launch will need ZERO network (no CDN, no Hugging Face).
#
# Usage:
#   ./download-model.sh                                   # default: Qwen2.5-0.5B
#   ./download-model.sh onnx-community/Qwen2.5-1.5B-Instruct
#
# Requires: git + git-lfs  (https://git-lfs.com)  — or set DL=curl to use curl.
# =============================================================================
set -euo pipefail

MODEL_ID="${1:-onnx-community/Qwen2.5-0.5B-Instruct}"
DEST="models/${MODEL_ID}"

echo "⚒️  PromptFoundry Local — bundling model: ${MODEL_ID}"
echo "    → ${DEST}"

mkdir -p "${DEST}/onnx"

# Files Transformers.js needs (config + tokenizer + ONNX weights for WebGPU & WASM).
BASE="https://huggingface.co/${MODEL_ID}/resolve/main"
ROOT_FILES=(config.json tokenizer.json tokenizer_config.json generation_config.json special_tokens_map.json vocab.json merges.txt)
ONNX_FILES=(model_q4f16.onnx model_q4.onnx)

fetch() {  # fetch <url> <out>  (skips if already present, tolerates optional files)
  local url="$1" out="$2"
  [ -f "$out" ] && { echo "    ✓ $(basename "$out") (cached)"; return 0; }
  echo "    ↓ $(basename "$out")"
  curl -fsSL "$url" -o "$out" || echo "    ⚠ skipped (not in repo): $(basename "$out")"
}

for f in "${ROOT_FILES[@]}"; do fetch "${BASE}/${f}" "${DEST}/${f}"; done
for f in "${ONNX_FILES[@]}"; do fetch "${BASE}/onnx/${f}" "${DEST}/onnx/${f}"; done

cat <<EOF

✅ Done. Model bundled under ./${DEST}

Next:
  1. Open app.js and set:   const USE_LOCAL_MODEL = true;
  2. Serve the folder:       python3 -m http.server 8000
  3. Open http://localhost:8000  — first run is now 100% offline.
EOF
