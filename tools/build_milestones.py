#!/usr/bin/env python3
"""Milestones gallery: data/milestones.json, the gallery block in milestones/index.html and the teaser strip on the main page (home/index.html).
Run: python3 tools/build_milestones.py [--capture] [--only=gemini]   (idempotent; tools/refresh_gemini.sh runs it with --capture --only=gemini)

Rows (milestones) x columns (harnesses). A cell is a tagged build:
  v1 · v2 · Classic final (tag pre-assets) · Assets v2 (assets-v2-release) · Polish (polish-1, Codex only) · Co-op + voice (coop-voice-release)
Tags are read read-only (git for-each-ref / rev-parse / archive) from /workspace/chopperman/axe-{claude,codex,deepseek} and, for Gemini, from
/workspace/gemini-snap (the clone of its private remote that tools/refresh_gemini.sh keeps; the live driver's axe-gemini repo is never touched).
Gemini is in progress: the first milestone it has not tagged yet shows its newest iter-N tag as a live "in progress" cell; later rows read "Not started".

Shots: every cell is one frame captured the same way (tools/capture_milestone.mjs: 1280x800, software GL, load, one chop, +1.5 s) from
`git archive <tag>` served on localhost, under the shared lock /workspace/chopperman/reports/.verify.lock. Raw PNGs are cached by commit in
/workspace/chopperman/reports/milestones/<h>-<commit>.png (they stay out of the site repo); --capture takes any that are missing.
Derived: assets/milestones/<h>/<row>-{480,960,1280}.webp + <row>-{480,960}.avif; filmstrips use the driver's own per-iteration captures
(reports/<h>-iter-N.png) -> assets/milestones/<h>/iter-N-{480,960}.webp. final-*.png, *-latest.png and attempt/WIP shots are never used.

Cost per cell = cumulative cost of that harness's game-build runs that started before the tag (same run log and est. rules as the blog,
tools/runlog.py); play-site design runs and the channel-art kit are excluded. Gemini figures are always est. (login-based, not billed)."""
import html, json, os, re, subprocess, sys, tempfile, shutil, socket, datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from runlog import load_rows, load_gemini_rows, NONGAME, COUNTED
from sitepaths import rebase, HOME, HOME_ROOT

CH = '/workspace/chopperman'
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = f'{CH}/reports/milestones'
LOCK = f'{CH}/reports/.verify.lock'
ET = ZoneInfo('America/New_York')
E = html.escape
HS = ['codex', 'claude', 'deepseek', 'gemini']          # play-picker order
NAME = {'codex': 'Codex', 'claude': 'Claude', 'deepseek': 'DeepSeek', 'gemini': 'Gemini'}
REPO = {'codex': f'{CH}/axe-codex', 'claude': f'{CH}/axe-claude', 'deepseek': f'{CH}/axe-deepseek', 'gemini': '/workspace/gemini-snap'}
ROWS = [  # key, label, tag, short description, long description
    ('v1', 'v1', 'v1', 'First build from the brief', 'The first build from the original brief.'),
    ('v2', 'v2', 'v2', 'Second prompt round', 'The second prompt round.'),
    ('classic', 'Classic final', 'pre-assets', 'Frozen pre-assets build', 'The classic build, frozen before the 3D assets (tag pre-assets). This is what /classic/ plays; the review scored earlier snapshots.'),
    ('assets', 'Assets v2', 'assets-v2-release', 'Sergey, two backyards, walk and fell', 'Assets v2: Sergey, the New Jersey and Tiraspol backyards, walking and felling trees.'),
    ('polish', 'Polish', 'polish-1', 'Extra polish pass (Codex only)', 'An extra polish pass on the Assets v2 build (Codex only).'),
    ('coop', 'Co-op + voice', 'coop-voice-release', 'Online co-op and proximity voice chat', 'Two-player online co-op with opt-in proximity voice chat, merged and released on Oct 23 (tag coop-voice-release).'),
]
ROWD = {r[0]: r for r in ROWS}


def git(h, *a):
    return subprocess.run(['git', '-C', REPO[h], *a], capture_output=True, text=True).stdout.strip()


