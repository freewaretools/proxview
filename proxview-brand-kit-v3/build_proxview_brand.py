#!/usr/bin/env python3
"""
ProxView — Brand & Icon Kit generator
=====================================

Generates the complete brand kit for ProxView, a free multi-node Proxmox
viewer / monitoring web app.

Outputs (into OUT_DIR):

  logo/            master SVG logo lockups (mark, horizontal, stacked, wordmark)
  icon/            PNG app icons, favicons, maskable + apple-touch icons, .ico
  social/          Open Graph card, GitHub repo header, round avatar
  web/             site.webmanifest + tokens.css (design tokens)
  BRAND.md         brand guidelines

Dependencies:
  pip install pillow cairosvg fonttools brotli uharfbuzz

Fonts: IBM Plex Sans + IBM Plex Mono (TTF). Set FONT_DIR below.

Design concept — "The Watchpoint":
  A lens/eye (view, observation) with a hexagonal pupil (a node, virtualisation).
  Outline = the operator watching. Hex pupil = the thing being watched.
  It scales from 1024px down to a 16px favicon without turning to mush.
"""

import io
import os
import math
import shutil

from PIL import Image, ImageDraw, ImageFont
import cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
import uharfbuzz as hb

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

OUT_DIR = "/mnt/user-data/outputs/proxview-brand-kit-v3"
FONT_DIR = "/home/claude/fonts/ttf"

F_REGULAR = os.path.join(FONT_DIR, "IBMPlexSans-Regular.ttf")
F_MEDIUM = os.path.join(FONT_DIR, "IBMPlexSans-Medium.ttf")
F_SEMIBOLD = os.path.join(FONT_DIR, "IBMPlexSans-SemiBold.ttf")
F_BOLD = os.path.join(FONT_DIR, "IBMPlexSans-Bold.ttf")
F_MONO = os.path.join(FONT_DIR, "IBMPlexMono-Medium.ttf")

# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------

C = {
    # Core neutrals (dark UI base)
    "graphite_900": "#0E1116",
    "graphite_800": "#161B22",
    "graphite_700": "#1F2630",
    "graphite_600": "#2B3440",
    "slate_400": "#8A97A8",
    "slate_200": "#C3CCD8",
    "cloud": "#E9EEF5",
    "white": "#FFFFFF",

    # Brand accent — "Prox Amber" (a nod to Proxmox orange, warmer + brighter)
    "amber_600": "#E5720A",
    "amber_500": "#FF8A1F",
    "amber_400": "#FFA742",
    "amber_300": "#FFC66E",

    # Status palette (node / VM state)
    "state_running": "#3FD68C",
    "state_warning": "#FFB020",
    "state_stopped": "#FF5C5C",
    "state_offline": "#6B7688",
}

# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------


def squircle_path(cx, cy, size, n=5.0, steps=180):
    """iOS-style superellipse (continuous-corner rounded square)."""
    a = size / 2.0
    pts = []
    for i in range(steps):
        t = 2.0 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = math.copysign(abs(ct) ** (2.0 / n), ct) * a
        y = math.copysign(abs(st) ** (2.0 / n), st) * a
        pts.append((cx + x, cy + y))
    d = "M {:.2f},{:.2f} ".format(*pts[0])
    d += " ".join("L {:.2f},{:.2f}".format(x, y) for x, y in pts[1:])
    return d + " Z"


def hexagon_path(cx, cy, r, rotation_deg=90):
    """Pointy-top hexagon (network node motif)."""
    pts = []
    for i in range(6):
        a = math.radians(rotation_deg + 60 * i)
        pts.append((cx + r * math.cos(a), cy - r * math.sin(a)))
    d = "M {:.2f},{:.2f} ".format(*pts[0])
    d += " ".join("L {:.2f},{:.2f}".format(x, y) for x, y in pts[1:])
    return d + " Z"


def rounded_rect_path(x, y, w, h, r):
    """Rounded rectangle as an SVG path (so it can live inside a compound path)."""
    r = min(r, w / 2, h / 2)
    return (
        f"M {x + r:.2f},{y:.2f} "
        f"H {x + w - r:.2f} A {r:.2f},{r:.2f} 0 0 1 {x + w:.2f},{y + r:.2f} "
        f"V {y + h - r:.2f} A {r:.2f},{r:.2f} 0 0 1 {x + w - r:.2f},{y + h:.2f} "
        f"H {x + r:.2f} A {r:.2f},{r:.2f} 0 0 1 {x:.2f},{y + h - r:.2f} "
        f"V {y + r:.2f} A {r:.2f},{r:.2f} 0 0 1 {x + r:.2f},{y:.2f} Z"
    )


def circle_path(cx, cy, r):
    """Circle as a path (two arcs) so it can be an evenodd hole."""
    return (
        f"M {cx - r:.2f},{cy:.2f} "
        f"a {r:.2f},{r:.2f} 0 1 0 {2 * r:.2f},0 "
        f"a {r:.2f},{r:.2f} 0 1 0 {-2 * r:.2f},0 Z"
    )


def rack_path(cx, cy, detail=True):
    """
    Two stacked rack units — the ProxView pupil.

    Reference geometry on the 512 grid: 204 wide x 120 tall overall, which is
    the largest rectangle that clears the inside of the lens with margin.
    The lens inner half-height at x = +/-102 is ~67; the rack half-height is 60.
    The 28-unit gap is deliberately generous: anything tighter merges into a
    single blob below about 48px.

    Returned as ONE compound path with fill-rule="evenodd", so the vent slots
    and drive LEDs are genuine holes and stay correct on any background.
    """
    uw, uh, gap, r = 204.0, 46.0, 28.0, 9.0
    x0 = cx - uw / 2
    tops = (cy - gap / 2 - uh, cy + gap / 2)

    parts = []
    for ty in tops:
        parts.append(rounded_rect_path(x0, ty, uw, uh, r))
        if detail:
            # three vent slots, left-aligned
            sw, sh, sr = 12.0, 20.0, 3.0
            sy = ty + (uh - sh) / 2
            for i in range(3):
                sx = x0 + 24.0 + i * 30.0
                parts.append(rounded_rect_path(sx, sy, sw, sh, sr))
            # drive LED, right side
            parts.append(circle_path(x0 + uw - 38.0, ty + uh / 2, 11.0))
    return " ".join(parts)


