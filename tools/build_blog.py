#!/usr/bin/env python3
"""Build the 'Behind the build' blog post from the real logs and inject it into index.html.
Sources: reports/usage.csv, reports/v2-state-*.json, reports/assets-v2-*.log, assets/logs/spend.jsonl.
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
  'It mixes list-price equivalents with measured spend, so read it as a size estimate, not an invoice. The spend log covers Oct 22 12:44 to 14:40 ET only.</p>')

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
A('<p class="fine">FPS are software-rendering figures from the final headless-Chrome check on the build machine. They are far below what a real graphics card gives, and no real GPU was tested.</p>')
A('<ul class="blog__list">')
items = [
 'Claude needed 3 build attempts. Attempt 2 failed the frame-rate check (4.9 FPS in the New Jersey scene at Low against a minimum of 8). Attempt 3 fixed it (34.6 FPS), and the final check read 45.8 FPS. Attempt 3 was first killed mid-run at about 21:14 ET on Oct 22, then resumed from its saved work.',
 'DeepSeek ran on a hard budget: $10 total with a stop at $9.75, measured by the balance endpoint (it read $8.38 at the Oct 22 restart). Its balance guard hit three SSL handshake timeouts (18:45, 19:53 and 20:51 ET), and attempt 2 was killed mid-run at about 21:14 ET and resumed. Its final merge then looped on a push that failed because the remote already held an identical merge. It was fixed by hand at 23:35 ET.',
 'DeepSeek’s Sergey walking speed appears tied to the frame rate (slower when FPS is low). One of its live checks failed when all three games were tested at once (4.6 FPS) and passed when run alone. Low quality shows only 16 of its 42 trees and its first load takes 10 to 13 seconds.',
 'Claude: Medium and High are real-GPU presets and crawl in software rendering, swings have some foot sliding, and trees do not regrow. Codex: tree canopies can block the camera, and the face and full-body animation are approximate.',
 'The v2 builds were not re-reviewed on video. The review scores on this page are for the classic builds. A further Codex integration pass was asked for late on Oct 22, but no extra Codex run appears in the usage log, so none is counted here.',
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
A(f'<p class="fine">Sources: the project usage log (usage.csv), the Assets v2 state files and logs, and the asset spend log. Generated by <span class="mono">tools/build_blog.py</span>. No keys or secrets appear in any of them.</p>')
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
summary = dict(T=T, claude_site=claude_site, claude_art=claude_art, meshy_cr=meshy_cr, hf_cr=hf_cr, hf_usd=hf_usd, oa_usd=oa_usd, oa_tok=oa_tok, cb_est=cb_est,
               grand_harness=grand_harness, grand_assets=grand_assets, grand=grand, vo_chars=vo_chars, rv_chars=rv_chars,
               codex_iter7=[r for r in rows if r['harness']=='codex' and r['phase']=='iter-7'][0]['cost_usd'])
print(json.dumps(summary, indent=1))
