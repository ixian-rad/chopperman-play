#!/usr/bin/env python3
"""Build the 'Behind the build' blog post from the real logs and inject it into index.html.
Sources: reports/usage.csv, reports/v2-state-*.json, reports/assets-v2-*.log, assets/logs/spend.jsonl,
plus (Gemini 4 Argon, in progress, kept OUT of the reported totals) reports/usage-gemini.csv, reports/gemini-state.json, data/gemini-refs.json, <site>/gemini/BUILD.txt.
Run: python3 tools/build_blog.py  (idempotent: replaces everything between the BLOG markers)."""
import csv, json, html, re, collections, sys, os
CH = '/workspace/chopperman'
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = html.escape
H = ['claude', 'codex', 'deepseek']
NAME = {'claude': 'Claude Code', 'codex': 'Codex CLI', 'deepseek': 'DeepSeek Harness'}

def num(x):
    try: return float(x)
    except: return None
rows = list(csv.DictReader(open(f'{CH}/reports/usage.csv')))
# Co-op / voice rounds (phase 'coop-v1 ...') are logged in usage.csv but those builds are not published on the site yet, so they stay out of the
# published totals until they are merged and shown. Set INCLUDE_COOP=1 to count them (then update the Page canvas wording too).
if not os.environ.get('INCLUDE_COOP'):
    rows = [r for r in rows if not r['phase'].startswith('coop-v1')]
for r in rows:
    for k in ('wall_s', 'input_uncached', 'input_cached', 'cache_write', 'output', 'cost_usd'):
        r[k] = num(r[k])
    b = r['cost_basis'].lower()
    if r['cost_usd'] is None: r['basis'] = 'n/a'
    elif b.startswith('measured'): r['basis'] = 'reported'
    else: r['basis'] = 'token-priced'     # tokens recorded, dollars = tokens x list price (API-equivalent)
    r['est'] = False

# ---- unrecorded runs: estimates, clearly flagged ----
cx = [r for r in rows if r['harness'] == 'codex' and re.fullmatch(r'iter-[1-6]', r['phase'])]
avg = lambda k: sum(r[k] for r in cx) / len(cx)
for r in rows:
    if r['harness'] == 'codex' and r['phase'] == 'iter-7':
        r.update(input_uncached=avg('input_uncached'), input_cached=avg('input_cached'), output=avg('output'),
                 cost_usd=avg('cost_usd'), basis='est.', est=True,
                 note='No turn.completed event was recorded. Tokens and cost are est.: the mean of Codex iter-1 to iter-6.')
    if r['harness'] == 'codex' and r['phase'] == 'v2-aborted':
        r.update(basis='est.', est=True, note='Aborted after 72 s; tokens not recorded. Cost est. under $0.05, not added to totals.')
extra = [
    dict(harness='claude', phase='assets-v2 attempt-3 (first pass, killed)', start_local='2026-10-22 16:24', wall_s=None,
         input_uncached=None, input_cached=None, cache_write=None, output=None, cost_usd=7.15, basis='est.', est=True,
         result='killed mid-run at about 21:14 ET; unverified work saved as WIP commit e02702d',
         note='Tokens not recorded (the run was killed). Cost est. at about the same as the resumed attempt-3 pass ($7.15).'),
    dict(harness='deepseek', phase='assets-v2 attempt-2 (first pass, killed)', start_local='2026-10-22 16:04', wall_s=None,
         input_uncached=None, input_cached=None, cache_write=None, output=None, cost_usd=0.29, basis='measured via balance', est=False,
         result='killed mid-run at about 21:14 ET; unverified work saved as WIP commit b4431ff',
         note='Tokens not recorded. $0.29 is the rise of the driver spend counter (balance based) from $8.0918 at 16:04 to $8.3818 at 21:15.'),
]
byh = {h: [r for r in rows if r['harness'] == h] for h in H}
for e in extra: byh[e['harness']].append(e)

def s(rs, k): return sum((r[k] or 0) for r in rs if not r.get('est') or k == 'cost_usd')
def cost(rs, basis): return sum((r['cost_usd'] or 0) for r in rs if r['basis'] == basis and not (r['harness'] == 'codex' and r['phase'] == 'v2-aborted'))
NONGAME = lambda r: 'site' in r['phase'] or r['phase'] == 'channel-art'
T = {}
for h in H:
    rs = byh[h]; rec = [r for r in rs if r['wall_s'] is not None and r['input_cached'] is not None and not r['est']]
    allrec = [r for r in rows if r['harness'] == h and r['wall_s'] is not None]
    T[h] = dict(
        runs=len([r for r in rows if r['harness'] == h]),
        wall=sum(r['wall_s'] for r in allrec),
        inp=sum(r['input_uncached'] or 0 for r in rec), cached=sum(r['input_cached'] or 0 for r in rec),
        cw=sum(r['cache_write'] or 0 for r in rec), out=sum(r['output'] or 0 for r in rec),
        reported=cost(rs, 'reported'), token=cost(rs, 'token-priced'),
        est=sum(r['cost_usd'] for r in rs if r['basis'] == 'est.' and r['phase'] != 'v2-aborted'),
        measured_bal=sum(r['cost_usd'] for r in rs if r['basis'] == 'measured via balance'),
        nrec=len(rec))
    T[h]['total'] = T[h]['reported'] + T[h]['token'] + T[h]['est'] + T[h]['measured_bal']
claude_site = sum(r['cost_usd'] for r in byh['claude'] if 'site' in r['phase'])
claude_art = sum(r['cost_usd'] for r in byh['claude'] if r['phase'] == 'channel-art')

