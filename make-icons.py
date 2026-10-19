# -*- coding: utf-8 -*-
"""Рисует иконки Reelista — «волна с вырезом», вариант «Красная склейка».

    python make-icons.py

Рисуем в 4-кратном размере и уменьшаем — так края получаются гладкими.
Геометрия та же, что в icon.svg (сетка 512×512).

На выходе:
  icon.png             512×512 — обычная иконка (PWA, магазины)
  icon-maskable.png    512×512 — с полями под круглую обрезку Android
  apple-touch-icon.png 180×180 — для «На экран Домой» на iPhone (углы скругляет сама iOS)
  favicon.png          64×64   — вкладка браузера
"""
from PIL import Image, ImageDraw

S = 512
K = 4

# Фамильные цвета Mynado / InveStory: тёмно-синий фон и золотой знак.
# Красная точка — фирменный цвет Reelista (точка записи, место склейки).
BG_TOP, BG_BOTTOM = (0x1E, 0x2F, 0x52), (0x0F, 0x1A, 0x30)
GOLD = [(0xF6, 0xD8, 0x88), (0xE8, 0xB3, 0x4E), (0xCF, 0x94, 0x30)]
SHADOW = (0x0E, 0x18, 0x30)
RED = (0xFF, 0x5A, 0x4E)

# Звуковая волна: (x, верх, низ) — концы линий толщиной 40 с круглыми краями.
# Между третьей и четвёртой «капсулой» — вырезанная пауза, в ней красная точка.
BARS = [(118, 222, 290), (168, 179, 333), (218, 205, 307), (340, 162, 350), (390, 213, 299)]
BAR_W = 40
DOT = (279, 256, 22)


def lerp(a, b, f):
    return tuple(int(a[i] + (b[i] - a[i]) * f) for i in range(3))


def vertical(size, top, bottom):
    img = Image.new('RGB', (1, size))
    px = img.load()
    for y in range(size):
        px[0, y] = lerp(top, bottom, y / (size - 1))
    return img.resize((size, size))


def diagonal_gold(size, scale):
    """Золото по диагонали, как у Mynado: от (110,110) к (400,400) в сетке 512."""
    small = Image.new('RGB', (128, 128))
    px = small.load()
    for y in range(128):
        for x in range(128):
            gx, gy = x * 4 + 2, y * 4 + 2
            f = ((gx - 110) + (gy - 110)) / (2 * 290)
            f = max(0.0, min(1.0, f))
            px[x, y] = lerp(GOLD[0], GOLD[1], f * 2) if f < 0.5 else lerp(GOLD[1], GOLD[2], (f - 0.5) * 2)
    return small.resize((size, size), Image.BICUBIC)


def bars_mask(size, scale, cx, cy, dy=0):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    r = BAR_W / 2
    for x, y1, y2 in BARS:
        X, Y1, Y2 = cx + (x - 256) * scale, cy + (y1 - 256 + dy) * scale, cy + (y2 - 256 + dy) * scale
        d.rounded_rectangle([X - r * scale, Y1 - r * scale, X + r * scale, Y2 + r * scale], radius=r * scale, fill=255)
    return m


def render(glyph_scale=1.0):
    """Квадрат без скруглений: углы скругляют сами iOS и Android."""
    size = S * K
    scale = K * glyph_scale
    c = size / 2
    img = vertical(size, BG_TOP, BG_BOTTOM).convert('RGBA')
    shadow = Image.new('RGBA', (size, size), SHADOW + (0,))
    shadow.putalpha(bars_mask(size, scale, c, c, dy=9).point(lambda v: int(v * 0.3)))
    img = Image.alpha_composite(img, shadow)
    gold = diagonal_gold(size, scale).convert('RGBA')
    gold.putalpha(bars_mask(size, scale, c, c))
    img = Image.alpha_composite(img, gold)
    d = ImageDraw.Draw(img)
    x, y, r = DOT
    X, Y, R = c + (x - 256) * scale, c + (y - 256) * scale, r * scale
    d.ellipse([X - R, Y - R, X + R, Y + R], fill=RED + (255,))
    return img.convert('RGB').resize((S, S), Image.LANCZOS)


if __name__ == '__main__':
    icon = render(1.0)
    icon.save('icon.png', optimize=True)
    # Android режет иконку кругом: знак держим внутри безопасной зоны (радиус 40% от размера).
    render(0.82).save('icon-maskable.png', optimize=True)
    icon.resize((180, 180), Image.LANCZOS).save('apple-touch-icon.png', optimize=True)
    icon.resize((64, 64), Image.LANCZOS).save('favicon.png', optimize=True)
    print('icon.png, icon-maskable.png, apple-touch-icon.png, favicon.png — готово')
