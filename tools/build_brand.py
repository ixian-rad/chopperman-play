#!/usr/bin/env python3
"""Generate the Chopperman visual identity as hand-built SVG.

Writes into assets/brand/: logo.svg, logo-mark.svg, favicon.svg, hero.svg,
divider-sawtooth.svg, divider-logedge.svg, band-woodgrain.svg,
texture-woodgrain.svg, texture-endgrain.svg, icon-*.svg.
All text is converted to outlines with fontTools (tools/textpath.py), so no
SVG depends on installed fonts. Deterministic: every random draw is seeded.

    python3 tools/build_brand.py
"""
import math
import os
import random

from textpath import text_path, text_width

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "brand")
FONTS = os.path.join(ROOT, "assets", "fonts")
ALFA = os.path.join(FONTS, "AlfaSlabOne-Regular.ttf")
BARLOW = os.path.join(FONTS, "BarlowCondensed-Bold.ttf")

# Palette (Grain & Gravity family)
BARK = "#1A1410"
HEART = "#5A2F17"
CEDAR = "#B5652B"
SAP = "#E8C38A"
EMBER = "#F2862E"
CHALK = "#F4EDE1"
NAVY = "#0E2A47"
CYAN = "#5CC8F2"
STEEL = "#C9D1D8"


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def poly(pts, close=True):
    d = "M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts)
    return d + (" Z" if close else "")


def smooth_closed(pts):
    """Catmull-Rom -> cubic Bezier closed path."""
    n = len(pts)
    d = f"M{f(pts[0][0])} {f(pts[0][1])}"
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}"
    return d + " Z"


