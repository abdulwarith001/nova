#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Running lightweight secret scan..."

# Intentionally conservative patterns for obvious accidental leaks.
PATTERN='(sk-proj-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|[0-9]{8,}:[A-Za-z0-9_-]{30,}|SERPER_API_KEY[[:space:]]*=[[:space:]]*[a-f0-9]{32,}|OPENAI_API_KEY[[:space:]]*=[[:space:]]*sk-[A-Za-z0-9_-]{16,})'

if rg -n --pcre2 "$PATTERN" \
  --glob '!node_modules/**' \
  --glob '!**/dist/**' \
  --glob '!.nova/**' \
  --glob '!.git/**' \
  --glob '!**/*.map' \
  --glob '!config.example.toml' \
  --glob '!docs/**' \
  --glob '!examples/**'; then
  echo
  echo "Potential secret(s) found. Remove or rotate before publishing."
  exit 1
fi

echo "No obvious secrets detected."
