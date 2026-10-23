// Procedural canvas textures (no external image assets needed).
import * as THREE from 'three';
import { Rng, fbm2, valueNoise2, clamp, lerp, smoothstep } from './rng.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, { repeat = [1, 1], srgb = true, wrap = true, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.repeat.set(repeat[0], repeat[1]);
  tex.userData.aniso = aniso;
  tex.anisotropy = Math.min(aniso, ANISO_CAP);
  if (BILINEAR) tex.minFilter = THREE.LinearMipmapNearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Fill a canvas pixel-by-pixel. fn(x, y, out) writes r,g,b,a (0..255) into out.
function paint(canvas, fn) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      fn(x, y, out);
      const i = (y * w + x) * 4;
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
      d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return ctx;
}

const rgb = (out, r, g, b) => {
  out[0] = clamp(r, 0, 255);
  out[1] = clamp(g, 0, 255);
  out[2] = clamp(b, 0, 255);
};

// ---------------------------------------------------------------- lawn

export function grassTexture(seed = 3) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = paint(c, (x, y, o) => {
    const u = x / S, v = y / S;
    const n = fbm2(u * 16, v * 16, seed, 4, 16, 16);
    const m = fbm2(u * 4, v * 4, seed + 9, 3, 4, 4);
    const k = 0.75 + 0.5 * n;
    rgb(o, (52 + 40 * m) * k, (98 + 40 * m) * k, (34 + 10 * m) * k);
  });
  // Individual blades as short strokes (wrapped so the texture tiles).
  const rng = new Rng(seed);
  for (let i = 0; i < 9000; i++) {
    const x = rng.float(0, S), y = rng.float(0, S);
    const len = rng.float(4, 11);
    const ang = -Math.PI / 2 + rng.float(-0.6, 0.6);
    const g = rng.float(0.65, 1.25);
    ctx.strokeStyle = `rgba(${(58 * g) | 0},${(120 * g) | 0},${(40 * g) | 0},${rng.float(0.35, 0.8)})`;
    ctx.lineWidth = rng.float(0.8, 1.6);
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const x0 = x + dx, y0 = y + dy;
        if (x0 < -12 || x0 > S + 12 || y0 < -12 || y0 > S + 12) continue;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
        ctx.stroke();
      }
    }
  }
  return toTexture(c, { repeat: [24, 24] });
}

// Worn dirt / sawdust patch around the chopping block (alpha falloff).
export function dirtPatchTexture(seed = 5) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = paint(c, (x, y, o) => {
    const u = x / S * 2 - 1, v = y / S * 2 - 1;
    const r = Math.hypot(u, v);
    const n = fbm2(x / 40, y / 40, seed, 5);
    const edge = 1 - smoothstep(0.45 + 0.35 * n, 0.95, r);
    const saw = fbm2(x / 6, y / 6, seed + 3, 2);
    const k = 0.8 + 0.4 * n;
    const sd = smoothstep(0.55, 0.75, saw) * (1 - r);
    rgb(o, lerp(96, 196, sd) * k, lerp(78, 160, sd) * k, lerp(55, 110, sd) * k);
    o[3] = 255 * clamp(edge * (0.85 + 0.3 * n), 0, 1);
  });
  // Scattered wood chips and bark bits.
  const rng = new Rng(seed);
  for (let i = 0; i < 700; i++) {
    const a = rng.float(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * S * 0.42;
    const x = S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr;
    const bark = rng.next() < 0.3;
    const t = rng.float(0.7, 1.15);
    ctx.fillStyle = bark ? `rgba(${70 * t | 0},${52 * t | 0},${38 * t | 0},0.9)` : `rgba(${214 * t | 0},${176 * t | 0},${120 * t | 0},0.9)`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng.float(0, Math.PI));
    ctx.fillRect(-rng.float(1, 5), -rng.float(0.5, 1.6), rng.float(2, 9), rng.float(1, 3));
    ctx.restore();
  }
  return toTexture(c, { wrap: false });
}

// ---------------------------------------------------------------- wood