# ---- asset spend ----
sp = [json.loads(l) for l in open(f'{CH}/assets/logs/spend.jsonl') if l.strip()]
meshy = [r for r in sp if r['api'] == 'meshy']; hf = [r for r in sp if r['api'] == 'higgsfield']
oa = [r for r in sp if r['api'] == 'openai']; cb = [r for r in sp if r['api'].startswith('codex')]
meshy_cr = sum(r['credits'] for r in meshy)
stage = collections.Counter(r['stage'] for r in meshy); stage_cr = collections.defaultdict(int)
for r in meshy: stage_cr[r['stage']] += r['credits']
hf_cr = sum(float(r['est_credits']) for r in hf); hf_usd = sum(float(r['est_usd']) for r in hf)
hf_img = sum(1 for r in hf if 'image-2' in r['endpoint']); hf_vid = sum(1 for r in hf if 'video' in r['endpoint'])
oa_usd = sum(r['cost_usd'] for r in oa); oa_tok = sum(r['usage']['total_tokens'] for r in oa)
cb_est = 0.165 * len(cb)   # per-image API-equivalent noted in the log itself (~$0.165, gpt-image-2 high 1024x1536)
vo = json.load(open('/workspace/recordings/intro/vo/script.json'))
def vo_text(x):
    if isinstance(x, str): return x
    if isinstance(x, dict): return ' '.join(vo_text(v) for k, v in x.items() if k in ('text', 'line', 'vo'))
    return ' '.join(vo_text(i) for i in x)
vo_chars = len(vo_text(vo)); rv_chars = len(open('/workspace/recordings/review-script.md').read())

grand_harness = sum(T[h]['total'] for h in H)
grand_assets = oa_usd + hf_usd + cb_est
grand = grand_harness + grand_assets

