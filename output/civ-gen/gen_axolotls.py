#!/usr/bin/env python3
"""Generate a high-quality pixel-art axolotl sprite sheet for Xolotl Civilization Lab.

Layout: 16 colour variants, 4 animation frames each => 64 frames.
Sheet: 16 columns x 4 rows, frame 64x64 => 1024x256.
Frame index i (row-major) belongs to variant i//4, animation frame i%4.
Each axolotl is hand-composed at native 32x32 then nearest-neighbour x2 -> 64x64.
"""
import colorsys
import os
from PIL import Image, ImageDraw

N = 32          # native sprite resolution
SCALE = 2       # -> 64x64 frame
FRAME = N * SCALE
COLS = 16
ROWS = 4
FRAMES_PER_VARIANT = 4

OUT_SHEET = os.path.join(os.path.dirname(__file__), "..", "..",
                         "tauri-app", "public", "civ", "axolotl-animated-seeds.png")
OUT_STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..",
                              "tauri-app", "public", "civ", "axolotls")
OUT_PREVIEW = os.path.join(os.path.dirname(__file__), "preview.png")


# ---- colour helpers -------------------------------------------------------
def clamp(v):
    return max(0, min(255, int(round(v))))


def to_hls(rgb):
    r, g, b = (c / 255 for c in rgb)
    return colorsys.rgb_to_hls(r, g, b)


def from_hls(h, l, s):
    r, g, b = colorsys.hls_to_rgb(h % 1.0, max(0, min(1, l)), max(0, min(1, s)))
    return (clamp(r * 255), clamp(g * 255), clamp(b * 255))


def adjust(rgb, dl=0.0, ds=0.0, dh=0.0):
    h, l, s = to_hls(rgb)
    return from_hls(h + dh, l + dl, s + ds)


def palette(base, gill):
    """Build a cohesive shading palette from a base body colour + gill accent."""
    return {
        "base": base,
        "light": adjust(base, dl=+0.10, ds=-0.02),
        "lighter": adjust(base, dl=+0.20, ds=-0.05),
        "belly": adjust(base, dl=+0.16, ds=-0.08),
        "shadow": adjust(base, dl=-0.12, ds=+0.02),
        "dark": adjust(base, dl=-0.20, ds=+0.04),
        "outline": adjust(base, dl=-0.38, ds=+0.06),
        "gill": gill,
        "gill_lt": adjust(gill, dl=+0.12, ds=-0.02),
    }


# Variant order must match MORPHS in tauri-app/src-tauri/src/civilization.rs
# and tauri-app/src/components/civilization/CivilizationGameCanvas.tsx.
VARIANTS = [
    ("leucistic", (244, 168, 196), (247, 120, 158)),
    ("wild",      (118, 142, 92),  (180, 216, 116)),
    ("melanoid",  (92, 96, 116),   (136, 154, 202)),
    ("gold",      (242, 202, 120), (247, 160, 96)),
    ("axanthic",  (176, 174, 148), (214, 212, 166)),
    ("blue",      (146, 190, 236), (120, 214, 240)),
    ("copper",    (198, 126, 76),  (238, 156, 106)),
    ("gfp",       (122, 246, 170), (120, 255, 205)),
    ("albino",    (238, 232, 228), (244, 160, 188)),
    ("piebald",   (214, 190, 204), (244, 160, 196)),
    ("firefly",   (248, 218, 98),  (255, 150, 72)),
    ("mystic",    (196, 146, 236), (226, 126, 242)),
    ("cyber",     (112, 188, 206), (88, 244, 238)),
    ("chrome",    (164, 176, 188), (118, 226, 255)),
    ("volt",      (220, 238, 96),  (80, 250, 208)),
    ("nebula",    (124, 96, 202),  (236, 96, 230)),
]
CYBER_MORPHS = {"cyber", "chrome", "volt", "nebula"}


def ellipse(d, cx, cy, rx, ry, fill):
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill)


