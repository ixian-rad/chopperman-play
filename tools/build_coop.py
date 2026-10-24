#!/usr/bin/env python3
"""Co-op + proximity voice chat section (published 2026-10-23 after the coop-v1 merges). Writes the block between <!-- COOP START/END --> in home/index.html
(the main page, after the Play picker) and data/coop.json. Sources: reports/voice/<h>/release-main-result.json (release verify on the merged main),
reports/usage.csv (coop-v1 rows), <site>/<h>/BUILD.txt. Idempotent; safe to rerun."""
import csv, json, os, re, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sitepaths import rebase, HOME, HOME_ROOT
CH = '/workspace/chopperman'; SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); E = html.escape
H = ['codex', 'claude', 'deepseek']
NAME = {'claude': 'Claude Code', 'codex': 'Codex CLI', 'deepseek': 'DeepSeek Harness'}
TITLE = {'claude': 'Backyard Log Splitter', 'codex': 'Backyard: Find the grain', 'deepseek': 'American Split'}
rows = [r for r in csv.DictReader(open(f'{CH}/reports/usage.csv')) if r['phase'].startswith('coop-v1')]
data = {}
for h in H:
    rr = [r for r in rows if r['harness'] == h]
    try: v = json.load(open(f'{CH}/reports/voice/{h}/release-main-result.json'))['combined']
    except Exception: v = {}
    b = (open(f'{SITE}/{h}/BUILD.txt').read().split() + ['', '', ''])[:3]
    data[h] = dict(build=dict(commit=b[1], tag=b[2]), verify_ok=v.get('ok'), v2_ok=v.get('v2_ok'), coop_voice_ok=v.get('coop_ok'), fps=v.get('fps'),
                   module_tests=v.get('module_tests'), game_tests=v.get('tests'),
                   runs=len(rr), wall_h=round(sum(float(r['wall_s'] or 0) for r in rr) / 3600, 2), cost_usd=round(sum(float(r['cost_usd'] or 0) for r in rr), 2),
                   cost_basis=sorted({r['cost_basis'] for r in rr}))
json.dump(dict(note='Release verify on the merged main: driver/v2/check_v2.mjs + driver/coop/check_coop.mjs --voice (loopback backend) + the voice module node tests, headless Chrome with SOFTWARE rendering (no GPU). FPS are software-GL figures.',
               harness=data), open(f'{SITE}/data/coop.json', 'w'), indent=1)

def fps(f): return 'n/a' if not f else f"{f.get('nj_low')} / {f.get('tiraspol_low')} / {f.get('tiraspol_high')}"
def chk(x): return 'passed' if x else ('failed' if x is False else 'n/a')
trs = ''.join(f'<tr><th scope="row">{NAME[h]}</th><td class="txt">{E(TITLE[h])}</td><td class="mono">{E(d["build"]["commit"])}</td><td>{chk(d["verify_ok"])}</td><td>{fps(d["fps"])}</td>'
              f'<td class="txt">{d["runs"]} runs, {d["wall_h"]:.2f} h, ${d["cost_usd"]:.2f}</td></tr>' for h, d in data.items())
cards = ''.join(f'<li><a class="btn btn--play" href="{h}/"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 3 L17 10 L5 17 Z"/></svg><span><em>Play co-op </em><b>{NAME[h].split()[0]} </b><small>{E(TITLE[h])}</small></span></a></li>' for h in H)
# Gemini 4 Argon joined later: once it tags coop-voice-release (data/milestones.json, from tools/build_milestones.py) the lede says "all four".
def _gem_coop():
    try: return json.load(open(f'{SITE}/data/milestones.json'))['harness']['gemini']['cells']['coop']['state'] == 'ok'
    except Exception: return False
LEDE = ('All four games, Codex, Claude Code, DeepSeek and Gemini 4 Argon, now have two-player online co-op, with optional voice chat that gets quieter the farther apart you are. All four got the same co-op brief, then the same voice chat brief.'
        if _gem_coop() else
        'The Codex, Claude Code and DeepSeek games now have two-player online co-op, with optional voice chat that gets quieter the farther apart you are. Those three got the same co-op brief, then the same voice chat brief. Gemini 4 Argon joined later; its co-op version is not finished yet.')
