/**
 * Quality presets + runtime auto-downgrade.
 *
 * The operator tests with SwiftShader, where fill rate and shadow passes are
 * the bottleneck. The renderer therefore starts at "low" when a software
 * rasteriser is detected, and drops another tier automatically if measured FPS
 * stays under the playable threshold.
 */

export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    name: 'Low',
    pixelRatio: 1,
    // Software rasterisers are fill-rate bound. Measured on SwiftShader at
    // 1280x800, 0.36 DPR held ~25 FPS and 0.46 DPR ~17 FPS, so 0.46 x 0.72
    // starts at a readable 0.33 DPR and the governor can still fall back to
    // 0.19. That is ~2.3x the linear detail of the old 0.14 DPR default.
    maxDpr: 0.46,
    startScale: 0.72,
    minScale: 0.42,
    shadowSize: 512,
    shadows: false,
    simpleMaterials: true,
    simpleGround: true,
    softShadows: false,
    shadowRadius: 2,
    grass: 400,
    weeds: 36,
    motes: 0,
    fogFar: 34,
    bloom: false,
    bloomStrength: 0,
    bloomThreshold: 0.9,
    godrays: false,
    ssao: false,
    rainParticles: 520,
    snowParticles: 620,
    rainSize: 0.5,
    snowSize: 0.25,
    dustScale: 0.45,
    envDetail: 0.55,
    chimneySmoke: 0,
    anisotropy: 2,
    antialias: false,
  }),
  medium: Object.freeze({
    name: 'Medium',
    pixelRatio: 1,
    maxDpr: 0.9,
    shadowSize: 1024,
    shadows: true,
    simpleMaterials: false,
    simpleGround: false,
    softShadows: false,
    shadowRadius: 2,
    grass: 3200,
    weeds: 200,
    motes: 60,
    fogFar: 46,
    bloom: true,
    bloomStrength: 0.26,
    bloomThreshold: 0.9,
    godrays: false,
    ssao: false,
    rainParticles: 1000,
    snowParticles: 950,
    rainSize: 0.44,
    snowSize: 0.2,
    dustScale: 0.7,
    envDetail: 0.8,
    chimneySmoke: 24,
    anisotropy: 4,
    antialias: false,
  }),
  high: Object.freeze({
    name: 'High',
    pixelRatio: 1,
    maxDpr: 1.35,
    shadowSize: 2048,
    shadows: true,
    simpleMaterials: false,
    simpleGround: false,
    softShadows: true,
    shadowRadius: 3,
    grass: 6800,
    weeds: 360,
    motes: 100,
    fogFar: 52,
    bloom: true,
    bloomStrength: 0.34,
    bloomThreshold: 0.82,
    godrays: true,
    ssao: false,
    rainParticles: 1600,
    snowParticles: 1400,
    rainSize: 0.38,
    snowSize: 0.17,
    dustScale: 1,
    envDetail: 1,
    chimneySmoke: 40,
    anisotropy: 8,
    antialias: true,
  }),
  ultra: Object.freeze({
    name: 'Ultra',
    pixelRatio: 1,
    maxDpr: 1.6,
    shadowSize: 2048,
    shadows: true,
    simpleMaterials: false,
    simpleGround: false,
    softShadows: true,
    shadowRadius: 4,
    grass: 10500,
    weeds: 520,
    motes: 110,
    fogFar: 58,
    bloom: true,
    bloomStrength: 0.4,
    bloomThreshold: 0.78,
    godrays: true,
    ssao: true,
    rainParticles: 2100,
    snowParticles: 1900,
    rainSize: 0.34,
    snowSize: 0.15,
    dustScale: 1.25,
    envDetail: 1.25,
    chimneySmoke: 58,
    anisotropy: 8,
    antialias: true,
  }),
});

export function detectRendererClass(renderer) {
  if (renderer?.isFallbackRenderer) {
    return { name: 'No WebGL (compatibility mode)', software: true, webgl: false };
  }
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
      : String(gl.getParameter(gl.RENDERER) || '');
    const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    return { name: name || 'unknown', software, webgl: true };
  } catch {
    return { name: 'unknown', software: false, webgl: true };
  }
}

export function qualityRank(name) {
  return QUALITY_ORDER.indexOf(name);
}

