#!/bin/bash

# Local test script for sync-publications action
# This script allows you to test the action locally without GitHub Actions

set -e

echo "🚀 Sync Publications from OpenAlex - Local Test"
echo "================================================"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
  echo "❌ Error: .env file not found"
  echo "Please copy .env.example to .env and fill in your values:"
  echo "  cp .env.example .env"
  echo "  nano .env"
  exit 1
fi

# Load environment variables from .env
echo "📝 Loading configuration from .env..."
export $(grep -v '^#' .env | xargs)

# Validate required variables
if [ -z "$ROR_ID" ]; then
  echo "❌ Error: ROR_ID is not set in .env"
  exit 1
fi

if [ -z "$CONTACT_EMAIL" ]; then
  echo "❌ Error: CONTACT_EMAIL is not set in .env"
  exit 1
fi

if [ -z "$CONTENT_DIR" ]; then
  echo "⚠️  Warning: CONTENT_DIR not set, using default 'src'"
  export CONTENT_DIR="src"
fi

echo ""
echo "Configuration:"
echo "  ROR ID: ${ROR_ID}"
echo "  Contact: ${CONTACT_EMAIL}"
echo "  Content Dir: ${CONTENT_DIR}"
echo ""

# Check if content directory exists
if [ ! -d "${CONTENT_DIR}" ]; then
  echo "❌ Error: Content directory '${CONTENT_DIR}' not found"
  echo "Please make sure you're running this from the project root"
  exit 1
fi

# Set GitHub-specific environment variables for local testing
export INPUT_ROR_ID="${ROR_ID}"
export INPUT_CONTACT_EMAIL="${CONTACT_EMAIL}"
export INPUT_CONTENT_DIR="${CONTENT_DIR}"
export GITHUB_OUTPUT=""

echo "🔍 Scanning for members with ORCID..."
echo ""

# Run the action
npx tsx src/index.ts

echo ""
echo "✅ Test completed!"
echo "Check the '${CONTENT_DIR}/publications/' directory for generated files."