def tag_info(h, tag):
    c = git(h, 'rev-parse', '-q', '--verify', '--short=7', f'refs/tags/{tag}^{{commit}}')
    if not c: return None
    d = git(h, 'for-each-ref', '--format=%(creatordate:iso-strict)', f'refs/tags/{tag}')
    return dict(tag=tag, commit=c, at=dt.datetime.fromisoformat(d).astimezone(ET))


def iter_tags(h):
    out = []
    for line in git(h, 'for-each-ref', '--format=%(refname:short) %(creatordate:iso-strict)', 'refs/tags/iter-*').splitlines():
        t, d = line.split()
        m = re.fullmatch(r'iter-(\d+)', t)
        if m: out.append(dict(n=int(m.group(1)), tag=t, commit=git(h, 'rev-parse', '--short=7', f'refs/tags/{t}^{{commit}}'), at=dt.datetime.fromisoformat(d).astimezone(ET)))
    return sorted(out, key=lambda x: x['n'])


def fmt_at(t): return t.strftime('%b %-d %H:%M')
def usd(v): return f'${v:,.2f}'


# ---------------- cost to each tag ----------------
_, BYH = load_rows()
GROWS = load_gemini_rows()
def _start(r):
    v = (r.get('start_local') or '').strip()
    for n, f in ((19, '%Y-%m-%d %H:%M:%S'), (16, '%Y-%m-%d %H:%M')):
        try: return dt.datetime.strptime(v[:n], f).replace(tzinfo=ET)
        except ValueError: pass
    return None


def cost_to(h, at):
    if h == 'gemini':
        rs = [r for r in GROWS if r['cost_usd'] is not None and _start(r) and _start(r) <= at]
        tot = sum(r['cost_usd'] for r in rs)
        return dict(total=round(tot, 2), est=round(tot, 2), basis='est.', runs=len(rs), phases=[r['phase'] for r in rs])
    rs = [r for r in BYH[h] if not NONGAME(r) and COUNTED(r) and _start(r) and _start(r) <= at]
    part = lambda b: round(sum(r['cost_usd'] for r in rs if r['basis'] == b), 2)
    return dict(total=round(sum(r['cost_usd'] for r in rs), 2), reported=part('reported'), token_priced=part('token-priced'),
                est=part('est.'), balance=part('measured via balance'), runs=len(rs))


def cost_short(h, c):
    if h == 'gemini': return f'est. {usd(c["total"])} cum.'
    s = f'{usd(c["total"])} cum.'
    if c['est']: s += f' · incl. est. {usd(c["est"])}'
    if c['balance']: s += f' · incl. {usd(c["balance"])} by balance'
    return s


def cost_long(h, c):
    if h == 'gemini':
        return (f'Cost to here: est. {usd(c["total"])} over {c["runs"]} run{"" if c["runs"] == 1 else "s"} (measured tokens × Gemini 4 Argon list price; login-based, not billed).')
    parts = []
    if c['reported']: parts.append(f'{usd(c["reported"])} reported')
    if c['token_priced']: parts.append(f'{usd(c["token_priced"])} token-priced')
    if c['est']: parts.append(f'est. {usd(c["est"])}')
    if c['balance']: parts.append(f'{usd(c["balance"])} measured by balance')
    return f'Cost to here: {usd(c["total"])} over {c["runs"]} game-build run{"" if c["runs"] == 1 else "s"} = ' + ' + '.join(parts) + '.'


