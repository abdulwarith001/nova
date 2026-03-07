#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "➡️  Switching Nova CLI to local repo build..."
echo "Repo: $REPO_ROOT"

cd "$REPO_ROOT"

echo "1) Building workspace..."
npm run build

echo "2) Linking package globally..."
npm link

echo
echo "✅ Done. Your global \`nova\` now points to this local repo."
echo "Tip: run \`hash -r\` in your shell if it still resolves an old path."
echo "Check: which nova && nova --version"
