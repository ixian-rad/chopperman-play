#!/bin/bash
# usage: tools/deploy_netlify.sh [--draft] [--no-build-dist]
# Assembles ./dist from the site (game + site files only) and deploys it to Netlify as a PRODUCTION deploy (unless --draft), then prints the URL.
# Auth: the Netlify CLI login on this machine (netlify status), or NETLIFY_AUTH_TOKEN if set. The token is never printed.
# Site: SITE_NAME (default chopperman-play), created in team TEAM_SLUG (default: the CLI's only team) the first time; the id is then kept in .netlify/state.json.
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH
SITE_DIR=$(cd "$(dirname "$0")/.." && pwd); cd "$SITE_DIR"
SITE_NAME=${SITE_NAME:-chopperman-play}; PROD=--prod; [ "${1:-}" = "--draft" ] && PROD=""
command -v netlify >/dev/null || { echo "netlify CLI missing: npm install -g netlify-cli --prefix ~/.local" >&2; exit 2; }
AUTHARG=(); [ -n "${NETLIFY_AUTH_TOKEN:-}" ] && AUTHARG=(--auth "$NETLIFY_AUTH_TOKEN")
netlify status "${AUTHARG[@]}" >/dev/null 2>&1 || { echo "Not logged in to Netlify. Run 'netlify login' (browser approval) or export NETLIFY_AUTH_TOKEN." >&2; exit 3; }

if [ "${1:-}" != "--no-build-dist" ]; then
  rm -rf dist; mkdir dist
  tar -c --exclude=./.git --exclude=./dist --exclude=./.netlify --exclude=./tools --exclude=./DESIGN.md --exclude=./netlify.toml \
      --exclude=__pycache__ --exclude=./.gitignore --exclude='*.pyc' --exclude='./assets/fonts/*.ttf' . | tar -x -C dist
  # safety: refuse to publish anything private
  if find dist \( -iname '*alex*photo*' -o -iname 'faces_gpt*' -o -iname '*.env' -o -iname '*key*.txt' -o -iname 'spend.jsonl' \) | grep -q .; then echo "private-looking file in dist, aborting" >&2; exit 4; fi
fi
FILES=$(find dist -type f | wc -l); SIZE=$(du -sm dist | cut -f1); BIG=$(find dist -type f -size +20M | wc -l)
echo "dist: $FILES files, ${SIZE} MB, files over 20 MB: $BIG (Netlify: no total size cap, max 54,000 files per directory; keep files under ~10 MB if you can)"

# link or create the site
if [ ! -f .netlify/state.json ]; then
  TEAMARG=(); [ -n "${TEAM_SLUG:-}" ] && TEAMARG=(--account-slug "$TEAM_SLUG")
  netlify sites:create --name "$SITE_NAME" "${TEAMARG[@]}" "${AUTHARG[@]}" >/dev/null 2>&1 \
    || { echo "could not create '$SITE_NAME' (name taken?). Set SITE_NAME=<other> and retry." >&2; exit 5; }
  netlify link --name "$SITE_NAME" "${AUTHARG[@]}" >/dev/null 2>&1 || true
fi
OUT=$(netlify deploy $PROD --dir=dist --no-build --message "chopperman-play $(git rev-parse --short HEAD 2>/dev/null || echo manual)" --json "${AUTHARG[@]}")
printf '%s' "$OUT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("live:", d.get("url")); print("unique deploy:", d.get("deploy_url")); print("logs:", d.get("logs"))'
