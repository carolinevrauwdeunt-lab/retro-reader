#!/usr/bin/env bash
set -euo pipefail

# Retro Reader — First-time setup
# Usage: ./setup.sh

echo "=== Retro Reader Setup ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required. Install it from https://nodejs.org/"; exit 1; }

echo "Node.js found: $(node --version)"
echo ""
echo "No dependencies to install — Retro Reader uses only Node's built-in modules."
echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Run: node server.js"
echo "  2. Open: http://localhost:3334"
echo "  3. On macOS, you can instead double-click 'Start RSS Reader.command'"
echo "  4. Using Claude Code? CLAUDE.md has all the context."
