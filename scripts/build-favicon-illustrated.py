"""Build favicon.png from assets/clapper-source.png: transparent BG + tight crop + 256 square."""
from __future__ import annotations

import pathlib
from collections import deque

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "clapper-source.png"
OUT = ROOT / "favicon.png"
SIZE = 256


def matte_and_crop(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    def edge_light(r: int, g: int, b: int, a: int) -> bool:
        return a > 200 and r >= 248 and g >= 248 and b >= 248

    seen: set[tuple[int, int]] = set()
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or x >= w or y < 0 or y >= h or (x, y) in seen:
            continue
        r, g, b, a = px[x, y]
        if not edge_light(r, g, b, a):
            continue
        seen.add((x, y))
        px[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q.append((x + dx, y + dy))

    def peel_white(r: int, g: int, b: int, a: int) -> bool:
        return a > 200 and r >= 246 and g >= 246 and b >= 246

    q = deque()
    seen = set()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] < 12:
                seen.add((x, y))
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or nx >= w or ny < 0 or ny >= h or (nx, ny) in seen:
                continue
            r, g, b, a = px[nx, ny]
            if peel_white(r, g, b, a):
                px[nx, ny] = (r, g, b, 0)
                seen.add((nx, ny))
                q.append((nx, ny))

    min_x = min_y = 10**9
    max_x = max_y = -1
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 16:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if max_x < min_x:
        return im

    span = max(max_x - min_x + 1, max_y - min_y + 1)
    pad = max(2, int(span * 0.018))
    min_x = max(0, min_x - pad)
    min_y = max(0, min_y - pad)
    max_x = min(w - 1, max_x + pad)
    max_y = min(h - 1, max_y + pad)
    return im.crop((min_x, min_y, max_x + 1, max_y + 1))


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Missing {SRC}")
    cropped = matte_and_crop(Image.open(SRC))
    cw, ch = cropped.size
    scale = min(SIZE / cw, SIZE / ch) * 0.992
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(resized, ((SIZE - nw) // 2, (SIZE - nh) // 2), resized)
    out.save(str(OUT), "PNG")
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
