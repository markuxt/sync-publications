# 代码审查报告：sync-publications

- **审查日期**：2026-06-08
- **仓库**：markuxt/sync-publications
- **审查范围**：`src/` 全量源码 + `action.yml` / `tsconfig.json` / `package.json` / `test-local.sh` / `README.md` / `Makefile`
- **当前提交**：`a2d1aef`（branch: `main`）

## 总体印象

整体架构清晰，分层合理（`scanners` / `workers` / `utils`），类型定义完整，OpenAlex 的游标分页和 polite pool（mailto + User-Agent）处理得当。但存在几个**会导致 Action 在生产环境直接失效的严重问题**，集中在「构建/发布链路」和「GitHub Actions 输出契约」上；去重逻辑里还有一个针对非英文标题的潜在数据正确性 bug。

---

## 🔴 严重问题（会导致功能失效）

### 1. action.yml 入口指向 TypeScript 源码，node20 无法执行
`action.yml:33` — `main: 'src/index.ts'`

GitHub Actions 的 `node20` runtime 用原生 Node 执行 `main` 指向的文件，而 `.ts` 不是合法 JS，会直接语法错误退出。仓库里也没有 `@vercel/ncc` 打包步骤、没有 release workflow 把 `tsc` 产物写回 `action.yml`。`package.json:7` 的 `main` 同样指向 `src/index.ts`。

**结论**：发布出去的 Action 跑不起来。需要：要么 `tsc` 编译后 `main: 'dist/index.js'` 并把 `dist/` 纳入仓库（这是 composite/JS action 的常规做法），要么用 `ncc` 打成单文件 bundle。

### 2. `tsc` 构建当前会失败（deprecation 已升级为 error）
`tsconfig.json:6,18`

实测 `npx tsc --noEmit` 输出：

```
tsconfig.json(6,25): error TS5107: Option 'moduleResolution=node10' is deprecated ...
tsconfig.json(18,5): error TS5101: Option 'baseUrl' is deprecated ...
```

TS 5.6+ 把这两项（`moduleResolution: "node"`、`baseUrl`）的弃用升级为编译错误。这意味着 `pnpm build` 退出非零、`dist/` 不会生成 —— 和问题 1 叠加，整条「构建 → 发布」链路是断的。

修复：`moduleResolution` 改为 `"bundler"` 或 `"nodenext"`（配合现有 `.js` 后缀的 ESM import 更合适），并评估是否还需要 `baseUrl`（`paths` 用得不多，可以去掉）。

### 3. action.yml 声明的 outputs 与代码写入的 output 名不一致
`action.yml:21-22` 声明 `new_publications_count` / `new_publications_files`，
而 `src/index.ts:173-174` 写入的是 `count` / `files`：

```ts
setOutput('count', String(newFiles.length))
setOutput('files', newFiles.join('\n'))
```

下游 step 若按文档用 `${{ steps.x.outputs.new_publications_count }}` 会拿到空值。两处名字需要对齐（建议改代码侧去匹配 `action.yml` 的公开契约，因为 README 已经文档化了那两个名字）。

### 4. 多行 output 未用 heredoc 分隔符，会被截断
`src/utils/github.ts:21`

```ts
appendFileSync(githubOutputPath, `${name}=${value}\n`)
```

`files` 这个 output 用 `\n` 拼接了多个文件路径。GitHub 对 `$GITHUB_OUTPUT` 的 `name=value` 解析是**按行**的，多行 value 必须用分隔符格式：

```
files<<EOF
path1
path2
EOF
```