// Growth-ring lookup: maps normalised radius (0 = pith, 1 = outside of bark) to colour.
export function buildRingLUT(log) {
  const N = 1024;
  const lut = new Float32Array(N * 3);
  const { rings, barkStart, sapStart, heart, sap, innerBark, outerBark, latewood } = log;
  let k = 0;
  for (let i = 0; i < N; i++) {
    const rho = i / (N - 1);
    let r, g, b;
    if (rho >= barkStart) {
      const t = smoothstep(barkStart, barkStart + 0.025, rho);
      r = lerp(innerBark[0], outerBark[0], t);
      g = lerp(innerBark[1], outerBark[1], t);
      b = lerp(innerBark[2], outerBark[2], t);
    } else {
      while (k < rings.length - 2 && rings[k + 1] < rho) k++;
      const r0 = rings[k], r1 = rings[k + 1] ?? barkStart;
      const t = clamp((rho - r0) / Math.max(1e-4, r1 - r0), 0, 1);
      const late = smoothstep(0.5, 0.92, t) * (1 - smoothstep(0.96, 1.0, t) * 0.4);
      const sw = smoothstep(sapStart - 0.03, sapStart + 0.03, rho);
      r = lerp(heart[0], sap[0], sw);
      g = lerp(heart[1], sap[1], sw);
      b = lerp(heart[2], sap[2], sw);
      const dark = 1 - latewood * late;
      r *= dark; g *= dark; b *= dark;
      // Pith: small dark core.
      const pith = 1 - 0.45 * (1 - smoothstep(0.0, 0.03, rho));
      r *= pith; g *= pith; b *= pith;
    }
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}

function lutSample(lut, rho, out) {
  const i = clamp(Math.round(rho * 1023), 0, 1023) * 3;
  out[0] = lut[i];
  out[1] = lut[i + 1];
  out[2] = lut[i + 2];
}

// Anisotropic filtering cap from the quality preset. SwiftShader filters anisotropically in software
// (up to 8 taps per pixel on the grazing lawn), so Low / Potato use plain trilinear.
let ANISO_CAP = 8;
export function setAnisoCap(cap, scene) {
  ANISO_CAP = cap;
  const seen = new Set();
  scene?.traverse((o) => {
    if (!o.material) return;
    for (const m of [].concat(o.material)) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'emissiveMap', 'alphaMap']) {
        const t = m[k];
        if (!t || seen.has(t) || t.userData.aniso === undefined) continue;
        seen.add(t);
        const a = Math.min(t.userData.aniso, cap);
        if (a !== t.anisotropy) { t.anisotropy = a; t.needsUpdate = true; }
      }
    }
  });
}

// Mip filtering from the quality preset: Low / Potato sample one mip level (bilinear) instead of
// blending two (trilinear), which halves the texel fetches SwiftShader does per textured pixel.
let BILINEAR = false;
const MIP_SLOTS = ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'];
export function setMipFilter(bilinear, root) {
  BILINEAR = bilinear;
  const want = bilinear ? THREE.LinearMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  const seen = new Set();
  root?.traverse((o) => {
    if (!o.material) return;
    for (const m of [].concat(o.material)) {
      for (const k of MIP_SLOTS) {
        const t = m[k];
        if (!t || seen.has(t)) continue;
        seen.add(t);
        if ((t.minFilter === THREE.LinearMipmapLinearFilter || t.minFilter === THREE.LinearMipmapNearestFilter) && t.minFilter !== want) {
          t.minFilter = want;
          t.needsUpdate = true;
        }
      }
    }
  });
}

// Texture resolution scale (set from the quality preset before logs are generated).
let TEX_SCALE = 1;
export function setTextureScale(s) { TEX_SCALE = s; }

// Tangent-space normal map from a height field (Sobel gradients). Wraps if `wrap`.
export function normalFromHeights(heights, W, H, strength = 2, wrap = true) {
  const c = makeCanvas(W, H);
  const at = (x, y) => {
    if (wrap) { x = (x + W) % W; y = (y + H) % H; } else { x = clamp(x, 0, W - 1); y = clamp(y, 0, H - 1); }
    return heights[y * W + x];
  };
  paint(c, (x, y, o) => {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    // Canvas y runs down while texture v runs up (flipY), hence +dy.
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    rgb(o, (nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz * 0.5 + 0.5) * 255);
  });
  return toTexture(c, { srgb: false, wrap });
}

// Normal map from the luminance of an existing colour canvas.
export function normalFromCanvas(canvas, strength = 2, wrap = true) {
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.55 + d[i * 4 + 2] * 0.15) / 255;
  return normalFromHeights(h, W, H, strength, wrap);
}

