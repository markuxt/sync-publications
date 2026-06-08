.PHONY: help dev build watch test lint format clean install

# Default target
help:
	@echo "Available commands:"
	@echo "  make dev       - Run the action locally (requires .env)"
	@echo "  make build     - Compile TypeScript to JavaScript"
	@echo "  make watch     - Watch mode for TypeScript compilation"
	@echo "  make test      - Run tests"
	@echo "  make lint      - Run linter"
	@echo "  make format    - Format code"
	@echo "  make clean     - Clean build artifacts"
	@echo "  make install   - Install dependencies"

# Run the action locally
dev:
	@./test-local.sh

# Alternative dev command without test script
dev-manual:
	@echo "Make sure to set environment variables first:"
	@echo "  export ROR_ID='https://ror.org/...'"
	@echo "  export CONTACT_EMAIL='your-email@example.com'"
	@echo "  export CONTENT_DIR='src'"
	@echo ""
	npx tsx src/index.ts

# Build TypeScript
build:
	npx tsc

# Watch mode
watch:
	npx tsc --watch

# Run tests
test:
	npm test

# Lint code
lint:
	npm run lint

# Format code
format:
	npm run format

# Clean build artifacts
clean:
	rm -rf dist/
	rm -rf *.tsbuildinfo

# Install dependencies
install:
	pnpm install
