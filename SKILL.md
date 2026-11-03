---
name: doc-translate
description: 将开源项目文档站(Docusaurus/Hugo/MkDocs/VitePress 等)完整翻译为中文或其他语言的可复用工作流:源码侦察、i18n 结构搭建、翻译规范与术语表、并行子智能体翻译、质量校验、断链自动修复、可选双语对照、构建与部署。当用户要求翻译某个开源项目的文档、文档站中文化、搭建多语言文档、批量翻译 docs 目录,或提到"把 XX 项目文档翻译成中文"时使用——即使用户没有明确说"用工作流"也应触发。
---

# 开源项目文档翻译工作流

将一个开源项目的完整文档站翻译为目标语言(默认简体中文),产出可构建、可部署、可维护的翻译版本。本工作流在 Apache Paimon 文档(221 页 / 24 万词)上完整验证过。

## 核心原则(任何框架通用)

1. **代码块逐字保留**——含注释,一个字符都不改;保证可直接复制运行。
2. **License/版权头原样保留**(Apache 等 HTML 注释块)。
3. **frontmatter 只译 `title`/`description`**,其余字段(sidebar_position/slug 等)原样。
4. **链接 URL、相对路径、锚点一律不变**,只译链接显示文字。
5. **术语表先行**——先写翻译规范再开始翻译,这是多智能体术语一致性的唯一保障。
6. **0 构建错误、0 断链**是硬性交付门槛。
7. **翻译产物可重复生成**——纯译文源与生成物分离,脚本幂等。

## 阶段 0:侦察

1. 浅克隆源码:`git clone --depth 1 <repo-url>`。
2. 识别文档框架(看特征文件):

   | 特征 | 框架 |
   |------|------|
   | `docusaurus.config.js` + `sidebars.js` | Docusaurus(原生 i18n,见 references/docusaurus-i18n.md) |
   | `config.toml`/`hugo.toml` + `content/` | Hugo |
   | `mkdocs.yml` + `docs/` | MkDocs |
   | `.vitepress/config` | VitePress |
   | `antora.yml` | Antora |

3. 统计规模(per-directory 文件数 + 词数),决定任务包拆分粒度。
4. 盘点特殊语法:frontmatter 字段、围栏代码块、License 头、JSX/MDX 组件、变量 token(如 `@@VERSION@@`)、显式锚点 `{#id}`、admonition(`:::note`)。
5. 识别**自动生成内容**(如从源码注释生成的配置参考页)——排除在翻译之外(手工翻译会被重新生成覆盖),向用户说明。
6. 已翻译页面与待翻译页面的数量核对(避免遗漏文件,如 `.mdx` 扩展名容易被漏统计)。

## 阶段 1:方案确认

用 AskUserQuestion 一次性确认(给推荐项):

1. **呈现方式**:官方 i18n 目录结构(推荐,可 PR 回上游)/ 纯 Markdown 文件集 / 合成单册 HTML-PDF。
2. **代码注释**:完全保留(推荐)/ 翻译注释。
3. **范围**:全部页面(推荐)/ 核心章节优先 / 先试翻 5~8 页验收。
4. (可选)**双语对照版**:原文与译文逐段对照,见 references/bilingual-mode.md。

## 阶段 2:基础设施

1. 若是 Docusaurus:按 references/docusaurus-i18n.md 配置 locale、运行 write-translations、修复 sidebars 重复 key。其他框架先调研其官方 i18n 机制再动手。
2. 安装依赖(后台运行,不阻塞翻译)。
3. **写翻译规范**:把 references/translation-guide-template.md 复制到工作区(如 `TRANSLATION_GUIDE.md`),填充:
   - 源/目标路径约定
   - 项目专属术语表(保留英文清单 + 固定译法表)
   - 风格指南(标点、空格、语态)
   - 自检清单
4. 规范写好后不再中途修改术语;确需新增术语时追加并通知所有后续智能体。

## 阶段 3:并行翻译(子智能体)

### 任务包设计

- 按目录拆分,**每包 0.6~1.5 万英文词**(过大拆分,过小合并)。
- 每包列出明确的文件清单(SRC→DST 相对路径相同,文件名不变)。
- 特大文件(>3000 词)单独成包或最多 2~3 个一组。

### Agent Prompt 模板