# ---------------- capture + derive ----------------
def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def capture(h, ref, commit):
    os.makedirs(RAW, exist_ok=True)
    out = f'{RAW}/{h}-{commit}.png'
    if os.path.exists(out): return out
    tmp = tempfile.mkdtemp(prefix=f'ms-{h}-')
    try:
        arch = subprocess.run(['git', '-C', REPO[h], 'archive', ref], capture_output=True, check=True).stdout
        subprocess.run(['tar', '-x', '-C', tmp], input=arch, check=True)
        port = free_port()
        srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', tmp], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            import time; time.sleep(0.8)
            r = subprocess.run(['flock', LOCK, 'nice', 'node', f'{SITE}/tools/capture_milestone.mjs', f'http://127.0.0.1:{port}/', out + '.tmp.png'],
                               capture_output=True, text=True, timeout=300)
            print(f'  capture {h} {ref} {commit}: {r.stdout.strip()[-400:]}', file=sys.stderr)
            if os.path.exists(out + '.tmp.png'):
                os.replace(out + '.tmp.png', out)
                try: meta = json.loads(r.stdout.strip().splitlines()[-1])
                except Exception: meta = {}
                json.dump(dict(ref=ref, commit=commit, captured=dt.datetime.now(ET).isoformat(timespec='minutes'), **{k: meta.get(k) for k in ('swung', 'canvas', 'hud', 'errors')}),
                          open(out.replace('.png', '.json'), 'w'), indent=1)
        finally: srv.terminate()
    finally: shutil.rmtree(tmp, ignore_errors=True)
    return out if os.path.exists(out) else None


def derive(src, dst_base, widths=(480, 960, 1280), avif=(480, 960)):
    from PIL import Image
    marker = f'{RAW}/.derived/' + os.path.relpath(dst_base, SITE).replace('/', '__') + '.src'   # kept out of the published assets
    os.makedirs(os.path.dirname(marker), exist_ok=True)
    sig = f'{src} {os.path.getmtime(src)}'
    if os.path.exists(marker) and open(marker).read() == sig and all(os.path.exists(f'{dst_base}-{w}.webp') for w in widths): return
    os.makedirs(os.path.dirname(dst_base), exist_ok=True)
    im = Image.open(src).convert('RGB')
    for w in widths:
        t = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        t.save(f'{dst_base}-{w}.webp', 'WEBP', quality=78 if w < 1280 else 80, method=6)
        if w in avif: t.save(f'{dst_base}-{w}.avif', 'AVIF', quality=55)
    open(marker, 'w').write(sig)


def grey_sig(p):
    from PIL import Image
    return list(Image.open(p).convert('L').resize((160, 100)).tobytes())


# ---------------- model ----------------
def build(capture_for):
    data = dict(generated=dt.datetime.now(ET).strftime('%Y-%m-%d %H:%M %Z'), rows=[dict(key=k, label=l, tag=t, desc=d) for k, l, t, d, _ in ROWS],
                harness={}, note='Cost = cumulative game-build runs that started before the tag (play-site and channel-art runs excluded). '
                'Reported and token-priced figures are list-price equivalents; est. marks estimated runs; Gemini is always est. (login-based, not billed).')
    newest = None
    for h in HS:
        iters = iter_tags(h)
        cells = {}
        alias = {}  # commit -> iter tag name
        for it in iters: alias.setdefault(it['commit'], it['tag'])
        live_used = False
        for key, label, tag, short, long_ in ROWS:
            ti = tag_info(h, tag)
            if key == 'polish' and h in ('claude', 'deepseek'):
                cells[key] = dict(state='na'); continue
            if not ti:
                if h == 'gemini' and not live_used and key != 'polish':
                    prev = [cells[k] for k, *_ in ROWS if k in cells and cells[k].get('at')]
                    last_at = max((dt.datetime.fromisoformat(c['at']) for c in prev), default=None)
                    newest_it = iters[-1] if iters else None
                    if newest_it and (last_at is None or newest_it['at'] > last_at):
                        ti = dict(tag=newest_it['tag'], commit=newest_it['commit'], at=newest_it['at']); live_used = True
                        cells[key] = dict(state='live', **_cell(h, key, ti, alias, capture_for, live=True)); continue
                cells[key] = dict(state='todo'); continue
            cells[key] = dict(state='ok', **_cell(h, key, ti, alias, capture_for))
            if newest is None or ti['at'] > newest: newest = ti['at']
        film = []
        prev_sig = None
        for it in iters:
            src = f'{CH}/reports/{h}-iter-{it["n"]}.png'
            if not os.path.exists(src): continue
            derive(src, f'{SITE}/assets/milestones/{h}/iter-{it["n"]}', widths=(480, 960), avif=())
            sig = grey_sig(src)
            same = prev_sig is not None and sum(abs(a - b) for a, b in zip(sig, prev_sig)) / len(sig) < 0.5
            prev_sig = sig
            film.append(dict(n=it['n'], tag=it['tag'], commit=it['commit'], at=it['at'].isoformat(), at_text=fmt_at(it['at']), same_as_prev=same,
                             img=f'assets/milestones/{h}/iter-{it["n"]}'))
        data['harness'][h] = dict(name=NAME[h], cells=cells, iterations=film, iter_tags=len(iters))
    data['latest_at'] = newest.isoformat() if newest else None
    return data


