// Capture one consistent "hero frame" of a game build for the milestones gallery.
// Same procedure for every tag (it mirrors driver/check.mjs, which made the reports/<h>-iter-N.png shots):
// 1280x800, software GL, load, wait (accept the default character if a picker opens), one chop (window.swing() if the build has it, else a click in the middle + Space), wait 1.5 s, capture.
// usage: node tools/capture_milestone.mjs <url> <out.png> [waitMs]   (run it under flock /workspace/chopperman/reports/.verify.lock)
import { createRequire } from 'module';
import { existsSync } from 'fs';
const require = createRequire(import.meta.url);
const PW = process.env.PW_CORE || ['/workspace/chopperman/driver/node_modules/playwright-core'].find(existsSync);
const { chromium } = require(PW);
const [,, url, out, waitMs = '6000'] = process.argv;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(+waitMs);
// builds that open a character picker first (the co-op builds): accept the default character, so every frame shows play
const picked = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.offsetParent && /^\s*play as\b/i.test(b.textContent)); if (b) { b.click(); return b.textContent.trim(); } return null; });
if (picked) await page.waitForTimeout(2500);
let swung = false;
try { swung = await page.evaluate(() => { if (typeof window.swing === 'function') { window.swing(); return true; } return false; }); } catch (e) { errors.push('swing: ' + e.message); }
if (!swung) { await page.mouse.click(640, 400); await page.keyboard.press('Space'); }
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
const canvas = await page.evaluate(() => !!document.querySelector('canvas'));
// smallest visible DOM text in the frame (HUD/overlay); text drawn into the canvas itself can't be measured this way
const hud = await page.evaluate(() => {
  let min = null, n = 0, small = 0;
  for (const el of document.querySelectorAll('body *')) {
    const t = [...el.childNodes].filter(c => c.nodeType === 3 && c.textContent.trim()).length; if (!t) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const fs = parseFloat(cs.fontSize); n++; if (fs < 20) small++; min = min == null ? fs : Math.min(min, fs);
  }
  return { min, n, small };
});
console.log(JSON.stringify({ url, out, picked, swung, canvas, hud, errors }));
await browser.close();
process.exit(canvas ? 0 : 1);
