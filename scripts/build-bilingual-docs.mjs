/**
 * 生成中英/多语逐段对照版文档(Docusaurus)。
 *
 * 建议复制到目标项目 docs/scripts/ 下运行(依赖项目 node_modules 中的
 * unified / remark-* / github-slugger / gray-matter / @docusaurus/utils 生态)。
 *
 * 合并规则(英文在上、译文在下):
 *   - frontmatter:title = "English 译文"
 *   - heading:    ## English 译文 {#anchor}
 *   - paragraph:  英文段 + 空行 + 译文段
 *   - table:      单元格 EN<br /><br />译文
 *   - list:       列表项 EN<br />译文
 *   - code:       只保留一份(英文)
 *   - admonition: 译文标记行 + 英文内容 + 译文内容
 *   - JSX:        保留组件结构,文本 children 递归对照
 *   - 图片:       防重(同一张图只渲染一次)
 *
 * 用法:
 *   node build-bilingual-docs.mjs <en_dir> <zh_src_dir> <out_dir> [--report report.json]
 *   例:node scripts/build-bilingual-docs.mjs docs docs/translations/zh-Hans \
 *        i18n/zh-Hans/docusaurus-plugin-content-docs/current
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkMdx from "remark-mdx";
import remarkComment from "@slorber/remark-comment";
import GithubSlugger from "github-slugger";
import { admonitionTitleToDirectiveLabel, escapeMarkdownHeadingIds, unwrapMdxCodeBlocks } from "@docusaurus/utils";

const args = process.argv.slice(2).filter((a) => a !== "--report");
const reportIdx = process.argv.indexOf("--report");
const REPORT_PATH = reportIdx >= 0 ? process.argv[reportIdx + 1] : null;
const EN_DIR = path.resolve(args[0] ?? "docs");
const ZH_DIR = path.resolve(args[1] ?? "translations/zh-Hans");
const OUT_DIR = path.resolve(args[2] ?? "i18n/zh-Hans/docusaurus-plugin-content-docs/current");
if (!fs.existsSync(EN_DIR) || !fs.existsSync(ZH_DIR)) {
  console.error("用法: node build-bilingual-docs.mjs <en_dir> <zh_src_dir> <out_dir> [--report report.json]");
  process.exit(2);
}

const ADMONITIONS = ["note", "tip", "info", "warning", "danger", "success", "important", "caution"];

// ---------- 文件收集 ----------
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (/\.(md|mdx)$/.test(entry.name)) out.push(path.relative(base, full));
  }
  return out;
}

// ---------- 解析 ----------
function parseMarkdown(content, isMdx) {
  // 镜像 Docusaurus mdx-loader 的预处理顺序
  let transformed = unwrapMdxCodeBlocks(content);
  if (isMdx) transformed = escapeMarkdownHeadingIds(transformed);
  transformed = admonitionTitleToDirectiveLabel(transformed, ADMONITIONS);
  let proc = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkDirective);
  if (isMdx) proc = proc.use(remarkMdx).use(remarkComment);
  return { tree: proc.parse(transformed), transformed };
}

const isHeading = (n) => n.type === "heading";
const isSkippable = (n) => n.type === "yaml" || n.type === "mdxjsEsm";

// ---------- 文本工具 ----------
function slice(content, node) {
  if (!node.position) return "";
  return content.slice(node.position.start.offset, node.position.end.offset);
}

function trimBlank(s) {
  return s.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
}

// 纯文本(用于 slug)
function nodeToPlainText(node) {
  if (!node) return "";
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code")
    return node.value ?? "";
  if (node.type === "image") return node.alt ?? "";
  if (node.type === "html") return "";
  if (node.children) return node.children.map(nodeToPlainText).join("");
  return "";
}

function cleanHeadingText(raw) {
  return raw
    .replace(/\s*\\?\{#[^}\\]+\\?\}\s*$/, "")
    .replace(/^#+\s+/, "")
    .trim();
}

function plainFromMarkdown(md) {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*~]/g, "")
    .trim();
}

// 英文切片里的相对静态图路径改为 @site(中文源里已改动)
function fixImagePaths(text) {
  return text.replace(/\]\(\.\.\/\.\.\/static\//g, "](@site/static/");
}

const IMG_RE = /!\[[^\]]*\]\([^)]*\)/g;
const hasImage = (s) => /!\[[^\]]*\]\([^)]*\)/.test(s);
const stripImages = (s) => s.replace(IMG_RE, "").trim();

// 图片防重合并:同一张图在中英文段落中都出现时只保留一份
function mergeImageBearingPair(enRaw, zhRaw) {
  const enText = stripImages(enRaw);
  const zhText = stripImages(zhRaw);
  if (!enText && !zhText) return zhRaw; // 两边都是纯图片段:只保留中文一份
  if (!zhText) return fixImagePaths(enRaw); // 中文段只有图
  if (!enText) return zhRaw; // 英文段只有图
  // 图文混合:英文段(含图)+ 中文文字段(去图)
  return `${fixImagePaths(enRaw)}\n\n${zhText}`;
}

// ---------- 节点合并 ----------
function mergeHeading(enNode, zhNode, enContent, zhContent, slugger, anchorRegistry) {
  const enRaw = cleanHeadingText(slice(enContent, enNode));
  const zhRawRaw = slice(zhContent, zhNode);
  const zhAnchorM = zhRawRaw.match(/\\?\{#([^}\\]+)\\?\}\s*$/);
  const zhAnchor = zhAnchorM ? zhAnchorM[1] : null;
  const zhRaw = cleanHeadingText(zhRawRaw);
  const enPlain = plainFromMarkdown(enRaw);
  const enSlug = slugger.slug(enPlain); // 按出现顺序唯一

  const id = zhAnchor || enSlug;
  anchorRegistry.push({ enSlug, zhAnchor, id });

  const enText = enRaw.trim();
  const zhText = zhRaw.trim();
  // 中英相同、或中文侧本就是英文术语时,只保留一份
  const zhHasCJK = /[\u4e00-\u9fff]/.test(zhText);
  const merged = enText === zhText || !zhHasCJK ? enText : `${enText} ${zhText}`;
  const prefix = "#".repeat(enNode.depth);

  const needsAlias = zhAnchor && zhAnchor !== enSlug;
  const alias = needsAlias ? `<a id="${enSlug}"></a>\n\n` : "";
  return `${alias}${prefix} ${merged} {#${id}}`;
}

function mergeSimplePair(enNode, zhNode, enContent, zhContent) {
  const enRaw = trimBlank(slice(enContent, enNode));
  const zhRaw = trimBlank(slice(zhContent, zhNode));
  if (enRaw === zhRaw) return enRaw || zhRaw;
  if (hasImage(enRaw) && hasImage(zhRaw)) return mergeImageBearingPair(enRaw, zhRaw);
  return `${fixImagePaths(enRaw)}\n\n${zhRaw}`;
}

function mergeTable(enNode, zhNode, enContent, zhContent) {
  const enRows = enNode.children.filter((n) => n.type === "tableRow");
  const zhRows = zhNode.children.filter((n) => n.type === "tableRow");
  if (enRows.length !== zhRows.length) return null; // 交给回退

  const stripCellPipes = (s) =>
    s
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .trim();

  const enRaw = slice(enContent, enNode);
  const enLines = enRaw.split("\n").filter((l) => l.trim());
  const separator = enLines.length >= 2 ? enLines[1] : "| --- |";

  const lines = [];
  for (let r = 0; r < enRows.length; r++) {
    const enCells = enRows[r].children.filter((n) => n.type === "tableCell");
    const zhCells = zhRows[r].children.filter((n) => n.type === "tableCell");
    if (enCells.length !== zhCells.length) return null;
    const cells = [];
    for (let c = 0; c < enCells.length; c++) {
      const enCell = stripCellPipes(trimBlank(slice(enContent, enCells[c]))).replace(/\n+/g, " ").trim();
      const zhCell = stripCellPipes(trimBlank(slice(zhContent, zhCells[c]))).replace(/\n+/g, " ").trim();
      cells.push(enCell === zhCell ? enCell : `${enCell}<br /><br />${zhCell}`);
    }
    if (r === 0) {
      lines.push(`| ${cells.join(" | ")} |`);
      lines.push(separator);
    } else {
      lines.push(`| ${cells.join(" | ")} |`);
    }
  }
  return lines.join("\n");
}

function mergeList(enNode, zhNode, enContent, zhContent) {
  const enItems = enNode.children.filter((n) => n.type === "listItem");
  const zhItems = zhNode.children.filter((n) => n.type === "listItem");
  if (enItems.length !== zhItems.length) return null;

  const out = [];
  for (let i = 0; i < enItems.length; i++) {
    const enItem = enItems[i];
    const zhItem = zhItems[i];
    const enRaw = trimBlank(slice(enContent, enItem));
    const zhRaw = trimBlank(slice(zhContent, zhItem));
    const enFirstLine = enRaw.split("\n")[0];
    const markerMatch = enFirstLine.match(/^(\s*(?:[-*+]|\d+\.)\s+)/);
    const marker = markerMatch ? markerMatch[1] : "- ";
    const indent = marker.match(/^\s*/)[0];
    const markerOnly = marker.replace(/^\s*/, "");

    const enBody = enRaw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
    const zhBody = zhRaw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");

    const simpleEn =
      enItem.children.length === 1 && enItem.children[0].type === "paragraph";
    const simpleZh =
      zhItem.children.length === 1 && zhItem.children[0].type === "paragraph";

    if (simpleEn && simpleZh && !enBody.includes("\n") && !zhBody.includes("\n")) {
      let body;
      if (enBody.trim() === zhBody.trim()) {
        body = enBody.trim();
      } else if (hasImage(enBody) && hasImage(zhBody)) {
        // 列表项中的图片防重
        const enT = stripImages(enBody);
        const zhT = stripImages(zhBody);
        if (!enT && !zhT) body = zhBody.trim();
        else if (!zhT) body = fixImagePaths(enBody.trim());
        else if (!enT) body = zhBody.trim();
        else body = `${fixImagePaths(enBody.trim())}<br />${zhT}`;
      } else {
        body = `${enBody.trim()}<br />${zhBody.trim()}`;
      }
      out.push(`${indent}${markerOnly}${body}`);
    } else {
      // 回退:英文项 + 中文项
      out.push(enRaw);
      out.push(`${indent}${markerOnly}${zhBody}`);
    }
  }
  return out.join("\n");
}