```
你是 <项目名> 文档翻译专家。首先 Read 翻译规范 <规范文件路径>,严格遵循
所有硬性规则、术语表与风格指南。

任务:翻译下列文件(源目录 SRC=<...>,目标目录 DST=<...>,相对路径相同):
1. <file1>
2. <file2>

工作方式:逐个文件 Read 源文件 → 全文翻译(保留代码块/License 头/import/
JSX/锚点/链接 URL)→ Write 到 DST 下相同相对路径。每完成一个立即写盘,
不要攒到最后。若目标文件已存在,先检查是否已完成,只处理剩余文件。

全部完成后报告:每个文件的完成状态与目标路径。
```

### 并发控制(重要经验)

- 子智能体并发有系统限制:超限时报 `user concurrency limit exceeded`,agent 会被暂停但**上下文保留、可用 SendMessage 恢复**,不是失败丢失。
- 策略:先小批量(2~3 个)启动试探;若全部成功,逐步加大并发;被暂停的用 SendMessage 发"继续执行原任务,先检查已完成文件"恢复。
- 翻译不依赖依赖安装,两者并行推进。
- 密切统计产出文件数(`find <dst> -type f | wc -l`)监控进度。

### 断点续传

Agent 恢复时让它先 `ls` 目标目录核对已完成文件,再继续剩余——prompt 模板已包含此指令。

## 阶段 4:质量校验

1. 把 `scripts/verify_translations.py` 复制到工作区运行(纯 Python,无依赖):
   ```bash
   python3 -I verify_translations.py <en_src_dir> <translated_dir>
   ```
   校验:代码块逐字一致、链接集合一致、License 头一致、frontmatter title 已译、正文 CJK 占比。
2. **已知误报**(不要误修):源文件 URL 被硬换行截断而译文修复了它(报告为 LINKS_DIFF);缩进代码围栏导致正则跨块(CODEBLOCK_DIFF)。逐个人工确认。
3. 抽查 2~3 个代表页(概念页/大表格页/含组件页)人工阅读质量。

## 阶段 5:构建与断链修复

1. 构建(如 Docusaurus):`npx docusaurus build --locale <locale>`。**0 错误、0 断链**是硬门槛。
2. 断链修复(翻译标题后 slug 变化导致):把 `scripts/fix_anchors.mjs` 复制到目标项目 `docs/scripts/` 下,迭代运行:
   ```bash
   npx docusaurus build --locale <locale> > /tmp/build.log 2>&1; true
   node scripts/fix_anchors.mjs /tmp/build.log
   ```
   脚本解析 build 日志中的 broken anchors,在英文源文件中反查 slug 对应标题,按标题序号在译文中补 `{#anchor}`,直到构建 0 断链。
3. i18n 高频坑(详见 references/docusaurus-i18n.md):
   - i18n 目录下相对图片路径失效 → 改为 `@site/static/...`
   - MDX 中 `{#id}` 被当 JS 表达式 → 解析需镜像 Docusaurus 预处理
   - MDX 中 `<br>` 必须写 `<br />`
4. 修复后重跑阶段 4 校验确认无回归。

## 阶段 6:交付

1. 本地预览:`npx docusaurus serve --host 0.0.0.0 --port 3000`,局域网手机可访问。
2. 用浏览器截图做视觉验收(标题/段落/表格/侧边栏/TOC)。
3. 可选双语对照版:读 references/bilingual-mode.md,使用 `scripts/build-bilingual-docs.mjs` 生成。
4. 部署到静态托管(如 ZCode Sites / GitHub Pages / 既有站点更新)。
5. git 提交:在默认分支上先建分支(如 `docs/<lang>-translation`),产物与脚本一起提交;构建产物与部署配置加入 .gitignore。

## 交付报告模板

向用户汇报时包含:页面数与词数、术语表位置、构建状态(0 错误 0 断链)、预览/公网地址、提交记录、后续维护命令(重新生成/构建/部署)。

## 增量同步(上游文档更新后)

首译之后,上游更新走轻量增量流程:**上游改多少翻多少,未变页面零成本**。
使用 `scripts/sync-check.mjs` 对比上游与本地英文快照,得到 added / modified(附变化量)/
removed / unchanged 清单;新增页新译、修改页 diff 驱动补译(不整页重译)、删除页清理;
然后同步英文快照、重建对照版、校验构建部署。

完整步骤、增量翻译 prompt 写法与成本预期见 references/incremental-sync.md。
注意:框架文件(docusaurus.config.js / sidebars.js / src/)含本地定制,同步时需三方审查合并,不能盲目覆盖。
