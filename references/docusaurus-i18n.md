# Docusaurus i18n 专项指南

Docusaurus 3.x 的 i18n 是「按相对路径覆盖」模型:locale 目录中存在同相对路径文件则覆盖英文源,否则回退英文。**没有同页双语原生能力**。本指南记录实战验证过的完整细节。

## 1. 目录结构

```
docs/
├── docs/                                  # 英文源
├── docusaurus.config.js
├── sidebars.js
└── i18n/<locale>/
    ├── code.json                          # 主题 UI 文案(write-translations 生成)
    ├── docusaurus-theme-classic/
    │   ├── navbar.json
    │   └── footer.json
    └── docusaurus-plugin-content-docs/
        ├── current.json                   # 侧边栏分类标签
        └── current/                       # 文档译文(镜像 docs/docs 结构)
            ├── concepts/
            └── ...
```

## 2. 配置步骤

1. `docusaurus.config.js`:
   ```js
   i18n: { defaultLocale: 'en', locales: ['en', 'zh-Hans'] },
   ```
   搜索插件(docusaurus-search-local)的 `language` 加 `'zh'`。
2. 生成文案骨架:`npx docusaurus write-translations --locale zh-Hans`
   (注意不是 `yarn write-translations`,除非 package.json 有该 script)。
3. **sidebars.js 重复 label 会报错** "Multiple docs sidebar items produce the same translation key"。
   官方修法:给重复的 category 加唯一 `"key"` 属性(不影响英文显示)。
4. `current.json` / `navbar.json` / `footer.json` 的 `message` 字段填译文;`code.json` 大部分由 Docusaurus 内置语言包填充,补齐遗留英文项即可。
5. baseUrl 可用环境变量覆盖,便于独立部署:
   ```js
   baseUrl: process.env.DOCUSAURUS_BASE_URL || '/docs/master/',
   ```
   构建独立站点时 `DOCUSAURUS_BASE_URL=/ npx docusaurus build --locale zh-Hans --out-dir build-site`。
   注意 `--locale` 单语言构建会禁用 baseUrl 自动本地化。

## 3. 构建 / 部署常用命令

```bash
npx docusaurus start --locale zh-Hans          # 开发
npx docusaurus build --locale zh-Hans          # 生产构建
npx docusaurus serve --host 0.0.0.0 --port 3000  # 预览(局域网可访问)
```

## 4. i18n 高频坑(全部实战踩过)

### 4.1 相对图片路径失效
英文源 `![x](../../static/img/a.svg)` 在 i18n 目录下深度不同,解析失败(构建报
"couldn't be resolved to an existing local image file")。
**修法**:批量替换为 `](@site/static/`,Docusaurus 的 `@site` 别名指向项目根。

### 4.2 MDX 解析需镜像 Docusaurus 预处理
直接用 `remark-mdx` 解析含 `{#id}` 的 .mdx 会报 "Could not parse expression with acorn"。
Docusaurus 的预处理顺序(mdx-loader/lib/preprocessor.js):
```js
content = unwrapMdxCodeBlocks(content);
if (mdx1Compat.headingIds) content = escapeMarkdownHeadingIds(content); // {#id} → \{#id\}
content = admonitionTitleToDirectiveLabel(content, ['note','tip','info','warning','danger','success','important','caution']);
```
以上均由 `@docusaurus/utils` 导出;HTML 注释还需 `@slorber/remark-comment` 插件(mdx1Compat.comments)。
解析管线:`remark-parse` + `remark-frontmatter` + `remark-gfm` + `remark-directive`(+ mdx 时 `remark-mdx` + `remark-comment`)。

### 4.3 MDX 中 `<br>` 必须自闭合
表格单元格拼 `<br><br>` 会让 .mdx 报 "Expected a closing tag for `<br>`"。
统一写 `<br />`(.md 与 .mdx 均兼容)。

### 4.4 断链锚点(onBrokenAnchors: 'throw')
翻译标题后 slug 变化,所有指向英文锚点的链接断链。用 scripts/fix_anchors.mjs 自动修复:
- 解析 build 日志的 `Broken anchor on source page path = X` / `linking to ... (resolved as: Y#anchor)`
- 在英文源中用 github-slugger 反查 slug 对应的标题序号(标题数中英 100% 对齐是前提,翻译规范第 13 条保证)
- 在译文对应标题(按出现序号)行尾补 `{#anchor}`;若该标题已有不同锚点,在其前插入 `<a id="..."></a>`
- 同页面锚点行格式为 `linking to #foo`(无文件部分),解析正则要兼容
- 已知源文件噪音:URL 被硬换行截断(`https://paimon.apac\nhe.org/...`)、缩进代码围栏导致正则误匹配——修复时保留译文对 URL 的合并改善

### 4.5 标题数量必须与源一致
断链修复、双语合并都依赖「译文第 N 个标题 ↔ 源第 N 个标题」的对应关系。翻译规范第 13 条(不合并/拆分段落)是前提;校验脚本会检查标题数。

### 4.6 自动生成内容不翻译
从源码注释生成的页面(如 Paimon 的 `generated/*.html` 配置参考)手工翻译会被覆盖。保持英文,向用户说明正确路径是翻译源码注释后重新生成。

## 5. 部署形态差异

- **官网多语言形态**:`docusaurus build`(不带 --locale)构建全部 locale,输出 `build/` 与 `build/zh-Hans/`,同源可切换语言。
- **独立中文站形态**:`build --locale zh-Hans` + `DOCUSAURUS_BASE_URL=/`,输出单语言站,部署到任意静态托管(ZCode Sites/GitHub Pages/Netlify)。
