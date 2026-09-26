"""把 Excel 词表（.xlsx）转成能直接导入本应用的文件（.tsv）。

为什么要它：应用里导入需要"选中两列 → Ctrl+C → 粘贴"，每次都要手动。这个脚本把
整个工作表原样导成 Tab 分隔的文本，之后在应用里点「导入 → 选择文件…」就行。

它**不**自己判断哪列是单词——那是应用里已经在你真表上验证过的解析逻辑干的活；
转完它会自动用 src/parse.js 跑一遍自检，告诉你认出多少词、哪列是哪列。

用法：
    python tool/xlsx_to_tsv.py                       # 自动在常见位置找"背诵检查表"之类的文件
    python tool/xlsx_to_tsv.py "D:\\MyFiles\\英语词汇背诵检查表（一）.xlsx"
    python tool/xlsx_to_tsv.py "D:\\MyFiles"         # 整个文件夹里的 xlsx 都转
    python tool/xlsx_to_tsv.py <输入> --out "D:\\MyFiles\\导入用"
    python tool/xlsx_to_tsv.py <输入> --dry           # 只列出来，不写文件
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
CHECKER = ROOT / "tool" / "check_tsv.mjs"

# 没给路径时去这些地方找
SEARCH_DIRS = [
    Path.home() / "Desktop",
    Path.home() / "Documents",
    Path.home() / "Downloads",
    Path(r"D:\MyFiles"),
    Path(r"D:\Study"),
    Path(r"D:\Downloads"),
]
NAME_HINTS = ("背诵检查表", "词汇", "单词", "词表", "vocab", "word")


def find_inputs() -> list[Path]:
    found: list[Path] = []
    for d in SEARCH_DIRS:
        if not d.exists():
            continue
        # 常见位置本身 + 往里一层（比如 D:\Study\CET\表一.xlsx）
        for p in sorted([*d.glob("*.xlsx"), *d.glob("*/*.xlsx")]):
            if p.name.startswith("~$"):
                continue
            if any(h in p.name.lower() for h in NAME_HINTS):
                found.append(p)
    return found


def cell_text(v) -> str:
    """单元格 → 文本。换行会破坏 TSV 的行结构，换成空格。"""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).replace("\r", " ").replace("\n", " ").replace("\t", " ").strip()


def sheet_to_tsv(ws) -> tuple[str, int]:
    lines: list[str] = []
    for row in ws.iter_rows(values_only=True):
        cells = [cell_text(c) for c in row]
        while cells and cells[-1] == "":
            cells.pop()  # 去掉行尾空列
        if not any(cells):
            lines.append("")  # 空行留着（应用会自己跳过，保留行号更直观）
            continue
        lines.append("\t".join(cells))
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines) + "\n", len(lines)


def self_check(path: Path) -> dict | None:
    """用应用自己的解析逻辑检查一遍（需要 node，没有就跳过）。"""
    if not CHECKER.exists():
        return None
    try:
        p = subprocess.run(
            ["node", str(CHECKER), str(path)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return {"error": (p.stderr or "").strip()[:200]}
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return None


def convert(src: Path, out_dir: Path | None, dry: bool) -> int:
    if not src.exists():
        print(f"找不到文件：{src}")
        return 1
    if src.name.startswith("~$"):
        return 0
    try:
        wb = load_workbook(src, data_only=True)
    except Exception as e:  # noqa: BLE001
        print(f"打不开 {src.name}：{type(e).__name__}: {e}")
        return 1

    targets = out_dir or src.parent
    sheets = wb.worksheets
    total_words = 0
    for ws in sheets:
        multi = len(sheets) > 1
        name = f"{src.stem}-{ws.title}.tsv" if multi else f"{src.stem}.tsv"
        text, lines = sheet_to_tsv(ws)
        if not text.strip():
            print(f"  （跳过空工作表 {ws.title}）")
            continue
        out = targets / name
        print(f"\n▸ {src.name} / 工作表「{ws.title}」→ {out}")
        if dry:
            continue
        targets.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8", newline="\n")
        print(f"  已写入：{len(text)} 字节，{lines} 行")

        rep = self_check(out)
        if rep is None:
            print("  （没跑自检：需要 node 在 PATH 里）")
        elif "error" in rep:
            print(f"  自检失败：{rep['error']}")
        else:
            total_words += int(rep.get("words") or 0)
            how = "靠表头关键词认列" if rep.get("columnSource") == "header" else "按内容猜列"
            print(
                f"  自检：认出 {rep['words']} 个词（{how}；单词=第{int(rep['termCol']) + 1}列，"
                f"释义=第{int(rep['meanCol']) + 1}列"
                + (f"，词性=第{int(rep['posCol']) + 1}列" if int(rep["posCol"]) >= 0 else "")
                + (f"，例句=第{int(rep['exampleCol']) + 1}列" if int(rep["exampleCol"]) >= 0 else "")
                + "）"
            )
            for s in rep.get("sample", []):
                print(f"    例：{s['term']}  {s.get('pos', '')}  {'；'.join(s['meanings'])}")
            if int(rep["words"]) == 0:
                print("    ⚠️ 一个词都没认出来，把列手动改一下再导（应用里可以改）")

    if total_words:
        print(f"\n共认出 {total_words} 个词。回应用 →「导入」→「选择文件…」选上面这些 .tsv 就行。")
    return 0


def main() -> int:
    argv = sys.argv[1:]
    dry = "--dry" in argv
    out_dir = None
    ins: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--out":
            out_dir = Path(argv[i + 1])
            i += 2
            continue
        if a.startswith("--out="):
            out_dir = Path(a.split("=", 1)[1])
        elif not a.startswith("--"):
            ins.append(a)
        i += 1

    if not ins:
        found = find_inputs()
        if not found:
            print("没在常见位置找到词表。请直接把文件路径给我，例如：")
            print('  python tool/xlsx_to_tsv.py "D:\\MyFiles\\英语词汇背诵检查表（一）.xlsx"')
            return 1
        print("自动找到这些文件：")
        for p in found:
            print("  ", p)
        ins = [str(p) for p in found]

    rc = 0
    for s in ins:
        p = Path(s)
        if p.is_dir():
            xs = [x for x in sorted(p.glob("*.xlsx")) if not x.name.startswith("~$")]
            if not xs:
                print(f"{p} 里没有 .xlsx")
                continue
            for x in xs:
                rc |= convert(x, out_dir, dry)
        else:
            rc |= convert(p, out_dir, dry)
    return rc


if __name__ == "__main__":
    sys.exit(main())