def _cell(h, key, ti, alias, capture_for, live=False):
    it = alias.get(ti['commit'])
    c = cost_to(h, ti['at'])
    raw = f'{RAW}/{h}-{ti["commit"]}.png'
    if not os.path.exists(raw) and (capture_for is None or h in capture_for):
        raw = capture(h, f'refs/tags/{ti["tag"]}', ti['commit']) or raw
    img = None
    if os.path.exists(raw):
        derive(raw, f'{SITE}/assets/milestones/{h}/{key}')
        img = f'assets/milestones/{h}/{key}'
    meta = {}
    try: meta = json.load(open(raw.replace('.png', '.json')))
    except Exception: pass
    hud = (meta.get('hud') or {})
    gem_logged = h != 'gemini' or any(p.split()[0] == ti['tag'] for p in c.get('phases', []))
    return dict(tag=ti['tag'], iter=(it if it and it != ti['tag'] else None), commit=ti['commit'], at=ti['at'].isoformat(), at_text=fmt_at(ti['at']),
                cost=c, cost_short=(cost_short(h, c) if gem_logged else f'est. {usd(c["total"])} logged so far'), cost_long=cost_long(h, c),
                img=img, hud_min_px=hud.get('min'), hud_small=bool(hud.get('min') is not None and hud['min'] < 16), live=live)


# ---------------- HTML ----------------
def label_of(cell):
    t = cell['tag'] + (f' · {cell["iter"]}' if cell.get('iter') else '')
    return f'latest · {t} (in progress)' if cell.get('live') else t


def alt_of(h, key, cell):
    what = 'newest build, in progress' if cell.get('live') else ROWD[key][1]
    return f'{NAME[h]}, {what} ({label_of(cell).replace("latest · ", "").replace(" (in progress)", "")}): in-game frame just after a chop, captured at 1280×800 with software rendering.'


def picture(cell, h, key, pre, sizes, big=False):
    b = pre + cell['img']
    return (f'<picture><source type="image/avif" srcset="{b}-480.avif 480w, {b}-960.avif 960w" sizes="{sizes}">'
            f'<img src="{b}-{960 if big else 480}.webp" srcset="{b}-480.webp 480w, {b}-960.webp 960w" sizes="{sizes}" width="{960 if big else 480}" height="{600 if big else 300}" '
            f'loading="lazy" decoding="async" alt="{E(alt_of(h, key, cell))}"></picture>')


def chip(cell):
    return '<span class="chip chip--live">In progress</span>' if cell.get('live') else ''


def lb_attrs(h, key, cell, pre):
    cap = f'{NAME[h]} · {ROWD[key][1]} · {label_of(cell)} · {cell["commit"]} · {cell["at_text"]} ET. {cell["cost_long"]}'
    if cell['hud_small']: cap += f' Some on-screen text in this frame is under 16 px (smallest {cell["hud_min_px"]:g} px).'
    return (f'data-h="{h}" data-row="{key}" data-full="{pre}{cell["img"]}-1280.webp" data-alt="{E(alt_of(h, key, cell))}" data-cap="{E(cap)}"')