const angDist = (a, b) => Math.abs(((a - b) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);

// End grain (chainsaw-cut face). UV (0..1)^2 spans the full diameter; canvas pixel (cx, cy) in
// [-1,1]^2 maps to log-local (x, z) = (cx, -cy) * R. Seasoning checks run in from the bark,
// knots show as dark ovals that bend the rings, an embedded nail leaves a blue-black iron stain.
export function endGrainTextures(log, lut, seed) {
  const S = Math.round(512 * TEX_SCALE);
  const c = makeCanvas(S, S);
  const heights = new Float32Array(S * S);
  const sawAng = new Rng(seed).float(0, Math.PI);
  const sx = Math.cos(sawAng), sy = Math.sin(sawAng);
  const col = [0, 0, 0];
  const knots = (log.knots ?? []).map((k) => ({ ...k, x: Math.cos(k.th) * k.r, z: Math.sin(k.th) * k.r }));
  const nail = log.nail;
  const rot = log.rot ?? 0;
  const fork = log.fork ? { x: Math.cos(log.fork.th) * 0.58, z: Math.sin(log.fork.th) * 0.58, k: 1 / Math.max(0.3, log.fork.rb * 0.9) } : null;
  const rock = log.rock ? { x: Math.cos(log.rock.th) * (1 - log.rock.depth * 0.5), z: Math.sin(log.rock.th) * (1 - log.rock.depth * 0.5), s: 0.07 } : null;
  paint(c, (x, y, o) => {
    const cx = (x + 0.5) / S * 2 - 1, cy = (y + 0.5) / S * 2 - 1;
    const lx = cx, lz = -cy;
    let r0 = Math.hypot(lx, lz);
    const th = Math.atan2(lz, lx);
    if (fork) {
      // A Y-crotch shows two ring systems: the branch's pith and rings merge into the stem's.
      const d2 = Math.hypot(lx - fork.x, lz - fork.z) * fork.k * 0.6;
      const kk = 0.08;
      const h = clamp(0.5 + 0.5 * (d2 - r0) / kk, 0, 1);
      if (r0 < 0.97) r0 = lerp(r0, d2, 1 - h) - kk * h * (1 - h);
    }
    let wob = 1 + 0.012 * Math.sin(3 * th + seed) + 0.007 * Math.sin(7 * th + seed * 2.3) +
      0.01 * (valueNoise2(th * 3 + 10, r0 * 6, seed) - 0.5);
    let knotK = 1;
    for (const k of knots) {
      const d = Math.hypot(lx - k.x, lz - k.z);
      wob += 0.06 * Math.exp(-(d * d) / (k.size * k.size * 3)) / Math.max(0.05, r0);
      if (d < k.size) {
        const kr = d / k.size;
        knotK *= 0.42 + 0.3 * kr + 0.12 * Math.sin(kr * 28);
      } else if (d < k.size * 1.25) knotK *= 0.75;
    }
    const rho = r0 * wob;
    lutSample(lut, Math.min(rho, 1), col);
    const fine = 0.9 + 0.2 * valueNoise2(x * 0.7 / TEX_SCALE, y * 0.7 / TEX_SCALE, seed + 7);
    const sawPhase = (cx * sx + cy * sy) * 260 + 3 * valueNoise2(x / 30, y / 30, seed);
    const saw = 1 - 0.05 * (0.5 + 0.5 * Math.sin(sawPhase));
    let k = fine * saw * knotK;
    let h = 0.5 + 0.12 * Math.sin(sawPhase) + 0.1 * fine;
    if (rho < log.barkStart) {
      for (const ch of log.checks ?? []) {
        const da = angDist(th, ch.th);
        const depth = (rho - (1 - ch.len)) / ch.len; // 0 at the inner tip, 1 at the bark
        if (depth > 0) {
          const w = ch.w * depth + 0.0015;
          if (da * Math.max(rho, 0.02) < w) { k *= 0.3; h = 0; }
        }
      }
      if (nail) {
        const da = angDist(th, nail.th);
        const inner = 1 - nail.len;
        if (rho > inner - 0.06 && da * rho < 0.05) {
          const s = Math.exp(-((da * rho) ** 2) / 0.0006) * smoothstep(inner - 0.06, inner + 0.04, rho);
          col[0] = lerp(col[0], 46, s * 0.85); col[1] = lerp(col[1], 50, s * 0.85); col[2] = lerp(col[2], 62, s * 0.85);
        }
      }
    }
    if (rot > 0 && r0 < rot + 0.05) {
      // Punky heart: soft, dark, spongy wood with black fungal zone lines and a crumbled hollow.
      const w = 1 - smoothstep(rot - 0.04, rot + 0.05, r0 + 0.04 * (valueNoise2(th * 4 + 3, r0 * 5, seed + 31) - 0.5));
      const n = fbm2(x / (18 * TEX_SCALE), y / (18 * TEX_SCALE), seed + 33, 3);
      const zone = Math.abs(fbm2(x / (40 * TEX_SCALE), y / (40 * TEX_SCALE), seed + 35, 2) - 0.5) < 0.012 ? 0.25 : 1;
      const hollow = 1 - smoothstep(rot * 0.22, rot * 0.42, r0 + 0.05 * (n - 0.5));
      const pr = lerp(118, 52, hollow) * (0.8 + 0.4 * n), pg = lerp(92, 36, hollow) * (0.8 + 0.4 * n), pb = lerp(64, 24, hollow) * (0.8 + 0.4 * n);
      col[0] = lerp(col[0] * k, pr * zone, w); col[1] = lerp(col[1] * k, pg * zone, w); col[2] = lerp(col[2] * k, pb * zone, w);
      k = lerp(k, 1, w);
      h = lerp(h, 0.3 * n - 0.4 * hollow, w);
    }
    if (rock) {
      const d = Math.hypot(lx - rock.x, lz - rock.z);
      if (d < rock.s) {
        // Bark grown in around a stone: grey inclusion with a dark rim.
        const t = d / rock.s;
        const g = 110 * (0.85 + 0.3 * valueNoise2(x * 0.5, y * 0.5, seed + 41));
        col[0] = lerp(g, 50, smoothstep(0.7, 1, t)); col[1] = lerp(g * 0.98, 40, smoothstep(0.7, 1, t)); col[2] = lerp(g * 0.93, 34, smoothstep(0.7, 1, t));
        k = 1;
        h = 0.8 - 0.5 * t;
      }
    }
    heights[y * S + x] = h;
    rgb(o, col[0] * k, col[1] * k, col[2] * k);
  });
  return { map: toTexture(c, { wrap: false }), normal: normalFromHeights(heights, S, S, 1.6, false) };
}

// Freshly split face: U = radius/R (0..1), V = height. Fibres run along V.
export function splitFaceTextures(log, lut, seed) {
  const W = Math.round(256 * TEX_SCALE), H = Math.round(512 * TEX_SCALE);
  const c = makeCanvas(W, H);
  const heights = new Float32Array(W * H);
  const col = [0, 0, 0];
  const rough = log.species.interlocked ? 1.8 : 1;
  paint(c, (x, y, o) => {
    const u = (x + 0.5) / W, v = y / H;
    const wav = 0.006 * rough * Math.sin(v * Math.PI * 2 * 3 + u * 9 + seed);
    lutSample(lut, clamp(u + wav, 0, 1), col);
    const fib = fbm2(u * 90, v * 4, seed + 11, 3, 0, 4);
    const fib2 = valueNoise2(u * 260, v * 12, seed + 21, 0, 12);
    const torn = smoothstep(0.72, 0.9, fbm2(u * 30, v * 20, seed + 5, 2, 0, 20));
    let k = 0.86 + 0.22 * fib + 0.08 * (fib2 - 0.5);
    k = lerp(k, 1.12, torn * 0.6);
    heights[y * W + x] = (fib * 0.7 + fib2 * 0.3) * rough + torn * 0.5;
    const fresh = 1.06; // freshly exposed wood is lighter than the weathered ends
    if (log.rot && u < log.rot + 0.04) {
      const w = 1 - smoothstep(log.rot - 0.05, log.rot + 0.04, u + 0.03 * (fib - 0.5));
      col[0] = lerp(col[0], 104 * (0.7 + 0.5 * fib), w); col[1] = lerp(col[1], 80 * (0.7 + 0.5 * fib), w); col[2] = lerp(col[2], 56 * (0.7 + 0.5 * fib), w);
      heights[y * W + x] -= 0.6 * w * fib2;
    }
    rgb(o, col[0] * k * fresh, col[1] * k * fresh, col[2] * k * fresh);
  });
  return { map: toTexture(c, { repeat: [1, 1] }), normal: normalFromHeights(heights, W, H, 3.5, true) };
}

// Tileable bark colour + normal + roughness textures (cached per species variant).
const barkCache = new Map();
export function barkTextures(species, seed) {
  const key = `${species.id ?? species.name ?? 'x'}:${seed}:${TEX_SCALE}`;
  if (barkCache.has(key)) return barkCache.get(key);
  const W = Math.round(256 * TEX_SCALE), H = Math.round(512 * TEX_SCALE);
  const color = makeCanvas(W, H);
  const roughC = makeCanvas(W, H);
  const b = species.bark;
  const heights = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const warp = (fbm2(u * 4, v * 2, seed + 2, 3, 4, 2) - 0.5) * b.warp;
      const n = fbm2((u + warp) * b.fx, v * b.fy, seed, 4, b.fx, b.fy);
      let h = 1 - Math.abs(2 * n - 1);
      h = Math.pow(h, b.sharp);
      if (b.plates) {
        const p = valueNoise2(u * b.fx * 0.5, v * b.fy * 2.5, seed + 9, b.fx * 0.5, b.fy * 2.5);
        h = lerp(h, smoothstep(0.35, 0.65, p), b.plates);
      }
      heights[y * W + x] = h;
    }
  }
  const rng = new Rng(seed + 1);
  const lent = [];
  if (b.lenticels) {
    for (let i = 0; i < 160; i++) lent.push([rng.float(0, W), rng.float(0, H), rng.float(4, 12) * TEX_SCALE, rng.float(0.8, 1.6)]);
  }
  paint(color, (x, y, o) => {
    const h = heights[y * W + x];
    const n = valueNoise2(x * 0.3 / TEX_SCALE, y * 0.3 / TEX_SCALE, seed + 4);
    const lich = b.lichen ? smoothstep(0.7, 0.8, fbm2(x / (50 * TEX_SCALE), y / (50 * TEX_SCALE), seed + 8, 3, W / (50 * TEX_SCALE), H / (50 * TEX_SCALE))) * h : 0;
    let r = lerp(b.dark[0], b.light[0], h), g = lerp(b.dark[1], b.light[1], h), bl = lerp(b.dark[2], b.light[2], h);
    const k = 0.85 + 0.3 * n;
    r = lerp(r * k, 150, lich * 0.5);
    g = lerp(g * k, 160, lich * 0.5);
    bl = lerp(bl * k, 130, lich * 0.5);
    rgb(o, r, g, bl);
  });
  paint(roughC, (x, y, o) => {
    const h = heights[y * W + x];
    const r = 255 * lerp(1.0, 0.78, h);
    rgb(o, r, r, r);
  });
  if (lent.length) {
    const cctx = color.getContext('2d');
    for (const [x, y, w, hh] of lent) {
      cctx.fillStyle = 'rgba(40,28,22,0.55)';
      cctx.fillRect(x, y, w, hh);
      if (x + w > W) cctx.fillRect(x - W, y, w, hh);
    }
  }
  const out = {
    map: toTexture(color, { repeat: [2, 1] }),
    normal: normalFromHeights(heights, W, H, 4, true),
    rough: toTexture(roughC, { repeat: [2, 1], srgb: false }),
  };
  out.normal.repeat.set(2, 1);
  barkCache.set(key, out);
  return out;
}

