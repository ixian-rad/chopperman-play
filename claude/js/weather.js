// Dynamic time of day + weather. Drives the sun/moon light, sky, clouds, fog, stars, lanterns,
// precipitation particles, puddles and the global wet/snow/frost shading, and exposes the physical
// conditions (wetness, frozen wood, icy bark, wind, footing) that the gameplay and physics use.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { WEATHER, WEATHER_ORDER } from './data.js';
import { WX } from './matpatch.js';
import { clamp, lerp, smoothstep, Rng } from './rng.js';
import { puddleTexture } from './textures.js';

const DEG = Math.PI / 180;
const tmpC = new THREE.Color();
const tmpC2 = new THREE.Color();

// Smooth 1-D noise from a few incommensurate sines (for gusts).
const gustNoise = (t) => 0.5 * Math.sin(t * 0.37) + 0.3 * Math.sin(t * 0.91 + 1.3) + 0.2 * Math.sin(t * 2.3 + 0.4);

const CLOUD_VS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;
const CLOUD_FS = /* glsl */ `
  uniform float uTime, uCover, uOvercast, uFog, uFlash, uDay, uOctaves;
  uniform vec2 uWind;
  uniform vec3 uSunDir, uSunCol, uAmb, uFogCol;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      if (float(i) >= uOctaves) break;
      s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5;
    }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec2 uv = d.xz / (h + 0.12) * 1.4 + uWind * 0.004;
    float n = fbm(uv);
    float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.35, n);
    dens = max(dens, uOvercast * (0.75 + 0.25 * n));
    float thick = smoothstep(0.3, 1.0, dens) * (0.6 + 0.4 * n);
    float sunDot = max(dot(d, uSunDir), 0.0);
    vec3 lit = uAmb * 1.2 + uSunCol * (0.55 + 0.9 * pow(sunDot, 6.0)) * (1.0 - 0.75 * thick);
    vec3 col = mix(lit, uAmb * 0.75, thick * uOvercast * 0.8) + vec3(uFlash) * 0.9;
    float alpha = dens * smoothstep(0.0, 0.12, d.y);
    // Fog / haze dome hides the horizon (and the whole sky in thick fog).
    float haze = uFog * (1.0 - smoothstep(-0.05, 0.6 + uFog * 1.5, d.y));
    col = mix(col, uFogCol, clamp(haze / max(alpha + haze, 1e-3), 0.0, 1.0));
    alpha = clamp(alpha + haze, 0.0, 1.0);
    if (d.y < 0.0) { col = uFogCol; alpha = 1.0; }
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const RAIN_VS = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aEnd;
  uniform float uTime, uSpeed, uLen;
  uniform vec2 uWind, uOff;
  uniform vec3 uCenter;
  varying float vA;
  void main() {
    vec3 box = vec3(26.0, 14.0, 26.0);
    vec3 vel = vec3(uWind.x, -uSpeed, uWind.y);
    vec3 p = aSeed * box + vec3(uOff.x, 0.0, uOff.y);
    p = mod(p - uCenter + box * 0.5, box) + uCenter - box * 0.5;
    p.y = mod(aSeed.y * box.y - uSpeed * uTime, box.y) - 0.5;
    p -= normalize(vel) * uLen * aEnd;
    vA = 1.0 - aEnd * 0.8;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const RAIN_FS = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vA;
  void main() { gl_FragColor = vec4(uColor, uOpacity * vA); }`;

const SNOW_VS = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime, uScale;
  uniform vec2 uOff;
  uniform vec3 uCenter;
  varying float vA;
  void main() {
    vec3 box = vec3(22.0, 12.0, 22.0);
    float fall = 0.7 + aSeed.x * 0.6;
    vec3 p = aSeed * box;
    p.xz += uOff * 0.8 + vec2(sin(uTime * 0.9 + aSeed.z * 30.0), cos(uTime * 0.7 + aSeed.x * 20.0)) * 0.35;
    p.xz = mod(p.xz - uCenter.xz + box.xz * 0.5, box.xz) + uCenter.xz - box.xz * 0.5;
    p.y = mod(aSeed.y * box.y - fall * uTime, box.y) - 0.3;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.012 + 0.012 * aSeed.z) * uScale / max(0.1, -mv.z);
    vA = smoothstep(0.0, 0.5, p.y + 0.3);
  }`;
const SNOW_FS = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.15, d) * uOpacity * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

const FLY_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime, uScale;
  varying float vA;
  void main() {
    vec3 p = vec3(aSeed.x, 0.3 + aSeed.y * 1.4, aSeed.z);
    float t = uTime * 0.3 + aSeed.w * 10.0;
    p += vec3(sin(t * 1.3) * 0.8, sin(t * 2.1) * 0.25, cos(t * 0.9) * 0.8);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float blink = pow(max(0.0, sin(uTime * (0.8 + aSeed.w) + aSeed.w * 40.0)), 8.0);
    gl_PointSize = 0.05 * uScale / max(0.1, -mv.z);
    vA = blink;
  }`;
