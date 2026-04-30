#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Backend tests (pytest) ==="
cd "$ROOT"
uv run pytest -v

echo ""
echo "=== Frontend tests (vitest) ==="
cd "$ROOT/frontend"
npx vitest run