def stack_path(level="full"):
    """
    Standalone server-stack glyph — a faithful vector of the reference icon:
    two rack units, a connector between them, a stem down to a network node
    sitting on a bus bar.

    Returned as ONE compound path with fill-rule="evenodd", in a 512-wide local
    box (y spans 6..506).

    No masks, and deliberately no overlapping shapes. Two shapes overlapping
    under evenodd cancel to a hole; three invert again. So the bus bar is split
    into two segments either side of the node, and the stem stops at the node's
    top edge. That also gives the node its separation gap for free, and keeps
    the glyph a single path that renders identically everywhere — including in
    favicon rasterisers that ignore <mask>.

    Fidelity levels:
      "full"   everything, incl. vent slots + drive LEDs   (> 96px)
      "simple" no slots or LEDs                            (33-96px)
      "micro"  the two rack units only, enlarged to fill   (<= 32px)
    """
    W, UH = 512.0, 150.0
    NODE_X, NODE_Y = 256.0, 450.0
    NODE_R, NODE_HOLE, NODE_GAP = 56.0, 27.0, 12.0
    parts = []

    def rr(x, y, w, h, r):
        parts.append(rounded_rect_path(x, y, w, h, r))

    def ci(x, y, r):
        parts.append(circle_path(x, y, r))

    if level == "micro":
        # Below ~32px the stem, bus and node are sub-pixel noise. Keep only the
        # two units and enlarge them into the vacated space so the silhouette
        # still reads as stacked hardware.
        mh, mgap = 196.0, 76.0
        for top in (256.0 - mgap / 2 - mh, 256.0 + mgap / 2):
            rr(0.0, top, W, mh, 16.0)
        return " ".join(parts)

    # --- two rack units, each with 3 vent slots + a drive LED -------------
    for top in (6.0, 202.0):
        rr(0.0, top, W, UH, 10.0)
        if level == "full":
            for sx in (70.0, 145.0, 220.0):
                rr(sx, top + 30.0, 30.0, 90.0, 4.0)
            ci(424.0, top + UH / 2.0, 40.0)

    rr(232.0, 156.0, 44.0, 46.0, 1.0)      # connector between the units
    rr(232.0, 352.0, 44.0, 42.0, 1.0)      # stem, stops at the node's top edge

    # --- bus bar, split either side of the node ---------------------------
    bus_y, bus_h = 430.0, 40.0
    inner = NODE_X - NODE_R - NODE_GAP     # 188
    rr(40.0, bus_y, inner - 40.0, bus_h, 6.0)
    rr(W - inner, bus_y, inner - 40.0, bus_h, 6.0)

    # --- node: ring (outer circle + concentric hole) ----------------------
    ci(NODE_X, NODE_Y, NODE_R)
    ci(NODE_X, NODE_Y, NODE_HOLE)

    return " ".join(parts)


def stack_group(cx, cy, scale, fill, level="full"):
    """Positioned server-stack glyph."""
    return (
        f'<g transform="translate({cx:.2f},{cy:.2f}) scale({scale:.5f}) '
        f'translate(-256,-256)">'
        f'<path d="{stack_path(level=level)}" fill="{fill}" '
        f'fill-rule="evenodd"/></g>'
    )


def svg_stack_mark(fill, defs="", size=512, inset=0.88, level="full"):
    """The server stack on its own — no lens."""
    glyph = stack_group(size / 2, size / 2, (size / 512.0) * inset, fill,
                        level=level)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}" role="img" '
        f'aria-label="ProxView mark">\n'
        f"  <defs>\n{defs}\n  </defs>\n  {glyph}\n</svg>\n"
    )


def svg_stack_badge(size=512, rounded="squircle", level="full"):
    """Dark app-icon badge with the standalone server stack."""
    s = size / 512.0
    if rounded == "squircle":
        plate = f'<path d="{squircle_path(size/2, size/2, size)}" fill="url(#badge)"/>'
        stroke = (f'<path d="{squircle_path(size/2, size/2, size - 2*s)}" '
                  f'fill="none" stroke="rgba(255,255,255,0.10)" '
                  f'stroke-width="{2*s:.2f}"/>')
    else:
        r = size * 0.2237
        plate = (f'<rect width="{size}" height="{size}" rx="{r:.2f}" '
                 f'fill="url(#badge)"/>')
        stroke = (f'<rect x="{s:.2f}" y="{s:.2f}" width="{size-2*s:.2f}" '
                  f'height="{size-2*s:.2f}" rx="{r-s:.2f}" fill="none" '
                  f'stroke="rgba(255,255,255,0.10)" stroke-width="{2*s:.2f}"/>')
    glyph = stack_group(size / 2, size / 2, s * 0.60, "url(#amber)",
                        level=level)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}" role="img" aria-label="ProxView icon">\n'
        f"  <defs>\n{AMBER_GRAD}\n{BADGE_GRAD}\n  </defs>\n"
        f"  {plate}\n  {stroke}\n  {glyph}\n</svg>\n"
    )


def lens_path(cx, cy, half_w, half_h):
    """Vesica / eye outline built from two quadratic arcs."""
    return (
        f"M {cx - half_w:.2f},{cy:.2f} "
        f"Q {cx:.2f},{cy - 2 * half_h:.2f} {cx + half_w:.2f},{cy:.2f} "
        f"Q {cx:.2f},{cy + 2 * half_h:.2f} {cx - half_w:.2f},{cy:.2f} Z"
    )


def lash_paths(cx, cy, half_w, half_h, stroke_w,
               ts=(0.25, 0.375, 0.5, 0.625, 0.75),
               lengths=(0.26, 0.30, 0.33, 0.30, 0.26)):
    """
    Eyelashes radiating from the upper lens arc.

    The upper lid is the quadratic B(t) with P0=(cx-hw, cy),
    C=(cx, cy-2hh), P2=(cx+hw, cy). Each lash is drawn along the outward
    normal at B(t), so it sits perpendicular to the lid rather than merely
    fanning from the centre — angled lashes off a curve look wrong fast.

    Lengths are fractions of half_h, shortest at the outer lashes so they
    don't crowd the lens tips.
    """
    P0 = (cx - half_w, cy)
    Cp = (cx, cy - 2.0 * half_h)
    P2 = (cx + half_w, cy)

    out = []
    for t, lf in zip(ts, lengths):
        u = 1.0 - t
        px = u * u * P0[0] + 2 * u * t * Cp[0] + t * t * P2[0]
        py = u * u * P0[1] + 2 * u * t * Cp[1] + t * t * P2[1]

        # tangent
        tx = 2 * u * (Cp[0] - P0[0]) + 2 * t * (P2[0] - Cp[0])
        ty = 2 * u * (Cp[1] - P0[1]) + 2 * t * (P2[1] - Cp[1])
        mag = math.hypot(tx, ty) or 1.0

        # normal, forced to point away from the eye (upwards)
        nx, ny = ty / mag, -tx / mag
        if ny > 0:
            nx, ny = -nx, -ny

        inner = stroke_w * 0.40          # start inside the lid stroke, no seam
        outer = stroke_w * 0.5 + lf * half_h
        out.append(
            f'M {px + nx * inner:.2f},{py + ny * inner:.2f} '
            f'L {px + nx * outer:.2f},{py + ny * outer:.2f}'
        )
    return out