const FLY_FS = /* glsl */ `
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * 3.0, a);
  }`;

export class WeatherSystem {
  constructor({ scene, renderer, env, camera }) {
    Object.assign(this, { scene, renderer, env, camera });
    this.rng = new Rng(777);
    this.hour = 16.5;
    this.timeFlow = true;
    this.secondsPerHour = 40; // a full day takes 16 minutes
    this.presetId = 'clear';
    this.auto = false;
    this.autoTimer = 0;
    this.time = 0;
    // Blended numeric weather state.
    const w = WEATHER.clear;
    this.cur = { clouds: w.clouds, fog: w.fog, wind: w.wind, temp: w.temp, rain: 0, snow: 0 };
    this.wet = 0; // surface wetness (accumulates in rain)
    this.snowCover = 0;
    this.frozen = 0; // wood frozen through (cold)
    this.frost = 0;
    this.windDir = 0.6;
    this.wind = new THREE.Vector2();
    this.windOffset = new THREE.Vector2();
    this.gust = 0;
    this.flash = 0;
    this.nextLightning = 8;
    this.lightningQueue = [];
    this.onThunder = null;
    this.quality = { precipScale: 1, cloudOctaves: 5, envUpdates: true, ibl: true };

    this.sun = env.sun;
    this.hemi = env.hemi;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3(0.35, 0.75, -0.55).normalize();
    this.lightDir = new THREE.Vector3();

    // Sky (Preetham) + cloud/haze dome + stars + moon.
    this.sky = env.sky;
    this.cloudU = {
      uTime: { value: 0 }, uCover: { value: 0.2 }, uOvercast: { value: 0 }, uFog: { value: 0 }, uFlash: { value: 0 },
      uDay: { value: 1 }, uOctaves: { value: 5 }, uWind: { value: new THREE.Vector2() },
      uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
      uFogCol: { value: new THREE.Color() },
    };
    const domeGeo = new THREE.SphereGeometry(900, 32, 16);
    this.dome = new THREE.Mesh(domeGeo, new THREE.ShaderMaterial({
      uniforms: this.cloudU, vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS,
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    }));
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    const starGeo = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 1400; i++) {
      const u = this.rng.next(), v = this.rng.float(0.04, 1);
      const th = u * Math.PI * 2, y = v;
      const r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(th) * r * 700, y * 700, Math.sin(th) * r * 700);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    this.stars.renderOrder = -2;
    this.stars.frustumCulled = false;
    scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false, transparent: true }));
    this.moon.renderOrder = -2;
    scene.add(this.moon);

    scene.fog = new THREE.FogExp2(0xbfd4e6, 0.004);

    this.buildPrecipitation();
    this.buildPuddles();
    this.buildFireflies();

    // Environment map (re-generated from the sky as the light changes).
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(50);
    this.envScene.add(this.envSky);
    this.envRT = null;
    this.envKey = '';
    this.envTimer = 0;

    this.computeSun();
    this.applyInstant();
  }

  // ------------------------------------------------------------------ construction

  buildPrecipitation() {
    const N = 5000;
    const seeds = new Float32Array(N * 2 * 3), ends = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const s = [this.rng.next(), this.rng.next(), this.rng.next()];
      seeds.set(s, i * 6);
      seeds.set(s, i * 6 + 3);
      ends[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.rainU = {
      uTime: { value: 0 }, uSpeed: { value: 8.5 }, uLen: { value: 0.32 }, uWind: { value: new THREE.Vector2() },
      uCenter: { value: new THREE.Vector3() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0.7, 0.75, 0.82) }, uOff: { value: new THREE.Vector2() },
    };
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.rainU, vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, fog: false,
    }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.rainMax = N;

    const M = 4000;
    const ss = new Float32Array(M * 3);
    for (let i = 0; i < M * 3; i++) ss[i] = this.rng.next();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 3));
    this.snowU = {
      uTime: { value: 0 }, uScale: { value: 400 }, uOff: { value: new THREE.Vector2() }, uCenter: { value: new THREE.Vector3() },
      uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) },
    };
    this.snowPts = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.snowU, vertexShader: SNOW_VS, fragmentShader: SNOW_FS, transparent: true, depthWrite: false, fog: false,
    }));
    this.snowPts.frustumCulled = false;
    this.snowPts.visible = false;
    this.scene.add(this.snowPts);
    this.snowMax = M;
  }

  buildPuddles() {
    const tex = puddleTexture();
    this.puddleMat = new THREE.MeshStandardMaterial({
      color: 0x20262c, roughness: 0.04, metalness: 0.0, alphaMap: tex, transparent: true, opacity: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, envMapIntensity: 1.6,
    });
    this.puddleMat.userData.noWeather = true;
    this.puddles = [];
    const spots = [[0.9, -1.1, 1.3], [-1.4, 0.7, 1.0], [1.6, 1.4, 0.8], [-2.5, -5.8, 1.6], [-0.6, -6.6, 1.1], [3.2, -2.4, 1.4], [-3.8, 2.6, 1.2]];
    for (const [x, z, s] of spots) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.puddleMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = this.rng.float(0, Math.PI);
      m.position.set(x, z < -5.3 && x < 1.2 && x > -5.2 ? 0.104 : 0.012, z);
      m.userData.size = s;
      m.receiveShadow = true;
      m.scale.setScalar(0.001);
      this.scene.add(m);
      this.puddles.push(m);
    }
  }

  buildFireflies() {
    const N = 60;
    const seeds = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const a = this.rng.float(0, Math.PI * 2), r = this.rng.float(3, 9);
      seeds.set([Math.cos(a) * r, this.rng.next(), Math.sin(a) * r + 3, this.rng.next()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.flyU = { uTime: { value: 0 }, uScale: { value: 400 }, uOpacity: { value: 0 } };
    this.fireflies = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.flyU, vertexShader: FLY_VS, fragmentShader: FLY_FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    }));
    this.fireflies.frustumCulled = false;
    this.scene.add(this.fireflies);
  }

  setViewport(height, pixelRatio) {
    this.snowU.uScale.value = height * pixelRatio * 0.5;
    this.flyU.uScale.value = height * pixelRatio * 0.5;
  }

  setQuality(q) {
    this.quality = q;
    this.cloudU.uOctaves.value = q.cloudOctaves;
    this.envKey = '';
  }

  // ------------------------------------------------------------------ controls

  setWeather(id) {
    if (id === 'auto') { this.auto = true; this.autoTimer = 0; return; }
    this.auto = false;
    if (WEATHER[id]) this.presetId = id;
  }

  cycleWeather() {
    const i = WEATHER_ORDER.indexOf(this.presetId);
    this.setWeather(WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length]);
    return this.presetId;
  }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; this.envKey = ''; }

  cycleTime() {
    // Morning → noon → golden hour → dusk → night.
    const stops = [7.5, 12.5, 17.2, 19.3, 22.5];
    const next = stops.find((s) => s > this.hour + 0.05) ?? stops[0];
    this.setHour(next);
    return this.hour;
  }

  get preset() { return WEATHER[this.presetId]; }

  // Physical conditions for gameplay.
  get conditions() {
    const p = this.preset;
    const temp = this.cur.temp;
    const icy = clamp((temp < 0 ? 1 : 0) * Math.max(this.snowCover * 0.8, this.frost, this.wet * 0.7), 0, 1);
    const night = 1 - this.daylight;
    const windSpeed = this.wind.length();
    const bonus = p.bonus + (night > 0.6 ? 0.1 : 0);
    const bonusLabel = [p.bonus > 0 ? p.name : null, night > 0.6 ? 'Night' : null].filter(Boolean).join(' + ');
    return {
      id: this.presetId, name: p.name, icon: p.icon, temp,
      wet: temp > 0 ? this.wet : this.wet * 0.3, frozen: this.frozen, icy, snow: this.snowCover, frost: this.frost,
      wind: { x: this.wind.x, z: this.wind.y, speed: windSpeed, gust: this.gust },
      fog: this.cur.fog, night, rain: this.cur.rain,
      footing: 1 + 0.35 * this.snowCover + 0.25 * icy + 0.1 * this.wet,
      staminaRegen: 1 - 0.1 * this.cur.rain - 0.2 * clamp((5 - temp) / 15, 0, 1),
      scoreBonus: bonus, bonusLabel,
    };
  }

  get daylight() {
    return smoothstep(-0.12, 0.2, Math.sin(this.sunElevation ?? 0.5));
  }

  // ------------------------------------------------------------------ simulation

  computeSun() {
    const h = this.hour;
    const el = 58 * DEG * Math.sin(Math.PI * (h - 6.2) / 12.4);
    const az = Math.PI * (h - 6) / 12;
    this.sunElevation = el;
    const c = Math.cos(el);
    this.sunDir.set(Math.cos(az) * c, Math.sin(el), Math.sin(az) * c * 0.75 - 0.3 * c).normalize();
    this.sunDir.y = Math.sin(el);
    this.sunDir.normalize();
  }

  applyInstant() {
    const p = this.preset;
    Object.assign(this.cur, { clouds: p.clouds, fog: p.fog, wind: p.wind, temp: p.temp, rain: p.precip === 'rain' ? p.intensity : 0, snow: p.precip === 'snow' ? p.intensity : 0 });
    this.update(0);
  }

  update(dt) {
    this.time += dt;
    if (this.timeFlow) this.hour = (this.hour + dt / this.secondsPerHour) % 24;
    if (this.auto) {
      this.autoTimer += dt;
      if (this.autoTimer > 150) {
        this.autoTimer = 0;
        const opts = WEATHER_ORDER.filter((k) => k !== this.presetId);
        this.presetId = opts[Math.floor(this.rng.next() * opts.length)];
      }
    }
    const p = this.preset;
    // Blend toward the preset (≈6 s transitions).
    const k = 1 - Math.exp(-dt / 6);
    const C = this.cur;
    C.clouds = lerp(C.clouds, p.clouds, k);
    C.fog = lerp(C.fog, p.fog, k);
    C.wind = lerp(C.wind, p.wind, k);
    C.temp = lerp(C.temp, p.temp - (this.daylight < 0.3 ? 3 : 0), k * 0.5);
    C.rain = lerp(C.rain, p.precip === 'rain' ? p.intensity : 0, k);
    C.snow = lerp(C.snow, p.precip === 'snow' ? p.intensity : 0, k);

    // Surface state accumulation.
    if (C.rain > 0.05) this.wet = Math.min(1, this.wet + dt * C.rain / 20);
    else this.wet = Math.max(0, this.wet - dt * (C.temp > 0 ? (0.4 + this.daylight) / 90 : 0.002));
    if (C.snow > 0.05 && C.temp < 1) this.snowCover = Math.min(1, this.snowCover + dt * C.snow / 35);
    else if (C.temp > 1) this.snowCover = Math.max(0, this.snowCover - dt / 50);
    this.frozen = lerp(this.frozen, C.temp < -2 ? 1 : 0, 1 - Math.exp(-dt / 15));
    this.frost = lerp(this.frost, p.frost ? 1 : C.temp < -1 && this.snowCover < 0.3 ? 0.4 : 0, 1 - Math.exp(-dt / 10));

    // Wind with gusts.
    this.windDir += dt * 0.02 * Math.sin(this.time * 0.05);
    this.gust = Math.max(0, gustNoise(this.time * (0.6 + C.wind * 0.05)));
    const ws = C.wind * (0.7 + 0.8 * this.gust);
    this.wind.set(Math.cos(this.windDir) * ws, Math.sin(this.windDir) * ws);
    this.windOffset.addScaledVector(this.wind, dt);

    // Lightning.
    this.flash = Math.max(0, this.flash - dt * 6);
    if (p.lightning) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.nextLightning = this.rng.float(7, 18);
        const n = this.rng.int(2, 4);
        for (let i = 0; i < n; i++) this.lightningQueue.push(this.time + i * this.rng.float(0.06, 0.16));
        const dist = this.rng.float(0.4, 1);
        this.onThunder?.(dist, 0.4 + dist * 2.5);
      }
    }
    while (this.lightningQueue.length && this.lightningQueue[0] <= this.time) {
      this.lightningQueue.shift();
      this.flash = 1;
    }

    this.applyLighting(dt);
  }

  applyLighting(dt) {
    this.computeSun();
    const C = this.cur;
    const day = this.daylight;
    const sinE = Math.sin(this.sunElevation);
    const golden = (1 - smoothstep(0.12, 0.62, sinE)) * smoothstep(-0.05, 0.06, sinE);
    const overcast = smoothstep(0.55, 1.0, C.clouds);
    this.golden = golden;

    // Key light: the sun by day, the moon at night.
    const sunUp = smoothstep(-0.03, 0.08, sinE);
    const sunCol = tmpC.setRGB(1.0, lerp(0.96, 0.58, golden), lerp(0.9, 0.34, golden));
    const sunI = 3.6 * sunUp * (1 - 0.82 * overcast) * (1 - 2.5 * C.fog);
    const moonI = 0.32 * (1 - sunUp) * (1 - 0.7 * overcast);
    if (sunUp > 0.02 || moonI < 0.01) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.05) this.lightDir.y = 0.05;
      this.sun.color.copy(sunCol);
      this.sun.intensity = Math.max(0, sunI);
    } else {
      this.lightDir.copy(this.moonDir);
      this.sun.color.setRGB(0.62, 0.7, 1.0);
      this.sun.intensity = moonI;
    }
    this.lightDir.normalize();
    this.sun.position.copy(this.lightDir).multiplyScalar(45).add(this.sun.target.position);

    // Ambient.
    const skyC = tmpC2.setRGB(lerp(0.12, 0.8, day), lerp(0.15, 0.88, day), lerp(0.28, 1.0, day));
    skyC.lerp(new THREE.Color(0.68, 0.7, 0.72), overcast * day);
    skyC.lerp(new THREE.Color(1.0, 0.72, 0.5), golden * 0.35 * (1 - overcast));
    this.hemi.color.copy(skyC);
    this.hemi.groundColor.setRGB(lerp(0.05, 0.32, day), lerp(0.06, 0.4, day), lerp(0.08, 0.24, day));
    this.hemi.intensity = 0.1 + 0.22 * day + 0.12 * golden + 0.5 * overcast * day + 2.8 * this.flash;

    // Sky shader.
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(this.sunDir);
    su.turbidity.value = lerp(3.5, 12, C.clouds);
    su.rayleigh.value = lerp(1.3, 0.6, overcast) + 1.2 * golden;
    su.mieCoefficient.value = lerp(0.004, 0.02, C.clouds);
    su.mieDirectionalG.value = 0.82;

    // Clouds / haze.
    const cu = this.cloudU;
    cu.uTime.value = this.time;
    cu.uCover.value = C.clouds * 0.85;
    cu.uOvercast.value = overcast;
    cu.uWind.value.copy(this.windOffset);
    cu.uFlash.value = this.flash;
    cu.uDay.value = day;
    cu.uSunDir.value.copy(this.sunDir);
    cu.uSunCol.value.copy(sunCol).multiplyScalar(lerp(0.05, 1.0, sunUp));
    cu.uAmb.value.copy(skyC).multiplyScalar(lerp(0.25, 0.75, day));

    // Fog colour follows the horizon.
    const fogCol = new THREE.Color().setRGB(lerp(0.04, 0.74, day), lerp(0.05, 0.8, day), lerp(0.08, 0.88, day));
    fogCol.lerp(new THREE.Color(0.92, 0.7, 0.5), golden * 0.45 * (1 - overcast));
    fogCol.lerp(new THREE.Color(0.6, 0.63, 0.66).multiplyScalar(lerp(0.15, 1, day)), overcast * 0.8);
    if (this.presetId === 'fog') fogCol.lerp(new THREE.Color(0.7, 0.72, 0.74).multiplyScalar(lerp(0.12, 1, day)), 0.6);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = C.fog * (1 + 0.6 * C.rain);
    cu.uFogCol.value.copy(fogCol);
    cu.uFog.value = clamp(C.fog * 14 + C.rain * 0.25, 0, 1);

    // Night sky.
    const night = 1 - day;
    this.stars.material.opacity = smoothstep(0.5, 1, night) * (1 - overcast) * (1 - clamp(C.fog * 20, 0, 1));
    this.moon.position.copy(this.moonDir).multiplyScalar(690);
    this.moon.lookAt(0, 0, 0);
    this.moon.material.opacity = smoothstep(0.4, 0.9, night) * (1 - overcast * 0.9);

    // Exposure adaptation.
    this.renderer.toneMappingExposure = lerp(1.9, 0.92, day) + 0.18 * overcast * day + 0.25 * golden;
    this.scene.environmentIntensity = lerp(0.05, 0.16, day) * (1 + 0.8 * overcast);
    // Without image-based lighting (low presets) the hemisphere light carries the sky fill.
    if (this.quality.ibl === false) this.hemi.intensity += 0.25 * day + 0.1 * overcast * day;

    // Lanterns, porch light and lit windows come on at dusk.
    const lamps = smoothstep(0.65, 0.2, day - 0.12 * overcast);
    this.lampLevel = lamps;
    for (const L of this.env.lamps ?? []) {
      const flick = L.flicker ? 1 + 0.06 * Math.sin(this.time * 13 + L.phase) + 0.04 * Math.sin(this.time * 29 + L.phase * 2) : 1;
      L.light.intensity = L.base * lamps * flick;
      if (L.mat) L.mat.emissiveIntensity = L.emissive * Math.max(0.05, lamps) * flick;
    }
    if (this.env.windowMat) this.env.windowMat.emissiveIntensity = 0.32 * lamps;

    // Weather shading uniforms.
    WX.uWet.value = this.wet * (C.temp > 0 ? 1 : 0.5);
    WX.uSnow.value = this.snowCover;
    WX.uFrost.value = this.frost;
    WX.uTime.value = this.time;
    WX.uWind.value.copy(this.wind);

    // Precipitation.
    const camT = this.camera.position;
    const pr = this.quality.precipScale;
    this.rain.visible = C.rain > 0.02 && pr > 0;
    if (this.rain.visible) {
      const ru = this.rainU;
      ru.uTime.value = this.time;
      ru.uWind.value.copy(this.wind);
      ru.uOff.value.copy(this.windOffset);
      ru.uCenter.value.set(camT.x * 0.5, 0, camT.z * 0.5);
      ru.uOpacity.value = 0.35 * clamp(C.rain * 1.4, 0, 1);
      ru.uColor.value.setRGB(lerp(0.25, 0.75, day), lerp(0.27, 0.78, day), lerp(0.32, 0.85, day)).addScalar(this.flash * 0.5);
      this.rain.geometry.setDrawRange(0, Math.round(this.rainMax * 2 * clamp(C.rain, 0, 1) * pr));
    }
    this.snowPts.visible = C.snow > 0.02 && pr > 0;
    if (this.snowPts.visible) {
      const su2 = this.snowU;
      su2.uTime.value = this.time;
      su2.uOff.value.copy(this.windOffset);
      su2.uCenter.value.set(camT.x * 0.5, 0, camT.z * 0.5);
      su2.uOpacity.value = 0.9 * clamp(C.snow * 1.3, 0, 1);
      su2.uColor.value.setRGB(lerp(0.35, 1, day), lerp(0.38, 1, day), lerp(0.45, 1, day));
      this.snowPts.geometry.setDrawRange(0, Math.round(this.snowMax * clamp(C.snow, 0, 1) * pr));
    }

    // Puddles grow while it rains, freeze to ice in the cold, shrink as they dry.
    const pud = smoothstep(0.35, 1, this.wet) * (1 - this.snowCover);
    for (const m of this.puddles) { m.scale.setScalar(Math.max(0.001, m.userData.size * (0.4 + 0.6 * pud))); m.visible = pud > 0.005; }
    this.puddleMat.opacity = pud * 0.9;
    const ice = C.temp < 0 ? 1 : 0;
    this.puddleMat.color.setRGB(lerp(0.12, 0.55, ice), lerp(0.14, 0.62, ice), lerp(0.17, 0.7, ice));
    this.puddleMat.roughness = lerp(0.03, 0.18, ice);

    // Fireflies on warm, clear nights.
    this.flyU.uTime.value = this.time;
    this.flyU.uOpacity.value = smoothstep(0.6, 0.95, night) * (C.temp > 12 ? 1 : 0) * (1 - C.rain) * (1 - overcast * 0.7);
    this.fireflies.visible = this.flyU.uOpacity.value > 0.01;

    this.updateEnvMap(dt);
  }

  updateEnvMap(dt) {
    this.envTimer -= dt;
    const key = `${Math.round(this.sunElevation / (3 * DEG))}|${Math.round(this.cur.clouds * 6)}|${this.quality.envUpdates ? 1 : 0}`;
    if (this.quality.ibl === false) {
      if (this.scene.environment) { this.scene.environment = null; this.envKey = ''; }
      return;
    }
    if (key === this.envKey || this.envTimer > 0) return;
    if (!this.quality.envUpdates && this.envRT && this.scene.environment) return;
    this.envKey = key;
    this.envTimer = 2;
    const su = this.sky.material.uniforms, eu = this.envSky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = su[k].value;
    eu.sunPosition.value.copy(this.sunDir);
    const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 100);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }
}
