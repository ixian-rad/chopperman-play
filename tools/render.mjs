// Render brand PNGs with headless Chrome (playwright-core).
// usage: node tools/render.mjs <html-or-svg-path> <out.png> <width> <height> [scale]
import { createRequire } from 'module';
import path from 'path';
const require = createRequire(import.meta.url);
const PW = process.env.PW_CORE || '/workspace/chopperman/driver/node_modules/playwright-core';
const { chromium } = require(PW);
const [src, out, w, h, scale = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +scale });
const url = 'file://' + path.resolve(src);
if (src.endsWith('.svg')) {
  const fs = await import('fs');
  const tmp = '/tmp/_render_wrap.html';
  fs.writeFileSync(tmp, `<html><body style="margin:0;background:transparent"><img src="${url}" style="display:block;width:${w}px;height:${h}px"></body></html>`);
  await page.goto('file://' + tmp);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out, omitBackground: true });
} else {
  await page.goto(url); await page.waitForTimeout(800);
  await page.screenshot({ path: out });
}
await browser.close();
console.log('wrote', out);
