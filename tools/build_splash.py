#!/usr/bin/env python3
"""Splash page at the site root (index.html): the brand, the intro video, the Round Two review in short (score, category bars and verdict
per reviewed harness) and a big button into the main page at home/. The review content is read from results/index.html (the
<article class="review"> blocks and the review video caption), so the splash never drifts from the Results page. Gemini 4 Argon's card
reads data/gemini.json (written by tools/build_blog.py, which runs this script at its end). Old one-page deep links (/#play, /#coop,
/#reviews …) are forwarded to home/ by a tiny head script; home's site.js then forwards the ones that moved to other pages.
Run: python3 tools/build_splash.py (idempotent; writes the whole file)."""
import html, json, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sitepaths import SITE, SPLASH
E = html.escape
H = ['codex', 'claude', 'deepseek']
NAME = {'codex': 'Codex', 'claude': 'Claude', 'deepseek': 'DeepSeek', 'gemini': 'Gemini'}
ICON = {'Gameplay': 'icon-gameplay', 'Graphics': 'icon-graphics', 'Physics': 'icon-physics'}


def strip(s): return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s)).strip()


def one(pat, s, what):
    m = re.search(pat, s, re.S)
    assert m, f'build_splash: {what} not found in results/index.html'
    return m.group(1)


res = open(f'{SITE}/results/index.html').read()
reviews = {}
for h in H:
    a = one(rf'(<article class="review" id="review-{h}".*?</article>)', res, f'review-{h}')
    reviews[h] = dict(
        kicker=strip(one(r'<p class="kicker">(.*?)</p>', a, f'{h} kicker')),
        title=strip(one(r'<h3 id="rv-\w+">(.*?)</h3>', a, f'{h} title')),
        verdict=strip(one(r'<p class="review__verdict">(.*?)</p>', a, f'{h} verdict')),
        score=strip(one(r'<span class="bigscore__num">(.*?)</span>', a, f'{h} score')),
        word=strip(one(r'<span class="bigscore__word">(.*?)</span>', a, f'{h} word')),
        cats=[(strip(n), strip(v)) for n, v in re.findall(r'<dt>.*?>([^<>]+)</dt><dd>.*?<b>(.*?)</b>', one(r'<dl class="cats">(.*?)</dl>', a, f'{h} cats'))])
    assert len(reviews[h]['cats']) == 3, (h, reviews[h]['cats'])
rv_cap = strip(one(r'chopperman-review-v2-small\.mp4.*?<p class="video__cap">(.*?)</p>', res, 'review video caption'))
rv_len = (re.search(r'\b(\d+:\d\d)\b', rv_cap) or [None, ''])[1]
one(r'<p class="flag flag--wide"><strong>What was reviewed:</strong>(.*?)</p>', res, 'What was reviewed flag')  # the Results page says the same

try: gem = json.load(open(f'{SITE}/data/gemini.json'))
except Exception: gem = {}
g_play = gem.get('playable') or {}
g_rounds = ', '.join(gem.get('finished_rounds') or []) or 'none yet'
g_build = f'<span class="mono">{E(g_play["commit"])} · {E(g_play["tag"])}</span>' if g_play.get('commit') else 'not playable yet'
g_cost = f'est. ${gem["cost_usd_est"]:.2f}' if gem.get('cost_usd_est') is not None else None

PLAY_SVG = '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 3 L17 10 L5 17 Z"/></svg>'


