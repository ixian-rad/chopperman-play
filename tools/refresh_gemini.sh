#!/bin/bash
# tools/refresh_gemini.sh [--no-push] [--no-live] [--no-netlify]
# Re-snapshots the Gemini 4 Argon build (in progress) from its PRIVATE GitHub remote, republishes it on the site, refreshes the numbers, and (unless told not to) pushes + live-checks.
# It never touches /workspace/chopperman/axe-gemini (the live driver's repo). Safe to rerun any time; with nothing new it just refreshes the est. cost numbers.
#   1. clone/fetch ixian-rad/chopperman-axe-gemini into /workspace/gemini-snap
#   2. pick refs: /gemini/ = tag assets-v2-release if it exists, else origin/main (latest published build);
#                 /classic/gemini/ = tag pre-assets (else origin/classic) once the classic freeze exists
#   3. copy game files only (driver/sync_play.sh), smoke-test locally (landing page + game loads, no console errors, text >= 16px); on failure the previous /gemini/ is restored
#   4. screenshot -> assets/shots/gemini/latest.webp ; python3 tools/build_blog.py (blog, card, scoreboard block, data/gemini.json from usage-gemini.csv + gemini-state.json)
#   5. commit + push to GitHub Pages, wait for the deploy, run the live checks on it
#   6. if the Netlify CLI is logged in and the site is linked: tools/deploy_netlify.sh and live-check the Netlify URL
# Exit code 0 = everything passed. Log: /workspace/chopperman/reports/gemini-site-refresh.log
set -uo pipefail
export PATH=$HOME/.local/bin:$PATH
SITE=$(cd "$(dirname "$0")/.." && pwd); CH=/workspace/chopperman; SNAP=/workspace/gemini-snap; REPO=ixian-rad/chopperman-axe-gemini
PAGES=https://ixian-rad.github.io/chopperman-play/; PUSH=1; LIVE=1; NETLIFY=1; RC=0
for a in "$@"; do case $a in --no-push) PUSH=0;; --no-live) LIVE=0;; --no-netlify) NETLIFY=0;; esac; done
LOG=$CH/reports/gemini-site-refresh.log; mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1
say() { echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*"; }
fail() { say "FAIL: $*"; RC=1; }
cd "$SITE"

say "== refresh_gemini start =="
# 1. snapshot
if [ ! -d "$SNAP/.git" ]; then git clone -q "https://github.com/$REPO.git" "$SNAP" || { fail "clone $REPO"; exit 1; }; fi
git -C "$SNAP" fetch -q --tags --prune --force origin || { fail "fetch $REPO"; exit 1; }
has_ref() { git -C "$SNAP" rev-parse -q --verify "$1^{commit}" >/dev/null 2>&1; }

# 2. refs
if has_ref refs/tags/assets-v2-release; then LIVE_REF=refs/tags/assets-v2-release; else LIVE_REF=origin/main; fi
CLASSIC_REF=""; if has_ref refs/tags/pre-assets; then CLASSIC_REF=refs/tags/pre-assets; elif has_ref origin/classic; then CLASSIC_REF=origin/classic; fi
COOP=false; has_ref origin/coop-v1 && COOP=true
say "live ref: $LIVE_REF ($(git -C $SNAP rev-parse --short $LIVE_REF)); classic ref: ${CLASSIC_REF:-none yet}; coop branch on remote: $COOP"

# 3. sync (keep a backup so a failed smoke test can be rolled back)
BK=$(mktemp -d); [ -d gemini ] && cp -r gemini "$BK/gemini"; [ -d classic/gemini ] && cp -r classic/gemini "$BK/classic-gemini"
SRC=$SNAP bash $CH/driver/sync_play.sh gemini "$LIVE_REF" "$SITE/gemini" >/dev/null || { fail "sync live"; exit 1; }
[ -n "$CLASSIC_REF" ] && { SRC=$SNAP bash $CH/driver/sync_play.sh gemini "$CLASSIC_REF" "$SITE/classic/gemini" >/dev/null || fail "sync classic"; }
rm -rf gemini/.git classic/gemini/.git
# BUILD.txt for the live build: describe by tag/commit as the others do
git -C "$SNAP" describe --tags --exact-match "$LIVE_REF" >/dev/null 2>&1 || true
cat > data/gemini-refs.json <<JSON
{"live_ref": "$LIVE_REF", "classic_ref": "${CLASSIC_REF}", "coop_branch": $COOP, "snapshot_at": "$(date '+%Y-%m-%d %H:%M %Z')", "remote": "private repo $REPO"}
JSON

# local smoke test on a throwaway server
PORT=$((20000 + RANDOM % 20000)); python3 -m http.server $PORT --directory "$SITE" >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$BK"' EXIT
sleep 1
GAMES=gemini
SHOT=$(mktemp --suffix=.png)
(cd $CH/driver && GEMINI_SHOT=$SHOT flock $CH/reports/.verify.lock node site-live-check-gemini.mjs http://localhost:$PORT/ --games=$GAMES > /tmp/gemini-local-check.json 2>&1); LRC=$?
if [ $LRC -ne 0 ]; then
  fail "local smoke test failed, restoring the previous /gemini/ and /classic/gemini/ (see /tmp/gemini-local-check.json)"; tail -8 /tmp/gemini-local-check.json
  rm -rf gemini classic/gemini; [ -d "$BK/gemini" ] && cp -r "$BK/gemini" gemini; [ -d "$BK/classic-gemini" ] && cp -r "$BK/classic-gemini" classic/gemini
else
  say "local smoke test passed"
  mkdir -p assets/shots/gemini
  python3 -c "from PIL import Image; Image.open('$SHOT').convert('RGB').resize((960,600)).save('assets/shots/gemini/latest.webp','WEBP',quality=80)" && say "screenshot updated"
fi
rm -f "$SHOT"

# 4. numbers + blog + card
python3 tools/build_blog.py >/dev/null || { fail "build_blog.py"; exit 1; }
say "blog/card rebuilt: $(python3 -c "import json;d=json.load(open('data/gemini.json'));print('est. \$%s, %s runs, phase %s, playable %s'%(d['cost_usd_est'],d['runs'],d['driver_phase'],(d['playable'] or {}).get('commit')))")"

# 5. commit + push
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  MSG="Gemini 4 Argon (in progress): live $(cat gemini/BUILD.txt | cut -d' ' -f2-), classic $( [ -f classic/gemini/BUILD.txt ] && cut -d' ' -f2- classic/gemini/BUILD.txt || echo none ); est. cost refreshed"
  git commit -q -m "$MSG" && say "committed: $MSG"
else say "nothing changed"; fi
if [ $PUSH -eq 1 ]; then
  git pull -q --rebase origin main 2>/dev/null; git push -q origin HEAD:main && say "pushed" || fail "git push"
  if [ $LIVE -eq 1 ]; then
    WANT=$(cat gemini/BUILD.txt)
    for i in $(seq 1 30); do GOT=$(curl -fsS "${PAGES}gemini/BUILD.txt?t=$(date +%s)" 2>/dev/null); [ "$GOT" = "$WANT" ] && break; sleep 20; done
    [ "$GOT" = "$WANT" ] && say "GitHub Pages is serving: $GOT" || fail "Pages did not serve the new build within 10 minutes (got: ${GOT:-nothing})"
    GL=claude,codex,deepseek,gemini
    (cd $CH/driver && flock $CH/reports/.verify.lock node site-live-check-gemini.mjs "$PAGES" --games=$GL > $CH/reports/gemini-site-live-pages.json 2>&1); R=$?
    tail -3 $CH/reports/gemini-site-live-pages.json | sed 's/^/  /'; [ $R -eq 0 ] && say "Pages live check PASS" || fail "Pages live check (see reports/gemini-site-live-pages.json)"
    (cd $CH/driver && SITE_URL=$PAGES flock $CH/reports/.verify.lock node site-live-check.mjs > $CH/reports/site-live-check-latest.json 2>&1) && say "driver/site-live-check.mjs ran (reports/site-live-check-latest.json)"
  fi
fi

# 6. Netlify (only if logged in and not disabled)
if [ $NETLIFY -eq 1 ] && [ $PUSH -eq 1 ]; then
  NST=$(netlify status 2>&1 || true)
  if [ -f .netlify/state.json ] && [[ "$NST" == *"Current Netlify User"* ]]; then
    OUT=$(bash tools/deploy_netlify.sh 2>&1); echo "$OUT" | sed 's/^/  /'
    NURL=$(echo "$OUT" | sed -n 's/^live: //p' | head -1)
    NCODE=$(curl -s -o /dev/null -w '%{http_code}' "$NURL/?t=$(date +%s)")
    if [ "$NCODE" = "401" ]; then say "WARN: $NURL answers 401 (Netlify login protection is on for this site), so the public live check was skipped. Deploy itself succeeded."
    elif [ -n "$NURL" ] && [ $LIVE -eq 1 ]; then
      (cd $CH/driver && flock $CH/reports/.verify.lock node site-live-check-gemini.mjs "$NURL" --games=claude,codex,deepseek,gemini > $CH/reports/gemini-site-live-netlify.json 2>&1); R=$?
      tail -3 $CH/reports/gemini-site-live-netlify.json | sed 's/^/  /'; [ $R -eq 0 ] && say "Netlify live check PASS ($NURL)" || fail "Netlify live check (see reports/gemini-site-live-netlify.json)"
    elif [ -z "$NURL" ]; then fail "Netlify deploy produced no URL"; fi
  else say "Netlify not linked/logged in: skipped (run tools/deploy_netlify.sh once)"; fi
fi
say "== refresh_gemini done, rc=$RC =="
exit $RC