def grid_cell(h, key, cell, pre):
    st = cell['state']
    if st == 'na':
        return '<div class="shot shot--empty shot--na"><b>No polish pass</b><span>Only Codex got an extra pass</span></div>'
    if st == 'todo':
        return f'<div class="shot shot--empty"><b>Not started</b><span>{NAME[h]} has not reached this milestone yet</span></div>'
    if not cell['img']:
        return f'<div class="shot shot--empty"><b>{E(label_of(cell))}</b><span>Screenshot not captured yet</span></div>'
    hud = f'<br><span class="shot__hud">Text under 16 px ({cell["hud_min_px"]:g} px)</span>' if cell['hud_small'] else ''
    return (f'<figure class="shot" {lb_attrs(h, key, cell, pre)}><button class="shot__open" type="button" aria-label="Enlarge {E(NAME[h])} {E(ROWD[key][1])}">'
            f'{picture(cell, h, key, pre, "(max-width: 720px) 92vw, 240px")}</button>'
            f'<figcaption><span class="sr-only">{NAME[h]}, {E(ROWD[key][1])}: </span><b>{E(label_of(cell))}</b> {chip(cell)}<br><span class="mono">{cell["commit"]}</span> · '
            f'<time datetime="{cell["at"]}">{cell["at_text"]}</time><br><span class="shot__cost">{E(cell["cost_short"])}</span>{hud}</figcaption></figure>')


def render_page(data, pre='../'):
    H = data['harness']
    o = ['<div class="ms-toolbar"><div class="seg" role="group" aria-label="Layout">'
         '<button type="button" data-view="grid" aria-pressed="true">Compare harnesses</button><button type="button" data-view="harness" aria-pressed="false">One harness</button></div>'
         '<p class="ms-legend">Cost = cumulative game-build runs to that tag; list-price equivalent, <strong>est.</strong> where estimated. Click a shot to enlarge it.</p></div>']
    # grid
    o.append('<div class="ms-grid" id="ms-grid"><div class="ms-grid__corner" aria-hidden="true"></div>')
    for h in HS:
        wip = ' <span class="chip chip--live">In progress</span>' if h == 'gemini' else ''
        o.append(f'<div class="ms-grid__h" style="--hc:var(--h-{h})" aria-hidden="true">{NAME[h]}{wip}</div>')
    for key, label, tag, short, _ in ROWS:
        o.append(f'<div class="ms-grid__m"><h3>{E(label)}</h3><p>{E(short)}</p></div>')
        for h in HS: o.append(grid_cell(h, key, H[h]['cells'][key], pre))
    o.append('</div>')
    # harness tabs + timelines
    o.append('<div class="ms-tabs" role="tablist" aria-label="Harness">' + ''.join(
        f'<button type="button" role="tab" id="tab-{h}" aria-controls="tl-{h}" aria-selected="{"true" if h == "codex" else "false"}" style="--hc:var(--h-{h})">{NAME[h]}{" · WIP" if h == "gemini" else ""}</button>' for h in HS) + '</div>')
    for h in HS:
        hd = H[h]
        o.append(f'<section class="ms-tl" id="tl-{h}" role="tabpanel" aria-labelledby="tab-{h}" style="--hc:var(--h-{h})"><h2 class="ms-tl__title">{NAME[h]}</h2><ol class="tl">')
        for key, label, tag, short, long_ in ROWS:
            c = hd['cells'][key]
            if c['state'] == 'na': continue
            if c['state'] == 'todo':
                o.append(f'<li class="tl__todo"><div class="tl__when">{E(label)}</div><p class="tl__none">Not started yet.</p></li>'); continue
            hud = (f' <span class="shot__hud">Some on-screen text in this frame is under 16 px (smallest {c["hud_min_px"]:g} px).</span>' if c['hud_small'] else '')
            img = (f'<button class="shot__open" type="button" aria-label="Enlarge {NAME[h]} {E(label)}">{picture(c, h, key, pre, "(max-width: 720px) 92vw, 640px", big=True)}</button>' if c['img'] else '')
            o.append(f'<li><div class="tl__when"><time datetime="{c["at"]}">{c["at_text"]}</time> · {E(label)}</div>'
                     f'<figure class="shot shot--tl" {lb_attrs(h, key, c, pre) if c["img"] else ""}>{img}<figcaption><b>{E(label_of(c))}</b> {chip(c)} · <span class="mono">{c["commit"]}</span><br>'
                     f'{E(long_ if not c.get("live") else "The newest tagged build so far. Gemini is still working through the same prompts.")} {E(c["cost_long"])}{hud}</figcaption></figure></li>')
        o.append('</ol>')
        film = hd['iterations']
        if film:
            o.append(f'<details class="film"><summary>Show all {len(film)} iteration shots</summary><p class="fine">The driver’s own capture after each <span class="mono">iter-N</span> tag (1280×800, software rendering). '
                     f'{"Not every tag has one: tags that are milestones above use the milestone shot. " if len(film) < hd["iter_tags"] else ""}Click one to enlarge it.</p><ol class="film__strip">')
            for f in film:
                same = ' <span class="film__same">no visible change in this frame</span>' if f['same_as_prev'] else ''
                cap = f'{NAME[h]} · {f["tag"]} · {f["commit"]} · {f["at_text"]} ET (driver capture after the tag)'
                o.append(f'<li><figure class="shot shot--film" data-h="{h}" data-row="film" data-full="{pre}{f["img"]}-960.webp" data-alt="{E(NAME[h])} {f["tag"]} screenshot" data-cap="{E(cap)}">'
                         f'<button class="shot__open" type="button" aria-label="Enlarge {NAME[h]} {f["tag"]}"><img src="{pre}{f["img"]}-480.webp" width="480" height="300" loading="lazy" decoding="async" alt="{E(NAME[h])} {f["tag"]}: driver capture after the tag."></button>'
                         f'<figcaption><b>{f["tag"]}</b> · <span class="mono">{f["commit"]}</span><br><time datetime="{f["at"]}">{f["at_text"]}</time>{same}</figcaption></figure></li>')
            o.append('</ol></details>')
        o.append('</section>')
    o.append('<dialog class="lightbox" id="lightbox" aria-label="Screenshot viewer"><div class="lightbox__in">'
             '<div class="lightbox__bar"><p class="lightbox__count" aria-live="polite"></p><button type="button" class="btn btn--ghost lightbox__x" data-lb="close">Close</button></div>'
             '<div class="lightbox__stage"><img class="lightbox__img" alt=""><img class="lightbox__cmp" alt="" hidden></div>'
             '<div class="lightbox__cmpctl" hidden><label><span class="lightbox__cmplabel">Compare</span> <input type="range" min="0" max="100" value="50" class="lightbox__range"></label></div>'
             '<p class="lightbox__cap"></p>'
             '<div class="lightbox__nav"><button type="button" class="btn btn--ghost" data-lb="prev">← Prev</button><button type="button" class="btn btn--ghost lightbox__cmpbtn" data-lb="compare" aria-pressed="false">Compare with previous milestone</button><button type="button" class="btn btn--ghost" data-lb="next">Next →</button></div>'
             '</div></dialog>')
    return '\n'.join(o)


