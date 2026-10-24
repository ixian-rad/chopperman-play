// Verify the landing page: console errors, failed requests, screenshots,
// font-size + contrast audit, horizontal overflow, tap targets, Play links.
// usage: node tools/verify.mjs [baseURL] [outDir]   (baseURL = the splash at the site root; add home/ for the main page)
import { createRequire } from 'module';
import { existsSync } from 'fs';
const require = createRequire(import.meta.url);
const PW = process.env.PW_CORE || ['/workspace/chopperman/driver/node_modules/playwright-core',
  '/var/tmp/sand-playwright-runtime/45fa28ccf0c8b5450c0176ea24d08476/node_modules/playwright-core'].find(existsSync);
const { chromium } = require(PW);
const base = process.argv[2] || 'http://localhost:8140/';
const outDir = process.argv[3] || '/workspace/recordings/site';
const prefix = process.env.SHOT_PREFIX || 'site-v2';
// The intro video is still being produced; a missing MP4 is the one allowed failure.
const ALLOWED_MISSING = /assets\/video\/chopperman-intro-web\.mp4/;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const views = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'wide', width: 1920, height: 1080 },
];
const only = (process.env.VIEWS || '').split(',').filter(Boolean);
const report = {};
for (const v of views.filter(v => !only.length || only.includes(v.name))) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 1, isMobile: !!v.mobile, hasTouch: !!v.mobile });
  const page = await ctx.newPage();
  const errors = [], failed = [], allowed = [];
  page.on('console', m => { if (m.type() !== 'error') return; const u = (m.location() || {}).url || ''; if (ALLOWED_MISSING.test(u) || ALLOWED_MISSING.test(m.text())) { allowed.push('console: ' + m.text()); return; } errors.push(m.text() + ' @ ' + u); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('requestfailed', r => { if (r.resourceType() === 'media' && /ERR_ABORTED/.test(r.failure() && r.failure().errorText)) return; (ALLOWED_MISSING.test(r.url()) ? allowed : failed).push(r.url() + ' ' + (r.failure() && r.failure().errorText)); });
  page.on('response', r => { if (r.status() >= 400) (ALLOWED_MISSING.test(r.url()) ? allowed : failed).push(r.url() + ' HTTP ' + r.status()); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  await page.evaluate(async () => { // trigger lazy images
    for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
  const audit = await page.evaluate(() => {
    const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
    const bgOf = el => { // composite background colours up the tree (ignores images; hero copy has its own scrim)
      const stack = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
      let out = { r: 26, g: 20, b: 16 };
      for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) }; }
      return out;
    };
    const res = { small: [], under14: [], lowContrast: [], sizes: {}, textCount: 0, minSize: 99, smallTargets: [] };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (seen.has(el)) continue; seen.add(el);
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('.sr-only') || el.closest('[aria-hidden="true"]')) continue;
      const fs = parseFloat(cs.fontSize); res.textCount++;
      res.sizes[fs] = (res.sizes[fs] || 0) + 1; res.minSize = Math.min(res.minSize, fs);
      const label = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' "' + n.textContent.trim().slice(0, 40) + '"';
      if (fs < 16) res.small.push(`${fs}px ${cs.fontWeight} ${label}`);
      if (fs < 14) res.under14.push(`${fs}px ${label}`);
      const fg = parse(cs.color); const bg = bgOf(el);
      if (fg && !el.closest('.hero__copy')) {
        const L1 = lum(fg), L2 = lum(bg); const cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
        if (cr < 4.5) res.lowContrast.push(`${cr.toFixed(2)} ${label}`);
      }
    }
    document.querySelectorAll('a, button, summary, video').forEach(a => {
      const r = a.getBoundingClientRect(); if (!r.width) return;
      if (a.closest('.prose, .fine, .callout, .card__build, p')) return; // inline text links are exempt
      if (r.height < 44 || r.width < 44) res.smallTargets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${a.tagName} ${a.textContent.trim().slice(0, 30)}`);
    });
    // long-line check on prose paragraphs: characters per line approx
    const longLines = [];
    document.querySelectorAll('p, li').forEach(p => {
      const r = p.getBoundingClientRect(); if (!r.width) return;
      const fs = parseFloat(getComputedStyle(p).fontSize);
      const cpl = r.width / (fs * 0.5);
      if (cpl > 80 && p.textContent.length > 120) longLines.push(`${Math.round(cpl)}cpl ${p.textContent.trim().slice(0, 40)}`);
    });
    res.longLines = longLines;
    res.brokenImages = [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src);
    res.overflowX = document.documentElement.scrollWidth - window.innerWidth;
    res.builds = [...document.querySelectorAll('[data-build]')].map(e => e.textContent);
    res.costCells = [...document.querySelectorAll('#cost-table td')].slice(0, 9).map(e => e.textContent);
    res.v2 = [...document.querySelectorAll('.v2data')].map(e => e.innerText.slice(0, 160).replace(/\n+/g, ' | '));
    res.balance = (document.getElementById('cost-balance') || {}).textContent;
    res.imgsNoAlt = [...document.images].filter(i => !i.hasAttribute('alt')).map(i => i.src);
    res.minLineHeightRatio = Math.min(...[...document.querySelectorAll('p, li, dd, figcaption')].filter(e => e.getBoundingClientRect().width).map(e => { const cs = getComputedStyle(e); return parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) || 9; })).toFixed(2);
    res.bodyFont = getComputedStyle(document.body).fontSize + ' / ' + getComputedStyle(document.querySelector('.prose p')).lineHeight;
    res.fontsLoaded = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight);
    return res;
  });
  // Text over the hero image: hide the hero text, screenshot, and test each text run against every pixel behind it.
  await page.evaluate(() => window.scrollTo(0, 0));
  const runs = await page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.querySelector('.hero__copy'), NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode; if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const col = getComputedStyle(n.parentElement).color;
      for (const r of rg.getClientRects()) if (r.width > 2) out.push({ t: n.textContent.trim().slice(0, 30), color: col, x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height });
    }
    return out;
  });
  await page.addStyleTag({ content: '.hero__copy, .hero__copy * { color: transparent !important; text-shadow: none !important; } .hero__copy svg, .hero__copy img { visibility: hidden !important; }' });
  await page.waitForTimeout(100);
  const heroBox = await page.evaluate(() => { const r = document.querySelector('.hero').getBoundingClientRect(); return { x: 0, y: r.top + window.scrollY, width: Math.min(r.width, window.innerWidth), height: r.height }; });
  const png = (await page.screenshot({ clip: heroBox })).toString('base64');
  const heroContrast = await page.evaluate(async ({ png, runs, heroBox }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const lum = (r, gg, b) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(gg) + .0722 * f(b); };
    const res = [];
    for (const run of runs) {
      const m = run.color.match(/\d+(\.\d+)?/g).map(Number); const Lf = lum(m[0], m[1], m[2]);
      const x0 = Math.max(0, Math.floor(run.x)), y0 = Math.max(0, Math.floor(run.y - heroBox.y)), w = Math.min(c.width - x0, Math.ceil(run.w)), h = Math.min(c.height - y0, Math.ceil(run.h));
      if (w <= 0 || h <= 0) continue;
      const d = g.getImageData(x0, y0, w, h).data; let worst = 99;
      for (let i = 0; i < d.length; i += 4) { const Lb = lum(d[i], d[i + 1], d[i + 2]); const cr = (Math.max(Lf, Lb) + .05) / (Math.min(Lf, Lb) + .05); if (cr < worst) worst = cr; }
      res.push({ t: run.t, worst: +worst.toFixed(2) });
    }
    res.sort((a, b) => a.worst - b.worst);
    return { checked: res.length, minRatio: res.length ? res[0].worst : null, worst3: res.slice(0, 3) };
  }, { png, runs, heroBox });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: `${outDir}/${prefix}-${v.name}-full.png`, fullPage: true });
  report[v.name] = { errors, failed, allowedMissing: [...new Set(allowed)], heroContrast, ...audit };
  await ctx.close();
}
// Play links
const ctx = await browser.newContext(); const p = await ctx.newPage();
report.links = {};
for (const g of ['codex/', 'claude/', 'deepseek/', 'classic/codex/', 'classic/claude/', 'classic/deepseek/', 'codex/BUILD.txt', 'claude/BUILD.txt', 'deepseek/BUILD.txt', 'classic/codex/BUILD.txt', 'classic/claude/BUILD.txt', 'classic/deepseek/BUILD.txt', 'data/costs.json', 'data/v2.json', 'assets/video/chopperman-review-v2-small.mp4', 'assets/video/chopperman-intro-poster.jpg', 'assets/video/chopperman-intro-web.mp4']) {
  const r = await p.request.get(base + g); report.links[g] = r.status();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
