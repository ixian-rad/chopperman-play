// Playability audit of every game build the site links to (live = co-op + voice builds, and the classic snapshots, all four harnesses).
// usage: flock /workspace/chopperman/reports/.verify.lock node tools/audit_builds.mjs <baseURL> <outDir>      env BUILDS=codex/,classic/codex/ (optional subset)
// Per build (desktop, software GL): HTTP 200 + BUILD.txt, a <canvas> that renders non-blank pixels, 0 console errors / page errors / failed requests,
// and real input starts play (Play button if any, canvas click, Space, W/arrow keys): needs a game-state change (window.chopperTest.state()) when the
// build has the test hook (or a HUD-text change: score, streak), else a HUD-text change or a frame change well above the idle frame-to-frame noise.
// Co-op builds (a ./coop/ folder): the Co-op menu opens and shows Host, Join and the proximity voice chat toggle (nothing is hosted, no mic is touched).
// Writes <outDir>/result.json and <outDir>/<build>-{loaded,played,coop}.png. Exit 0 = every build passed.
import { createRequire } from 'module';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE || '/workspace/chopperman/driver/node_modules/playwright-core');
const base = (process.argv[2] || 'https://ixian-rad.github.io/chopperman-play/').replace(/\/?$/, '/');
const out = process.argv[3] || '/tmp/audit-builds'; mkdirSync(out, { recursive: true });
const ALL = ['codex/', 'claude/', 'deepseek/', 'gemini/', 'classic/codex/', 'classic/claude/', 'classic/deepseek/', 'classic/gemini/'];
const BUILDS = process.env.BUILDS ? process.env.BUILDS.split(',') : ALL;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// pixel maths on screenshots, done in a blank page with a 2D canvas (no extra npm packages)
const lab = await b.newPage();
async function stats(bufA, bufB, clip) {
  return lab.evaluate(async ([a, bb, c]) => {
    const load = s => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + s; });
    const W = 256, H = 160, px = async s => { const i = await load(s); const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
      x.drawImage(i, c.x, c.y, c.w, c.h, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
    const A = await px(a); let sum = 0, sq = 0; const cols = new Set();
    for (let k = 0; k < A.length; k += 4) { const l = (A[k] + A[k + 1] + A[k + 2]) / 3; sum += l; sq += l * l; cols.add((A[k] >> 4) << 8 | (A[k + 1] >> 4) << 4 | (A[k + 2] >> 4)); }
    const n = A.length / 4, sd = Math.sqrt(sq / n - (sum / n) ** 2); let diff = null;
    if (bb) { const B = await px(bb); let d = 0; for (let k = 0; k < A.length; k += 4) if (Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]) > 30) d++; diff = d / n; }
    return { sd: +sd.toFixed(1), colours: cols.size, diff: diff == null ? null : +diff.toFixed(4) };
  }, [bufA.toString('base64'), bufB ? bufB.toString('base64') : null, clip]);
}

