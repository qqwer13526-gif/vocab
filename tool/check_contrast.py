"""配色对比度审计（WCAG AA）。

为什么要有这个：颜色令牌是全局的，改一个 --ok 会影响「熟记」按钮、反馈条、档位标签、提示条
好几个地方；靠肉眼在深色/浅色两套主题里逐个看，迟早漏。这个脚本把"实际用到的前景/背景组合"
算成对比度，低于门槛就红。

三类检查：
  1. 语义组合：正文/次要文字/强调文字 落在 --bg、--card 上；白字落在实心底色上。
  2. 半透明底：像 `background: color-mix(in srgb, var(--ok) 14%, transparent)` 这种
     "同色系浅底 + 同色系文字"，要把浅底和它背后的 --bg / --card 合成了再算。
  3. 门槛：正文 4.5，非文字（描边、焦点圈）3.0。

用法：python tool/check_contrast.py      （不达标 exit 1）
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = (ROOT / "style.css").read_text(encoding="utf-8")


def hex2rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def lum(rgb: tuple[float, float, float]) -> float:
    out = []
    for v in rgb:
        c = v / 255
        out.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def ratio(a, b) -> float:
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def over(fg: tuple[float, float, float], bg: tuple[float, float, float], alpha: float):
    """把半透明前景压在背景上，得到实际看到的颜色。"""
    return tuple(fg[i] * alpha + bg[i] * (1 - alpha) for i in range(3))


def tokens(marker: str = "") -> dict[str, str]:
    """读 :root 里的颜色令牌。值可能是 #rrggbb，也可能是 var(--别的令牌)（深色下 --ok-ink 就指回 --ok）。"""
    if not marker:
        seg = CSS.split(":root {", 1)[1].split("}", 1)[0]
    else:
        i = CSS.index("prefers-color-scheme: dark")
        seg = CSS[i:].split(":root {", 1)[1].split("}", 1)[0]
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{3,6}|var\(--[\w-]+\))", seg))


def flatten(tok: dict[str, str]) -> dict[str, str]:
    """把 var(--x) 引用解开成真正的颜色值。"""
    out = dict(tok)
    for _ in range(5):
        changed = False
        for k, v in list(out.items()):
            m = re.fullmatch(r"var\(--([\w-]+)\)", v)
            if m and m.group(1) in out and out[m.group(1)] != v:
                out[k] = out[m.group(1)]
                changed = True
        if not changed:
            break
    return out


def hc_block(dark: bool) -> str:
    """取「提高对比度」那段 @media 的正文；dark=True 时取它跟深色主题叠加的那段。"""
    if dark:
        i = CSS.index("@media (prefers-contrast: more) and (prefers-color-scheme: dark)")
        return CSS[i:].split("{", 1)[1].split("\n}", 1)[0]
    i = CSS.index("@media (prefers-contrast: more) {")
    seg = CSS[i:].split("{", 1)[1]
    # 到下一个顶层 @media 为止（深色那段单独处理）
    j = seg.find("@media (prefers-contrast: more) and")
    return seg if j < 0 else seg[:j]


def hc_tokens(dark: bool) -> dict[str, str]:
    """提高对比度块里覆写的颜色令牌。"""
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{3,6}|var\(--[\w-]+\))", hc_block(dark)))


LIGHT = flatten(tokens())
DARK = flatten({**LIGHT, **tokens("dark")})

# (前景, 背景, 类别, 说明)。类别决定门槛：text 4.5（提高对比度下 7.0）、ui 3.0、deco 1.1
SEMANTIC = [
    ("fg", "bg", "text", "正文 / 页面底色"),
    ("fg", "card", "text", "正文 / 卡片"),
    ("muted", "bg", "text", "次要文字 / 页面底色"),
    ("muted", "card", "text", "次要文字 / 卡片"),
    ("accent-text", "bg", "text", "链接与强调文字 / 页面底色"),
    ("accent-text", "card", "text", "链接与强调文字 / 卡片"),
    ("ok", "card", "text", "「熟记」文字 / 卡片"),
    ("ok", "bg", "text", "「熟记」文字 / 页面底色"),
    ("warn", "card", "text", "提醒文字 / 卡片"),
    ("warn", "bg", "text", "提醒文字 / 页面底色"),
    ("bad", "card", "text", "「生疏」文字 / 卡片"),
    ("bad", "bg", "text", "「生疏」文字 / 页面底色"),
    ("ok-ink", "bg", "text", "浅底上的「熟记」墨字 / 页面底色"),
    ("ok-ink", "card", "text", "浅底上的「熟记」墨字 / 卡片"),
    ("warn-ink", "card", "text", "浅底上的提醒墨字 / 卡片"),
    ("bad-ink", "bg", "text", "浅底上的「生疏」墨字 / 页面底色"),
    ("bad-ink", "card", "text", "浅底上的「生疏」墨字 / 卡片"),
    ("#ffffff", "accent", "text", "主按钮/更新横幅 白字 / 强调色底", "base"),
    ("bg", "ok", "text", "「熟记」提示条 字 / 成功色底"),
    ("bg", "bad", "text", "「生疏」提示条 字 / 危险色底"),
    ("accent", "bg", "ui", "焦点圈 / 页面底色（非文字）"),
    ("line", "card", "line", "描边 / 卡片（提高对比度下要 ≥3）"),
    ("bg", "fg", "text", "提高对比度下的主按钮：底色当字、前景色当底", "hc"),
]