def smooth_open(pts):
    d = f"M{f(pts[0][0])} {f(pts[0][1])}"
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2 = pts[max(i - 1, 0)], pts[i], pts[i + 1]
        p3 = pts[min(i + 2, n - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}"
    return d


def wobbly_ellipse(cx, cy, rx, ry, rng, amp=0.03, n=48):
    ph = [rng.uniform(0, 6.28) for _ in range(3)]
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        k = 1 + amp * (math.sin(3 * t + ph[0]) * 0.6 + math.sin(5 * t + ph[1]) * 0.3 + math.sin(9 * t + ph[2]) * 0.15)
        pts.append((cx + rx * k * math.cos(t), cy + ry * k * math.sin(t)))
    return smooth_closed(pts)


def write(name, svg):
    path = os.path.join(OUT, name)
    with open(path, "w") as fh:
        fh.write(svg)
    print(f"{name:28s} {os.path.getsize(path):7d} B")


# ----------------------------------------------------------------------------
# Chopping block + axe + chips (the core motif). Drawn in a 512 x 512 space.
# ----------------------------------------------------------------------------
def block_defs(p):
    return f"""
  <radialGradient id="{p}face" cx="0.46" cy="0.42" r="0.62">
    <stop offset="0" stop-color="#F6DDB0"/><stop offset=".65" stop-color="{SAP}"/><stop offset="1" stop-color="#C98F55"/>
  </radialGradient>
  <linearGradient id="{p}side" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#2E180B"/><stop offset=".3" stop-color="#7A4223"/><stop offset=".55" stop-color="{HEART}"/><stop offset="1" stop-color="#24120A"/>
  </linearGradient>
  <linearGradient id="{p}steel" x1="-40" y1="0" x2="40" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#6F7983"/><stop offset=".42" stop-color="#E4E9ED"/><stop offset=".62" stop-color="{STEEL}"/><stop offset="1" stop-color="#7E8892"/>
  </linearGradient>
  <linearGradient id="{p}handle" x1="0" y1="-9" x2="0" y2="9" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#EDB878"/><stop offset=".5" stop-color="#C47F45"/><stop offset="1" stop-color="#7E4520"/>
  </linearGradient>"""


def block_parts(p, seed=7, with_chips=True, trail=EMBER):
    rng = random.Random(seed)
    cx, cy, rx, ry = 256, 300, 150, 62
    side_h = 130
    out = []
    # side (cylinder) with bark furrows
    side = (f"M{cx - rx} {cy} L{cx - rx} {cy + side_h} "
            f"A{rx} {ry} 0 0 0 {cx + rx} {cy + side_h} L{cx + rx} {cy} "
            f"A{rx} {ry} 0 0 1 {cx - rx} {cy} Z")
    out.append(f'<path d="{side}" fill="url(#{p}side)"/>')
    furrows = []
    for i in range(17):
        t = -0.92 + i * (1.84 / 16) + rng.uniform(-0.03, 0.03)
        x = cx + rx * t
        y0 = cy + ry * math.sqrt(max(0, 1 - t * t)) + 4
        pts = []
        steps = 6
        for s in range(steps + 1):
            yy = y0 + (side_h + 20) * s / steps
            pts.append((x + rng.uniform(-3, 3) * (1 - abs(t)), yy))
        furrows.append(smooth_open(pts))
    out.append(f'<path d="{" ".join(furrows)}" fill="none" stroke="#24120A" stroke-width="3" stroke-linecap="round" opacity=".7"/>')
    # top face
    out.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#{p}face)"/>')
    px, py = cx - 10, cy + 4  # pith, slightly off-centre like real wood
    rings = []
    for i in range(1, 12):
        k = (i / 12) ** 0.92
        rings.append(wobbly_ellipse(px + (cx - px) * k, py + (cy - py) * k, rx * 0.93 * k, ry * 0.9 * k, rng, amp=0.035))
    out.append(f'<path d="{" ".join(rings[::2])}" fill="none" stroke="{CEDAR}" stroke-width="2.4" opacity=".75"/>')
    out.append(f'<path d="{" ".join(rings[1::2])}" fill="none" stroke="#C88A50" stroke-width="1.4" opacity=".7"/>')
    out.append(f'<circle cx="{px}" cy="{py}" r="3.5" fill="{HEART}"/>')
    # checks (radial cracks) from the pith, and the split running toward the viewer
    cracks = []
    for ang, ln in ((200, 0.55), (335, 0.42)):
        a = math.radians(ang)
        pts = [(px, py)]
        for s in range(1, 5):
            r = ln * s / 4
            pts.append((px + rx * r * math.cos(a) + rng.uniform(-3, 3), py + ry * r * math.sin(a) + rng.uniform(-1.5, 1.5)))
        cracks.append(poly(pts, False))
    out.append(f'<path d="{" ".join(cracks)}" fill="none" stroke="{HEART}" stroke-width="2" stroke-linecap="round" opacity=".8"/>')
    split = poly([(300, 290), (296, 305), (300, 318), (293, 334), (296, 348), (290, 361)], False)
    out.append(f'<path d="{split}" fill="none" stroke="#2A160B" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>')
    # bark rim on top
    out.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="none" stroke="{HEART}" stroke-width="9"/>')
    out.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx - 5}" ry="{ry - 4}" fill="none" stroke="#F6DDB0" stroke-width="1.5" opacity=".5"/>')

    # axe: local frame u along handle (to grip), v toward the bit (into the wood).
    # The head is drawn long and clipped by a line lying in the top face, so
    # the bit looks buried in the round.
    ex, ey, rot = 266, 228, -40
    l0, l1 = (236, 324), (372, 263)  # entry line in the face
    sl = (l1[1] - l0[1]) / (l1[0] - l0[0])
    yl = lambda x: l0[1] + sl * (x - l0[0])
    axe = []
    kerf = poly([(270, yl(270) + 1), (300, yl(300) - 3), (352, yl(352) - 3.5), (356, yl(356) + 1), (352, yl(352) + 4), (300, yl(300) + 5)])
    axe.append(f'<clipPath id="{p}axeclip"><path d="M0 0 L512 0 L512 {f(yl(512))} L0 {f(yl(0))} Z"/></clipPath>')
    hd = ("M10 -10 C70 -10.5 150 -9 206 -8.5 C214 -8.5 218 -13 225 -13 C234 -13 236 -5 236 0 "
          "C236 5 234 13 225 13 C218 13 214 8.5 206 8.5 C150 9 70 10.5 10 10 Z")
    handle = (f'<path d="{hd}" fill="url(#{p}handle)" stroke="#4A2410" stroke-width="2.2"/>'
              '<path d="M160 -3 L206 -3" stroke="#F3CF97" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>')
    head = "M-21 -40 L21 -40 L24 -6 L16 22 C30 40 44 62 54 86 L-62 86 C-48 60 -30 40 -16 22 L-24 -6 Z"
    head_svg = (f'<path d="{head}" fill="url(#{p}steel)" stroke="#3A4148" stroke-width="3" stroke-linejoin="round"/>'
                '<path d="M-15 -33 L15 -33 L17 -12 L-17 -12 Z" fill="#59626B"/>'
                '<path d="M-44 70 C-28 50 -14 36 -2 30" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity=".55"/>'
                '<path d="M-56 80 L48 80" stroke="#FFFFFF" stroke-width="2" opacity=".35"/>')
    axe_body = (f'<path d="{kerf}" fill="#2A160B"/>'
                f'<g clip-path="url(#{p}axeclip)"><g transform="translate({ex} {ey}) rotate({rot})">{handle}{head_svg}</g></g>')
    wood = "".join(out)
    axe_g = "".join(axe) + axe_body
    out = []
    if with_chips:
        chips = [((146, 248), 24, -18), ((112, 308), 17, 14), ((176, 186), 14, -48)]
        # short motion streaks behind each chip, pointing back toward the bite
        streaks = []
        for (x, y), sz, _ in chips:
            dx, dy = 290 - x, 312 - y
            n = math.hypot(dx, dy)
            ux, uy = dx / n, dy / n
            for k, off in ((1.0, 0), (0.55, 7)):
                ox_, oy_ = -uy * off, ux * off
                a = (x + ux * (sz + 6) + ox_, y + uy * (sz + 6) + oy_)
                b = (a[0] + ux * 34 * k, a[1] + uy * 34 * k)
                streaks.append(f"M{f(a[0])} {f(a[1])} L{f(b[0])} {f(b[1])}")
        out.append(f'<path d="{" ".join(streaks)}" stroke="{trail}" stroke-width="4" stroke-linecap="round" opacity=".9"/>')
        for (x, y), s, r in chips:
            pts = [(-s, -s * 0.28), (-s * 0.2, -s * 0.5), (s, -s * 0.18), (s * 0.7, s * 0.34), (-s * 0.6, s * 0.4)]
            d = poly(pts)
            out.append(f'<g transform="translate({x} {y}) rotate({r})"><path d="{d}" fill="{SAP}" stroke="{HEART}" stroke-width="2.5" stroke-linejoin="round"/>'
                       f'<path d="M{-s * 0.6:.1f} {-s * 0.05:.1f} L{s * 0.55:.1f} {-s * 0.1:.1f}" stroke="{CEDAR}" stroke-width="1.6" stroke-linecap="round"/></g>')
    return wood, axe_g, "".join(out)


