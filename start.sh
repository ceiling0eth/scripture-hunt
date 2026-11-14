#!/bin/sh
# Serve Scripture Search locally. Open http://127.0.0.1:8765 after running this.
cd "$(dirname "$0")" || exit 1
exec python3 -m http.server 8765 --bind 127.0.0.1
