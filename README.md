# Sync Publications from OpenAlex

GitHub Action to automatically fetch publications from OpenAlex based on member ORCIDs and sync them to your content directory.

## Features

- **Automatic Sync**: Fetches publications for all members with ORCID from OpenAlex API
- **Smart Deduplication**: Prevents duplicates using OpenAlex ID, DOI, and similarity matching
- **Markdown Generation**: Creates publication markdown files with full metadata
- **Rich Metadata**: Includes title, authors, ORCIDs, year, DOI, venue, keywords, and abstract
- **Targeted Filtering**: Only fetches publications affiliated with your institution

## Development

### Prerequisites

- Node.js >= 20.0.0
- pnpm (recommended) or npm

### Setup

1. Clone the repository:
```bash
git clone https://github.com/markuxt/sync-publications.git
cd sync-publications
```

2. Install dependencies:
```bash
pnpm install
```

3. Configure environment variables:
```bash
cp .env.example .env
nano .env  # Edit with your configuration
```

### Local Testing

There are two ways to test the action locally:

#### Option 1: Using the test script (Recommended)

```bash
./test-local.sh
```

This script will:
- Load configuration from `.env`
- Validate required variables
- Run the action with your local content directory
- Show detailed output

#### Option 2: Manual environment variables

```bash
export ROR_ID="https://ror.org/03y4dt428"
export CONTACT_EMAIL="your-email@example.com"
export CONTENT_DIR="src"

pnpm dev
```

### Building

```bash
pnpm build
```

This will compile TypeScript to JavaScript in the `dist/` directory.

### Project Structure

```
sync-publications/
├── src/
│   ├── index.ts              # Main entry point
│   ├── types.ts              # Type definitions
│   ├── utils/                # Utility functions
│   ├── scanners/             # Content scanners
│   └── workers/              # Business logic
├── action.yml                # GitHub Action config
├── package.json              # Node.js configuration
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## Usage

### Basic Example

```yaml
- name: Sync publications from OpenAlex
  uses: markuxt/sync-publications@v1
  with:
    ror_id: 'https://ror.org/03y4dt428'
    contact_email: 'contact@example.com'
    content_dir: 'src'
```

### Complete Workflow Example

```yaml
name: Sync Publications

on:
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sundays

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Sync publications from OpenAlex
        uses: markuxt/sync-publications@v1
        with:
          ror_id: 'https://ror.org/03y4dt428'
          contact_email: 'research-lab@example.com'
          content_dir: 'src'

      - name: Commit new publications
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add src/publications/
          git diff --staged --quiet || git commit -m "chore: sync publications from OpenAlex"
          git push
```

## Inputs

### `ror_id` (required)

ROR ID of your institution. This ensures only publications affiliated with your institution are fetched.

**Example**: `https://ror.org/03y4dt428`

Find your ROR ID at [https://ror.org](https://ror.org).

### `contact_email` (required)

Contact email for OpenAlex API requests. Required by OpenAlex's polite usage policy.

**Example**: `research-lab@example.com`

### `content_dir` (optional)

Path to your content directory where member and publication files are stored.

**Default**: `src`

**Example**: `content`

## Outputs

### `new_publications_count`

Number of new publication files added during the sync.

### `new_publications_files`

List of new publication file paths (newline-separated).

## Member File Format

Your member markdown files should include the `orcid` field:

```yaml
---
name: John Doe
orcid: 0000-0001-2345-6789
---
```

Only members with an ORCID will have their publications fetched.

## Publication File Format

Generated publication files follow this structure:

```bash
src/publications/
└── {year}/
    └── {openalex_id}/
        └── index.md
```

Each file contains:

```yaml
---
_hidden: false
title: Publication Title
authors:
  - LastName, FirstName
authors_orcid:
  - 0000-0001-2345-6789
  - null
year: 2024
doi: https://doi.org/10.1000/example
openalex_id: W123456789
venue: Conference Name 2024
keywords:
  - control systems
  - robotics
---

Abstract text here...
```

## Deduplication Strategy

The action uses multiple strategies to avoid duplicates:

1. **OpenAlex ID**: Existing publications with the same OpenAlex ID are skipped
2. **DOI**: Publications with matching DOIs are skipped
3. **Similarity Matching**: Uses Jaccard similarity on titles and author overlap for fuzzy matching
4. **Within-batch Dedup**: Identifies duplicates within newly fetched publications, keeping the newest version

## Requirements

- GitHub Actions runner with Node.js
- Member files in `{content_dir}/members/**/*.md` with `orcid` field
- Publications directory at `{content_dir}/publications/`

## License

Apache-2.0

## Support

For issues and questions, please use [GitHub Issues](https://github.com/markuxt/sync-publications/issues).
