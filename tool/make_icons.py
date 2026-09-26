"""生成 PWA 需要的三个图标（任务 1）。

画法：圆角方块底 + 白色「词」字，四周留 12% 内边距（这样也能当 maskable 图标用）。

用法：python tool/make_icons.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ACCENT = (59, 91, 255)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",   # 微软雅黑 粗体
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    raise SystemExit("找不到可用的中文字体（试过 " + ", ".join(FONT_CANDIDATES) + "）")


def make_icon(size: int) -> Image.Image:
    ss = 4  # 超采样，边缘更干净
    big = size * ss
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(big * 0.22)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=ACCENT)

    # 白字，占 46% 高度
    font = load_font(int(big * 0.46))
    text = "词"
    box = d.textbbox((0, 0), text, font=font)
    d.text(
        ((big - (box[2] - box[0])) / 2 - box[0], (big - (box[3] - box[1])) / 2 - box[1]),
        text,
        font=font,
        fill=(255, 255, 255, 255),
    )
    return img.resize((size, size), Image.LANCZOS)


def main() -> int:
    out = [
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("apple-touch-icon.png", 180),
    ]
    for name, size in out:
        path = ROOT / name
        make_icon(size).save(path, "PNG", optimize=True)
        print(f"已生成 {name} ({size}x{size}, {path.stat().st_size} 字节)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