export function hickoryTexture(seed = 17) {
  const W = 64, H = 512;
  const c = makeCanvas(W, H);
  paint(c, (x, y, o) => {
    const u = x / W, v = y / H;
    const s = fbm2(u * 12, v * 1.5, seed, 4, 12, 0);
    const streak = 0.5 + 0.5 * Math.sin((u * 12 + s * 3) * Math.PI * 2);
    const k = 0.88 + 0.12 * streak + 0.1 * (s - 0.5);
    rgb(o, 205 * k, 160 * k, 105 * k);
  });
  return toTexture(c);
}

// Weathered top of the chopping block with axe scars.
export function blockTopTexture(lut, seed = 23) {
  const S = 512;
  const c = makeCanvas(S, S);
  const col = [0, 0, 0];
  const ctx = paint(c, (x, y, o) => {
    const cx = (x + 0.5) / S * 2 - 1, cy = (y + 0.5) / S * 2 - 1;
    const r0 = Math.hypot(cx, cy);
    const th = Math.atan2(cy, cx);
    const rho = r0 * (1 + 0.015 * Math.sin(4 * th + 1.3) + 0.01 * Math.sin(9 * th));
    lutSample(lut, Math.min(rho, 1), col);
    const n = fbm2(x / 25, y / 25, seed, 4);
    const grey = 0.45 + 0.25 * n; // weathering pulls colour toward grey
    const k = 0.8 + 0.3 * valueNoise2(x * 0.8, y * 0.8, seed + 2);
    const g = (col[0] + col[1] + col[2]) / 3;
    rgb(o, lerp(col[0], g, grey) * k * 0.85, lerp(col[1], g, grey) * k * 0.85, lerp(col[2], g, grey) * k * 0.82);
  });
  const rng = new Rng(seed);
  for (let i = 0; i < 70; i++) {
    const a = rng.float(0, Math.PI), r = Math.sqrt(rng.next()) * S * 0.33;
    const p = rng.float(0, Math.PI * 2);
    const x = S / 2 + Math.cos(p) * r, y = S / 2 + Math.sin(p) * r;
    const len = rng.float(20, 70);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = `rgba(35,25,18,${rng.float(0.35, 0.7)})`;
    ctx.fillRect(-len / 2, -1, len, rng.float(1.2, 2.6));
    ctx.fillStyle = 'rgba(220,200,170,0.25)';
    ctx.fillRect(-len / 2, 1.5, len, 1);
    ctx.restore();
  }
  return toTexture(c, { wrap: false });
}

