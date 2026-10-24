"""The project run log as the site reads it: reports/usage.csv plus the two unrecorded (killed) runs, each row tagged with its cost basis.
Shared by tools/build_blog.py (totals, run tables) and tools/build_milestones.py (cumulative cost to each tag), so both show the same numbers.
Bases: 'reported' (the tool's own figure), 'token-priced' (recorded tokens x list price, API-equivalent), 'est.' (estimated: tokens not recorded),
'measured via balance' (DeepSeek balance counter), 'n/a' (no figure). Gemini's log (usage-gemini.csv) is separate and always est."""
import csv, os, re
CH = '/workspace/chopperman'
H = ['claude', 'codex', 'deepseek']


def num(x):
    try: return float(x)
    except Exception: return None


def load_rows():
    """Returns (rows, byh): rows = usage.csv rows (co-op rounds included unless INCLUDE_COOP=0); byh = per-harness rows plus the extra killed runs."""
    rows = list(csv.DictReader(open(f'{CH}/reports/usage.csv')))
    # Co-op / voice rounds (phase 'coop-v1 ...'): merged to main and published on the site on 2026-10-23 (tag coop-voice-release), so they now count in the
    # published totals by default. INCLUDE_COOP=0 drops them again (pre-release view).
    if os.environ.get('INCLUDE_COOP', '1') == '0':
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
    return rows, byh


# play-site design runs and the channel-art kit are not game work
NONGAME = lambda r: 'site' in r['phase'] or r['phase'] == 'channel-art'
# runs that count towards a dollar total (the aborted Codex v2 start has no figure and is never added)
COUNTED = lambda r: r['cost_usd'] is not None and not (r['harness'] == 'codex' and r['phase'] == 'v2-aborted')


def load_gemini_rows():
    out = []
    try:
        for r in csv.DictReader(open(f'{CH}/reports/usage-gemini.csv')):
            for k in ('wall_s', 'input_uncached', 'input_cached', 'output', 'reasoning', 'cost_usd'): r[k] = num(r.get(k))
            out.append(r)
    except FileNotFoundError: pass
    return out