def block(p, seed=7, with_chips=True, trail=EMBER):
    return "".join(block_parts(p, seed, with_chips, trail))


def emblem_svg(size=512, title="Chopperman emblem"):
    p = "e"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 512 512" role="img" aria-labelledby="t">
<title id="t">{title}</title>
<defs>{block_defs(p)}
  <radialGradient id="{p}disc" cx="0.5" cy="0.36" r="0.66">
    <stop offset="0" stop-color="#4A2C18"/><stop offset=".55" stop-color="#2A1D14"/><stop offset="1" stop-color="{BARK}"/>
  </radialGradient>
  <radialGradient id="{p}glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#FFD58A"/><stop offset=".25" stop-color="{EMBER}" stop-opacity=".8"/><stop offset="1" stop-color="{EMBER}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="{p}clip"><circle cx="256" cy="272" r="203"/></clipPath>
</defs>
{emblem_body(p)}
</svg>
"""


def emblem_body(p):
    # badge disc: golden-hour glow and a treeline behind the chopping block.
    # The block is clipped to the disc; the axe handle and chips break out.
    rng = random.Random(17)
    trees = [pine(x, 306 + rng.uniform(-6, 6), rng.uniform(70, 125), rng.uniform(34, 48), rng) for x in range(40, 480, 30)]
    wood, axe, chips = block_parts(p)
    return f"""<circle cx="256" cy="272" r="214" fill="url(#{p}disc)"/>
