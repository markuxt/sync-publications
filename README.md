# Sync Publications from OpenAlex

A GitHub Action that fetches publications from [OpenAlex](https://openalex.org)
based on your members' ORCIDs and writes them to your content directory as
markdown. Each generated publication file contains the title, authors, ORCIDs,
year, DOI, venue, keywords, a reconstructed abstract, the PDF link, and — when
an open-access PDF is available — a screenshot of the page containing the
abstract.

## Features

- **ORCID-driven**: scans existing member markdown for ORCIDs and pulls works
  per author from OpenAlex.
- **Institution filter**: only fetches publications affiliated with your
  institution via its ROR ID.
- **Rich output**: frontmatter includes title / authors / ORCIDs / year / DOI
  / venue / keywords / `pdf_url` / `abstract_page` /
  `abstract_screenshot`; the body is the reconstructed abstract.
- **Abstract-page screenshot**: when an open-access PDF is available, it is
  downloaded, the page containing the abstract is located, and a
  high-resolution PNG is rendered (shortest side ≥ 1000 px).
- **Smart deduplication**: OpenAlex ID + normalized DOI + Jaccard title
  similarity + author overlap; a CJK-safe tokenizer.
- **Local-first**: the same code runs in GitHub Actions and locally via
  `.env.development`.

## Quick start

### As a GitHub Action

```yaml
- uses: markuxt/sync-publications@v1
  with:
    ror_id: 'https://ror.org/03y4dt428'
    contact_email: 'contact@example.com'
    content_dir: 'src'
```

See the [full workflow example](#full-workflow-example) below.

### Run locally

```bash
pnpm install
cp .env.example .env.development
# Edit .env.development — fill in ROR_ID and CONTACT_EMAIL
pnpm dev          # run via tsx (no build needed)
# or:
./scripts/test-local.sh           # recommended — equivalent to pnpm dev
./scripts/test-local.sh --build   # run the compiled dist/index.cjs
```

You can also override any environment variable on the command line:

```bash
ROR_ID=https://ror.org/other pnpm dev
```

## Inputs

### `ror_id` (required)

The institution's ROR ID. Look yours up at <https://ror.org>.

### `contact_email` (required)

The contact email required by OpenAlex's polite-pool policy.

### `content_dir` (optional, default `src`)

The directory holding members and publications (relative to the repo root or
absolute). Member markdown lives under `<content_dir>/members/`; publication
artifacts are written to `<content_dir>/publications/`.

### `members_dir` (optional)

Override the default members directory if your layout differs (e.g.
`content/people`). Both relative (to the repo root) and absolute paths are
supported. Defaults to `<content_dir>/members`.

## Outputs

### `new_publications_count`

The number of publication files written by this run.

### `new_publications_files`

A newline-separated list of new file paths (emitted via a multi-line heredoc
format so it is never truncated).

## Member file format

Member markdown files live at `<content_dir>/members/**/*.md` (or your
overridden `members_dir`). They must contain an `orcid` field:

```yaml
---
name: John Doe
orcid: 0000-0001-2345-6789
---
```

Members with `_hidden: true` are skipped. ORCIDs are validated via the ISO 7064
11-2 check digit; an invalid ORCID is skipped with a warning, so a typo in one
file won't poison the whole sync.

## Publication file format

Generated publication files are written to a **flat layout** (one `.md` per
publication, no subdirectory):

```text
<content_dir>/publications/<year>/<title-slug>.md
<content_dir>/publications/<year>/<title-slug>.png   (only when an OA PDF was processed)
```

The filename is a slugified form of the title (lowercase / whitespace and
punctuation → `-` / CJK preserved / capped at 80 chars), falling back to the
OpenAlex ID when the title is empty, and appending a `-<shortId>` suffix on
collisions within the same year directory. See `src/utils/slugify.ts`.

Each `<title-slug>.md` looks like:

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
abstract_screenshot: src/publications/2024/publication-title.png
keywords:
  - control systems
  - robotics
---

The reconstructed abstract text, rebuilt from OpenAlex's inverted index…
```

### Abstract-page screenshot notes

- Rendered via `pdftoppm` (poppler) at 200 DPI. On A4 paper the shortest side
  is roughly 1654 px — well above the 1000 px minimum.
- **GitHub Actions runners** ship with `pdftoppm`.
- **macOS locally** requires a one-time install: `brew install poppler`.
- If `pdftoppm` is unavailable, the run is not interrupted — the markdown is
  still written, with `pdf_url` and `abstract_page` populated but
  `abstract_screenshot` left empty.

## Deduplication strategy

Three layered checks (a hit on any one ⇒ skipped):

1. **OpenAlex ID** (with or without a leading `W`).
2. **Normalized DOI** (`https://doi.org/` / `https://dx.doi.org/` / `doi:` are
   all folded into a lowercase bare DOI).
3. **Similarity heuristic**: year difference ≤ 1, title Jaccard ≥ 0.85, author
   overlap ≥ 0.5.

CJK / Hangul / Kana titles are tokenized per character, so non-Latin
publications aren't tokenized into the empty set (a previous implementation
falsely flagged these as duplicates).

