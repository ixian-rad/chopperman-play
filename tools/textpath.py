"""Convert text to SVG path data with fontTools (so SVGs don't depend on installed fonts)."""
from functools import lru_cache
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen


@lru_cache(None)
def _font(path):
    f = TTFont(path)
    return f, f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm


def _kern_pairs(f):
    """Flatten GPOS PairPos format 1/2 XAdvance kerning into a dict (best effort)."""
    pairs = {}
    if "GPOS" not in f:
        return pairs
    gpos = f["GPOS"].table
    for li in gpos.LookupList.Lookup:
        for st in li.SubTable:
            if li.LookupType == 9:
                st = st.ExtSubTable
            if getattr(st, "LookupType", 2) != 2 or not hasattr(st, "Format"):
                continue
            cov = st.Coverage.glyphs
            if st.Format == 1:
                for i, g1 in enumerate(cov):
                    for pvr in st.PairSet[i].PairValueRecord:
                        v = pvr.Value1
                        if v is not None and getattr(v, "XAdvance", 0):
                            pairs.setdefault((g1, pvr.SecondGlyph), v.XAdvance)
            elif st.Format == 2:
                c1 = st.ClassDef1.classDefs
                c2 = st.ClassDef2.classDefs
                for g1 in cov:
                    k1 = c1.get(g1, 0)
                    row = st.Class1Record[k1].Class2Record
                    for g2, k2 in c2.items():
                        v = row[k2].Value1
                        if v is not None and getattr(v, "XAdvance", 0):
                            pairs.setdefault((g1, g2), v.XAdvance)
    return pairs


_kern_cache = {}


def text_path(fontfile, text, size, x, y, anchor="middle", tracking=0.0):
    """Return (svg_path_d, width). y is the baseline. tracking in px."""
    f, gs, cmap, upm = _font(fontfile)
    if fontfile not in _kern_cache:
        _kern_cache[fontfile] = _kern_pairs(f)
    kern = _kern_cache[fontfile]
    s = size / upm
    names = [cmap.get(ord(c), ".notdef") for c in text]
    advs = []
    for i, g in enumerate(names):
        a = gs[g].width
        if i + 1 < len(names):
            a += kern.get((g, names[i + 1]), 0)
        advs.append(a * s)
    width = sum(advs) + tracking * (len(names) - 1)
    cx = {"start": x, "middle": x - width / 2, "end": x - width}[anchor]
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
    for g, a in zip(names, advs):
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, cx, y)))
        cx += a + tracking
    return pen.getCommands(), width


def text_width(fontfile, text, size, tracking=0.0):
    return text_path(fontfile, text, size, 0, 0, "start", tracking)[1]
