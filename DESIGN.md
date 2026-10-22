# Chopperman landing page: design notes

## Concept: "The chopping block at golden hour"

The site is a backyard woodpile at sunset. You arrive at a chopping block with an axe already bitten into the round, chips in the air, and three Play buttons. Everything after that is laid out like a well-kept workshop: plank-dark panels, bark edges and saw-tooth dividers between sections, and growth rings in the background.

The visual language comes from the earlier **Grain & Gravity** channel kit (same palette and fonts), so the reviews and the site read as one family. Chopperman gets its own mark, though. Grain & Gravity is a face-on split round inside a blueprint protractor. Chopperman is a **3/4-view chopping block** with the axe stuck in the top, set against a golden-hour treeline inside a cedar-rimmed badge.

- **Wood carries the brand.** Charcoal, heartwood, cedar and sapwood are used for surfaces and type.
- **Ember marks where the eye should land.** It is used for Play buttons, score rings and chip streaks.
- **Cyan means measurement.** It is used only for commit hashes, the physics icon and focus rings.
- **Text sits on solid colour.** The hero copy has a 90–95% charcoal scrim behind it. On phones the illustration moves above the text instead of behind it.

## Palette

| Role | Name | Hex | Use |
|---|---|---|---|
| Page background | Charcoal Bark | `#1A1410` | body, table heads |
| Alt section | (Bark 2) | `#221A14` | Scores and Cost sections |
| Panels | (Panel) | `#2A2019` | cards, reviews, tables |
| Deep wood | Heartwood | `#5A2F17` | logo extrusion, bark |
| Mid wood | Cedar | `#B5652B` | rules and borders only (too dark for text) |
| Light wood | Sapwood | `#E8C38A` | labels, kickers, secondary buttons |
| Accent | Ember | `#F2862E` | CTAs, score rings, bars |
| Text | Chalk | `#F4EDE1` | primary text |
| Muted text | (Muted) | `#D9CBB8` | ledes, fine print (about 11:1 on Bark) |
| Data | Blueprint Navy / Cyan | `#0E2A47` / `#5CC8F2` | snapshot call-out, hashes, focus ring |
| Status | Good / Warn | `#8FD694` / `#FFC56B` | pros, cheapest cost; "not re-reviewed" flags |

Contrast for key pairs (WCAG): Chalk on Bark is about 16:1, Sapwood on Bark about 11:1, Ember on Bark about 7.4:1, Bark on Ember (button text) about 7.4:1, and Cyan on Bark about 9:1.

## Type

Fonts are self-hosted from `assets/fonts/web/` as WOFF files subset to Latin with fontTools (`pyftsubset`) and loaded with `font-display: swap`. WOFF2 wasn't possible because the `brotli` module isn't installed and couldn't be pip-installed. The original TTFs are untouched. The Source Sans 3 subset keeps its `wght` 200–900 axis.

| Role | Family | Size |
|---|---|---|
| Display (h2, card and review titles, wordmark) | Alfa Slab One | h2 `clamp(32px … 52px)`, h3 24–40px |
| Labels, kickers, buttons (caps, tracked) | Barlow Condensed 600/700 | 17–26px (score-ring words 15px) |
| Body | Source Sans 3 (variable, weight 400–600) | **18px**, line-height 1.6; ledes 20px |
| Numbers, hashes | IBM Plex Mono 500 | 16–22px (never below 16px inline) |

Prose is capped at 62–72ch. No body text uses a weight below 400.

## Files I created

### Identity: `assets/brand/` (made with `tools/build_brand.py`)
All SVGs are hand-built geometry written by the Python script. Text is converted to outlines with fontTools (`tools/textpath.py`, carried over from the channel kit), so nothing depends on installed fonts. Random detail (ring wobble, pine shapes, chips) uses fixed seeds, so every rebuild is identical.

