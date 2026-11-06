"""Draws TOTR's Android launcher icon, splash screen and desktop icon in the app's own look: the VT323 terminal font, the pink and cyan
glitch shadow of the header logo, on the indigo Dreamspace background. The icon is a "T_" (letter and blinking-cursor underscore); the
splash shows the full "TOTR_". Needs rsvg-convert and Pillow, and `npm install` done (the font comes from @fontsource/vt323).
Run from TOTRspa/TOTRspa_apk/:  python3 tools/make-android-art.py   (or npm run art)
Writes into android/app/src/main/res (icons for every density, splash for every size, the icon background colour) and ../shared/assets/icon.png (the desktop icon: run `node tools/sync-vendor.cjs` at the repo root afterwards to copy it into the desktop shells)."""
import io
import pathlib
import struct
import subprocess
import zlib
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve().parent.parent
RES = HERE / "android" / "app" / "src" / "main" / "res"
WOFF = HERE / "node_modules" / "@fontsource" / "vt323" / "files" / "vt323-latin-400-normal.woff"
BG1, BG2 = "#0b0720", "#150c33"
PINK, CYAN, PALE = (255, 157, 230), (138, 243, 255), (232, 251, 255)


def woff_to_ttf(data):
    """WOFF 1 is an sfnt with each table zlib-compressed: unpack the tables and lay them out again."""
    _sig, flavor, _length, n, *_rest = struct.unpack(">4sIIHHIHHIIIII", data[:44])
    tables = []
    for i in range(n):
        tag, off, comp, orig, _sum = struct.unpack(">4sIIII", data[44 + 20 * i:64 + 20 * i])
        blob = data[off:off + comp]
        tables.append((tag, _sum, zlib.decompress(blob) if comp != orig else blob))
    pow2 = 1 << (n.bit_length() - 1)
    out = bytearray(struct.pack(">IHHHH", flavor, n, pow2 * 16, pow2.bit_length() - 1, n * 16 - pow2 * 16))
    pos = 12 + 16 * n
    body = bytearray()
    for tag, checksum, blob in sorted(tables):
        out += struct.pack(">4sIII", tag, checksum, pos + len(body), len(blob))
        body += blob + b"\0" * (-len(blob) % 4)
    return bytes(out + body)


FONT_BYTES = woff_to_ttf(WOFF.read_bytes())
font = lambda px: ImageFont.truetype(io.BytesIO(FONT_BYTES), px)


def background(w, h, radius=0):
    svg = (f"<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}'><defs><linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'>"
           f"<stop offset='0' stop-color='{BG1}'/><stop offset='1' stop-color='{BG2}'/></linearGradient>"
           "<radialGradient id='haze' cx='.5' cy='.45' r='.6'><stop offset='0' stop-color='#b9a2ff' stop-opacity='.35'/>"
           "<stop offset='1' stop-color='#b9a2ff' stop-opacity='0'/></radialGradient></defs>"
           f"<rect width='{w}' height='{h}' rx='{radius}' fill='url(#bg)'/><rect width='{w}' height='{h}' rx='{radius}' fill='url(#haze)'/></svg>")
    png = subprocess.run(["rsvg-convert", "-w", str(w), "-h", str(h)], input=svg.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(png)).convert("RGBA")


def mark(w, h, text, px, cursor=True):
    """`text` centred in a transparent w x h picture, in the header logo's style: a pink and a cyan copy a little apart, a glow, a pale core.
    With `cursor`, the final underscore is the pink blinking-cursor block."""
    f = font(px)
    shown, tail = (text[:-1], text[-1]) if cursor else (text, "")
    full = f.getbbox(text)
    x0 = (w - (full[2] - full[0])) / 2 - full[0]
    y0 = (h - (full[3] - full[1])) / 2 - full[1]
    gap = f.getlength(shown)
    off = max(1, round(px * 0.035))

    def layer(color_main, color_tail, dx):
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.text((x0 + dx, y0), shown, font=f, fill=color_main + (255,))
        if tail:
            d.text((x0 + gap + dx, y0), tail, font=f, fill=color_tail + (255,))
        return im

    glow = Image.alpha_composite(layer(PINK, PINK, -off), layer(CYAN, PINK, off)).filter(ImageFilter.GaussianBlur(px * 0.05))
    out = Image.alpha_composite(glow, layer(PINK, PINK, -off))
    out = Image.alpha_composite(out, layer(CYAN, PINK, off))
    return Image.alpha_composite(out, layer(PALE, PINK, 0))


def compose(w, h, text, px, radius=0, cursor=True):
    return Image.alpha_composite(background(w, h, radius), mark(w, h, text, px, cursor))


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def main():
    S = 8       # draw big, then shrink: smoother edges at the small launcher sizes
    # adaptive icon: the foreground is 108dp with the mark inside the central 66dp, so no launcher shape can cut it off
    fg = mark(108 * S, 108 * S, "T_", 78 * S)
    for d, px in {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}.items():
        save(fg.resize((px, px), Image.LANCZOS), RES / f"mipmap-{d}" / "ic_launcher_foreground.png")
    # older phones: a finished square and a finished round icon
    sq, rd = compose(96 * S, 96 * S, "T_", 86 * S, 18 * S), compose(96 * S, 96 * S, "T_", 78 * S, 48 * S)
    for d, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        save(sq.resize((px, px), Image.LANCZOS), RES / f"mipmap-{d}" / "ic_launcher.png")
        save(rd.resize((px, px), Image.LANCZOS), RES / f"mipmap-{d}" / "ic_launcher_round.png")
    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">%s</color>\n</resources>\n' % BG1.upper())
    # splash: keep every existing file's size, the wordmark in the middle
    for f in RES.glob("drawable*/splash.png"):
        w, h = Image.open(f).size
        save(compose(w, h, "TOTR_", int(min(w, h) * 0.26)).convert("RGB"), f)
    # desktop: electron-builder picks up build/icon.png (and makes the Windows .ico from it)
    save(compose(512, 512, "T_", 400, 96), HERE.parent / "shared" / "assets" / "icon.png")
    print("icons and splash written to", RES)


main()