PUPIL_STYLES = ("rack", "rack-simple", "hex")


def pupil_path(style):
    """Pupil geometry on the reference 512 grid, centred on (0, 0)."""
    if style == "hex":
        return hexagon_path(0, 0, 74.0), "nonzero"
    if style == "rack-simple":
        return rack_path(0, 0, detail=False), "evenodd"
    return rack_path(0, 0, detail=True), "evenodd"


def eye_group(cx, cy, scale, outline_color, pupil_fill, stroke_w=34.0,
              pupil_style="rack", lashes=True):
    """
    The ProxView mark, drawn at an arbitrary centre + scale.
    Reference geometry is designed on a 512 canvas (scale=1.0).

    pupil_style:
      "rack"        two rack units with vent slots + drive LEDs (default)
      "rack-simple" two plain units, no interior detail (<= 48px renders)
      "hex"         legacy hexagon node

    lashes: five lashes on the upper lid. Drop them below ~48px, where they
    blur into a thick smudge on top of the lid.
    """
    hw, hh = 200.0 * scale, 118.0 * scale
    sw = stroke_w * scale
    d, rule = pupil_path(pupil_style)
    parts = []
    if lashes:
        lash_d = " ".join(lash_paths(cx, cy, hw, hh, sw))
        parts.append(
            f'<path d="{lash_d}" fill="none" stroke="{outline_color}" '
            f'stroke-width="{sw * 0.76:.2f}" stroke-linecap="round"/>'
        )
    parts.append(
        f'<path d="{lens_path(cx, cy, hw, hh)}" fill="none" '
        f'stroke="{outline_color}" stroke-width="{sw:.2f}" '
        f'stroke-linejoin="round" stroke-linecap="round"/>'
    )
    parts.append(
        f'<g transform="translate({cx:.2f},{cy:.2f}) scale({scale:.5f})">'
        f'<path d="{d}" fill="{pupil_fill}" fill-rule="{rule}"/></g>'
    )
    return "\n  ".join(parts)


AMBER_GRAD = f"""  <linearGradient id="amber" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="{C['amber_300']}"/>
    <stop offset="55%" stop-color="{C['amber_500']}"/>
    <stop offset="100%" stop-color="{C['amber_600']}"/>
  </linearGradient>"""

BADGE_GRAD = f"""  <linearGradient id="badge" x1="0" y1="0" x2="0.6" y2="1">
    <stop offset="0%" stop-color="{C['graphite_700']}"/>
    <stop offset="100%" stop-color="{C['graphite_900']}"/>
  </linearGradient>"""

# --------------------------------------------------------------------------
# Text -> SVG path (so logo SVGs never depend on an installed font)
# --------------------------------------------------------------------------


def text_to_path(text, font_path, font_size, letter_spacing=0.0):
    """Shape text with HarfBuzz and convert to a single SVG path 'd' string.

    Returns (path_d, advance_width). Baseline sits at y=0, text grows upward.
    """
    with open(font_path, "rb") as fh:
        data = fh.read()
    face = hb.Face(data)
    font = hb.Font(face)
    upem = face.upem
    font.scale = (upem, upem)

    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)

    tt = TTFont(font_path)
    glyph_set = tt.getGlyphSet()
    order = tt.getGlyphOrder()

    unit = font_size / upem
    pen_x = 0.0
    d_parts = []

    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(pen)
        d = pen.getCommands()
        if d:
            tx = (pen_x + pos.x_offset * unit)
            ty = (-pos.y_offset * unit)
            d_parts.append(
                f'<g transform="translate({tx:.3f},{ty:.3f}) '
                f'scale({unit:.6f},{-unit:.6f})"><path d="{d}"/></g>'
            )
        pen_x += pos.x_advance * unit + letter_spacing

    tt.close()
    return "".join(d_parts), pen_x - letter_spacing


def wordmark_svg_group(text, font_path, font_size, fill, x, baseline_y,
                       letter_spacing=0.0):
    body, width = text_to_path(text, font_path, font_size, letter_spacing)
    g = (f'<g transform="translate({x:.2f},{baseline_y:.2f})" fill="{fill}">'
         f"{body}</g>")
    return g, width


# --------------------------------------------------------------------------
# SVG assets
# --------------------------------------------------------------------------


def svg_mark(outline, pupil, defs="", bg=None, size=512, pupil_style="rack",
             lashes=True):
    body = ""
    if bg:
        body += f'<rect width="{size}" height="{size}" fill="{bg}"/>\n  '
    body += eye_group(size / 2, size / 2, size / 512.0, outline, pupil,
                      pupil_style=pupil_style, lashes=lashes)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}" role="img" '
        f'aria-label="ProxView mark">\n'
        f"  <defs>\n{defs}\n  </defs>\n  {body}\n</svg>\n"
    )