const res = [];
for (const u of BUILDS) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const cerr = [], perr = [], bad = [];
  p.on('console', m => { if (m.type() === 'error') cerr.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => perr.push(String(e).slice(0, 200)));
  p.on('requestfailed', r => { const t = (r.failure() || {}).errorText || ''; if (!/ABORTED/.test(t)) bad.push(r.url().slice(0, 140) + ' ' + t); });
  p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 140)); });
  const tag = u.replace(/\/$/, '').replace(/\//g, '-');
  const r = { build: u, url: base + u, status: 0, buildTxt: '', canvas: false, nonblank: null, play: null, coop: null, notes: [] };
  try {
    const resp = await p.goto(base + u + '?t=' + Date.now(), { waitUntil: 'load', timeout: 120000 }); r.status = resp.status();
    r.buildTxt = (await p.evaluate(async () => (await fetch('BUILD.txt?t=' + Date.now())).text()).catch(() => '')).trim().slice(0, 80);
    await p.waitForSelector('canvas', { timeout: 60000, state: 'attached' }); r.canvas = true;
    const hook = await p.evaluate(() => !!window.chopperTest);
    if (hook) await p.waitForFunction(() => window.chopperTest.ready && window.chopperTest.ready() === true, null, { timeout: 180000, polling: 500 }).catch(() => r.notes.push('chopperTest.ready() not true in 180 s'));
    await p.waitForTimeout(4000);
    const box = await p.evaluate(() => { const cs = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).filter(q => q.width * q.height > 0).sort((a, c) => c.width * c.height - a.width * a.height)[0];
      return cs ? { x: Math.max(0, cs.x), y: Math.max(0, cs.y), w: Math.min(cs.width, innerWidth - Math.max(0, cs.x)), h: Math.min(cs.height, innerHeight - Math.max(0, cs.y)) } : null; });
    if (!box) throw new Error('canvas has no visible area');
    const s0 = await p.screenshot({ path: `${out}/${tag}-loaded.png` });
    await p.waitForTimeout(1000);
    const s0b = await p.screenshot();
    const st = await stats(s0, s0b, box); r.nonblank = st.sd > 6 && st.colours > 24; r.pixels = { sd: st.sd, colours: st.colours, idleDiff: st.diff };
    // input
    const state = () => hook ? p.evaluate(() => JSON.stringify(window.chopperTest.state())).catch(() => null) : null;
    const hud = () => p.evaluate(() => document.body.innerText.replace(/\d+(\.\d+)?\s*(fps|FPS)/g, ''));
    const st0 = await state(), t0 = await hud();
    const steps = [];
    const play = p.locator('#btn-play:visible:not([disabled]), button:visible').filter({ hasText: /^\s*(play|start|begin|let'?s chop)\b/i }).first();
    if (await play.count()) { steps.push('clicked "' + (await play.textContent()).trim().slice(0, 24) + '"'); await play.click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(800); }
    await p.mouse.click(box.x + box.w / 2, box.y + box.h * 0.55); steps.push('canvas click');
    for (let i = 0; i < 4; i++) { await p.keyboard.press('Space'); await p.waitForTimeout(350); }
    steps.push('Space x4');
    await p.keyboard.down('KeyW'); await p.waitForTimeout(1200); await p.keyboard.up('KeyW');
    await p.keyboard.down('ArrowUp'); await p.waitForTimeout(600); await p.keyboard.up('ArrowUp'); steps.push('W/Up held');
    await p.waitForTimeout(1200);
    const s1 = await p.screenshot({ path: `${out}/${tag}-played.png` });
    const st1 = await state(), t1 = await hud();
    const d = await stats(s0b, s1, box);
    const stateChanged = st0 && st1 ? st0 !== st1 : null, hudChanged = t0 !== t1, frameChanged = d.diff > Math.max(0.02, 3 * (st.diff || 0));
    r.play = hook ? (stateChanged || hudChanged) : (hudChanged || frameChanged);   // state() may not track score (Gemini), so a HUD change counts too
    r.playDetail = `${steps.join(', ')}; ${hook ? 'game state ' + (stateChanged ? 'changed' : 'unchanged') + '; ' : ''}HUD text ${hudChanged ? 'changed' : 'unchanged'}; frame diff ${(d.diff * 100).toFixed(1)}% (idle ${((st.diff || 0) * 100).toFixed(1)}%)`;
    // co-op menu (live builds ship ./coop/)
    const hasCoop = await fetch(base + u + 'coop/index.js', { method: 'HEAD' }).then(x => x.ok).catch(() => false);   // probed from node, so the page's own log stays clean
    if (hasCoop) {
      await p.keyboard.press('Escape').catch(() => {});
      const opened = await p.evaluate(async () => {
        const vis = e => e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
        const panel = () => document.getElementById('coop-panel');
        if (!vis(panel())) (document.querySelector('.coop-btn') || document.getElementById('btn-start-coop') || [...document.querySelectorAll('button')].find(x => /co-?op/i.test(x.textContent)))?.click();
        await new Promise(ok => setTimeout(ok, 600));
        const pn = panel(); if (!vis(pn)) return { panel: false };
        const btns = [...pn.querySelectorAll('button, input[type=checkbox], [role=switch]')].filter(vis).map(x => (x.textContent || x.getAttribute('aria-label') || x.id).trim().replace(/\s+/g, ' ').slice(0, 40));
        const vt = document.getElementById('coop-voice-toggle');
        return { panel: true, host: btns.some(t => /host/i.test(t)), join: btns.some(t => /join/i.test(t)), voice: vis(vt) || btns.some(t => /voice/i.test(t)), voiceLabel: vt ? (vt.textContent || vt.getAttribute('aria-label') || '').trim().slice(0, 50) : '', buttons: btns };
      });
      await p.screenshot({ path: `${out}/${tag}-coop.png` });
      r.coop = opened; r.coopOk = !!(opened.panel && opened.host && opened.join && opened.voice);
    }
  } catch (e) { r.notes.push('run: ' + String(e).slice(0, 200)); }
  r.consoleErrors = cerr; r.pageErrors = perr; r.failedRequests = bad;
  r.pass = r.status === 200 && r.canvas && r.nonblank === true && r.play === true && (r.coop === null || r.coopOk) && !cerr.length && !perr.length && !bad.length && !r.notes.some(n => n.startsWith('run:'));
  res.push(r); await p.close();
  console.error(`${r.pass ? 'PASS' : 'FAIL'} ${u} [${r.buildTxt}] nonblank=${r.nonblank} play=${r.play} coop=${r.coop ? r.coopOk : 'n/a'} cerr=${cerr.length} perr=${perr.length} bad=${bad.length} ${r.notes.join(' ')}`);
}
await b.close();
writeFileSync(`${out}/result.json`, JSON.stringify({ base, at: new Date().toISOString(), builds: res }, null, 1));
console.log(res.every(r => r.pass) ? 'ALL PASS' : 'SOME FAIL');
process.exit(res.every(r => r.pass) ? 0 : 1);