| File | Size | What / how |
|---|---|---|
| `logo.svg` | 52 KB | Horizontal logo, 1200×340. Emblem plus the "CHOPPERMAN" wordmark in Alfa Slab One outlines with a three-step heartwood extrusion. "CHOP" is in chalk and "PERMAN" in sapwood. A V-shaped axe bite is masked out of the top of the **O**, with two chips and ember streaks leaving it. Tagline "THREE AIs · ONE AXE" in Barlow Condensed outlines between cedar rules (the tagline is the Round 1 video title). |
| `logo-mark.svg` | 33 KB | Square emblem, 512×512. Cedar-rimmed badge with a golden-hour glow and pine treeline. A 3/4-view chopping block with a bark side, wobbly growth rings, an off-centre pith, radial checks and a split running toward the viewer. A steel axe head is clipped along an entry line so the bit looks buried. The hickory handle breaks out of the badge, and three chips fly off with motion streaks. |
| `favicon.svg` | 1 KB | Simplified 64×64 version: block, two rings, axe and one ember chip. |
| `logo.png` | 130 KB | 1200×340 transparent render of `logo.svg` (made with `tools/render.mjs`). |
| `og-image.png` | 461 KB | 1200×630 social card: hero art, scrim, logo, one-line pitch and three ember tags. Built from `tools/og.html` in headless Chrome. |
| `poster-review-v2.jpg` | 65 KB | 960×540 video poster. A frame at 1:31 of the v2 review is darkened under a gradient, with the emblem and the title "Chopperman: Round Two" on top (`tools/poster.html`). |
| `hero.svg` | 188 KB | 1920×1080 golden-hour backyard. Gradient sky, sun with glow and 11 light rays, a hazy far ridge with about 60 procedural pines, a mid treeline, a haze band and a split-rail fence. A woodpile of end-grain discs, dark framing pines, the chopping block with the axe (reusing the emblem geometry), two split halves, scattered chips and dust motes, plus a vignette. |
| `divider-logedge.svg` | 7 KB | Bark-edge band (heartwood, cedar sapwood line, furrows) under the hero. |
| `divider-sawtooth.svg` | <1 KB | One tooth, used as a repeating CSS `mask` so the teeth take the colour of the section above. |
| `band-woodgrain.svg` | 44 KB | Plank band with knots and grain lines, used along the top edge of the footer. |
| `texture-woodgrain.svg` | 44 KB | Seamless 480px grain tile (lines periodic in x) at low contrast behind the whole page. |
| `texture-endgrain.svg` | 67 KB | Large ring-and-check field, faded behind the Reviews section. |
| `icon-gameplay.svg`, `icon-graphics.svg`, `icon-physics.svg`, `icon-sound.svg`, `icon-cost.svg` | about 0.5 KB each | 48px line icons: target rings with an axe, a framed pine scene with a sun, a dashed cyan trajectory with a vector, a speaker with ember waves, and a coin stack. |

The `assets/brand/` total is about 1.09 MB, under the 1.5 MB budget. Most of that is the two PNG/JPG renders; the SVGs add up to about 0.5 MB.

### Derived web images (re-encoded from the supplied captures; the originals are unchanged)
- `assets/shots/web/*.webp`: the six game screenshots at 960×600, WebP q80, 27–50 KB each.
- `assets/stills/*.webp`: the four review stills at 1280×720, WebP q82, 44–75 KB each.

### Code
- `index.html`, `assets/site.css`, `assets/site.js`. No frameworks and no external requests.
  - `site.js` fetches `codex/BUILD.txt`, `claude/BUILD.txt` and `deepseek/BUILD.txt` at runtime, so each card shows the live commit and tag.
  - It also fetches `data/costs.json` and renders the scoreboard cost rows, a cost-per-agent-hour bar chart, the full cost table, the basis notes and the "generated" timestamp. Nothing about cost is hard-coded in the HTML. The cheapest-per-hour harness is computed, and the "by far" wording only appears if it is at least 2× cheaper than the next harness.
  - It highlights the best value in each scoreboard row (no highlight when all values tie).
