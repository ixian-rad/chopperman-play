#!/usr/bin/env python3
"""Build the 'Behind the build' blog post from the real logs and inject it into cost/index.html, plus the Gemini blocks on the other pages
(Play-picker card on home/index.html, scoreboard note on results/index.html, est. cost block on cost/index.html, progress line on milestones/index.html).
Sources: reports/usage.csv, reports/v2-state-*.json, reports/assets-v2-*.log, assets/logs/spend.jsonl,
plus (Gemini 4 Argon, est., included in the four-harness total) reports/usage-gemini.csv, reports/gemini-state.json, data/gemini-refs.json, <site>/gemini/BUILD.txt.
Run: python3 tools/build_blog.py  (idempotent: replaces everything between the BLOG markers)."""
import csv, json, html, re, collections, sys, os
CH = '/workspace/chopperman'
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = html.escape
H = ['claude', 'codex', 'deepseek']
NAME = {'claude': 'Claude Code', 'codex': 'Codex CLI', 'deepseek': 'DeepSeek Harness'}

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from runlog import num, load_rows, load_gemini_rows, NONGAME, COUNTED, UNLOGGED, gemini_billing, gemini_billing_paren, gemini_billing_sentence   # shared with tools/build_milestones.py
from sitepaths import rebase, HOME, HOME_ROOT
rows, byh = load_rows()

def s(rs, k): return sum((r[k] or 0) for r in rs if not r.get('est') or k == 'cost_usd')
def cost(rs, basis): return sum((r['cost_usd'] or 0) for r in rs if r['basis'] == basis and COUNTED(r))
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
        unlogged=sum(r['cost_usd'] for r in rs if UNLOGGED(r)),    # est. / balance figures for runs with no logged tokens: shown, NOT added
        unlogged_rows=[r for r in rs if UNLOGGED(r)],
        nrec=len(rec))
    T[h]['total'] = T[h]['reported'] + T[h]['token']                  # = the usage.csv sum for that harness
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
# Gemini 4 Argon (high) via the Antigravity CLI. First runs on a Google login, the rest on a paid Gemini API key (usage-gemini.csv 'billing');
# every dollar is est. (tokens x list price). Wording comes from runlog.gemini_billing*().
# Kept out of H / T (its own log and est. basis) but added to the four-harness total and written to data/costs.json as harness 'gemini'.
# Re-run this script (tools/refresh_gemini.sh does) to refresh the numbers from usage-gemini.csv + gemini-state.json.
# =====================================================================================================
GEM_NAME = 'Gemini 4 Argon'
def _read(path, default=None):
    try: return open(path).read()
    except Exception: return default
grows = load_gemini_rows()
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
g_updated_et = g_updated if re.search(r'\b(EDT|EST|ET)$', g_updated) else g_updated + ' ET'   # avoid 'EDT ET'
g_done = gstate.get('done') or []
try:   # the voice chat round has its own state file (driver/coop/voice_driver.py)
    _vs = json.load(open(f'{CH}/reports/voice-state-gemini.json'))
    if 'READY FOR REVIEW' in (_vs.get('status') or ''): g_done = g_done + ['voice-chat']
except Exception: pass
g_coop = bool(g_live and 'coop-voice-release' in g_live['tag'])
g_assets = bool(g_live and ('assets-v2' in g_live['tag'] or g_coop))
g_title = 'Backyard Wood Splitter'
_m = re.search(r'<title>(.*?)</title>', _read(f'{SITE}/gemini/index.html') or '', re.S)
if _m: g_title = re.sub(r'\s*[·|•\-–—].*$', '', html.unescape(_m.group(1)).strip()) or g_title
# Which rounds Gemini 4 Argon has finished, from its tags (data/milestones.json). The wording below flips from "Codex, Claude Code and DeepSeek"
# to "all four" by itself once Gemini tags that round (assets-v2-release, coop-voice-release) and a refresh reruns this script.
def gem_has(row):
    try: return json.load(open(f'{SITE}/data/milestones.json'))['harness']['gemini']['cells'][row]['state'] == 'ok'
    except Exception: return False
THREE = 'Codex, Claude Code and DeepSeek'
def who(row, four='all four harnesses', three=THREE):
    """Subject for a round: 'all four harnesses' once Gemini has tagged that round, else the three that did it."""
    return four if gem_has(row) else three
def gem_pending(row, what):
    return '' if gem_has(row) else f' Gemini 4 Argon joined later; its {what} is not finished yet.'
import datetime as _dt0
g_start = (grows[0].get('start_local') or '')[:16] if grows else ''
GB = gemini_billing(grows); G_PAREN = gemini_billing_paren(grows)
G_BASIS = ('Estimate. Gemini 4 Argon (high) ran through the Antigravity CLI, ' + (f'first on a Google login ({GB["runs_login"]} runs, est. ${GB["login"]:.2f}), then, once that login hit its usage limit, '
           f'on a paid Gemini API key ({GB["runs_api"]} runs, est. ${GB["api"]:.2f} billed). ' if GB['runs_api'] else 'on a Google login. ') +
           'Dollars = measured tokens from the CLI’s own result usage x the Gemini 4 Argon list price: $2 per million uncached input, $0.10 per million cached input, $10 per million output (thinking included).')
