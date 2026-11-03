#!/usr/bin/env node
/**
 * 自动修复翻译文档的断链锚点(Docusaurus)。
 *
 * 解析 docusaurus build 日志中的 broken anchors,在英文源文件中用 github-slugger
 * 反查该 slug 对应的标题(按标题出现序号),在译文对应标题上补 {#slug} 锚点。
 * 迭代运行(修复 → 重新构建 → 再修复)直到 0 断链。
 *
 * 用法(建议把本文件复制到目标项目 docs/scripts/ 下运行,github-slugger 会从
 * 目标项目 node_modules 向上解析):
 *   node fix_anchors.mjs <build_log> <en_src_dir> <translated_dir> [route_base]
 *
 *   build_log     docusaurus build 的完整输出(含 Exhaustive list of all broken anchors)
 *   en_src_dir    英文源文档目录,如 <project>/docs/docs
 *   translated_dir 译文目录,如 <project>/docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current
 *   route_base    站点路由前缀,默认 /docs/master/(从日志 resolved URL 中剥离)
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const LOG = process.argv[2];
const SRC_DIR = path.resolve(process.argv[3] ?? "docs");
const DST_DIR = path.resolve(process.argv[4] ?? "i18n/zh-Hans/docusaurus-plugin-content-docs/current");
const ROUTE_BASE = process.argv[5] ?? "/docs/master/";

if (!LOG || !fs.existsSync(LOG)) {
  console.error("用法: node fix_anchors.mjs <build_log> <en_src_dir> <translated_dir> [route_base]");
  process.exit(2);
}

// 从 DST_DIR 向上查找项目 node_modules 中的 github-slugger
async function loadSlugger() {
  let dir = path.resolve(DST_DIR);
  while (true) {
    const candidate = path.join(dir, "node_modules", "github-slugger", "index.js");
    if (fs.existsSync(candidate)) {
      const mod = await import(pathToFileURL(candidate).href);
      return mod.default;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("github-slugger not found: 请在目标项目内运行");
    dir = parent;
  }
}
const { default: GithubSlugger } = await loadSlugger();

// ---------- 解析日志 ----------
const text = fs.readFileSync(LOG, "utf8");
const broken = [];
for (const line of text.split("\n")) {
  const m = line.match(/linking to (?:\S*?)#(\S+)\s+\(resolved as: (\S+?)#(.+?)\)\s*$/);
  if (m) broken.push({ resolvedPath: m[2], anchor: m[3] });
}
console.log(`解析到 ${broken.length} 条断链`);

// 无 resolved as 的绝对链接(如 /docs/master/x#y)兜底解析
for (const line of text.split("\n")) {
  const m = line.match(/linking to (\/\S+?)#(\S+)\s*$/);
  if (m && !line.includes("resolved as")) broken.push({ resolvedPath: m[1], anchor: m[2] });
}

// ---------- route -> 源文件 ----------
function routeToFile(route) {
  let rel = route.replace(new RegExp(`^${ROUTE_BASE.replace(/[/]/g, "\\/")}/?`), "");
  rel = rel.replace(/\/$/, "");
  const candidates = [];
  if (rel === "" || rel.endsWith("/")) {
    candidates.push(path.join(SRC_DIR, rel, "index.md"), path.join(SRC_DIR, rel, "index.mdx"));
  } else {
    candidates.push(
      path.join(SRC_DIR, rel + ".md"),
      path.join(SRC_DIR, rel + ".mdx"),
      path.join(SRC_DIR, rel, "index.md"),
      path.join(SRC_DIR, rel, "index.mdx")
    );
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function srcToDst(srcFile) {
  return path.join(DST_DIR, path.relative(SRC_DIR, srcFile));
}

// ---------- 标题提取 ----------
const HEADING_RE = /^(#{1,6}\s+)(.*)$/;
function extractHeadings(content) {
  const arr = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m) {
      arr.push({ lineIndex: i, line: lines[i], text: m[2].replace(/\s*\{#[^}]*\}\s*$/, "").trim() });
    }
  }
  return arr;
}

function cleanHeadingText(t) {
  return t
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*~]/g, "")
    .trim();
}

// ---------- 按目标文件聚合 ----------
const byTarget = new Map();
let unmapped = 0;
for (const b of broken) {
  const srcFile = routeToFile(b.resolvedPath);
  if (!srcFile) {
    console.log(`!! 无法映射 route: ${b.resolvedPath}`);
    unmapped++;
    continue;
  }
  if (!byTarget.has(srcFile)) byTarget.set(srcFile, new Set());
  byTarget.get(srcFile).add(b.anchor);
}

let fixedCount = 0;
let failCount = 0;
for (const [srcFile, anchors] of byTarget) {
  const dstFile = srcToDst(srcFile);
  if (!fs.existsSync(dstFile)) {
    console.log(`!! 译文不存在: ${dstFile}`);
    failCount += anchors.size;
    continue;
  }
  const srcContent = fs.readFileSync(srcFile, "utf8");
  const dstContent = fs.readFileSync(dstFile, "utf8");
  const srcHeadings = extractHeadings(srcContent);
  const dstHeadings = extractHeadings(dstContent);

  const slugger = new GithubSlugger();
  const slugToIndex = new Map();
  srcHeadings.forEach((h, idx) => {
    const slug = slugger.slug(cleanHeadingText(h.text));
    if (!slugToIndex.has(slug)) slugToIndex.set(slug, []);
    slugToIndex.get(slug).push(idx);
  });

  const dstLines = dstContent.split("\n");
  let changed = false;
  for (const anchor of anchors) {
    const idxs = slugToIndex.get(anchor);
    if (!idxs || idxs.length === 0) {
      console.log(`   ?? ${path.relative(SRC_DIR, srcFile)}: 源文件无 slug '${anchor}'`);
      failCount++;
      continue;
    }
    const idx = idxs[0];
    const dstH = dstHeadings[idx];
    if (!dstH) {
      console.log(`   ?? ${path.relative(SRC_DIR, srcFile)}: 译文标题数量不足 (idx=${idx})`);
      failCount++;
      continue;
    }
    const lineIdx = dstH.lineIndex;
    const line = dstLines[lineIdx];
    if (line.includes(`{#${anchor}}`)) continue;
    if (/\{#([^}]*)\}\s*$/.test(line)) {
      dstLines.splice(lineIdx, 0, `<a id="${anchor}"></a>`);
      for (let j = 0; j < dstHeadings.length; j++) {
        if (dstHeadings[j].lineIndex >= lineIdx) dstHeadings[j].lineIndex += 1;
      }
      changed = true;
      fixedCount++;
    } else {
      dstLines[lineIdx] = line.replace(/\s*$/, "") + ` {#${anchor}}`;
      changed = true;
      fixedCount++;
    }
  }
  if (changed) {
    fs.writeFileSync(dstFile, dstLines.join("\n"), "utf8");
    console.log(`OK ${path.relative(SRC_DIR, srcFile)} (+${anchors.size})`);
  }
}
console.log(`\n修复 ${fixedCount} 处,失败 ${failCount} 处,未映射 ${unmapped} 条`);
