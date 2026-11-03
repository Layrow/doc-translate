# doc-translate

将开源项目文档站(Docusaurus / Hugo / MkDocs / VitePress 等)完整翻译为中文或其他语言的
[ZCode](https://zcode.ai) skill。工作流在 Apache Paimon 文档(221 页 / 24 万词)上完整验证。

## 安装

```bash
git clone https://github.com/Layrow/doc-translate.git ~/.agents/skills/doc-translate
```

重启 ZCode 后即可触发;或用 `/doc-translate` 显式调用。

## 工作流(6 阶段)

1. **侦察** — 识别文档框架、统计规模、盘点特殊语法、排除自动生成内容
2. **方案确认** — 呈现方式 / 代码注释策略 / 翻译范围
3. **基础设施** — 框架 i18n 配置 + 翻译规范与术语表(多智能体一致性的关键)
4. **并行翻译** — 按词量均衡拆任务包,子智能体并发执行,含并发限制恢复与断点续传
5. **质量校验** — 代码块逐字一致、License 头、链接集合、frontmatter 结构
6. **构建交付** — 0 错误 0 断链门槛、断链自动修复、本地预览、部署、git 提交

可选:**双语对照版**(借鉴 read-frog 沉浸式翻译的"低调嵌入"设计),原文/译文逐段对照。

## 目录

```
doc-translate/
├── SKILL.md                            # 主工作流
├── references/
│   ├── translation-guide-template.md   # 翻译规范模板(术语表 + 硬性规则)
│   ├── docusaurus-i18n.md              # Docusaurus i18n 全部实战坑
│   └── bilingual-mode.md               # 双语对照模式
└── scripts/
    ├── verify_translations.py          # 翻译结构校验(纯 Python,零依赖)
    ├── fix_anchors.mjs                 # 断链锚点自动修复
    ├── build-bilingual-docs.mjs        # 双语对照页生成(AST 合并 + 图片防重)
    └── verify-bilingual-docs.mjs       # 双语版结构校验
```

## 实战成果

- Apache Paimon 文档中文化:221 页全部翻译,构建 0 错误 0 断链
- 双语对照版:98.6% 文件块级自动合并,0 回退
- 在线预览:https://paimon-docs-zh-odaa.zai-ai.site

## License

MIT
