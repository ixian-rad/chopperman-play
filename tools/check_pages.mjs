// Check every site page (/, milestones/, results/, cost/) at desktop + mobile (+ tablet, wide) widths, plus the interactive parts.
// usage: flock /workspace/chopperman/reports/.verify.lock node tools/check_pages.mjs <baseURL> [outDir]     env VIEWS=desktop,mobile,tablet,wide
// Fails on: console/page errors, failed requests, text under 16 px, text contrast under 4.5:1 (solid backgrounds), tap targets under 44 px,
// horizontal overflow, broken/alt-less images, dead internal links or #anchors, and broken interactions (menu, ribbon, router, gallery, lightbox).
import { createRequire } from 'module';
import { existsSync, mkdirSync } from 'fs';
const require = createRequire(import.meta.url);
const PW = process.env.PW_CORE || ['/workspace/chopperman/driver/node_modules/playwright-core'].find(existsSync);
const { chromium } = require(PW);
const base = (process.argv[2] || 'http://localhost:8140/').replace(/\/?$/, '/');
const outDir = process.argv[3] || '/workspace/chopperman/reports/site-redesign/check';
mkdirSync(outDir, { recursive: true });
const PAGES = ['', 'milestones/', 'results/', 'cost/'];
const VIEWS = [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 768, height: 1024 }, { name: 'wide', width: 1920, height: 1080 }];
const only = (process.env.VIEWS || 'desktop,mobile,tablet,wide').split(',');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const fails = [], report = { base, pages: {}, interactions: {} };
const check = (ok, msg) => { if (!ok) fails.push(msg); return ok; };
const linkTargets = new Map(); // absolute url (no hash) -> Set(hash ids needed)

async function newPage(v) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: !!v.mobile, hasTouch: !!v.mobile });
  const page = await ctx.newPage();
  page._errs = []; page._bad = [];
  page.on('console', m => { if (m.type() === 'error') page._errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => page._errs.push(String(e).slice(0, 200)));
  page.on('requestfailed', r => { const t = (r.failure() || {}).errorText || ''; if (r.resourceType() === 'media' && /ABORTED/.test(t)) return; if (/ABORTED/.test(t) && /\.(webp|avif|png|jpg)/.test(r.url())) return; page._bad.push(r.url() + ' ' + t); });
  page.on('response', r => { if (r.status() >= 400) page._bad.push(r.status() + ' ' + r.url()); });
  return { ctx, page };
}