G_DONE = gem_has('coop')   # every round the other three did is tagged: no longer 'in progress'
G_DIFFS = [
 'Reviewer notes after v1: the other builds got notes from me playing them. Gemini gets automatic fallback notes unless hand notes were written within 15 minutes of v1 finishing.',
 'One-off hand-driven rounds were not replayed for Gemini: Claude’s channel-art task, DeepSeek’s parallel rounds and Codex’s hull fix.',
 'A failed audio or legibility round was held for review on the other builds. Gemini gets one fix-up run, and the change is reverted if that still fails.',
 'The Assets v2 and co-op briefs say “three different AI coding harnesses” word for word, because the briefs were kept identical.',
 'The classic phase has a wall-clock budget of 6h23m, the same as Claude and Codex had, not the same calendar window. The box restarted at about 06:01 ET on Oct 23 and the loop’s deadline was moved later by the time that was lost.']

def gstat_line():
    if g_live is None: return 'No playable build has been published yet.'
    if g_coop: return f'Now playing: the co-op + voice chat build ({g_live["commit"]} · {g_live["tag"]}).'
    if g_assets: return f'Now playing: the Assets v2 build ({g_live["commit"]} · {g_live["tag"]}).'
    return (f'Now playing: the classic-phase build {g_live["commit"]} ({g_live["tag"]}), before any 3D assets. The Assets v2 round has not finished yet.')

def gem_blog():
    o = []
    A_ = o.append
    A_('<h3 class="h-mid" id="gemini-runs">A fourth harness: Gemini 4 Argon <span class="tag tag--est">est.</span>' + ('' if G_DONE else ' <span class="tag tag--est">in progress</span>') + '</h3>')
    A_(('<p class="fine"><strong>Finished every round.</strong> Gemini 4 Argon (high reasoning, through the Antigravity CLI) built the same game from the same prompts in the same order. ' if G_DONE else
        '<p class="fine"><strong>In progress, updated as the build continues.</strong> Gemini 4 Argon (high reasoning, through the Antigravity CLI) is building the same game from the same prompts in the same order. ') +
       f'It is <strong>included in the four-harness total above</strong>. {E(G_BASIS)} Driver state as of {E(g_updated_et)}: phase <span class="mono">{E(g_phase)}</span>. {E(gstat_line())}</p>')
    A_('<div class="tablewrap" role="region" aria-label="Gemini totals, scrollable" tabindex="0"><table class="blogtable"><caption class="sr-only">Gemini totals' + ('' if G_DONE else ' so far') + ' (est.)</caption><thead><tr>'
       '<th scope="col">Harness</th><th scope="col">Runs</th><th scope="col">Agent time</th><th scope="col">Input, uncached</th><th scope="col">Input, cached</th><th scope="col">Output</th><th scope="col">Est. total (USD)</th></tr></thead><tbody>')
    A_('<tr>' + f'<th scope="row">{GEM_NAME}</th>' + cell(str(GT['runs'])) + cell(hrs(GT['wall'])) + cell(n(GT['inp'])) + cell(n(GT['cached'])) + cell(n(GT['out'])) + cell(f'<strong>{usd(GT["cost"], True)}</strong>') + '</tr>')
    A_('</tbody></table></div>')
    A_('<p class="fine">Output includes thinking tokens (' + n(GT['think']) + (').</p>' if G_DONE else ' so far). This is a running figure and grows as each round finishes.</p>'))
    A_('<details class="blog__runs"><summary>' + f'{GEM_NAME}: {GT["runs"]} logged runs{"" if G_DONE else " so far"}, {hrs(GT["wall"])}, {usd(GT["cost"], True)}</summary>')
    A_(f'<div class="tablewrap" role="region" aria-label="{GEM_NAME} runs, scrollable" tabindex="0"><table class="blogtable blogtable--runs"><caption class="sr-only">{GEM_NAME} run log</caption><thead><tr>'
       '<th scope="col">Run</th><th scope="col">Started (ET)</th><th scope="col">Wall</th><th scope="col">Input</th><th scope="col">Cached</th><th scope="col">Output</th><th scope="col">Cost</th><th scope="col">Basis</th><th scope="col">Result</th></tr></thead><tbody>')
    for r in grows:
        res = short((r.get('result') or '') + ((', ' + r['notes']) if r.get('notes') else ''))
        A_('<tr>' + f'<th scope="row">{E(r["phase"])}</th>' + cell(E((r.get('start_local') or '')[5:16])) + cell(mmss(r['wall_s'])) + cell(n(r['input_uncached'])) + cell(n(r['input_cached'])) + cell(n(r['output']))
           + cell(usd(r['cost_usd'], True)) + cell('<span class="tag tag--est">est.</span>' + (' API key' if (r.get('billing') or '') == 'api' else ' login')) + cell(E(res), 'txt') + '</tr>')
    A_('</tbody></table></div></details>')
    A_('<p class="fine"><strong>Where Gemini’s replay differs from the other three:</strong></p><ul class="blog__list">' + ''.join(f'<li>{E(d)}</li>' for d in G_DIFFS) + '</ul>')
    return '\n'.join(o)

