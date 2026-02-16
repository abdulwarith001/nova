#!/bin/bash

echo "🧪 Nova CLI Test Suite"
echo ""

cd cli || exit 1

echo "1️⃣  Building CLI..."
npm run build
echo "✅ Build complete"
echo ""

echo "2️⃣  Testing CLI commands..."
echo ""

echo "Test: nova --help"
node dist/index.js --help
echo ""

echo "Test: nova --version"
node dist/index.js --version
echo ""

echo "Test: nova daemon status"
node dist/index.js daemon status
echo ""

echo "Test: nova config --show"
node dist/index.js config --show
echo ""

echo "✅ All tests complete!"