<g clip-path="url(#{p}clip)">
<circle cx="256" cy="262" r="150" fill="url(#{p}glow)"/>
<path d="{' '.join(trees)}" fill="#120C08" opacity=".9"/>
<rect x="40" y="300" width="440" height="200" fill="#120C08" opacity=".9"/>
<ellipse cx="256" cy="436" rx="190" ry="40" fill="#000" opacity=".35"/>{wood}</g>
<circle cx="256" cy="272" r="214" fill="none" stroke="{CEDAR}" stroke-width="10"/>
<circle cx="256" cy="272" r="203" fill="none" stroke="{HEART}" stroke-width="3"/>
{chips}{axe}"""


# ----------------------------------------------------------------------------
# Wordmark
# ----------------------------------------------------------------------------
def wordmark(x, baseline, size, tagline=True, tag_size=None):
    """Return (svg_fragment, total_width). CHOP (chalk) + PERMAN (sapwood), with
    a V-shaped axe bite notched out of the top of the O and two chips leaving it."""
    tr = size * 0.02
    d1, w1 = text_path(ALFA, "CHOP", size, x, baseline, "start", tracking=tr)
    x2 = x + w1 + tr
    d2, w2 = text_path(ALFA, "PERMAN", size, x2, baseline, "start", tracking=tr)
    total = w1 + tr + w2
    wch = text_width(ALFA, "CH", size, tracking=tr) + tr
    wo = text_width(ALFA, "O", size)
    ox = x + wch + wo / 2
    top = baseline - size * 0.74
    nw, nd = size * 0.15, size * 0.33
    notch = poly([(ox - nw, top - 4), (ox + nw * 1.2, top - 4), (ox + nw * 0.15, top + nd)])
    ex = size * 0.045
    layers = [f'<mask id="wmBite" maskUnits="userSpaceOnUse" x="{f(x - 10)}" y="{f(top - size)}" width="{f(total + size)}" height="{f(size * 2)}">'
              f'<rect x="{f(x - 10)}" y="{f(top - size)}" width="{f(total + size)}" height="{f(size * 2)}" fill="#fff"/><path d="{notch}" fill="#000"/></mask>',
              '<g mask="url(#wmBite)">']
    for k in (1.0, 0.66, 0.33):
        layers.append(f'<path d="{d1} {d2}" fill="{HEART}" transform="translate({f(ex * k)} {f(ex * k)})"/>')
    layers.append(f'<path d="{d1}" fill="url(#wmFill)"/><path d="{d2}" fill="url(#wmFill2)"/></g>')
    # chips leaving the bite
    for (dx, dy, cs, r) in ((nw * 1.5, -size * 0.3, size * 0.11, -28), (nw * 3.2, -size * 0.14, size * 0.07, 22)):
        chip = poly([(-cs, -cs * 0.25), (-cs * 0.1, -cs * 0.55), (cs, -cs * 0.15), (cs * 0.7, cs * 0.35), (-cs * 0.6, cs * 0.42)])
        layers.append(f'<g transform="translate({f(ox + dx)} {f(top + dy)}) rotate({r})"><path d="{chip}" fill="{SAP}" stroke="{HEART}" stroke-width="{f(size * 0.018)}" stroke-linejoin="round"/></g>')
    streak = f"M{f(ox + nw * 0.5)} {f(top - size * 0.05)} L{f(ox + nw * 1.0)} {f(top - size * 0.2)} M{f(ox + nw * 1.5)} {f(top + size * 0.0)} L{f(ox + nw * 2.4)} {f(top - size * 0.08)}"
    layers.append(f'<path d="{streak}" stroke="{EMBER}" stroke-width="{f(size * 0.03)}" stroke-linecap="round"/>')
    frag = "".join(layers)
    if tagline:
        ts = tag_size or size * 0.26
        tag = "THREE AIs · ONE AXE"
        tw = text_width(BARLOW, tag, ts, tracking=ts * 0.22)
        ty = baseline + size * 0.52
        cxm = x + total / 2
        dtag, _ = text_path(BARLOW, tag, ts, cxm, ty, "middle", tracking=ts * 0.22)
        frag += f'<path d="{dtag}" fill="{SAP}"/>'
        rl = (total - tw) / 2 - ts * 0.7
        ry_ = ty - ts * 0.36
        frag += (f'<path d="M{f(x + ex)} {f(ry_)} L{f(x + rl)} {f(ry_)} M{f(x + total - rl)} {f(ry_)} L{f(x + total)} {f(ry_)}" '
                 f'stroke="{CEDAR}" stroke-width="{f(ts * 0.12)}" stroke-linecap="round"/>')
    return frag, total


WM_DEFS = f"""<linearGradient id="wmFill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFF8EC"/><stop offset=".55" stop-color="{CHALK}"/><stop offset="1" stop-color="{SAP}"/>
  </linearGradient>
  <linearGradient id="wmFill2" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#F6DDB0"/><stop offset=".6" stop-color="{SAP}"/><stop offset="1" stop-color="#D9A462"/>
  </linearGradient>"""


def logo_svg():
    W, H = 1200, 340
    p = "e"
    size = 150
    frag, total = wordmark(0, 0, size)
    # fit wordmark into the space right of the emblem
    avail = W - 360 - 16
    sc = avail / (total + size * 0.05)
    frag, total = wordmark(360, 200, size * sc)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t">
<title id="t">Chopperman</title>
<defs>{block_defs(p)}
  <radialGradient id="{p}disc" cx="0.5" cy="0.36" r="0.66">
    <stop offset="0" stop-color="#4A2C18"/><stop offset=".55" stop-color="#2A1D14"/><stop offset="1" stop-color="{BARK}"/>
  </radialGradient>
  <radialGradient id="{p}glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#FFD58A"/><stop offset=".25" stop-color="{EMBER}" stop-opacity=".8"/><stop offset="1" stop-color="{EMBER}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="{p}clip"><circle cx="256" cy="272" r="203"/></clipPath>
  {WM_DEFS}
</defs>
<g transform="translate(0 -6) scale(0.664)">{emblem_body(p)}</g>
{frag}
</svg>
"""