# ---- formatting ----
def n(x): return 'n/a' if x is None else f'{int(round(x)):,}'
def usd(x, est=False): return 'n/a' if x is None else (('est. ' if est else '') + f'${x:,.2f}')
def mmss(sec):
    if sec is None: return 'n/a'
    sec = int(sec); h, m = divmod(sec // 60, 60)
    return f'{h}h{m:02d}m' if h else f'{m}m{sec % 60:02d}s'
def hrs(sec): return f'{sec/3600:.2f} h'
def short(t, k=95):
    t = re.sub(r'\s+', ' ', t or '').strip()
    t = re.sub(r"console/page errors:.*", 'console/page errors (software-GL WebGL context)', t)
    return t if len(t) <= k else t[:k].rsplit(' ', 1)[0] + '…'
def cell(v, cls=''): return f'<td class="{cls}">{v}</td>'

# =====================================================================================================
# Gemini 4 Argon (high) via the Antigravity CLI: IN PROGRESS. Login-based, never billed; every dollar is est. (tokens x list price).
# Deliberately NOT part of H / T / grand totals above and not written to data/costs.json (the reported totals stay as they were).
# Re-run this script (tools/refresh_gemini.sh does) to refresh the numbers from usage-gemini.csv + gemini-state.json.
# =====================================================================================================
GEM_NAME = 'Gemini 4 Argon'
def _read(path, default=None):
    try: return open(path).read()
    except Exception: return default
grows = []
try:
    for r in csv.DictReader(open(f'{CH}/reports/usage-gemini.csv')):
        for k in ('wall_s', 'input_uncached', 'input_cached', 'output', 'reasoning', 'cost_usd'): r[k] = num(r.get(k))
        grows.append(r)
except FileNotFoundError: pass
gstate = {}
try: gstate = json.load(open(f'{CH}/reports/gemini-state.json'))
except Exception: pass
grefs = {}
try: grefs = json.load(open(f'{SITE}/data/gemini-refs.json'))
except Exception: pass
def _build(path):
    t = (_read(path) or '').split()
    return dict(commit=t[1], tag=' '.join(t[2:])) if len(t) >= 3 else None
g_live = _build(f'{SITE}/gemini/BUILD.txt'); g_classic = _build(f'{SITE}/classic/gemini/BUILD.txt')
GT = dict(runs=len(grows), wall=sum(r['wall_s'] or 0 for r in grows), inp=sum(r['input_uncached'] or 0 for r in grows), cached=sum(r['input_cached'] or 0 for r in grows),
          out=sum(r['output'] or 0 for r in grows), think=sum(r['reasoning'] or 0 for r in grows), cost=sum(r['cost_usd'] or 0 for r in grows))
GT['per_h'] = GT['cost'] / (GT['wall'] / 3600) if GT['wall'] else None
g_phase = gstate.get('phase') or '?'
g_updated = gstate.get('updated') or 'unknown'
g_done = gstate.get('done') or []
g_assets = bool(g_live and 'assets-v2' in g_live['tag'])
g_title = 'Backyard Wood Splitter'
_m = re.search(r'<title>(.*?)</title>', _read(f'{SITE}/gemini/index.html') or '', re.S)
if _m: g_title = re.sub(r'\s*[·|•\-–—].*$', '', html.unescape(_m.group(1)).strip()) or g_title
G_BASIS = ('Estimate, not a charge. Gemini 4 Argon (high) ran through the Antigravity CLI on a Google login, so nothing was billed. Dollars = measured tokens from the CLI’s own result '
           'usage x the Gemini 4 Argon list price: $2 per million uncached input, $0.10 per million cached input, $10 per million output (thinking included).')
G_DIFFS = [
 'Reviewer notes after v1: the other builds got notes from me playing them. Gemini gets automatic fallback notes unless hand notes were written within 15 minutes of v1 finishing.',
 'One-off hand-driven rounds were not replayed for Gemini: Claude’s channel-art task, DeepSeek’s parallel rounds and Codex’s hull fix.',
 'A failed audio or legibility round was held for review on the other builds. Gemini gets one fix-up run, and the change is reverted if that still fails.',
 'The Assets v2 and co-op briefs say “three different AI coding harnesses” word for word, because the briefs were kept identical.',
 'The classic phase has a wall-clock budget of 6h23m, the same as Claude and Codex had, not the same calendar window. The box restarted at about 06:01 ET on Oct 23 and the loop’s deadline was moved later by the time that was lost.']

def gstat_line():
    if g_live is None: return 'No playable build has been published yet.'
    if g_assets: return f'Now playing: the Assets v2 build ({g_live["commit"]} · {g_live["tag"]}).'
    return (f'Now playing: the classic-phase build {g_live["commit"]} ({g_live["tag"]}), before any 3D assets. The Assets v2 round has not finished yet.')

def gem_blog():
    o = []
    A_ = o.append
    A_('<h3 class="h-mid">A fourth harness: Gemini 4 Argon <span class="tag tag--est">est.</span> <span class="tag tag--est">in progress</span></h3>')
    A_(f'<p class="fine"><strong>In progress, updated as the build continues.</strong> Gemini 4 Argon (high reasoning, through the Antigravity CLI) is building the same game from the same prompts in the same order. '
       f'It is <strong>not included in any total above</strong>. {E(G_BASIS)} Driver state as of {E(g_updated)} ET: phase <span class="mono">{E(g_phase)}</span>. {E(gstat_line())}</p>')
    A_('<div class="tablewrap" role="region" aria-label="Gemini totals, scrollable" tabindex="0"><table class="blogtable"><caption class="sr-only">Gemini totals so far (est.)</caption><thead><tr>'
       '<th scope="col">Harness</th><th scope="col">Runs</th><th scope="col">Agent time</th><th scope="col">Input, uncached</th><th scope="col">Input, cached</th><th scope="col">Output</th><th scope="col">Est. total (USD)</th></tr></thead><tbody>')
    A_('<tr>' + f'<th scope="row">{GEM_NAME}</th>' + cell(str(GT['runs'])) + cell(hrs(GT['wall'])) + cell(n(GT['inp'])) + cell(n(GT['cached'])) + cell(n(GT['out'])) + cell(f'<strong>{usd(GT["cost"], True)}</strong>') + '</tr>')
    A_('</tbody></table></div>')
    A_('<p class="fine">Output includes thinking tokens (' + n(GT['think']) + ' so far). This is a running figure and grows as each round finishes.</p>')
    A_('<details class="blog__runs"><summary>' + f'{GEM_NAME}: {GT["runs"]} logged runs so far, {hrs(GT["wall"])}, {usd(GT["cost"], True)}</summary>')
    A_(f'<div class="tablewrap" role="region" aria-label="{GEM_NAME} runs, scrollable" tabindex="0"><table class="blogtable blogtable--runs"><caption class="sr-only">{GEM_NAME} run log</caption><thead><tr>'
       '<th scope="col">Run</th><th scope="col">Started (ET)</th><th scope="col">Wall</th><th scope="col">Input</th><th scope="col">Cached</th><th scope="col">Output</th><th scope="col">Cost</th><th scope="col">Basis</th><th scope="col">Result</th></tr></thead><tbody>')
    for r in grows:
        res = short((r.get('result') or '') + ((', ' + r['notes']) if r.get('notes') else ''))
        A_('<tr>' + f'<th scope="row">{E(r["phase"])}</th>' + cell(E((r.get('start_local') or '')[5:16])) + cell(mmss(r['wall_s'])) + cell(n(r['input_uncached'])) + cell(n(r['input_cached'])) + cell(n(r['output']))
           + cell(usd(r['cost_usd'], True)) + cell('<span class="tag tag--est">est.</span>') + cell(E(res), 'txt') + '</tr>')
    A_('</tbody></table></div></details>')
    A_('<p class="fine"><strong>Where Gemini’s replay differs from the other three:</strong></p><ul class="blog__list">' + ''.join(f'<li>{E(d)}</li>' for d in G_DIFFS) + '</ul>')
    return '\n'.join(o)

out = []
A = out.append
A('<!-- BLOG START (generated by tools/build_blog.py from reports/usage.csv, v2-state-*.json, spend.jsonl) -->')
A('<section class="section" id="behind-the-build" aria-labelledby="blog-title"><div class="wrap">')
A('<p class="kicker"><img src="assets/brand/icon-cost.svg" alt="" width="28" height="28"> Behind the build</p>')
A('<h2 id="blog-title">How three AI harnesses made Chopperman</h2>')
A('<details class="blog"><summary>Read the build log: totals, every run, and the honest story</summary><div class="blog__body">')
A('<p class="lede">Every number below comes from the project’s own logs. Three kinds of figure appear and they are labelled: '
  '<span class="tag tag--rep">reported</span> by the tool itself, <span class="tag tag--tok">token-priced</span> (recorded token counts times the public list price, an API-equivalent figure), and '
  '<span class="tag tag--est">est.</span> where a run’s tokens were not recorded and I estimated it. Where nothing could be recovered the cell says n/a. All times are US Eastern.</p>')
A('<p class="fine"><strong>What was really billed:</strong> Claude Code and Codex ran on subscription logins, so their dollar figures are list-price equivalents, not charges. '
  f'DeepSeek was pay-as-you-go, and its balance fell by <strong>$8.92</strong> (from $49.66 to $40.74, checked 22:25 on Oct 22, before the last docs run had finished). '
  'The image, 3D and voice services are listed separately below.</p>')

# totals table
A('<h3 class="h-mid">Totals at a glance</h3>')
A('<div class="tablewrap" role="region" aria-label="Totals by harness, scrollable" tabindex="0"><table class="blogtable"><caption class="sr-only">Totals by harness</caption><thead><tr>'
  '<th scope="col">Harness</th><th scope="col">Runs</th><th scope="col">Agent time</th><th scope="col">Input, uncached</th><th scope="col">Input, cached</th><th scope="col">Output</th>'
  '<th scope="col">Reported</th><th scope="col">Token-priced</th><th scope="col">Est.</th><th scope="col">Total (USD)</th></tr></thead><tbody>')
for h in H:
    t = T[h]
    A('<tr>' + f'<th scope="row">{NAME[h]}</th>' + cell(f'{t["runs"]}') + cell(hrs(t['wall'])) + cell(n(t['inp'])) + cell(n(t['cached'])) + cell(n(t['out']))
      + cell(usd(t['reported']) if t['reported'] else '–') + cell(usd(t['token']) if t['token'] else '–')
      + cell(usd(t['est'] + t['measured_bal'], True) if (t['est'] + t['measured_bal']) else '–') + cell(f'<strong>{usd(t["total"])}</strong>') + '</tr>')
tw = sum(T[h]['wall'] for h in H)
A('<tr class="blogtotal"><th scope="row">All three</th>' + cell(str(sum(T[h]['runs'] for h in H))) + cell(hrs(tw)) + cell(n(sum(T[h]['inp'] for h in H))) + cell(n(sum(T[h]['cached'] for h in H)))
  + cell(n(sum(T[h]['out'] for h in H))) + cell(usd(sum(T[h]['reported'] for h in H))) + cell(usd(sum(T[h]['token'] for h in H)))
  + cell(usd(sum(T[h]['est'] + T[h]['measured_bal'] for h in H), True)) + cell(f'<strong>{usd(grand_harness)}</strong>') + '</tr>')
A('</tbody></table></div>')
A(f'<p class="fine">Token columns add up only runs whose tokens were recorded ({sum(T[h]["nrec"] for h in H)} of {sum(T[h]["runs"] for h in H)} runs; the rest are in the “Est.” column or have no tokens). '
  f'Claude also wrote {n(T["claude"]["cw"])} cache-write tokens. Claude’s total includes two play-site design runs ({usd(claude_site)}) and the channel-art kit ({usd(claude_art)}); without the site runs it is {usd(T["claude"]["total"]-claude_site)}. '
  f'DeepSeek’s total is token-priced ({usd(T["deepseek"]["token"])}) plus a $0.29 killed pass read from the balance counter; the measured balance drop was $8.92. '
  f'Codex’s total includes est. {usd(T["codex"]["est"])} for iteration 7, whose token counts were not recorded.</p>')

A('<h3 class="h-mid">Images, 3D models and voice (asset spend)</h3>')
A('<div class="tablewrap" role="region" aria-label="Asset spend, scrollable" tabindex="0"><table class="blogtable"><caption class="sr-only">Asset generation spend</caption><thead><tr>'
  '<th scope="col">Service</th><th scope="col">What it made</th><th scope="col">Amount</th><th scope="col">Basis</th></tr></thead><tbody>')
A(f'<tr><th scope="row">Meshy</th>{cell(f"{len(meshy)} tasks: " + ", ".join(f"{stage[k]} {k}" for k in stage), "txt")}{cell(f"{meshy_cr} credits")}{cell("reported by the API (credits). Dollars not logged: n/a", "txt")}</tr>')
A(f'<tr><th scope="row">Higgsfield</th>{cell(f"{len(hf)} generations: {hf_img} stills (grok-imagine-image 2.0) and {hf_vid} trailer clips (Kling v2.5 turbo)", "txt")}{cell(f"est. {hf_cr:.2f} credits, est. ${hf_usd:.2f}")}{cell("est. from the price table in the spend log", "txt")}</tr>')
A(f'<tr><th scope="row">OpenAI image API</th>{cell(f"{len(oa)} calls (gpt-image-2.5): Sergey views, key art; {oa_tok:,} tokens", "txt")}{cell(f"${oa_usd:.2f}")}{cell("token-priced: usage tokens times published per-token price", "txt")}</tr>')
A(f'<tr><th scope="row">Codex built-in image tool</th>{cell(f"{len(cb)} face-accuracy test images", "txt")}{cell(f"est. ${cb_est:.2f}")}{cell("plan quota, no charge reported; est. at about $0.165 per image as noted in the log", "txt")}</tr>')
A(f'<tr><th scope="row">ElevenLabs</th>{cell(f"Hank Harvey voiceover: intro script about {vo_chars:,} characters, review script about {rv_chars:,} characters", "txt")}{cell("n/a")}{cell("not logged: the voice spend was not recorded, so no dollar figure is given", "txt")}</tr>')
A(f'<tr class="blogtotal"><th scope="row">Dollar-valued assets</th>{cell("OpenAI + Higgsfield + Codex image tool", "txt")}{cell(f"<strong>est. ${grand_assets:.2f}</strong>")}{cell("Meshy and ElevenLabs excluded (no dollars logged)", "txt")}</tr>')
A('</tbody></table></div>')
A(f'<p class="fine"><strong>Grand total, mixed basis:</strong> est. <strong>${grand:,.2f}</strong> = harness runs ${grand_harness:,.2f} + dollar-valued assets est. ${grand_assets:.2f}. '
  'It mixes list-price equivalents with measured spend, so read it as a size estimate, not an invoice. The spend log covers Oct 22 12:44 to Oct 23 00:42 ET.</p>')

# narrative
A('<h3 class="h-mid">The story, in order</h3><div class="prose blog__prose">')
paras = [
 ('Oct 21, the first builds.', 'Claude Code, Codex CLI and the DeepSeek Harness got the same brief at 14:11 ET: a backyard axe-chopping game for the browser in three.js. DeepSeek and Codex had a working v1 in 22 and 17 minutes. Claude’s v1 took 31 minutes and was cut off by an operator error during its final self-test, so it shipped without a README and with the swing stuck in its windup. Two accidental early starts of a second version were aborted and discarded. Round 1 review scores were Codex 3.3, Claude 7.0 and DeepSeek 5.3.'),
 ('Iterations and the Round 2 review.', f'Each harness then ran many improvement passes: Codex iter-1 to iter-10, Claude iter-1 to iter-3 (its iter-2 ran about 2 hours and produced no changes, so it was reverted), and DeepSeek iter-1 to iter-27 including a multi-agent parallel upgrade in three rounds (content, physics, graphics, audio and polish streams). A box restart at 02:13 ET on Oct 22 interrupted several runs and their partial work was kept. In DeepSeek’s third round some streams failed a frame-rate gate against main (for example 1.4, 3.0, 5.8 and 9.8 FPS against 60.2 FPS in software rendering) and were fixed or rejected before merging. Round 2 scores were Codex 8, Claude 7 and DeepSeek 6.'),
 ('Sound, music and the legibility pass.', 'Sound effects and music were added by each harness. A legibility pass followed (Claude iter-3, Codex iter-10, DeepSeek iter-27), after the rule that all in-game and site text must be easy to read: body text at least 16 px, HUD numbers at least 20 px, with AA contrast. Claude Code also designed the channel art and this play site.'),
 ('Archive of the classic builds.', 'Before any new assets went in, each repo got a snapshot tag (snapshot-2026-10-22) and a pre-assets branch, and the classic builds are kept as separate repos and in the site’s /classic/ folders. That keeps the comparison fair.'),
 ('The asset pack and Sergey.', f'The lumberjack is named Sergey and has two costumes, a tee and a blue jacket. The shared pack came from Meshy (props, trees, the shed, fences, axes and the rigged, animated character), Higgsfield (early stills and trailer clips) and GPT image generation. Higgsfield’s faces were a bit inaccurate against the source photos, so Sergey was rebuilt from new GPT front, side and back views, and all key art was redone with GPT. The pack gave each game two settings: a New Jersey backyard and a Tiraspol backyard with a cathedral behind it, plus an upgraded trees pack (tree v2) and four axes.'),
 ('The Assets v2 upgrade.', 'On Oct 22 at 14:37 ET all three harnesses got the identical brief to build the pack into their own games, add walking and let Sergey fell the surrounding trees. All three merged and passed the final automated check in headless Chrome with software rendering and no GPU. The run tables below list every attempt.')]
for h2, p in paras: A(f'<p><strong>{E(h2)}</strong> {E(p)}</p>')
A('</div>')

# v2 results
v2 = json.load(open(f'{SITE}/data/v2.json'))['harness']
st = {h: json.load(open(f'{CH}/reports/v2-state-{h}.json')) for h in H}
A('<h3 class="h-mid">Assets v2 results and the honest issues</h3>')
A('<div class="tablewrap" role="region" aria-label="Assets v2 results, scrollable" tabindex="0"><table class="blogtable"><caption class="sr-only">Assets v2 final results</caption><thead><tr>'
  '<th scope="col">Harness</th><th scope="col">Build attempts</th><th scope="col">FPS NJ low / Tiraspol low / Tiraspol high</th><th scope="col">Hits to fell a tree</th><th scope="col">First load</th><th scope="col">Merged as</th></tr></thead><tbody>')
for h in H:
    d = v2[h]; f = d['fps']
    A(f'<tr><th scope="row">{NAME[h]}</th>{cell(E(d["attempts"]), "txt")}{cell(f"{f['nj_low']} / {f['tiraspol_low']} / {f['tiraspol_high']}")}{cell(str(d["hits_to_fell_nj"]))}{cell(f"{d["load_seconds"]:.1f} s")}{cell(f"{d["commit"]} ({d["iter"]})")}</tr>')
A('</tbody></table></div>')
A('<p class="fine">FPS are software-rendering figures from the final headless-Chrome check on the build machine (Codex: the check after its polish pass, tag polish-1). They are far below what a real graphics card gives, and no real GPU was tested.</p>')
A('<ul class="blog__list">')
items = [
 'Claude needed 3 build attempts. Attempt 2 failed the frame-rate check (4.9 FPS in the New Jersey scene at Low against a minimum of 8). Attempt 3 fixed it (34.6 FPS), and the final check read 45.8 FPS. Attempt 3 was first killed mid-run at about 21:14 ET on Oct 22, then resumed from its saved work.',
 'DeepSeek ran on a hard budget: $10 total with a stop at $9.75, measured by the balance endpoint (it read $8.38 at the Oct 22 restart). Its balance guard hit three SSL handshake timeouts (18:45, 19:53 and 20:51 ET), and attempt 2 was killed mid-run at about 21:14 ET and resumed. Its final merge then looped on a push that failed because the remote already held an identical merge. It was fixed by hand at 23:35 ET.',
 'DeepSeek’s Sergey walking speed appears tied to the frame rate (slower when FPS is low). One of its live checks failed when all three games were tested at once (4.6 FPS) and passed when run alone. Low quality shows only 16 of its 42 trees and its first load takes 10 to 13 seconds.',
 'Claude: Medium and High are real-GPU presets and crawl in software rendering, swings have some foot sliding, and trees do not regrow. Codex: after its extra polish pass, canopies fade out of the camera’s way and falling trees avoid fences and props, but the face, fingers and full-body animation are still approximate.',
 'The v2 builds were not re-reviewed on video. The review scores on this page are for the classic builds.',
 'Codex got one extra polish pass on Oct 23 (00:27 to 01:41 ET, 1h13m, 4,409 s): it fixed the known issues in its own list (camera-blocking canopies, crowns passing through fences, foot sliding, abrupt animation changes, Low-quality speed), added a short hit-stop and a head turn toward the chop target, and merged as polish-1 after the same automated check passed. Its software-rendering FPS went from 30.7 / 22.1 / 6.8 to 49.9 / 36.7 / 14.4, but those readings move a lot with machine load (an earlier docs-run reading of NJ Low was 8.3). The run is counted in the Codex totals below as token-priced, $3.47.',
 'Stops and restarts: the Oct 21 operator aborts, the Oct 22 box restart at 02:13 ET, and the mid-run kills at about 21:14 ET (Claude attempt 3, DeepSeek attempt 2), each resumed from saved work. They all show up in the run tables below.']
for i in items: A(f'<li>{E(i)}</li>')
A('</ul>')

# per harness tables
A('<h3 class="h-mid">Every run, by harness</h3>')
A('<p class="fine">Each table lists every logged run in order. Open one to see it. Cost basis is shown per row: <span class="tag tag--rep">reported</span>, <span class="tag tag--tok">token-priced</span> or <span class="tag tag--est">est.</span>. “Cached” is input served from the prompt cache.</p>')
for h in H:
    t = T[h]; rs = byh[h]
    A(f'<details class="blog__runs"><summary>{NAME[h]}: {t["runs"]} logged runs, {hrs(t["wall"])}, {usd(t["total"])}</summary>')
    A(f'<div class="tablewrap" role="region" aria-label="{NAME[h]} runs, scrollable" tabindex="0"><table class="blogtable blogtable--runs"><caption class="sr-only">{NAME[h]} run log</caption><thead><tr>'
      '<th scope="col">Run</th><th scope="col">Started (ET)</th><th scope="col">Wall</th><th scope="col">Input</th><th scope="col">Cached</th><th scope="col">Output</th><th scope="col">Cost</th><th scope="col">Basis</th><th scope="col">Result</th></tr></thead><tbody>')
    for r in rs:
        est = r.get('est') or r['basis'] == 'est.'
        start = (r.get('start_local') or '')[5:16]
        res = short(r.get('result'))
        if r.get('note'): res += ' [' + short(r['note'], 140) + ']'
        tk = lambda k: ('est. ' if r.get('est') and r[k] is not None else '') + n(r[k])
        basis = r['basis']; bc = {'reported': 'rep', 'token-priced': 'tok'}.get(basis, 'est')
        cost_txt = 'n/a' if r['cost_usd'] is None else (('est. ' if est else '') + f'${r["cost_usd"]:,.2f}')
        if r['phase'] == 'v2-aborted' and r['harness'] == 'codex': cost_txt = 'n/a (est. < $0.05)'
        A('<tr>' + f'<th scope="row">{E(r["phase"])}</th>' + cell(E(start)) + cell(mmss(r['wall_s'])) + cell(tk('input_uncached')) + cell(tk('input_cached')) + cell(tk('output'))
          + cell(cost_txt) + cell(f'<span class="tag tag--{bc}">{E(basis)}</span>') + cell(E(res), 'txt') + '</tr>')
    A('</tbody></table></div></details>')
A(gem_blog())
A(f'<p class="fine">Sources: the project usage log (usage.csv), the Assets v2 state files and logs, the asset spend log, and for Gemini its own usage log (usage-gemini.csv) and state file. Generated by <span class="mono">tools/build_blog.py</span>. No keys or secrets appear in any of them.</p>')
A('</div></details></div></section>')
A('<!-- BLOG END -->')
frag = '\n'.join(out)

p = f'{SITE}/index.html'; s_ = open(p).read()
if '<!-- BLOG START' in s_:
    s_ = re.sub(r'<!-- BLOG START.*?<!-- BLOG END -->', lambda m: frag, s_, flags=re.S)
else:
    assert s_.count('</main>') == 1
    s_ = s_.replace('</main>', frag + '\n</main>')
open(p, 'w').write(s_)


# ---- Gemini card / scoreboard / cost block / classic link, written between markers in index.html (no hand edits needed on refresh) ----
def put_block(doc, name, frag_html, anchor, where='before'):
    start, end = f'<!-- {name} START', f'<!-- {name} END -->'
    block = f'{start} (generated by tools/build_blog.py) -->\n{frag_html}\n{end}' if frag_html else f'{start} (generated by tools/build_blog.py) -->{end}'
    if start in doc:
        return re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda m: block, doc, flags=re.S)
    assert anchor in doc, f'anchor for {name} not found'
    return doc.replace(anchor, (block + '\n' + anchor) if where == 'before' else (anchor + '\n' + block), 1)

