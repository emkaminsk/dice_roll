#!/bin/sh
# Cache-bust local JS/CSS references in a deployed index.html: x.js -> x.js?v=<version>.
# Usage: stamp_assets.sh <index.html> <version>
# Run on the deployed copy (never on the repo's index.html) so the repo stays clean.
set -eu
file="$1"; ver="$2"
case "$ver" in *[!0-9a-zA-Z]*|'') echo "bad version: $ver" >&2; exit 1;; esac
# Only relative (non-URL) .js/.css refs in src= / href=; already-stamped refs are skipped.
sed -E -i "s#((src|href)=\"[^\":?]+\.(js|css))\"#\1?v=${ver}\"#g" "$file"