out = []
A = out.append
A('<!-- BLOG START (generated by tools/build_blog.py from reports/usage.csv, v2-state-*.json, spend.jsonl) -->')
A('<section class="section" id="log" aria-labelledby="blog-title"><span class="anchor" id="behind-the-build"></span><div class="wrap">')
A('<p class="kicker"><img src="../assets/brand/icon-cost.svg" alt="" width="28" height="28"> Behind the build</p>')
A('<h2 id="blog-title">' + ('How four AI harnesses made Chopperman' if gem_has('coop') else 'How four AI harnesses are making Chopperman') + '</h2>')
A('<details class="blog" open><summary>Read the build log: totals, every run, and the honest story</summary><div class="blog__body">')
A('<p class="lede">Every number below comes from the project’s own logs. Three kinds of figure appear and they are labelled: '
  '<span class="tag tag--rep">reported</span> by the tool itself, <span class="tag tag--tok">token-priced</span> (recorded token counts times the public list price, an API-equivalent figure), and '
  '<span class="tag tag--est">est.</span> where a run’s tokens were not recorded and I estimated it. Where nothing could be recovered the cell says n/a. All times are US Eastern.</p>')
A('<p class="fine"><strong>What was really billed:</strong> Claude Code and Codex ran on subscription logins, so their dollar figures are list-price equivalents, not charges. '
  f'DeepSeek was pay-as-you-go, and its balance fell by <strong>$8.92</strong> (from $49.66 to $40.74, checked 22:25 on Oct 22, before the last docs run had finished). '
  'Including the co-op and voice chat rounds, DeepSeek’s balance had fallen by <strong>$9.87</strong> in total (to $39.79, checked 14:09 on Oct 23, as its voice chat run was finishing), inside its raised $15 budget. '
  + gemini_billing_sentence(grows) + ' '
  'The image, 3D and voice services are listed separately below.</p>')

# totals table: logged runs only (= the usage logs' sums); Gemini is a row of its own and part of the four-harness total
GRAND4 = grand_harness + GT['cost']
BILLED = {'claude': 'Claude subscription login (list-price equivalent)', 'codex': 'ChatGPT plan login (API-equivalent)', 'deepseek': 'pay-as-you-go API (real spend)'}
A('<h3 class="h-mid">Totals at a glance</h3>')
A('<div class="tablewrap" role="region" aria-label="Totals by harness, scrollable" tabindex="0"><table class="blogtable"><caption class="sr-only">Totals by harness</caption><thead><tr>'
  '<th scope="col">Harness</th><th scope="col">Runs</th><th scope="col">Agent time</th><th scope="col">Input, uncached</th><th scope="col">Input, cached</th><th scope="col">Output</th>'
  '<th scope="col">Reported</th><th scope="col">Token-priced</th><th scope="col">Total (USD)</th><th scope="col">How it ran</th></tr></thead><tbody>')
for h in H:
    t = T[h]
    A('<tr>' + f'<th scope="row">{NAME[h]}</th>' + cell(f'{t["runs"]}') + cell(hrs(t['wall'])) + cell(n(t['inp'])) + cell(n(t['cached'])) + cell(n(t['out']))
      + cell(usd(t['reported']) if t['reported'] else '–') + cell(usd(t['token']) if t['token'] else '–')
      + cell(f'<strong>{usd(t["total"], True)}</strong>') + cell(E(BILLED[h]), 'txt') + '</tr>')
# Gemini 4 Argon: measured tokens x list price, so it sits in the token-priced column; every Gemini dollar is est.
A('<tr>' + f'<th scope="row">{GEM_NAME}' + ('' if G_DONE else ' <span class="tag tag--est">in progress</span>') + '</th>' + cell(str(GT['runs'])) + cell(hrs(GT['wall'])) + cell(n(GT['inp'])) + cell(n(GT['cached'])) + cell(n(GT['out']))
  + cell('–') + cell(usd(GT['cost'], True)) + cell(f'<strong>{usd(GT["cost"], True)}</strong>')
  + cell(E(f'est. ${GB["api"]:.2f} billed to a paid Gemini API key + est. ${GB["login"]:.2f} on a Google login' if GB['runs_api'] else 'Google login'), 'txt') + '</tr>')
tw = sum(T[h]['wall'] for h in H)
A('<tr class="blogtotal"><th scope="row">All four harnesses</th>' + cell(str(sum(T[h]['runs'] for h in H) + GT['runs'])) + cell(hrs(tw + GT['wall']))
  + cell(n(sum(T[h]['inp'] for h in H) + GT['inp'])) + cell(n(sum(T[h]['cached'] for h in H) + GT['cached'])) + cell(n(sum(T[h]['out'] for h in H) + GT['out']))
  + cell(usd(sum(T[h]['reported'] for h in H))) + cell(usd(sum(T[h]['token'] for h in H) + GT['cost'], True))
  + cell(f'<strong>{usd(GRAND4, True)}</strong>') + cell('mixed basis: a size estimate, not an invoice', 'txt') + '</tr>')
