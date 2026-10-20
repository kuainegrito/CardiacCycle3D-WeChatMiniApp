#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check (or fix) chronological order of the README logs.

Sections handled:
  - "## 更新记录"  (dated "- 2026-…" bullets)
  - "## 开发记录"  (dated "### 2026-…" blocks; same-day rounds like
    （第二轮） order after the unnumbered entry)

Usage:
  python tools/check-readme-order.py          # verify only, exit 1 if out of order
  python tools/check-readme-order.py --fix    # rewrite README.md sorted ascending

Blocks are moved as whole units; no line content is added, removed, or
edited. Line endings are preserved.
"""
import re
import sys
from pathlib import Path

README = Path(__file__).resolve().parent.parent / "README.md"

BULLET = re.compile(r"- (\d{4}-\d{2}-\d{2})")
HEADING = re.compile(r"### (\d{4}-\d{2}-\d{2})")
ROUND = re.compile(r"（第?([一二三四五六七八九十]+)）")
CN = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def round_no(heading):
    m = ROUND.search(heading)
    return CN.get(m.group(1), 1) if m else 1


def find_section(lines, title):
    start = lines.index(title)
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    return start, end


def check_bullets(lines, fix, report):
    start, end = find_section(lines, "## 更新记录")
    seg = lines[start:end]
    first = next(i for i, l in enumerate(seg) if l.startswith("- "))
    pre, bullets = seg[:first], seg[first:]
    while bullets and bullets[-1] == "":
        bullets.pop()
    keys = [BULLET.match(b).group(1) for b in bullets]
    bad = [(bullets[i], keys[i - 1]) for i in range(1, len(keys)) if keys[i] < keys[i - 1]]
    if bad:
        report.append(("## 更新记录", bad))
    if fix:
        bullets = [b for _, b in sorted(zip(keys, bullets), key=lambda p: p[0])]
        lines = lines[:start] + pre + bullets + [""] + lines[end:]
    return lines


def check_blocks(lines, fix, report):
    start, end = find_section(lines, "## 开发记录")
    seg = lines[start:end]
    first = next(i for i, l in enumerate(seg) if l.startswith("### "))
    pre, rest = seg[:first], seg[first:]
    blocks, cur = [], []
    for line in rest:
        if line.startswith("### ") and cur:
            blocks.append(cur)
            cur = [line]
        else:
            cur.append(line)
    if cur:
        blocks.append(cur)
    keys = [(HEADING.match(b[0]).group(1), round_no(b[0])) for b in blocks]
    bad = [(blocks[i][0], keys[i - 1]) for i in range(1, len(keys)) if keys[i] < keys[i - 1]]
    if bad:
        report.append(("## 开发记录", bad))
    if fix:
        blocks = [b for _, b in sorted(zip(keys, blocks), key=lambda p: p[0])]
        lines = lines[:start] + pre + [l for b in blocks for l in b] + lines[end:]
    return lines


def main():
    fix = "--fix" in sys.argv
    raw = README.read_bytes()
    nl = "\r\n" if b"\r\n" in raw else "\n"
    lines = raw.decode("utf-8").replace("\r\n", "\n").split("\n")
    report = []
    lines = check_bullets(lines, fix, report)
    lines = check_blocks(lines, fix, report)
    for name, bad in report:
        print(f"OUT OF ORDER in {name}:")
        for item, prev in bad:
            print(f"  {item[:70]}")
    if report and not fix:
        print("run with --fix to reorder")
        sys.exit(1)
    if fix:
        README.write_bytes(nl.join(lines).encode("utf-8"))
        print(f"{README.name}: reordered ({nl!r} line endings preserved)")
    elif not report:
        print(f"{README.name}: all log entries in chronological order")


if __name__ == "__main__":
    main()
