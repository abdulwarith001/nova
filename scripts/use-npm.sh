#!/usr/bin/env bash
set -euo pipefail

PKG_NAME="novaa-agent"
VERSION="${1:-latest}"

echo "➡️  Switching Nova CLI back to npm package (${PKG_NAME}@${VERSION})..."

echo "1) Removing global link (if present)..."
npm unlink -g "$PKG_NAME" >/dev/null 2>&1 || true

echo "2) Installing published package..."
npm install -g "${PKG_NAME}@${VERSION}"

echo
echo "✅ Done. Your global \`nova\` now uses npm package ${PKG_NAME}@${VERSION}."
echo "Tip: run \`hash -r\` in your shell if it still resolves an old path."
echo "Check: which nova && nova --version"
