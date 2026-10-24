#!/usr/bin/env python3
"""Shared page chrome for the four site pages (/, /milestones/, /results/, /cost/): the head init script, the top bar with its
mobile Menu sheet, the What's-new ribbon (from data/news.json) and the footer. Writes between the CHROME-INIT / CHROME-HEAD / CHROME-FOOT
markers in each page, so a nav or footer change is made once here. Run: python3 tools/build_chrome.py (idempotent)."""
import html, json, os, re
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = html.escape
PAGES = {'home': ('index.html', ''), 'milestones': ('milestones/index.html', '../'), 'results': ('results/index.html', '../'), 'cost': ('cost/index.html', '../')}
NAV = [  # key, label, href (from the site root), sheet sub-label
    ('play', 'Play', '#play', '4 games · v2, co-op, classic'),
    ('milestones', 'Milestones', 'milestones/', 'v1 → co-op, per harness'),
    ('results', 'Results', 'results/', 'scores · reviews'),
    ('cost', 'Cost &amp; log', 'cost/', 'what it cost, every run'),
    ('about', 'About', None, 'what this is'),
]
QUICK = [('codex', 'Codex', 'btn--play'), ('claude', 'Claude', 'btn--play'), ('deepseek', 'DeepSeek', 'btn--play'), ('gemini', 'Gemini · WIP', 'btn--ghost')]
news = json.load(open(f'{SITE}/data/news.json'))


def init(root):
    # hide a dismissed or expired ribbon before first paint; mark JS on
    return ('<script>(function(d){d.classList.add("js");try{var n=' + json.dumps({'id': news['id'], 'until': news.get('until')}) +
            ';if(localStorage.getItem("cm-news")===n.id||(n.until&&new Date()>new Date(n.until+"T23:59:59")))d.classList.add("news-off")}catch(e){}})(document.documentElement)</script>')


def head(page, root):
    items = ''
    for k, label, href, _ in NAV:
        url = '#about' if href is None else root + href
        cur = ' aria-current="page"' if k == page else ''
        dot = '<span class="dot" hidden><span class="sr-only"> (new milestone)</span></span>' if k == 'milestones' else ''
        items += f'<li><a href="{url}" data-nav="{k}"{cur}>{label}{dot}</a></li>'
    sheet = ''.join(f'<li><a href="{"#about" if href is None else root + href}"{" aria-current=\"page\"" if k == page else ""}>{label} <small>{E(sub)}</small></a></li>' for k, label, href, sub in NAV)
    quick = ''.join(f'<a class="btn {cls}" href="{root}{h}/">{E(n)}</a>' for h, n, cls in QUICK)
    nhref = root + news['href'] if news['href'].startswith('#') else root + news['href']
    return f'''<a class="skip" href="#main">Skip to content</a>
<header class="topbar" id="topbar">
  <div class="wrap topbar__inner">
    <a class="brandlink" href="{root or './'}"><img src="{root}assets/brand/logo-mark.svg" alt="" width="40" height="40"><span>Chopperman</span><span class="sr-only">, home</span></a>
    <nav aria-label="Main"><ul class="nav">{items}</ul></nav>
    <button class="btn btn--ghost menubtn" type="button" aria-expanded="false" aria-controls="sheet"><span aria-hidden="true" class="menubtn__i">☰</span> <span class="menubtn__t">Menu</span></button>
  </div>
  <div class="sheet" id="sheet" hidden>
    <nav aria-label="Menu"><ul class="sheet__nav">{sheet}</ul></nav>
    <p class="kicker">Quick play</p>
    <div class="sheet__play">{quick}</div>
  </div>
</header>
<div class="ribbon" role="region" aria-label="What’s new" data-news="{E(news['id'])}">
  <div class="wrap ribbon__in"><b class="ribbon__chip">New</b><p><span class="ribbon__long">{E(news['text'])}</span><span class="ribbon__short">{E(news['text_short'])}</span> <a href="{nhref}">{E(news['link_text'])}</a></p><button class="ribbon__x" type="button" aria-label="Dismiss this news">×</button></div>
</div>'''


def foot(page, root):
    play = ''.join(f'<li><a class="btn btn--ghost" href="{root}{h}/">Play {n}{" (in progress)" if h == "gemini" else " v2"}</a></li>' for h, n in [('codex', 'Codex'), ('claude', 'Claude'), ('deepseek', 'DeepSeek'), ('gemini', 'Gemini')])
    classic = ' · '.join(f'<a href="{root}classic/{h}/">{n}</a>' for h, n in [('codex', 'Codex'), ('claude', 'Claude'), ('deepseek', 'DeepSeek')])
    return f'''<footer class="footer" id="about">
  <div class="wrap footer__inner">
    <div class="footer__brand"><img src="{root}assets/brand/logo-mark.svg" alt="" width="96" height="96"></div>
    <div class="prose">
      <h2 class="h-small">What is this?</h2>
      <p>Chopperman is an experiment comparing AI coding harnesses. Codex CLI, Claude Code and the DeepSeek Harness each got the same brief: build a backyard axe-chopping game for the browser. The three results live side by side here, with their milestones, scores, reviews and build costs. A fourth harness, Gemini 4 Argon, is building the same game from the same prompts now; it is marked in progress wherever it appears.</p>
      <p>The games need <strong>WebGL 2</strong>. A desktop browser with a mouse is recommended. Click inside a game to start its audio. Classic (pre-assets) builds: {classic}.</p>
      <p class="fine">Reviews by the Grain &amp; Gravity channel (“Axe sims, split by the numbers.”). Logo, illustrations and site design by Claude. Screenshots are captures of the games themselves. The key art of Sergey is AI-generated (GPT) illustration.</p>
      <p class="fine" id="refreshed">Last refreshed: <span data-refreshed>see the data files</span>.</p>
    </div>
    <ul class="footer__play" aria-label="Play the games">{play}</ul>
  </div>
</footer>'''


def put(s, name, frag):
    a, b = f'<!-- {name} START', f'<!-- {name} END -->'
    assert a in s, name
    return re.sub(re.escape(a) + r'.*?' + re.escape(b), lambda m: f'{a} (generated by tools/build_chrome.py) -->\n{frag}\n{b}', s, flags=re.S)


for page, (path, root) in PAGES.items():
    p = f'{SITE}/{path}'; s = open(p).read()
    s = put(s, 'CHROME-INIT', init(root)); s = put(s, 'CHROME-HEAD', head(page, root)); s = put(s, 'CHROME-FOOT', foot(page, root))
    open(p, 'w').write(s)
print('chrome written:', ', '.join(v[0] for v in PAGES.values()))