A('</tbody></table></div>')
unl = [(h, r) for h in H for r in T[h]['unlogged_rows']]
A(f'<p class="fine">Totals add up every logged run (the project’s usage logs); token columns count only runs whose tokens were recorded ({sum(T[h]["nrec"] for h in H)} of {sum(T[h]["runs"] for h in H)} runs for Codex, Claude Code and DeepSeek). '
  f'Claude also wrote {n(T["claude"]["cw"])} cache-write tokens. Claude’s total includes two play-site design runs ({usd(claude_site)}) and the channel-art kit ({usd(claude_art)}); without the site runs it is {usd(T["claude"]["total"]-claude_site, True)}. '
  f'DeepSeek’s total is token-priced ({usd(T["deepseek"]["token"])}); its measured balance drop was $8.92 by Oct 22 22:25 ET and $9.87 by Oct 23 14:09 ET, after the co-op and voice chat rounds. '
  + (f'Gemini 4 Argon’s row is est. (output includes thinking tokens; {G_PAREN}).</p>' if G_DONE else f'Gemini 4 Argon’s row is a running est. (output includes thinking tokens; {G_PAREN}); it is still building, so the “All four” row grows as its rounds finish.</p>'))
if unl:
    A('<p class="fine"><strong>Not in the totals:</strong> ' + str(len(unl)) + ' runs left no token log, so they have no logged cost: '
      + '; '.join(f'{NAME[h]} {E(r["phase"])} ({"est. " if r["basis"] == "est." else ""}${r["cost_usd"]:.2f}{" by the balance counter" if r["basis"] == "measured via balance" else ""})' for h, r in unl)
      + f'. Together about {usd(sum(r["cost_usd"] for _, r in unl), True)}. They are listed in the run tables below and are not added to any total.</p>')

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
A(f'<p class="fine"><strong>Grand total, mixed basis (all four harnesses and the shared assets):</strong> est. <strong>${grand + GT["cost"]:,.2f}</strong> = harness runs est. ${GRAND4:,.2f} '
  f'(Codex, Claude Code and DeepSeek ${grand_harness:,.2f} + Gemini 4 Argon est. ${GT["cost"]:,.2f}) + dollar-valued assets est. ${grand_assets:.2f}. '
  'It mixes list-price equivalents with measured spend, so read it as a size estimate, not an invoice. The spend log covers Oct 22 12:44 to Oct 23 00:42 ET.</p>')

# narrative
A('<h3 class="h-mid">The story, in order</h3><div class="prose blog__prose">')
paras = [
 ('Oct 21, the first builds.', 'Claude Code, Codex CLI and the DeepSeek Harness got the same brief at 14:11 ET: a backyard axe-chopping game for the browser in three.js. DeepSeek and Codex had a working v1 in 22 and 17 minutes. Claude’s v1 took 31 minutes and was cut off by an operator error during its final self-test, so it shipped without a README and with the swing stuck in its windup. Two accidental early starts of a second version were aborted and discarded. Round 1 review scores were Codex 3.3, Claude 7.0 and DeepSeek 5.3.'),
 ('Iterations and the Round 2 review.', f'Each of the three then ran many improvement passes: Codex iter-1 to iter-10, Claude iter-1 to iter-3 (its iter-2 ran about 2 hours and produced no changes, so it was reverted), and DeepSeek iter-1 to iter-27 including a multi-agent parallel upgrade in three rounds (content, physics, graphics, audio and polish streams). A box restart at 02:13 ET on Oct 22 interrupted several runs and their partial work was kept. In DeepSeek’s third round some streams failed a frame-rate gate against main (for example 1.4, 3.0, 5.8 and 9.8 FPS against 60.2 FPS in software rendering) and were fixed or rejected before merging. Round 2 scores were Codex 8, Claude 7 and DeepSeek 6.'),
 ('Sound, music and the legibility pass.', 'Codex, Claude Code and DeepSeek each added sound effects and music. A legibility pass followed (Claude iter-3, Codex iter-10, DeepSeek iter-27), after the rule that all in-game and site text must be easy to read: body text at least 16 px, HUD numbers at least 20 px, with AA contrast. Claude Code also designed the channel art and this play site.'),
 ('Archive of the classic builds.', 'Before any new assets went in, the Codex, Claude Code and DeepSeek repos each got a snapshot tag (snapshot-2026-10-22) and a pre-assets branch, and the classic builds are kept as separate repos and in the site’s /classic/ folders. That keeps the comparison fair.'),
 ('The asset pack and Sergey.', f'The lumberjack is named Sergey and has two costumes, a tee and a blue jacket. The shared pack came from Meshy (props, trees, the shed, fences, axes and the rigged, animated character), Higgsfield (early stills and trailer clips) and GPT image generation. Higgsfield’s faces were a bit inaccurate against the source photos, so Sergey was rebuilt from new GPT front, side and back views, and all key art was redone with GPT. The pack gave each game that took it two settings: a New Jersey backyard and a Tiraspol backyard with a cathedral behind it, plus an upgraded trees pack (tree v2) and four axes.'),
 ('The Assets v2 upgrade.', 'On Oct 22 at 14:37 ET Codex, Claude Code and DeepSeek got the identical brief to build the pack into their own games, add walking and let Sergey fell the surrounding trees. All three merged and passed the final automated check in headless Chrome with software rendering and no GPU. The run tables below list every attempt.' + gem_pending('assets', 'Assets v2 version') + (' Gemini 4 Argon has since tagged its own Assets v2 build.' if gem_has('assets') else '')),
 ('Co-op and a second character.', 'Shortly after midnight on Oct 23 Codex, Claude Code and DeepSeek got the identical co-op brief: two-player online co-op over peer-to-peer WebRTC (PeerJS, with a 5-character room code and the host deciding every tree hit), plus Alex as a second playable character from the shared pack. Each did one build run and one documentation run on a separate coop-v1 branch, and all three passed an automated two-player check, run in a single page over a loopback link.' + gem_pending('coop', 'co-op version')),
 ('Proximity voice chat.', 'Next came an identical voice chat brief: opt-in voice that fades with the distance between the two players, with microphone access only after you turn it on. Claude finished it at 05:42 ET. The Codex and DeepSeek runs were interrupted by the box restart at about 06:01 ET and re-run that afternoon, passing at 14:13 and 14:18 ET. Codex, Claude Code and DeepSeek all passed the voice steps of the co-op check and the voice module’s 360 unit checks. After one more check on the merged code, the co-op and voice builds were merged to main as coop-voice-release on the evening of Oct 23 and published here. They count in the totals above.'),
 ('A fourth harness: Gemini 4 Argon.', (f'On {_dt0.datetime.strptime(g_start, "%Y-%m-%d %H:%M").strftime("%b %-d")} at {g_start[11:16]} ET ' if g_start else '') + 'Gemini 4 Argon (high reasoning, through the Antigravity CLI) started on the same brief and is replaying the same prompts in the same order. '
  + ('It has reached every milestone the other three did.' if gem_has('coop') else 'It is still in progress: its finished rounds, run table and est. cost are below, and its builds are in the milestones gallery.'))]
