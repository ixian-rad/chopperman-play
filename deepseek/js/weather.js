import * as THREE from 'three';
import { clamp, damp, mulberry32 } from './utils.js';

const TAU = Math.PI * 2;

const TIME_PRESETS = Object.freeze({
  dawn: 0.015,
  noon: 0.25,
  golden: 0.49,
  night: 0.76,
});

const WEATHER_MODIFIERS = Object.freeze({
  clear: Object.freeze({
    label: 'Clear',
    friction: 1,
    split: 1,
    splinter: 0,
    stamina: 1,
    regen: 1,
    sway: 0,
    wetness: 0,
    frozen: false,
    wind: 0.18,
    chipDrag: 0,
  }),
  rain: Object.freeze({
    label: 'Rain',
    friction: 0.62,
    split: 1.12,
    splinter: 0.18,
    stamina: 1.1,
    regen: 0.86,
    sway: 0.01,
    wetness: 1,
    frozen: false,
    wind: 0.42,
    chipDrag: 0.16,
  }),
  snow: Object.freeze({
    label: 'Snow',
    friction: 0.78,
    split: 1.24,
    splinter: 0.62,
    stamina: 1.16,
    regen: 0.8,
    sway: 0.013,
    wetness: 0.45,
    frozen: true,
    wind: 0.32,
    chipDrag: 0.35,
  }),
  fog: Object.freeze({
    label: 'Fog',
    friction: 0.96,
    split: 1.03,
    splinter: 0.05,
    stamina: 1.04,
    regen: 0.9,
    sway: 0.034,
    wetness: 0.35,
    frozen: false,
    wind: 0.08,
    chipDrag: 0.05,
  }),
  wind: Object.freeze({
    label: 'Wind',
    friction: 0.94,
    split: 0.97,
    splinter: 0.12,
    stamina: 1.08,
    regen: 0.95,
    sway: 0.038,
    wetness: 0.1,
    frozen: false,
    wind: 1,
    chipDrag: 0.1,
  }),
});

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeSkyTexture(size, painter) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  painter(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRainTexture() {
  return makeSkyTexture(64, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(210,232,245,0)');
    g.addColorStop(0.35, 'rgba(210,232,245,0.55)');
    g.addColorStop(0.8, 'rgba(235,247,255,0.9)');
    g.addColorStop(1, 'rgba(235,247,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, 0);
    ctx.lineTo(s * 0.5, s);
    ctx.stroke();
  });
}

function makeSnowTexture() {
  return makeSkyTexture(64, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(245,251,255,0.72)');
    g.addColorStop(1, 'rgba(225,240,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function makeFlakeTexture() {
  return makeSkyTexture(64, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.5);
    g.addColorStop(0, 'rgba(255,255,232,1)');
    g.addColorStop(0.4, 'rgba(255,244,168,0.75)');
    g.addColorStop(1, 'rgba(255,225,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function makeShaftTexture() {
  return makeSkyTexture(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, s, 0, 0);
    g.addColorStop(0, 'rgba(255,208,140,0)');
    g.addColorStop(0.45, 'rgba(255,214,150,0.15)');
    g.addColorStop(0.82, 'rgba(255,232,188,0.2)');
    g.addColorStop(1, 'rgba(255,246,222,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const side = ctx.createLinearGradient(0, 0, s, 0);
    side.addColorStop(0, 'rgba(0,0,0,0)');
    side.addColorStop(0.5, 'rgba(255,240,210,0.45)');
    side.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, s, s);
  });
}

function makePointCloud(count, bounds, random, material) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (random() - 0.5) * bounds.x;
    positions[i * 3 + 1] = random() * bounds.y;
    positions[i * 3 + 2] = (random() - 0.5) * bounds.z - 0.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return points;
}

export class WeatherSystem {
  constructor({ scene, renderer, env, camera, qualityPreset = null }) {
    this.scene = scene;
    this.renderer = renderer;
    this.env = env;
    this.camera = camera;
    this.quality = qualityPreset || {
      rainParticles: 700,
      snowParticles: 520,
      motes: 60,
      chimneySmoke: 20,
    };
    this.weather = 'clear';
    this.timePreset = 'golden';
    this.phase = TIME_PRESETS.golden;
    this.autoTime = false;
    this.weatherIntensity = { clear: 1, rain: 0, snow: 0, fog: 0, wind: 0 };
    this.exposure = 1.08;
    this.random = (() => {
      let a = 0x9e3779b9;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    this._tmpColor = new THREE.Color();
    this._tmpColor2 = new THREE.Color();
    this._sunDir = new THREE.Vector3();
    this._simpleSunColor = new THREE.Color(0xffe2b8);
    this._simpleSunStrength = 0.55;
    this._wind = new THREE.Vector2();
    this._ambientTint = new THREE.Color(0xffffff);
    this._applyKey = '';
    this._buildParticles();
    this._buildSkyExtras();
    if (env?.setWind) env.setWind(this.getWindStrength());
    this.applyTime(this.phase, true);
  }

  _buildParticles() {
    this.snowTex = makeSnowTexture();
    this.flakeTex = makeFlakeTexture();

    // Rain is drawn as a single LineSegments batch: crisp, cheap, and much more
    // legible than textured point sprites on a software rasteriser.
    // Allocate the maximum preset count once; setQuality only changes the draw
    // range, so switching low -> high does not leave the storm half-populated.
    const rainCount = 2100;
    const rainPositions = new Float32Array(rainCount * 6);
    for (let i = 0; i < rainCount; i++) {
      const x = (this.random() - 0.5) * 22;
      const y = this.random() * 14;
      const z = (this.random() - 0.5) * 20 - 1;
      rainPositions[i * 6] = x;
      rainPositions[i * 6 + 1] = y;
      rainPositions[i * 6 + 2] = z;
      rainPositions[i * 6 + 3] = x + 0.06;
      rainPositions[i * 6 + 4] = y - 0.48;
      rainPositions[i * 6 + 5] = z;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    const rainMat = new THREE.LineBasicMaterial({
      color: 0x9fc4dd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    this.rain = new THREE.LineSegments(rainGeo, rainMat);
    this.rain.frustumCulled = false;
    this.rain.geometry.setDrawRange(0, 0);
    this.rain.visible = false;
    this.rain.userData.maxCount = rainCount;
    this.scene.add(this.rain);

    const snowMat = new THREE.PointsMaterial({
      map: this.snowTex,
      size: 0.18,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      color: 0xc6e0fb,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
      fog: true,
    });
    this.snow = makePointCloud(
      1900,
      new THREE.Vector3(18, 13, 16),
      this.random,
      snowMat,
    );
    this.snow.geometry.setDrawRange(0, 0);
    this.snow.visible = false;
    this.scene.add(this.snow);
    this.snowPhase = new Float32Array(1900);

    // Warm fireflies for clear nights.
    this.fireflyMat = new THREE.PointsMaterial({
      map: this.flakeTex,
      size: 0.075,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      color: 0xffe08a,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.fireflies = makePointCloud(
      70,
      new THREE.Vector3(14, 2.8, 12),
      this.random,
      this.fireflyMat,
    );
    this.fireflies.position.set(0, 0.25, -0.6);
    this.fireflies.visible = false;
    this.scene.add(this.fireflies);
    this.fireflyBase = this.fireflies.geometry.attributes.position.array.slice();

    // A soft additive glow around the sun disc. Bloom does the rest.
    this.sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.flakeTex,
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.sunGlow.scale.set(24, 24, 1);
    this.scene.add(this.sunGlow);

    // Rain hits the ground: one cheap point batch, only drawn while raining.
    const splashCount = 72;
    const splashPositions = new Float32Array(splashCount * 3);
    this.splashPhase = new Float32Array(splashCount);
    const splashRandom = mulberry32(0x51a5);
    for (let i = 0; i < splashCount; i++) {
      splashPositions[i * 3] = (splashRandom() - 0.5) * 7;
      splashPositions[i * 3 + 1] = 0.03;
      splashPositions[i * 3 + 2] = (splashRandom() - 0.5) * 5.5 - 0.8;
      this.splashPhase[i] = splashRandom();
    }
    const splashGeo = new THREE.BufferGeometry();
    splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
    this.splashes = new THREE.Points(
      splashGeo,
      new THREE.PointsMaterial({
        map: this.flakeTex,
        color: 0xbcd6e6,
        size: 0.12,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
        sizeAttenuation: true,
        fog: true,
      }),
    );
    this.splashes.frustumCulled = false;
    this.splashes.visible = false;
    this.scene.add(this.splashes);
  }

  _buildSkyExtras() {
    // Stars on a large hemisphere, visible at night.
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = this.random() * TAU;
      const y = 0.12 + this.random() * 0.86;
      const r = Math.sqrt(1 - y * y);
      positions[i * 3] = Math.cos(a) * r * 70;
      positions[i * 3 + 1] = y * 70;
      positions[i * 3 + 2] = Math.sin(a) * r * 70;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xcfd8ff,
        size: 0.9,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        sizeAttenuation: true,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -90;
    this.scene.add(this.stars);

    // A soft moon disc opposite the sun. One sprite, only visible at night.
    this.moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.flakeTex,
        color: 0xdde7ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    );
    this.moonSprite.scale.set(7, 7, 1);
    this.moonSprite.renderOrder = -90;
    this.scene.add(this.moonSprite);

    // Low-poly god-ray cards behind the tree line.
    this.shafts = new THREE.Group();
    const tex = makeShaftTexture();
    this.shaftMaterial = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    for (let i = 0; i < 4; i++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(7 + i * 2.2, 15 + i * 2.5), this.shaftMaterial.clone());
      plane.position.set(-11 + i * 6.8, 7.2 + i * 0.4, -15 - i * 1.2);
      plane.rotation.set(0.08, -0.22 + i * 0.09, -0.13);
      plane.renderOrder = -80;
      this.shafts.add(plane);
    }
    this.scene.add(this.shafts);
  }

  setQuality(preset) {
    if (!preset) return;
    this.quality = preset;
    const rainCount = Math.min(preset.rainParticles, this.rain.geometry.attributes.position.count / 2);
    const snowCount = Math.min(preset.snowParticles, this.snow.geometry.attributes.position.count);
    this.rain.userData.maxCount = rainCount;
    this.snow.userData.maxCount = snowCount;
    this.snow.material.size = preset.snowSize ?? 0.17;
    if (this.rain.visible) this.rain.geometry.setDrawRange(0, rainCount * 2);
    if (this.snow.visible) this.snow.geometry.setDrawRange(0, snowCount);
    // Visibility is driven by applyTime (day/night); do not force it on here.
  }

  setWeather(name) {
    if (!WEATHER_MODIFIERS[name]) return this.weather;
    this.weather = name;
    return this.weather;
  }

  setTimePreset(name) {
    if (!(name in TIME_PRESETS)) return this.timePreset;
    this.timePreset = name;
    this.phase = TIME_PRESETS[name];
    this._applyKey = '';
    this.applyTime(this.phase, true);
    return this.timePreset;
  }

  setPhase(phase) {
    this.phase = ((Number(phase) || 0) % 1 + 1) % 1;
    this.timePreset = this.labelForPhase(this.phase);
    this._applyKey = '';
    this.applyTime(this.phase, false);
    return this.phase;
  }

  setAutoTime(enabled) {
    this.autoTime = Boolean(enabled);
    return this.autoTime;
  }

  labelForPhase(phase) {
    if (phase < 0.09 || phase > 0.95) return 'dawn';
    if (phase < 0.36) return 'noon';
    if (phase < 0.62) return 'golden';
    return 'night';
  }

  get isNight() {
    return Math.sin(this.phase * TAU) < -0.05;
  }

  get timeLabel() {
    return this.labelForPhase(this.phase);
  }

  get weatherLabel() {
    return WEATHER_MODIFIERS[this.weather]?.label || 'Clear';
  }

  get dayFactor() {
    return smoothstep(-0.12, 0.22, Math.sin(this.phase * TAU));
  }

  get goldenFactor() {
    const elev = Math.sin(this.phase * TAU);
    return clamp(1 - Math.abs(elev - 0.06) / 0.26, 0, 1) * smoothstep(-0.18, 0.0, elev);
  }

  get nightFactor() {
    return smoothstep(0.06, -0.22, Math.sin(this.phase * TAU));
  }

  getWindStrength() {
    const base = WEATHER_MODIFIERS[this.weather]?.wind ?? 0.18;
    return base * (0.6 + 0.4 * this.weatherIntensity[this.weather]);
  }

  /** World direction toward the sun (used by the screen-space god-ray pass). */
  getSunDirection() {
    return this._sunDir;
  }

  /** 0..1 strength for the crepuscular-ray pass: strongest at golden hour. */
  getSunShaftStrength() {
    const rain = this.weatherIntensity.rain;
    const snow = this.weatherIntensity.snow;
    const fog = this.weatherIntensity.fog;
    return clamp(
      (this.goldenFactor * 1.05 + this.dayFactor * 0.14) *
        (1 - this.nightFactor * 0.85) *
        (1 - rain * 0.7) *
        (1 - snow * 0.55) *
        (1 - fog * 0.8),
      0,
      1,
    );
  }

  getModifiers() {
    const base = WEATHER_MODIFIERS[this.weather] || WEATHER_MODIFIERS.clear;
    return { ...base, weather: this.weather };
  }

  getAimSway(time) {
    const mods = this.getModifiers();
    const wind = this.getWindStrength();
    const amount = mods.sway + wind * 0.012;
    return {
      x: Math.sin(time * 1.7 + 0.4) * amount * 0.7 + Math.sin(time * 3.3) * amount * 0.3,
      z: Math.cos(time * 1.31) * amount,
      amount,
    };
  }

  getWindVector() {
    const strength = this.getWindStrength();
    return {
      x: (0.55 + Math.sin(this.phase * 4.7) * 0.2) * strength * 2.2,
      z: (0.28 + Math.cos(this.phase * 3.1) * 0.16) * strength * 1.8,
    };
  }

  applyTime(phase, immediate = false) {
    this.phase = phase;
    const env = this.env;
    if (!env) return;
    const elev = Math.sin(phase * TAU);
    const day = this.dayFactor;
    const golden = this.goldenFactor;
    const night = this.nightFactor;
    const weather = this.weather;
    const rain = this.weatherIntensity.rain;
    const snow = this.weatherIntensity.snow;
    const fog = this.weatherIntensity.fog;
    const wind = this.weatherIntensity.wind;
    const stormDim = clamp(rain * 0.45 + snow * 0.28, 0, 0.6);

    // Put the low golden-hour sun in the default camera's view so the sky glow,
    // world shafts and screen-space god rays read as a direction, not just a tint.
    const az = phase * TAU + 1.05;
    const alt = Math.asin(clamp(elev, -0.95, 0.95));
    this._sunDir.set(
      Math.cos(az) * Math.cos(alt),
      Math.sin(alt),
      Math.sin(az) * Math.cos(alt),
    ).normalize();

    const top = new THREE.Color(0x557fa5);
    const horizon = new THREE.Color(0xf0d5b1);
    this._tmpColor.set(0x0a1424);
    top.lerp(this._tmpColor, night);
    horizon.lerp(new THREE.Color(0x182030), night);
    this._tmpColor2.set(0xffb56e);
    top.lerp(new THREE.Color(0x476b8a), golden * 0.25);
    horizon.lerp(this._tmpColor2, golden * 0.7);
    if (fog > 0.01) {
      const fogCol = new THREE.Color(0xb8c0b8);
      top.lerp(fogCol, fog * (0.18 + day * 0.25));
      horizon.lerp(fogCol, fog * 0.6);
    }
    if (rain > 0.01) {
      top.lerp(new THREE.Color(0x3d4a55), rain * 0.65);
      horizon.lerp(new THREE.Color(0x78838a), rain * 0.6);
    }
    if (snow > 0.01) {
      top.lerp(new THREE.Color(0x91a1b3), snow * 0.55);
      horizon.lerp(new THREE.Color(0xdce5ee), snow * 0.6);
    }

    const sky = env.sky?.uniforms;
    if (sky) {
      sky.uTop.value.copy(top);
      sky.uHorizon.value.copy(horizon);
      sky.uSunDir.value.copy(this._sunDir);
      sky.uSunColor.value.set(0xffd7a0).lerp(new THREE.Color(0xff8a4c), golden * 0.8);
    }

    const sunColor = new THREE.Color(0xfff0d1);
    sunColor.lerp(new THREE.Color(0xff9a55), golden * 0.85);
    if (night > 0.55) sunColor.lerp(new THREE.Color(0x8fa8d8), 1);
    const sunIntensity = Math.max(0, (2.78 + golden * 0.35) * day * (1 - stormDim * 0.55));

    // The Low preset swaps most Standard materials for unlit Basic clones to
    // save raster cost. Give those clones a cheap directional term so the yard
    // still has sun/shade form; the strength fades out at night.
    this._simpleSunColor.copy(sunColor);
    this._simpleSunStrength = clamp(
      (0.16 + day * 0.5 + golden * 0.12) * (1 - stormDim * 0.45),
      0,
      0.82,
    );

    if (env.sun) {
      env.sun.color.copy(sunColor);
      env.sun.intensity = sunIntensity;
      env.sun.position.copy(this._sunDir).multiplyScalar(18);
      env.sun.position.y = Math.max(0.6, env.sun.position.y);
      env.sun.visible = sunIntensity > 0.02;
      env.sun.castShadow = sunIntensity > 0.04 && qualityShadowEnabled(this.quality);
      if (env.sun.shadow) {
        env.sun.shadow.bias = -0.00018;
      }
    }
    if (env.moon) {
      env.moon.intensity = night * 0.55 * (1 - stormDim * 0.6);
      env.moon.position.set(-this._sunDir.x * 12, 9, -this._sunDir.z * 12);
      env.moon.color.set(0x9fb6e0);
    }
    if (env.hemi) {
      const hemiSky = new THREE.Color(0xc7dded).lerp(new THREE.Color(0x25344c), night);
      hemiSky.lerp(new THREE.Color(0x9a9d96), fog * 0.35);
      const hemiGround = new THREE.Color(0x3f4b2e).lerp(new THREE.Color(0x141a20), night * 0.7);
      env.hemi.color.copy(hemiSky);
      env.hemi.groundColor.copy(hemiGround);
      env.hemi.intensity = (0.4 + day * 1.05) * (1 - stormDim * 0.4) + night * 0.08;
    }
    if (env.rim) {
      env.rim.intensity = 0.18 + day * 0.28 + golden * 0.25;
      env.rim.color.set(0xa9c6db).lerp(new THREE.Color(0xffb078), golden * 0.4);
    }
    if (env.warmFill) {
      env.warmFill.intensity = day * 0.35 + night * 0.9;
      env.warmFill.visible = true;
    }

    const bg = new THREE.Color(0xaebfae).lerp(top, 0.55);
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(bg);
    }
    if (this.scene.fog) {
      const fogColor = new THREE.Color(0xbcc4ad);
      fogColor.lerp(new THREE.Color(0xd6b28c), golden * 0.5);
      fogColor.lerp(new THREE.Color(0x0d1420), night * 0.82);
      fogColor.lerp(new THREE.Color(0x9aa6ab), rain * 0.4);
      fogColor.lerp(new THREE.Color(0xd9e2ea), snow * 0.35);
      this.scene.fog.color.copy(fogColor);
      let near = 15;
      let far = this.quality.fogFar || 46;
      if (night > 0.3) {
        near = 8;
        far = Math.min(far, 34);
      }
      if (fog > 0.01) {
        near = 3.5 + (1 - fog) * 8;
        far = 10 + (1 - fog) * 28;
      }
      if (rain > 0.3) {
        near = 8;
        far = Math.min(far, 32);
      }
      if (snow > 0.3) {
        near = 7;
        far = Math.min(far, 30);
      }
      this.scene.fog.near = near;
      this.scene.fog.far = far;
    }

    this.sunGlow.position.copy(this._sunDir).multiplyScalar(60);
    // A wide, soft aureole rather than a tiny disc: at golden hour the low sun
    // sits behind the tree line/roof, so the halo bleeding through the gaps is
    // what makes the light direction readable from the default camera.
    this.sunGlow.material.opacity =
      (0.1 + golden * 0.4 + day * 0.06) * (1 - night) * (1 - stormDim * 0.9);
    this.sunGlow.visible = this.sunGlow.material.opacity > 0.01;
    this.sunGlow.material.color.copy(sunColor);

    this.stars.material.opacity = night * (1 - rain * 0.8) * (1 - snow * 0.7) * (1 - fog * 0.9);
    this.stars.visible = this.stars.material.opacity > 0.01;
    if (this.moonSprite) {
      const moonOpacity = night * (1 - rain * 0.85) * (1 - snow * 0.6) * (1 - fog * 0.9);
      this.moonSprite.material.opacity = moonOpacity * 0.9;
      this.moonSprite.visible = moonOpacity > 0.01;
      const mx = -this._sunDir.x;
      const my = Math.max(0.12, -this._sunDir.y);
      const mz = -this._sunDir.z;
      this.moonSprite.position.set(mx * 70, my * 70, mz * 70);
    }
    this.fireflies.visible = night > 0.55 && rain < 0.3 && snow < 0.5;
    this.fireflyMat.opacity = night * 0.8 * (1 - rain);
    // The world-space shaft cards are four large additive quads. Keep them for
    // Medium+; Low's budget goes to the sky glow and contact shadows instead.
    this.shafts.visible =
      (this.quality?.envDetail ?? 1) >= 0.7 &&
      golden > 0.04 && rain < 0.4 && snow < 0.5;
    for (const shaft of this.shafts.children) {
      shaft.material.opacity = golden * 0.17 * (1 - stormDim * 0.7);
    }

    if (env.lanterns) {
      const lanternOn = night * 0.95 + (1 - day) * 0.18 + golden * 0.2;
      for (const lantern of env.lanterns) {
        if (lantern.light) lantern.light.intensity = lanternOn * (lantern.intensity || 2.4);
        if (lantern.glow) lantern.glow.material.opacity = lanternOn * 0.82;
        if (lantern.pool) lantern.pool.material.opacity = lanternOn * 0.34;
        if (lantern.bulb) {
          lantern.bulb.material.emissiveIntensity = 0.3 + lanternOn * 2.2;
        }
      }
    }
    if (env.windowMaterials) {
      for (const mat of env.windowMaterials) {
        mat.emissiveIntensity = 0.15 + night * 1.6 + golden * 0.3;
        if (!mat.userData.baseEmissive) mat.userData.baseEmissive = mat.emissive.getHex();
      }
    }
    if (env.puddles) {
      for (const puddle of env.puddles) {
        puddle.visible = rain > 0.08;
        puddle.material.opacity = 0.18 + rain * 0.42;
        puddle.material.roughness = 0.08 + (1 - rain) * 0.4;
      }
    }
    // Cache the storm intensities on the environment so a live quality switch
    // can re-apply opacity to freshly swapped (lit vs unlit) materials.
    env.setStormIntensity?.(snow, rain, fog);
    if (env.snowOverlay) {
      env.snowOverlay.visible = snow > 0.03;
      env.snowOverlay.material.opacity = snow * 0.82;
    }
    if (env.snowCaps) {
      env.snowCaps.visible = snow > 0.03;
      env.snowCaps.material.opacity = snow * 0.94;
    }
    if (env.setWind) env.setWind(this.getWindStrength());
    if (env.setWetness) env.setWetness(Math.max(rain, snow * 0.55, fog * 0.3, wind * 0.1));

    // Cheap ambient tint for the low-quality unlit materials. It follows the
    // sun, golden hour, night, and weather without another full PBR pass.
    const ambient = this._ambientTint.set(0xffffff);
    ambient.lerp(new THREE.Color(0xffcf95), golden * 0.85);
    ambient.lerp(new THREE.Color(0x687ea8), night * 0.9);
    ambient.lerp(new THREE.Color(0xaebcc8), rain * 0.35);
    ambient.lerp(new THREE.Color(0xe7f0ff), snow * 0.35);
    const ambientStrength = 0.42 + day * 0.6 - rain * 0.08 + snow * 0.08 + golden * 0.03 + night * 0.22;
    env.setAmbientLight?.(ambient, ambientStrength);
    env.onAmbient?.(ambient, ambientStrength);
    env.setSimpleSun?.(this._sunDir, this.camera, this._simpleSunColor, this._simpleSunStrength);

    if (this.renderer) {
      this.renderer.toneMappingExposure =
        1.06 + golden * 0.13 - night * 0.34 - rain * 0.08;
    }
  }

  update(dt, elapsed) {
    const targets = {
      clear: this.weather === 'clear' ? 1 : 0,
      rain: this.weather === 'rain' ? 1 : 0,
      snow: this.weather === 'snow' ? 1 : 0,
      fog: this.weather === 'fog' ? 1 : 0,
      wind: this.weather === 'wind' ? 1 : 0,
    };
    for (const key of Object.keys(targets)) {
      this.weatherIntensity[key] = damp(this.weatherIntensity[key], targets[key], 3.2, dt);
    }
    if (this.autoTime) {
      this.phase = (this.phase + dt / 210) % 1;
      this.timePreset = this.labelForPhase(this.phase);
    }
    // applyTime allocates a handful of colours and touches every light. The
    // lighting only changes while the clock moves or a weather transition is
    // still damping, so skip the whole pass once the state is stable.
    const applyKey = `${this.phase.toFixed(4)}:${this.weatherIntensity.rain.toFixed(3)}:${this.weatherIntensity.snow.toFixed(3)}:${this.weatherIntensity.fog.toFixed(3)}:${this.weatherIntensity.wind.toFixed(3)}`;
    if (applyKey !== this._applyKey) {
      this._applyKey = applyKey;
      this.applyTime(this.phase, false);
    }
    // Camera orbit changes the view-space sun direction even when the clock
    // and weather are stable, so refresh the Low shading term every frame.
    this.env?.setSimpleSun?.(this._sunDir, this.camera, this._simpleSunColor, this._simpleSunStrength);

    const rainI = this.weatherIntensity.rain;
    const snowI = this.weatherIntensity.snow;

    // Rain particles.
    this.rain.visible = rainI > 0.015;
    if (this.rain.visible) {
      const max = Math.min(
        this.rain.userData.maxCount || this.quality.rainParticles,
        this.rain.geometry.attributes.position.count / 2,
      );
      this.rain.geometry.setDrawRange(0, max * 2);
      this.rain.material.opacity = rainI * 0.8;
      const pos = this.rain.geometry.attributes.position;
      const cx = clamp(this.camera.position.x, -4, 4);
      const cz = clamp(this.camera.position.z, -5, 6);
      const wind = this.getWindVector();
      for (let i = 0; i < max; i++) {
        const index = i * 2;
        let x = pos.getX(index) + wind.x * dt * 0.16;
        let y = pos.getY(index) - dt * (8.5 + (i % 7) * 0.35);
        let z = pos.getZ(index) + wind.z * dt * 0.16;
        if (y < -0.2) {
          y = 12 + this.random() * 4;
          x = cx + (this.random() - 0.5) * 22;
          z = cz + (this.random() - 0.5) * 20 - 1.2;
        }
        pos.setXYZ(index, x, y, z);
        pos.setXYZ(index + 1, x + 0.08 + wind.x * 0.04, y - 0.52, z + wind.z * 0.04);
      }
      pos.needsUpdate = true;
    }

    // Rain splashes: 72 sprites bouncing just above the ground around the
    // block. One points batch, no per-particle material, only alive in rain.
    this.splashes.visible = rainI > 0.05;
    if (this.splashes.visible) {
      this.splashes.material.opacity = rainI * 0.55;
      const pos = this.splashes.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const phase = (elapsed * 1.9 + this.splashPhase[i] * 7.3) % 1;
        pos.setY(i, 0.025 + Math.sin(phase * Math.PI) * 0.075);
      }
      pos.needsUpdate = true;
    }

    // Snow particles.
    this.snow.visible = snowI > 0.015;
    if (this.snow.visible) {
      const max = this.snow.userData.maxCount || this.quality.snowParticles;
      this.snow.geometry.setDrawRange(0, max);
      this.snow.material.opacity = snowI * 0.95;
      const pos = this.snow.geometry.attributes.position;
      const windForce = this.getWindVector();
      const cx = clamp(this.camera.position.x, -4, 4);
      const cz = clamp(this.camera.position.z, -5, 6);
      for (let i = 0; i < max; i++) {
        let y = pos.getY(i) - dt * (0.55 + (i % 9) * 0.09);
        let x = pos.getX(i) + Math.sin(elapsed * 1.2 + i) * dt * 0.12 + windForce.x * dt * 0.32;
        let z = pos.getZ(i) + Math.cos(elapsed * 0.9 + i * 1.7) * dt * 0.08 + windForce.z * dt * 0.32;
        if (y < 0.02) {
          y = 10 + this.random() * 4;
          x = cx + (this.random() - 0.5) * 22;
          z = cz + (this.random() - 0.5) * 20 - 1.2;
        }
        pos.setX(i, x);
        pos.setY(i, y);
        pos.setZ(i, z);
      }
      pos.needsUpdate = true;
    }

    // Fireflies drift.
    if (this.fireflies.visible) {
      const pos = this.fireflies.geometry.attributes.position;
      const base = this.fireflyBase;
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, base[i * 3] + Math.sin(elapsed * 0.48 + i) * 0.55);
        pos.setY(i, base[i * 3 + 1] + Math.sin(elapsed * 0.73 + i * 2.1) * 0.28);
        pos.setZ(i, base[i * 3 + 2] + Math.cos(elapsed * 0.39 + i * 1.4) * 0.5);
      }
      pos.needsUpdate = true;
    }

    if (this.stars.visible) {
      this.stars.rotation.y = elapsed * 0.003;
    }
  }

  snapshot() {
    return {
      weather: this.weather,
      weatherLabel: this.weatherLabel,
      timeOfDay: this.timeLabel,
      timePhase: Number(this.phase.toFixed(4)),
      autoTime: this.autoTime,
      isNight: this.isNight,
      wind: Number(this.getWindStrength().toFixed(2)),
      modifiers: { ...this.getModifiers() },
    };
  }
}

function qualityShadowEnabled(preset) {
  return Boolean(preset?.shadows) && (preset?.shadowSize || 0) > 0;
}