function mergeAdmonition(enNode, zhNode, enContent, zhContent) {
  const zhRaw = slice(zhContent, zhNode);
  const zhLines = zhRaw.split("\n");
  const openLine = zhLines[0];
  const closeLine = zhLines[zhLines.length - 1];
  const enChildren = enNode.children ?? [];
  const zhChildren = zhNode.children ?? [];
  if (!enChildren.length || !zhChildren.length) return zhRaw;

  const enStart = enChildren[0].position.start.offset;
  const enEnd = enChildren[enChildren.length - 1].position.end.offset;
  const zhStart = zhChildren[0].position.start.offset;
  const zhEnd = zhChildren[zhChildren.length - 1].position.end.offset;
  const enBody = trimBlank(enContent.slice(enStart, enEnd));
  const zhBody = trimBlank(zhContent.slice(zhStart, zhEnd));

  return `${openLine}\n\n${fixImagePaths(enBody)}\n\n${zhBody}\n\n${closeLine}`;
}

function mergeBlockquote(enNode, zhNode, enContent, zhContent, ctx) {
  const enChildren = enNode.children ?? [];
  const zhChildren = zhNode.children ?? [];
  const merged = mergeNodeArrays(enChildren, zhChildren, enContent, zhContent, ctx);
  if (!merged) return null;
  const lines = merged.split("\n").map((l) => (l ? `> ${l}` : ">"));
  return lines.join("\n");
}