def fmtk(v): return f'{v/1e6:.1f}M' if v >= 1e6 else (f'{v/1e3:.1f}k' if v >= 1e3 else str(int(v)))
has_shot = os.path.exists(f'{SITE}/assets/shots/gemini/latest.webp')
est_u = lambda v: 'est. ' + usd(v) if v is not None else 'n/a'
def sbrow(label, val, cls=''): return f'<tr><th scope="row">{label}</th><td class="{cls}">{val}</td></tr>'
shot = ('<a class="card__shot" href="gemini/" tabindex="-1" aria-hidden="true"><img src="assets/shots/gemini/latest.webp" alt="" width="960" height="600" loading="lazy"></a>' if has_shot else '')
cur = f'{g_live["commit"]} · {E(g_live["tag"])}' if g_live else 'not published yet'
play = ('<a class="btn btn--primary" href="gemini/">Play ' + ('v2' if g_assets else 'latest') + '</a>' if g_live else '')
play_c = '<a class="btn btn--ghost" href="classic/gemini/">Play Classic</a>' if g_classic else ''
acts = f'<div class="card__actions card__actions--even">{play}{play_c}</div>' if (play or play_c) else ''
if g_live and not g_assets:
    what = ('This is the classic-phase build (the original brief, before any 3D assets). The Assets v2 round and the co-op and Alex round come next; '
            'when they are published, <span class="mono">/gemini/</span> switches to that build and the classic build moves to <span class="mono">/classic/gemini/</span>.')
