"""The project run log as the site reads it: reports/usage.csv plus the two unrecorded (killed) runs, each row tagged with its cost basis.
Shared by tools/build_blog.py (totals, run tables) and tools/build_milestones.py (cumulative cost to each tag), so both show the same numbers.
Bases: 'reported' (the tool's own figure), 'token-priced' (recorded tokens x list price, API-equivalent), 'est.' (estimated: tokens not recorded),
'measured via balance' (DeepSeek balance counter), 'n/a' (no figure). Gemini's log (usage-gemini.csv) is separate and always est.
Totals = the logged runs only (reported + token-priced), i.e. exactly what usage.csv / usage-gemini.csv add up to. Runs whose tokens were never
logged (Codex iter-7, the two killed first passes) keep an est. figure in the run tables but carry in_total=False and are NOT added to any total."""
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
                     cost_usd=avg('cost_usd'), basis='est.', est=True, in_total=False,
                     note='No turn.completed event was recorded. Tokens and cost are est.: the mean of Codex iter-1 to iter-6. Not added to totals.')
        if r['harness'] == 'codex' and r['phase'] == 'v2-aborted':
            r.update(basis='est.', est=True, in_total=False, note='Aborted after 72 s; tokens not recorded. Cost est. under $0.05, not added to totals.')
    extra = [
        dict(harness='claude', phase='assets-v2 attempt-3 (first pass, killed)', start_local='2026-10-22 16:24', wall_s=None,
             input_uncached=None, input_cached=None, cache_write=None, output=None, cost_usd=7.15, basis='est.', est=True, in_total=False,
             result='killed mid-run at about 21:14 ET; unverified work saved as WIP commit e02702d',
             note='Tokens not recorded (the run was killed). Cost est. at about the same as the resumed attempt-3 pass ($7.15). Not added to totals.'),
        dict(harness='deepseek', phase='assets-v2 attempt-2 (first pass, killed)', start_local='2026-10-22 16:04', wall_s=None,
             input_uncached=None, input_cached=None, cache_write=None, output=None, cost_usd=0.29, basis='measured via balance', est=False, in_total=False,
             result='killed mid-run at about 21:14 ET; unverified work saved as WIP commit b4431ff',
             note='Tokens not recorded. $0.29 is the rise of the driver spend counter (balance based) from $8.0918 at 16:04 to $8.3818 at 21:15. Not added to totals.'),
    ]
    byh = {h: [r for r in rows if r['harness'] == h] for h in H}
    for e in extra: byh[e['harness']].append(e)
    return rows, byh


# play-site design runs and the channel-art kit are not game work
NONGAME = lambda r: 'site' in r['phase'] or r['phase'] == 'channel-art'
# runs that count towards a dollar total: logged runs only (unlogged runs carry in_total=False and are shown, never added)
COUNTED = lambda r: r['cost_usd'] is not None and r.get('in_total', True)
# the unlogged runs' est. figures, listed beside the totals
UNLOGGED = lambda r: r['cost_usd'] is not None and r.get('in_total', True) is False and r['phase'] != 'v2-aborted'


def load_gemini_rows():
    out = []
    try:
        for r in csv.DictReader(open(f'{CH}/reports/usage-gemini.csv')):
            for k in ('wall_s', 'input_uncached', 'input_cached', 'output', 'reasoning', 'cost_usd'): r[k] = num(r.get(k))
            out.append(r)
    except FileNotFoundError: pass
    return out

def gemini_billing(rows=None):
    """Gemini 4 Argon cost split by billing mode (usage-gemini.csv column 'billing': 'login' = Google login via the Antigravity CLI,
    'api' = paid Gemini API key after the login quota ran out). Every figure is est. (measured tokens x list price)."""
    rows = load_gemini_rows() if rows is None else rows
    api = [r for r in rows if (r.get('billing') or '').strip() == 'api']; login = [r for r in rows if r not in api]
    c = lambda rr: round(sum(r['cost_usd'] or 0 for r in rr), 2)
    return dict(total=c(rows), api=c(api), login=c(login), runs_api=len(api), runs_login=len(login))

def gemini_billing_paren(rows=None):
    """Short parenthetical used wherever a Gemini dollar figure appears on the site."""
    b = gemini_billing(rows)
    if not b['runs_api']: return 'est.; on a Google login'
    return f'est.: ${b["api"]:.2f} billed to a paid Gemini API key, ${b["login"]:.2f} on a Google login'

def gemini_billing_sentence(rows=None):
    b = gemini_billing(rows)
    if not b['runs_api']:
        return 'Gemini 4 Argon ran on a Google login: its dollars are est. (measured tokens × list price).'
    return (f'Gemini 4 Argon ran its first {b["runs_login"]} runs on a Google login (est. ${b["login"]:.2f}). When that login’s usage limit ran out, '
            f'the other {b["runs_api"]} runs were billed to a paid Gemini API key (est. ${b["api"]:.2f}). Its est. total is ${b["total"]:.2f} (measured tokens × list price), included in the four-harness total.')