def favicon_svg():
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<title>Chopperman</title>
<circle cx="32" cy="32" r="31" fill="{BARK}" stroke="{CEDAR}" stroke-width="2"/>
<path d="M12 37 L12 50 A20 8 0 0 0 52 50 L52 37 Z" fill="{HEART}"/>
<ellipse cx="32" cy="37" rx="20" ry="8.5" fill="{SAP}" stroke="#3B1E0E" stroke-width="2"/>
<ellipse cx="31" cy="37.5" rx="12" ry="5" fill="none" stroke="{CEDAR}" stroke-width="1.6"/>
<ellipse cx="30.5" cy="37.8" rx="5" ry="2" fill="none" stroke="{CEDAR}" stroke-width="1.6"/>
<path d="M33 31 L52 9" stroke="#C47F45" stroke-width="5" stroke-linecap="round"/>
<path d="M27 25 L33 20 L44 34 L36 38 L26 33 Z" fill="{STEEL}" stroke="#3A4148" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M17 21 l4 -3 l3 3 l-4 3 Z" fill="{EMBER}"/>
</svg>
"""


# ----------------------------------------------------------------------------
# Hero landscape (1920 x 1080), golden hour backyard
# ----------------------------------------------------------------------------
def pine(x, base, h, w, rng, tiers=None):
    tiers = tiers or rng.randint(5, 7)
    left, right = [], []
    step = h * 0.86 / tiers
    for i in range(tiers):
        fr = i / tiers
        yb = base - h * 0.08 - i * step
        hw = w / 2 * (1 - fr * 0.82) * rng.uniform(0.92, 1.08)
        left += [(x - hw, yb), (x - hw * 0.42, yb - step * 0.42)]
        right += [(x + hw * rng.uniform(0.94, 1.06), yb), (x + hw * 0.42, yb - step * 0.42)]
    pts = [(x - w * 0.04, base)] + left + [(x + rng.uniform(-2, 2), base - h)] + right[::-1] + [(x + w * 0.04, base)]
    return poly(pts)


def ridge(y, amp, seed, W=1920, n=40):
    rng = random.Random(seed)
    ph = [rng.uniform(0, 6.28) for _ in range(3)]
    pts = []
    for i in range(n + 1):
        x = W * i / n
        yy = y + amp * (math.sin(x / 310 + ph[0]) * 0.6 + math.sin(x / 140 + ph[1]) * 0.3 + math.sin(x / 61 + ph[2]) * 0.1)
        pts.append((x, yy))
    return smooth_open(pts) + f" L{W} 1080 L0 1080 Z"


def endgrain_disc(cx, cy, r, rng, rings=6, ry_scale=1.0):
    out = [f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(r)}" ry="{f(r * ry_scale)}" fill="#E2B67C" stroke="{HEART}" stroke-width="{f(max(2, r * 0.12))}"/>']
    rs = []
    for i in range(1, rings):
        k = i / rings
        rs.append(wobbly_ellipse(cx - r * 0.06, cy + r * 0.04, r * 0.85 * k, r * 0.85 * k * ry_scale, rng, amp=0.05, n=24))
    out.append(f'<path d="{" ".join(rs)}" fill="none" stroke="{CEDAR}" stroke-width="{f(max(0.8, r * 0.04))}" opacity=".8"/>')
    return "".join(out)


def hero_svg():
    W, H = 1920, 1080
    rng = random.Random(42)
    sunx, suny = 1300, 610
    L = []
    L.append(f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">
<title>A backyard at golden hour: pines, a split-rail fence, a chopping block with an axe and flying wood chips</title>
<defs>{block_defs("h")}
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#140F18"/><stop offset=".28" stop-color="#3A2030"/><stop offset=".5" stop-color="#8C3E24"/>
    <stop offset=".62" stop-color="#E07A2E"/><stop offset=".72" stop-color="#F6B565"/><stop offset="1" stop-color="#F6B565"/>
  </linearGradient>
  <radialGradient id="sun" cx="{sunx}" cy="{suny}" r="520" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FFF1CF"/><stop offset=".08" stop-color="#FFE0A0"/><stop offset=".3" stop-color="#F7A54A" stop-opacity=".55"/><stop offset="1" stop-color="#F2862E" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="ray" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#FFE7B8" stop-opacity=".5"/><stop offset="1" stop-color="#FFE7B8" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4A2A17"/><stop offset=".35" stop-color="#2C1B11"/><stop offset="1" stop-color="#140E0A"/>
  </linearGradient>
  <radialGradient id="vig" cx=".62" cy=".55" r=".85">
    <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/>
  </radialGradient>
  <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#F6B565" stop-opacity=".35"/><stop offset="1" stop-color="#F6B565" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="{W}" height="{H}" fill="url(#sky)"/>
<rect width="{W}" height="{H}" fill="url(#sun)"/>""")
    # light rays fanning from the sun
    rays = []
    for i in range(11):
        a = math.radians(-200 + i * 22 + rng.uniform(-5, 5))
        a2 = a + math.radians(rng.uniform(3, 7))
        R = 1500
        rays.append(f'<path d="M{sunx} {suny} L{f(sunx + R * math.cos(a))} {f(suny + R * math.sin(a))} L{f(sunx + R * math.cos(a2))} {f(suny + R * math.sin(a2))} Z" fill="#FFE7B8" opacity="{rng.uniform(.04, .09):.3f}"/>')
    L.append("<g>" + "".join(rays) + "</g>")
    L.append(f'<circle cx="{sunx}" cy="{suny}" r="64" fill="#FFF4DA"/>')
    # far ridge + haze pines
    L.append(f'<path d="{ridge(700, 26, 1)}" fill="#A8502A" opacity=".75"/>')
    far = [pine(x, 712 + rng.uniform(-14, 14), rng.uniform(80, 150), rng.uniform(34, 52), rng) for x in range(-20, W + 40, 34)]
    L.append(f'<path d="{" ".join(far)}" fill="#8E4024" opacity=".85"/>')
    L.append(f'<path d="{ridge(745, 22, 2)}" fill="#6B2F1A"/>')
    mid = [pine(x + rng.uniform(-18, 18), 760 + rng.uniform(-10, 10), rng.uniform(150, 260), rng.uniform(56, 84), rng) for x in range(-30, W + 60, 58)]
    L.append(f'<path d="{" ".join(mid)}" fill="#4A2015"/>')
    # haze band at the treeline
    L.append(f'<rect x="0" y="690" width="{W}" height="120" fill="#F6B565" opacity=".12"/>')
    # ground
    L.append(f'<path d="{ridge(790, 10, 3)}" fill="url(#ground)"/>')
    L.append(f'<ellipse cx="{sunx}" cy="840" rx="700" ry="90" fill="url(#pool)"/>')
    # split-rail fence
    fence = []
    for i, x in enumerate(range(-40, W + 160, 170)):
        y0 = 800 + 3 * math.sin(i)
        fence.append(f'<path d="M{x - 7} {y0 - 70} L{x + 7} {y0 - 72} L{x + 8} {y0 + 6} L{x - 8} {y0 + 6} Z"/>')
    rails = []
    for yy in (748, 774):
        pts = [(x, yy + 3 * math.sin(x / 90)) for x in range(-40, W + 41, 40)]
        rails.append(smooth_open(pts))
    L.append(f'<g fill="#24150D">{"".join(fence)}</g>')
    L.append(f'<path d="{" ".join(rails)}" fill="none" stroke="#24150D" stroke-width="11" stroke-linecap="round"/>')
    L.append(f'<path d="{" ".join(rails)}" fill="none" stroke="#C26A30" stroke-width="2" opacity=".55" transform="translate(0 -5)"/>')
    # woodpile on the right (log ends)
    wp = []
    prng = random.Random(9)
    for row in range(5):
        y = 860 - row * 34
        for c in range(9 - row):
            x = 1585 + row * 18 + c * 38 + prng.uniform(-3, 3)
            wp.append(endgrain_disc(x, y + prng.uniform(-3, 3), prng.uniform(16, 20), prng, rings=4))
    L.append(f'<rect x="1560" y="868" width="360" height="24" fill="#1A100A"/>')
    L.append("<g>" + "".join(wp) + "</g>")
    # near framing pines (dark silhouettes)
    near = []
    for x, h, w in ((40, 980, 300), (210, 760, 220), (-60, 1100, 340), (1890, 1000, 300), (1760, 640, 190)):
        near.append(pine(x, 1000, h, w, rng, tiers=8))
    L.append(f'<path d="{" ".join(near)}" fill="#120C08"/>')
    # foreground ground lip
    L.append(f'<path d="M0 960 C400 930 900 945 1300 935 C1600 928 1800 950 1920 940 L1920 1080 L0 1080 Z" fill="#120C08" opacity=".85"/>')
    # main chopping block with axe (reuses the emblem motif)
    L.append(f'<ellipse cx="1300" cy="1000" rx="240" ry="34" fill="#000" opacity=".45"/>')
    L.append(f'<g transform="translate(1072 640) scale(0.9)">{block("h", seed=11, trail="#F7B062")}</g>')
    # split halves lying on the ground
    halves = []
    hr = random.Random(5)
    for cx, cy, r, flip in ((990, 1000, 70, 1), (1610, 1012, 62, -1)):
        halves.append(f'<g transform="translate({cx} {cy}) scale({flip} 1)">'
                      f'<path d="M{-r} 0 A{r} {r} 0 0 1 {r} 0 Z" fill="#E2B67C" stroke="{HEART}" stroke-width="9" stroke-linejoin="round"/>')
        rs = []
        for i in range(1, 6):
            k = i / 6
            rs.append(f"M{f(-r * 0.9 * k)} 0 A{f(r * 0.9 * k)} {f(r * 0.9 * k * hr.uniform(.92, 1.04))} 0 0 1 {f(r * 0.9 * k)} 0")
        halves.append(f'<path d="{" ".join(rs)}" fill="none" stroke="{CEDAR}" stroke-width="2.5"/>')
        halves.append(f'<path d="M{-r - 4} 2 L{r + 4} 2" stroke="#3B1E0E" stroke-width="6"/></g>')
    L.append("".join(halves))
    # chips on the ground and drifting in the light
    ch = []
    crng = random.Random(3)
    for _ in range(26):
        x = crng.uniform(1020, 1640)
        y = crng.uniform(985, 1050)
        s = crng.uniform(5, 11)
        ch.append(f'<path d="{poly([(x - s, y), (x - s * .2, y - s * .5), (x + s, y - s * .1), (x + s * .5, y + s * .3)])}"/>')
    L.append(f'<g fill="{SAP}" opacity=".85">{"".join(ch)}</g>')
    motes = "".join(f'<circle cx="{f(crng.uniform(900, 1800))}" cy="{f(crng.uniform(420, 860))}" r="{f(crng.uniform(1.5, 4))}"/>' for _ in range(40))
    L.append(f'<g fill="#FFE7B8" opacity=".5">{motes}</g>')
    L.append(f'<rect width="{W}" height="{H}" fill="url(#vig)"/>')
    L.append("</svg>\n")
    return "\n".join(L)


