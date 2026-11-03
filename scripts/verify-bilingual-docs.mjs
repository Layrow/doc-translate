/**
 * 校验双语对照版文档的结构完整性。
 *
 * 用法(建议复制到目标项目 docs/scripts/ 下运行):
 *   node verify-bilingual-docs.mjs <en_src_dir> <bilingual_out_dir> [zh_src_dir]
 *
 * 校验项:代码块逐字一致、链接集合一致、标题数量一致、每个标题都有锚点、
 * frontmatter 标题含译文(仅当译文源标题含 CJK 时要求)。
 */
import fs from "node:fs";
import path from "node:path";

const EN_DIR = path.resolve(process.argv[2] ?? "docs");
const OUT_DIR = path.resolve(
  process.argv[3] ?? "i18n/zh-Hans/docusaurus-plugin-content-docs/current"
);
const ZH_DIR = process.argv[4] ? path.resolve(process.argv[4]) : null;
if (!fs.existsSync(EN_DIR) || !fs.existsSync(OUT_DIR)) {
  console.error(
    "用法: node verify-bilingual-docs.mjs <en_src_dir> <bilingual_out_dir> [zh_src_dir]"
  );
  process.exit(2);
}

const CODE_RE = /^```[^\n]*\n([\s\S]*?)^```\s*$/gm;
const LINK_RE = /\]\(([^)\s]+)\)/g;
const HEADING_RE = /^#{1,6}\s+.*(?:\{#([^}]+)\})?\s*$/gm;

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

function codeBlocks(text) {
  return [...text.matchAll(CODE_RE)].map((m) => m[1]);
}
function links(text) {
  return [...text.matchAll(LINK_RE)].map((m) => m[1].replace(/^@site\/static\//, "../../static/"));
}

const files = walk(EN_DIR);
const issues = [];
let checked = 0;

for (const rel of files) {
  const enPath = path.join(EN_DIR, rel);
  const outPath = path.join(OUT_DIR, rel);
  if (!fs.existsSync(outPath)) {
    issues.push({ rel, type: "MISSING" });
    continue;
  }
  checked++;
  const en = fs.readFileSync(enPath, "utf8");
  const out = fs.readFileSync(outPath, "utf8");

  // 代码块一致
  const enCode = codeBlocks(en);
  const outCode = codeBlocks(out);
  if (enCode.length !== outCode.length) {
    issues.push({ rel, type: "CODEBLOCK_COUNT", en: enCode.length, out: outCode.length });
  } else {
    for (let i = 0; i < enCode.length; i++) {
      if (enCode[i] !== outCode[i]) {
        issues.push({ rel, type: "CODEBLOCK_DIFF", block: i + 1 });
        break;
      }
    }
  }

  // 链接集合一致(允许 @site 路径等价)
  const enLinks = links(en).sort();
  const outLinks = links(out).sort();
  const missing = enLinks.filter((x) => !outLinks.includes(x));
  const extra = outLinks.filter((x) => !enLinks.includes(x));
  if (missing.length || extra.length) {
    issues.push({ rel, type: "LINKS_DIFF", missing: missing.slice(0, 3), extra: extra.slice(0, 3) });
  }

  // 标题数量与锚点(先剥离代码块,避免把代码内 # 注释当成标题)
  const stripCode = (s) => s.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  const enNoCode = stripCode(en);
  const outNoCode = stripCode(out);
  const enHeadings = [...enNoCode.matchAll(/^#{1,6}\s+/gm)].length;
  const outHeadings = [...outNoCode.matchAll(/^#{1,6}\s+/gm)].length;
  if (enHeadings !== outHeadings) {
    issues.push({ rel, type: "HEADING_COUNT", en: enHeadings, out: outHeadings });
  }
  const headingLines = [...outNoCode.matchAll(/^#{1,6}\s+.*$/gm)].map((m) => m[0]);
  const withoutAnchor = headingLines.filter((l) => !/\{#[^}]+\}\s*$/.test(l));
  if (withoutAnchor.length) {
    issues.push({ rel, type: "HEADING_NO_ANCHOR", count: withoutAnchor.length, sample: withoutAnchor[0].slice(0, 80) });
  }

  // frontmatter 标题:仅当中文源标题含中文时才要求对照标题含中文
  const zhPath = ZH_DIR ? path.join(ZH_DIR, rel) : null;
  let zhTitle = "";
  if (zhPath && fs.existsSync(zhPath)) {
    const zh = fs.readFileSync(zhPath, "utf8");
    const zm = zh.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (zm) zhTitle = zm[1];
  }
  const titleMatch = out.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  if (titleMatch && /[\u4e00-\u9fff]/.test(zhTitle)) {
    const title = titleMatch[1];
    if (!/[\u4e00-\u9fff]/.test(title)) {
      issues.push({ rel, type: "TITLE_NO_CJK", title });
    }
  }
}

console.log(`检查 ${checked}/${files.length} 个文件,发现 ${issues.length} 个问题`);
const byType = {};
for (const i of issues) byType[i.type] = (byType[i.type] || 0) + 1;
console.log("问题分布:", JSON.stringify(byType));
if (issues.length) {
  console.log("\n前 40 条问题:");
  for (const i of issues.slice(0, 40)) console.log(" ", JSON.stringify(i));
  process.exitCode = 1;
}