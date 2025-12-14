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

version="5.5.0"
base="https://cdn.jsdelivr.net/npm/xterm@${version}"

echo "Downloading xterm.js ${version} into: $out_dir"
curl -fsSL "${base}/lib/xterm.js" -o "${out_dir}/xterm.js"
curl -fsSL "${base}/css/xterm.css" -o "${out_dir}/xterm.css"

echo "OK:"
echo "  ${out_dir}/xterm.js"
echo "  ${out_dir}/xterm.css"
