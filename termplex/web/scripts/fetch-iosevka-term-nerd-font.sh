#!/usr/bin/env bash
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$(cd -- "$here/.." && pwd)"
out_dir="$web_dir/vendor/fonts/iosevka-term-nerd"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl not found" >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "error: unzip not found" >&2
  exit 1
fi

mkdir -p "$out_dir"

version="${1:-latest}"
zip_name="IosevkaTerm.zip"

url="https://github.com/ryanoasis/nerd-fonts/releases/${version}/download/${zip_name}"
if [[ "$version" == "latest" ]]; then
  url="https://github.com/ryanoasis/nerd-fonts/releases/latest/download/${zip_name}"
fi

tmp="$(mktemp -t iosevka-nerd-font.XXXXXX.zip)"
trap 'rm -f "$tmp"' EXIT

echo "Downloading IosevkaTerm Nerd Font (${version})..."
echo "  ${url}"
curl -fL --retry 3 --retry-delay 1 -o "$tmp" "$url"

echo "Extracting into: $out_dir"
rm -f \
  "$out_dir/IosevkaTermNerdFont-Regular.ttf" \
  "$out_dir/IosevkaTermNerdFontMono-Regular.ttf" \
  "$out_dir/VERSION" \
  "$out_dir/SOURCE_URL"

# Keep it minimal: regular is enough for xterm.js in this viewer.
unzip -j -o "$tmp" \
  "IosevkaTermNerdFont-Regular.ttf" \
  "IosevkaTermNerdFontMono-Regular.ttf" \
  -d "$out_dir" >/dev/null

printf "%s\n" "${version}" >"$out_dir/VERSION"
printf "%s\n" "${url}" >"$out_dir/SOURCE_URL"

echo "OK:"
ls -1 "$out_dir" | sed 's/^/  /'
