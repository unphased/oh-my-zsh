#!/usr/bin/env bash
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$(cd -- "$here/.." && pwd)"
out_dir="$web_dir/vendor/xterm"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl not found" >&2
  exit 1
fi

mkdir -p "$out_dir"

version="${1:-latest}"

download_one() {
  local base="$1"
  local label="$2"

  echo "Trying ${label} (xterm@${version})..."
  if curl -fsSL "${base}/lib/xterm.js" -o "${out_dir}/xterm.js" && \
     curl -fsSL "${base}/css/xterm.css" -o "${out_dir}/xterm.css"; then
    printf "%s\n" "${version}" >"${out_dir}/VERSION"
    echo "OK: ${label}"
    return 0
  fi

  return 1
}

echo "Downloading xterm.js (${version}) into: $out_dir"

jsdelivr="https://cdn.jsdelivr.net/npm/xterm@${version}"
unpkg="https://unpkg.com/xterm@${version}"

if download_one "$jsdelivr" "jsdelivr"; then
  :
elif download_one "$unpkg" "unpkg"; then
  :
else
  echo "error: failed to download xterm assets (tried jsdelivr + unpkg)." >&2
  echo "hint: run with an explicit version, e.g.:" >&2
  echo "  ./scripts/fetch-xterm.sh 5.4.0" >&2
  exit 1
fi

echo "OK:"
echo "  ${out_dir}/xterm.js"
echo "  ${out_dir}/xterm.css"
echo "  ${out_dir}/VERSION"