NEED = {"text": 4.5, "ui": 3.0, "deco": 1.1, "line": 1.1}
NEED_HC = {"text": 7.0, "ui": 3.0, "deco": 1.1, "line": 3.0}

# 提高对比度模式下这段 @media 里**不许出现**的属性：它只该改对比，不该改布局/尺寸/动效
LAYOUT_PROPS = (
    "padding", "margin", "width", "height", "inset", "top", "right", "bottom", "left",
    "gap", "display", "position", "grid", "flex", "font-size", "line-height", "letter-spacing",
    "transition", "animation", "transform", "order", "overflow",
)

# 半透明同色系底：把 CSS 里真实出现的 color-mix(... N%, transparent) 全捞出来
MIX = re.compile(
    r"background:\s*color-mix\(in srgb,\s*var\(--([\w-]+)\)\s*([\d.]+)%,\s*transparent\)"
)
COLOR = re.compile(r"color:\s*var\(--([\w-]+)\)")
RULE = re.compile(r"\{([^{}]*)\}")


def resolve(name: str, tok: dict[str, str]):
    if name.startswith("#"):
        return hex2rgb(name)
    if name not in tok:
        return None
    return hex2rgb(tok[name])


def tinted_cases():
    """从 CSS 规则里找出「半透明浅底 + 同色系文字」的组合。"""
    out = []
    for decls in RULE.findall(CSS):
        m = MIX.search(decls)
        if not m:
            continue
        c = COLOR.search(decls)
        if not c:
            continue
        out.append((c.group(1), m.group(1), float(m.group(2)) / 100, decls.strip().replace("\n", " ")[:60]))
    return out


def check_scheme(tag: str, tok: dict[str, str], hc: bool, fails: list[str]) -> None:
    need_of = NEED_HC if hc else NEED
    print(f"\n=== {tag} ===")
    for entry in SEMANTIC:
        fg, bg, cat, why = entry[:4]
        mode = entry[4] if len(entry) > 4 else "both"
        if mode == "base" and hc:
            continue
        if mode == "hc" and not hc:
            continue
        a, b = resolve(fg, tok), resolve(bg, tok)
        if a is None or b is None:
            continue
        need = need_of[cat]
        r = ratio(a, b)
        ok = r >= need
        if not ok:
            fails.append(f"{tag} {fg}/{bg} = {r:.2f} < {need}  ({why})")
        print(f"  {'OK ' if ok else '!! '}{fg:12s} on {bg:8s} = {r:5.2f}  (需 {need})   {why}")

    if hc:
        print("  -- 提高对比度下同色浅底已换成实底 + 描边，所以不再算半透明合成")
        return

    print("  -- 半透明同色底（已与 --bg / --card 合成）")
    for fg_t, bg_t, alpha, rule in tinted_cases():
        fg, base = resolve(fg_t, tok), resolve(bg_t, tok)
        if fg is None or base is None:
            continue
        for under_name in ("bg", "card"):
            under = resolve(under_name, tok)
            r = ratio(fg, over(base, under, alpha))
            ok = r >= 4.5
            if not ok:
                fails.append(f"{tag} {fg_t} 在 {bg_t}@{alpha:.0%}/{under_name} 上 = {r:.2f} < 4.5  ({rule})")
            print(f"  {'OK ' if ok else '!! '}{fg_t:12s} on {bg_t}@{alpha:.0%} over {under_name:4s} = {r:5.2f}")


def check_hc_block(fails: list[str]) -> None:
    """提高对比度那段 @media 的硬性约束：存在、只改对比。"""
    print("\n=== 提高对比度块自检 ===")
    if "@media (prefers-contrast: more)" not in CSS:
        fails.append("style.css 里没有 @media (prefers-contrast: more)")
        print("  !! 找不到 @media (prefers-contrast: more)")
        return
    print("  OK 存在 @media (prefers-contrast: more)")

    for label, seg in (("浅色", hc_block(False)), ("深色", hc_block(True))):
        seg = re.sub(r"/\*.*?\*/", "", seg, flags=re.S)  # 注释里也有冒号，先去掉
        props = []
        for decl in seg.split(";"):
            decl = decl.strip()
            if not decl or ":" not in decl:
                continue
            prop = decl.split(":", 1)[0].strip()
            if prop.startswith("--"):  # 令牌定义，允许
                continue
            if not prop:
                continue
            props.append(prop.split()[-1])
        bad = [p for p in props if p in LAYOUT_PROPS]
        if bad:
            fails.append(f"提高对比度（{label}）块里改了布局/动效属性：{sorted(set(bad))}")
            print(f"  !! {label}块里有布局属性：{sorted(set(bad))}")
        else:
            print(f"  OK {label}块只改颜色（{len(props)} 条声明）")


def main() -> int:
    fails: list[str] = []
    check_scheme("浅色", LIGHT, False, fails)
    check_scheme("深色", DARK, False, fails)
    check_scheme("提高对比度·浅色", flatten({**LIGHT, **hc_tokens(False)}), True, fails)
    check_scheme("提高对比度·深色", flatten({**DARK, **hc_tokens(False), **hc_tokens(True)}), True, fails)
    check_hc_block(fails)

    print("\n" + "=" * 64)
    if fails:
        print(f"不达标 {len(fails)} 项：")
        for f in fails:
            print("  -", f)
        return 1
    print("RESULT: OK —— 全部组合达到 WCAG AA（提高对比度下正文 7:1）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