elif g_live: what = 'This is the Assets v2 build. Classic and co-op builds are listed as they are published.'
else: what = 'Nothing is playable yet.'
coop_note = ' A co-op branch exists in its repo but is not published here yet.' if grefs.get('coop_branch') else ''
gem_html = f"""<section class="section section--alt" id="gemini" aria-labelledby="gemini-title"><div class="wrap">
<p class="kicker">Fourth harness · in progress</p>
<h2 id="gemini-title">Gemini 4 Argon: still being built</h2>
<p class="flag flag--wide"><strong>In progress, updated as the build continues.</strong> Gemini 4 Argon (high reasoning, through Google’s Antigravity CLI) is building the same game from the same prompts in the same order as the other three, so what you can play here is a snapshot of its latest published build. {what}{coop_note} Its cost figures are <strong>est.</strong> (login-based, never billed) and are kept out of the totals for the other three. Last updated {E(g_updated)} ET.</p>
<div class="gemini-grid">
<article class="card" id="card-gemini">
{shot}
<div class="card__body">
<div class="card__head"><div><p class="card__who">Gemini 4 Argon (high) · Antigravity CLI</p><h3>{E(g_title)}</h3></div></div>
<p class="card__build">Playing now <span class="mono">{cur}</span>{('<br>Classic build <span class="mono">' + g_classic['commit'] + ' · pre-assets (' + E(g_classic['tag']) + ')</span>') if g_classic else ''}</p>
<ul class="tags"><li><span class="tag tag--est">in progress</span></li><li>Not reviewed</li></ul>
<p class="card__note">Not reviewed on video and not scored. Like the other builds it loads three.js from a CDN, so it needs internet access to play. WebGL 2 and a desktop mouse recommended.</p>
{acts}
</div></article>
<div class="tablewrap"><table class="scoreboard" id="sb-gemini">
<caption class="sr-only">Gemini 4 Argon: progress and estimated cost so far</caption>
<colgroup><col class="col-metric"><col></colgroup>
<thead><tr><th scope="col"><span class="sr-only">Metric</span></th><th scope="col"><span class="sb-game">Gemini</span><span class="sb-sub">4 Argon · high</span></th></tr></thead>
<tbody>
<tr class="sb-group"><th scope="rowgroup" colspan="2">Review scores</th></tr>
{sbrow('Gameplay · Graphics · Physics', 'not reviewed', 'small')}
<tr class="sb-group"><th scope="rowgroup" colspan="2">Progress · driver state</th></tr>
{sbrow('Finished rounds', E(', '.join(x for x in g_done if x not in ('repo',))) or 'none yet', 'small')}
{sbrow('Running now', E(g_phase), 'small')}
{sbrow('Playable build', cur, 'small')}
</tbody>
<tbody id="sb-gemini-cost">
<tr class="sb-group"><th scope="rowgroup" colspan="2">What it cost so far · est., not billed</th></tr>
{sbrow('Cost (USD, est.)', est_u(GT['cost']))}
{sbrow('Agent hours', f"{GT['wall'] / 3600:.1f} h")}
{sbrow('Cost per agent hour (est.)', (est_u(GT['per_h']) + '/h') if GT['per_h'] else 'n/a')}
{sbrow('Tokens in (uncached + cached)', f"{fmtk(GT['inp'])} + {fmtk(GT['cached'])}", 'small')}
{sbrow('Tokens out (incl. thinking)', fmtk(GT['out']), 'small')}
</tbody></table></div>
</div>
<p class="fine">{E(G_BASIS)} Full run table and the ways this replay differs from the others are in <a href="#behind-the-build">Behind the build</a>.</p>
</div></section>"""