def render_teaser(data, pre=''):
    H = data['harness']['codex']['cells']
    figs = []
    for key, label, *_ in ROWS:
        c = H[key]
        if c['state'] != 'ok' or not c['img']: continue
        figs.append(f'<li><a href="milestones/?view=harness&amp;h=codex"><img src="{pre}{c["img"]}-480.webp" width="480" height="300" loading="lazy" decoding="async" alt="{E(alt_of("codex", key, c))}"></a><span>{E(label)}</span></li>')
    return '<ol class="strip" aria-label="Codex, milestone by milestone">' + ''.join(figs) + '</ol>'


def put(path, name, frag):
    s = open(path).read()
    start, end = f'<!-- {name} START', f'<!-- {name} END -->'
    assert start in s, f'{name} markers missing in {path}'
    s = re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda m: f'{start} (generated by tools/build_milestones.py) -->\n{frag}\n{end}', s, flags=re.S)
    open(path, 'w').write(s)


if __name__ == '__main__':
    cap = '--capture' in sys.argv
    only = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
    capture_for = (only or HS) if cap else []
    data = build(capture_for)
    json.dump(data, open(f'{SITE}/data/milestones.json', 'w'), indent=1, default=str)
    put(f'{SITE}/milestones/index.html', 'MILESTONES', render_page(data))
    put(HOME, 'MILESTONES-TEASER', rebase(render_teaser(data), HOME_ROOT))
    for h in HS:
        cs = data['harness'][h]['cells']
        print(h, ' | '.join(f'{k}:{c["state"]}' + (f' {c["tag"]} {c["commit"]} {c["cost_short"]}' + ('' if c['img'] else ' NO-IMG') if c['state'] in ('ok', 'live') else '') for k, c in cs.items()))