for h2, p in paras: A(f'<p><strong>{E(h2)}</strong> {E(p)}</p>')
A('</div>')

# v2 results
v2 = json.load(open(f'{SITE}/data/v2.json'))['harness']
st = {h: json.load(open(f'{CH}/reports/v2-state-{h}.json')) for h in H}
A('<h3 class="h-mid">Assets v2 results and the honest issues: Codex, Claude Code, DeepSeek</h3>')
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
 'DeepSeek’s Sergey walking speed appears tied to the frame rate (slower when FPS is low). One of its live checks failed when the Codex, Claude and DeepSeek games were tested at once (4.6 FPS) and passed when run alone. Low quality shows only 16 of its 42 trees and its first load takes 10 to 13 seconds.',
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

# The site is split into pages (tools/build_chrome.py): the blog and Gemini's est. cost block go to cost/index.html, the scoreboard note to
# results/index.html, Gemini's progress line to milestones/index.html and its Play-picker card to home/index.html (the main page; the root index.html is
# the splash from tools/build_splash.py, rebuilt at the end of this script). Every block sits between markers.
PAGE = {'home': HOME, 'results': f'{SITE}/results/index.html', 'cost': f'{SITE}/cost/index.html', 'milestones': f'{SITE}/milestones/index.html'}


def put_block(path, name, frag_html):
    doc = open(path).read()
    start, end = f'<!-- {name} START', f'<!-- {name} END -->'
    assert start in doc, f'{name} markers not found in {path}'
    block = f'{start} (generated by tools/build_blog.py) -->\n{frag_html}\n{end}'
    open(path, 'w').write(re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda m: block, doc, flags=re.S))


s_ = open(PAGE['cost']).read()
assert '<!-- BLOG START' in s_, 'BLOG markers missing in cost/index.html'
open(PAGE['cost'], 'w').write(re.sub(r'<!-- BLOG START.*?<!-- BLOG END -->', lambda m: frag, s_, flags=re.S))


def fmtk(v): return f'{v/1e6:.1f}M' if v >= 1e6 else (f'{v/1e3:.1f}k' if v >= 1e3 else str(int(v)))
est_u = lambda v: 'est. ' + usd(v) if v is not None else 'n/a'
def sbrow(label, val, cls=''): return f'<tr><th scope="row">{label}</th><td class="{cls}">{val}</td></tr>'

# shot + tag date for the live build come from data/milestones.json (tools/build_milestones.py); fall back to the refresh smoke-test shot
ms = {}
try: ms = json.load(open(f'{SITE}/data/milestones.json'))['harness']['gemini']
except Exception: pass
live_img = live_at = live_at_text = None
if g_live:
    for c in list((ms.get('cells') or {}).values()) + list(ms.get('iterations') or []):
        if c.get('commit') == g_live['commit']:
            live_at, live_at_text = c.get('at'), c.get('at_text')
            if c.get('img') and os.path.exists(f'{SITE}/{c["img"]}-480.webp') and 'iter-' not in c['img'].rsplit('/', 1)[-1]: live_img = c['img']
            if live_img: break