function mergeJsxElement(enNode, zhNode, enContent, zhContent, ctx) {
  const zhRaw = slice(zhContent, zhNode);
  const enChildren = enNode.children ?? [];
  const zhChildren = zhNode.children ?? [];
  if (!enChildren.length || !zhChildren.length) {
    // 自闭合组件或纯文本组件:保留中文原文
    return zhRaw;
  }
  const openRaw = trimBlank(
    zhContent.slice(zhNode.position.start.offset, zhChildren[0].position.start.offset)
  );
  const closeRaw = trimBlank(
    zhContent.slice(
      zhChildren[zhChildren.length - 1].position.end.offset,
      zhNode.position.end.offset
    )
  );
  const mergedChildren = mergeNodeArrays(enChildren, zhChildren, enContent, zhContent, ctx);
  if (!mergedChildren) return zhRaw;
  return `${openRaw}\n\n${mergedChildren}\n\n${closeRaw}`;
}

function mergeImage(enNode, zhNode) {
  // 使用中文节点(路径已修复为 @site);alt 双语
  const zhAlt = zhNode.alt ?? "";
  const enAlt = enNode.alt ?? "";
  const url = zhNode.url ?? enNode.url;
  const alt = zhAlt && enAlt && zhAlt !== enAlt ? `${enAlt} ${zhAlt}` : zhAlt || enAlt;
  return `![${alt}](${url})`;
}

