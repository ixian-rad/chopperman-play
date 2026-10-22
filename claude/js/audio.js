// Audio manager: every sound in the game is synthesized here with the Web Audio API (no samples).
//
//   sources ─► sfxBus ──────────────┐
//   music   ─► musicIn ─► duck ─► musicVol ─┤─► pre ─► compressor ─► limiter ─► destination
//   beds    ─► ambFilter ─► ambBus ─┘
//
// The AudioContext is only created after a user gesture (pointerdown / keydown / click), so the
// page never triggers autoplay warnings. Without Web Audio every call is a cheap no-op.
// One-shot nodes are disconnected when their source ends; live sources are counted and capped.
import { Music } from './music.js';

const PREFS_KEY = 'backyard-log-splitter-audio-v1';
const MAX_SFX = 56; // simultaneous one-shot SFX sources
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + (b - a) * Math.random();

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.supported = !!(window.AudioContext || window.webkitAudioContext);
    this.voices = 0; // all live sources (SFX + music + ambience beds)
    this.sfxVoices = 0;
    this.musicVoices = 0;
    this.dropped = 0;
    this.eventsPlayed = {};
    this.last = {}; // per-event rate limiting
    this.landWindow = { t: 0, n: 0 };
    this.prefs = this.loadPrefs();
    this.music = new Music(this);
    const unlock = () => {
      this.unlock();
      if (this.ctx && this.ctx.state === 'running') {
        for (const ev of ['pointerdown', 'keydown', 'click']) window.removeEventListener(ev, unlock, true);
      }
    };
    for (const ev of ['pointerdown', 'keydown', 'click']) window.addEventListener(ev, unlock, true);
    // Hidden tab: suspend everything (the music scheduler also stops queueing notes).
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.wasRunning = this.ctx.state === 'running';
        if (this.wasRunning) this.ctx.suspend().catch(() => {});
      } else if (this.wasRunning) {
        this.ctx.resume().then(() => this.music.resync()).catch(() => {});
      }
    });
  }

  // ------------------------------------------------------------------ preferences

  loadPrefs() {
    const d = { sfxOn: true, musicOn: true, sfxVolume: 0.8, musicVolume: 0.5 };
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) return { ...d, ...JSON.parse(raw) };
      // Older saves only had one "sound" toggle inside the game save.
      const old = JSON.parse(localStorage.getItem('backyard-log-splitter-save-v2') ?? 'null');
      if (old?.settings?.sound === false) d.sfxOn = false;
    } catch { /* private mode / bad JSON */ }
    return d;
  }

  savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* ignore */ }
  }

  get enabled() { return this.prefs.sfxOn; }
  setEnabled(on) { this.prefs.sfxOn = !!on; this.applyVolumes(); this.savePrefs(); }
  setMusicOn(on) {
    this.prefs.musicOn = !!on;
    this.applyVolumes();
    this.savePrefs();
    if (on) this.music.start(); else this.music.stop();
  }
  setSfxVolume(v) { this.prefs.sfxVolume = clamp(+v, 0, 1); this.applyVolumes(); this.savePrefs(); }
  setMusicVolume(v) { this.prefs.musicVolume = clamp(+v, 0, 1); this.applyVolumes(); this.savePrefs(); }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, P = this.prefs;
    const sfx = P.sfxOn ? P.sfxVolume : 0;
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.03);
    this.ambBus.gain.setTargetAtTime(sfx * 0.9, t, 0.05);
    // Music is "modest" by default: 0.5 slider → about −14 dB under the SFX.
    this.musicVol.gain.setTargetAtTime(P.musicOn ? 0.42 * P.musicVolume : 0, t, 0.05);
  }

  // ------------------------------------------------------------------ context

  unlock() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended' && !document.hidden) {
      this.ctx.resume().then(() => { if (this.prefs.musicOn) this.music.start(); }).catch(() => {});
    } else if (this.ctx && this.prefs.musicOn) this.music.start();
  }

  init() {
    if (this.ctx || !this.supported) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      this.supported = false;
      this.ctx = null;
      return;
    }
    const c = this.ctx;
    this.pre = c.createGain();
    this.pre.gain.value = 0.9;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -2.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;
    this.pre.connect(this.comp).connect(this.limiter).connect(c.destination);

    // SFX bus with a gentle low-pass that closes in snow ("the snow swallows the highs").
    this.sfxMuffle = c.createBiquadFilter();
    this.sfxMuffle.type = 'lowpass';
    this.sfxMuffle.frequency.value = 18000;
    this.sfxMuffle.Q.value = 0.5;
    this.sfxBus = c.createGain();
    this.sfxMuffle.connect(this.sfxBus).connect(this.pre);

    this.ambFilter = c.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 16000;
    this.ambBus = c.createGain();
    this.ambFilter.connect(this.ambBus).connect(this.pre);

    this.musicIn = c.createGain();
    this.musicBright = c.createBiquadFilter();
    this.musicBright.type = 'lowpass';
    this.musicBright.frequency.value = 3000;
    this.musicBright.Q.value = 0.4;
    this.duck = c.createGain();
    this.musicVol = c.createGain();
    this.musicIn.connect(this.musicBright).connect(this.duck).connect(this.musicVol).connect(this.pre);

    this.makeBuffers();
    this.applyVolumes();
  }

  get ok() { return !!this.ctx && this.ctx.state === 'running' && this.prefs.sfxOn; }
  get now() { return this.ctx.currentTime; }

  // Gate + bookkeeping for a named SFX event. minGap = per-event rate limit in seconds.
  ev(name, minGap = 0, need = 2) {
    if (!this.ok) return false;
    const t = this.ctx.currentTime;
    if (minGap && t - (this.last[name] ?? -1e9) < minGap) return false;
    if (this.sfxVoices + need > MAX_SFX) { this.dropped++; return false; }
    this.last[name] = t;
    this.eventsPlayed[name] = (this.eventsPlayed[name] ?? 0) + 1;
    return true;
  }

  // ------------------------------------------------------------------ procedural buffers

  makeBuffers() {
    const c = this.ctx, sr = c.sampleRate;
    const mk = (sec, fill) => {
      const n = Math.max(1, Math.floor(sec * sr));
      const b = c.createBuffer(1, n, sr);
      fill(b.getChannelData(0), n, sr);
      return b;
    };
    const normalize = (d, peak = 0.9) => {
      let m = 1e-6;
      for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
      const k = peak / m;
      for (let i = 0; i < d.length; i++) d[i] *= k;
    };
    this.white = mk(2, (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; });
    // Pink (rain) and brown (wind, thunder, dirt) noise.
    this.pink = mk(4, (d, n) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    });
    this.brown = mk(4, (d, n) => {
      let y = 0;
      for (let i = 0; i < n; i++) { y = (y + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = y * 3.5; }
      normalize(d, 0.8);
    });
    // Resonator helper for impulse-train textures.
    const reso = (d, f, r, sr) => {
      const w = 2 * Math.PI * f / sr, a1 = 2 * r * Math.cos(w), a2 = -r * r;
      let y1 = 0, y2 = 0;
      for (let i = 0; i < d.length; i++) { const y = d[i] + a1 * y1 + a2 * y2; y2 = y1; y1 = y; d[i] = y; }
    };
    // Creaks: stick-slip pulse trains (fibres catching and releasing on the steel / each other).
    this.creaks = [0, 1, 2].map((k) => mk(0.75, (d, n, sr) => {
      let t = 0, gap = 0.016 + 0.006 * k;
      while (t < n / sr - 0.01) {
        const i = Math.floor(t * sr);
        const env = Math.sin(Math.PI * t / (n / sr));
        d[i] += (0.6 + 0.4 * Math.random()) * env;
        gap *= 0.97 + 0.07 * Math.random() + (t > 0.4 ? 0.015 : -0.01);
        gap = clamp(gap, 0.006, 0.03);
        t += gap * (0.8 + 0.4 * Math.random());
      }
      const e = d.slice();
      reso(d, 520 + 140 * k, 0.996, sr);
      reso(e, 1350 + 300 * k, 0.99, sr);
      for (let i = 0; i < n; i++) d[i] = d[i] + 0.6 * e[i];
      normalize(d, 0.85);
    }));
    // Fibre tearing: dense crackle whose density falls off.
    this.tears = [0, 1].map((k) => mk(0.5, (d, n, sr) => {
      for (let i = 0; i < n; i++) {
        const t = i / sr, dens = 0.09 * Math.exp(-t * (6 + 3 * k));
        if (Math.random() < dens) d[i] = (Math.random() * 2 - 1) * (0.4 + Math.exp(-t * 5));
      }
      const e = d.slice();
      reso(d, 2100 + 800 * k, 0.97, sr);
      reso(e, 900 + 300 * k, 0.985, sr);
      for (let i = 0; i < n; i++) d[i] = d[i] + 0.7 * e[i] + 0.05 * (Math.random() * 2 - 1) * Math.exp(-i / sr * 9);
      normalize(d, 0.85);
    }));
  }

  // ------------------------------------------------------------------ voice primitives

  track(src, nodes, kind = 'sfx') {
    this.voices++;
    if (kind === 'music') this.musicVoices++; else if (kind === 'sfx') this.sfxVoices++;
    src.onended = () => {
      this.voices--;
      if (kind === 'music') this.musicVoices--; else if (kind === 'sfx') this.sfxVoices--;
      try { src.disconnect(); } catch { /* already */ }
      for (const n of nodes) { try { n.disconnect(); } catch { /* already */ } }
    };
  }

  panNode(p) {
    if (!p || !this.ctx.createStereoPanner) return null;
    const n = this.ctx.createStereoPanner();
    n.pan.value = clamp(p, -1, 1);
    return n;
  }

  // Envelope gain: fast attack to `gain`, exponential decay to silence at t0 + dur.
  env(t0, dur, gain, attack = 0.004) {
    const g = this.ctx.createGain();
    const a = Math.min(attack, dur * 0.5);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    return g;
  }

  chain(src, nodes, dest, kind) {
    let cur = src;
    for (const n of nodes) { if (n) { cur.connect(n); cur = n; } }
    cur.connect(dest);
    this.track(src, nodes.filter(Boolean), kind);
  }

  // Filtered noise burst.
  noise({ t = this.now, dur = 0.1, type = 'bandpass', f = 1000, f1 = 0, q = 1, gain = 0.3, attack = 0.004, buf = this.white, rate = 1, pan = 0, dest = this.sfxMuffle, kind = 'sfx' }) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    fl.Q.value = q;
    const g = this.env(t, dur, gain, attack);
    this.chain(src, [fl, g, this.panNode(pan)], dest, kind);
    src.start(t, Math.random() * Math.max(0, buf.duration - dur * rate - 0.05));
    src.stop(t + dur + 0.03);
    return src;
  }

  tone({ t = this.now, dur = 0.2, f = 440, f1 = 0, gain = 0.2, type = 'sine', attack = 0.004, pan = 0, dest = this.sfxMuffle, kind = 'sfx', lp = 0 }) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    let fl = null;
    if (lp) { fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; }
    const g = this.env(t, dur, gain, attack);
    this.chain(o, [fl, g, this.panNode(pan)], dest, kind);
    o.start(t);
    o.stop(t + dur + 0.03);
    return o;
  }

  // Play a precomputed buffer (creak, tear) through an optional filter.
  sample({ t = this.now, buf, rate = 1, gain = 0.3, dur = 0, type = '', f = 1000, q = 0.7, pan = 0, dest = this.sfxMuffle, kind = 'sfx' }) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    let fl = null;
    if (type) { fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; }
    const g = c.createGain();
    g.gain.value = gain;
    const len = dur || buf.duration / rate;
    g.gain.setValueAtTime(gain, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0, t + len);
    this.chain(src, [fl, g, this.panNode(pan)], dest, kind);
    src.start(t);
    src.stop(t + len + 0.02);
  }

  // ------------------------------------------------------------------ swings

  windup(power = 0.8) {
    if (!this.ev('windup', 0.2, 1)) return;
    // Cloth and handle: a soft, slow swish while the axe goes up.
    this.noise({ dur: 0.35 + 0.2 * power, f: 500, f1: 900, q: 0.8, gain: 0.025 + 0.03 * power, attack: 0.15, pan: -0.15 });
  }

  // Swing whoosh: faster swings are louder, brighter and shorter. Mouse-drag swings use the same path.
  whoosh(power = 0.8) {
    if (!this.ev('whoosh', 0.08, 3)) return;
    const p = clamp(power, 0, 1.2);
    const t = this.now + 0.02;
    const dur = 0.42 - 0.17 * Math.min(1, p);
    const f0 = 280 + 350 * p, fPeak = 800 + 2400 * p;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.white;
    const fl = c.createBiquadFilter();
    fl.type = 'bandpass';
    fl.Q.value = 1.3 + p;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(fPeak, t + dur * 0.62);
    fl.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + dur);
    const g = c.createGain();
    const peak = 0.06 + 0.34 * Math.pow(Math.min(1, p), 1.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.62);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pn = this.panNode(0.35);
    if (pn) pn.pan.linearRampToValueAtTime(-0.25, t + dur);
    this.chain(src, [fl, g, pn], this.sfxMuffle);
    src.start(t, Math.random());
    src.stop(t + dur + 0.03);
    // Heavy, fast swings also push a low "whomp" of air.
    if (p > 0.6) this.noise({ t: t + dur * 0.3, dur: dur * 0.5, type: 'lowpass', f: 260, q: 0.7, gain: 0.18 * (p - 0.5), buf: this.brown, attack: dur * 0.25 });
  }

  // ------------------------------------------------------------------ wood

  // Sound profile of a round: species hardness, moisture, frost and rot.
  woodProfile(P, lc = {}) {
    const hard = P?.species?.hard ?? 1;
    const pr = {
      hard,
      pitch: 135 + 95 * hard,
      bright: 1250 + 1700 * hard,
      decay: clamp(0.21 - 0.045 * hard, 0.09, 0.2),
      ring: hard > 1.5 ? 0.6 : 0.15 * hard,
      wet: Math.max(lc.wet ?? 0, P?.soaked ? 0.9 : 0),
      frozen: lc.frozen ?? 0,
      rot: P?.rot ?? 0,
    };
    if (pr.wet > 0.3) { pr.bright *= 1 - 0.45 * pr.wet; pr.pitch *= 0.88; pr.decay *= 0.85; }
    if (pr.frozen > 0.3) { pr.bright *= 1 + 0.5 * pr.frozen; pr.ring += 0.35 * pr.frozen; pr.decay *= 0.85; }
    return pr;
  }

  // The bite: body thump, transient, wood resonance and a faint steel "tink" from the head.
  chop(pr, s = 0.7, t = this.now) {
    s = clamp(s, 0.12, 1.2);
    this.tone({ t, dur: pr.decay * 1.4, f: pr.pitch, f1: pr.pitch * 0.45, gain: 0.55 * s });
    this.noise({ t, dur: 0.05 + 0.02 * s, type: 'lowpass', f: pr.bright, q: 0.7, gain: 0.55 * s, attack: 0.001 });
    if (pr.rot > 0.2) {
      // Hollow, punky heart: a boxy, resonant boom.
      this.noise({ t, dur: 0.35, f: 240, q: 9, gain: 0.6 * s * pr.rot, attack: 0.002 });
    } else {
      this.noise({ t, dur: pr.decay * 1.8, f: pr.pitch * 2.8, q: 5, gain: 0.28 * s, attack: 0.002 });
    }
    this.tone({ t, dur: 0.1 + 0.08 * pr.ring, f: 2800 + 300 * pr.hard, f1: 2700, gain: (0.025 + 0.05 * pr.ring) * s });
    if (pr.frozen > 0.3) this.tone({ t, dur: 0.07, f: 1700, f1: 1500, gain: 0.08 * s * pr.frozen, type: 'triangle' });
    if (pr.wet > 0.3) this.noise({ t: t + 0.005, dur: 0.12, type: 'lowpass', f: 520, q: 1.5, gain: 0.3 * s * pr.wet, buf: this.brown });
  }

  // Generic thunk (kept for callers from older code).
  thunk(strength, wood = true) {
    if (!this.ev(wood ? 'thunk' : 'blockThud', 0.03, 6)) return;
    this.chop(this.woodProfile({ species: { hard: wood ? 1 : 0.8 } }), strength);
  }

  knot(s = 0.8) {
    if (!this.ev('knot', 0.05, 2)) return;
    const t = this.now;
    this.tone({ t, dur: 0.07, f: 760, f1: 480, gain: 0.25 * s, type: 'triangle' });
    this.noise({ t, dur: 0.05, f: 1300, q: 3, gain: 0.25 * s, attack: 0.001 });
  }

  // Creak of a crack opening; amount 0..1 = how far the split has developed.
  creak(amount = 0.5, delay = 0, deep = false) {
    if (!this.ev('creak', 0.12, 2)) return;
    const a = clamp(amount, 0, 1);
    const t = this.now + delay;
    const rate = (deep ? 0.55 : 0.8) + 0.35 * Math.random() - 0.2 * a;
    this.sample({ t, buf: this.creaks[(Math.random() * 3) | 0], rate, gain: 0.06 + 0.3 * a, type: 'bandpass', f: deep ? 420 : 700 + 300 * Math.random(), q: 1.4, pan: rand(-0.3, 0.3) });
    if (a > 0.6) this.sample({ t: t + 0.18, buf: this.creaks[(Math.random() * 3) | 0], rate: rate * 1.25, gain: 0.14 * a, type: 'bandpass', f: 1100, q: 2 });
  }

  // Axe sinks in and holds (the axe acts as the wedge): bite + fibres squeaking on the steel.
  stuck(P, lc, s, progress = 0, opts = {}) {
    if (!this.ev('stuck', 0.03, 8)) return;
    const pr = this.woodProfile(P, lc);
    const t = this.now;
    this.chop(pr, s, t);
    this.wedgeDrive(pr, s, t);
    if (opts.knot) this.knot(s);
    if (opts.seat) this.wedgeSeat(pr, progress);
    if (progress > 0.15) this.creak(progress, 0.08, !!P?.boss);
    if (opts.stringy) this.sample({ t: t + 0.05, buf: this.creaks[2], rate: 0.5, gain: 0.18, type: 'bandpass', f: 380, q: 1.2 });
  }

  wedgeDrive(pr, s, t = this.now) {
    if (!this.ev('wedgeDrive', 0.03, 2)) return;
    // Steel forced into gripping fibres: a short, wavering squeak and a tight metal tink.
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f = 520 + 260 * pr.hard;
    o.frequency.setValueAtTime(f, t + 0.01);
    for (let i = 1; i <= 5; i++) o.frequency.setValueAtTime(f * (0.9 + 0.25 * Math.random()), t + 0.01 + i * 0.02);
    const fl = c.createBiquadFilter();
    fl.type = 'bandpass';
    fl.frequency.value = f * 2;
    fl.Q.value = 4;
    const g = this.env(t + 0.01, 0.13, 0.05 * s * (1 - 0.6 * pr.wet), 0.01);
    this.chain(o, [fl, g], this.sfxMuffle);
    o.start(t + 0.01);
    o.stop(t + 0.16);
    this.tone({ t, dur: 0.06, f: 3600, f1: 3400, gain: 0.04 * s });
  }

  // The crack takes the wedge: a deeper settle and groan once the split is well along.
  wedgeSeat(pr, progress = 0.5) {
    if (!this.ev('wedgeSeat', 0.2, 3)) return;
    const t = this.now + 0.06;
    this.tone({ t, dur: 0.25, f: pr.pitch * 0.6, f1: pr.pitch * 0.35, gain: 0.25 });
    this.creak(Math.max(0.5, progress), 0.1, true);
  }

  // Wrenching the stuck axe out: friction squeal rising, then a little pop as it frees.
  wedgePull() {
    if (!this.ev('wedgePull', 0.3, 4)) return;
    const c = this.ctx, t = this.now + 0.05;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(260, t);
    for (let i = 1; i <= 8; i++) o.frequency.setValueAtTime(260 + 50 * i * (0.8 + 0.4 * Math.random()), t + i * 0.04);
    const fl = c.createBiquadFilter();
    fl.type = 'bandpass';
    fl.frequency.value = 1300;
    fl.Q.value = 3;
    const g = this.env(t, 0.38, 0.045, 0.08);
    this.chain(o, [fl, g], this.sfxMuffle);
    o.start(t);
    o.stop(t + 0.42);
    this.noise({ t: t + 0.36, dur: 0.06, type: 'lowpass', f: 1600, gain: 0.25, attack: 0.001 });
    this.tone({ t: t + 0.36, dur: 0.09, f: 210, f1: 120, gain: 0.25 });
  }

  // The clean split: bite + sharp crack + "pop" of the halves + fibres tearing.
  split(P, lc = {}, out = {}) {
    if (!this.ev('split', 0.05, 12)) return;
    const pr = this.woodProfile(P, lc);
    const t = this.now;
    const ex = clamp(out.excess ?? 0.5, 0, 2);
    this.chop(pr, 1, t);
    const fz = pr.frozen;
    this.noise({ t, dur: 0.16, f: 2800 + 1600 * fz, f1: 650, q: 0.9, gain: 0.55 + 0.15 * ex, attack: 0.001 });
    this.tone({ t: t + 0.01, dur: 0.13, f: 105, f1: 52, gain: 0.5 });
    this.noise({ t: t + 0.01, dur: 0.012, type: 'highpass', f: 3000, gain: 0.4, attack: 0.0005 });
    const rate = (0.8 + 0.3 * pr.hard) * (1 + 0.3 * fz) * (1 - 0.25 * pr.wet);
    this.sample({ t: t + 0.02, buf: this.tears[(Math.random() * 2) | 0], rate, gain: 0.25 + 0.15 * Math.min(4, out.pieces ?? 2) / 2 * (1 - 0.4 * pr.wet), pan: rand(-0.4, 0.4) });
    if (P?.twist || P?.species?.interlocked) this.sample({ t: t + 0.06, buf: this.creaks[1], rate: 0.6, gain: 0.25, type: 'bandpass', f: 600, q: 1 });
    if (fz > 0.3) for (let i = 0; i < 4; i++) this.tone({ t: t + 0.02 + i * 0.03, dur: 0.15, f: rand(2500, 5200), gain: 0.04 * fz });
    if (out.knotHit) this.knot(1);
    if (P?.boss) this.noise({ t, dur: 0.9, type: 'lowpass', f: 140, gain: 0.5, buf: this.brown, attack: 0.005 });
  }

  // Older entry point.
  crack(ratio, frozen = 0) { this.split({ species: { hard: 1 } }, { frozen }, { excess: ratio - 1 }); }

  // Punky, rotten wood crumbling apart: soft, damp and hollow.
  punk(P) {
    if (!this.ev('punk', 0.05, 6)) return;
    const t = this.now;
    this.tone({ t, dur: 0.3, f: 110, f1: 48, gain: 0.5 });
    this.noise({ t, dur: 0.4, f: 260, q: 7, gain: 0.35, attack: 0.002 });
    this.noise({ t, dur: 0.25, type: 'lowpass', f: 600, f1: 200, gain: 0.45, buf: this.brown });
    this.sample({ t: t + 0.03, buf: this.tears[1], rate: 0.45, gain: 0.25, type: 'lowpass', f: 900 });
  }

  glance(P, lc = {}, iced = false) {
    if (!this.ev('glance', 0.05, 6)) return;
    const pr = this.woodProfile(P ?? { species: { hard: 1 } }, lc);
    const t = this.now;
    this.chop(pr, 0.32, t);
    // The edge skids over bark: a falling rasp.
    this.noise({ t: t + 0.01, dur: 0.24, f: iced ? 3800 : 1500, f1: iced ? 1800 : 520, q: 1.6, gain: 0.32, attack: 0.004 });
    this.sample({ t: t + 0.02, buf: this.tears[0], rate: 1.6, gain: 0.12, type: 'highpass', f: 1500 });
    if (iced) this.iceCrack(0.4);
  }

  // ------------------------------------------------------------------ hazards

  // Hidden nail: a bright inharmonic steel clang that keeps ringing, plus spark crackle.
  clang() {
    if (!this.ev('nail', 0.05, 14)) return;
    const t = this.now;
    const f0 = 1180 + rand(-60, 60);
    for (const [r, g, d] of [[1, 0.2, 1.3], [2.76, 0.12, 0.9], [5.4, 0.07, 0.6], [8.93, 0.04, 0.4], [1.006, 0.12, 1.2]]) {
      this.tone({ t, dur: d, f: f0 * r, f1: f0 * r * 0.995, gain: g, attack: 0.001, pan: rand(-0.2, 0.2) });
    }
    this.noise({ t, dur: 0.05, type: 'highpass', f: 4000, gain: 0.5, attack: 0.0005 });
    this.sparks(6, t);
  }

  // Steel on stone: a gritty crunch, a dull short clank and sparks.
  stone() {
    if (!this.ev('stone', 0.05, 14)) return;
    const t = this.now;
    for (const [f, g] of [[1450, 0.16], [2210, 0.1], [880, 0.16]]) this.tone({ t, dur: 0.25, f, f1: f * 0.93, gain: g, type: 'triangle' });
    this.noise({ t, dur: 0.18, f: 2400, f1: 900, q: 0.6, gain: 0.6, attack: 0.001 });
    this.sample({ t: t + 0.01, buf: this.tears[0], rate: 1.9, gain: 0.4, type: 'bandpass', f: 2600, q: 0.8 });
    this.sparks(8, t);
  }

  sparks(n, t = this.now) {
    for (let i = 0; i < n; i++) this.noise({ t: t + 0.02 + Math.random() * 0.3, dur: 0.015, type: 'highpass', f: 5000 + Math.random() * 3000, gain: 0.08, attack: 0.0005, pan: rand(-0.6, 0.6) });
  }

  // The ice glaze takes a hit but holds: a sharp, glassy crack.
  iceCrack(s = 0.6) {
    if (!this.ev('iceCrack', 0.08, 4)) return;
    const t = this.now;
    this.noise({ t, dur: 0.08, type: 'highpass', f: 3200, gain: 0.35 * s, attack: 0.0005 });
    this.tone({ t, dur: 0.12, f: 3100, f1: 2200, gain: 0.08 * s });
    this.tone({ t: t + 0.02, dur: 0.1, f: 4700, f1: 4100, gain: 0.05 * s });
  }

  // Ice glaze shattering: a bright tinkle of high partials over a crunchy noise burst.
  iceShatter() {
    if (!this.ev('iceShatter', 0.1, 12)) return;
    const t = this.now;
    this.noise({ t, dur: 0.28, type: 'highpass', f: 3200, gain: 0.45, attack: 0.001 });
    this.sample({ t, buf: this.tears[1], rate: 2.2, gain: 0.35, type: 'highpass', f: 2500 });
    for (let i = 0; i < 9; i++) {
      const f = rand(2400, 6800);
      this.tone({ t: t + 0.01 + i * 0.03 + Math.random() * 0.03, dur: 0.2, f, f1: f * 0.97, gain: 0.05, pan: rand(-0.7, 0.7) });
    }
  }

  // ------------------------------------------------------------------ misses, landings

  // The blade missed the round and hit the chopping block (overBlock) or the dirt.
  miss(overBlock, s = 0.6) {
    if (overBlock) {
      if (!this.ev('blockThud', 0.05, 6)) return;
      // The weathered oak block: low, dead and heavy.
      const pr = { hard: 0.9, pitch: 120, bright: 1500, decay: 0.2, ring: 0.1, wet: 0, frozen: 0, rot: 0 };
      this.chop(pr, s);
    } else {
      if (!this.ev('groundThud', 0.05, 4)) return;
      const t = this.now;
      this.tone({ t, dur: 0.2, f: 75, f1: 45, gain: 0.45 * s });
      this.noise({ t, dur: 0.22, type: 'lowpass', f: 500, f1: 180, gain: 0.5 * s, buf: this.brown });
      this.sample({ t: t + 0.02, buf: this.tears[1], rate: 0.6, gain: 0.18 * s, type: 'lowpass', f: 1200 });
    }
  }

  // Split pieces landing / bouncing (rate-limited; volume from the impact speed).
  land(dv, y = 0) {
    if (!this.ok) return;
    const t = this.now;
    if (t - this.landWindow.t > 0.1) { this.landWindow.t = t; this.landWindow.n = 0; }
    if (this.landWindow.n >= 3) return;
    const v = clamp(dv / 4, 0.05, 1);
    if (y > 0.35) {
      if (!this.ev('clack', 0.03, 3)) return;
      // Wood on wood (on the block): a hollow clack.
      const f = rand(420, 700);
      this.tone({ t, dur: 0.08, f, f1: f * 0.8, gain: 0.25 * v, type: 'triangle' });
      this.noise({ t, dur: 0.05, f: f * 2.2, q: 4, gain: 0.25 * v, attack: 0.001 });
    } else {
      if (!this.ev('land', 0.03, 3)) return;
      // On the lawn: a soft, grassy thud.
      this.tone({ t, dur: 0.12, f: rand(95, 140), f1: 60, gain: 0.35 * v });
      this.noise({ t, dur: 0.08, type: 'lowpass', f: 700, gain: 0.25 * v, buf: this.brown, attack: 0.002 });
    }
    this.landWindow.n++;
  }

  // A piece rolling / tumbling on the ground.
  roll(speed) {
    if (!this.ev('roll', 0.15, 2)) return;
    this.noise({ dur: 0.18, type: 'lowpass', f: 300 + 80 * speed, q: 2, gain: clamp(0.04 * speed, 0.02, 0.12), buf: this.brown, attack: 0.04 });
  }

  // Kept for older callers: picks clack/land by height.
  knock(vol, y = 0.5) { this.land(vol * 4, y); }

  // The next round set down on the block.
  logPlace() {
    if (!this.ev('logPlace', 0.2, 4)) return;
    const t = this.now;
    this.tone({ t, dur: 0.18, f: 92, f1: 55, gain: 0.45 });
    this.noise({ t, dur: 0.12, f: 330, q: 3, gain: 0.35, attack: 0.002 });
    this.noise({ t, dur: 0.04, type: 'lowpass', f: 1800, gain: 0.25, attack: 0.001 });
  }

  // Leftover pieces shoved off the block.
  shove() {
    if (!this.ev('shove', 0.3, 3)) return;
    const t = this.now;
    this.noise({ t, dur: 0.22, type: 'lowpass', f: 900, f1: 400, gain: 0.18, attack: 0.03 });
    this.tone({ t, dur: 0.08, f: 300, f1: 200, gain: 0.15, type: 'triangle' });
  }

  // ------------------------------------------------------------------ bosses

  bossIntro() {
    if (!this.ev('bossIntro', 1, 14)) return;
    const t = this.now;
    // Two heavy drum hits, a minor-chord stab that opens up, and a rising swell.
    this.tone({ t, dur: 0.5, f: 72, f1: 38, gain: 0.8 });
    this.tone({ t: t + 0.3, dur: 0.7, f: 64, f1: 32, gain: 0.9 });
    this.noise({ t, dur: 1.1, f: 180, f1: 1100, q: 1, gain: 0.16, attack: 0.8 });
    const c = this.ctx;
    for (const m of [40, 47, 52, 55]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 440 * Math.pow(2, (m - 69) / 12) * (1 + rand(-0.003, 0.003));
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.setValueAtTime(250, t + 0.3);
      fl.frequency.exponentialRampToValueAtTime(2200, t + 0.9);
      fl.frequency.exponentialRampToValueAtTime(400, t + 1.8);
      const g = this.env(t + 0.3, 1.6, 0.06, 0.05);
      this.chain(o, [fl, g], this.sfxMuffle);
      o.start(t + 0.3);
      o.stop(t + 1.95);
    }
    this.music.duckFor(1.6, 0.25);
  }

  // A stuck strike on a boss: heavier, with a low groan from the trunk.
  bossHit(s = 0.8) {
    if (!this.ev('bossHit', 0.1, 3)) return;
    const t = this.now + 0.03;
    this.tone({ t, dur: 0.55, f: 62, f1: 44, gain: 0.45 * s, attack: 0.02 });
    this.creak(0.7, 0.05, true);
  }

  // A boss crosses a toughness threshold (2/3, 1/3 left): deep crack-boom and a drum roll.
  bossPhase(phase = 1) {
    if (!this.ev('bossPhase', 0.4, 12)) return;
    const t = this.now + 0.05;
    this.noise({ t, dur: 0.3, f: 1800, f1: 400, q: 0.8, gain: 0.5, attack: 0.001 });
    this.tone({ t, dur: 0.8, f: 58, f1: 30, gain: 0.7 });
    for (let i = 0; i < 4 + phase; i++) this.tone({ t: t + 0.25 + i * 0.07, dur: 0.12, f: 110 - 5 * i, f1: 60, gain: 0.25 + 0.05 * i });
    this.creak(1, 0.1, true);
    this.music.duckFor(0.6, 0.45);
  }

  bossDefeated() {
    if (!this.ev('bossDefeated', 1, 4)) return;
    this.music.stinger('boss');
  }

  // ------------------------------------------------------------------ UI

  uiClick() {
    if (!this.ev('uiClick', 0.03, 2)) return;
    const t = this.now;
    this.tone({ t, dur: 0.035, f: 1350, f1: 950, gain: 0.08, type: 'triangle' });
    this.noise({ t, dur: 0.012, type: 'highpass', f: 2500, gain: 0.06, attack: 0.0005 });
  }

  uiHover() {
    if (!this.ev('uiHover', 0.06, 1)) return;
    this.tone({ dur: 0.025, f: 2100, f1: 2000, gain: 0.018 });
  }

  uiOpen(open = true) {
    if (!this.ev(open ? 'uiOpen' : 'uiClose', 0.08, 2)) return;
    const t = this.now;
    this.noise({ t, dur: 0.14, f: open ? 1200 : 3000, f1: open ? 3200 : 1100, q: 0.9, gain: 0.07, attack: 0.04 });
    this.tone({ t: t + (open ? 0.08 : 0), dur: 0.05, f: open ? 880 : 660, gain: 0.04, type: 'triangle' });
  }

  purchase() {
    if (!this.ev('purchase', 0.1, 9)) return;
    const t = this.now;
    // Till "ka-ching": two bright notes plus a jingle of coins.
    this.tone({ t, dur: 0.12, f: 1318, gain: 0.1, type: 'square', lp: 4000 });
    this.tone({ t: t + 0.09, dur: 0.4, f: 1760, gain: 0.1, type: 'square', lp: 5000 });
    for (let i = 0; i < 6; i++) { const f = rand(3800, 6400); this.tone({ t: t + 0.05 + i * 0.035, dur: 0.12, f, f1: f * 0.98, gain: 0.04, pan: rand(-0.5, 0.5) }); }
  }

  denied() {
    if (!this.ev('denied', 0.15, 2)) return;
    const t = this.now;
    this.tone({ t, dur: 0.13, f: 196, gain: 0.12, type: 'sawtooth', lp: 1300, attack: 0.005 });
    this.tone({ t: t + 0.15, dur: 0.2, f: 147, gain: 0.12, type: 'sawtooth', lp: 1100, attack: 0.005 });
  }

  equip() {
    if (!this.ev('equip', 0.1, 4)) return;
    const t = this.now;
    this.tone({ t, dur: 0.18, f: 2600, f1: 2550, gain: 0.06 });
    this.tone({ t, dur: 0.12, f: 4100, gain: 0.03 });
    this.noise({ t, dur: 0.1, type: 'lowpass', f: 700, gain: 0.12, buf: this.brown });
  }

  skill() {
    if (!this.ev('skill', 0.1, 3)) return;
    const t = this.now;
    [784, 988, 1175].forEach((f, i) => this.tone({ t: t + i * 0.06, dur: 0.3, f, gain: 0.07, type: 'triangle' }));
  }

  // Whetstone: three strokes of a gritty, high scrape and a final ring of the edge.
  sharpen() {
    if (!this.ev('sharpen', 0.3, 8)) return;
    const t = this.now;
    for (let i = 0; i < 3; i++) {
      this.noise({ t: t + i * 0.2, dur: 0.16, f: 5200, f1: 3400, q: 3, gain: 0.14, attack: 0.04 });
      this.noise({ t: t + i * 0.2, dur: 0.16, f: 1800, q: 2, gain: 0.05, attack: 0.04 });
    }
    this.tone({ t: t + 0.62, dur: 0.6, f: 3950, f1: 3930, gain: 0.04 });
  }

  // Timing meter: small ticks at the quarter marks, a soft ping entering the sweet zone.
  meterTick(zone = false) {
    if (zone) {
      if (!this.ev('meterZone', 0.12, 1)) return;
      this.tone({ dur: 0.12, f: 1568, gain: 0.04 });
    } else {
      if (!this.ev('meterTick', 0.05, 1)) return;
      this.tone({ dur: 0.02, f: 2400, f1: 2200, gain: 0.025, type: 'square', lp: 5000 });
    }
  }

  meterStart() {
    if (!this.ev('meterStart', 0.1, 1)) return;
    this.tone({ dur: 0.05, f: 600, f1: 900, gain: 0.04, type: 'triangle' });
  }

  // Legacy tick (kept).
  tick() { this.meterTick(false); }

  // ------------------------------------------------------------------ rewards

  perfect() {
    if (!this.ev('perfect', 0.2, 6)) return;
    const t = this.now;
    this.tone({ t, dur: 0.35, f: 1760, gain: 0.08 });
    this.tone({ t: t + 0.04, dur: 0.4, f: 2637, gain: 0.05 });
    for (let i = 0; i < 4; i++) this.tone({ t: t + 0.08 + i * 0.04, dur: 0.15, f: 3500 + i * 400, gain: 0.025 });
  }

  // Points tally: a few quick rising blips, more for a bigger score.
  points(pts = 100) {
    if (pts <= 0 || !this.ev('points', 0.2, 6)) return;
    const n = clamp(Math.round(Math.log10(Math.max(10, pts)) * 1.6), 2, 6);
    const t = this.now + 0.18;
    for (let i = 0; i < n; i++) this.tone({ t: t + i * 0.045, dur: 0.07, f: 880 * Math.pow(2, i / 7), gain: 0.04, type: 'triangle' });
  }

  // Combo increments climb in pitch (pentatonic steps).
  ding(n = 1) {
    if (!this.ev('combo', 0.1, 3)) return;
    const t = this.now + 0.1;
    const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
    const f = 523 * Math.pow(2, steps[clamp(n - 2, 0, 12)] / 12);
    this.tone({ t, dur: 0.28, f, gain: 0.1, type: 'triangle' });
    this.tone({ t: t + 0.06, dur: 0.35, f: f * 1.5, gain: 0.06 });
  }

  levelUp() {
    if (!this.ev('levelUp', 0.5, 10)) return;
    const t = this.now;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ t: t + i * 0.08, dur: 0.4, f, gain: 0.1, type: 'triangle' }));
    this.tone({ t: t + 0.4, dur: 0.9, f: 2093, gain: 0.04 });
    this.music.duckFor(0.9, 0.45);
  }

  unlockWood() {
    if (!this.ev('unlock', 0.5, 4)) return;
    const t = this.now + 0.5;
    // Woody, marimba-like notes.
    [392, 494, 587, 784].forEach((f, i) => { this.tone({ t: t + i * 0.1, dur: 0.25, f, gain: 0.12 }); this.tone({ t: t + i * 0.1, dur: 0.06, f: f * 4, gain: 0.03 }); });
  }

  achievement() {
    if (!this.ev('achievement', 0.6, 8)) return;
    const t = this.now + 0.3;
    [1047, 1319, 1568, 2093].forEach((f, i) => this.tone({ t: t + i * 0.07, dur: 0.5, f, gain: 0.06 }));
    for (let i = 0; i < 4; i++) this.tone({ t: t + 0.3 + i * 0.05, dur: 0.3, f: rand(3000, 5000), gain: 0.02 });
  }

  modeComplete(stars = 0) {
    if (!this.ev('modeComplete', 1, 12)) return;
    this.music.stinger('complete');
    const t = this.now + 0.9;
    for (let i = 0; i < stars; i++) this.tone({ t: t + i * 0.25, dur: 0.4, f: 1568 * Math.pow(2, i * 4 / 12), gain: 0.08, type: 'triangle' });
  }

  timeUp() {
    if (!this.ev('timeUp', 1, 3)) return;
    const t = this.now;
    this.tone({ t, dur: 0.6, f: 233, gain: 0.12, type: 'sawtooth', lp: 1500, attack: 0.02 });
    this.tone({ t, dur: 0.6, f: 277, gain: 0.08, type: 'sawtooth', lp: 1500, attack: 0.02 });
  }

  exhausted() {
    if (!this.ev('exhausted', 1, 2)) return;
    this.noise({ dur: 0.5, f: 700, f1: 400, q: 0.8, gain: 0.08, attack: 0.15, buf: this.pink });
  }

  slip() {
    if (!this.ev('slip', 0.5, 2)) return;
    this.tone({ dur: 0.18, f: 1400, f1: 700, gain: 0.05, type: 'triangle' });
    this.noise({ dur: 0.15, f: 2500, f1: 1200, q: 2, gain: 0.08, attack: 0.01 });
  }

  // Clean split / perfect hit: short celebratory music stinger (ducks the groove).
  splitStinger(kind = 'clean') { this.music.stinger(kind); }

  // ------------------------------------------------------------------ weather + time ambience

  thunder(dist = 0.7) {
    if (!this.ev('thunder', 0.5, 4)) return;
    const t = this.now;
    const near = clamp(1.2 - dist, 0.1, 1);
    if (dist < 0.4) this.noise({ t, dur: 0.25, type: 'highpass', f: 1500, gain: 0.5 * near, attack: 0.001, dest: this.ambFilter });
    this.noise({ t: t + 0.05, dur: 2.8 + dist, type: 'lowpass', f: 420 - 200 * dist, f1: 70, q: 0.8, gain: 0.95 * near, buf: this.brown, attack: 0.08 + 0.3 * dist, dest: this.ambFilter });
    this.noise({ t: t + 0.2, dur: 1.5, type: 'lowpass', f: 900 - 400 * dist, f1: 150, q: 0.6, gain: 0.4 * near, buf: this.brown, attack: 0.2, dest: this.ambFilter });
  }

  // Continuous beds (rain, wind, breeze, crickets) are built once and only faded afterwards.
  beds() {
    if (this.bed) return this.bed;
    const c = this.ctx;
    const loop = (buf, type, f, q) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const fl = c.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(fl).connect(g).connect(this.ambFilter);
      src.start(0, Math.random() * buf.duration);
      this.voices++;
      return { src, f: fl, g };
    };
    const bed = {
      rain: loop(this.pink, 'highpass', 450, 0.4),
      patter: loop(this.white, 'bandpass', 2600, 0.7),
      wind: loop(this.brown, 'bandpass', 320, 0.7),
      whistle: loop(this.white, 'bandpass', 900, 14),
      breeze: loop(this.pink, 'lowpass', 1200, 0.5),
    };
    // Crickets: a 4.5 kHz tone, pulsed at ~30 Hz, in groups (a slow gate).
    const osc = c.createOscillator();
    osc.frequency.value = 4500;
    const am = c.createGain();
    am.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 29;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const gate = c.createGain();
    gate.gain.value = 0;
    const gl = c.createOscillator();
    gl.frequency.value = 1.3;
    const glG = c.createGain();
    glG.gain.value = 0.5;
    gl.connect(glG).connect(gate.gain);
    const level = c.createGain();
    level.gain.value = 0;
    osc.connect(am).connect(gate).connect(level).connect(this.ambFilter);
    const constAm = c.createConstantSource ? c.createConstantSource() : null;
    if (constAm) { constAm.offset.value = 0.5; constAm.connect(am.gain); constAm.connect(gate.gain); constAm.start(); }
    for (const o of [osc, lfo, gl]) o.start();
    this.voices += 3 + (constAm ? 1 : 0);
    bed.crickets = { g: level };
    this.bed = bed;
    return bed;
  }

  // Called a few times per second with the weather state. Crossfades beds and sprinkles
  // short events (rain drips, bird chirps) over the next update window.
  ambience(a = {}, wind = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (typeof a === 'number') a = { rain: a, wind }; // legacy (rain, windSpeed)
    const B = this.beds();
    const c = this.ctx, t = c.currentTime, T = 1.6; // crossfade time constant
    const rain = a.rain ?? 0, snow = a.snow ?? 0, ws = a.wind ?? 0, gust = a.gust ?? 0;
    const night = a.night ?? 0, storm = a.id === 'storm';
    this.amb = a;
    B.rain.g.gain.setTargetAtTime(0.16 * rain, t, T);
    B.rain.f.frequency.setTargetAtTime(350 + 300 * rain, t, T);
    B.patter.g.gain.setTargetAtTime(0.05 * rain * rain, t, T);
    const wl = clamp(0.012 * ws * (0.6 + 0.8 * gust), 0, 0.22);
    B.wind.g.gain.setTargetAtTime(wl, t, 0.6);
    B.wind.f.frequency.setTargetAtTime(220 + 35 * ws + 200 * gust, t, 0.6);
    B.whistle.g.gain.setTargetAtTime(ws > 6 ? 0.006 * (ws - 6) * gust : 0, t, 0.8);
    B.whistle.f.frequency.setTargetAtTime(700 + 60 * ws + 300 * gust, t, 0.8);
    const fair = (1 - rain) * (1 - snow);
    B.breeze.g.gain.setTargetAtTime(0.012 * fair * (1 - night * 0.5), t, T);
    const crickets = night > 0.55 && rain < 0.1 && snow < 0.1 && (a.temp ?? 15) > 4 ? 0.012 * (night - 0.5) * 2 : 0;
    B.crickets.g.gain.setTargetAtTime(crickets, t, T);
    // Snow muffles: the ambience and (slightly) the SFX lose their highs.
    this.ambFilter.frequency.setTargetAtTime(snow > 0.05 ? 16000 - 13500 * Math.min(1, snow * 1.5) : 16000, t, T);
    this.sfxMuffle.frequency.setTargetAtTime(snow > 0.05 ? 18000 - 10000 * Math.min(1, snow * 1.5) : 18000, t, T);
    if (!this.prefs.sfxOn) return;
    const win = a.window ?? 0.3;
    // Rain drips: rising "plips" from the eaves and leaves.
    let drips = rain * (storm ? 6 : 4) * win;
    while (drips > 0 && this.sfxVoices < MAX_SFX - 10) {
      if (Math.random() < drips) {
        const f = rand(1100, 3200);
        this.tone({ t: t + Math.random() * win, dur: 0.05, f, f1: f * 1.7, gain: rand(0.01, 0.04) * Math.min(1, rain * 1.5), dest: this.ambFilter, pan: rand(-0.8, 0.8), kind: 'amb' });
        this.eventsPlayed.drip = (this.eventsPlayed.drip ?? 0) + 1;
      }
      drips -= 1;
    }
    // Birds by day in fair weather.
    const day = 1 - night;
    const birdP = clamp(day * 1.6 - 0.3, 0, 1) * fair * (1 - (a.fog ?? 0)) * (1 - clamp(ws / 10, 0, 0.8)) * 0.14 * (win / 0.3);
    if (Math.random() < birdP && t - (this.last.bird ?? 0) > 2.5) {
      this.last.bird = t;
      this.bird(t + Math.random() * win);
    }
  }

  bird(t) {
    this.eventsPlayed.bird = (this.eventsPlayed.bird ?? 0) + 1;
    const n = 2 + ((Math.random() * 4) | 0);
    const base = rand(2600, 4200), pan = rand(-0.9, 0.9), kind = Math.random();
    for (let i = 0; i < n; i++) {
      const c = this.ctx, o = c.createOscillator();
      const tt = t + i * rand(0.09, 0.16), d = rand(0.05, 0.11);
      const f0 = base * rand(0.9, 1.1);
      o.frequency.setValueAtTime(kind < 0.5 ? f0 : f0 * 1.4, tt);
      o.frequency.exponentialRampToValueAtTime(kind < 0.5 ? f0 * 1.5 : f0 * 0.8, tt + d * 0.7);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.1, tt + d);
      const g = this.env(tt, d, rand(0.012, 0.03), 0.01);
      this.chain(o, [g, this.panNode(pan)], this.ambFilter, 'amb');
      o.start(tt);
      o.stop(tt + d + 0.02);
    }
  }

  // ------------------------------------------------------------------ test hooks

  state() {
    const m = this.music;
    const ev = {};
    for (const k of Object.keys(this.eventsPlayed).sort()) ev[k] = this.eventsPlayed[k];
    return {
      ctxState: this.ctx ? this.ctx.state : (this.supported ? 'locked' : 'unavailable'),
      musicOn: this.prefs.musicOn,
      musicPlaying: m.playing,
      musicSection: m.section,
      intensity: Math.round(m.intensity * 100) / 100,
      activeVoices: this.voices,
      sfxVoices: this.sfxVoices,
      musicVoices: this.musicVoices,
      sfxOn: this.prefs.sfxOn,
      sfxVolume: this.prefs.sfxVolume,
      musicVolume: this.prefs.musicVolume,
      bpm: Math.round(m.bpm),
      bar: m.barCount,
      notesScheduled: m.notes,
      dropped: this.dropped,
      eventsPlayed: ev,
    };
  }
}