// ---------------------------------------------------------------- house & yard

export function sidingTexture(base = [196, 190, 172], seed = 31) {
  const S = 512, board = 64;
  const c = makeCanvas(S, S);
  paint(c, (x, y, o) => {
    const t = (y % board) / board;
    const shade = 0.78 + 0.22 * smoothstep(0, 0.12, t) - 0.12 * smoothstep(0.85, 1, t);
    const grain = 0.97 + 0.04 * fbm2(x / 64, y / 3, seed, 2, S / 64, 0);
    const dirt = 1 - 0.06 * fbm2(x / 90, y / 90, seed + 1, 3, S / 90, S / 90);
    const k = shade * grain * dirt;
    rgb(o, base[0] * k, base[1] * k, base[2] * k);
  });
  return toTexture(c);
}

export function shingleTexture(seed = 37) {
  const S = 512, row = 32, tab = 64;
  const c = makeCanvas(S, S);
  paint(c, (x, y, o) => {
    const r = Math.floor(y / row);
    const off = (r % 2) * tab / 2;
    const tx = (x + off) % tab;
    const ty = (y % row) / row;
    const tabId = Math.floor((x + off) / tab) + r * 17;
    const tone = 0.8 + 0.3 * valueNoise2(tabId * 1.7, 0.5, seed);
    const gran = 0.75 + 0.5 * valueNoise2(x * 0.9, y * 0.9, seed + 3);
    let k = tone * gran;
    if (tx < 2) k *= 0.45;
    if (ty > 0.88) k *= 0.55;
    rgb(o, 74 * k, 70 * k, 68 * k);
  });
  return toTexture(c);
}