s_ = open(f'{SITE}/index.html').read()
s_ = put_block(s_, 'GEMINI', gem_html, '<!-- ============================== CLASSIC', 'before')
# anchor above is a comment line starting with that text: make sure we inserted before the whole comment line
cl_html = (f'<li><a class="btn btn--ghost" href="classic/gemini/">Classic Gemini</a> <span class="card__build">{E(g_title)} · <span class="mono">{g_classic["commit"]} · pre-assets ({E(g_classic["tag"])})</span> '
           f'<span class="tag tag--est">in progress</span></span></li>') if g_classic else ''
s_ = put_block(s_, 'GEMINI-CLASSIC', cl_html, '</ul>\n  </div>\n</section>\n\n<!-- ============================== SCORES', 'before') if '<!-- GEMINI-CLASSIC START' not in s_ else put_block(s_, 'GEMINI-CLASSIC', cl_html, '', 'before')
sc_note = (f'<p class="fine">A fourth harness, <a href="#gemini">Gemini 4 Argon</a>, is still being built and is not reviewed or scored. Its progress and est. cost are in <a href="#gemini">its own section</a>, kept apart from this table.</p>')
s_ = put_block(s_, 'GEMINI-SCORES-NOTE', sc_note, 'See <a href="#cost">the cost section</a> for the split per harness.</p>', 'after') if '<!-- GEMINI-SCORES-NOTE START' not in s_ else put_block(s_, 'GEMINI-SCORES-NOTE', sc_note, '', 'before')
co_note = (f'<p class="fine">Gemini 4 Argon is not in this table or its totals: it is still being built, and its dollars are <strong>est.</strong> (login-based, not billed). Running figure so far: <strong>{est_u(GT["cost"])}</strong> over {GT["wall"]/3600:.1f} agent hours. See <a href="#gemini">its section</a>.</p>')
s_ = put_block(s_, 'GEMINI-COST-NOTE', co_note, '<p class="fine footnote" id="cost-balance"></p>', 'after') if '<!-- GEMINI-COST-NOTE START' not in s_ else put_block(s_, 'GEMINI-COST-NOTE', co_note, '', 'before')
open(f'{SITE}/index.html', 'w').write(s_)