for (const v of VIEWS.filter(v => only.includes(v.name))) {
  for (const pg of PAGES) {
    const key = `${pg || 'home/'}${v.name}`;
    const { ctx, page } = await newPage(v);
    await page.goto(base + pg, { waitUntil: 'networkidle', timeout: 120000 });
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(600);
    await page.waitForFunction(() => [...document.images].filter(i => i.loading !== 'lazy' || i.getBoundingClientRect().width).every(i => i.complete), null, { timeout: 20000 }).catch(() => {});
    const a = await page.evaluate(() => {
      const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
      const bgOf = el => { const st = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a >= 1) break; } }
        let o = { r: 26, g: 20, b: 16 }; for (let i = st.length - 1; i >= 0; i--) { const c = st[i]; o = { r: c.r * c.a + o.r * (1 - c.a), g: c.g * c.a + o.g * (1 - c.a), b: c.b * c.a + o.b * (1 - c.a) }; } return o; };
      const res = { small: [], low: [], targets: [], minSize: 99 };
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), seen = new Set();
      while (w.nextNode()) {
        const el = w.currentNode.parentElement; if (!w.currentNode.textContent.trim() || seen.has(el)) continue; seen.add(el);
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('.sr-only, [hidden], dialog:not([open])')) continue;
        const fs = parseFloat(cs.fontSize); res.minSize = Math.min(res.minSize, fs);
        const label = el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' "' + w.currentNode.textContent.trim().slice(0, 40) + '"';
        if (fs < 16) res.small.push(fs + 'px ' + label);
        const fg = parse(cs.color);
        if (fg && !el.closest('.hero__copy')) { const L1 = lum(fg), L2 = lum(bgOf(el)); const cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); if (cr < 4.5) res.low.push(cr.toFixed(2) + ' ' + label); }
      }
      document.querySelectorAll('a, button, summary, input').forEach(t => {
        const r = t.getBoundingClientRect(); if (!r.width || t.closest('.sr-only, [hidden], dialog:not([open])')) return;
        if (t.matches('.skip')) return;
        if (t.closest('p, li:not(.chip), figcaption, dd, td, .callout')) { if (!t.matches('.btn, .shot__open, .pcard__alt a, .ribbon__x')) return; }
        if (r.height < 44 - 0.5 || r.width < 44 - 0.5) res.targets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${t.tagName} ${t.textContent.trim().slice(0, 30)}`);
      });
      res.overflowX = document.documentElement.scrollWidth - innerWidth;
      res.broken = [...document.images].filter(i => i.getAttribute('src') && i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src);
      res.noAlt = [...document.images].filter(i => !i.hasAttribute('alt')).map(i => i.src);
      res.height = document.documentElement.scrollHeight;
      res.ids = [...document.querySelectorAll('[id]')].map(e => e.id);
      res.links = [...document.querySelectorAll('a[href]')].map(a => a.href);
      res.current = [...document.querySelectorAll('.nav a[aria-current]')].map(a => a.textContent.trim() + '=' + a.getAttribute('aria-current'));
      res.builds = [...document.querySelectorAll('[data-build]')].map(e => e.textContent.trim());
      res.dupIds = res.ids.filter((x, i) => res.ids.indexOf(x) !== i);
      return res;
    });
    await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; }));
    await page.waitForFunction(() => [...document.images].filter(i => i.getAttribute('src')).every(i => i.complete), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(async () => { await Promise.all([...document.images].filter(i => i.getAttribute('src')).map(i => i.decode().catch(() => {}))); });
    await page.screenshot({ path: `${outDir}/${(pg || 'home/').replace('/', '')}-${v.name}-full.png`, fullPage: true });
    const here = new URL(base + pg).href;
    for (const l of a.links) {
      const u = new URL(l); if (!u.href.startsWith(new URL(base).origin)) continue;
      const noHash = u.origin + u.pathname + u.search;
      if (!linkTargets.has(noHash)) linkTargets.set(noHash, new Set());
      if (u.hash && u.hash.length > 1) linkTargets.get(noHash).add(decodeURIComponent(u.hash.slice(1)));
    }
    report.pages[key] = { height: a.height, minFont: a.minSize, under16: a.small.length, lowContrast: a.low.slice(0, 6), smallTargets: a.targets.slice(0, 8), overflowX: a.overflowX,
      broken: a.broken, noAlt: a.noAlt, errs: page._errs, bad: page._bad, current: a.current, builds: a.builds, dupIds: a.dupIds };
    check(!page._errs.length, `${key}: errors ${page._errs.slice(0, 2).join(' | ')}`);
    check(!page._bad.length, `${key}: failed requests ${page._bad.slice(0, 3).join(' | ')}`);
    check(!a.small.length, `${key}: ${a.small.length} text nodes under 16px, e.g. ${a.small[0]}`);
    check(!a.low.length, `${key}: low contrast ${a.low.slice(0, 2).join(' | ')}`);
    check(!a.targets.length, `${key}: small tap targets ${a.targets.slice(0, 3).join(' | ')}`);
    check(a.overflowX <= 0, `${key}: horizontal overflow ${a.overflowX}px`);
    check(!a.broken.length, `${key}: broken images ${a.broken.slice(0, 2).join(' ')}`);
    check(!a.noAlt.length, `${key}: images without alt`);
    check(!a.dupIds.length, `${key}: duplicate ids ${a.dupIds.join(',')}`);
    check(!a.builds.some(t => /^loading|^see /.test(t)), `${key}: a BUILD.txt did not load`);
    if (pg) check(a.current.length === 1 && /=page$/.test(a.current[0]), `${key}: nav aria-current=page missing (${a.current})`);
    await ctx.close();
  }
}

// every internal link resolves, and every #anchor exists on its target page
const { ctx: lctx, page: lp } = await newPage(VIEWS[0]);
report.links = {};
for (const [u, hashes] of linkTargets) {
  const r = await lp.request.get(u).catch(() => null); const st = r ? r.status() : 0;
  report.links[u.replace(base, '')] = st;
  check(st === 200, `link ${u} -> ${st}`);
  if (st === 200 && hashes.size && /\.html?$|\/$|\?/.test(u)) {
    const html = await r.text();
    for (const h of hashes) {
      const inHtml = html.includes(`id="${h}"`);
      if (!inHtml) { await lp.goto(u + '#' + h, { waitUntil: 'load' }); const ok = await lp.evaluate(id => !!document.getElementById(id), h); check(ok, `anchor #${h} missing on ${u}`); }
    }
  }
}
await lctx.close();

