#!/bin/bash
#
# Local test runner for sync-publications.
#
# Loads environment from .env.development (preferred for local dev) or .env,
# exports the INPUT_* variables the action expects, and runs the action via
# `pnpm dev` (tsx) — no build step required.
#
# Usage:
#   ./scripts/test-local.sh
#   ./scripts/test-local.sh --build    # run dist/index.js instead (compiled output)

set -e

# Always run from the repo root so relative paths (.env.development, dist/)
# resolve correctly regardless of where this script is invoked from.
cd "$(dirname "$0")/.."

echo "🚀 Sync Publications from OpenAlex — Local Test"
echo "================================================"
echo ""

# Pick the env file: .env.development wins, .env as fallback
ENV_FILE=""
if [ -f .env.development ]; then
  ENV_FILE=".env.development"
elif [ -f .env ]; then
  ENV_FILE=".env"
else
  echo "❌ No .env / .env.development found."
  echo "   Copy .env.example to .env.development and fill in your values:"
  echo "     cp .env.example .env.development"
  exit 1
fi

echo "📝 Loading $ENV_FILE..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Validate required variables
if [ -z "$ROR_ID" ]; then
  echo "❌ ROR_ID is not set in $ENV_FILE"
  exit 1
fi
if [ -z "$CONTACT_EMAIL" ]; then
  echo "❌ CONTACT_EMAIL is not set in $ENV_FILE"
  exit 1
fi
if [ -z "$PUBLICATIONS_DIR" ]; then
  echo "⚠️  PUBLICATIONS_DIR not set, using default 'src/publications'"
  export PUBLICATIONS_DIR="src/publications"
fi

echo ""
echo "Configuration:"
echo "  ROR ID:      ${ROR_ID}"
echo "  Contact:     ${CONTACT_EMAIL}"
echo "  Publications dir: ${PUBLICATIONS_DIR}"
echo "  Members dir: ${MEMBERS_DIR:-src/members}"
echo ""

# Map "bare" env vars to the INPUT_* convention the action reads.
export INPUT_ROR_ID="${ROR_ID}"
export INPUT_CONTACT_EMAIL="${CONTACT_EMAIL}"
export INPUT_PUBLICATIONS_DIR="${PUBLICATIONS_DIR}"
export INPUT_MEMBERS_DIR="${MEMBERS_DIR:-}"
export GITHUB_OUTPUT="${GITHUB_OUTPUT:-}"

# Run via tsx (no build step needed) — fastest iteration.
if [ "${1:-}" = "--build" ]; then
  echo "🏗️  Running compiled dist/index.js"
  if [ ! -f dist/index.js ]; then
    echo "   dist/ missing — building first..."
    pnpm build > /dev/null
  fi
  node dist/index.js
else
  echo "🏃 Running via tsx (use --build to use compiled dist/)"
  pnpm dev
fi

echo ""
echo "✅ Test completed."
echo "Check '${PUBLICATIONS_DIR}/' for generated files."
