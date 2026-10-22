/**
 * Renderer bootstrap + Canvas-2D presentation fallback.
 *
 * The game is verified in a headless Chrome where SwiftShader/ANGLE can fail
 * to create *any* WebGL2 context ("BindToCurrentSequence failed"). Three.js
 * logs two console errors and throws in that case, which made the whole page
 * show its fatal-error panel and left the gameplay hooks dead.
 *
 * This module creates the WebGL2 context itself and only then hands it to
 * THREE.WebGLRenderer (so Three never has to attempt - and log - a failed
 * context creation). If no context exists, we boot a small Canvas-2D
 * presentation of the same simulation: every game mechanic, mode,
 * shop, weather and test hook keeps running, and the player still sees the
 * backyard, the log, the axe, the swing, chips, sparks and weather.
 *
 * The fallback is deliberately a presentation layer only. It owns no game
 * state and can be removed by giving the browser WebGL2 again.
 */
import * as THREE from 'three';

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cssColor(value, fallback = '#c4a06a') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `#${(value >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  }
  return fallback;
}

function shade(hex, amount) {
  const value = String(hex || '').replace('#', '');
  if (value.length !== 6) return hex;
  const n = Number.parseInt(value, 16);
  if (!Number.isFinite(n)) return hex;
  const r = clamp(((n >> 16) & 255) + amount, 0, 255);
  const g = clamp(((n >> 8) & 255) + amount, 0, 255);
  const b = clamp((n & 255) + amount, 0, 255);
  return `rgb(${r},${g},${b})`;
}

const SKY = {
  dawn: {
    top: '#263a58',
    mid: '#7f8ba1',
    low: '#f0a26b',
    sun: '#ffd6a1',
    glow: 'rgba(255,176,96,0.45)',
    grass: '#5a6d42',
    tree: '#273a25',
    house: '#5f5d58',
    fence: '#8f8877',
    light: '#ffd6a8',
  },
  noon: {
    top: '#4f90c4',
    mid: '#9bc9e8',
    low: '#e9f1ef',
    sun: '#fff5cf',
    glow: 'rgba(255,244,204,0.32)',
    grass: '#6b8b48',
    tree: '#334b2a',
    house: '#767066',
    fence: '#a49b87',
    light: '#fff6df',
  },
  golden: {
    top: '#34466f',
    mid: '#8d86a3',
    low: '#f4a45e',
    sun: '#ffcf86',
    glow: 'rgba(255,169,86,0.5)',
    grass: '#5e7440',
    tree: '#2d3b27',
    house: '#6d6359',
    fence: '#9b907b',
    light: '#ffcf99',
  },
  night: {
    top: '#050a17',
    mid: '#0d172b',
    low: '#1a2942',
    sun: '#e4ecff',
    glow: 'rgba(160,190,255,0.26)',
    grass: '#26322c',
    tree: '#121d18',
    house: '#2f3137',
    fence: '#4a4a46',
    light: '#8ea8d4',
  },
};

const WEATHER_TINT = {
  clear: { rain: 0, snow: 0, fog: 0 },
  rain: { rain: 1, snow: 0, fog: 0.35 },
  snow: { rain: 0, snow: 1, fog: 0.4 },
  fog: { rain: 0, snow: 0, fog: 1 },
  wind: { rain: 0, snow: 0, fog: 0.1 },
};

function timePalette(label) {
  return SKY[label] || SKY.golden;
}

/**
 * Create the WebGL2 context directly on the game canvas. A failed getContext()
 * is silent (unlike Three.js's WebGLRenderer constructor, which console.errors
 * twice and throws), so we only ever hand Three a context that already exists.
 * A few retries ride out a transient GPU-process start/crash. If the context
 * appears but Three cannot attach, the locked canvas is replaced below before
 * the Canvas2D path starts.
 */
async function createWebGLRenderer(canvas, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        stencil: false,
        depth: true,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      gl = null;
    }
    if (gl && !gl.isContextLost?.()) {
      try {
        return new THREE.WebGLRenderer({
          canvas,
          context: gl,
          antialias: false,
          alpha: false,
          stencil: false,
          powerPreference: 'high-performance',
        });
      } catch {
        // The canvas is now locked to a WebGL context. Stop retrying and let
        // the caller replace it with a fresh 2D surface.
        return null;
      }
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }
  return null;
}

/**
 * Try to create the real WebGL renderer, otherwise return a Canvas2DRenderer.
 * `forceCanvas` (used by ?renderer=canvas and by the smoke tests) skips WebGL.
 */
export async function createDisplayRenderer(canvas, { forceCanvas = false } = {}) {
  const wantsCanvas =
    forceCanvas ||
    (() => {
      try {
        return new URLSearchParams(window.location.search).get('renderer') === 'canvas';
      } catch {
        return false;
      }
    })();

  if (!wantsCanvas) {
    const renderer = await createWebGLRenderer(canvas);
    if (renderer) {
      return {
        renderer,
        webgl: true,
        canvas,
        reason: 'WebGL2',
      };
    }
  }

  // If a WebGL context was created on this canvas above, it cannot also expose
  // a 2D context. Replace it with a fresh canvas of the same id/class.
  let target = canvas;
  if (
    (() => {
      try {
        return Boolean(target.getContext('2d'));
      } catch {
        return false;
      }
    })() === false
  ) {
    const fresh = document.createElement('canvas');
    fresh.id = canvas.id || 'scene';
    fresh.className = canvas.className || '';
    fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || 'Backyard');
    target.replaceWith(fresh);
    target = fresh;
  }

  return {
    renderer: new Canvas2DRenderer(target),
    webgl: false,
    canvas: target,
    reason: 'WebGL2 unavailable',
  };
}

/* ------------------------------------------------------------------ *
 *  Canvas2D presentation
 * ------------------------------------------------------------------ */

export class Canvas2DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.domElement = canvas;
    this.isCanvasFallback = true;
    this.webgl = false;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!this.ctx) throw new Error('Canvas 2D fallback unavailable');
    this.info = {
      render: { calls: 1, triangles: 0, points: 0, lines: 0 },
      memory: { geometries: 0, textures: 0 },
      programs: [],
      autoReset: true,
      reset() {},
    };
    this.shadowMap = {
      enabled: false,
      autoUpdate: false,
      needsUpdate: false,
      type: 0,
    };
    this.capabilities = { isWebGL2: false, maxTextureSize: 0 };
    this.outputColorSpace = 'srgb';
    this.toneMapping = 0;
    this.toneMappingExposure = 1.08;
    this._dpr = 1;
    this._w = Math.max(1, window.innerWidth);
    this._h = Math.max(1, window.innerHeight);
    this._backdrop = document.createElement('canvas');
    this._backdropCtx = this._backdrop.getContext('2d');
    this._backdropKey = '';
    this._time = 0;
    this._impactFlash = 0;
    this._lastHitSerial = -1;
    this._tmp = new THREE.Vector3();
    this._shadow = this._tmp;
    this._vignette = null;
    this._grass = [];
    this._random = mulberry32(0x51ed);
    this._stars = [];
    this.setSize(this._w, this._h, false);
  }

  /* --- WebGLRenderer-compatible surface --------------------------- */

  setPixelRatio(value) {
    const dpr = clamp(Number(value) || 1, 0.75, 1);
    if (Math.abs(dpr - this._dpr) < 0.001) return;
    this._dpr = dpr;
    this.setSize(this._w, this._h, false);
  }

  getPixelRatio() {
    return this._dpr;
  }

  setSize(width, height, updateStyle = true) {
    this._w = Math.max(1, Math.round(width || window.innerWidth));
    this._h = Math.max(1, Math.round(height || window.innerHeight));
    const pw = Math.max(1, Math.round(this._w * this._dpr));
    const ph = Math.max(1, Math.round(this._h * this._dpr));
    this.canvas.width = pw;
    this.canvas.height = ph;
    if (updateStyle) {
      this.canvas.style.width = `${this._w}px`;
      this.canvas.style.height = `${this._h}px`;
    }
    this._backdrop.width = pw;
    this._backdrop.height = ph;
    this._backdropKey = '';
    this._vignette = null;
    this._rebuildBackdropData();
  }

  getDrawingBufferSize(target = new THREE.Vector2()) {
    target.set(this.canvas.width, this.canvas.height);
    return target;
  }

  getContext() {
    return null;
  }

  compile() {}

  render() {
    // The simulation drives drawing through draw(); this keeps the call site
    // compatible with the WebGL renderer.
  }

  dispose() {}

  /* --- scene ------------------------------------------------------- */

  _rebuildBackdropData() {
    const w = this._w;
    const h = this._h;
    const random = mulberry32((w * 73856093) ^ (h * 19349663));
    this._grass = [];
    const count = Math.round(clamp((w / 1280) * 520, 160, 620));
    for (let i = 0; i < count; i += 1) {
      const x = random() * w;
      const y = h * (0.58 + random() * 0.45);
      const depth = clamp((y - h * 0.56) / (h * 0.44), 0, 1);
      this._grass.push({
        x,
        y,
        len: (2 + random() * 8) * (0.45 + depth),
        tilt: (random() - 0.5) * 0.9,
        shade: random(),
      });
    }
    this._stars = [];
    if (w > 0) {
      for (let i = 0; i < 90; i += 1) {
        this._stars.push({
          x: random() * w,
          y: random() * h * 0.5,
          r: 0.4 + random() * 1.4,
          a: 0.3 + random() * 0.7,
          tw: random() * TAU,
        });
      }
    }
    this._vignette = null;
  }

  _project(camera, x, y, z) {
    const v = this._tmp.set(x, y, z).project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * this._w,
      y: (-v.y * 0.5 + 0.5) * this._h,
      z: v.z,
    };
  }

  draw(sim, dt = 0.016) {
    if (!this.ctx || !sim) return;
    this._time += Math.min(0.12, Math.max(0, dt));
    const camera = sim.camera;
    if (!camera) return;
    camera.updateMatrixWorld(true);

    const w = this._w;
    const h = this._h;
    const timeLabel = sim.weather?.timeLabel || 'golden';
    const weather = sim.weather?.weather || 'clear';
    const golden = clamp(sim.weather?.goldenFactor || 0, 0, 1);
    const night = clamp(sim.weather?.nightFactor || 0, 0, 1);
    const rain = clamp(sim.weather?.weatherIntensity?.rain || 0, 0, 1);
    const snow = clamp(sim.weather?.weatherIntensity?.snow || 0, 0, 1);
    const fog = clamp(sim.weather?.weatherIntensity?.fog || 0, 0, 1);
    const wind = clamp(sim.weather?.getWindStrength?.() || 0, 0, 1);

    const key = `${timeLabel}|${weather}|${Math.round(golden * 8)}|${Math.round(
      night * 8,
    )}|${Math.round(rain * 8)}|${Math.round(snow * 8)}|${Math.round(fog * 8)}|${w}x${h}`;
    if (key !== this._backdropKey) {
      this._drawBackdrop({ timeLabel, weather, golden, night, rain, snow, fog, wind });
      this._backdropKey = key;
    }

    const ctx = this.ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this._backdrop, 0, 0, w, h);

    this._drawLog(sim, camera);
    this._drawAxeAndHumanoid(sim, camera);
    this._drawFragments(sim, camera);
    this._drawWeather(sim, { rain, snow, fog, wind, dt });
    this._drawNightLife(sim, { night, rain, snow });
    this._drawScreenGrade(sim, { golden, night, rain, snow, fog });
    this._impactFlash = Math.max(0, this._impactFlash - dt * 2.8);
    this.info.render.calls = 1;
    this.info.render.lines = 0;
  }

  /* --- static backyard -------------------------------------------- */

  _drawBackdrop({ timeLabel, weather, golden, night, rain, snow, fog, wind }) {
    const ctx = this._backdropCtx;
    const w = this._w;
    const h = this._h;
    const sky = timePalette(timeLabel);
    const random = mulberry32(0xdeadbeef ^ (w * 31));
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Sky gradient.
    const grad = ctx.createLinearGradient(0, 0, 0, h * 0.66);
    grad.addColorStop(0, sky.top);
    grad.addColorStop(0.58, sky.mid);
    grad.addColorStop(1, sky.low);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h * 0.68);

    // Rain/snow/fog wash over the sky.
    if (rain > 0.01) {
      ctx.fillStyle = `rgba(47,62,76,${0.34 * rain})`;
      ctx.fillRect(0, 0, w, h * 0.68);
    }
    if (snow > 0.01) {
      ctx.fillStyle = `rgba(210,224,236,${0.25 * snow})`;
      ctx.fillRect(0, 0, w, h * 0.68);
    }
    if (fog > 0.01) {
      ctx.fillStyle = `rgba(190,199,204,${0.30 * fog})`;
      ctx.fillRect(0, 0, w, h * 0.68);
    }

    // Stars and moon at night.
    if (night > 0.08) {
      ctx.globalAlpha = clamp(night, 0, 1);
      for (const star of this._stars) {
        const twinkle = 0.65 + 0.35 * Math.sin(this._time * 1.4 + star.tw);
        ctx.fillStyle = `rgba(226,236,255,${star.a * twinkle})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, TAU);
        ctx.fill();
      }
      const mx = w * 0.22;
      const my = h * 0.17;
      const moonGrad = ctx.createRadialGradient(mx, my, 2, mx, my, h * 0.13);
      moonGrad.addColorStop(0, 'rgba(220,234,255,0.6)');
      moonGrad.addColorStop(0.25, 'rgba(180,205,240,0.14)');
      moonGrad.addColorStop(1, 'rgba(150,180,220,0)');
      ctx.fillStyle = moonGrad;
      ctx.fillRect(mx - h * 0.14, my - h * 0.14, h * 0.28, h * 0.28);
      ctx.fillStyle = '#e8f0ff';
      ctx.beginPath();
      ctx.arc(mx, my, h * 0.028, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Sun/moon glow. The fallback puts golden hour where it can be seen.
    const sunX = timeLabel === 'night' ? w * 0.22 : timeLabel === 'noon' ? w * 0.72 : w * 0.79;
    const sunY = timeLabel === 'night' ? h * 0.17 : timeLabel === 'noon' ? h * 0.15 : h * 0.56;
    if (timeLabel !== 'night') {
      const glow = ctx.createRadialGradient(sunX, sunY, 1, sunX, sunY, h * 0.42);
      glow.addColorStop(0, sky.glow);
      glow.addColorStop(0.3, rain + snow > 0.4 ? 'rgba(220,222,220,0.08)' : sky.glow);
      glow.addColorStop(1, 'rgba(255,180,100,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h * 0.7);
      ctx.fillStyle = sky.sun;
      ctx.beginPath();
      ctx.arc(sunX, sunY, h * (timeLabel === 'golden' ? 0.047 : 0.036), 0, TAU);
      ctx.fill();
    }

    // Soft clouds.
    const cloudAlpha = 0.26 + rain * 0.24 + snow * 0.2;
    for (let i = 0; i < 7; i += 1) {
      const cx = w * (0.08 + i * 0.14) + Math.sin(this._time * 0.03 + i) * 14;
      const cy = h * (0.12 + (i % 3) * 0.055) + Math.sin(i * 2.4) * 8;
      const cw = w * (0.09 + (i % 3) * 0.035);
      const ch = h * 0.026;
      ctx.fillStyle = `rgba(${night > 0.4 ? '90,105,125' : '238,232,218'},${cloudAlpha})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, ch, 0, 0, TAU);
      ctx.ellipse(cx + cw * 0.55, cy + ch * 0.2, cw * 0.6, ch * 0.8, 0, 0, TAU);
      ctx.ellipse(cx - cw * 0.55, cy + ch * 0.25, cw * 0.55, ch * 0.72, 0, 0, TAU);
      ctx.fill();
    }

    // Distant treeline.
    ctx.fillStyle = shade(sky.tree, night > 0.4 ? -6 : 8);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.60);
    for (let i = 0; i <= 24; i += 1) {
      const x = (i / 24) * w;
      const y = h * 0.54 - Math.sin(i * 1.7) * h * 0.025 - random() * h * 0.018;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h * 0.62);
    ctx.lineTo(0, h * 0.62);
    ctx.closePath();
    ctx.fill();

    // House silhouette on the left.
    this._drawHouse(ctx, w, h, sky, night, random);

    // Fence across the mid-ground.
    this._drawFence(ctx, w, h, sky, golden, rain, snow, fog);

    // Lawn.
    this._drawLawn(ctx, w, h, sky, night, rain, snow, fog, random);

    // Woodpile at the left edge.
    this._drawWoodpile(ctx, w, h, sky, night);

    // Two lantern posts; the warm pools are drawn every frame so they pulse.
    this._lanternPosts = this._lanternPosts || [];
    this._lanternPosts = [
      { x: w * 0.175, y: h * 0.70, top: h * 0.48, scale: 1 },
      { x: w * 0.835, y: h * 0.71, top: h * 0.50, scale: 0.92 },
    ];
    for (const post of this._lanternPosts) {
      ctx.strokeStyle = night > 0.3 ? '#2f302f' : '#55534c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(post.x, post.y);
      ctx.lineTo(post.x, post.top);
      ctx.stroke();
      ctx.strokeStyle = '#3a3a36';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(post.x, post.top);
      ctx.lineTo(post.x - 12, post.top + 3);
      ctx.stroke();
      ctx.fillStyle = night > 0.25 ? '#ffd28a' : '#cfc7b1';
      ctx.beginPath();
      ctx.arc(post.x - 14, post.top + 7, 5, 0, TAU);
      ctx.fill();
    }
  }

  _drawHouse(ctx, w, h, sky, night, random) {
    const hx = w * 0.015;
    const hy = h * 0.36;
    const hw = w * 0.33;
    const hh = h * 0.21;
    const wall = shade(sky.house, night > 0.4 ? -14 : 0);
    ctx.fillStyle = wall;
    ctx.beginPath();
    ctx.moveTo(hx, hy + hh);
    ctx.lineTo(hx, hy + h * 0.03);
    ctx.lineTo(hx + hw * 0.5, hy);
    ctx.lineTo(hx + hw, hy + h * 0.03);
    ctx.lineTo(hx + hw, hy + hh);
    ctx.closePath();
    ctx.fill();

    // Siding lines.
    ctx.strokeStyle = `rgba(0,0,0,${night > 0.4 ? 0.28 : 0.12})`;
    ctx.lineWidth = 1;
    for (let y = hy + h * 0.05; y < hy + hh; y += Math.max(5, h * 0.014)) {
      ctx.beginPath();
      ctx.moveTo(hx + 4, y);
      ctx.lineTo(hx + hw - 4, y);
      ctx.stroke();
    }

    // Roof and gutter.
    ctx.fillStyle = shade(sky.house, night > 0.4 ? -24 : -18);
    ctx.beginPath();
    ctx.moveTo(hx - w * 0.02, hy + h * 0.035);
    ctx.lineTo(hx + hw * 0.5, hy - h * 0.028);
    ctx.lineTo(hx + hw + w * 0.02, hy + h * 0.035);
    ctx.lineTo(hx + hw + w * 0.018, hy + h * 0.05);
    ctx.lineTo(hx - w * 0.018, hy + h * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(sky.house, -30);
    ctx.fillRect(hx - w * 0.018, hy + h * 0.048, hw + w * 0.036, Math.max(3, h * 0.009));

    // Windows: dark glass by day, warm at night.
    const lit = night > 0.28;
    const win = h * 0.055;
    for (let i = 0; i < 2; i += 1) {
      const wx = hx + hw * (0.18 + i * 0.48);
      const wy = hy + hh * 0.26;
      ctx.fillStyle = lit ? '#ffd28c' : '#303a42';
      ctx.fillRect(wx, wy, win * 1.2, win);
      ctx.strokeStyle = shade(sky.house, -12);
      ctx.lineWidth = 2;
      ctx.strokeRect(wx, wy, win * 1.2, win);
      ctx.beginPath();
      ctx.moveTo(wx + win * 0.6, wy);
      ctx.lineTo(wx + win * 0.6, wy + win);
      ctx.moveTo(wx, wy + win * 0.5);
      ctx.lineTo(wx + win * 1.2, wy + win * 0.5);
      ctx.stroke();
      if (lit) {
        const g = ctx.createRadialGradient(
          wx + win * 0.6,
          wy + win * 0.5,
          2,
          wx + win * 0.6,
          wy + win * 0.5,
          win * 2.6,
        );
        g.addColorStop(0, 'rgba(255,205,130,0.30)');
        g.addColorStop(1, 'rgba(255,205,130,0)');
        ctx.fillStyle = g;
        ctx.fillRect(wx - win * 2, wy - win * 2, win * 5, win * 5);
      }
    }

    // Door.
    ctx.fillStyle = shade(sky.house, -34);
    ctx.fillRect(hx + hw * 0.43, hy + hh * 0.44, hw * 0.09, hh * 0.56);
    ctx.fillStyle = '#d8c38d';
    ctx.beginPath();
    ctx.arc(hx + hw * 0.505, hy + hh * 0.73, 2.2, 0, TAU);
    ctx.fill();

    // Chimney and smoke.
    ctx.fillStyle = shade(sky.house, -28);
    ctx.fillRect(hx + hw * 0.72, hy - h * 0.045, w * 0.026, h * 0.08);
    if (night > 0.2 || random() > 0.5) {
      for (let i = 0; i < 4; i += 1) {
        const t = (this._time * 0.12 + i * 0.25) % 1;
        ctx.fillStyle = `rgba(190,194,196,${0.14 * (1 - t) * (night > 0.2 ? 1 : 0.5)})`;
        ctx.beginPath();
        ctx.arc(
          hx + hw * 0.735 + t * w * 0.035,
          hy - h * 0.055 - t * h * 0.12,
          (5 + t * 16) * (w / 1280),
          0,
          TAU,
        );
        ctx.fill();
      }
    }
  }

  _drawFence(ctx, w, h, sky, golden, rain, snow, fog) {
    const base = h * 0.655;
    const top = h * 0.50;
    const picket = Math.max(5, w * 0.0085);
    const gap = picket * 2.15;
    ctx.fillStyle = shade(sky.fence, rain > 0.2 ? -24 : snow > 0.2 ? 12 : 0);
    for (let x = -picket; x < w + picket; x += gap) {
      ctx.fillRect(x, top, picket, base - top);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + picket * 0.5, top - picket * 0.8);
      ctx.lineTo(x + picket, top);
      ctx.closePath();
      ctx.fill();
    }
    // Rails.
    ctx.fillStyle = shade(sky.fence, rain > 0.2 ? -18 : 4);
    ctx.fillRect(0, top + (base - top) * 0.24, w, Math.max(4, h * 0.009));
    ctx.fillRect(0, top + (base - top) * 0.66, w, Math.max(4, h * 0.009));
    // A dark base shadow anchors the fence.
    const g = ctx.createLinearGradient(0, base - h * 0.02, 0, base + h * 0.03);
    g.addColorStop(0, 'rgba(20,25,18,0)');
    g.addColorStop(1, 'rgba(20,25,18,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, base - h * 0.02, w, h * 0.05);
  }

  _drawLawn(ctx, w, h, sky, night, rain, snow, fog, random) {
    const horizon = h * 0.605;
    const g = ctx.createLinearGradient(0, horizon, 0, h);
    g.addColorStop(0, shade(sky.grass, 14));
    g.addColorStop(0.45, sky.grass);
    g.addColorStop(1, shade(sky.grass, night > 0.4 ? -18 : -22));
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, w, h - horizon);

    // Mown stripes recede toward the horizon.
    for (let i = 0; i < 8; i += 1) {
      const y0 = horizon + ((h - horizon) * i) / 8;
      const y1 = horizon + ((h - horizon) * (i + 1)) / 8;
      ctx.fillStyle = `rgba(225,240,190,${i % 2 ? 0.025 : 0.055})`;
      ctx.fillRect(0, y0, w, y1 - y0);
    }

    // Wet/frost/snow wash on the ground.
    if (rain > 0.01) {
      ctx.fillStyle = `rgba(35,48,52,${0.18 * rain})`;
      ctx.fillRect(0, horizon, w, h - horizon);
    }
    if (snow > 0.01) {
      ctx.fillStyle = `rgba(225,235,240,${0.42 * snow})`;
      ctx.fillRect(0, horizon, w, h - horizon);
    }

    // Grass tufts, cached once per backdrop.
    for (const blade of this._grass) {
      const tone = blade.shade > 0.5 ? 26 : -14;
      ctx.strokeStyle = `rgba(${90 + tone},${118 + tone},${58 + tone * 0.5},0.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(blade.x, blade.y);
      ctx.quadraticCurveTo(
        blade.x + blade.tilt * 3,
        blade.y - blade.len * 0.55,
        blade.x + blade.tilt * 7 + Math.sin(blade.x) * 1.5,
        blade.y - blade.len,
      );
      ctx.stroke();
    }

    // A few clover/petal dots.
    for (let i = 0; i < 26; i += 1) {
      const x = random() * w;
      const y = horizon + (h - horizon) * (0.12 + random() * 0.85);
      ctx.fillStyle = `rgba(226,211,137,${0.3 + random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, TAU);
      ctx.fill();
    }

    // Patio/chopping pad under the block.
    const px = w * 0.5;
    const py = h * 0.80;
    const pw = w * 0.24;
    const ph = h * 0.075;
    const pad = ctx.createRadialGradient(px, py, 5, px, py, pw * 0.7);
    pad.addColorStop(0, 'rgba(96,82,62,0.55)');
    pad.addColorStop(0.7, 'rgba(73,65,52,0.34)');
    pad.addColorStop(1, 'rgba(60,58,47,0)');
    ctx.fillStyle = pad;
    ctx.beginPath();
    ctx.ellipse(px, py, pw * 0.7, ph, 0, 0, TAU);
    ctx.fill();
  }

  _drawWoodpile(ctx, w, h, sky, night) {
    const x0 = w * 0.035;
    const y0 = h * 0.755;
    const r = Math.max(9, w * 0.013);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        if (row === 2 && col === 3) continue;
        const x = x0 + col * r * 2.05 + (row % 2) * r * 0.65;
        const y = y0 - row * r * 1.72;
        ctx.fillStyle = shade(sky.grass, night > 0.4 ? -20 : -6);
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = `rgba(48,36,24,${night > 0.4 ? 0.8 : 0.55})`;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(205,172,120,0.45)';
        ctx.lineWidth = 1;
        for (let ring = 1; ring <= 3; ring += 1) {
          ctx.beginPath();
          ctx.ellipse(x, y, (r * ring) / 4.2, (r * 0.8 * ring) / 4.2, 0, 0, TAU);
          ctx.stroke();
        }
      }
    }
    // A tarp corner and shadow.
    ctx.fillStyle = 'rgba(31,35,30,0.28)';
    ctx.fillRect(x0 - r, y0 - r * 3.4, r * 9.2, r * 4.6);
  }

  /* --- log --------------------------------------------------------- */

  _logMetrics(sim, camera) {
    const d = sim.debris;
    const topY = d?.topY || 0.94;
    const baseY = d?.baseY || 0.48;
    const radius = Math.max(0.04, d?.radius || 0.17);
    const center = this._project(camera, 0, topY, -0.95);
    const edgeX = this._project(camera, radius, topY, -0.95);
    const edgeZ = this._project(camera, 0, topY, -0.95 + radius);
    const base = this._project(camera, 0, baseY, -0.95);
    // The fallback is a stylised presentation, so give the log a little more
    // screen weight than a strict 40-degree projection would provide. Aim and
    // target markers use this same transform, so the reticle still sits on the
    // visible grain.
    const rx = Math.max(8, Math.min(260, Math.abs(edgeX.x - center.x) * 1.45));
    const ry = Math.max(5, Math.min(200, Math.abs(edgeZ.y - center.y) * 1.45));
    const sideH = Math.max(6, Math.min(340, Math.abs(base.y - center.y) * 1.2));
    center.y -= ry * 0.12;
    return { center, base, rx, ry, sideH, topY, baseY, radius };
  }

  _drawLog(sim, camera) {
    const ctx = this.ctx;
    const d = sim.debris;
    if (!d) return;
    const m = this._logMetrics(sim, camera);
    const { center, base, rx, ry, sideH } = m;
    const night = clamp(sim.weather?.nightFactor || 0, 0, 1);
    const wetness = clamp(d.wetness || 0, 0, 1);
    const snowLoad = clamp(d.snowLoad || 0, 0, 1);
    const cutTint = cssColor(d.log?.cutTint, '#d9b37c');
    const bark = cssColor(d.log?.barkTint, '#7b5e40');
    const light = 1 - night * 0.55;

    this._drawBlock(ctx, m, night);

    if (!d.active) {
      // Bark side.
      const sideGrad = ctx.createLinearGradient(center.x - rx, 0, center.x + rx, 0);
      sideGrad.addColorStop(0, shade(bark, -38));
      sideGrad.addColorStop(0.28, shade(bark, 10 * light));
      sideGrad.addColorStop(0.62, shade(bark, 22 * light));
      sideGrad.addColorStop(1, shade(bark, -46));
      ctx.fillStyle = sideGrad;
      ctx.beginPath();
      ctx.moveTo(center.x - rx, center.y);
      ctx.lineTo(center.x - rx, center.y + sideH);
      ctx.ellipse(center.x, center.y + sideH, rx, ry, 0, Math.PI, 0, true);
      ctx.lineTo(center.x + rx, center.y);
      ctx.ellipse(center.x, center.y, rx, ry, 0, 0, Math.PI, true);
      ctx.closePath();
      ctx.fill();

      // Bark grooves. These are the part the broken normal-map path used to
      // hide: keep them visible even on the flat fallback.
      ctx.strokeStyle = `rgba(30,20,12,${0.34 + 0.2 * (1 - light)})`;
      ctx.lineWidth = Math.max(1, rx * 0.022);
      for (let i = 1; i < 8; i += 1) {
        const f = i / 8;
        const x = center.x - rx + rx * 2 * f;
        ctx.beginPath();
        ctx.moveTo(x, center.y + ry * 0.2);
        ctx.quadraticCurveTo(
          x + Math.sin(i * 3.7 + d.log?.seed) * rx * 0.07,
          center.y + sideH * 0.5,
          x + Math.sin(i * 1.3) * rx * 0.05,
          center.y + sideH,
        );
        ctx.stroke();
      }
      // Lit bark lips.
      ctx.strokeStyle = `rgba(235,205,155,${0.10 * light})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i += 1) {
        const x = center.x - rx + rx * 2 * ((i + 0.35) / 5);
        ctx.beginPath();
        ctx.moveTo(x, center.y + ry * 0.3);
        ctx.lineTo(x + rx * 0.02, center.y + sideH * 0.92);
        ctx.stroke();
      }

      this._drawEndGrain(ctx, sim, m, { cutTint, bark, night, snowLoad, wetness, light });
      this._drawTargets(ctx, sim, m);
    }

    // Accumulated snow cap on the bark skirt.
    if (snowLoad > 0.02) {
      ctx.fillStyle = `rgba(236,244,250,${0.72 * snowLoad})`;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y + sideH * 0.035, rx * 0.94, ry * 0.45, 0, 0, Math.PI);
      ctx.fill();
    }

    // Wet rim, drips, frost veins.
    if (wetness > 0.06) {
      ctx.strokeStyle = `rgba(178,214,230,${0.28 + wetness * 0.32})`;
      ctx.lineWidth = Math.max(1, rx * 0.03);
      ctx.beginPath();
      ctx.ellipse(center.x, center.y + 1, rx * 0.92, ry * 0.9, 0, Math.PI * 1.06, Math.PI * 1.9);
      ctx.stroke();
      for (let i = 0; i < 3; i += 1) {
        const x = center.x - rx * 0.6 + rx * 0.6 * i;
        ctx.strokeStyle = `rgba(190,220,235,${0.22 + wetness * 0.2})`;
        ctx.beginPath();
        ctx.moveTo(x, center.y + ry * 0.8);
        ctx.quadraticCurveTo(x + 1, center.y + sideH * 0.5, x, center.y + sideH * 0.8);
        ctx.stroke();
      }
    }

    // Stump roots at the base.
    if (d.log?.stump) {
      ctx.fillStyle = shade(bark, -26);
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * TAU + 0.3;
        ctx.beginPath();
        ctx.ellipse(
          center.x + Math.cos(a) * rx * 0.98,
          center.y + sideH + Math.sin(a) * ry * 0.65,
          rx * 0.28,
          ry * 0.32,
          a,
          0,
          Math.PI,
        );
        ctx.fill();
      }
    }

    if (this._impactFlash > 0.01) {
      const p = this._project(
        camera,
        (sim.effectiveAim?.x || 0),
        m.topY + 0.02,
        -0.95 + (sim.effectiveAim?.z || 0),
      );
      const r = rx * (0.5 + (1 - this._impactFlash) * 2.2);
      const flash = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r);
      flash.addColorStop(0, `rgba(255,244,210,${0.85 * this._impactFlash})`);
      flash.addColorStop(0.35, `rgba(255,186,92,${0.45 * this._impactFlash})`);
      flash.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = flash;
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
  }

  _drawBlock(ctx, m, night) {
    const { center, rx, sideH, baseY } = m;
    const blockH = Math.max(20, sideH * 0.5);
    const bottom = center.y + sideH + blockH;
    const blockW = rx * 2.3;
    const g = ctx.createLinearGradient(center.x - blockW / 2, 0, center.x + blockW / 2, 0);
    g.addColorStop(0, '#2d2419');
    g.addColorStop(0.45, night > 0.4 ? '#4b3c2a' : '#6a5338');
    g.addColorStop(1, '#241c13');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(center.x - blockW / 2, center.y + sideH);
    ctx.lineTo(center.x - blockW / 2, bottom);
    ctx.ellipse(center.x, bottom, blockW / 2, rx * 0.28, 0, Math.PI, 0, true);
    ctx.lineTo(center.x + blockW / 2, center.y + sideH);
    ctx.closePath();
    ctx.fill();
    // Block top rim.
    ctx.fillStyle = '#3c2d1e';
    ctx.beginPath();
    ctx.ellipse(center.x, center.y + sideH + 1, blockW / 2, rx * 0.3, 0, 0, Math.PI);
    ctx.fill();
    // Shadow on the lawn.
    ctx.fillStyle = 'rgba(18,22,16,0.35)';
    ctx.beginPath();
    ctx.ellipse(center.x + rx * 0.2, Math.max(bottom, baseY + m.sideH + blockH) + 2, blockW * 0.9, rx * 0.34, 0, 0, TAU);
    ctx.fill();
  }

  _drawEndGrain(ctx, sim, m, { cutTint, bark, night, snowLoad, wetness, light }) {
    const d = sim.debris;
    const { center, rx, ry } = m;
    const topY = m.topY;

    // Bark rim.
    ctx.fillStyle = shade(bark, -24);
    ctx.beginPath();
    ctx.ellipse(center.x, center.y + 1, rx * 1.035, ry * 1.05, 0, 0, TAU);
    ctx.fill();

    // Fresh cut: warm sapwood with a brighter heart.
    const g = ctx.createRadialGradient(center.x, center.y, 1, center.x, center.y, rx);
    g.addColorStop(0, shade(cutTint, 16 * light));
    g.addColorStop(0.45, cutTint);
    g.addColorStop(0.82, shade(cutTint, -16));
    g.addColorStop(1, shade(bark, 24));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, rx, ry, 0, 0, TAU);
    ctx.fill();

    // Growth rings.
    for (let i = 1; i <= 9; i += 1) {
      const f = i / 10;
      ctx.strokeStyle = `rgba(96,66,37,${0.10 + (i % 2) * 0.10})`;
      ctx.lineWidth = Math.max(0.7, rx * 0.012);
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, rx * f * 0.94, ry * f * 0.94, 0, 0, TAU);
      ctx.stroke();
    }
    // Sap/heart colour break.
    ctx.strokeStyle = `rgba(126,84,44,${0.28 * light})`;
    ctx.lineWidth = Math.max(1, rx * 0.025);
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, rx * 0.62, ry * 0.62, 0, 0, TAU);
    ctx.stroke();

    // Radial checks, deterministic by log seed.
    const seeds = mulberry32((d.log?.seed || 3) * 97 + 11);
    const cracks = Math.min(9, 2 + (d.crackLines || 0) + Math.floor(d.strikesDone || 0));
    for (let i = 0; i < cracks; i += 1) {
      const a = seeds() * TAU;
      const inner = 0.18 + seeds() * 0.25;
      const outer = 0.74 + seeds() * 0.24;
      ctx.strokeStyle = `rgba(48,30,16,${0.34 + (i / cracks) * 0.3})`;
      ctx.lineWidth = Math.max(1, rx * 0.018);
      ctx.beginPath();
      ctx.moveTo(center.x + Math.cos(a) * rx * inner, center.y + Math.sin(a) * ry * inner);
      ctx.quadraticCurveTo(
        center.x + Math.cos(a + 0.1) * rx * ((inner + outer) / 2),
        center.y + Math.sin(a + 0.1) * ry * ((inner + outer) / 2),
        center.x + Math.cos(a) * rx * outer,
        center.y + Math.sin(a) * ry * outer,
      );
      ctx.stroke();
    }

    // Golden master check / riving seam.
    if (d.masterSeam != null && !d.log?.boss && !d.log?.hollow && !d.log?.stump && !d.log?.ringShake) {
      const a = d.masterSeam;
      ctx.save();
      ctx.shadowColor = 'rgba(255,196,96,0.9)';
      ctx.shadowBlur = Math.max(4, rx * 0.2);
      ctx.strokeStyle = 'rgba(255,205,112,0.92)';
      ctx.lineWidth = Math.max(1.5, rx * 0.035);
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(center.x + Math.cos(a) * rx * 0.96, center.y + Math.sin(a) * ry * 0.96);
      ctx.stroke();
      ctx.restore();
      const gx = center.x + Math.cos(a) * rx * 0.9;
      const gy = center.y + Math.sin(a) * ry * 0.9;
      ctx.fillStyle = '#ffe8ae';
      ctx.beginPath();
      ctx.arc(gx, gy, Math.max(2, rx * 0.035), 0, TAU);
      ctx.fill();
    }

    // Boss weak seam.
    if (d.log?.boss && d.weakAngle != null) {
      const a = d.weakAngle;
      const phase2 = (d.bossPhase || 1) >= 2;
      ctx.strokeStyle = phase2 ? 'rgba(255,96,76,0.95)' : 'rgba(255,192,110,0.9)';
      ctx.lineWidth = Math.max(2, rx * 0.075);
      ctx.beginPath();
      ctx.arc(center.x, center.y, rx * 0.7, a - 0.55, a + 0.55);
      ctx.stroke();
      ctx.fillStyle = phase2 ? '#ff6a52' : '#ffd28a';
      ctx.beginPath();
      ctx.arc(center.x + Math.cos(a) * rx * 0.7, center.y + Math.sin(a) * ry * 0.7, rx * 0.06, 0, TAU);
      ctx.fill();
    }

    // Ring shake loose arc.
    if (d.log?.ringShake && !d.log?.boss) {
      const a = d.ringShakeAngle || 0;
      const half = d.ringVisualHalfWidth || d.ringArcHalfWidth || 0.42;
      const r = d.ringShakeRadius || 0.63;
      ctx.strokeStyle = d.ringShakeLoose ? 'rgba(255,214,130,0.95)' : 'rgba(150,220,210,0.9)';
      ctx.lineWidth = Math.max(2, rx * 0.055);
      ctx.beginPath();
      ctx.arc(center.x, center.y, rx * r, a - half, a + half);
      ctx.stroke();
      if (!d.ringShakeLoose) {
        for (let i = -1; i <= 1; i += 1) {
          const ga = a + i * half * 0.6;
          ctx.fillStyle = 'rgba(210,255,245,0.9)';
          ctx.beginPath();
          ctx.arc(center.x + Math.cos(ga) * rx * r, center.y + Math.sin(ga) * ry * r, rx * 0.025, 0, TAU);
          ctx.fill();
        }
      }
    }

    // Hollow core / collapse.
    if (d.log?.hollow && d.hollowCore) {
      const hc = d.hollowCore;
      const r = (d.hollowCollapsed ? (d.hollowHoleRadius || hc.radius * 1.4) : hc.radius) * (rx / m.radius);
      const hx = center.x + (hc.x / m.radius) * rx;
      const hy = center.y + (hc.z / m.radius) * ry;
      const hole = ctx.createRadialGradient(hx, hy, 1, hx, hy, Math.max(4, r));
      hole.addColorStop(0, d.hollowCollapsed ? '#140f0b' : '#241a12');
      hole.addColorStop(0.7, '#372417');
      hole.addColorStop(1, 'rgba(60,40,24,0.15)');
      ctx.fillStyle = hole;
      ctx.beginPath();
      ctx.ellipse(hx, hy, Math.max(3, r), Math.max(2, r * 0.82), 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,84,50,0.7)';
      ctx.lineWidth = Math.max(1, rx * 0.02);
      ctx.beginPath();
      ctx.ellipse(hx, hy, Math.max(3, r), Math.max(2, r * 0.82), 0, 0, TAU);
      ctx.stroke();
    }

    // Knots and embedded steel.
    for (const knot of d.knots || []) {
      const kx = center.x + (knot.x / m.radius) * rx;
      const ky = center.y + (knot.z / m.radius) * ry;
      const kr = Math.max(2, (knot.radius / m.radius) * rx);
      const kg = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
      kg.addColorStop(0, '#3b2918');
      kg.addColorStop(0.7, '#5c4228');
      kg.addColorStop(1, 'rgba(70,50,30,0.1)');
      ctx.fillStyle = kg;
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr, kr * 0.82, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,26,14,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr, kr * 0.82, 0, 0, TAU);
      ctx.stroke();
    }
    for (const hazard of d.hazards || []) {
      const hx = center.x + (hazard.x / m.radius) * rx;
      const hy = center.y + (hazard.z / m.radius) * ry;
      const hr = Math.max(1.5, (hazard.radius / m.radius) * rx * 0.8);
      ctx.fillStyle = hazard.hazard?.type === 'stone' ? '#b9b6ad' : '#c7c9cb';
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,235,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, TAU);
      ctx.stroke();
    }

    // Snow/frost accumulation on the top face.
    if (snowLoad > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, rx * 0.98, ry * 0.98, 0, 0, TAU);
      ctx.clip();
      ctx.fillStyle = `rgba(235,244,250,${0.48 + snowLoad * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(
        center.x - rx * 0.08,
        center.y - ry * 0.18,
        rx * 0.94,
        ry * 0.78,
        -0.2,
        0,
        TAU,
      );
      ctx.fill();
      ctx.restore();
      if (d.surfaceFrozen) {
        const rnd = mulberry32((d.log?.seed || 1) * 17 + 3);
        ctx.strokeStyle = 'rgba(214,235,248,0.36)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 7; i += 1) {
          const a = rnd() * TAU;
          const r0 = rnd() * 0.35;
          ctx.beginPath();
          ctx.moveTo(center.x + Math.cos(a) * rx * r0, center.y + Math.sin(a) * ry * r0);
          ctx.lineTo(center.x + Math.cos(a + 0.15) * rx * 0.94, center.y + Math.sin(a + 0.15) * ry * 0.94);
          ctx.stroke();
        }
      }
    }

    // Wet sheen.
    if (wetness > 0.05) {
      ctx.strokeStyle = `rgba(200,232,244,${0.15 + wetness * 0.35})`;
      ctx.lineWidth = Math.max(1, rx * 0.03);
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, rx * 0.7, ry * 0.7, 0, Math.PI * 1.1, Math.PI * 1.8);
      ctx.stroke();
    }
  }

  _drawTargets(ctx, sim, m) {
    const d = sim.debris;
    const { center, rx, ry, radius } = m;
    const aim = sim.aim || { x: 0, z: 0 };
    const ax = center.x + (aim.x / radius) * rx;
    const ay = center.y + (aim.z / radius) * ry;
    const pulse = 1 + Math.sin(this._time * 5.5) * 0.08;
    if (!d.active) {
      ctx.strokeStyle = 'rgba(255,207,120,0.92)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ax, ay, Math.max(8, rx * 0.26) * pulse, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ax, ay, Math.max(2, rx * 0.045), 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax - rx * 0.4, ay);
      ctx.lineTo(ax - rx * 0.18, ay);
      ctx.moveTo(ax + rx * 0.18, ay);
      ctx.lineTo(ax + rx * 0.4, ay);
      ctx.moveTo(ax, ay - ry * 0.45);
      ctx.lineTo(ax, ay - ry * 0.2);
      ctx.moveTo(ax, ay + ry * 0.2);
      ctx.lineTo(ax, ay + ry * 0.45);
      ctx.stroke();
    }

    // Wedge slots.
    for (const slot of d.wedgeSlots || []) {
      const wx = center.x + (slot.x / radius) * rx;
      const wy = center.y + (slot.z / radius) * ry;
      ctx.fillStyle = slot.homed ? 'rgba(255,184,90,0.9)' : 'rgba(180,190,196,0.7)';
      ctx.beginPath();
      ctx.arc(wx, wy, Math.max(1.5, rx * 0.026), 0, TAU);
      ctx.fill();
    }
    // Root notches on the stump.
    for (const notch of d.rootNotches || []) {
      if (notch.cut) continue;
      const nx = center.x + Math.cos(notch.angle) * rx * 1.01;
      const ny = center.y + Math.sin(notch.angle) * ry * 1.01 + m.sideH * 0.42;
      ctx.fillStyle = 'rgba(255,178,76,0.85)';
      ctx.beginPath();
      ctx.arc(nx, ny, Math.max(2, rx * 0.05), 0, TAU);
      ctx.fill();
    }
  }

  /* --- axe + anonymous woodcutter --------------------------------- */

  _drawAxeAndHumanoid(sim, camera) {
    const ctx = this.ctx;
    const root = this._project(camera, 0, 0.02, 0.3);
    const hip = this._project(camera, 0, 0.88, 0.3);
    const shoulder = this._project(camera, 0, 1.45, 0.3);
    const head = this._project(camera, 0, 1.72, 0.3);
    const scale = Math.max(14, root.y - head.y);
    if (!Number.isFinite(scale) || scale < 10) return;
    const body = sim.targetPose?.body || {};
    const lean = (body.lean || 0) * scale * 0.18;
    const side = (body.side || 0) * scale * 0.12;
    const crouch = (body.crouch || 0) * scale * 0.22;
    const ox = side + Math.sin(this._time * 0.9) * scale * 0.004;
    const oy = crouch;

    // Long ground shadow.
    ctx.fillStyle = 'rgba(20,24,16,0.32)';
    ctx.beginPath();
    ctx.ellipse(root.x + scale * 0.3, root.y + 2, scale * 0.42, scale * 0.1, 0, 0, TAU);
    ctx.fill();

    // Legs.
    ctx.strokeStyle = '#2f3d52';
    ctx.lineWidth = Math.max(4, scale * 0.085);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(root.x - scale * 0.12 + ox, root.y - oy);
    ctx.lineTo(hip.x - scale * 0.11 + ox, hip.y - oy);
    ctx.moveTo(root.x + scale * 0.12 + ox, root.y - oy);
    ctx.lineTo(hip.x + scale * 0.1 + ox, hip.y - oy);
    ctx.stroke();

    // Boots.
    ctx.fillStyle = '#3a2a1d';
    ctx.beginPath();
    ctx.ellipse(root.x - scale * 0.13 + ox, root.y - scale * 0.02, scale * 0.09, scale * 0.055, 0, 0, TAU);
    ctx.ellipse(root.x + scale * 0.13 + ox, root.y - scale * 0.02, scale * 0.09, scale * 0.055, 0, 0, TAU);
    ctx.fill();

    // Torso (flannel).
    const torso = ctx.createLinearGradient(shoulder.x - scale * 0.25, 0, shoulder.x + scale * 0.25, 0);
    torso.addColorStop(0, '#5f2a22');
    torso.addColorStop(0.45, '#984635');
    torso.addColorStop(0.75, '#b5573d');
    torso.addColorStop(1, '#5b2a24');
    ctx.fillStyle = torso;
    ctx.beginPath();
    ctx.moveTo(shoulder.x - scale * 0.21 + ox + lean * 0.2, shoulder.y - oy);
    ctx.quadraticCurveTo(shoulder.x - scale * 0.28 + ox, (shoulder.y + hip.y) / 2 - oy, hip.x - scale * 0.16 + ox, hip.y - oy);
    ctx.lineTo(hip.x + scale * 0.16 + ox, hip.y - oy);
    ctx.quadraticCurveTo(shoulder.x + scale * 0.28 + ox, (shoulder.y + hip.y) / 2 - oy, shoulder.x + scale * 0.21 + ox + lean * 0.2, shoulder.y - oy);
    ctx.quadraticCurveTo(shoulder.x + ox + lean * 0.25, shoulder.y - scale * 0.07 - oy, shoulder.x - scale * 0.21 + ox + lean * 0.2, shoulder.y - oy);
    ctx.closePath();
    ctx.fill();
    // Plaid stripes.
    ctx.strokeStyle = 'rgba(38,22,18,0.42)';
    ctx.lineWidth = Math.max(1, scale * 0.014);
    for (let i = -2; i <= 2; i += 1) {
      const x = shoulder.x + i * scale * 0.075 + ox;
      ctx.beginPath();
      ctx.moveTo(x, shoulder.y - oy + scale * 0.02);
      ctx.lineTo(x + lean * 0.15, hip.y - oy - scale * 0.02);
      ctx.stroke();
    }

    // Head, cap and beard.
    const hx = head.x + ox + lean * 0.25;
    const hy = head.y - oy;
    ctx.fillStyle = '#c89a72';
    ctx.beginPath();
    ctx.arc(hx, hy, scale * 0.105, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#6c3a27';
    ctx.beginPath();
    ctx.arc(hx, hy - scale * 0.045, scale * 0.113, Math.PI, TAU);
    ctx.fill();
    ctx.fillRect(hx - scale * 0.11, hy - scale * 0.055, scale * 0.22, scale * 0.035);
    ctx.fillStyle = '#4b2f21';
    ctx.beginPath();
    ctx.ellipse(hx, hy + scale * 0.075, scale * 0.075, scale * 0.085, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#2b1c14';
    ctx.beginPath();
    ctx.arc(hx - scale * 0.04, hy + scale * 0.005, scale * 0.012, 0, TAU);
    ctx.arc(hx + scale * 0.04, hy + scale * 0.005, scale * 0.012, 0, TAU);
    ctx.fill();

    // Swing arm to the axe grip.
    const gripWorld = sim.targetPose?.grip || new THREE.Vector3(0, 1, 0.1);
    const grip = this._project(camera, gripWorld.x, gripWorld.y, gripWorld.z);
    ctx.strokeStyle = '#a44c37';
    ctx.lineWidth = Math.max(3, scale * 0.07);
    ctx.beginPath();
    ctx.moveTo(shoulder.x + scale * 0.18 + ox, shoulder.y - oy + scale * 0.03);
    ctx.quadraticCurveTo(
      lerp(shoulder.x, grip.x, 0.55) + scale * 0.06,
      lerp(shoulder.y, grip.y, 0.45) - scale * 0.02,
      grip.x,
      grip.y,
    );
    ctx.stroke();

    // Axe: handle from the projected grip to the projected head.
    const headWorld = sim.axe?.getHeadWorld?.(new THREE.Vector3());
    let axeHead = null;
    if (headWorld && Number.isFinite(headWorld.x)) {
      axeHead = this._project(camera, headWorld.x, headWorld.y, headWorld.z);
    }
    if (!axeHead || !Number.isFinite(axeHead.x) || Math.hypot(axeHead.x - grip.x, axeHead.y - grip.y) < 6) {
      const a = sim.sim?.active ? lerp(-2.2, 0.55, clamp((sim.sim.t || 0) / 1.1, 0, 1)) : -0.9;
      axeHead = { x: grip.x + Math.cos(a) * scale * 0.55, y: grip.y + Math.sin(a) * scale * 0.55 };
    }
    const dx = axeHead.x - grip.x;
    const dy = axeHead.y - grip.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const bx = grip.x - ux * len * 0.28;
    const by = grip.y - uy * len * 0.28;
    ctx.strokeStyle = '#8c6239';
    ctx.lineWidth = Math.max(3, scale * 0.038);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(axeHead.x, axeHead.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(235,214,170,0.24)';
    ctx.lineWidth = Math.max(1, scale * 0.01);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(axeHead.x, axeHead.y);
    ctx.stroke();

    // Steel head as a small perpendicular wedge.
    const px = -uy;
    const py = ux;
    const hl = scale * 0.16;
    const hw = scale * 0.07;
    ctx.fillStyle = '#9aa3a6';
    ctx.beginPath();
    ctx.moveTo(axeHead.x + px * hl + ux * hw, axeHead.y + py * hl + uy * hw);
    ctx.lineTo(axeHead.x - px * hl + ux * hw, axeHead.y - py * hl + uy * hw);
    ctx.lineTo(axeHead.x - px * hl * 0.7 - ux * hw * 1.4, axeHead.y - py * hl * 0.7 - uy * hw * 1.4);
    ctx.lineTo(axeHead.x + px * hl * 0.7 - ux * hw * 1.4, axeHead.y + py * hl * 0.7 - uy * hw * 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e8f2f4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axeHead.x + px * hl + ux * hw, axeHead.y + py * hl + uy * hw);
    ctx.lineTo(axeHead.x + px * hl * 0.7 - ux * hw * 1.4, axeHead.y + py * hl * 0.7 - uy * hw * 1.4);
    ctx.stroke();

    // Hand on the grip.
    ctx.fillStyle = '#4a3326';
    ctx.beginPath();
    ctx.arc(grip.x, grip.y, Math.max(2.5, scale * 0.042), 0, TAU);
    ctx.fill();
  }

  /* --- fragments + particles -------------------------------------- */

  _drawFragments(sim, camera) {
    const ctx = this.ctx;
    const d = sim.debris;
    if (!d) return;
    const pieces = [...(d.pieces || []), ...(d.chips || [])];
    if (!pieces.length) return;
    for (const item of pieces) {
      let p = null;
      try {
        p = item.body?.translation?.();
      } catch {
        p = null;
      }
      if (!p) continue;
      const s = this._project(camera, p.x, p.y, p.z);
      if (s.z < -1 || s.z > 1) continue;
      const dist = Math.max(1, s.z * 4 + 6);
      const r = clamp(16 / dist, 1.2, 9) * (item.kind === 'splinter' ? 0.6 : 1);
      let color = '#c99f69';
      if (item.kind === 'bark' || item.kind === 'rot') color = '#5f4a32';
      else if (item.kind === 'wedge') color = '#8d9699';
      else if (item.kind === 'ring') color = '#b58a55';
      else if (item.kind === 'core') color = '#d3ac74';
      else if (item.kind === 'splinter') color = '#e2bf8a';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r * 1.5, r, Math.sin(p.x * 2 + p.z) * 0.8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(52,34,20,0.5)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Dust clouds.
    let dustDrawn = 0;
    for (const burst of d.dust || []) {
      const attr = burst.points?.geometry?.attributes?.position;
      if (!attr) continue;
      const alpha = clamp(burst.material?.opacity ?? 0.4, 0, 0.6);
      const step = Math.max(1, Math.floor(attr.count / 28));
      for (let i = 0; i < attr.count && dustDrawn < 90; i += step) {
        const s = this._project(camera, attr.getX(i), attr.getY(i), attr.getZ(i));
        if (s.z < -1 || s.z > 1) continue;
        ctx.fillStyle = `rgba(222,202,166,${alpha * 0.55})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.2 + (i % 3), 0, TAU);
        ctx.fill();
        dustDrawn += 1;
      }
    }

    // Sparks.
    for (const burst of d.sparks || []) {
      const attr = burst.points?.geometry?.attributes?.position;
      if (!attr) continue;
      const alpha = clamp(burst.points?.material?.opacity ?? 1, 0, 1);
      const step = Math.max(1, Math.floor(attr.count / 22));
      for (let i = 0; i < attr.count; i += step) {
        const s = this._project(camera, attr.getX(i), attr.getY(i), attr.getZ(i));
        ctx.fillStyle = `rgba(255,215,125,${alpha})`;
        ctx.fillRect(s.x - 1, s.y - 1, 2.2, 2.2);
      }
    }
  }

  /* --- weather ----------------------------------------------------- */

  _drawWeather(sim, { rain, snow, fog, wind, dt }) {
    const ctx = this.ctx;
    const w = this._w;
    const h = this._h;
    const t = this._time;
    const windOff = wind * 0.8;
    if (rain > 0.015) {
      const count = Math.round(80 + rain * 130);
      ctx.strokeStyle = `rgba(160,198,220,${0.18 + rain * 0.4})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i < count; i += 1) {
        const seed = i * 97.13;
        const x = (seed + t * (160 + (i % 5) * 40)) % (w + 120) - 60 + windOff * 22;
        const y = (seed * 1.7 + t * (520 + (i % 7) * 80)) % (h + 80) - 40;
        const len = 12 + (i % 4) * 5;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4 - windOff * 6, y + len);
      }
      ctx.stroke();
      // Splashes on the block / ground.
      for (let i = 0; i < 10; i += 1) {
        const x = w * 0.35 + ((i * 137 + t * 60) % (w * 0.3));
        const y = h * 0.78 + ((i * 53 + t * 40) % (h * 0.13));
        ctx.strokeStyle = `rgba(190,220,235,${0.24 * rain})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 4 + (i % 3) * 3, 1.4, 0, 0, TAU);
        ctx.stroke();
      }
    }

    if (snow > 0.015) {
      const count = Math.round(70 + snow * 120);
      for (let i = 0; i < count; i += 1) {
        const seed = i * 71.7;
        const x = (seed + Math.sin(t * 0.5 + i) * 18 + windOff * 40) % (w + 20);
        const y = (seed * 1.9 + t * (26 + (i % 6) * 16)) % (h + 20) - 10;
        const r = 1 + (i % 4) * 0.6;
        ctx.fillStyle = `rgba(240,247,255,${0.4 + snow * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
      // Cold haze.
      const cold = ctx.createLinearGradient(0, h * 0.55, 0, h);
      cold.addColorStop(0, `rgba(210,224,236,0)`);
      cold.addColorStop(1, `rgba(210,224,236,${0.12 * snow})`);
      ctx.fillStyle = cold;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);
    }

    if (fog > 0.015) {
      const g = ctx.createLinearGradient(0, h * 0.42, 0, h);
      g.addColorStop(0, `rgba(196,204,206,0)`);
      g.addColorStop(0.55, `rgba(196,204,206,${0.2 * fog})`);
      g.addColorStop(1, `rgba(186,196,198,${0.36 * fog})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, h * 0.42, w, h * 0.58);
    }
  }

  _drawNightLife(sim, { night, rain, snow }) {
    if (night < 0.12 || rain > 0.5 || snow > 0.5) return;
    const ctx = this.ctx;
    const w = this._w;
    const h = this._h;
    const posts = this._lanternPosts || [];
    // Warm additive ground pools under each lantern.
    for (const post of posts) {
      const g = ctx.createRadialGradient(post.x, post.y, 2, post.x, post.y, w * 0.09);
      g.addColorStop(0, `rgba(255,186,98,${0.24 * night})`);
      g.addColorStop(0.5, `rgba(255,160,70,${0.09 * night})`);
      g.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(post.x, post.y, w * 0.09, h * 0.035, 0, 0, TAU);
      ctx.fill();
      // Bulb + halo.
      const halo = ctx.createRadialGradient(post.x - 14, post.top + 7, 1, post.x - 14, post.top + 7, 30);
      halo.addColorStop(0, 'rgba(255,224,160,0.9)');
      halo.addColorStop(0.25, `rgba(255,186,92,${0.35 + night * 0.2})`);
      halo.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(post.x - 46, post.top - 25, 64, 64);
    }
    // Fireflies.
    for (let i = 0; i < 18; i += 1) {
      const x = w * 0.2 + Math.sin(this._time * 0.4 + i * 1.7) * w * 0.28 + Math.cos(i * 3.1) * 24;
      const y = h * 0.55 + Math.cos(this._time * 0.33 + i * 2.3) * h * 0.12;
      const a = 0.25 + 0.35 * (Math.sin(this._time * 1.6 + i) * 0.5 + 0.5);
      ctx.fillStyle = `rgba(255,224,138,${a * night})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, TAU);
      ctx.fill();
    }
  }

  _drawScreenGrade(sim, { golden, night, rain, snow, fog }) {
    const ctx = this.ctx;
    const w = this._w;
    const h = this._h;
    if (golden > 0.02) {
      ctx.fillStyle = `rgba(255,168,84,${0.035 * golden})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (night > 0.02) {
      ctx.fillStyle = `rgba(24,44,88,${0.10 * night})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (rain + snow + fog > 0.02) {
      ctx.fillStyle = `rgba(176,190,196,${0.03 * (rain + snow + fog)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (!this._vignette) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.48, h * 0.32, w * 0.5, h * 0.5, h * 0.9);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.14)');
      g.addColorStop(1, 'rgba(0,0,0,0.42)');
      this._vignette = g;
    }
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Called by main when a hit lands so the fallback can flash the lens without
   * inspecting the Three scene. Purely presentational.
   */
  flashImpact() {
    this._impactFlash = 1;
  }
}