# ----------------------------------------------------------------------------
# Dividers, bands, textures
# ----------------------------------------------------------------------------
def sawtooth_svg():
    # one tooth; used as a CSS mask repeated along x, so its colour comes from CSS
    return """<svg xmlns="http://www.w3.org/2000/svg" width="40" height="16" viewBox="0 0 40 16"><path d="M0 0 L40 0 L40 2 L20 16 L0 2 Z" fill="#000"/></svg>\n"""


def logedge_svg():
    W, H = 1440, 56
    rng = random.Random(21)
    top = [(x, 18 + rng.uniform(-6, 7) + 4 * math.sin(x / 70)) for x in range(0, W + 1, 24)]
    top[0] = (0, top[-1][1])
    bark = smooth_open(top) + f" L{W} {H} L0 {H} Z"
    furrows = []
    for x in range(10, W, 26):
        y = 24 + rng.uniform(-4, 6)
        furrows.append(f"M{x} {f(y)} l{f(rng.uniform(-3, 3))} {f(rng.uniform(8, 16))}")
    sap = smooth_open([(x, y + 22) for x, y in top]) + f" L{W} {H} L0 {H} Z"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" preserveAspectRatio="none">
<path d="{bark}" fill="{HEART}"/>
<path d="{' '.join(furrows)}" stroke="#2E170A" stroke-width="3" stroke-linecap="round"/>
<path d="{sap}" fill="{CEDAR}"/>
<path d="{smooth_open([(x, y + 27) for x, y in top])} L{W} {H} L0 {H} Z" fill="{BARK}"/>
</svg>
"""


def grain_lines(W, H, n, rng, amp=10, knots=2, color=CEDAR, width=1.6, opacity=.5):
    """Horizontal grain lines, periodic in x (seamless tile) with lens knots."""
    ks = [(rng.uniform(0.15, 0.85) * W, rng.uniform(0.2, 0.8) * H, rng.uniform(18, 34)) for _ in range(knots)]
    paths = []
    for i in range(n):
        y0 = (i + 0.5) * H / n
        ph = [rng.uniform(0, 6.28) for _ in range(2)]
        pts = []
        for s in range(0, 61):
            x = W * s / 60
            y = y0 + amp * 0.5 * math.sin(2 * math.pi * x / W + ph[0]) + amp * 0.25 * math.sin(4 * math.pi * x / W + ph[1])
            for kx, ky, kr in ks:  # lines swell around knots
                dx, dy = x - kx, y - ky
                dist = math.hypot(dx, dy * 1.6)
                if dist < kr * 3:
                    y += (kr * 1.1) * math.exp(-(dist / kr) ** 2) * (1 if dy >= 0 else -1)
            pts.append((x, y))
        paths.append(smooth_open(pts))
    knot_svg = "".join(f'<ellipse cx="{f(kx)}" cy="{f(ky)}" rx="{f(kr * .9)}" ry="{f(kr * .45)}" fill="none" stroke="{color}" stroke-width="{width * 1.4}"/>'
                       f'<ellipse cx="{f(kx)}" cy="{f(ky)}" rx="{f(kr * .4)}" ry="{f(kr * .18)}" fill="{color}"/>' for kx, ky, kr in ks)
    return f'<g opacity="{opacity}"><path d="{" ".join(paths)}" fill="none" stroke="{color}" stroke-width="{width}"/>{knot_svg}</g>'


def woodgrain_band_svg():
    W, H = 1440, 120
    rng = random.Random(33)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" preserveAspectRatio="none">
<defs><linearGradient id="pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7A4223"/><stop offset=".5" stop-color="{HEART}"/><stop offset="1" stop-color="#3B1E0E"/></linearGradient></defs>
<rect width="{W}" height="{H}" fill="url(#pl)"/>
{grain_lines(W, H, 16, rng, amp=14, knots=3, color="#2E170A", width=2, opacity=.55)}
{grain_lines(W, H, 9, rng, amp=10, knots=0, color="#C47F45", width=1.2, opacity=.35)}
<rect y="0" width="{W}" height="3" fill="{CEDAR}"/><rect y="{H - 3}" width="{W}" height="3" fill="#24120A"/>
</svg>
"""