# data/gemini.json: machine-readable snapshot of what the site shows (kept apart from data/costs.json)
import datetime as _dt2
json.dump(dict(generated=_dt2.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z'), status='in progress', basis=G_BASIS, note='est., login-based, not billed; NOT included in data/costs.json totals',
               driver_phase=g_phase, driver_updated_et=g_updated, finished_rounds=[x for x in g_done if x != 'repo'], playable=g_live, classic=g_classic,
               runs=GT['runs'], wall_h=round(GT['wall'] / 3600, 2), input_uncached=int(GT['inp']), input_cached=int(GT['cached']), output=int(GT['out']), reasoning=int(GT['think']),
               cost_usd_est=round(GT['cost'], 2), per_agent_hour_est=round(GT['per_h'], 2) if GT['per_h'] else None,
               runs_detail=[dict(phase=r['phase'], wall_s=r['wall_s'], cost_usd_est=r['cost_usd'], result=r.get('result')) for r in grows]),
          open(f'{SITE}/data/gemini.json', 'w'), indent=1)

# ---- data/costs.json: the landing page's "The bill" table and scoreboard cost row read this file, so they always match the blog totals ----
import datetime as _dt
cj = {'generated': _dt.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z'), 'source': 'tools/build_blog.py (same numbers as the Behind the build post)', 'harness': {}}
for h in H:
    t = T[h]; v2r = [r for r in byh[h] if 'assets-v2' in r['phase'] and r['cost_usd'] is not None]
    cj['harness'][h] = dict(
        runs=t['runs'], wall_h=round(t['wall'] / 3600, 2), input_uncached=int(t['inp']), input_cached=int(t['cached']), output=int(t['out']),
        cost_usd=round(t['total'], 2), reported_usd=round(t['reported'], 2), token_priced_usd=round(t['token'], 2), est_usd=round(t['est'] + t['measured_bal'], 2),
        assets_v2_runs=len(v2r), assets_v2_cost_usd=round(sum(r['cost_usd'] for r in v2r), 2),
        assets_v2_wall_h=round(sum((r['wall_s'] or 0) for r in v2r) / 3600, 2))
bal = None
try:
    bal = json.load(open(f'{SITE}/data/costs.json')).get('deepseek_balance_measured')
except Exception: pass
if bal: cj['deepseek_balance_measured'] = bal
cj['basis'] = {
    'claude': f'Claude Code ran on a subscription login. Total {usd(T["claude"]["total"])} = {usd(T["claude"]["reported"])} reported by the tool + {usd(T["claude"]["token"])} token-priced + {usd(T["claude"]["est"], True)}. Includes two play-site design runs ({usd(claude_site)}) and the channel-art kit ({usd(claude_art)}). List-price equivalent, not a charge.',
    'codex': f'Codex ran on a ChatGPT plan login. Total {usd(T["codex"]["total"])} = {usd(T["codex"]["token"])} token-priced (recorded tokens x gpt-6.1-sol list price) + {usd(T["codex"]["est"], True)} for runs with no recorded tokens. API-equivalent, not a charge.',
    'deepseek': f'DeepSeek was pay-as-you-go. Total {usd(T["deepseek"]["total"])} = {usd(T["deepseek"]["token"])} token-priced (measured tokens x list price) + {usd(T["deepseek"]["measured_bal"], True)} from the balance counter for a killed pass. The measured balance drop was $8.92.'}
cj['note'] = 'Project total = every logged run of that harness, including play-site design runs. The Assets v2 phase column is the part of it spent on the upgrade (build, polish and docs runs, including killed passes).'
json.dump(cj, open(f'{SITE}/data/costs.json', 'w'), indent=1)
summary = dict(T=T, claude_site=claude_site, claude_art=claude_art, meshy_cr=meshy_cr, hf_cr=hf_cr, hf_usd=hf_usd, oa_usd=oa_usd, oa_tok=oa_tok, cb_est=cb_est,
               grand_harness=grand_harness, grand_assets=grand_assets, grand=grand, vo_chars=vo_chars, rv_chars=rv_chars,
               codex_iter7=[r for r in rows if r['harness']=='codex' and r['phase']=='iter-7'][0]['cost_usd'])
print(json.dumps(summary, indent=1))