// interactions
const I = report.interactions;
{ // old anchors redirect
  const { ctx, page } = await newPage(VIEWS[0]);
  for (const [from, to] of [['#reviews', 'results/#reviews'], ['#behind-the-build', 'cost/#log'], ['#scores', 'results/#scores'], ['#cost', 'cost/'], ['#round1', 'results/#round1'], ['#sb-gemini', 'cost/#gemini-cost']]) {
    await page.goto(base + from, { waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForLoadState('load').catch(() => {}); await page.waitForTimeout(1200);
    const got = page.url().replace(base, '');
    I['redirect ' + from] = got; check(got === to, `old anchor ${from} -> ${got}, expected ${to}`);
    if (from === '#round1') { I.round1Open = await page.evaluate(() => !!(document.getElementById('round1') || {}).open); check(I.round1Open, '#round1 details not opened'); }
  }
  for (const same of ['#v2', '#games', '#classic', '#gemini', '#coop', '#intro', '#about']) {
    await page.goto(base + same, { waitUntil: 'load' });
    const ok = page.url() === base + same && await page.evaluate(id => !!document.getElementById(id), same.slice(1)); check(ok, `home anchor ${same} broken`);
  }
  // scroll-spy
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => document.getElementById('glance').scrollIntoView({ block: 'center', behavior: 'instant' })); await page.waitForTimeout(500);
  I.spyResults = await page.evaluate(() => (document.querySelector('.nav a[data-nav="results"]') || {}).getAttribute?.('aria-current'));
  check(I.spyResults === 'location', 'scroll-spy did not mark Results');
  await page.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'center', behavior: 'instant' })); await page.waitForTimeout(500);
  I.spyPlay = await page.evaluate(() => document.querySelector('.nav a[data-nav="play"]').getAttribute('aria-current'));
  check(I.spyPlay === 'location', 'scroll-spy did not mark Play');
  // ribbon dismiss persists
  await page.click('.ribbon__x'); await page.reload({ waitUntil: 'load' });
  I.ribbonHiddenAfterDismiss = await page.evaluate(() => getComputedStyle(document.querySelector('.ribbon')).display === 'none');
  check(I.ribbonHiddenAfterDismiss, 'ribbon dismissal did not persist');
  await ctx.close();
}
{ // mobile menu + auto-hide bar
  const { ctx, page } = await newPage(VIEWS[1]);
  await page.goto(base, { waitUntil: 'load' });
  I.barHeight = await page.evaluate(() => document.getElementById('topbar').getBoundingClientRect().height);
  check(I.barHeight <= 57, `mobile bar is ${I.barHeight}px tall`);
  await page.click('.menubtn');
  I.menuOpen = await page.evaluate(() => !document.getElementById('sheet').hidden && document.querySelector('.menubtn').getAttribute('aria-expanded') === 'true' && document.getElementById('sheet').contains(document.activeElement));
  check(I.menuOpen, 'menu did not open with focus inside');
  for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
  I.focusTrapped = await page.evaluate(() => document.getElementById('topbar').contains(document.activeElement));
  check(I.focusTrapped, 'focus escaped the open menu');
  await page.keyboard.press('Escape');
  I.menuClosedByEsc = await page.evaluate(() => document.getElementById('sheet').hidden && document.activeElement === document.querySelector('.menubtn'));
  check(I.menuClosedByEsc, 'Esc did not close the menu / return focus');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.wheel(0, 900); await page.waitForTimeout(600); await page.mouse.wheel(0, 300); await page.waitForTimeout(600);
  I.barHidesOnScrollDown = await page.evaluate(() => document.getElementById('topbar').classList.contains('is-hidden'));
  await page.mouse.wheel(0, -200); await page.waitForTimeout(600);
  I.barReturnsOnScrollUp = await page.evaluate(() => !document.getElementById('topbar').classList.contains('is-hidden'));
  check(I.barHidesOnScrollDown && I.barReturnsOnScrollUp, 'mobile bar auto-hide');
  // milestones on mobile: tabs + one timeline
  await page.goto(base + 'milestones/', { waitUntil: 'load' });
  await page.click('#tab-claude');
  I.mobileTab = await page.evaluate(() => ({ claude: getComputedStyle(document.getElementById('tl-claude')).display, codex: getComputedStyle(document.getElementById('tl-codex')).display, grid: getComputedStyle(document.getElementById('ms-grid')).display, url: location.search }));
  check(I.mobileTab.claude === 'block' && I.mobileTab.codex === 'none' && I.mobileTab.grid === 'none', 'mobile milestone tabs');
  await ctx.close();
}
{ // milestones desktop: view toggle, URL state, lightbox, compare
  const { ctx, page } = await newPage(VIEWS[0]);
  await page.goto(base + 'milestones/', { waitUntil: 'load' });
  await page.click('.ms-grid figure[data-row="assets"] .shot__open');
  await page.waitForTimeout(400);
  I.lightbox = await page.evaluate(() => ({ open: document.getElementById('lightbox').open, count: document.querySelector('.lightbox__count').textContent, src: document.querySelector('.lightbox__img').getAttribute('src') }));
  check(I.lightbox.open && /\/ /.test(I.lightbox.count), 'lightbox did not open');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
  I.lightboxNext = await page.evaluate(() => document.querySelector('.lightbox__count').textContent);
  check(I.lightboxNext !== I.lightbox.count, 'lightbox ArrowRight did nothing');
  await page.click('[data-lb="compare"]'); await page.waitForTimeout(400);
  I.compare = await page.evaluate(() => ({ on: document.querySelector('.lightbox__stage').classList.contains('is-cmp'), label: document.querySelector('.lightbox__cmplabel').textContent, loaded: [...document.querySelectorAll('.lightbox__stage img')].every(i => i.hidden || (i.complete && i.naturalWidth === 1280)) }));
  check(I.compare.on && I.compare.loaded, 'compare slider');
  await page.screenshot({ path: `${outDir}/milestones-lightbox-desktop.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  I.lightboxFocusReturn = await page.evaluate(() => !document.getElementById('lightbox').open && !!document.activeElement.closest('.shot'));
  check(I.lightboxFocusReturn, 'lightbox close / focus return');
  await page.click('.seg button[data-view="harness"]'); await page.waitForTimeout(200);
  I.harnessView = await page.evaluate(() => ({ url: location.search, grid: getComputedStyle(document.getElementById('ms-grid')).display, tl: getComputedStyle(document.getElementById('tl-codex')).display }));
  check(/view=harness/.test(I.harnessView.url) && I.harnessView.grid === 'none' && I.harnessView.tl === 'block', 'one-harness view');
  await page.click('#tab-gemini'); await page.goBack(); await page.waitForTimeout(200);
  I.backButton = await page.evaluate(() => location.search + ' ' + getComputedStyle(document.getElementById('tl-codex')).display);
  check(/h=codex/.test(I.backButton) || / block$/.test(I.backButton), 'Back button did not restore the previous harness');
  await page.goto(base + 'milestones/?view=harness&h=deepseek', { waitUntil: 'load' });
  I.deepLink = await page.evaluate(() => getComputedStyle(document.getElementById('tl-deepseek')).display);
  check(I.deepLink === 'block', 'deep link ?view=harness&h=deepseek');
  await page.evaluate(() => { const d = document.querySelector('#tl-deepseek details.film'); d.open = true; d.scrollIntoView(); }); await page.waitForTimeout(1500);
  I.filmLoaded = await page.evaluate(() => [...document.querySelectorAll('#tl-deepseek .film img')].filter(i => i.complete && i.naturalWidth > 0).length);
  check(I.filmLoaded > 0, 'filmstrip images');
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
console.log(fails.length ? 'FAIL\n' + fails.map(f => ' - ' + f).join('\n') : 'PASS');
process.exit(fails.length ? 1 : 0);
