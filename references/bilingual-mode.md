# 双语对照模式(可选进阶)

在翻译完成的基础上,生成「英文原文 + 中文译文」逐段对照版,方便对照阅读。设计借鉴
read-frog(沉浸式翻译)的"低调嵌入"理念:中英同色同字号,仅以间距与结构区分,不抢视觉。

## 用户确认要点

1. **版式**:英文在上中文在下(标题「English 中文」同行、表格单元格内中英上下、列表项内中英并列)——最常用;或中文在上。
2. **纯译文源**:迁移到独立目录保留(如 `translations/zh-Hans/`),对照版生成到框架的 i18n 目录,源是唯一事实源、脚本幂等。
3. **发布**:更新现有站点或新建站点。

## 生成脚本

使用本 skill 的 `scripts/build-bilingual-docs.mjs`:

```bash
# 复制到目标项目 docs/scripts/ 下运行(依赖项目 node_modules 中的 unified 生态)
cp <skill>/scripts/build-bilingual-docs.mjs <project>/docs/scripts/
cd <project>/docs
node scripts/build-bilingual-docs.mjs <en_dir> <zh_src_dir> <out_dir>
```

依赖(目标项目 node_modules 已有,无需安装):`unified`、`remark-parse`、`remark-gfm`、
`remark-mdx`、`remark-frontmatter`、`remark-directive`、`@slorber/remark-comment`、
`github-slugger`、`gray-matter`、`@docusaurus/utils`。

## 合并规则(默认版式)

| 元素 | 规则 |
|------|------|
| frontmatter | `title: "English 中文"`;两者相同或均为英文术语时只保留一份;`description` 用中文;`sidebar_label` 双语化 |
| heading | `## English 中文 {#anchor}`;锚点优先沿用译文已有的,缺失时用 github-slugger 按英文标题生成;中文锚点≠英文 slug 时在标题前补 `<a id="en-slug"></a>` 别名 |
| paragraph | 英文段 + 空行 + 中文段;完全相同只输出一份 |
| table | 逐行逐单元格 `EN<br /><br />中文`,保留分隔行;单元格切片需去掉前导 `\|` |
| list | 列表项内 `EN<br />中文`;多行/嵌套项回退为英文项 + 中文项 |
| code | 只保留英文一份(内容与中文逐字一致) |
| admonition | 中文标记行(含已译标题)+ 英文内容 + 中文内容 + 结束标记 |
| blockquote | 递归合并 children,行首加 `> ` |
| JSX(mdxJsxFlowElement) | 保留中文文件的组件与属性,文本 children 递归对照;自闭合组件(如 `<ConfigTable html={...} />`)保留一份;`import` 只输出一份 |
| image | **防重**:同一张图在中英段落中都出现时只保留一份(见下) |
| License 注释 | 保留一份 |

## 图片防重(实战踩过的 bug)

含图段落会被英文、中文各输出一遍(alt 翻译过 + 路径不同 → 两段不等)。表现为同一张图
渲染两次(80 张图变 159 张)。修法:

- 两边段落都含图且去掉图片后都为空 → 只保留中文一份
- 一边只有图 → 保留有文字的那边,图取另一边的
- 图文混合 → 英文段(含图)+ 中文文字段(去图)
- 列表项内同样处理

校验方式:统计生成文件的 `![...](...)` 数量,必须与英文源完全一致。

## 结构前提与算法

- 依赖「中英文件块级结构对齐」:翻译规范第 13 条(不合并/拆分段落)保证。实测 221 对文件
  98.6% 块级完全对齐,标题/表格行/列表项/代码围栏 100% 对齐。
- 算法:mdast 解析两棵树 → 剥离 frontmatter 与 `mdxjsEsm` → 以 heading 分节 → 节内按
  **节点类型序列 LCS** 对齐 → 逐对合并(用节点 `position` 从原文切片,保留原始格式)。
  类型不匹配的节点按所属语言单独输出(自动容错段落拆分/合并差异)。
- 输出用原始切片而非 AST 序列化,避免格式重排。

## 构建注意

- .md(CommonMark)不支持 JSX,对照内容必须是纯 Markdown,不要用 `<div class>` 包装段落。
- .mdx 中 `<br>` 必须写 `<br />`。
- 生成后重跑构建 + 断链修复(所有标题都会带显式锚点,一般 0 断链)。

## 维护闭环

在目标项目 package.json 加钩子,翻译更新后自动重新生成:

```json
"bilingual": "node scripts/build-bilingual-docs.mjs <en_dir> <zh_src_dir> <out_dir>",
"verify:bilingual": "node scripts/verify-bilingual-docs.mjs",
"prebuild": "node scripts/build-bilingual-docs.mjs",
"prestart": "node scripts/build-bilingual-docs.mjs"
```

对应校验脚本 `scripts/verify-bilingual-docs.mjs` 也在本 skill 中(校验代码块/链接/标题锚点/
frontmatter,注意剥离代码块后再数标题,避免把代码内 `#` 注释当标题误报)。