def svg_badge(size=512, rounded="squircle", pupil_style="rack", lashes=True):
    """Dark app-icon badge: squircle plate + cloud eye + amber hex pupil."""
    s = size / 512.0
    if rounded == "squircle":
        plate = f'<path d="{squircle_path(size/2, size/2, size)}" fill="url(#badge)"/>'
        plate_stroke = (
            f'<path d="{squircle_path(size/2, size/2, size - 2*s)}" fill="none" '
            f'stroke="rgba(255,255,255,0.10)" stroke-width="{2*s:.2f}"/>'
        )
    else:
        r = size * 0.2237
        plate = (f'<rect x="0" y="0" width="{size}" height="{size}" rx="{r:.2f}" '
                 f'fill="url(#badge)"/>')
        plate_stroke = (
            f'<rect x="{s:.2f}" y="{s:.2f}" width="{size-2*s:.2f}" '
            f'height="{size-2*s:.2f}" rx="{r-s:.2f}" fill="none" '
            f'stroke="rgba(255,255,255,0.10)" stroke-width="{2*s:.2f}"/>'
        )
    # Lashes add height, so the eye is set slightly smaller and nudged down
    # to keep the whole mark optically centred on the plate.
    es = (0.70 if lashes else 0.76) * s
    ey = size / 2 + (10.0 * s if lashes else 0.0)
    eye = eye_group(size / 2, ey, es, C["cloud"], "url(#amber)",
                    pupil_style=pupil_style, lashes=lashes)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}" role="img" aria-label="ProxView icon">\n'
        f"  <defs>\n{AMBER_GRAD}\n{BADGE_GRAD}\n  </defs>\n"
        f"  {plate}\n  {plate_stroke}\n  {eye}\n</svg>\n"
    )


def svg_maskable(size=512, pupil_style="rack", lashes=True):
    """Android maskable icon — mark shrunk into the 80% safe zone, full bleed."""
    eye = eye_group(size / 2, size / 2 + 8.0, 0.54 * size / 512.0,
                    C["cloud"], "url(#amber)", pupil_style=pupil_style,
                    lashes=lashes)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}">\n'
        f"  <defs>\n{AMBER_GRAD}\n{BADGE_GRAD}\n  </defs>\n"
        f'  <rect width="{size}" height="{size}" fill="url(#badge)"/>\n'
        f"  {eye}\n</svg>\n"
    )


def svg_lockup(orientation="horizontal", theme="dark", accent_view=True,
               pupil_style="rack", mark_style="lens", lashes=True):
    """
    theme='dark'  -> artwork for dark backgrounds (light text)
    theme='light' -> artwork for light backgrounds (graphite text)
    """
    text_col = C["cloud"] if theme == "dark" else C["graphite_900"]
    view_col = "url(#amber)" if accent_view else text_col
    outline = C["cloud"] if theme == "dark" else C["graphite_900"]

    if orientation == "horizontal":
        # A square mark next to text wants to be ~1.6x cap height, not taller.
        mark_box = 102.0 if mark_style == "stack" else 128.0
        pad = 8.0
        gap = 30.0 if mark_style == "stack" else 34.0
        fs = 92.0
        if mark_style == "stack":
            mark = stack_group(pad + mark_box / 2, 80.0, mark_box / 512.0,
                               "url(#amber)")
        else:
            mark = eye_group(pad + mark_box / 2, 86.0,
                             mark_box / 512.0 * (1.10 if lashes else 1.25),
                             outline, "url(#amber)", pupil_style=pupil_style,
                             lashes=lashes)
        x0 = pad + mark_box + gap
        g1, w1 = wordmark_svg_group("Prox", F_SEMIBOLD, fs, text_col, x0, 112.0, -0.6)
        g2, w2 = wordmark_svg_group("View", F_SEMIBOLD, fs, view_col,
                                    x0 + w1, 112.0, -0.6)
        w = x0 + w1 + w2 + pad
        h = 160.0
        body = f"{mark}\n  {g1}\n  {g2}"
    else:  # stacked
        fs = 88.0
        g1, w1 = wordmark_svg_group("Prox", F_SEMIBOLD, fs, text_col, 0, 0, -0.6)
        g2, w2 = wordmark_svg_group("View", F_SEMIBOLD, fs, view_col, w1, 0, -0.6)
        tw = w1 + w2
        w = max(tw, 200.0) + 40.0
        h = 300.0
        cx = w / 2
        if mark_style == "stack":
            mark = stack_group(cx, 104.0, 0.28, "url(#amber)")
        else:
            mark = eye_group(cx, 100.0, 0.27 if lashes else 0.30, outline,
                             "url(#amber)", pupil_style=pupil_style,
                             lashes=lashes)
        tx = cx - tw / 2
        g1, _ = wordmark_svg_group("Prox", F_SEMIBOLD, fs, text_col, tx, 256.0, -0.6)
        g2, _ = wordmark_svg_group("View", F_SEMIBOLD, fs, view_col,
                                   tx + w1, 256.0, -0.6)
        body = f"{mark}\n  {g1}\n  {g2}"

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" '
        f'width="{w:.0f}" height="{h:.0f}" role="img" aria-label="ProxView">\n'
        f"  <defs>\n{AMBER_GRAD}\n  </defs>\n  {body}\n</svg>\n"
    )


def svg_wordmark(theme="dark", accent_view=True):
    text_col = C["cloud"] if theme == "dark" else C["graphite_900"]
    view_col = "url(#amber)" if accent_view else text_col
    fs = 96.0
    g1, w1 = wordmark_svg_group("Prox", F_SEMIBOLD, fs, text_col, 6, 100.0, -0.7)
    g2, w2 = wordmark_svg_group("View", F_SEMIBOLD, fs, view_col, 6 + w1,
                                100.0, -0.7)
    w, h = w1 + w2 + 12, 132.0
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" '
        f'width="{w:.0f}" height="{h:.0f}" role="img" aria-label="ProxView">\n'
        f"  <defs>\n{AMBER_GRAD}\n  </defs>\n  {g1}\n  {g2}\n</svg>\n"
    )


# --------------------------------------------------------------------------
# Raster helpers
# --------------------------------------------------------------------------


def render_png(svg_str, path, width, height=None):
    png = cairosvg.svg2png(bytestring=svg_str.encode("utf-8"),
                           output_width=width,
                           output_height=height or width)
    with open(path, "wb") as fh:
        fh.write(png)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def svg_to_image(svg_str, width, height=None):
    png = cairosvg.svg2png(bytestring=svg_str.encode("utf-8"),
                           output_width=width,
                           output_height=height)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def vgrad(size, top, bottom):
    w, h = size
    base = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(base)
    t, b = hx(top), hx(bottom)
    for y in range(h):
        f = y / max(h - 1, 1)
        d.point((0, y), tuple(int(t[i] + (b[i] - t[i]) * f) for i in range(3)))
    return base.resize((w, h), Image.BICUBIC)


def draw_dot_grid(img, spacing=32, color=(255, 255, 255, 14)):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for y in range(spacing, img.size[1], spacing):
        for x in range(spacing, img.size[0], spacing):
            d.ellipse([x - 1, y - 1, x + 1, y + 1], fill=color)
    return Image.alpha_composite(img.convert("RGBA"), layer)