def frond(d, root, tip, col, col_lt):
    """A feathery gill frond: tapered stalk + a soft blob tip."""
    rx0, ry0 = root
    rx1, ry1 = tip
    steps = 5
    for i in range(steps + 1):
        t = i / steps
        x = rx0 + (rx1 - rx0) * t
        y = ry0 + (ry1 - ry0) * t
        r = 1.4 - 0.6 * t
        ellipse(d, x, y, r, r, col)
    ellipse(d, rx1, ry1, 2, 2, col)
    ellipse(d, rx1, ry1 - 0.5, 1, 1, col_lt)


def draw_fill(pal, frame):
    """Draw the coloured body (no outline, no face) onto a 32x32 RGBA image."""
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    bob = [0, -1, 0, 1][frame]
    gphase = [0, 1, 0, -1][frame]
    tail = [0, 1, 0, -1][frame]
    cy = 17 + bob

    # --- tail fin (behind body) ---
    tx = 16 + tail
    d.polygon([(tx - 4, 27 + bob), (tx + 4, 27 + bob), (tx, 31 + bob)], fill=pal["dark"])
    d.polygon([(tx - 2, 27 + bob), (tx + 2, 27 + bob), (tx, 30 + bob)], fill=pal["shadow"])

    # --- gills / frills (behind head, fan outward like real axolotl branchiae) ---
    g = gphase
    left = [
        ((10, 12 + bob), (3, 8 + bob - g)),
        ((9, 14 + bob), (1, 14 + bob - g)),
        ((10, 16 + bob), (3, 20 + bob + g)),
    ]
    for root, tip in left:
        frond(d, root, tip, pal["gill"], pal["gill_lt"])
    for root, tip in left:  # mirror to right side
        r = (31 - root[0], root[1])
        t = (31 - tip[0], tip[1])
        frond(d, r, t, pal["gill"], pal["gill_lt"])

    # --- legs (little nubs) ---
    for lx in (9, 13, 19, 23):
        ellipse(d, lx, 24 + bob, 2.2, 2.2, pal["shadow"])
        ellipse(d, lx, 23 + bob, 1.8, 1.6, pal["base"])

    # --- main body blob ---
    ellipse(d, 16, cy, 9, 8, pal["base"])
    # bottom shadow crescent
    ellipse(d, 16, cy + 5, 7.5, 3, pal["shadow"])
    ellipse(d, 16, cy + 4, 7, 2.4, pal["base"])
    # belly
    ellipse(d, 16, cy + 3, 5.2, 4, pal["belly"])
    # glossy top highlight band (subtle sheen, not a forehead patch)
    ellipse(d, 16, cy - 5.5, 5.5, 1.3, pal["lighter"])
    ellipse(d, 13.5, cy - 5.5, 1.6, 0.9, (255, 255, 255, 90))

    return img, bob


def add_outline(art, pal):
    """1px clean outline around the whole silhouette via offset compositing."""
    alpha = art.split()[3]
    sil = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    solid = Image.new("RGBA", (N, N), pal["outline"] + (255,))
    sil.paste(solid, (0, 0), alpha)

    out = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)]:
        out.alpha_composite(sil, (dx, dy))
    out.alpha_composite(art)
    return out


def draw_face(img, pal, frame):
    d = ImageDraw.Draw(img)
    bob = [0, -1, 0, 1][frame]
    ey = 16 + bob
    look = [0, 0, 1, 0][frame]  # tiny pupil glance on frame 2

    for ex in (12, 20):
        # eye white-ish socket then dark pupil
        ellipse(d, ex, ey, 2.1, 2.6, pal["outline"])
        ellipse(d, ex + look, ey + 0.3, 1.3, 1.8, (32, 30, 40))
        d.point((ex - 1, ey - 1), fill=(255, 255, 255))

    # cheeks (soft blush)
    blush = adjust(pal["gill"], dl=+0.06)
    for cxp in (9, 23):
        d.ellipse([cxp - 1, ey + 2, cxp + 1, ey + 3], fill=blush + (120,))

    # mouth — gentle ":3" smile
    my = ey + 4
    d.point((15, my), fill=pal["outline"])
    d.point((16, my + 1), fill=pal["outline"])
    d.point((17, my), fill=pal["outline"])
    return img