if live_img:
    pic = (f'<picture><source type="image/avif" srcset="{live_img}-480.avif 480w, {live_img}-960.avif 960w" sizes="(max-width: 720px) 38vw, (max-width: 1100px) 46vw, 280px">'
           f'<img src="{live_img}-480.webp" srcset="{live_img}-480.webp 480w, {live_img}-960.webp 960w" sizes="(max-width: 720px) 38vw, (max-width: 1100px) 46vw, 280px" width="480" height="300" alt=""></picture>')
elif os.path.exists(f'{SITE}/assets/shots/gemini/latest.webp'):
    pic = '<img src="assets/shots/gemini/latest.webp" width="960" height="600" alt="">'
else: pic = ''
cur = f'{g_live["commit"]} · {E(g_live["tag"])}' if g_live else 'not published yet'
upd = (f' · updated <time datetime="{live_at}" data-rel>{E(live_at_text)} ET</time>' if live_at else f' · snapshot {E(grefs.get("snapshot_at", ""))}')
chip_t = (E(g_live['tag']) if g_live else 'not playable yet')
if g_live and not g_assets: what = 'Classic phase: the original brief, before any 3D assets.'
elif g_coop: what = 'Co-op + voice chat build: two-player online co-op with opt-in proximity voice chat.'
elif g_live: what = 'Assets v2 build.'
else: what = 'Nothing is playable yet.'
gem_html = f"""<article class="pcard{'' if G_DONE else ' pcard--wip'}" id="gemini" style="--hc:var(--h-gemini)" aria-labelledby="pc-gemini">
  {('<a class="pcard__shot" href="gemini/" tabindex="-1" aria-hidden="true">' + pic + '</a>') if pic else ''}
  <div class="pcard__b">
    <h3 class="pcard__who" id="pc-gemini">Gemini</h3>
    <p class="pcard__title">{E(g_title)}</p>
    <p class="pcard__meta">Gemini 4 Argon · Antigravity CLI<br>Live build <span class="mono">{cur}</span>{upd}</p>
    <ul class="chips" aria-label="About this build">{('<li class="chip chip--good">Co-op + voice</li>' if g_coop else f'<li class="chip chip--live">{"Finished" if G_DONE else "In progress"} · {chip_t}</li>')}<li class="chip">Not reviewed</li></ul>
    <p class="pcard__note">{what} Same prompts, same order as the other three. Cost{'' if G_DONE else ' so far'}: <strong>{est_u(GT['cost'])}</strong> ({E(G_PAREN.replace('est.: ', ''))}).</p>
    {('<a class="btn ' + ('btn--play' if G_DONE else 'btn--ghost') + ' pcard__play" href="gemini/"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 3 L17 10 L5 17 Z"/></svg>Play' + ('' if G_DONE else ' latest') + '<span class="sr-only"> Gemini</span></a>') if g_live else ''}
    <p class="pcard__alt">{'<a href="classic/gemini/">Classic<span class="sr-only"> Gemini</span></a>' if g_classic else ''}<a href="milestones/?view=harness&amp;h=gemini">Progress<span class="sr-only"> of Gemini</span></a></p>
  </div>
</article>"""
put_block(PAGE['home'], 'GEMINI', rebase(gem_html, HOME_ROOT))

status_html = ((f'<p class="flag flag--wide ms-gemini"><strong>Gemini 4 Argon has finished every round.</strong> Its co-op + voice chat build is merged and published (<span class="mono">{cur}</span>). '
                f'It joined later and is not reviewed or scored. Its dollars are <strong>est.</strong> ({E(G_PAREN)}).</p>') if G_DONE else
               (f'<p class="flag flag--wide ms-gemini"><strong>Gemini 4 Argon is in progress.</strong> Finished rounds: {E(", ".join(x for x in g_done if x != "repo")) or "none yet"}. '
               f'Running now: <span class="mono">{E(g_phase)}</span>. Playable build: <span class="mono">{cur}</span>. Driver state as of {E(g_updated_et)}. '
               f'Its column shows its newest tag as “in progress” until the next milestone is tagged. Its dollars are <strong>est.</strong> ({E(G_PAREN)}).</p>'))
put_block(PAGE['milestones'], 'GEMINI-STATUS', status_html)

sc_note = ('<p class="fine">A fourth harness, <a href="../home/#gemini">Gemini 4 Argon</a>, ' + ('joined later, finished every round, and is not reviewed or scored. ' if G_DONE else 'is still being built and is not reviewed or scored. ') +
           'Its progress is in the <a href="../milestones/?view=harness&amp;h=gemini">milestones gallery</a> and its est. cost on the <a href="../cost/#gemini-cost">cost page</a>.</p>')
put_block(PAGE['results'], 'GEMINI-SCORES-NOTE', sc_note)