- `tools/build_brand.py` and `tools/textpath.py` generate the SVGs.
- `tools/render.mjs` renders SVG or HTML to PNG with headless Chrome.
- `tools/og.html` and `tools/poster.html` are the templates for the social card and the video poster.
- `tools/verify.mjs` runs the QA and audit below.
- The Playwright path given in the brief (`/workspace/chopperman/driver/node_modules/playwright-core`) doesn't exist on this box. The scripts use `/var/tmp/sand-playwright-runtime/…/playwright-core` instead; you can override it with the `PW_CORE` environment variable.

Rebuild everything:
```bash
python3 tools/build_brand.py
node tools/render.mjs assets/brand/logo.svg assets/brand/logo.png 1200 340
node tools/render.mjs tools/og.html assets/brand/og-image.png 1200 630
python3 -m http.server 8140 & node tools/verify.mjs http://localhost:8140/ /workspace/recordings/site
```

## Content sources
Every score, quote, number and build ID comes from the operator's fact sheet (SOURCES.md, kept out of this public repo), `/workspace/recordings/v2/review-script.md` (the main review: condensed paragraphs, pros and cons, verdicts, method and caveats) or `/workspace/recordings/review-script.md` (the Round 1 section and the "then" half of then-vs-now). The page makes these points explicitly:
- DeepSeek was reviewed at `c1204da`, before its multi-agent parallel upgrade. The upgraded build on the site has not been re-reviewed. This is stated on its card, in the snapshot call-out and in its review.
- The later audio and legibility updates to Claude and Codex were not reviewed.

## Legibility and QA results (`tools/verify.mjs`, Chrome headless)

These are the results from the last run, at 1280×720, 390×844, 768×1024 and 1920×1080, with all `<details>` sections expanded:

| Check | Result |
|---|---|
| Console errors | **0** at all four sizes |
| Failed requests | **0**. The MP4 range request that Chrome aborts after reading metadata (`preload="metadata"`) is normal and excluded from the count. |
| Broken images | 0 |
| Horizontal overflow | 0 px at all sizes |
| Body text | 18px, line-height 28.8px (1.6) |
| Smallest visible text | **15px**. Nothing on the page is under 15px. |
| Text under 16px | Desktop, tablet and wide: only the three score-ring words ("Great", "Good", "Okay") at 15px, Barlow Condensed Bold, sapwood on charcoal (about 11:1). Mobile adds nine 15px labels in the scoreboard: model sub-labels, score words and the "iter · hash" cells, all at 9:1 or better. |
| Contrast below 4.5:1 | 0 elements (each text colour checked against its composited background colour). Hero copy sits on a 90–95% charcoal scrim (desktop) or solid charcoal (phone). |
| Tap targets under 44px | 0. Buttons are at least 52px tall, hero Play buttons 72px, nav links 48px, `<summary>` 48px. |
| Prose lines over about 80 characters | 0 |
| Play links | `codex/`, `claude/` and `deepseek/` all return **HTTP 200**, as do all three `BUILD.txt` files, `data/costs.json` and the MP4 |
| Fonts loaded | Alfa Slab One 400, Barlow Condensed 600/700, Source Sans 3 200–900, IBM Plex Mono 500 |

Other accessibility details:
- A skip link and semantic landmarks (`header`, `nav`, `main`, `footer`).
- One `h1` (the logo, with alt text "Chopperman"), then `h2` per section, `h3` per game or review and `h4` for pros and cons.
- Score rings have `role="img"` with a spoken label, and decorative imagery has empty `alt`.
- Then-vs-now and scorecard stills have descriptive alt text.
- Focus is shown as a 3px cyan outline with an offset.
- The drifting hero chips and smooth scrolling are only enabled under `prefers-reduced-motion: no-preference`.

Screenshots: `/workspace/recordings/site/site-desktop-full.png` and `site-mobile-full.png`. The same run also saved `site-tablet-full.png` and `site-wide-full.png`.