def woodgrain_texture_svg():
    W = H = 480
    rng = random.Random(8)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
{grain_lines(W, H, 22, rng, amp=18, knots=1, color="#3A2A1E", width=1.4, opacity=.55)}
</svg>
"""


def endgrain_texture_svg():
    S = 800
    rng = random.Random(4)
    rings = []
    for i in range(1, 30):
        k = (i / 30) ** 0.9
        rings.append(wobbly_ellipse(400, 400, 390 * k, 390 * k, rng, amp=0.03, n=64))
    checks = []
    for a in (20, 150, 260):
        r = math.radians(a)
        pts = [(400, 400)] + [(400 + 360 * s / 5 * math.cos(r) + rng.uniform(-6, 6), 400 + 360 * s / 5 * math.sin(r) + rng.uniform(-6, 6)) for s in range(1, 6)]
        checks.append(poly(pts, False))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
<path d="{' '.join(rings)}" fill="none" stroke="{SAP}" stroke-width="2"/>
<path d="{' '.join(checks)}" fill="none" stroke="{SAP}" stroke-width="3" stroke-linecap="round"/>
</svg>
"""


# ----------------------------------------------------------------------------
# Icons (48 x 48)
# ----------------------------------------------------------------------------
def icon(name, body, title):
    write(f"icon-{name}.svg", f"""<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round">
<title>{title}</title>
{body}
</svg>
""")


