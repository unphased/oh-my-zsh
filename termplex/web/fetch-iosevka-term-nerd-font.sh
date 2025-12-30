#!/usr/bin/env bash
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$here/scripts/fetch-iosevka-term-nerd-font.sh" "$@"
