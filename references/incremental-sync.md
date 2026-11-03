# 增量同步(上游文档更新后)

首译是重活,但后续同步应该很轻:**上游改多少就翻多少,没变的页面零成本**。
本流程在 Apache Paimon(221 页)上验证:无变化时 3 秒出报告,零成本;模拟变更时
新增/修改/删除全部正确识别。

## 前提(首译交付时应就位)

- 本地项目保存英文快照(`docs/docs/`,即首译时的上游状态)
- 纯译文源独立目录(如 `translations/zh-Hans/`)
- 对照版/双语版由脚本幂等生成(`i18n/.../current/`)
- 翻译规范与术语表仍在(`TRANSLATION_GUIDE.md`)

## 同步流程(5 步)

### 1. 轻量拉取上游(不拉源码)

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/<org>/<repo>.git /tmp/<repo>-upstream
cd /tmp/<repo>-upstream && git sparse-checkout set docs
# 已有 clone 时:git fetch && git reset --hard origin/master
```

### 2. 对比,得到增量清单

```bash
node scripts/sync-check.mjs /tmp/<repo>-upstream/docs/docs <本地英文快照目录> --json sync-report.json
```

输出 added / modified(附 +行 -行 变化量)/ removed / unchanged 四类清单。

### 3. 处理三类变更

**unchanged → 什么都不做。**

**added(新增页面)→ 新翻译**
- 并行子智能体按主工作流阶段 3 翻译,写入译文源目录(如 `translations/<lang>/`)
- 新目录/分类需同步更新 sidebars 与 write-translations

**modified(修改页面)→ 补译(关键提效点,不要整页重译)**
- 给子智能体的增量 prompt:旧英文快照(本地 `<snapshot>/<rel>`)+ 新英文
  (`/tmp/<repo>-upstream/docs/docs/<rel>`)+ 旧译文(`<translations>/<rel>`)
- 指令:"只把英文差异涉及的段落同步到译文,未变段落保持原样;保持块级结构对齐;
  新增的标题按术语表翻译并补英文 slug 锚点"
- 变化量超过全页约 50% 时,整页重译反而更快更稳(按主工作流处理)
- `sync-check` 输出的 +行/-行 用于路由这个决策

**removed(上游删除)→ 清理**
- 删除 `translations/<lang>/<rel>` 与生成目录中的对应文件
- 检查 sidebars.js / 相互链接是否引用该页(构建时断链检查会兜底)

### 4. 同步英文快照与框架文件

- 把上游 `docs/docs/` 覆盖本地英文快照目录(保持"快照=上游最新",下次 diff 才准确)
- **框架文件要三方审查,不能盲目覆盖**:docusaurus.config.js / sidebars.js / src/**
  通常含本地定制(i18n 配置、baseUrl 环境变量、分类 key、双语样式)。做法:
  diff 上游与本地,把上游新变更手工合并进本地定制版。

### 5. 重建与发布(全部幂等,可脚本化)

```bash
npx docusaurus write-translations --locale <locale>   # 增量补 UI 文案
yarn bilingual                                         # 全量重建对照版(几分钟,幂等)
yarn verify:bilingual                                  # 结构校验
npx docusaurus build --locale <locale>                 # 0 错误 0 断链门槛
node scripts/fix_anchors.mjs <build.log> <en_src> <out_dir>   # 如有断链,迭代
# 部署(更新既有站点)
```

## 成本预期

| 场景 | 耗时 |
|------|------|
| 上游无变化 | 秒级(一条 diff 命令) |
| 少量更新(<10 页) | 单个子智能体几分钟 |
| 大版本更新 | 按主工作流走,但未变页面仍是零成本 |

## 提示

- `sync-report.json` 可直接作为任务分派依据(按文件逐个建翻译任务)。
- 上游若重命名/移动文件,会表现为 removed + added;补译时让智能体对照旧译文就近复用术语。
- 建议每次同步后在 git 里单独提交一个 sync commit,便于追溯每次上游同步的范围。