export function fenceBoardTexture(seed = 41) {
  const W = 128, H = 512;
  const c = makeCanvas(W, H);
  const rng = new Rng(seed);
  const knots = [];
  for (let i = 0; i < 4; i++) knots.push([rng.float(0.15, 0.85), rng.float(0, 1), rng.float(0.02, 0.05)]);
  paint(c, (x, y, o) => {
    const u = x / W, v = y / H;
    let uu = u;
    for (const [kx, ky, kr] of knots) {
      const dx = (u - kx), dy = (v - ky) * 0.25;
      const d = Math.hypot(dx, dy);
      uu += 0.04 * Math.exp(-d * d / (kr * kr * 4)) * Math.sign(dx);
    }
    const s = fbm2(uu * 10, v * 1.2, seed, 3, 10, 0);
    const grain = 0.5 + 0.5 * Math.sin((uu * 18 + s * 4) * Math.PI * 2);
    let k = 0.82 + 0.12 * grain + 0.12 * (s - 0.5);
    for (const [kx, ky, kr] of knots) {
      const d = Math.hypot(u - kx, (v - ky) * 0.25 * 4);
      if (d < kr) k *= 0.55 + 0.45 * (d / kr);
    }
    const weather = fbm2(u * 3, v * 6, seed + 5, 3, 3, 6);
    rgb(o, lerp(178, 150, weather) * k, lerp(132, 128, weather) * k, lerp(92, 108, weather) * k);
  });
  return toTexture(c);
}

