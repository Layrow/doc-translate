#!/usr/bin/env node
/**
 * 增量同步检查:对比上游文档与本地英文快照,输出增量翻译清单。
 *
 * 用法:
 *   node sync-check.mjs <upstream_docs_dir> <local_docs_dir> [--json <out.json>]
 *
 * 例(上游 sparse clone 后):
 *   node scripts/sync-check.mjs /tmp/paimon-upstream/docs docs --json sync-report.json
 *
 * 输出三类清单(相对路径,md/mdx):
 *   - added    上游新增页面 → 需要新翻译
 *   - modified 两边都有但内容不同 → 需要补译(附变化行数,辅助决策整页重译或局部补译)
 *   - removed  上游已删除 → 需要从译文/对照产物中清理
 *   - unchanged 未变化(零成本)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const jsonIdx = args.indexOf("--json");
const REPORT = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const pos = args.filter((a) => a !== "--json" && a !== (jsonIdx >= 0 ? args[jsonIdx + 1] : null));
const UP_DIR = path.resolve(pos[0] ?? ".");
const LOCAL_DIR = path.resolve(pos[1] ?? "docs");
if (!fs.existsSync(UP_DIR) || !fs.existsSync(LOCAL_DIR)) {
  console.error("用法: node sync-check.mjs <upstream_docs_dir> <local_docs_dir> [--json out.json]");
  process.exit(2);
}

const MD_RE = /\.(md|mdx)$/;

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (MD_RE.test(entry.name)) out.push(path.relative(base, full));
  }
  return out;
}

const hash = (s) => crypto.createHash("sha1").update(s).digest("hex");

// 粗略变化度:仅在单侧出现的行数(排除空行),供决策参考
function diffScale(a, b) {
  const la = new Set(a.split("\n").map((l) => l.trim()).filter(Boolean));
  const lb = new Set(b.split("\n").map((l) => l.trim()).filter(Boolean));
  let onlyA = 0;
  for (const l of la) if (!lb.has(l)) onlyA++;
  let onlyB = 0;
  for (const l of lb) if (!la.has(l)) onlyB++;
  return { removedLines: onlyA, addedLines: onlyB };
}

const upFiles = walk(UP_DIR);
const localFiles = walk(LOCAL_DIR);
const upSet = new Set(upFiles);
const localSet = new Set(localFiles);

const added = [];
const modified = [];
const unchanged = [];

for (const rel of upFiles) {
  if (!localSet.has(rel)) {
    added.push(rel);
    continue;
  }
  const up = fs.readFileSync(path.join(UP_DIR, rel), "utf8");
  const loc = fs.readFileSync(path.join(LOCAL_DIR, rel), "utf8");
  if (hash(up) === hash(loc)) unchanged.push(rel);
  else modified.push({ rel, ...diffScale(up, loc) });
}
const removed = localFiles.filter((rel) => !upSet.has(rel));

added.sort();
modified.sort((a, b) => b.addedLines + b.removedLines - (a.addedLines + a.removedLines));
removed.sort();

console.log(`上游页面: ${upFiles.length}  本地快照: ${localFiles.length}`);
console.log(`  新增   added:    ${added.length}`);
console.log(`  修改   modified: ${modified.length}`);
console.log(`  删除   removed:  ${removed.length}`);
console.log(`  未变   unchanged:${unchanged.length}  ← 零成本`);

if (added.length) {
  console.log("\n[新增页面,需要新翻译]");
  for (const rel of added) console.log("  +", rel);
}
if (modified.length) {
  console.log("\n[修改页面,需要补译](按变化量降序,+新增行/-消失行)");
  for (const m of modified) console.log(`  ~ ${m.rel} (+${m.addedLines} -${m.removedLines})`);
}
if (removed.length) {
  console.log("\n[上游已删除,需清理译文]");
  for (const rel of removed) console.log("  -", rel);
}

if (REPORT) {
  fs.writeFileSync(
    REPORT,
    JSON.stringify({ added, modified, removed, unchangedCount: unchanged.length, upstream: upFiles.length, local: localFiles.length }, null, 2),
    "utf8"
  );
  console.log(`\nJSON 报告: ${REPORT}`);
}