def glow(img, box, color, radius, alpha=90):
    from PIL import ImageFilter
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse(box, fill=hx(color) + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    return Image.alpha_composite(img.convert("RGBA"), layer)


# --------------------------------------------------------------------------
# Social / marketing rasters
# --------------------------------------------------------------------------


def build_social_card(path, w=1200, h=630, title="ProxView",
                      tagline="Watch every Proxmox node. One pane of glass.",
                      chips=("Multi-node", "No cluster required",
                             "Self-hosted", "Free & open")):
    img = vgrad((w, h), C["graphite_700"], C["graphite_900"]).convert("RGBA")
    img = draw_dot_grid(img, spacing=30)
    img = glow(img, [w - 420, -220, w + 260, 260], C["amber_500"], 150, 70)
    img = glow(img, [-260, h - 220, 220, h + 240], C["amber_600"], 160, 40)

    mark = svg_to_image(svg_mark(C["cloud"], "url(#amber)", AMBER_GRAD), 200)
    img.alpha_composite(mark, (84, 96))

    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(F_SEMIBOLD, 104)
    f_tag = ImageFont.truetype(F_REGULAR, 40)
    f_chip = ImageFont.truetype(F_MEDIUM, 26)
    f_url = ImageFont.truetype(F_MONO, 28)

    tx, ty = 84, 316
    d.text((tx, ty), "Prox", font=f_title, fill=hx(C["cloud"]))
    wprox = d.textlength("Prox", font=f_title)
    d.text((tx + wprox, ty), "View", font=f_title, fill=hx(C["amber_500"]))

    d.text((tx, ty + 136), tagline, font=f_tag, fill=hx(C["slate_200"]))

    cx = tx
    cy = ty + 216
    for chip in chips:
        tw = d.textlength(chip, font=f_chip)
        box = [cx, cy, cx + tw + 40, cy + 52]
        d.rounded_rectangle(box, radius=26, fill=(255, 255, 255, 14),
                            outline=(255, 255, 255, 34), width=2)
        d.text((cx + 20, cy + 11), chip, font=f_chip, fill=hx(C["slate_200"]))
        cx += tw + 40 + 14

    d.text((w - 84 - d.textlength("proxview.app", font=f_url), h - 84),
           "proxview.app", font=f_url, fill=hx(C["slate_400"]))

    img.convert("RGB").save(path, "PNG")


def build_github_header(path, w=1280, h=640):
    img = vgrad((w, h), C["graphite_800"], C["graphite_900"]).convert("RGBA")
    img = draw_dot_grid(img, spacing=34)
    img = glow(img, [w // 2 - 320, h // 2 - 320, w // 2 + 320, h // 2 + 320],
               C["amber_500"], 170, 46)

    mark = svg_to_image(svg_mark(C["cloud"], "url(#amber)", AMBER_GRAD), 240)
    img.alpha_composite(mark, ((w - 240) // 2, 132))

    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(F_SEMIBOLD, 92)
    f_tag = ImageFont.truetype(F_REGULAR, 34)

    wprox = d.textlength("Prox", font=f_title)
    wview = d.textlength("View", font=f_title)
    x = (w - (wprox + wview)) / 2
    y = 372
    d.text((x, y), "Prox", font=f_title, fill=hx(C["cloud"]))
    d.text((x + wprox, y), "View", font=f_title, fill=hx(C["amber_500"]))

    tag = "Multi-node Proxmox monitoring — no cluster required"
    d.text(((w - d.textlength(tag, font=f_tag)) / 2, y + 128), tag,
           font=f_tag, fill=hx(C["slate_400"]))

    img.convert("RGB").save(path, "PNG")


def build_avatar(path, size=512):
    img = vgrad((size, size), C["graphite_700"], C["graphite_900"]).convert("RGBA")
    img = glow(img, [size * 0.15, size * 0.1, size * 0.85, size * 0.8],
               C["amber_500"], 90, 40)
    mark = svg_to_image(svg_mark(C["cloud"], "url(#amber)", AMBER_GRAD),
                        int(size * 0.66))
    img.alpha_composite(mark, ((size - mark.width) // 2,
                               (size - mark.height) // 2))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    out.save(path, "PNG")


def build_swatch_sheet(path, w=1400, h=900):
    img = Image.new("RGBA", (w, h), hx(C["graphite_900"]) + (255,))
    d = ImageDraw.Draw(img)
    f_h = ImageFont.truetype(F_SEMIBOLD, 44)
    f_lbl = ImageFont.truetype(F_MEDIUM, 24)
    f_hexf = ImageFont.truetype(F_MONO, 22)
    f_sec = ImageFont.truetype(F_MEDIUM, 28)

    d.text((70, 60), "ProxView — Colour", font=f_h, fill=hx(C["cloud"]))

    groups = [
        ("Accent", ["amber_300", "amber_400", "amber_500", "amber_600"]),
        ("Neutral", ["cloud", "slate_200", "slate_400", "graphite_600",
                     "graphite_700", "graphite_800", "graphite_900"]),
        ("Status", ["state_running", "state_warning", "state_stopped",
                    "state_offline"]),
    ]
    y = 170
    for title, keys in groups:
        d.text((70, y), title, font=f_sec, fill=hx(C["slate_400"]))
        y += 48
        x = 70
        for k in keys:
            d.rounded_rectangle([x, y, x + 170, y + 150], radius=18,
                                fill=hx(C[k]),
                                outline=(255, 255, 255, 26), width=2)
            d.text((x, y + 164), k.replace("_", " "), font=f_lbl,
                   fill=hx(C["slate_200"]))
            d.text((x, y + 194), C[k].upper(), font=f_hexf, fill=hx(C["slate_400"]))
            x += 190
        y += 250

    img.convert("RGB").save(path, "PNG")


# --------------------------------------------------------------------------
# Static text assets
# --------------------------------------------------------------------------

WEBMANIFEST = """{
  "name": "ProxView",
  "short_name": "ProxView",
  "description": "Multi-node Proxmox monitoring — no cluster required.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0E1116",
  "theme_color": "#0E1116",
  "icons": [
    { "src": "/icon/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon/maskable-192.png", "sizes": "192x192", "type": "image/png",
      "purpose": "maskable" },
    { "src": "/icon/maskable-512.png", "sizes": "512x512", "type": "image/png",
      "purpose": "maskable" }
  ]
}
"""

TOKENS_CSS = f""":root {{
  /* ---- ProxView design tokens ---------------------------------------- */

  /* Accent */
  --pv-amber-300: {C['amber_300']};
  --pv-amber-400: {C['amber_400']};
  --pv-amber-500: {C['amber_500']};   /* primary brand accent */
  --pv-amber-600: {C['amber_600']};

  /* Neutrals */
  --pv-cloud:        {C['cloud']};
  --pv-slate-200:    {C['slate_200']};
  --pv-slate-400:    {C['slate_400']};
  --pv-graphite-600: {C['graphite_600']};
  --pv-graphite-700: {C['graphite_700']};
  --pv-graphite-800: {C['graphite_800']};
  --pv-graphite-900: {C['graphite_900']};

  /* Node / VM state */
  --pv-running:  {C['state_running']};
  --pv-warning:  {C['state_warning']};
  --pv-stopped:  {C['state_stopped']};
  --pv-offline:  {C['state_offline']};

  /* Semantic — dark theme (default) */
  --pv-bg:            var(--pv-graphite-900);
  --pv-surface:       var(--pv-graphite-800);
  --pv-surface-raised:var(--pv-graphite-700);
  --pv-border:        rgba(255, 255, 255, 0.09);
  --pv-text:          var(--pv-cloud);
  --pv-text-muted:    var(--pv-slate-400);
  --pv-accent:        var(--pv-amber-500);
  --pv-accent-weak:   rgba(255, 138, 31, 0.14);
  --pv-focus:         var(--pv-amber-400);

  /* Type */
  --pv-font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system,
                  "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --pv-font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo,
                  Consolas, monospace;

  /* Radius + elevation */
  --pv-radius-sm: 6px;
  --pv-radius-md: 10px;
  --pv-radius-lg: 16px;
  --pv-radius-pill: 999px;
  --pv-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.40);
  --pv-shadow-2: 0 8px 24px rgba(0, 0, 0, 0.45);

  /* Spacing scale (4px base) */
  --pv-space-1: 4px;  --pv-space-2: 8px;  --pv-space-3: 12px;
  --pv-space-4: 16px; --pv-space-5: 24px; --pv-space-6: 32px;
  --pv-space-7: 48px; --pv-space-8: 64px;
}}

[data-theme="light"] {{
  --pv-bg:             #F6F8FB;
  --pv-surface:        #FFFFFF;
  --pv-surface-raised: #FFFFFF;
  --pv-border:         rgba(14, 17, 22, 0.10);
  --pv-text:           var(--pv-graphite-900);
  --pv-text-muted:     #5A6675;
  --pv-accent:         var(--pv-amber-600);
  --pv-accent-weak:    rgba(229, 114, 10, 0.10);
  --pv-focus:          var(--pv-amber-600);
  --pv-shadow-1: 0 1px 2px rgba(14, 17, 22, 0.08);
  --pv-shadow-2: 0 8px 24px rgba(14, 17, 22, 0.10);
}}

/* Status dot utility */
.pv-dot {{
  width: 8px; height: 8px; border-radius: var(--pv-radius-pill);
  display: inline-block; flex: none;
}}
.pv-dot--running {{ background: var(--pv-running); box-shadow: 0 0 0 3px rgba(63,214,140,.16); }}
.pv-dot--warning {{ background: var(--pv-warning); box-shadow: 0 0 0 3px rgba(255,176,32,.16); }}
.pv-dot--stopped {{ background: var(--pv-stopped); box-shadow: 0 0 0 3px rgba(255,92,92,.16); }}
.pv-dot--offline {{ background: var(--pv-offline); }}
"""

HTML_SNIPPET = """<!-- ProxView: drop into <head> -->
<link rel="icon" href="/icon/favicon.ico" sizes="any">
<link rel="icon" href="/logo/mark-amber.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon/apple-touch-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0E1116">

<meta property="og:title" content="ProxView">
<meta property="og:description" content="Multi-node Proxmox monitoring — no cluster required.">
<meta property="og:image" content="/social/og-card-1200x630.png">
<meta name="twitter:card" content="summary_large_image">
"""


def brand_md():
    return f"""# ProxView — Brand Guidelines

**ProxView** is a free, self-hosted web app for viewing and monitoring multiple
Proxmox nodes — clustered or not.

---

## 1. The mark

**"The Watchpoint"** — a lens/eye outline with a rack-stack pupil.

- The **lens** is the operator's view: observation, oversight, one pane of glass.
- The **two rack units** are the nodes — plural, deliberately. ProxView exists to
  watch more than one, and they sit precisely at the centre of attention.
- **Five lashes** on the upper lid. They soften the mark and make the eye read
  as an eye immediately rather than as an abstract lozenge. They also make it
  read a little more character than infrastructure — that's the trade, and it's
  a deliberate one. A lashless version is kept in `logo/alt/`.
- The vent slots and drive LEDs are **true knockouts** (`fill-rule="evenodd"`),
  not lighter-coloured shapes, so the mark is correct on any background.

### Construction
Built on a 512×512 grid. Lens: half-width 200, half-height 118, stroke 34, drawn
as two quadratic arcs. Rack pupil: two units 204 × 46 with a 28 gap (120 overall),
which is the largest block that clears the lens interior with margin.

The 28 gap is deliberately generous — anything tighter and the two units merge
into a single blob below ~48px. Don't tighten it to "balance" the pupil.

Lashes sit at t = 0.25, 0.375, 0.5, 0.625, 0.75 along the upper lid, each drawn
along the **outward normal** at that point rather than fanned from the centre —
lashes struck at the wrong angle off a curve look wrong immediately. Lengths run
0.26–0.33 of the lens half-height, shortest at the outer pair so they don't crowd
the lens tips. Stroke is 0.76 × the lid stroke, round caps.

Because lashes add height, the badge sets the eye at 0.70 scale (not 0.76) and
nudges it 10 units down, keeping the whole mark optically centred on the plate.

Never redraw by eye; regenerate from `build_proxview_brand.py`.

### Optical sizing
Three fidelities. Pick one; never just scale the detailed art down.

| Render size | Variant | What's in it |
|---|---|---|
| > 128 px | `mark-amber.svg` on squircle plate | Everything: lashes, slots, LEDs |
| 97–128 px | `badge-icon-rounded.svg` | Same art, squarer plate |
| 33–96 px | `mark-amber-simple.svg` | Slots and LEDs dropped, lashes kept |
| ≤ 32 px | `mark-amber-micro.svg` | Lashes dropped too |

Lashes go first because below ~48px they blur into a thick smudge sitting on top
of the lid, which reads worse than no lashes at all.

Below ~32px the pupil is under 3px tall and the two units necessarily merge into
a single bar. That is expected and still reads as a pupil; don't try to fix it
with a thinner gap.

### Clear space
Minimum clear space on all sides = half the rack height (0.25 × mark height).
Nothing — text, edges, UI chrome — enters that zone.

### Minimum sizes
| Use | Minimum |
|---|---|
| Mark alone | 16 px (simple variant) |
| Mark, full detail | 128 px |
| Horizontal lockup | 160 px wide |
| Stacked lockup | 120 px wide |

### Don'ts
- Don't rotate, skew, or squash the mark.
- Don't recolour the rack anything other than Prox Amber (or full mono).
- Don't fill the vent slots or LEDs with a colour — they are holes, not shapes.
- Don't tighten the gap between the two rack units. See Construction.
- Don't add lashes to the lower lid, and don't keep them below 32px.
- Don't add a third rack unit. Two reads as "more than one"; three reads as a
  cluster, which is exactly what ProxView doesn't require.
- Don't use the lens outline on its own, or the rack on its own, as the logo.
- Don't re-typeset the wordmark in another face — use the supplied SVGs.

### Alternates
`logo/alt/` holds three things, all regenerable, none of them the logo:

- **the lashless mark** — if the lashes ever feel too playful for a context
  (an enterprise deck, a partner listing), this is the sober version;
- **the standalone server stack** — a full glyph with connector, stem, bus bar
  and network node, useful as an in-app node/host icon where the lens would be
  redundant;
- **the hexagon-pupil lens** — the original pupil treatment.

## 2. Colour

### Accent — Prox Amber
| Token | Hex | Use |
|---|---|---|
| `--pv-amber-300` | `{C['amber_300']}` | Gradient highlight |
| `--pv-amber-400` | `{C['amber_400']}` | Hover / focus ring |
| `--pv-amber-500` | `{C['amber_500']}` | **Primary accent** (dark UI) |
| `--pv-amber-600` | `{C['amber_600']}` | Primary accent on light UI, pressed state |

Prox Amber is deliberately adjacent to Proxmox orange — familiar to the audience —
but warmer and brighter so ProxView never reads as an official Proxmox product.

### Neutrals
| Token | Hex |
|---|---|
| `--pv-cloud` | `{C['cloud']}` |
| `--pv-slate-200` | `{C['slate_200']}` |
| `--pv-slate-400` | `{C['slate_400']}` |
| `--pv-graphite-600` | `{C['graphite_600']}` |
| `--pv-graphite-700` | `{C['graphite_700']}` |
| `--pv-graphite-800` | `{C['graphite_800']}` |
| `--pv-graphite-900` | `{C['graphite_900']}` |

### Status (node / VM state)
| State | Token | Hex |
|---|---|---|
| Running / healthy | `--pv-running` | `{C['state_running']}` |
| Warning / degraded | `--pv-warning` | `{C['state_warning']}` |
| Stopped / error | `--pv-stopped` | `{C['state_stopped']}` |
| Offline / unknown | `--pv-offline` | `{C['state_offline']}` |

Status colours are **never** used as decoration. If it's coloured green, something
is genuinely running. Always pair colour with a label or icon for accessibility.

---

## 3. Typography

- **IBM Plex Sans** — UI and headings. SemiBold for the wordmark and headings,
  Medium for labels, Regular for body.
- **IBM Plex Mono** — everything numeric or machine-derived: node names, IPs,
  uptimes, CPU %, VMIDs, log lines.

Wordmark: IBM Plex Sans SemiBold, tracking −0.7 at 96px (roughly −0.007em).
"Prox" in text colour, "View" in Prox Amber. A full-monotone version is supplied
for single-colour contexts.

Scale: 12 / 14 / 16 / 20 / 24 / 32 / 44 / 64 px.

---

## 4. Voice

Plain, technical, unhurried. ProxView is a free tool made for people who run their
own hardware, so it never oversells.

- Say: "Watch every node. One pane of glass."
- Say: "No cluster required. No agent. Read-only by default."
- Avoid: "revolutionary", "AI-powered", "enterprise-grade".

**Required disclaimer** wherever ProxView is presented publicly:

> ProxView is an independent project and is not affiliated with, endorsed by, or
> sponsored by Proxmox Server Solutions GmbH. Proxmox® is a registered trademark
> of Proxmox Server Solutions GmbH.

Do not use the Proxmox logo, the Proxmox wordmark, or Proxmox orange as a primary
brand colour in ProxView materials.

---

## 5. Files

```
logo/    mark-amber.svg          primary mark: lens + amber rack pupil
         mark-graphite.svg       for light backgrounds
         mark-mono-white.svg     single colour, knockout
         mark-mono-black.svg     single colour
         mark-*-simple.svg       33-96px fidelity (no slots or LEDs)
         mark-*-micro.svg        <= 32px fidelity (no lashes either)
         badge-icon.svg          dark squircle app icon (master)
         badge-icon-rounded.svg  rounded-rect variant (web/Android)
         badge-icon-small.svg    rounded-rect, simple fidelity
         badge-icon-micro.svg    rounded-rect, micro fidelity
         alt/                    lashless mark, standalone server stack,
                                 hexagon-pupil lens
         logo-horizontal-dark.svg / -light.svg
         logo-stacked-dark.svg   / -light.svg
         wordmark-dark.svg       / wordmark-light.svg / wordmark-mono-*.svg

icon/    icon-16 … icon-1024.png     dark badge, PNG
         favicon.ico                 16/32/48 multi-resolution
         apple-touch-icon-180.png
         maskable-192.png, maskable-512.png

social/  og-card-1200x630.png        Open Graph / Twitter card
         github-header-1280x640.png  repo social preview
         avatar-512.png              round avatar (GitHub/Discord/X)
         palette-1400x900.png        colour reference sheet

web/     site.webmanifest
         tokens.css
         head-snippet.html
```

Regenerate everything with:

```bash
python3 build_proxview_brand.py
```
"""


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------


def main():
    if os.path.exists(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    for sub in ("logo", "logo/alt", "icon", "social", "web"):
        os.makedirs(os.path.join(OUT_DIR, sub), exist_ok=True)

    L = lambda *p: os.path.join(OUT_DIR, "logo", *p)
    I = lambda *p: os.path.join(OUT_DIR, "icon", *p)
    S = lambda *p: os.path.join(OUT_DIR, "social", *p)
    W = lambda *p: os.path.join(OUT_DIR, "web", *p)

    def write(path, text):
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)

    # ---- Logo SVGs -------------------------------------------------------
    # Primary mark: the lens with the rack-stack pupil ("The Watchpoint"),
    # with lashes on the upper lid.
    write(L("mark-amber.svg"),
          svg_mark(C["cloud"], "url(#amber)", AMBER_GRAD))
    write(L("mark-graphite.svg"),
          svg_mark(C["graphite_900"], "url(#amber)", AMBER_GRAD))
    write(L("mark-mono-white.svg"),
          svg_mark(C["white"], C["white"]))
    write(L("mark-mono-black.svg"),
          svg_mark(C["graphite_900"], C["graphite_900"]))

    # Reduced fidelity: no vent slots or LEDs in the pupil (<= 96px).
    write(L("mark-amber-simple.svg"),
          svg_mark(C["cloud"], "url(#amber)", AMBER_GRAD,
                   pupil_style="rack-simple"))
    write(L("mark-graphite-simple.svg"),
          svg_mark(C["graphite_900"], "url(#amber)", AMBER_GRAD,
                   pupil_style="rack-simple"))
    write(L("mark-mono-white-simple.svg"),
          svg_mark(C["white"], C["white"], pupil_style="rack-simple"))
    write(L("mark-mono-black-simple.svg"),
          svg_mark(C["graphite_900"], C["graphite_900"],
                   pupil_style="rack-simple"))

    # Micro: lashes dropped, they smudge into the lid below ~48px.
    write(L("mark-amber-micro.svg"),
          svg_mark(C["cloud"], "url(#amber)", AMBER_GRAD,
                   pupil_style="rack-simple", lashes=False))
    write(L("mark-mono-black-micro.svg"),
          svg_mark(C["graphite_900"], C["graphite_900"],
                   pupil_style="rack-simple", lashes=False))

    badge = svg_badge(512, "squircle")
    write(L("badge-icon.svg"), badge)
    badge_rounded = svg_badge(512, "rect")
    write(L("badge-icon-rounded.svg"), badge_rounded)
    badge_simple = svg_badge(512, "rect", pupil_style="rack-simple")
    write(L("badge-icon-small.svg"), badge_simple)
    badge_micro = svg_badge(512, "rect", pupil_style="rack-simple",
                            lashes=False)
    write(L("badge-icon-micro.svg"), badge_micro)

    # Alternates, kept regenerable.
    write(L("alt/mark-nolash.svg"),
          svg_mark(C["cloud"], "url(#amber)", AMBER_GRAD, lashes=False))
    write(L("alt/badge-nolash.svg"), svg_badge(512, "squircle", lashes=False))
    write(L("alt/logo-horizontal-nolash-dark.svg"),
          svg_lockup("horizontal", "dark", lashes=False))
    write(L("alt/mark-stack-only.svg"),
          svg_stack_mark("url(#amber)", AMBER_GRAD))
    write(L("alt/mark-stack-only-black.svg"), svg_stack_mark(C["graphite_900"]))
    write(L("alt/badge-stack-only.svg"), svg_stack_badge(512, "squircle"))
    write(L("alt/mark-lens-hex.svg"),
          svg_mark(C["cloud"], "url(#amber)", AMBER_GRAD, pupil_style="hex"))

    write(L("logo-horizontal-dark.svg"), svg_lockup("horizontal", "dark"))
    write(L("logo-horizontal-light.svg"), svg_lockup("horizontal", "light"))
    write(L("logo-stacked-dark.svg"), svg_lockup("stacked", "dark"))
    write(L("logo-stacked-light.svg"), svg_lockup("stacked", "light"))
    write(L("wordmark-dark.svg"), svg_wordmark("dark"))
    write(L("wordmark-light.svg"), svg_wordmark("light"))
    write(L("wordmark-mono-white.svg"), svg_wordmark("dark", accent_view=False))
    write(L("wordmark-mono-black.svg"), svg_wordmark("light", accent_view=False))

    # ---- Icon PNGs -------------------------------------------------------
    sizes = [16, 24, 32, 48, 64, 72, 96, 128, 144, 152, 192, 256, 384, 512, 1024]
    for sz in sizes:
        # Optical sizing — pick the fidelity, don't just scale the detailed art.
        #   <= 32px   no lashes, simplified pupil
        #   <= 96px   lashes, simplified pupil
        #   <= 128px  rounded-rect plate, full detail
        #   > 128px   squircle plate, full detail
        if sz <= 32:
            src = badge_micro
        elif sz <= 96:
            src = badge_simple
        elif sz <= 128:
            src = badge_rounded
        else:
            src = badge
        render_png(src, I(f"icon-{sz}.png"), sz)

    render_png(badge_rounded, I("apple-touch-icon-180.png"), 180)
    render_png(svg_maskable(512), I("maskable-512.png"), 512)
    render_png(svg_maskable(512), I("maskable-192.png"), 192)

    ico_src = svg_to_image(badge_micro, 256)
    ico_src.save(I("favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])

    # ---- Social ----------------------------------------------------------
    build_social_card(S("og-card-1200x630.png"))
    build_github_header(S("github-header-1280x640.png"))
    build_avatar(S("avatar-512.png"))
    build_swatch_sheet(S("palette-1400x900.png"))

    # ---- Web -------------------------------------------------------------
    write(W("site.webmanifest"), WEBMANIFEST)
    write(W("tokens.css"), TOKENS_CSS)
    write(W("head-snippet.html"), HTML_SNIPPET)

    # ---- Docs ------------------------------------------------------------
    write(os.path.join(OUT_DIR, "BRAND.md"), brand_md())

    # ---- Report ----------------------------------------------------------
    total = 0
    for root, _, files in os.walk(OUT_DIR):
        for f in sorted(files):
            p = os.path.join(root, f)
            total += 1
            print(f"{os.path.relpath(p, OUT_DIR):<44} {os.path.getsize(p):>9,} B")
    print(f"\n{total} files -> {OUT_DIR}")


if __name__ == "__main__":
    main()