def icons():
    icon("gameplay", f"""<circle cx="20" cy="28" r="15" stroke="{SAP}" stroke-width="2.5"/>
<circle cx="20" cy="28" r="9" stroke="{CEDAR}" stroke-width="2.5"/>
<circle cx="20" cy="28" r="3" fill="{EMBER}" stroke="none"/>
<path d="M26 22 L44 4" stroke="#C47F45" stroke-width="4"/>
<path d="M22 14 L29 9 L37 19 L30 24 Z" fill="{STEEL}" stroke="#3A4148" stroke-width="1.5"/>""", "Gameplay")
    icon("graphics", f"""<rect x="4" y="8" width="40" height="32" rx="4" stroke="{SAP}" stroke-width="2.5"/>
<circle cx="32" cy="18" r="4.5" fill="{EMBER}" stroke="none"/>
<path d="M8 36 L16 22 L24 36 M18 36 L26 25 L34 36 M30 36 L35 29 L40 36" stroke="{SAP}" stroke-width="2.5"/>""", "Graphics")
    icon("physics", f"""<path d="M5 40 C12 12 30 6 43 22" stroke="{CYAN}" stroke-width="2.5" stroke-dasharray="3 5"/>
<path d="M43 22 L36 21 M43 22 L42 15" stroke="{CYAN}" stroke-width="2.5"/>
<circle cx="5" cy="40" r="3.5" fill="{SAP}" stroke="none"/>
<path d="M4 44 L44 44" stroke="{SAP}" stroke-width="2.5"/>
<path d="M14 30 L22 20" stroke="{EMBER}" stroke-width="2.5"/><path d="M22 20 L16 21 M22 20 L21 26" stroke="{EMBER}" stroke-width="2.5"/>""", "Physics")
    icon("sound", f"""<path d="M6 19 L13 19 L23 10 L23 38 L13 29 L6 29 Z" stroke="{SAP}" stroke-width="2.5" fill="{HEART}"/>
<path d="M29 18 C32 21 32 27 29 30" stroke="{EMBER}" stroke-width="2.5"/>
<path d="M34 13 C40 19 40 29 34 35" stroke="{EMBER}" stroke-width="2.5"/>
<path d="M39 8 C47 17 47 31 39 40" stroke="{EMBER}" stroke-width="2.5" opacity=".7"/>""", "Sound and music")
    icon("cost", f"""<ellipse cx="24" cy="12" rx="15" ry="6" stroke="{SAP}" stroke-width="2.5"/>
<path d="M9 12 L9 22 C9 25.5 15.7 28 24 28 C32.3 28 39 25.5 39 22 L39 12" stroke="{SAP}" stroke-width="2.5"/>
<path d="M9 22 L9 32 C9 35.5 15.7 38 24 38 C32.3 38 39 35.5 39 32 L39 22" stroke="{CEDAR}" stroke-width="2.5"/>
<ellipse cx="24" cy="12" rx="7" ry="2.5" stroke="{EMBER}" stroke-width="2"/>""", "Cost")


def main():
    os.makedirs(OUT, exist_ok=True)
    write("logo-mark.svg", emblem_svg())
    write("logo.svg", logo_svg())
    write("favicon.svg", favicon_svg())
    write("hero.svg", hero_svg())
    write("divider-sawtooth.svg", sawtooth_svg())
    write("divider-logedge.svg", logedge_svg())
    write("band-woodgrain.svg", woodgrain_band_svg())
    write("texture-woodgrain.svg", woodgrain_texture_svg())
    write("texture-endgrain.svg", endgrain_texture_svg())
    icons()


if __name__ == "__main__":
    main()