def card(h):
    r = reviews[h]
    cats = ''.join(f'<div><dt><img src="assets/brand/{ICON.get(n, "icon-gameplay")}.svg" alt="" width="24" height="24">{E(n)}</dt><dd><span class="bar" style="--v:{E(v)}"></span><b>{E(v)}</b></dd></div>' for n, v in r['cats'])
    return f'''<article class="scard" style="--hc:var(--h-{h})" aria-labelledby="sc-{h}">
        <header class="scard__head">
          <div>
            <h3 class="scard__who" id="sc-{h}">{NAME[h]}</h3>
            <p class="scard__title">{E(r["title"])}</p>
          </div>
          <div class="bigscore scard__score" style="--s:{E(r["score"])}"><span class="bigscore__num">{E(r["score"])}</span><span class="bigscore__word">{E(r["word"])}</span><span class="sr-only">out of 10</span></div>
        </header>
        <p class="scard__verdict">{E(r["verdict"])}</p>
        <dl class="cats scard__cats">{cats}</dl>
        <p class="scard__meta">Reviewed build: {E(r["kicker"])}</p>
        <p class="scard__links"><a href="results/#review-{h}">Full review<span class="sr-only"> of {NAME[h]}</span></a><a href="{h}/">Play {NAME[h]}</a></p>
      </article>'''


gcard = f'''<article class="scard scard--wip" style="--hc:var(--h-gemini)" aria-labelledby="sc-gemini">
        <header class="scard__head">
          <div>
            <h3 class="scard__who" id="sc-gemini">Gemini 4 Argon</h3>
            <p class="scard__title">Not reviewed yet</p>
          </div>
        </header>
        <p class="scard__wip"><span class="chip chip--live">In progress</span></p>
        <p class="scard__verdict">Joined later and still being built, so there is no score yet. It gets the same prompts in the same order as the other three.</p>
        <p class="scard__meta">Newest build: {g_build}. Finished rounds: {E(g_rounds)}.{(" Cost so far: <strong>" + E(g_cost) + "</strong> (login-based, not billed).") if g_cost else ""}</p>
        <p class="scard__links"><a href="milestones/?view=harness&amp;h=gemini">See its progress</a><a href="gemini/">Play latest<span class="sr-only"> Gemini build</span></a></p>
      </article>'''

DESC = ('One brief, four AI coding harnesses: Codex, Claude Code, DeepSeek and Gemini 4 Argon each build the same backyard axe-chopping browser game '
        '(Gemini’s is still in progress). Watch the intro, see how the Grain &amp; Gravity review scored them, then play the games.')
SPLASH_IDS = ['main', 'enter', 'watch', 'reviews-in-short']  # anchors on the splash itself; every other hash belongs to the main page