**Author deduplication**: OpenAlex's `authorships` are expanded by
(author × institution), so the same person can appear multiple times. The
`parser` deduplicates on two keys at parse time — ORCID (preferred) and name
(fallback) — keeping the `authors` and `authors_orcid` arrays parallel and
preserving the first-seen spelling.

Within the same pending batch, older versions of the same publication are
marked `_hidden: true`; only the newest version stays visible.

## Project structure

```text
sync-publications/
├── src/
│   ├── index.ts              # main entry — reads env vars, orchestrates the sync
│   ├── types.ts              # shared TypeScript types
│   ├── utils/
│   │   ├── abstract.ts       # rebuilds the abstract from the inverted index
│   │   ├── deduplication.ts  # tokenization, Jaccard, author overlap
│   │   ├── doi.ts            # DOI normalization
│   │   ├── env.ts            # loads .env / .env.<NODE_ENV>
│   │   ├── github.ts         # writes GITHUB_OUTPUT (heredoc-aware)
│   │   ├── glob.ts           # markdown file discovery
│   │   ├── http.ts           # fetch + timeout + backoff retry
│   │   ├── openalex.ts       # OpenAlex API client
│   │   ├── pdf.ts            # PDF download / text extraction / screenshot
│   │   ├── formatters.ts     # author-name / ORCID formatting
│   │   └── yaml.ts           # YAML frontmatter parse + serialize
│   ├── scanners/
│   │   ├── members.ts        # scans members for ORCIDs
│   │   └── publications.ts   # scans existing publications for dedup
│   └── workers/
│       ├── parser.ts         # OpenAlex work → PendingPublication
│       └── deduplicator.ts   # filters + dedupes the pending list
├── tests/                    # vitest suite (140 tests)
├── action.yml                # GitHub Action metadata
├── dist/                     # compiled artifact loaded by the node24 runtime
└── package.json
```

## Development

### Prerequisites

- Node.js ≥ 24.0.0
- pnpm (recommended) or npm
- (optional, for local screenshots) `poppler`: `brew install poppler`

### Scripts

```bash
pnpm install             # install dependencies
pnpm dev                 # run via tsx (no build needed)
pnpm build               # bundle to a single self-contained dist/index.cjs (esbuild, all deps inlined)
pnpm start               # run the compiled dist/index.cjs
pnpm test                # run the vitest suite
pnpm test:watch          # interactive watch mode
pnpm test:coverage       # vitest + v8 coverage
./scripts/test-local.sh          # equivalent to pnpm dev, auto-loads .env.development
./scripts/test-local.sh --build  # same, but runs dist/index.cjs
```

### Environment variable files

- `.env.example` — committed template listing all variables.
- `.env.development` — gitignored; auto-loaded by `pnpm dev` and
  `./scripts/test-local.sh`.
- `.env` — also supported (lower priority than `.env.development`).

Existing `process.env` values always win, so `ROR_ID=... pnpm dev` on the
command line overrides the value in `.env.development`.

### Build & release

`dist/` is intentionally committed. `pnpm build` uses
[esbuild](https://esbuild.github.io) to bundle `src/index.ts` together with all
dependencies (`dotenv` / `glob` / `unpdf` / `yaml`) into a **single
self-contained `dist/index.cjs`**. GitHub Actions' node24 runtime loads it
directly (see `action.yml`) and **does not need `node_modules`** at runtime.
Because of this, any PR that changes `src/` must rebuild `dist/` before merge.

```bash
pnpm build
git add dist/
git commit -m 'build: rebuild dist'
```

## Full workflow example

```yaml
name: Sync Publications

on:
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * 0'  # every Sunday at midnight UTC

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

For issues, please report them at
[GitHub Issues](https://github.com/markuxt/sync-publications/issues).
