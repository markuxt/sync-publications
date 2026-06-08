# Sync Publications from OpenAlex

GitHub Action that fetches publications from [OpenAlex](https://openalex.org)
based on member ORCIDs and writes them to your content directory as
markdown. Each generated publication file includes the title, authors,
ORCIDs, year, DOI, venue, keywords, the reconstructed abstract, a
best-effort PDF link, and — when an open-access PDF is available — a
screenshot of the page containing the abstract.

## Features

- **ORCID-driven**: scans your existing member markdown for ORCIDs and
  fetches works per author from OpenAlex.
- **Institution-filtered**: uses your ROR ID so only papers affiliated
  with your institution are pulled.
- **Rich output**: frontmatter with title / authors / ORCIDs / year / DOI
  / venue / keywords / `pdf_url` / `abstract_page` / `abstract_screenshot`,
  plus the reconstructed abstract as the body text.
- **Abstract-page screenshot**: when an open-access PDF is available the
  action downloads it, locates the page containing the abstract, and
  renders a high-resolution PNG (≥ 1000 px shortest side).
- **Smart deduplication**: OpenAlex ID + normalised DOI + Jaccard title
  similarity with author overlap; CJK-safe tokenisation.
- **Local-first**: same code runs in GitHub Actions and on your laptop
  via `.env.development`.

## Quick start

### As a GitHub Action

```yaml
- uses: markuxt/sync-publications@v1
  with:
    ror_id: 'https://ror.org/03y4dt428'
    contact_email: 'contact@example.com'
    content_dir: 'src'
```

See the [Complete workflow example](#complete-workflow-example) below.

### Locally

```bash
pnpm install
cp .env.example .env.development
# edit .env.development — set ROR_ID and CONTACT_EMAIL
pnpm dev          # runs via tsx (no build step)
# or:
./test-local.sh           # preferred — wraps pnpm dev
./test-local.sh --build   # run compiled dist/index.js
```

You can also override any env var on the CLI:

```bash
ROR_ID=https://ror.org/other pnpm dev
```

## Inputs

### `ror_id` (required)

ROR ID of your institution. Find yours at <https://ror.org>.

### `contact_email` (required)

Contact email for OpenAlex's polite-pool policy.

### `content_dir` (optional, default `src`)

Path (relative to repo root or absolute) where members and publications
live. Member markdown goes in `<content_dir>/members/`, publications are
written to `<content_dir>/publications/`.

### `members_dir` (optional)

Override the members directory if your layout differs (e.g.
`content/people`). Both relative (resolved against the repo root) and
absolute paths work. Defaults to `<content_dir>/members`.

## Outputs

### `new_publications_count`

Number of new publication files written this run.

### `new_publications_files`

Newline-separated list of the file paths (delivered via the multi-line
heredoc format so nothing is truncated).

## Member file format

Member markdown files live under `<content_dir>/members/**/*.md` (or
`members_dir` if you overrode it). They must have an `orcid` field:

```yaml
---
name: John Doe
orcid: 0000-0001-2345-6789
---
```

Members with `_hidden: true` are skipped. ORCIDs are validated using the
ISO 7064 11-2 checksum; invalid ORCIDs are skipped with a warning so a
typo in one file can't poison the whole sync.

## Publication file format

Generated publications are written to:

```
<content_dir>/publications/<year>/<openalex_id>/index.md
<content_dir>/publications/<year>/<openalex_id>/abstract-page.png   (when an OA PDF was processed)
```

Each `index.md` looks like:

```yaml
---
_hidden: false
title: Publication Title
authors:
  - Doe, John
authors_orcid:
  - 0000-0001-2345-6789
  - null
year: 2024
doi: https://doi.org/10.1000/example
openalex_id: W123456789
venue: Conference Name 2024
pdf_url: https://example.com/paper.pdf
abstract_page: 1
abstract_screenshot: src/publications/2024/W123456789/abstract-page.png
keywords:
  - control systems
  - robotics
---

Abstract text reconstructed from OpenAlex's inverted index...
```

### Abstract-page screenshot requirements

- Rendered at 200 DPI via `pdftoppm` (poppler). At A4 that's ~1654 px on
  the shortest side — comfortably above the 1000 px minimum.
- **GitHub Actions runners** have `pdftoppm` preinstalled.
- **Locally on macOS** install it once: `brew install poppler`.
- If `pdftoppm` is unavailable the run still completes — the markdown is
  written with `pdf_url` and `abstract_page` populated but
  `abstract_screenshot` empty.

## Deduplication

Three layered checks (any match ⇒ skip):

1. **OpenAlex ID** (with or without leading `W`).
2. **Normalised DOI** (`https://doi.org/` / `https://dx.doi.org/` /
   `doi:` all collapse to lowercase bare form).
3. **Heuristic similarity**: years within 1, title Jaccard ≥ 0.85,
   author overlap ≥ 0.5.

CJK / Hangul / Kana titles are tokenised by character so non-Latin
papers don't collapse to an empty token set (which previously caused
false-positive dedup).

Within the pending batch, older versions of the same paper are marked
`_hidden: true`; only the newest visible copy is kept.

## Project layout

```
sync-publications/
├── src/
│   ├── index.ts              # Main entry — reads env, orchestrates the sync
│   ├── types.ts              # Shared TypeScript types
│   ├── utils/
│   │   ├── abstract.ts       # Reconstruct abstract from inverted index
│   │   ├── deduplication.ts  # Tokenisation, Jaccard, author overlap
│   │   ├── doi.ts            # DOI normalisation
│   │   ├── env.ts            # .env / .env.<NODE_ENV> loading
│   │   ├── github.ts         # GITHUB_OUTPUT writing (heredoc-aware)
│   │   ├── glob.ts           # Markdown file discovery
│   │   ├── http.ts           # fetch with timeout + backoff retry
│   │   ├── openalex.ts       # OpenAlex API client
│   │   ├── pdf.ts            # PDF download / text extraction / screenshot
│   │   ├── formatters.ts     # Author name / ORCID formatting
│   │   └── yaml.ts           # YAML frontmatter parse + stringify
│   ├── scanners/
│   │   ├── members.ts        # Scan members for ORCIDs
│   │   └── publications.ts   # Scan existing publications for dedup
│   └── workers/
│       ├── parser.ts         # OpenAlex work → PendingPublication
│       └── deduplicator.ts   # filter + dedup pending list
├── tests/                    # vitest test suite (140 tests)
├── action.yml                # GitHub Action metadata
├── dist/                     # Compiled bundle the node20 runtime loads
└── package.json
```

## Development

### Prerequisites

- Node.js ≥ 20.0.0
- pnpm (recommended) or npm
- (optional, for local screenshots) `poppler`: `brew install poppler`

### Scripts

```bash
pnpm install             # install deps
pnpm dev                 # run via tsx (no build step)
pnpm build               # compile src/ → dist/
pnpm start               # run compiled dist/index.js
pnpm test                # run vitest suite
pnpm test:watch          # interactive watch mode
pnpm test:coverage       # vitest with v8 coverage
./test-local.sh          # equivalent to pnpm dev with .env.development loaded
./test-local.sh --build  # same but using dist/index.js
```

### Environment files

- `.env.example` — committed template; documents every variable.
- `.env.development` — gitignored; this is what `pnpm dev` and
  `./test-local.sh` load automatically.
- `.env` — also accepted (lower priority than `.env.development`).

Existing `process.env` values always win, so
`ROR_ID=... pnpm dev` on the CLI beats `.env.development`.

### Building & releasing

`dist/` is intentionally tracked in git. GitHub Actions' node20 runtime
loads `dist/index.js` directly (see `action.yml`), so any PR that
changes `src/` must also rebuild `dist/` before merging.

```bash
pnpm build
git add dist/
git commit -m 'build: rebuild dist'
```

## Complete workflow example

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
      - uses: actions/checkout@v4

      - name: Sync publications from OpenAlex
        id: sync
        uses: markuxt/sync-publications@v1
        with:
          ror_id: 'https://ror.org/03y4dt428'
          contact_email: 'research-lab@example.com'
          content_dir: 'src'

      - name: Commit new publications
        env:
          COUNT: ${{ steps.sync.outputs.new_publications_count }}
          FILES: ${{ steps.sync.outputs.new_publications_files }}
        run: |
          if [ -n "$FILES" ]; then
            git config --local user.email "action@github.com"
            git config --local user.name "GitHub Action"
            git add src/publications/
            git commit -m "chore: sync $COUNT publication(s) from OpenAlex"
            git push
          fi
```

## License

Apache-2.0

## Support

For issues and questions, please use
[GitHub Issues](https://github.com/markuxt/sync-publications/issues).