def draw_cyborg_details(img, pal, frame, name):
    if name not in CYBER_MORPHS:
        return img
    d = ImageDraw.Draw(img)
    bob = [0, -1, 0, 1][frame]
    blink = frame == 2
    neon = {
        "cyber": (84, 255, 232),
        "chrome": (120, 226, 255),
        "volt": (246, 255, 92),
        "nebula": (236, 106, 255),
    }[name]
    neon_lt = adjust(neon, dl=+0.10, ds=-0.04)
    metal = {
        "cyber": (72, 86, 94),
        "chrome": (204, 214, 220),
        "volt": (74, 90, 82),
        "nebula": (68, 58, 104),
    }[name]
    dark = adjust(metal, dl=-0.22, ds=+0.02)

    # Temple implant and tail band.
    d.rectangle([5, 14 + bob, 8, 17 + bob], fill=dark)
    d.rectangle([6, 14 + bob, 9, 16 + bob], fill=metal)
    d.point((8, 15 + bob), fill=neon_lt)
    d.rectangle([21, 25 + bob, 25, 27 + bob], fill=dark)
    d.line([(21, 26 + bob), (25, 26 + bob)], fill=neon)

    # Tiny chest core.
    d.rectangle([15, 20 + bob, 17, 22 + bob], fill=dark)
    d.point((16, 21 + bob), fill=neon_lt)

    if name in {"cyber", "chrome"}:
        d.rectangle([11, 15 + bob, 21, 16 + bob], fill=dark)
        d.line([(12, 15 + bob), (20, 15 + bob)], fill=neon if not blink else dark)
    if name == "volt":
        d.line([(19, 9 + bob), (16, 13 + bob), (19, 13 + bob), (15, 18 + bob)], fill=neon_lt, width=1)
        d.point((22, 10 + bob), fill=neon)
        d.point((10, 8 + bob), fill=neon)
    if name == "nebula":
        for sx, sy in [(10, 10), (21, 11), (8, 20), (23, 19), (16, 8)]:
            d.point((sx, sy + bob), fill=neon_lt)
        d.arc([8, 10 + bob, 24, 23 + bob], 205, 330, fill=neon, width=1)
    return img


def render_frame(name, pal, frame):
    art, _ = draw_fill(pal, frame)
    art = add_outline(art, pal)
    art = draw_face(art, pal, frame)
    art = draw_cyborg_details(art, pal, frame, name)
    return art.resize((FRAME, FRAME), Image.NEAREST)


def main():
    sheet = Image.new("RGBA", (COLS * FRAME, ROWS * FRAME), (0, 0, 0, 0))
    os.makedirs(OUT_STATIC_DIR, exist_ok=True)
    for vi, (name, base, gill) in enumerate(VARIANTS):
        pal = palette(base, gill)
        for fi in range(FRAMES_PER_VARIANT):
            idx = vi * FRAMES_PER_VARIANT + fi
            col = idx % COLS
            row = idx // COLS
            sheet.paste(render_frame(name, pal, fi), (col * FRAME, row * FRAME))
        if name in CYBER_MORPHS:
            portrait = render_frame(name, pal, 1).resize((256, 256), Image.NEAREST)
            portrait.save(os.path.join(OUT_STATIC_DIR, f"axo-{name}.png"))

    os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)
    sheet.save(OUT_SHEET)
    print("sheet:", os.path.abspath(OUT_SHEET), sheet.size)

    # zoomed preview: one row per variant, 4 frames each, x3 again for inspection
    z = 3
    prev = Image.new("RGBA", (FRAMES_PER_VARIANT * FRAME * z, len(VARIANTS) * FRAME * z),
                     (18, 22, 28, 255))
    for vi, (name, base, gill) in enumerate(VARIANTS):
        pal = palette(base, gill)
        for fi in range(FRAMES_PER_VARIANT):
            f = render_frame(name, pal, fi).resize((FRAME * z, FRAME * z), Image.NEAREST)
            prev.alpha_composite(f, (fi * FRAME * z, vi * FRAME * z))
    prev.save(OUT_PREVIEW)
    print("preview:", os.path.abspath(OUT_PREVIEW), prev.size)


if __name__ == "__main__":
    main()