page = f'''<!doctype html>
<html lang="en" data-root="" data-page="splash">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- generated by tools/build_splash.py: edit that script, not this file -->
<script>/* old one-page deep links (/#play, /#coop, /#reviews …) live on the main page now */(function(l){{var h=l.hash.slice(1);if(h&&{json.dumps(SPLASH_IDS)}.indexOf(decodeURIComponent(h))<0)l.replace("home/"+l.search+l.hash)}})(location)</script>
<title>Chopperman: four AI harnesses, one backyard axe game</title>
<meta name="description" content="{DESC}">
<meta name="theme-color" content="#1A1410">
<meta property="og:type" content="website">
<meta property="og:title" content="Chopperman: four AI harnesses, one backyard axe game">
<meta property="og:description" content="{DESC}">
<meta property="og:image" content="assets/brand/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/brand/favicon.svg" type="image/svg+xml">
<link rel="preload" href="assets/fonts/web/SourceSans3-VariableFont_wght.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/web/AlfaSlabOne-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/site.css">
</head>
<body class="splash">
<a class="skip" href="#main">Skip to content</a>
<main id="main">
<section class="hero splash__hero" aria-labelledby="splash-title">
  <img class="hero__art" src="assets/art/web/hero-1440.webp" srcset="assets/art/web/hero-960.webp 960w, assets/art/web/hero-1440.webp 1440w, assets/art/hero_wide.webp 1920w" sizes="100vw" alt="Illustration: Sergey, the lumberjack, in a black tee mid-swing, splitting a log on a stump in a sunlit golden forest, wood chips flying." width="1920" height="1080" fetchpriority="high">
  <div class="hero__chips" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="wrap hero__inner">
    <div class="hero__copy">
      <h1 id="splash-title" class="hero__logo"><img src="assets/brand/logo.svg" alt="Chopperman" width="1200" height="340"></h1>
      <p class="hero__pitch">One brief, four AI coding harnesses: Codex, Claude Code, DeepSeek and Gemini 4 Argon. Each builds the same backyard axe game. Gemini’s is still being built.</p>
      <p class="splash__go" id="enter"><a class="btn btn--play btn--cta splash__enter" href="home/">{PLAY_SVG}Enter the yard</a></p>
      <p class="splash__skip"><a href="#watch">Watch the intro</a><a href="#reviews-in-short">See the review scores</a></p>
    </div>
  </div>
</section>

<section class="section splash__watch" id="watch" aria-labelledby="watch-title">
  <div class="wrap introcard">
    <div>
      <p class="kicker">Watch</p>
      <h2 id="watch-title">Quick intro</h2>
      <p>A short tour of Chopperman: meet Sergey and see the Assets v2 games by Codex, Claude Code and DeepSeek. The video was made before Gemini 4 Argon joined, so its game is not in it.</p>
      <p>It starts only when you press play, and the sound is yours to turn on.</p>
    </div>
    <div class="video">
      <video controls preload="none" playsinline poster="assets/video/chopperman-intro-poster.jpg" width="1280" height="720">
        <source src="assets/video/chopperman-intro-web.mp4" type="video/mp4">
        Your browser can’t play this video. <a href="assets/video/chopperman-intro-web.mp4">Download the MP4</a>.
      </video>
      <p class="video__cap">Quick intro · meet Sergey and the Codex, Claude Code and DeepSeek Assets v2 games (made before Gemini 4 Argon joined).</p>
    </div>
  </div>
</section>

<section class="section section--alt section--teeth section--rings splash__reviews" id="reviews-in-short" aria-labelledby="rs-title">
  <div class="wrap">
    <p class="kicker">Grain &amp; Gravity · Round Two</p>
    <h2 id="rs-title">What the review said</h2>
    <p class="lede">An IGN-style video review: about five minutes of play per game, scored out of 10 on gameplay, graphics and physics.</p>
    <p class="flag flag--wide"><strong>What was reviewed:</strong> these scores are for earlier <strong>classic (pre-assets)</strong> snapshots of the Codex, Claude Code and DeepSeek games. Their Assets v2, polish and co-op builds have not been reviewed or scored, and Gemini 4 Argon is still being built.</p>
    <div class="scards">
      {card("codex")}
      {card("claude")}
      {card("deepseek")}
      {gcard}
    </div>
    <p class="btnrow"><a class="btn btn--ghost" href="results/#reviews">{PLAY_SVG}Watch the full Round Two review{(" (" + rv_len + ")") if rv_len else ""}</a><a class="btn btn--ghost" href="results/#scores">The full scoreboard</a></p>
  </div>
</section>

<section class="section splash__end" aria-labelledby="end-title">
  <div class="wrap">
    <h2 id="end-title">Pick up the axe</h2>
    <p class="lede">The main site has all four games (solo or two-player co-op with voice chat), every milestone side by side, the reviews and what each build cost.</p>
    <p class="splash__go"><a class="btn btn--play btn--cta splash__enter" href="home/">{PLAY_SVG}Go to the site</a></p>
    <p class="splash__quick">Or play one right now: <a href="codex/">Codex</a><a href="claude/">Claude</a><a href="deepseek/">DeepSeek</a><a href="gemini/">Gemini (in progress)</a></p>
  </div>
</section>
</main>
<footer class="splash__foot">
  <div class="wrap">
    <p class="fine">Chopperman is an experiment comparing four AI coding harnesses: Codex CLI, Claude Code, the DeepSeek Harness and Gemini 4 Argon. Reviews by the Grain &amp; Gravity channel. Logo, illustrations and site design by Claude; the key art of Sergey is AI-generated (GPT) illustration. <a href="home/#about">About this site</a></p>
  </div>
</footer>
</body>
</html>
'''
open(SPLASH, 'w').write(page)
print('splash written:', os.path.relpath(SPLASH, SITE), '| reviews:', ', '.join(f'{h} {reviews[h]["score"]}' for h in H), '| gemini:', g_play.get('tag') or 'not playable')