export function concreteTexture(seed = 43) {
  const S = 256;
  const c = makeCanvas(S, S);
  paint(c, (x, y, o) => {
    const n = fbm2(x / 20, y / 20, seed, 4, S / 20, S / 20);
    const f = valueNoise2(x * 0.9, y * 0.9, seed + 1, S * 0.9, S * 0.9);
    const k = 0.82 + 0.16 * n + 0.08 * f;
    rgb(o, 172 * k, 168 * k, 160 * k);
  });
  return toTexture(c, { repeat: [3, 2] });
}

// Generic red/black flannel plaid for the shirt.
export function plaidTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const band = (t) => {
    const m = t % 32;
    if (m < 12) return 1; // dark band
    if (m >= 20 && m < 22) return 0.5; // thin accent line
    return 0;
  };
  paint(c, (x, y, o) => {
    const a = band(x), b = band(y);
    const twill = ((x + y) % 4) < 2 ? 1.0 : 0.88;
    const dark = (a + b) / 2;
    const red = [168, 32, 30], blk = [26, 22, 24];
    const k = twill;
    rgb(o, lerp(red[0], blk[0], dark) * k, lerp(red[1], blk[1], dark) * k, lerp(red[2], blk[2], dark) * k);
  });
  const t = toTexture(c, { repeat: [3, 3] });
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function denimTexture(seed = 47) {
  const S = 128;
  const c = makeCanvas(S, S);
  paint(c, (x, y, o) => {
    const tw = ((x + y * 2) % 6) < 3 ? 1.05 : 0.9;
    const n = 0.85 + 0.3 * valueNoise2(x * 0.5, y * 0.08, seed, S * 0.5, S * 0.08);
    const k = tw * n;
    rgb(o, 52 * k, 74 * k, 112 * k);
  });
  return toTexture(c, { repeat: [2, 4] });
}

// Alpha-tested leaf cluster sprite for tree crowns and shrubs.
export function leafClusterTexture(palette, seed = 53) {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rng = new Rng(seed);
  for (let i = 0; i < 70; i++) {
    const a = rng.float(0, Math.PI * 2), r = Math.sqrt(rng.next()) * S * 0.36;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const L = rng.float(20, 34), W = L * rng.float(0.45, 0.6);
    const col = rng.pick(palette);
    const k = rng.float(0.75, 1.15);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng.float(0, Math.PI * 2));
    ctx.fillStyle = `rgb(${col[0] * k | 0},${col[1] * k | 0},${col[2] * k | 0})`;
    ctx.beginPath();
    ctx.moveTo(-L / 2, 0);
    ctx.quadraticCurveTo(0, -W, L / 2, 0);
    ctx.quadraticCurveTo(0, W, -L / 2, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-L / 2, 0);
    ctx.lineTo(L / 2, 0);
    ctx.stroke();
    ctx.restore();
  }
  const t = toTexture(c, { wrap: false });
  return t;
}

// Soft round sprite for dust particles.
export function dustSprite() {
  const S = 64;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { wrap: false });
}

// Irregular puddle mask (alpha) for rain puddles.
export function puddleTexture(seed = 61) {
  const S = 256;
  const c = makeCanvas(S, S);
  paint(c, (x, y, o) => {
    const u = x / S * 2 - 1, v = y / S * 2 - 1;
    const r = Math.hypot(u, v);
    const n = fbm2(x / 32, y / 32, seed, 4);
    const a = 1 - smoothstep(0.35 + 0.45 * n, 0.55 + 0.45 * n, r);
    rgb(o, 255, 255, 255);
    o[3] = 255 * a;
  });
  return toTexture(c, { wrap: false });
}