否则只有第一行被读作 `files` 的值。这是 [GitHub 官方文档](https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions#multiline-strings)明确要求的。建议让 `setOutput` 自动检测包含换行时切换 heredoc 写法。

### 5. README「手动 env」示例与代码读取的环境变量名不符
`README.md:56-63`（Option 2）写：

```bash
export CONTENT_DIR="src"
pnpm dev
```

但 `src/index.ts:43-45` 读的是 `INPUT_ROR_ID` / `INPUT_CONTACT_EMAIL` / `INPUT_CONTENT_DIR`。照 README 直接 export 会让 `ROR_ID` 为空，立即 `process.exit(1)`。`test-local.sh:56-58` 做了正确的映射，所以只有 README 的 Option 2 是错的。建议改成 `INPUT_*` 或在文档里说明用 test 脚本。

---

## 🟠 数据正确性 Bug

### 6. 非英文（CJK 等）标题会触发误判去重
`src/utils/deduplication.ts:14-21`（tokenize）+ `:27`（jaccard）

`tokenize` 用 `replace(/[^a-z0-9\s]/g, ' ')` 把所有非 ASCII 字符抹掉。纯中文/日文标题 token 化后得到**空 Set**，而 `jaccardSimilarity` 对两个空集合返回 `1`：

```ts
if (a.size === 0 && b.size === 0) return 1
```

于是 `isDuplicate` 中 `titleSim >= 0.85` 恒成立。由于本 Action 是**按作者逐个拉取作品**，同一作者的多篇论文作者重叠度天然很高（往往 ≥ 0.5），这会导致同一作者的多篇非英文论文被互相判为重复、除最新外全部标记 `hidden`。

修复方向：空集时返回 `0`（而非 `1`）；或对 CJK 做按字符/双字符切分；或当任一标题全非拉丁时回退到更严格的精确匹配。

---

## 🟡 健壮性 / 可靠性

### 7. `fetch` 没有超时、没有重试
`src/utils/openalex.ts:19`

OpenAlex 偶发 429/5xx 或连接挂起时：无 `AbortSignal` 超时 → 整个 Action 卡死直到 runner 超时；无重试 → 一次抖动就让整轮同步失败。对一个按 `cron` 定期跑的 Action 影响较大。建议加超时 + 指数退避重试（至少对 429/5xx）。

### 8. `::set-output` 已弃用
`src/utils/github.ts:23`

`::set-output` 命令已被 GitHub 弃用（会在日志里告警，且未来可能停用）。既然函数已经往 `$GITHUB_OUTPUT` 文件写了，这行 `console.log` 是冗余的，可以直接删掉。

### 9. 自实现 YAML 解析器比较脆弱
`src/utils/yaml.ts:8-45`

手写解析有几个限制：所有标量都按字符串返回（`year: 2024` → `'2024'`，靠下游 `parseInt` 兜底）；不支持 inline 数组 `[a, b]`、block scalar、注释、带空格的引号值；list 只认恰好 2 空格缩进。对 Action 自己写出的 frontmatter 能勉强 round-trip，但用户手工编辑后容易解析错。鉴于这是一个发布到社区、会被外部内容依赖的 Action，建议引入一个轻量 YAML 库（如 `yaml`）替代——可信度和维护性都会提升一档。

### 10. ROR filter 值被 `encodeURIComponent`（请实测确认）
`src/utils/openalex.ts:37`

`encodeURIComponent('https://ror.org/03y4dt428')` 会把 `://` 编码成 `%3A%2F%2F`。OpenAlex 的 `ror:` filter 文档示例里通常是不编码的完整 URL。HTTP 网关一般会在 filter 解析前做一次 URL 解码，所以**大概率没问题**，但建议跑一次真实请求确认 `getInstitutionId` 能拿到 results，避免在边界上踩坑。（ORCID `0000-...` 无特殊字符，`getAuthorId` 不受影响。）

---

## 🟢 代码质量 / 可维护性

### 11. 死代码
- `src/utils/formatters.ts:35` `formatAuthors` —— 仓库内无人调用。
- `src/utils/glob.ts:31-68` `readMarkdownFiles`、`filterByFrontmatter` —— 同样无人调用。

建议删除，或在 README 的「未使用导出」里说明用途，避免给阅读者造成误解。

### 12. 去重未做记忆化，O(n²) 重复 tokenize
`src/workers/deduplicator.ts:53-86` 嵌套循环里每对都调用 `isDuplicate`，后者每次都重新 `tokenize(title)`。对大体量（数百篇）会慢。可在进入循环前对 `pending` 预计算 `tokenize` 结果缓存，或按年份分桶缩小比较范围（`isDuplicate` 已要求 `|Δyear| ≤ 1`）。

### 13. 完全没有测试
`package.json:14` 的 `test` 脚本直接 `exit 1`。去重逻辑（含上面的 CJK bug）、abstract 反转索引重建、YAML round-trip 都是最该有单测的高风险纯函数。建议至少为 `deduplication.ts`、`abstract.ts`、`formatters.ts` 补单测——也方便回归。

### 14. 类型擦除
`src/index.ts:140` `parseWork(w as Record<string, unknown>)` 把 `getWorksForAuthor` 返回的 `unknown[]` 直接 cast，丢弃了 `OpenAlexWork` 类型。可以让 `getWorksForAuthor` 返回 `OpenAlexWork[]`（API 已 `select` 了对应字段），让类型流贯穿到 `parseWork`。

### 15. 小项
- `src/scanners/publications.ts:33` `parseInt(fm.year)` 缺 radix（现代 JS 默认 10，但 lint 会报）。
- `src/index.ts:113-114` 的 DOI 归一化与 `deduplicator.ts:26` 重复，可抽到 `utils/deduplication.ts` 统一一个 `normalizeDoi`，避免两处漂移（例如是否处理 `dx.doi.org`）。
- `src/utils/openalex.ts:75` `cursor=${cursor}` 未编码，游标通常是 base64 安全字符，但保险起见可 encode。

---

## 优先级建议

| 优先级 | 事项 |
|---|---|
| P0（发布前必修） | #1 action 入口、#2 tsc 构建、#3 output 名、#4 多行 output |
| P0（数据正确性） | #6 CJK 去重误判 |
| P1 | #5 README env 名、#7 fetch 超时/重试 |
| P2 | #8 `::set-output`、#9 YAML 库、#13 补单测 |
| P3 | 其余清理项 |