co_html = f"""<section class="gemcost" id="gemini-cost" aria-labelledby="gemcost-title">
<h3 class="h-mid" id="gemcost-title">Gemini 4 Argon{'' if G_DONE else ' so far'} <span class="tag tag--est">est.</span>{'' if G_DONE else ' <span class="tag tag--est">in progress</span>'}</h3>
<p class="fine">Gemini 4 Argon is in the bill above and in the four-harness total ({E(usd(GRAND4, True))}). This is its breakdown{'' if G_DONE else ' so far (it is still being built)'}. Its dollars are <strong>est.</strong> ({E(G_PAREN)}).</p>
<div class="tablewrap"><table class="scoreboard" id="sb-gemini">
<caption class="sr-only">Gemini 4 Argon: estimated cost{'' if G_DONE else ' so far'}</caption>
<colgroup><col class="col-metric"><col></colgroup>
<thead><tr><th scope="col"><span class="sr-only">Metric</span></th><th scope="col"><span class="sb-game">Gemini</span><span class="sb-sub">4 Argon · high</span></th></tr></thead>
<tbody id="sb-gemini-cost">
{sbrow('Cost (USD, est.)', est_u(GT['cost']))}
{sbrow('Paid Gemini API key (est.)', est_u(GB['api']))}
{sbrow('Google login (est.)', est_u(GB['login']))}
{sbrow('Agent hours', f"{GT['wall'] / 3600:.1f} h")}
{sbrow('Cost per agent hour (est.)', (est_u(GT['per_h']) + '/h') if GT['per_h'] else 'n/a')}
{sbrow('Tokens in (uncached + cached)', f"{fmtk(GT['inp'])} + {fmtk(GT['cached'])}", 'small')}
{sbrow('Tokens out (incl. thinking)', fmtk(GT['out']), 'small')}
</tbody></table></div>
<p class="fine">{E(G_BASIS)} Every Gemini run is in <a href="#gemini-runs">its run table</a> in the build log below.</p>
</section>"""
put_block(PAGE['cost'], 'GEMINI-COST-NOTE', co_html)

# Hand-written page copy marks round-specific subjects as <span data-who="ROW" data-three="…" data-four="…">; fill them so they flip to the
# all-four wording once Gemini tags that round.
for _p in PAGE.values():
    _s = open(_p).read()
    _n = re.sub(r'(<span data-who="(\w+)" data-three="([^"]*)" data-four="([^"]*)">).*?(</span>)', lambda m: m.group(1) + (m.group(4) if gem_has(m.group(2)) else m.group(3)) + m.group(5), _s, flags=re.S)
    if _n != _s: open(_p, 'w').write(_n)

# data/gemini.json: machine-readable snapshot of what the site shows (kept apart from data/costs.json)
import datetime as _dt2
json.dump(dict(generated=_dt2.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z'), status=('finished (not reviewed)' if G_DONE else 'in progress'), basis=G_BASIS, note=G_PAREN, billing_paren=G_PAREN, in_costs_json=True,
               billing=dict(cost_usd_est_total=GB['total'], cost_usd_est_api_key=GB['api'], cost_usd_est_google_login=GB['login'], runs_api_key=GB['runs_api'], runs_google_login=GB['runs_login'], note='all figures est. (measured tokens x list price)'),
               driver_phase=g_phase, driver_updated_et=g_updated, finished_rounds=[x for x in g_done if x != 'repo'], playable=g_live, classic=g_classic,
               runs=GT['runs'], wall_h=round(GT['wall'] / 3600, 2), input_uncached=int(GT['inp']), input_cached=int(GT['cached']), output=int(GT['out']), reasoning=int(GT['think']),
               cost_usd_est=round(GT['cost'], 2), per_agent_hour_est=round(GT['per_h'], 2) if GT['per_h'] else None,
               runs_detail=[dict(phase=r['phase'], wall_s=r['wall_s'], cost_usd_est=r['cost_usd'], billing=('api key' if (r.get('billing') or '') == 'api' else 'google login'), result=r.get('result')) for r in grows]),
          open(f'{SITE}/data/gemini.json', 'w'), indent=1)

