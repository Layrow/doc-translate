#!/usr/bin/env python3
"""校验翻译文件与英文源文件的结构一致性(框架无关)。

用法:
    python3 -I verify_translations.py <en_src_dir> <translated_dir>

校验项:
  - 围栏代码块逐字一致
  - Markdown 链接集合一致(@site/static/ 与 ../../static/ 视为等价)
  - License/版权 HTML 注释块一致
  - 正文 CJK 占比启发式检查(过长仍纯英文的正文报警)

已知误报(人工确认即可,不要盲改):
  - LINKS_DIFF:源文件 URL 被硬换行截断而译文合并修复了它
  - CODEBLOCK_DIFF:源文件存在缩进代码围栏导致正则跨块匹配
"""
import os
import re
import sys

CODE_BLOCK_RE = re.compile(r"^```[^\n]*\n(.*?)^```\s*$", re.MULTILINE | re.DOTALL)
LINK_RE = re.compile(r"\]\(([^)\s]+)")
LICENSE_RE = re.compile(r"<!--(.*?)-->", re.DOTALL)
FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")


def code_blocks(text):
    return [m.group(1) for m in CODE_BLOCK_RE.finditer(text)]


def links(text):
    # @site/static/ 与 ../../static/ 等价(i18n 目录下的图片路径适配)
    return [re.sub(r"^@site/static/", "../../static/", u) for u in LINK_RE.findall(text)]


def license_block(text):
    m = LICENSE_RE.search(text)
    return m.group(1).strip() if m else None


def frontmatter(text):
    m = FRONTMATTER_RE.match(text)
    return m.group(1) if m else ""


def check_file(src_rel, src_dir, dst_dir):
    src_path = os.path.join(src_dir, src_rel)
    dst_path = os.path.join(dst_dir, src_rel)
    issues = []
    if not os.path.exists(dst_path):
        return [f"MISSING: {src_rel}"]
    with open(src_path, encoding="utf-8") as f:
        src = f.read()
    with open(dst_path, encoding="utf-8") as f:
        dst = f.read()

    sb, db = code_blocks(src), code_blocks(dst)
    if len(sb) != len(db):
        issues.append(f"CODEBLOCK_COUNT: src={len(sb)} dst={len(db)}")
    else:
        for i, (a, b) in enumerate(zip(sb, db)):
            if a != b:
                issues.append(f"CODEBLOCK_DIFF: block#{i+1}")
                break

    sl, dl = sorted(links(src)), sorted(links(dst))
    if sl != dl:
        only_src = [x for x in sl if x not in dl][:5]
        only_dst = [x for x in dl if x not in sl][:5]
        issues.append(f"LINKS_DIFF: missing={only_src} extra={only_dst}")

    if license_block(src) != license_block(dst):
        issues.append("LICENSE_DIFF")

    body = FRONTMATTER_RE.sub("", dst, count=1)
    translated = len(CJK_RE.findall(body))
    if translated < 20 and len(body) > 800:
        issues.append(f"BODY_MOSTLY_UNTRANSLATED: target_lang_chars={translated}")

    return issues


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    src_dir, dst_dir = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    rels = []
    for root, _, files in os.walk(dst_dir):
        for fn in files:
            if fn.endswith((".md", ".mdx")):
                full = os.path.join(root, fn)
                rels.append(os.path.relpath(full, dst_dir))
    rels.sort()
    total_issues = 0
    for rel in rels:
        issues = check_file(rel, src_dir, dst_dir)
        if issues:
            total_issues += len(issues)
            print(f"[{rel}]")
            for i in issues:
                print(f"  - {i}")
    print(f"\n检查 {len(rels)} 个文件,发现 {total_issues} 个问题")


if __name__ == "__main__":
    main()