// 单个节点对合并。返回 null 表示需要回退(分别输出两边)
function mergeNodePair(enNode, zhNode, enContent, zhContent, ctx) {
  if (enNode.type !== zhNode.type) return null;
  switch (enNode.type) {
    case "heading":
      return mergeHeading(enNode, zhNode, enContent, zhContent, ctx.slugger, ctx.anchorRegistry);
    case "paragraph":
    case "html":
    case "code":
    case "thematicBreak":
    case "definition":
    case "footnoteDefinition":
      return mergeSimplePair(enNode, zhNode, enContent, zhContent);
    case "table":
      return mergeTable(enNode, zhNode, enContent, zhContent);
    case "list":
      return mergeList(enNode, zhNode, enContent, zhContent);
    case "blockquote":
      return mergeBlockquote(enNode, zhNode, enContent, zhContent, ctx);
    case "containerDirective":
    case "leafDirective":
      return mergeAdmonition(enNode, zhNode, enContent, zhContent);
    case "image":
      return mergeImage(enNode, zhNode);
    case "mdxJsxFlowElement":
    case "mdxJsxTextElement":
      return mergeJsxElement(enNode, zhNode, enContent, zhContent, ctx);
    case "mdxFlowExpression":
      return slice(zhContent, zhNode);
    default:
      // 其他:优先中文
      return trimBlank(slice(zhContent, zhNode)) || trimBlank(slice(enContent, enNode));
  }
}

// 用 LCS 对齐两个节点数组,再逐对合并
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// 合并两个节点数组。返回字符串;无法处理时返回 null
function mergeNodeArrays(enNodes, zhNodes, enContent, zhContent, ctx) {
  const pairs = lcsPairs(
    enNodes.map((n) => n.type),
    zhNodes.map((n) => n.type)
  );
  const out = [];
  let i = 0,
    j = 0;
  const emit = (text) => {
    if (text && text.trim()) out.push(trimBlank(text));
  };
  for (const [pi, pj] of [...pairs, [enNodes.length, zhNodes.length]]) {
    while (i < pi) emit(slice(enContent, enNodes[i++]));
    while (j < pj) emit(slice(zhContent, zhNodes[j++]));
    if (pi < enNodes.length) {
      const merged = mergeNodePair(enNodes[pi], zhNodes[pj], enContent, zhContent, ctx);
      if (merged !== null) {
        emit(merged);
        ctx.stats.merged++;
      } else {
        ctx.stats.fallback++;
        emit(slice(zhContent, zhNodes[pj]));
      }
      i = pi + 1;
      j = pj + 1;
    }
  }
  return out.join("\n\n");
}

// ---------- frontmatter ----------
function mergeFrontmatter(enFm, zhFm) {
  const out = {};
  // 保留中文 frontmatter 的字段与顺序
  for (const key of Object.keys(zhFm)) out[key] = zhFm[key];
  const enTitle = (enFm.title ?? "").toString().trim();
  const zhTitle = (zhFm.title ?? "").toString().trim();
  const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);
  // title 去重:相同 / 均为英文术语 / 中文无翻译时,只保留英文原文
  let title;
  if (enTitle === zhTitle) title = enTitle;
  else if (!hasCJK(enTitle) && !hasCJK(zhTitle)) title = enTitle;
  else if (enTitle.toLowerCase() === zhTitle.toLowerCase()) title = enTitle;
  else title = `${enTitle} ${zhTitle}`;
  out.title = title || zhTitle || enTitle;
  if (zhFm.description) out.description = zhFm.description;
  // sidebar_label 双语
  if (zhFm.sidebar_label) {
    const label = String(zhFm.sidebar_label);
    if (!/[\u4e00-\u9fff]/.test(label) && zhTitle && hasCJK(zhTitle)) {
      out.sidebar_label = `${label} ${zhTitle}`;
    }
  }
  return out;
}

