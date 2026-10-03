#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  export PATH="/Users/northside/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
fi
export NORTHSIDE_FIXTURES=1
exec node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000
