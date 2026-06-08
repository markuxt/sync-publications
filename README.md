# Sync Publications from OpenAlex

一个 GitHub Action，根据成员的 ORCID 从 [OpenAlex](https://openalex.org)
抓取论文并以 markdown 形式写入你的 content 目录。每篇生成的论文文件包含
标题、作者、ORCID、年份、DOI、期刊/会议、关键词、重建后的摘要、PDF
链接，以及——当开放获取的 PDF 可用时——摘要所在页的截图。

## 特性

- **ORCID 驱动**：扫描已有的成员 markdown 中的 ORCID，按作者从
  OpenAlex 拉取作品。
- **机构过滤**：通过 ROR ID 只拉取与本机构相关的论文。
- **丰富输出**：frontmatter 包含 title / authors / ORCIDs / year / DOI
  / venue / keywords / `pdf_url` / `abstract_page` /
  `abstract_screenshot`，正文是重建后的摘要。
- **摘要页截图**：当有开放获取 PDF 时，自动下载、定位含摘要的页码、
  渲染高分辨率 PNG（最短边 ≥ 1000 px）。
- **智能去重**：OpenAlex ID + 归一化 DOI + Jaccard 标题相似度 + 作者
  重叠度；CJK 安全的分词器。
- **本地优先**：同一份代码既能跑在 GitHub Actions 里，也能通过
  `.env.development` 跑在本地。

## 快速开始

### 作为 GitHub Action

```yaml
- uses: markuxt/sync-publications@v1
  with:
    ror_id: 'https://ror.org/03y4dt428'
    contact_email: 'contact@example.com'
    content_dir: 'src'
```

参见下方的[完整 workflow 示例](#完整-workflow-示例)。

### 本地运行

```bash
pnpm install
cp .env.example .env.development
# 编辑 .env.development — 填入 ROR_ID 和 CONTACT_EMAIL
pnpm dev          # 通过 tsx 运行（无需 build）
# 或：
./test-local.sh           # 推荐 —— 等价于 pnpm dev
./test-local.sh --build   # 跑编译后的 dist/index.js
```

也可以在命令行临时覆盖任何环境变量：

```bash
ROR_ID=https://ror.org/other pnpm dev
```

## 输入参数

### `ror_id`（必填）

机构的 ROR ID。可以在 <https://ror.org> 查询。

### `contact_email`（必填）

OpenAlex polite-pool 策略要求的联系邮箱。

### `content_dir`（可选，默认 `src`）

存放成员和论文的目录（相对仓库根目录或绝对路径）。成员 markdown 在
`<content_dir>/members/`，论文产物写到 `<content_dir>/publications/`。

### `members_dir`（可选）

如果你的目录结构不同（例如 `content/people`），可以覆盖默认的成员
目录。相对路径（相对仓库根目录）和绝对路径都支持。默认是
`<content_dir>/members`。

## 输出

### `new_publications_count`

本次运行写入的论文文件数。

### `new_publications_files`

新文件路径列表，换行分隔（通过多行 heredoc 格式输出，不会被截断）。

## 成员文件格式

成员 markdown 文件位于 `<content_dir>/members/**/*.md`（或你覆盖的
`members_dir`）。必须包含 `orcid` 字段：

```yaml
---
name: John Doe
orcid: 0000-0001-2345-6789
---
```

带 `_hidden: true` 的成员会被跳过。ORCID 会通过 ISO 7064 11-2 校验码
校验，非法 ORCID 会带 warning 跳过，单个文件的拼写错误不会污染整轮
同步。

## 论文文件格式

生成的论文文件写到：

```
<content_dir>/publications/<year>/<openalex_id>/index.md
<content_dir>/publications/<year>/<openalex_id>/abstract-page.png   （处理了 OA PDF 时才有）
```

每篇 `index.md` 长这样：

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

从 OpenAlex 倒排索引重建出来的摘要文本……
```

### 摘要页截图说明

- 通过 `pdftoppm`（poppler）以 200 DPI 渲染。A4 纸张下最短边约 1654
  px —— 远超 1000 px 下限。
- **GitHub Actions runner** 自带 `pdftoppm`。
- **macOS 本地** 需要安装一次：`brew install poppler`。
- 如果 `pdftoppm` 不可用，运行不会中断 —— markdown 仍会写出，只是
  填充了 `pdf_url` 和 `abstract_page` 而 `abstract_screenshot` 留空。

## 去重策略

三层叠加检查（任意命中 ⇒ 跳过）：

1. **OpenAlex ID**（带不带前导 `W` 都行）。
2. **归一化 DOI**（`https://doi.org/` / `https://dx.doi.org/` /
   `doi:` 都折叠成小写裸 DOI）。
3. **相似度启发式**：年份差 ≤ 1、标题 Jaccard ≥ 0.85、作者重叠 ≥ 0.5。

CJK / Hangul / Kana 标题按单字符切分，避免非拉丁文论文被分词成空集
（之前的实现因此误判成重复）。

同一批 pending 内，同一篇论文的旧版本会被打上 `_hidden: true`；只
保留最新版本可见。

## 项目结构

```
sync-publications/
├── src/
│   ├── index.ts              # 主入口 —— 读环境变量，编排整个同步流程
│   ├── types.ts              # 共享 TypeScript 类型
│   ├── utils/
│   │   ├── abstract.ts       # 从倒排索引重建摘要
│   │   ├── deduplication.ts  # 分词、Jaccard、作者重叠
│   │   ├── doi.ts            # DOI 归一化
│   │   ├── env.ts            # 加载 .env / .env.<NODE_ENV>
│   │   ├── github.ts         # 写 GITHUB_OUTPUT（支持 heredoc）
│   │   ├── glob.ts           # markdown 文件发现
│   │   ├── http.ts           # fetch + 超时 + 退避重试
│   │   ├── openalex.ts       # OpenAlex API 客户端
│   │   ├── pdf.ts            # PDF 下载 / 文本提取 / 截图
│   │   ├── formatters.ts     # 作者名 / ORCID 格式化
│   │   └── yaml.ts           # YAML frontmatter 解析 + 序列化
│   ├── scanners/
│   │   ├── members.ts        # 扫描成员的 ORCID
│   │   └── publications.ts   # 扫描已有论文用于去重
│   └── workers/
│       ├── parser.ts         # OpenAlex work → PendingPublication
│       └── deduplicator.ts   # 过滤 + 去重 pending 列表
├── tests/                    # vitest 测试套件（140 个测试）
├── action.yml                # GitHub Action 元数据
├── dist/                     # node20 运行时加载的编译产物
└── package.json
```

## 开发

### 前置要求

- Node.js ≥ 20.0.0
- pnpm（推荐）或 npm
- （可选，本地需要截图时）`poppler`：`brew install poppler`

### 脚本

```bash
pnpm install             # 安装依赖
pnpm dev                 # 通过 tsx 运行（无需 build）
pnpm build               # 编译 src/ → dist/
pnpm start               # 跑编译后的 dist/index.js
pnpm test                # 跑 vitest 测试套件
pnpm test:watch          # 交互式 watch 模式
pnpm test:coverage       # vitest + v8 覆盖率
./test-local.sh          # 等价于 pnpm dev，自动加载 .env.development
./test-local.sh --build  # 同上，但跑的是 dist/index.js
```

### 环境变量文件

- `.env.example` —— 提交到仓库的模板，列出所有变量。
- `.env.development` —— gitignored；`pnpm dev` 和 `./test-local.sh`
  自动加载这个文件。
- `.env` —— 也支持（优先级低于 `.env.development`）。

已存在的 `process.env` 值永远优先，所以命令行里写
`ROR_ID=... pnpm dev` 会覆盖 `.env.development` 的值。

### 构建与发布

`dist/` 是有意提交到仓库的。GitHub Actions 的 node20 运行时直接加载
`dist/index.js`（见 `action.yml`），所以任何改动 `src/` 的 PR 在
合并前都必须重新构建 `dist/`。

```bash
pnpm build
git add dist/
git commit -m 'build: rebuild dist'
```

## 完整 workflow 示例

```yaml
name: Sync Publications

on:
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * 0'  # 每周日凌晨

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

## 支持

如遇问题请到
[GitHub Issues](https://github.com/markuxt/sync-publications/issues)
反馈。