block = f"""<section class="section" id="coop" aria-labelledby="coop-title">
  <div class="wrap">
    <p class="kicker">Play together</p>
    <h2 id="coop-title">Online co-op and proximity voice chat</h2>
    <p class="lede">{LEDE}</p>
    <ul class="v2facts">
      <li><strong>Two players, one yard.</strong> Fell trees together. Damage adds up on the same tree, and it falls on both screens.</li>
      <li><strong>Shared rewards.</strong> Whoever chops the tree or splits the log gets the full XP and coins, and the partner gets half. Each player keeps their own save.</li>
      <li><strong>Pick a character.</strong> Each player can play Sergey or Alex, in either of his two outfits.</li>
      <li><strong>Proximity voice chat.</strong> It’s off until you turn it on. Close up it’s full volume, then it fades to silence about 25 m away.</li>
    </ul>
    <h3 class="h-mid">How to play co-op</h3>
    <ol class="coop-steps">
      <li><strong>Open the Co-op menu.</strong> Click <strong>Co-op</strong> in the game. It’s there at launch and during play.</li>
      <li><strong>Host.</strong> One player picks <strong>Host a game</strong> and gets a 5-character room code. Send the code to your friend, or use <strong>Copy invite link</strong>.</li>
      <li><strong>Join.</strong> The other player opens the same game, types the code into the Co-op menu and clicks <strong>Join</strong>. An invite link fills in the code for you, but you still click Join.</li>
      <li><strong>Voice (optional).</strong> Turn on <strong>Proximity voice chat</strong> in the Co-op menu, before you host or join or at any time later. Each player has to opt in and allow microphone access when the browser asks. With it off, the game never touches your microphone.</li>
    </ol>
    <p class="v2note"><strong>Connection notes.</strong> Co-op is peer-to-peer (WebRTC). It uses the free PeerJS cloud server only to introduce the two browsers, and STUN to find a route between them. There is no relay (TURN) server, so players behind a strict NAT, such as some office, school or mobile networks, may not be able to connect. It works best in two different browsers or on two devices. Two tabs of the same browser on one machine also work for a quick try.</p>
    <ul class="playrow playrow--3" aria-label="Play the co-op builds">{cards}</ul>
    <details class="coop-check"><summary>Release check: automated test results on the merged builds</summary>
    <div class="tablewrap" role="region" aria-label="Co-op release check, scrollable" tabindex="0"><table class="blogtable"><caption class="sr-only">Co-op and voice chat: release check on the merged build</caption><thead><tr>
      <th scope="col">Harness</th><th scope="col">Game</th><th scope="col">Build</th><th scope="col">Automated check</th><th scope="col">FPS NJ low / Tiraspol low / Tiraspol high</th><th scope="col">Co-op + voice rounds</th></tr></thead><tbody>{trs}</tbody></table></div>
    <p class="fine">The check ran on each merged build after release. It replays the Assets v2 check, plays a full two-player co-op session including every voice chat step, and runs the voice module’s 360 unit checks. It ran in headless Chrome with software rendering and no GPU, so FPS are far below what a real graphics card gives. Voice was tested with a simulated microphone, and the two players were linked by an in-page loopback, not a real network. Round costs are in the totals under <a href="cost/">The bill</a>. Claude’s are reported by the tool, and Codex’s and DeepSeek’s are token-priced (list-price equivalents).</p></details>
  </div>
</section>"""
block = rebase(block, HOME_ROOT)  # fragment links are written from the site root
p = HOME; s = open(p).read()
start, end = '<!-- COOP START', '<!-- COOP END -->'
blk = f'{start} (generated by tools/build_coop.py) -->\n{block}\n{end}'
if start in s: s = re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda m: blk, s, flags=re.S)
else:
    anchor = '<!-- ============================== ASSETS V2'
    assert anchor in s; s = s.replace(anchor, blk + '\n\n' + anchor, 1)
open(p, 'w').write(s)
print(json.dumps(data, indent=1))
