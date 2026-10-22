import * as THREE from 'three';
import { mulberry32 } from './mechanics.js';

/* ------------------------------------------------------------------ *
 *  Small deterministic helpers
 * ------------------------------------------------------------------ */

// Node-safe primitives live in mechanics.js so the test suite can import them
// without Three.js; keep the public utils.js re-export for existing callers.
export { clamp, mulberry32 } from './mechanics.js';
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOutQuint = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
export const damp = (current, target, lambda, dt) =>
  THREE.MathUtils.damp(current, target, lambda, dt);

export function smoothNoise1D(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const n = (n) => {
    const s = Math.sin((n + seed * 17.13) * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  return lerp(n(i), n(i + 1), u);
}

/* ------------------------------------------------------------------ *
 *  Canvas texture factory
 * ------------------------------------------------------------------ */

export function makeCanvasTexture(size, painter, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  painter(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = options.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = options.wrapS ?? THREE.RepeatWrapping;
  texture.wrapT = options.wrapT ?? THREE.RepeatWrapping;
  texture.repeat.set(options.repeatX ?? 1, options.repeatY ?? 1);
  texture.anisotropy = options.anisotropy ?? 8;
  texture.needsUpdate = true;
  return texture;
}

function fillNoise(ctx, size, random, count, colors, maxRadius = 2) {
  for (let i = 0; i < count; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 0.4 + random() * maxRadius;
    ctx.fillStyle = colors[(random() * colors.length) | 0];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createWoodTexture({
  base = '#8a5c34',
  dark = '#4c2f1c',
  light = '#b98550',
  grain = 70,
  planks = 0,
  seed = 4,
  repeatX = 1,
  repeatY = 1,
} = {}) {
  return makeCanvasTexture(
    512,
    (ctx, size) => {
      const random = mulberry32(seed);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);

      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, 'rgba(255,255,255,0.045)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.03)');
      grad.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      for (let i = 0; i < grain; i++) {
        const y = random() * size;
        const amp = 1 + random() * 7;
        const w = 0.4 + random() * 1.8;
        ctx.strokeStyle =
          random() > 0.55
            ? `rgba(52,29,14,${0.08 + random() * 0.22})`
            : `rgba(228,190,138,${0.06 + random() * 0.17})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        for (let x = -10; x <= size + 10; x += 9) {
          const yy =
            y +
            Math.sin(x * 0.019 + i * 1.7) * amp +
            Math.sin(x * 0.061 + i) * amp * 0.35;
          if (x === -10) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }

      for (let k = 0; k < 7; k++) {
        const x = random() * size;
        const y = random() * size;
        ctx.strokeStyle = 'rgba(54,32,17,0.18)';
        ctx.lineWidth = 1;
        for (let r = 2; r < 15 + random() * 16; r += 3) {
          ctx.beginPath();
          ctx.ellipse(x, y, r * 1.7, r * 0.52, random() * 0.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (planks > 0) {
        ctx.strokeStyle = 'rgba(20,13,7,0.52)';
        ctx.lineWidth = 2;
        for (let i = 1; i < planks; i++) {
          const y = (i / planks) * size;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(size, y);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(234,205,160,0.11)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y + 2);
          ctx.lineTo(size, y + 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(20,13,7,0.52)';
          ctx.lineWidth = 2;
        }
        for (let i = 0; i < 20; i++) {
          ctx.fillStyle = 'rgba(30,20,11,0.18)';
          ctx.beginPath();
          ctx.arc(random() * size, random() * size, 1 + random() * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    { repeatX, repeatY },
  );
}

export function createBarkTexture(seed = 8, repeatX = 3, repeatY = 1.5) {
  return makeCanvasTexture(
    512,
    (ctx, size) => {
      const random = mulberry32(seed);
      // Mid-tone base: the old #5b452e albedo went almost black under ACES at
      // Low (no shadows, ambient-only). Keep the ridges dark but give the
      // plates enough value to read as bark from the gameplay camera.
      const base = ctx.createLinearGradient(0, 0, size * 0.35, size);
      base.addColorStop(0, '#7b6142');
      base.addColorStop(0.45, '#6e563b');
      base.addColorStop(1, '#7d6546');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);

      // Broad, soft lichen / weather patches underneath the ridges.
      for (let i = 0; i < 70; i++) {
        const x = random() * size;
        const y = random() * size;
        const r = 8 + random() * 30;
        const g = ctx.createRadialGradient(x, y, 1, x, y, r);
        const grey = random() > 0.55;
        g.addColorStop(0, grey ? 'rgba(178,175,158,0.14)' : 'rgba(93,105,70,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Flattened vertical plates: dark grooves with a lit lip on one side.
      for (let i = 0; i < 300; i++) {
        const x = random() * size;
        const y = random() * size;
        const w = 2 + random() * 8;
        const h = 16 + random() * 110;
        ctx.fillStyle =
          random() > 0.52
            ? `rgba(38,29,18,${0.16 + random() * 0.34})`
            : `rgba(184,158,116,${0.1 + random() * 0.26})`;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, w * 0.5);
        ctx.fill();
        // A thin highlight on the windward edge of the plate.
        if (w > 4) {
          ctx.fillStyle = `rgba(206,186,146,${0.08 + random() * 0.14})`;
          ctx.fillRect(x + 0.4, y + 2, 1, h - 4);
        }
      }

      // Deep checks and lenticels. These also drive the derived normal map.
      for (let i = 0; i < 110; i++) {
        ctx.strokeStyle = `rgba(24,18,11,${0.16 + random() * 0.24})`;
        ctx.lineWidth = 1 + random() * 1.8;
        const x = random() * size;
        const y = random() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(
          x + random() * 16 - 8,
          y + 20,
          x + random() * 22 - 11,
          y + 38,
          x + random() * 9 - 4.5,
          y + 58,
        );
        ctx.stroke();
      }
      fillNoise(ctx, size, random, 650, ['rgba(20,17,10,.12)', 'rgba(190,171,132,.12)'], 1.4);
    },
    { repeatX, repeatY },
  );
}

const surfaceMapCache = new Map();

/**
 * Derive a tangent-space normal map and a monochrome roughness map from an
 * existing procedural colour canvas. This is the cheap way to give bark and
 * end grain real PBR relief without a second canvas draw pass: the colour map
 * already contains the ridges and growth rings, so its luminance doubles as a
 * height field. Results are cached per texture and kept at 256² because the
 * wood fills a small part of the screen even at High.
 */
export function createSurfaceMaps(
  texture,
  { normalStrength = 2, roughnessBase = 0.82, roughnessContrast = 0.2 } = {},
) {
  if (!texture?.image || typeof document === 'undefined') return null;
  const key = `${texture.uuid}:${normalStrength}:${roughnessBase}:${roughnessContrast}`;
  if (surfaceMapCache.has(key)) return surfaceMapCache.get(key);
  const src = texture.image;
  const S = 256;
  const sample = document.createElement('canvas');
  sample.width = S;
  sample.height = S;
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(src, 0, 0, S, S);
  const data = sctx.getImageData(0, 0, S, S).data;
  const heights = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    heights[i] =
      (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.55 + data[i * 4 + 2] * 0.15) / 255;
  }
  const at = (x, y) => heights[((y + S) % S) * S + ((x + S) % S)];

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = S;
  normalCanvas.height = S;
  const nctx = normalCanvas.getContext('2d');
  const nimg = nctx.createImageData(S, S);
  const nd = nimg.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * normalStrength;
      let ny = dy * normalStrength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * S + x) * 4;
      nd[i] = ((nx / len) * 0.5 + 0.5) * 255;
      nd[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      nd[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      nd[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = texture.wrapS;
  normalMap.wrapT = texture.wrapT;
  normalMap.repeat.copy(texture.repeat);
  normalMap.anisotropy = Math.min(4, texture.anisotropy || 1);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = S;
  roughCanvas.height = S;
  const rctx = roughCanvas.getContext('2d');
  const rimg = rctx.createImageData(S, S);
  const rd = rimg.data;
  for (let i = 0; i < S * S; i++) {
    // Grooves (dark pixels) read rougher; raised ridges catch a little more light.
    const value = Math.max(
      0,
      Math.min(1, roughnessBase + (0.5 - heights[i]) * roughnessContrast * 2),
    );
    rd[i * 4] = value * 255;
    rd[i * 4 + 1] = value * 255;
    rd[i * 4 + 2] = value * 255;
    rd[i * 4 + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = texture.wrapS;
  roughnessMap.wrapT = texture.wrapT;
  roughnessMap.repeat.copy(texture.repeat);
  roughnessMap.anisotropy = Math.min(4, texture.anisotropy || 1);

  const maps = { normalMap, roughnessMap };
  surfaceMapCache.set(key, maps);
  return maps;
}

export function createGrassTexture(seed = 21) {
  return makeCanvasTexture(
    1024,
    (ctx, size) => {
      const random = mulberry32(seed);
      ctx.fillStyle = '#4e6c39';
      ctx.fillRect(0, 0, size, size);
      const grad = ctx.createRadialGradient(size * 0.45, size * 0.5, 20, size * 0.5, size * 0.5, size * 0.7);
      grad.addColorStop(0, 'rgba(128,148,82,0.24)');
      grad.addColorStop(0.55, 'rgba(33,52,25,0.08)');
      grad.addColorStop(1, 'rgba(22,37,19,0.27)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      for (let i = 0; i < 12000; i++) {
        const x = random() * size;
        const y = random() * size;
        const h = 2 + random() * 8;
        const lean = (random() - 0.5) * 4;
        const tone = random();
        ctx.strokeStyle =
          tone > 0.72
            ? `rgba(136,154,86,${0.13 + random() * 0.24})`
            : tone > 0.42
              ? `rgba(60,91,44,${0.18 + random() * 0.27})`
              : `rgba(30,51,25,${0.14 + random() * 0.25})`;
        ctx.lineWidth = 0.6 + random() * 1.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + lean * 0.45, y - h * 0.55, x + lean, y - h);
        ctx.stroke();
      }

      for (let i = 0; i < 380; i++) {
        const x = random() * size;
        const y = random() * size;
        ctx.fillStyle =
          random() > 0.5
            ? `rgba(205,192,110,${0.08 + random() * 0.16})`
            : `rgba(29,46,22,${0.1 + random() * 0.18})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 1 + random() * 4, 0.7 + random() * 2.2, random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < 70; i++) {
        const x = random() * size;
        const y = random() * size;
        ctx.strokeStyle = `rgba(226,211,142,${0.25 + random() * 0.3})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (random() - 0.5) * 5, y - 3 - random() * 4);
        ctx.stroke();
      }
    },
    { repeatX: 26, repeatY: 26 },
  );
}

export function createSidingTexture(seed = 3) {
  return makeCanvasTexture(
    512,
    (ctx, size) => {
      const random = mulberry32(seed);
      ctx.fillStyle = '#a7b4ae';
      ctx.fillRect(0, 0, size, size);
      const rows = 18;
      for (let r = 0; r < rows; r++) {
        const y = (r / rows) * size;
        const h = size / rows;
        ctx.fillStyle = `rgba(255,255,255,${0.015 + random() * 0.035})`;
        ctx.fillRect(0, y, size, h);
        ctx.fillStyle = 'rgba(49,64,59,0.25)';
        ctx.fillRect(0, y + h - 1.5, size, 1.5);
        ctx.fillStyle = 'rgba(232,240,232,0.13)';
        ctx.fillRect(0, y, size, 1);
      }
      fillNoise(ctx, size, random, 240, ['rgba(30,43,38,.045)', 'rgba(235,244,237,.035)'], 1.2);
    },
    { repeatX: 3, repeatY: 2 },
  );
}

export function createPlaidTexture(seed = 14) {
  return makeCanvasTexture(
    512,
    (ctx, size) => {
      const random = mulberry32(seed);
      ctx.fillStyle = '#79362c';
      ctx.fillRect(0, 0, size, size);
      const stripe = (x, w, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, 0, w, size);
        ctx.fillRect(0, x, size, w);
      };
      for (let i = 0; i < 5; i++) stripe(i * 102 + 0, 8, 'rgba(34,28,24,0.66)');
      for (let i = 0; i < 5; i++) stripe(i * 102 + 38, 23, 'rgba(40,30,25,0.3)');
      for (let i = 0; i < 5; i++) stripe(i * 102 + 82, 3, 'rgba(236,220,189,0.35)');
      for (let i = 0; i < 5; i++) stripe(i * 102 + 52, 1.5, 'rgba(224,182,107,0.42)');
      for (let i = 0; i < 2000; i++) {
        ctx.fillStyle = `rgba(15,13,10,${random() * 0.06})`;
        const x = random() * size;
        const y = random() * size;
        ctx.fillRect(x, y, 1, 1);
      }
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, 'rgba(255,255,255,.04)');
      grad.addColorStop(1, 'rgba(0,0,0,.12)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    },
    { repeatX: 1.6, repeatY: 1.6 },
  );
}

export function createDenimTexture(seed = 5) {
  return makeCanvasTexture(
    256,
    (ctx, size) => {
      const random = mulberry32(seed);
      ctx.fillStyle = '#354b63';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 9000; i++) {
        const x = random() * size;
        const y = random() * size;
        ctx.fillStyle = random() > 0.45 ? 'rgba(24,38,54,.16)' : 'rgba(126,151,172,.12)';
        ctx.fillRect(x, y, 1, 1 + random() * 2);
      }
      for (let i = 0; i < 14; i++) {
        ctx.strokeStyle = 'rgba(197,181,122,.08)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(random() * size, 0);
        ctx.lineTo(random() * size, size);
        ctx.stroke();
      }
    },
    { repeatX: 2, repeatY: 2 },
  );
}

export function createEndGrainTexture(seed = 11, size = 512) {
  return makeCanvasTexture(
    size,
    (ctx, s) => {
      const random = mulberry32(seed);
      // Heartwood -> sapwood -> weathered rim. The radial ramp gives the cut
      // face a real material read before the growth rings are drawn on top.
      const heartRamp = ctx.createRadialGradient(
        s * 0.51, s * 0.49, 1,
        s * 0.51, s * 0.49, s * 0.52,
      );
      heartRamp.addColorStop(0, '#a87945');
      heartRamp.addColorStop(0.32, '#b98d55');
      heartRamp.addColorStop(0.62, '#cda568');
      heartRamp.addColorStop(0.82, '#d8b578');
      heartRamp.addColorStop(0.94, '#b98f5b');
      heartRamp.addColorStop(1, '#93714a');
      ctx.fillStyle = heartRamp;
      ctx.fillRect(0, 0, s, s);
      const cx = s * 0.51;
      const cy = s * 0.49;
      const maxR = s * 0.49;
      for (let r = maxR; r > 2; r -= 2.2 + random() * 3.4) {
        ctx.beginPath();
        const wobble = 0.05 + random() * 0.035;
        for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.09) {
          const rr = r * (1 + Math.sin(a * 3 + random() * 0.01) * wobble + Math.sin(a * 7.3) * 0.018);
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(92,61,31,${0.08 + random() * 0.21})`;
        ctx.lineWidth = 0.6 + random() * 1.2;
        ctx.stroke();
      }
      // Central pith and radial checking
      ctx.strokeStyle = 'rgba(76,48,24,0.38)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = random() * Math.PI * 2;
        const len = maxR * (0.25 + random() * 0.66);
        ctx.strokeStyle = `rgba(66,42,23,${0.1 + random() * 0.19})`;
        ctx.lineWidth = 0.7 + random() * 1.8;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
        ctx.lineTo(cx + Math.cos(a + 0.035) * len, cy + Math.sin(a + 0.035) * len);
        ctx.stroke();
      }
      fillNoise(ctx, s, random, 900, ['rgba(90,63,33,.1)', 'rgba(239,205,151,.1)'], 1.4);
    },
    { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, repeatX: 1, repeatY: 1 },
  );
}

export function createDirtPatchTexture(seed = 13) {
  return makeCanvasTexture(
    512,
    (ctx, s) => {
      const random = mulberry32(seed);
      ctx.clearRect(0, 0, s, s);
      const grd = ctx.createRadialGradient(s / 2, s / 2, s * 0.06, s / 2, s / 2, s * 0.48);
      grd.addColorStop(0, 'rgba(95,73,43,0.94)');
      grd.addColorStop(0.58, 'rgba(91,75,46,0.74)');
      grd.addColorStop(0.82, 'rgba(81,70,43,0.32)');
      grd.addColorStop(1, 'rgba(81,70,43,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.49, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 900; i++) {
        const a = random() * Math.PI * 2;
        const r = Math.sqrt(random()) * s * 0.43;
        const x = s / 2 + Math.cos(a) * r;
        const y = s / 2 + Math.sin(a) * r;
        ctx.fillStyle = random() > 0.5 ? 'rgba(151,123,72,.22)' : 'rgba(55,42,25,.22)';
        ctx.beginPath();
        ctx.ellipse(x, y, 0.7 + random() * 2.5, 0.5 + random() * 1.6, random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping },
  );
}

export function createShadowBlobTexture() {
  return makeCanvasTexture(
    256,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.7)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, srgb: false },
  );
}

export function createCloudTexture(seed = 2) {
  return makeCanvasTexture(
    512,
    (ctx, s) => {
      const random = mulberry32(seed);
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 24; i++) {
        const x = s * 0.18 + random() * s * 0.64;
        const y = s * 0.36 + random() * s * 0.26;
        const r = s * (0.045 + random() * 0.1);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,252,244,0.34)');
        g.addColorStop(0.55, 'rgba(255,249,238,0.16)');
        g.addColorStop(1, 'rgba(255,246,232,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping },
  );
}

/* ------------------------------------------------------------------ *
 *  Geometry helpers
 * ------------------------------------------------------------------ */

export function alignCylinderToSegment(mesh, start, end) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.scale.set(1, length, 1);
  return mesh;
}

export function addBox(scene, size, position, material, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = opts.receiveShadow ?? true;
  scene.add(mesh);
  return mesh;
}

export function randomPointInRing(random, minR, maxR) {
  const a = random() * Math.PI * 2;
  const r = Math.sqrt(lerp(minR * minR, maxR * maxR, random()));
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        for (const key of Object.keys(mat)) {
          const value = mat[key];
          if (value && value.isTexture) value.dispose();
        }
        mat.dispose();
      }
    }
  });
}