# ---- data/costs.json: the landing page's "The bill" table and scoreboard cost row read this file, so they always match the blog totals ----
import datetime as _dt
cj = {'generated': _dt.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z'), 'source': 'tools/build_blog.py from reports/usage.csv + reports/usage-gemini.csv (same numbers as the Behind the build post)', 'harness': {}}
for h in H:
    t = T[h]; v2r = [r for r in byh[h] if 'assets-v2' in r['phase'] and not NONGAME(r) and COUNTED(r)]
    cvr = [r for r in byh[h] if r['phase'].startswith('coop-v1') and COUNTED(r)]
    cj['harness'][h] = dict(
        runs=t['runs'], wall_h=round(t['wall'] / 3600, 2), input_uncached=int(t['inp']), input_cached=int(t['cached']), output=int(t['out']),
        cost_usd=round(t['total'], 2), est=True, reported_usd=round(t['reported'], 2), token_priced_usd=round(t['token'], 2),
        unlogged_est_usd=round(t['unlogged'], 2),   # runs with no token log: shown on the site, NOT in cost_usd
        assets_v2_runs=len(v2r), assets_v2_cost_usd=round(sum(r['cost_usd'] for r in v2r), 2),
        assets_v2_wall_h=round(sum((r['wall_s'] or 0) for r in v2r) / 3600, 2),
        coop_voice_runs=len(cvr), coop_voice_cost_usd=round(sum(r['cost_usd'] for r in cvr), 2), coop_voice_wall_h=round(sum((r['wall_s'] or 0) for r in cvr) / 3600, 2))
gv2 = [r for r in grows if r['phase'].startswith('assets-v2') and r['cost_usd'] is not None]
gcv = [r for r in grows if r['phase'].startswith('coop-v1') and r['cost_usd'] is not None]
cj['harness']['gemini'] = dict(
    runs=GT['runs'], wall_h=round(GT['wall'] / 3600, 2), input_uncached=int(GT['inp']), input_cached=int(GT['cached']), output=int(GT['out']),
    cost_usd=round(GT['cost'], 2), est=True, reported_usd=0, token_priced_usd=round(GT['cost'], 2), unlogged_est_usd=0,
    api_key_usd=GB['api'], google_login_usd=GB['login'], runs_api_key=GB['runs_api'], runs_google_login=GB['runs_login'],
    assets_v2_runs=len(gv2), assets_v2_cost_usd=round(sum(r['cost_usd'] for r in gv2), 2), assets_v2_wall_h=round(sum((r['wall_s'] or 0) for r in gv2) / 3600, 2),
    coop_voice_runs=len(gcv), coop_voice_cost_usd=round(sum(r['cost_usd'] for r in gcv), 2), coop_voice_wall_h=round(sum((r['wall_s'] or 0) for r in gcv) / 3600, 2))
cj['total'] = dict(all_four_usd_est=round(GRAND4, 2), three_usd_est=round(grand_harness, 2), gemini_usd_est=round(GT['cost'], 2),
                   unlogged_est_usd=round(sum(T[h]['unlogged'] for h in H), 2), note='Logged runs only; mixed basis (list-price / API-equivalent / real spend), a size estimate, not an invoice.')
bal = None
try:
    bal = json.load(open(f'{SITE}/data/costs.json')).get('deepseek_balance_measured')
except Exception: pass
if bal: cj['deepseek_balance_measured'] = bal
cj['basis'] = {
    'claude': f'Claude Code ran on a Claude subscription login, so this is a list-price equivalent, not a charge: est. {usd(T["claude"]["total"])} = {usd(T["claude"]["reported"])} reported by the tool + {usd(T["claude"]["token"])} token-priced (logged tokens x list price). Includes two play-site design runs ({usd(claude_site)}) and the channel-art kit ({usd(claude_art)}). Not included: a killed pass with no token log (est. {usd(T["claude"]["unlogged"])}).',
    'codex': f'Codex ran on a ChatGPT plan login, so this is an API-equivalent, not a charge: est. {usd(T["codex"]["total"])} token-priced (recorded tokens x gpt-6.1-sol list price). Not included: iteration 7, whose tokens were not recorded (est. {usd(T["codex"]["unlogged"])}).',
    'deepseek': f'DeepSeek was pay-as-you-go, real API spend: est. {usd(T["deepseek"]["total"])} token-priced (measured tokens x list price). The account balance itself fell $8.92 by Oct 22 22:25 ET and $9.87 by Oct 23 14:09 ET, after the co-op and voice chat rounds; the gap includes a killed pass with no token log ({usd(T["deepseek"]["unlogged"])} by the balance counter).',
    'gemini': (f'Gemini 4 Argon ran through the Antigravity CLI: est. {usd(GT["cost"])} = est. {usd(GB["api"])} billed to a paid Gemini API key ({GB["runs_api"]} runs) + est. {usd(GB["login"])} on a Google login (its first {GB["runs_login"]} runs, until that login hit its usage limit). Measured tokens x Gemini 4 Argon list price.'
               if GB['runs_api'] else f'Gemini 4 Argon ran on a Google login: est. {usd(GT["cost"])} (measured tokens x list price).')}
cj['note'] = 'cost_usd = every logged run of that harness (its usage log), including play-site design runs and the co-op and voice chat rounds (coop_voice_*); runs with no token log are listed as unlogged_est_usd and not added. The Assets v2 phase column is the logged build, polish and docs runs of the upgrade. Every figure is est.: list-price or API-equivalent for Claude and Codex, real spend for DeepSeek and for Gemini on its paid API key.'
json.dump(cj, open(f'{SITE}/data/costs.json', 'w'), indent=1)
summary = dict(T=T, claude_site=claude_site, claude_art=claude_art, meshy_cr=meshy_cr, hf_cr=hf_cr, hf_usd=hf_usd, oa_usd=oa_usd, oa_tok=oa_tok, cb_est=cb_est,
               grand_harness=grand_harness, grand4=GRAND4, grand_assets=grand_assets, grand=grand, vo_chars=vo_chars, rv_chars=rv_chars,
               codex_iter7=[r for r in rows if r['harness']=='codex' and r['phase']=='iter-7'][0]['cost_usd'])
print(json.dumps(summary, indent=1))

# the splash page at the site root shows Gemini's newest build next to the review scores: rebuild it from the data just written
import subprocess as _sp
_sp.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build_splash.py')], check=True, stdout=sys.stderr)