export class QualityManager {
  constructor({ onChange = null, onNotice = null } = {}) {
    this.onChange = onChange;
    this.onNotice = onNotice;
    this.rendererInfo = { name: 'unknown', software: false, webgl: true };
    this.current = 'high';
    this.mode = 'auto';
    this.auto = true;
    this.ceiling = 'high';
    this.lowFpsTime = 0;
    this.goodFpsTime = 0;
    this.holdOff = 2.5;
    this.elapsed = 0;
    this.lastChangeAt = 0;
    this.lastFps = 60;
    this.downgrades = 0;
  }

  detect(renderer) {
    this.rendererInfo = detectRendererClass(renderer);
    const cores = navigator.hardwareConcurrency || 8;
    if (this.rendererInfo.software || cores <= 4) {
      this.ceiling = 'low';
    } else if (cores <= 8) {
      this.ceiling = 'medium';
    } else {
      this.ceiling = 'high';
    }
    return this.rendererInfo;
  }

  start(savedMode = 'auto') {
    this.mode = savedMode || 'auto';
    this.auto = this.mode === 'auto';
    let initial;
    if (this.auto) {
      initial = this.ceiling;
    } else if (QUALITY_PRESETS[this.mode]) {
      initial = this.mode;
    } else {
      initial = this.ceiling;
      this.mode = 'auto';
      this.auto = true;
    }
    this.current = initial;
    this.apply(initial, 'startup');
    return initial;
  }

  get preset() {
    return QUALITY_PRESETS[this.current] || QUALITY_PRESETS.low;
  }

  setMode(mode) {
    if (mode === 'auto') {
      this.mode = 'auto';
      this.auto = true;
      // Re-evaluate from the detected ceiling, but never bump above it
      // immediately; the FPS governor may still upgrade later.
      this.setQuality(this.ceiling, 'auto');
      return this.current;
    }
    if (!QUALITY_PRESETS[mode]) return this.current;
    this.mode = mode;
    this.auto = false;
    this.setQuality(mode, 'manual');
    return this.current;
  }

  setQuality(name, reason = 'manual') {
    if (!QUALITY_PRESETS[name] || name === this.current) return this.current;
    const previous = this.current;
    this.current = name;
    this.lastChangeAt = this.elapsed;
    this.apply(name, reason, previous);
    return name;
  }

  apply(name, reason, previous = null) {
    if (!this.onChange) return;
    try {
      this.onChange({ name, preset: QUALITY_PRESETS[name], reason, previous });
    } catch (error) {
      console.error('Quality change failed', error);
    }
  }

  update(dt, fps) {
    this.elapsed += dt;
    this.lastFps = fps;
    if (!this.auto || this.elapsed < this.holdOff || this.elapsed - this.lastChangeAt < 2.2) {
      return;
    }

    const rank = qualityRank(this.current);
    if (fps > 0 && fps < 24 && rank > 0) {
      this.lowFpsTime += dt;
      this.goodFpsTime = 0;
    } else if (fps >= 40) {
      this.goodFpsTime += dt;
      this.lowFpsTime = 0;
    } else {
      this.lowFpsTime = Math.max(0, this.lowFpsTime - dt * 0.4);
      this.goodFpsTime = Math.max(0, this.goodFpsTime - dt * 0.4);
    }

    if (this.lowFpsTime > 2.4) {
      const next = QUALITY_ORDER[Math.max(0, rank - 1)];
      this.lowFpsTime = 0;
      this.downgrades += 1;
      if (next !== this.current) {
        this.setQuality(next, 'auto-low-fps');
        this.onNotice?.({
          kind: 'quality',
          message: `Low FPS detected — quality lowered to ${QUALITY_PRESETS[next].name}.`,
        });
      }
      return;
    }

    // Cautious recovery: only on a long, comfortably fast streak, and never
    // above the hardware ceiling detected at startup.
    if (this.goodFpsTime > 14 && rank < qualityRank(this.ceiling) && rank < QUALITY_ORDER.length - 1) {
      const next = QUALITY_ORDER[rank + 1];
      this.goodFpsTime = 0;
      this.setQuality(next, 'auto-high-fps');
      this.onNotice?.({
        kind: 'quality',
        message: `Performance recovered — quality raised to ${QUALITY_PRESETS[next].name}.`,
      });
    }
  }

  describe() {
    const p = this.preset;
    const label = this.auto ? `Auto · ${p.name}` : p.name;
    return `${label} — ${p.shadows ? `${p.shadowSize}² shadows` : 'baked shadows'}, ${p.grass.toLocaleString()} grass, ${p.maxDpr}× max DPR${p.bloom ? ', bloom' : ''}${p.godrays ? ', god rays' : ''}${p.ssao ? ', SSAO' : ''}`;
  }
}