// ---------- 单文件处理 ----------
function buildFile(rel, report) {
  const enPath = path.join(EN_DIR, rel);
  const zhPath = path.join(ZH_DIR, rel);
  const outPath = path.join(OUT_DIR, rel);
  const isMdx = rel.endsWith(".mdx");

  if (!fs.existsSync(zhPath)) {
    report.missingZh.push(rel);
    return;
  }

  const enRaw = fs.readFileSync(enPath, "utf8");
  const zhRaw = fs.readFileSync(zhPath, "utf8");

  const enParsed = matter(enRaw);
  const zhParsed = matter(zhRaw);
  const enContent = enParsed.content;
  const zhContent = zhParsed.content;

  const { tree: enTree, transformed: enTrans } = parseMarkdown(enContent, isMdx);
  const { tree: zhTree, transformed: zhTrans } = parseMarkdown(zhContent, isMdx);

  // 分节:preamble + 每个 heading 一节
  const splitSections = (nodes) => {
    const sections = [];
    let current = { heading: null, body: [] };
    for (const node of nodes) {
      if (isSkippable(node)) continue;
      if (isHeading(node)) {
        sections.push(current);
        current = { heading: node, body: [] };
      } else {
        current.body.push(node);
      }
    }
    sections.push(current);
    return sections;
  };

  const enSections = splitSections(enTree.children);
  const zhSections = splitSections(zhTree.children);

  const slugger = new GithubSlugger();
  const anchorRegistry = [];
  const ctx = { slugger, anchorRegistry, stats: { merged: 0, fallback: 0 } };

  const outBlocks = [];
  // preamble(import / License 等)
  const enPre = enSections[0];
  const zhPre = zhSections[0];
  if (enPre && zhPre) {
    // import:输出中文版(两边一致)
    for (const node of zhPre.body) {
      if (node.type === "mdxjsEsm") continue; // 已在 split 中跳过
      const raw = trimBlank(slice(zhTrans, node));
      if (node.type === "html" && raw.startsWith("<!--")) {
        outBlocks.push(trimBlank(slice(enTrans, node))); // License 用英文
      } else {
        outBlocks.push(raw);
      }
    }
    // mdxjsEsm 从原始树补充(被 split 跳过)
    const imports = zhTree.children.filter((n) => n.type === "mdxjsEsm");
    for (const im of imports) outBlocks.unshift(trimBlank(slice(zhTrans, im)));
  }

  // 正文节配对
  const enBodySections = enSections.slice(1);
  const zhBodySections = zhSections.slice(1);
  const secCount = Math.max(enBodySections.length, zhBodySections.length);
  for (let s = 0; s < secCount; s++) {
    const enSec = enBodySections[s];
    const zhSec = zhBodySections[s];
    if (enSec && zhSec) {
      const mergedHeading = mergeHeading(
        enSec.heading,
        zhSec.heading,
        enTrans,
        zhTrans,
        slugger,
        anchorRegistry
      );
      outBlocks.push(mergedHeading);
      const mergedBody = mergeNodeArrays(enSec.body, zhSec.body, enTrans, zhTrans, ctx);
      if (mergedBody) outBlocks.push(mergedBody);
    } else if (enSec) {
      outBlocks.push(trimBlank(slice(enTrans, enSec.heading)));
      for (const n of enSec.body) outBlocks.push(trimBlank(slice(enTrans, n)));
    } else {
      outBlocks.push(trimBlank(slice(zhTrans, zhSec.heading)));
      for (const n of zhSec.body) outBlocks.push(trimBlank(slice(zhTrans, n)));
    }
  }

  // frontmatter
  const isIndexWithTitle = rel.match(/(^|\/)index\.(md|mdx)$/);
  const mergedFm = mergeFrontmatter(enParsed.data, zhParsed.data);
  // index 页的 H1 常由组件渲染,title 已足够
  const fmText = matter.stringify("", mergedFm).trim();

  const body = outBlocks.filter(Boolean).join("\n\n");
  const output = `${fmText}\n\n${body}\n`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output, "utf8");

  report.files.push({
    rel,
    blocks: outBlocks.length,
    merged: ctx.stats.merged,
    fallback: ctx.stats.fallback,
    anchors: anchorRegistry.length,
  });
}

// ---------- 主流程 ----------
function main() {
  const files = walk(EN_DIR);
  const report = { files: [], missingZh: [], errors: [] };
  for (const rel of files) {
    try {
      buildFile(rel, report);
    } catch (e) {
      report.errors.push({ rel, error: String(e && e.stack ? e.stack : e) });
      console.error(`ERROR ${rel}: ${e.message}`);
    }
  }
  const reportPath = REPORT_PATH ?? path.join(OUT_DIR, "../bilingual-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n生成完成: ${report.files.length}/${files.length} 个文件`);
  const totalFallback = report.files.reduce((s, f) => s + f.fallback, 0);
  console.log(`节点合并: ${report.files.reduce((s, f) => s + f.merged, 0)} 对,回退: ${totalFallback}`);
  if (report.missingZh.length) console.log(`缺少译文源: ${report.missingZh.length}`);
  if (report.errors.length) console.log(`错误: ${report.errors.length}`);
  console.log(`报告: ${reportPath}`);
}

main();