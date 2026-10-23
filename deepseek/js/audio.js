/**
 * Procedural foley engine for American Split. Everything here is synthesized
 * with Web Audio: no samples, no network assets, no console noise.
 *
 * Design notes
 * - The AudioContext is created lazily (ensure()) so autoplay rules are kept.
 * - All one-shot voices are tracked and disconnected when they end; a hard cap
 *   steals the oldest voice when a burst of impacts would pile up.
 * - The noise bed is generated once and reused by every noise voice.
 * - SFX and music have separate buses so the Settings sliders are independent.
 */

/** Wood-specific impact signatures. f0/f1 = body thump, pop = mid crack. */
const WOOD_PROFILES = {
  pine: { f0: 138, f1: 58, hp: 420, lp: 2600, lpEnd: 1050, pop: 205, popEnd: 125, thump: 0.34, crackle: 0.72, ring: 0 },
  birch: { f0: 152, f1: 64, hp: 520, lp: 3200, lpEnd: 1200, pop: 235, popEnd: 140, thump: 0.32, crackle: 0.78, ring: 0.02 },
  spruce: { f0: 132, f1: 56, hp: 500, lp: 3000, lpEnd: 1150, pop: 220, popEnd: 130, thump: 0.36, crackle: 0.75, ring: 0 },
  rottenElm: { f0: 92, f1: 40, hp: 170, lp: 900, lpEnd: 300, pop: 125, popEnd: 82, thump: 0.3, crackle: 0.45, ring: 0, damp: true },
  oak: { f0: 120, f1: 50, hp: 780, lp: 4200, lpEnd: 1450, pop: 252, popEnd: 150, thump: 0.4, crackle: 0.92, ring: 0.08 },
  knottyOak: { f0: 116, f1: 48, hp: 840, lp: 4500, lpEnd: 1500, pop: 265, popEnd: 155, thump: 0.42, crackle: 0.95, ring: 0.12 },
  forkedElm: { f0: 124, f1: 52, hp: 900, lp: 4800, lpEnd: 1600, pop: 275, popEnd: 162, thump: 0.4, crackle: 0.9, ring: 0.16 },
  hickory: { f0: 112, f1: 46, hp: 960, lp: 5200, lpEnd: 1700, pop: 288, popEnd: 170, thump: 0.44, crackle: 1, ring: 0.18 },
  knottyHickory: { f0: 108, f1: 45, hp: 1000, lp: 5400, lpEnd: 1750, pop: 300, popEnd: 176, thump: 0.46, crackle: 1.02, ring: 0.2 },
  ringShakeWalnut: { f0: 106, f1: 44, hp: 1050, lp: 5600, lpEnd: 1800, pop: 312, popEnd: 182, thump: 0.44, crackle: 1.04, ring: 0.22 },
  ironwood: { f0: 98, f1: 42, hp: 1150, lp: 6800, lpEnd: 2100, pop: 330, popEnd: 196, thump: 0.46, crackle: 1.08, ring: 0.75 },
  twistedColossus: { f0: 104, f1: 42, hp: 980, lp: 6000, lpEnd: 1900, pop: 305, popEnd: 185, thump: 0.48, crackle: 1.1, ring: 0.35 },
  ironStump: { f0: 94, f1: 38, hp: 1080, lp: 7000, lpEnd: 2150, pop: 322, popEnd: 190, thump: 0.5, crackle: 1.12, ring: 0.55 },
};

const FROZEN_PROFILE = { f0: 168, f1: 82, hp: 1500, lp: 7600, lpEnd: 2400, pop: 360, popEnd: 230, thump: 0.34, crackle: 1.2, ring: 0.12 };

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._sfxVolume = 0.8;
    this._musicVolume = 0.35;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noise = null;
    this.voices = new Set();
    this.nextVoiceId = 1;
    this.maxVoices = 32;
    this.ambient = null;
    this.ambientState = { weather: 'clear', night: 0, wind: 0 };
    this._lastFragmentSound = 0;
    this._lastHoverSound = 0;
    this._nextCritter = 0;
    this._noiseOffsets = 0;
    // Performance governor: the main loop feeds us the measured FPS twice a
    // second. Under SwiftShader a burst of foley should never compete with the
    // frame; a low tier caps voices and mutes the continuous ambience, and it
    // recovers automatically (with hysteresis) once frames are healthy again.
    this._lastSweep = 0;
    this._perfTier = 0;
    this._ambientSuspended = false;
  }

  /* ------------------------------------------------------------------ *
   *  Context / buses / voice bookkeeping
   * ------------------------------------------------------------------ */

  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        // 'balanced' gives the audio thread a little more buffer than the
        // interactive default. Under software rendering the extra latency is
        // imperceptible next to a 30-60 ms frame and it lowers wake-up pressure.
        try {
          this.ctx = new AC({ latencyHint: 'balanced' });
        } catch {
          this.ctx = new AC();
        }
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        // A gentle limiter keeps a split + coins + stinger + storm from clipping.
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -12;
        this.limiter.knee.value = 8;
        this.limiter.ratio.value = 8;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.25;
        this.master.connect(this.limiter).connect(this.ctx.destination);

        // Dedicated buses: the topbar speaker mutes SFX only, while Settings
        // has independent sliders and mute buttons for both.
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = this.enabled ? this._sfxVolume : 0;
        this.sfxBus.connect(this.master);

        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = this._musicVolume;
        this.musicBus.connect(this.master);

        this.noise = this._makeNoise();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this._sweep();
      return this.ctx;
    } catch {
      return null;
    }
  }

  _makeNoise() {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * 2));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.32 + white * 0.68;
      data[i] = last;
    }
    return buffer;
  }

  get activeVoices() {
    this._sweep();
    return this.voices.size;
  }

  get contextState() {
    return this.ctx ? this.ctx.state : 'locked';
  }

  get sfxVolume() {
    return this._sfxVolume;
  }

  get musicVolume() {
    return this._musicVolume;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.ctx && this.sfxBus) {
      const target = this.enabled ? this._sfxVolume : 0;
      this.sfxBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.025);
    }
  }

  setSfxVolume(volume) {
    this._sfxVolume = Math.max(0, Math.min(1, safeNumber(volume, 0.8)));
    if (this.ctx && this.sfxBus) {
      const target = this.enabled ? this._sfxVolume : 0;
      this.sfxBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
    }
  }

  setMusicVolume(volume) {
    this._musicVolume = Math.max(0, Math.min(1, safeNumber(volume, 0.35)));
    if (this.ctx && this.musicBus) {
      this.musicBus.gain.setTargetAtTime(this._musicVolume, this.ctx.currentTime, 0.05);
    }
  }

  _track(source, nodes, stopAt) {
    if (!this.ctx) return null;
    const entry = {
      id: this.nextVoiceId++,
      nodes: (nodes || []).filter(Boolean),
      stopAt: stopAt || this.ctx.currentTime + 2,
      dead: false,
    };
    this.voices.add(entry);
    if (source && typeof source.addEventListener === 'function') {
      source.addEventListener('ended', () => this._releaseVoice(entry), { once: true });
    }
    if (this.voices.size > this.maxVoices) this._stealVoice();
    return entry;
  }

  _releaseVoice(entry) {
    if (!entry || entry.dead) return;
    entry.dead = true;
    this.voices.delete(entry);
    for (const node of entry.nodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  _stealVoice() {
    let oldest = null;
    for (const entry of this.voices) {
      if (!oldest || entry.id < oldest.id) oldest = entry;
    }
    if (!oldest) return;
    try {
      for (const node of oldest.nodes) {
        if (typeof node.stop === 'function') node.stop();
      }
    } catch {
      /* node already stopped */
    }
    this._releaseVoice(oldest);
  }

  _sweep(force = false) {
    if (!this.ctx || this.voices.size === 0) return;
    const now = this.ctx.currentTime;
    // The live telemetry getter asks for activeVoices every frame. Sweeping at
    // 60 Hz is wasted work; finished sources also fire 'ended'. A short gate
    // keeps the count honest without walking the set on every rendered frame.
    if (!force && now - this._lastSweep < 0.12) return;
    this._lastSweep = now;
    for (const entry of [...this.voices]) {
      if (entry.stopAt && now > entry.stopAt + 0.3) this._releaseVoice(entry);
    }
  }

  /**
   * Feed measured frame rate in. Cheap to call at HUD cadence (2 Hz).
   * tier 0 = full, 1 = low, 2 = severe. Hysteresis avoids oscillating when the
   * host sits right on a threshold.
   */
  setPerformancePressure(fps) {
    const value = Number(fps);
    if (!Number.isFinite(value) || value <= 0) return;
    const previous = this._perfTier;
    let tier = previous;
    if (value < 16) tier = 2;
    else if (value < 24 && previous === 0) tier = 1;
    else if (value < 20) tier = 2;
    else if (value >= 30) tier = 0;
    else if (value >= 22) tier = Math.min(previous, 1);
    if (tier === previous) return;
    this._perfTier = tier;
    this.maxVoices = tier === 2 ? 16 : tier === 1 ? 24 : 32;
    while (this.voices.size > this.maxVoices) this._stealVoice();
    // The three looping beds run on the audio thread for the whole session.
    // Stop them under severe pressure; setAmbient() rebuilds them on recovery.
    const suspend = tier === 2;
    if (suspend !== this._ambientSuspended) {
      this._ambientSuspended = suspend;
      if (suspend) this._destroyAmbientBed();
    }
  }

  _destroyAmbientBed() {
    if (!this.ambient) return;
    try {
      this.ambient.source?.stop();
      this.ambientLfo?.stop();
    } catch {
      /* already stopped */
    }
    const nodes = [
      this.ambient.source,
      this.ambient.rain?.filter,
      this.ambient.rain?.gain,
      this.ambient.wind?.filter,
      this.ambient.wind?.gain,
      this.ambient.hush?.filter,
      this.ambient.hush?.gain,
      this.ambientLfo,
      this.ambientLfoGain,
    ];
    for (const node of nodes) {
      try {
        node?.disconnect?.();
      } catch {
        /* already disconnected */
      }
    }
    this.ambient = null;
    this.ambientLfo = null;
    this.ambientLfoGain = null;
  }

  _noiseOffset(duration) {
    const max = Math.max(0, (this.noise?.duration || 2) - duration - 0.02);
    this._noiseOffsets = (this._noiseOffsets + 0.371) % 1;
    return (this._noiseOffsets * 0.61 + Math.random() * 0.39) * max;
  }

  /* ------------------------------------------------------------------ *
   *  Synthesis helpers
   * ------------------------------------------------------------------ */

  /** One filtered-noise voice. Returns true when it was scheduled. */
  _noiseVoice(opts = {}) {
    if (!this.enabled) return false;
    const ctx = this.ensure();
    if (!ctx || !this.noise) return false;
    const {
      at = 0,
      dur = 0.2,
      type = 'bandpass',
      freq = 1000,
      freqEnd = null,
      q = 1,
      gain = 0.1,
      attack = 0.004,
      playbackRate = 1,
      pan = 0,
      bus = null,
    } = opts;
    const t0 = ctx.currentTime + Math.max(0, at);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = Math.max(0.25, playbackRate);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(attack, dur * 0.4));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(env);
    let tail = env;
    let panner = null;
    if (pan && ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      env.connect(panner);
      tail = panner;
    }
    tail.connect(bus || this.sfxBus);
    const stop = t0 + dur + 0.04;
    src.start(t0, this._noiseOffset(dur + 0.05));
    src.stop(stop);
    this._track(src, [src, filter, env, panner], stop);
    return true;
  }

  /** One oscillator voice with optional pitch sweep and lowpass. */
  _toneVoice(opts = {}) {
    // Muting SFX should also stop voices reaching the bus at all, so a muted
    // game spends no synthesis time on foley while the soundtrack keeps playing.
    if (!this.enabled) return false;
    const ctx = this.ensure();
    if (!ctx) return false;
    const {
      at = 0,
      dur = 0.2,
      type = 'sine',
      f0 = 440,
      f1 = null,
      gain = 0.1,
      attack = 0.004,
      lp = null,
      pan = 0,
      bus = null,
    } = opts;
    const t0 = ctx.currentTime + Math.max(0, at);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(attack, dur * 0.4));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    let tail = env;
    let filter = null;
    let panner = null;
    if (lp) {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lp;
      env.connect(filter);
      tail = filter;
    }
    if (pan && ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      tail.connect(panner);
      tail = panner;
    }
    tail.connect(bus || this.sfxBus);
    const stop = t0 + dur + 0.04;
    osc.start(t0);
    osc.stop(stop);
    this._track(osc, [osc, env, filter, panner], stop);
    return true;
  }

  /* ------------------------------------------------------------------ *
   *  Ambience: weather bed, birds by day, crickets at night
   * ------------------------------------------------------------------ */

  setAmbient({ weather = 'clear', night = 0, wind = 0 } = {}) {
    this.ambientState = { weather, night, wind };
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    if (this._ambientSuspended) return;
    if (!this.ambient) this._buildAmbientBed();
    const now = ctx.currentTime;
    const a = this.ambient;
    const rain = weather === 'rain' ? 1 : 0;
    const snow = weather === 'snow' ? 1 : 0;
    const windLevel = Math.max(0, Math.min(1, safeNumber(wind, 0)));
    const nightLevel = Math.max(0, Math.min(1, safeNumber(night, 0)));
    const rainTarget = rain * (0.05 + nightLevel * 0.006) + (weather === 'fog' ? 0.004 : 0);
    const windTarget = 0.004 + windLevel * 0.022 + (weather === 'wind' ? 0.008 : 0);
    const hushTarget = snow ? 0.012 * (1 - nightLevel * 0.4) : weather === 'fog' ? 0.006 : 0.0025;
    a.rain.gain.gain.setTargetAtTime(Math.max(0.0001, rainTarget), now, 0.7);
    a.wind.gain.gain.setTargetAtTime(Math.max(0.0001, windTarget), now, 0.8);
    a.hush.gain.gain.setTargetAtTime(Math.max(0.0001, hushTarget), now, 0.8);
    a.rain.filter.frequency.setTargetAtTime(rain ? 2500 : 1300, now, 0.7);
    a.wind.filter.frequency.setTargetAtTime(320 + windLevel * 340, now, 0.9);
    a.hush.filter.frequency.setTargetAtTime(snow ? 6400 : 2200, now, 0.9);
    this._scheduleCritter(now);
  }

  _buildAmbientBed() {
    const ctx = this.ctx;
    // One looped noise source feeds all three bands. Three independent sources
    // (the round-2 shape) did the same job but tripled the source processing
    // and buffer-read work for a bed this quiet.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const makeBand = (type, freq, q) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter).connect(gain).connect(this.sfxBus);
      return { filter, gain };
    };
    this.ambient = {
      source: src,
      rain: makeBand('highpass', 2400, 0.4),
      wind: makeBand('lowpass', 380, 0.7),
      hush: makeBand('highpass', 2800, 0.3),
    };
    src.start(0, Math.random() * 1.4);
    // A slow LFO breathes through the wind filter so the bed never feels static.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.075;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(this.ambient.wind.filter.frequency);
    lfo.start();
    this.ambientLfo = lfo;
    this.ambientLfoGain = lfoGain;
  }

  get ambientLevel() {
    if (!this.ambient) return 0;
    const sum =
      this.ambient.rain.gain.gain.value +
      this.ambient.wind.gain.gain.value +
      this.ambient.hush.gain.gain.value;
    return Number(sum.toFixed(4));
  }

  _scheduleCritter(now) {
    if (now < this._nextCritter) return;
    const { weather, night } = this.ambientState;
    const nightLevel = safeNumber(night, 0);
    this._nextCritter = now + 5 + Math.random() * 9;
    if (weather === 'rain') return;
    if (nightLevel > 0.52) {
      this._cricket(now + 0.05, -0.65 + Math.random() * 0.4);
    } else if (weather !== 'snow') {
      this._bird(now + 0.06, -0.8 + Math.random() * 1.6);
    }
  }

  _bird(at = 0, pan = 0) {
    if (!this.ensure()) return;
    const calls = 2 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 900;
    for (let i = 0; i < calls; i += 1) {
      const start = at + i * (0.11 + Math.random() * 0.06);
      this._toneVoice({
        at: start,
        dur: 0.09 + Math.random() * 0.04,
        type: 'triangle',
        f0: base + Math.random() * 260,
        f1: base + 340 + Math.random() * 420,
        gain: 0.016 + Math.random() * 0.01,
        attack: 0.012,
        pan,
      });
    }
  }

  _cricket(at = 0, pan = 0) {
    if (!this.ensure()) return;
    const base = 3900 + Math.random() * 700;
    const pulses = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < pulses; i += 1) {
      this._toneVoice({
        at: at + i * 0.065,
        dur: 0.03,
        type: 'sine',
        f0: base,
        f1: base * 0.94,
        gain: 0.009,
        attack: 0.005,
        pan,
      });
    }
  }

  /* ------------------------------------------------------------------ *
   *  Core gameplay foley (existing public API preserved)
   * ------------------------------------------------------------------ */

  whoosh(intensity = 1) {
    const level = Math.max(0.1, Math.min(1.5, safeNumber(intensity, 1)));
    this._noiseVoice({
      dur: 0.5,
      type: 'bandpass',
      freq: 300 + level * 120,
      freqEnd: 1250 + level * 620,
      q: 0.85,
      gain: 0.055 * level,
      attack: 0.11,
    });
    this._noiseVoice({
      at: 0.16,
      dur: 0.44,
      type: 'bandpass',
      freq: 900 + level * 700,
      freqEnd: 360,
      q: 1.1,
      gain: 0.03 * level,
      attack: 0.08,
    });
  }

  /** Charge-meter tick. */
  tick(strength = 0.4) {
    const level = Math.max(0.1, Math.min(1, safeNumber(strength, 0.4)));
    this._toneVoice({ dur: 0.035, type: 'square', f0: 1500, f1: 1420, gain: 0.012 * level, attack: 0.002 });
  }

  /** Bright UI / perfect-hit affirmation. */
  chime(intensity = 0.7) {
    const level = Math.max(0.1, Math.min(1.6, safeNumber(intensity, 0.7)));
    [659.25, 987.77, 1318.51].forEach((frequency, index) => {
      this._toneVoice({
        at: index * 0.055,
        dur: 0.55,
        type: 'sine',
        f0: frequency,
        f1: frequency * 0.997,
        gain: 0.035 * level,
      });
    });
  }

  levelUp() {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      this._toneVoice({
        at: index * 0.085,
        dur: 0.7,
        type: 'triangle',
        f0: frequency,
        f1: frequency * 0.998,
        gain: 0.045,
      });
    });
  }

  /** Short wooden UI tick. Used by the click delegation in main.js. */
  click() {
    this._noiseVoice({ dur: 0.045, type: 'bandpass', freq: 1700, freqEnd: 1050, q: 2.4, gain: 0.03 });
    this._toneVoice({ dur: 0.05, type: 'triangle', f0: 560, f1: 430, gain: 0.03 });
  }

  hover() {
    // Hovering a button before the first click must not create the context:
    // only the user's first real gesture may unlock audio.
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    if (this.ctx.currentTime - this._lastHoverSound < 0.06) return;
    this._lastHoverSound = this.ctx.currentTime;
    this._toneVoice({ dur: 0.035, type: 'sine', f0: 1150, f1: 1320, gain: 0.009, attack: 0.003 });
  }

  /** UI refusal: not enough coins, wind, wedges, or an invalid action. */
  deny() {
    this._toneVoice({ dur: 0.14, type: 'square', f0: 196, f1: 146, gain: 0.028, lp: 900 });
    this._noiseVoice({ at: 0.005, dur: 0.1, type: 'bandpass', freq: 520, freqEnd: 240, q: 1.6, gain: 0.028 });
  }

  /** Alias used by menus that prefer the word "error". */
  error() {
    this.deny();
  }

  /** A modal opens: a wooden latch, a small hinge and a paper/leather rustle. */
  menuOpen(kind = 'shop') {
    this._noiseVoice({ dur: 0.1, type: 'bandpass', freq: 560, freqEnd: 260, q: 1.2, gain: 0.048, attack: 0.003 });
    this._toneVoice({ dur: 0.12, type: 'triangle', f0: 330, f1: 205, gain: 0.038 });
    this._noiseVoice({ at: 0.055, dur: 0.22, type: 'highpass', freq: 2400, freqEnd: 5400, q: 0.6, gain: 0.012, attack: 0.03 });
    if (kind === 'settings') {
      this._toneVoice({ at: 0.11, dur: 0.2, type: 'sine', f0: 880, f1: 1046.5, gain: 0.014 });
    }
  }

  /** A modal closes: the latch lets go and the lid settles. */
  menuClose() {
    this._noiseVoice({ dur: 0.12, type: 'bandpass', freq: 480, freqEnd: 180, q: 1.4, gain: 0.04, attack: 0.003 });
    this._toneVoice({ dur: 0.16, type: 'sine', f0: 170, f1: 96, gain: 0.04 });
  }

  /** Clipboard/copy acknowledgement. A refusal falls back to the deny cue. */
  confirm(ok = true) {
    if (!ok) {
      this.deny();
      return;
    }
    [880, 1174.66].forEach((frequency, index) => {
      this._toneVoice({ at: index * 0.055, dur: 0.16, type: 'sine', f0: frequency, f1: frequency, gain: 0.026 });
    });
  }

  /**
   * A weather front rolls in. The looping beds in setAmbient() carry the steady
   * state; this is the short one-shot that makes the change audible.
   */
  weatherChange(kind = 'clear') {
    if (kind === 'rain') {
      this._noiseVoice({ dur: 1.1, type: 'highpass', freq: 1100, freqEnd: 3400, q: 0.55, gain: 0.032, attack: 0.28 });
      for (let i = 0; i < 5; i += 1) {
        this._toneVoice({
          at: 0.14 + i * 0.11 + Math.random() * 0.05,
          dur: 0.05,
          type: 'sine',
          f0: 2100 + Math.random() * 1800,
          f1: 700 + Math.random() * 500,
          gain: 0.012,
          pan: -0.7 + Math.random() * 1.4,
        });
      }
      this._toneVoice({ dur: 0.9, type: 'sine', f0: 58, f1: 42, gain: 0.035, attack: 0.25 });
    } else if (kind === 'snow') {
      this._noiseVoice({ dur: 1.2, type: 'highpass', freq: 3600, freqEnd: 6800, q: 0.5, gain: 0.024, attack: 0.35 });
      for (let i = 0; i < 4; i += 1) {
        const f = 2600 + Math.random() * 2600;
        this._toneVoice({
          at: 0.08 + i * 0.12,
          dur: 0.18 + Math.random() * 0.12,
          type: 'sine',
          f0: f,
          f1: f * 0.96,
          gain: 0.009,
          pan: -0.5 + Math.random(),
        });
      }
    } else if (kind === 'wind') {
      this._noiseVoice({ dur: 1.3, type: 'bandpass', freq: 220, freqEnd: 1250, q: 1.1, gain: 0.048, attack: 0.3 });
      this._noiseVoice({ at: 0.4, dur: 0.9, type: 'bandpass', freq: 1300, freqEnd: 380, q: 1.4, gain: 0.03, attack: 0.2 });
    } else if (kind === 'fog') {
      this._noiseVoice({ dur: 1.15, type: 'lowpass', freq: 900, freqEnd: 260, q: 0.7, gain: 0.04, attack: 0.32 });
      this._toneVoice({ dur: 0.9, type: 'sine', f0: 146, f1: 130, gain: 0.012, attack: 0.3 });
    } else {
      this._noiseVoice({ dur: 0.7, type: 'highpass', freq: 1200, freqEnd: 2600, q: 0.5, gain: 0.012, attack: 0.24 });
    }
  }

  /**
   * Time of day changes: a warm golden-hour lift, a cool night fall, a dawn
   * bird call or a short bright noon shimmer. Quiet enough for auto-time.
   */
  timeShift(preset = 'golden') {
    if (preset === 'night') {
      this._toneVoice({ dur: 0.8, type: 'sine', f0: 392, f1: 330, gain: 0.02, attack: 0.05 });
      this._toneVoice({ at: 0.24, dur: 0.9, type: 'sine', f0: 294, f1: 247, gain: 0.016, attack: 0.06 });
      this._noiseVoice({ dur: 1.3, type: 'lowpass', freq: 420, freqEnd: 140, q: 0.7, gain: 0.014, attack: 0.35 });
    } else if (preset === 'dawn') {
      [0, 0.16, 0.34].forEach((at, i) => {
        this._toneVoice({
          at,
          dur: 0.12,
          type: 'triangle',
          f0: 2100 + i * 240,
          f1: 2900 + i * 260,
          gain: 0.014,
          attack: 0.015,
          pan: -0.3 + i * 0.3,
        });
      });
      this._noiseVoice({ dur: 1, type: 'highpass', freq: 1800, freqEnd: 3200, q: 0.5, gain: 0.01, attack: 0.3 });
    } else if (preset === 'noon') {
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        this._toneVoice({ at: index * 0.06, dur: 0.3, type: 'sine', f0: frequency, f1: frequency, gain: 0.016, attack: 0.02 });
      });
    } else {
      [261.63, 329.63, 392].forEach((frequency, index) => {
        this._toneVoice({ at: index * 0.075, dur: 0.62, type: 'triangle', f0: frequency, f1: frequency, gain: 0.019, attack: 0.03 });
      });
      this._toneVoice({ dur: 0.7, type: 'sine', f0: 130.81, f1: 130.81, gain: 0.03, attack: 0.04 });
      this._noiseVoice({ dur: 0.9, type: 'highpass', freq: 3600, freqEnd: 6200, q: 0.6, gain: 0.008, attack: 0.3 });
    }
  }

  /** Contract medal / grade fanfare. Gold gets the full cadence. */
  medal(tier = 'gold') {
    const rank = String(tier || '').toLowerCase();
    const notes =
      rank === 'gold'
        ? [392, 493.88, 587.33, 783.99, 987.77]
        : rank === 'silver'
          ? [392, 493.88, 587.33, 783.99]
          : [349.23, 440, 523.25];
    notes.forEach((frequency, index) => {
      this._toneVoice({ at: index * 0.085, dur: 0.75, type: 'triangle', f0: frequency, f1: frequency, gain: 0.046 });
    });
    this._toneVoice({ at: 0.02, dur: 1.1, type: 'sine', f0: rank === 'gold' ? 98 : 110, f1: rank === 'gold' ? 98 : 110, gain: 0.08, attack: 0.03 });
    this._noiseVoice({ at: 0.08, dur: 0.8, type: 'highpass', freq: 4200, freqEnd: 6800, q: 0.6, gain: 0.014, attack: 0.25 });
    this.coin(0.28);
    if (rank === 'gold') this._toneVoice({ at: 0.4, dur: 1.0, type: 'sine', f0: 659.25, f1: 659.25, gain: 0.03, attack: 0.03 });
  }

  /** A winded swing: a short breath in and a tired, weak follow-through. */
  winded() {
    this._noiseVoice({ dur: 0.34, type: 'bandpass', freq: 950, freqEnd: 520, q: 0.8, gain: 0.048, attack: 0.06, pan: -0.12 });
    this._noiseVoice({ at: 0.15, dur: 0.3, type: 'bandpass', freq: 620, freqEnd: 300, q: 0.9, gain: 0.034, attack: 0.045, pan: 0.12 });
    this._toneVoice({ at: 0.02, dur: 0.28, type: 'sawtooth', f0: 112, f1: 82, gain: 0.012, lp: 420 });
  }

  /** Precision/lock miss: a dull, deflating "that one got away" cue. */
  miss() {
    this._toneVoice({ dur: 0.2, type: 'triangle', f0: 330, f1: 196, gain: 0.05, lp: 1300 });
    this._noiseVoice({ dur: 0.22, type: 'lowpass', freq: 760, freqEnd: 230, q: 0.8, gain: 0.038 });
  }

  /** A fresh round thunks onto the block (normal logs; bosses have bossIntro). */
  roundStart() {
    this._toneVoice({ dur: 0.2, type: 'sine', f0: 108, f1: 62, gain: 0.12 });
    this._noiseVoice({ dur: 0.14, type: 'lowpass', freq: 760, freqEnd: 280, q: 0.7, gain: 0.045 });
    this._toneVoice({ at: 0.02, dur: 0.12, type: 'triangle', f0: 860, f1: 610, gain: 0.02 });
  }

  /** Coins from a clean split or a purchase. */
  coin(delay = 0) {
    this._toneVoice({ at: delay, dur: 0.16, type: 'sine', f0: 1568, f1: 1560, gain: 0.045 });
    this._toneVoice({ at: delay + 0.055, dur: 0.22, type: 'sine', f0: 2093, f1: 2080, gain: 0.032 });
  }

  purchase() {
    this._noiseVoice({ dur: 0.11, type: 'bandpass', freq: 2400, freqEnd: 1200, q: 1.2, gain: 0.045 });
    [523.25, 783.99, 1046.5].forEach((frequency, index) => {
      this._toneVoice({ at: index * 0.06, dur: 0.26, type: 'triangle', f0: frequency, f1: frequency, gain: 0.04 });
    });
    this.coin(0.2);
  }

  /** Steel drawn across a whetstone: three short gritty strokes. */
  sharpen() {
    for (let i = 0; i < 3; i += 1) {
      this._noiseVoice({
        at: i * 0.16,
        dur: 0.13,
        type: 'bandpass',
        freq: 4400 + i * 300,
        freqEnd: 2500,
        q: 3.2,
        gain: 0.055,
        attack: 0.01,
      });
    }
    this._toneVoice({ at: 0.02, dur: 0.2, type: 'triangle', f0: 2600, f1: 2200, gain: 0.012 });
  }

  /** Gritty steel-on-stone / nail spark with a short metallic ring. */
  hazard(type = 'stone', pan = 0) {
    const nail = type === 'nail';
    const spot = Math.max(-0.8, Math.min(0.8, safeNumber(pan, 0)));
    this._noiseVoice({
      dur: nail ? 0.16 : 0.2,
      type: 'bandpass',
      freq: nail ? 4200 : 2600,
      freqEnd: nail ? 1800 : 1100,
      q: 0.9,
      gain: 0.12,
      attack: 0.002,
      pan: spot,
    });
    const partials = nail ? [2150, 3370, 5120] : [1450, 2210, 880];
    partials.forEach((frequency, index) => {
      this._toneVoice({
        at: index * 0.006,
        dur: nail ? 0.55 : 0.28,
        type: index === 2 ? 'triangle' : 'sine',
        f0: frequency,
        f1: frequency * 0.96,
        gain: (nail ? 0.05 : 0.04) - index * 0.008,
        pan: spot * 0.8,
      });
    });
  }

  /** The blade skates off bark, ice or a knot. */
  glance(force = 0.6, pan = 0) {
    const level = Math.max(0.2, Math.min(1.2, safeNumber(force, 0.6)));
    const spot = Math.max(-0.8, Math.min(0.8, safeNumber(pan, 0)));
    this._toneVoice({ dur: 0.16, type: 'triangle', f0: 210, f1: 120, gain: 0.09 * level, pan: spot });
    this._noiseVoice({ dur: 0.24, type: 'bandpass', freq: 1300, freqEnd: 480, q: 1.5, gain: 0.09 * level, pan: spot });
    this._noiseVoice({ at: 0.05, dur: 0.3, type: 'highpass', freq: 2600, freqEnd: 5000, q: 0.7, gain: 0.03 * level, pan: spot * 0.7 });
  }

  /** The bit beds in and refuses to move. */
  stuck(force = 0.7, pan = 0) {
    const level = Math.max(0.2, Math.min(1.2, safeNumber(force, 0.7)));
    const spot = Math.max(-0.8, Math.min(0.8, safeNumber(pan, 0)));
    this._toneVoice({ dur: 0.24, type: 'sine', f0: 130, f1: 58, gain: 0.13 * level, pan: spot });
    this._noiseVoice({ dur: 0.28, type: 'bandpass', freq: 700, freqEnd: 260, q: 2.2, gain: 0.08 * level, pan: spot });
    // A tight, creaking grain complaint.
    this._toneVoice({ at: 0.06, dur: 0.34, type: 'sawtooth', f0: 96, f1: 132, gain: 0.014, lp: 500, pan: spot * 0.6 });
  }

  /** The stuck bit tears free at the start of the next wind-up. */
  axePull() {
    this._noiseVoice({ dur: 0.2, type: 'bandpass', freq: 340, freqEnd: 1250, q: 1.7, gain: 0.05 });
    this._toneVoice({ dur: 0.26, type: 'sawtooth', f0: 118, f1: 74, gain: 0.016, lp: 640 });
    this._toneVoice({ at: 0.15, dur: 0.1, type: 'triangle', f0: 640, f1: 380, gain: 0.025 });
  }

  /** An undercut root shears: woody chunk plus a short splinter tail. */
  rootCut(force = 0.8) {
    const level = Math.max(0.3, Math.min(1.3, safeNumber(force, 0.8)));
    this._toneVoice({ dur: 0.26, type: 'sine', f0: 122, f1: 48, gain: 0.15 * level });
    this._noiseVoice({ dur: 0.3, type: 'bandpass', freq: 620, freqEnd: 220, q: 1.3, gain: 0.1 * level });
    this._noiseVoice({ at: 0.04, dur: 0.16, type: 'highpass', freq: 2200, freqEnd: 5200, q: 0.8, gain: 0.028 * level });
  }

  /** Frozen grain lets go with a brittle, glassy chatter. */
  iceCrack(force = 0.7, pan = 0) {
    const level = Math.max(0.3, Math.min(1.2, safeNumber(force, 0.7)));
    const spot = Math.max(-0.8, Math.min(0.8, safeNumber(pan, 0)));
    this._noiseVoice({ dur: 0.2, type: 'highpass', freq: 3200, freqEnd: 6200, q: 0.8, gain: 0.05 * level, pan: spot });
    for (let i = 0; i < 4; i += 1) {
      const f = 2200 + Math.random() * 3600;
      this._toneVoice({
        at: 0.01 + i * 0.024 + Math.random() * 0.02,
        dur: 0.14 + Math.random() * 0.1,
        type: 'sine',
        f0: f,
        f1: f * 0.95,
        gain: 0.018 - i * 0.003,
        pan: spot * 0.6 + (-0.4 + Math.random() * 0.8),
      });
    }
  }

  /** Soggy grain slaps and sheds water instead of cracking cleanly. */
  wetSlap(force = 0.7, pan = 0) {
    const level = Math.max(0.3, Math.min(1.2, safeNumber(force, 0.7)));
    const spot = Math.max(-0.8, Math.min(0.8, safeNumber(pan, 0)));
    this._noiseVoice({ dur: 0.16, type: 'bandpass', freq: 900, freqEnd: 260, q: 1.1, gain: 0.075 * level, pan: spot });
    this._toneVoice({ dur: 0.18, type: 'triangle', f0: 156, f1: 62, gain: 0.06 * level, pan: spot });
  }

  /** Challenge clock crossing a whole second: pitch climbs as time runs out. */
  countdown(seconds = 10) {
    const left = Math.max(0, Math.min(10, Math.round(safeNumber(seconds, 10))));
    const urgency = 1 - left / 10;
    const freq = 720 + urgency * 520;
    this._toneVoice({ dur: 0.055, type: 'square', f0: freq, f1: freq * 0.98, gain: 0.02 + urgency * 0.012, lp: 2600 });
    this._toneVoice({ at: 0.008, dur: 0.08, type: 'triangle', f0: freq * 2, f1: freq * 1.9, gain: 0.01 });
    if (left <= 3) {
      // A wooden block under the last three ticks, like a hand on the pile.
      this._noiseVoice({ at: 0.002, dur: 0.05, type: 'bandpass', freq: 1900, freqEnd: 900, q: 2.2, gain: 0.024 });
    }
  }

  /** The clock hits zero: a falling camp whistle and the axe going down. */
  timeUp() {
    this._toneVoice({ dur: 0.7, type: 'triangle', f0: 880, f1: 220, gain: 0.08, lp: 2200, attack: 0.01 });
    this._toneVoice({ at: 0.02, dur: 0.6, type: 'sine', f0: 660, f1: 165, gain: 0.05, attack: 0.01 });
    this._toneVoice({ at: 0.5, dur: 0.4, type: 'sine', f0: 92, f1: 40, gain: 0.14 });
    this._noiseVoice({ at: 0.5, dur: 0.3, type: 'lowpass', freq: 700, freqEnd: 180, q: 0.7, gain: 0.06 });
  }

  /** Run summary with a new personal best: warmer and bigger than runComplete(). */
  personalBest() {
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((frequency, index) => {
      this._toneVoice({
        at: index * 0.075,
        dur: 0.62,
        type: 'triangle',
        f0: frequency,
        f1: frequency * 1.002,
        gain: 0.042,
      });
    });
    this._toneVoice({ at: 0.28, dur: 1.1, type: 'sine', f0: 220, f1: 220, gain: 0.075, attack: 0.03 });
    this._noiseVoice({ at: 0.06, dur: 0.5, type: 'highpass', freq: 4200, freqEnd: 6200, q: 0.7, gain: 0.012, attack: 0.15 });
    this.coin(0.32);
  }

  /** A stone-bound Iron Crown section tears free: rubble, steel and a deep fall. */
  crownRelease() {
    this._noiseVoice({ dur: 0.9, type: 'bandpass', freq: 560, freqEnd: 120, q: 0.9, gain: 0.12, attack: 0.02 });
    this._toneVoice({ dur: 0.75, type: 'sine', f0: 88, f1: 30, gain: 0.2, attack: 0.01 });
    [1720, 2310, 3160].forEach((frequency, index) => {
      this._toneVoice({
        at: index * 0.012,
        dur: 0.5,
        type: 'triangle',
        f0: frequency,
        f1: frequency * 0.9,
        gain: 0.032 - index * 0.007,
      });
    });
    for (let i = 0; i < 7; i += 1) {
      this._noiseVoice({
        at: 0.16 + i * 0.075 + Math.random() * 0.05,
        dur: 0.06 + Math.random() * 0.08,
        type: 'bandpass',
        freq: 900 + Math.random() * 1800,
        freqEnd: 300 + Math.random() * 500,
        q: 1.4,
        gain: 0.026,
        pan: -0.65 + Math.random() * 1.3,
      });
    }
    this._toneVoice({ at: 0.26, dur: 0.7, type: 'sine', f0: 62, f1: 34, gain: 0.13, attack: 0.02 });
  }

  /** Steel wedge drawn back out of a check. `grip` 0-1 deepens the creak. */
  wedgePull(grip = 0.5) {
    const hold = Math.max(0, Math.min(1, safeNumber(grip, 0.5)));
    this._noiseVoice({ dur: 0.25 + hold * 0.16, type: 'bandpass', freq: 600, freqEnd: 1600, q: 2.8, gain: 0.07 });
    this._toneVoice({ at: 0.12, dur: 0.16, type: 'triangle', f0: 1900, f1: 1250, gain: 0.03 });
    this._toneVoice({ at: 0.2, dur: 0.2, type: 'sine', f0: 120, f1: 56, gain: 0.07 });
    // A longer, lower grain creak when the wedge is driven deep and grips hard.
    this._toneVoice({ at: 0.03, dur: 0.24 + hold * 0.26, type: 'sawtooth', f0: 180 + hold * 70, f1: 96, gain: 0.01 + hold * 0.012, lp: 520 });
  }

  /** Steel wedge driven into an open check: a bright ring and a wood creak. */
  wedge() {
    [1760, 2630].forEach((frequency, index) => {
      this._toneVoice({ dur: 0.22, type: 'triangle', f0: frequency, f1: frequency * 0.72, gain: 0.028 - index * 0.008 });
    });
    this._noiseVoice({ dur: 0.34, type: 'bandpass', freq: 360, freqEnd: 180, q: 1.4, gain: 0.1, attack: 0.01 });
  }

  /** A wedge driven fully home: bright steel over a deep seated thunk. */
  wedgeHome() {
    [1320, 1980, 2740].forEach((frequency, index) => {
      this._toneVoice({ dur: 0.3, type: 'triangle', f0: frequency, f1: frequency * 0.84, gain: 0.024 - index * 0.005 });
    });
    this._toneVoice({ dur: 0.26, type: 'sine', f0: 128, f1: 44, gain: 0.16 });
    this._noiseVoice({ dur: 0.2, type: 'lowpass', freq: 540, freqEnd: 220, q: 0.7, gain: 0.08, attack: 0.008 });
  }

  /** A riving cut: bright splintery crack, deeper under a grain lock. */
  rive(strength = 1, locked = false) {
    const level = Math.max(0.35, Math.min(1.4, safeNumber(strength, 1)));
    this._noiseVoice({
      dur: locked ? 0.5 : 0.34,
      type: 'bandpass',
      freq: locked ? 1650 : 2150,
      freqEnd: locked ? 520 : 760,
      q: 2.1,
      gain: 0.13 * level,
      attack: 0.005,
    });
    this._toneVoice({
      dur: locked ? 0.2 : 0.16,
      type: 'triangle',
      f0: locked ? 260 : 330,
      f1: locked ? 96 : 150,
      gain: 0.085 * level,
    });
    if (locked) {
      this._toneVoice({ dur: 0.46, type: 'sine', f0: 108, f1: 48, gain: 0.12, attack: 0.015 });
    }
  }

  /** A loose growth ring tearing free. */
  ringShake(loose = false) {
    this._noiseVoice({
      dur: loose ? 0.4 : 0.26,
      type: 'bandpass',
      freq: loose ? 900 : 1450,
      freqEnd: loose ? 340 : 640,
      q: 3.2,
      gain: loose ? 0.14 : 0.11,
      attack: 0.005,
    });
    [loose ? 176 : 248, loose ? 264 : 372].forEach((frequency, index) => {
      this._toneVoice({
        dur: 0.24,
        type: 'triangle',
        f0: frequency,
        f1: frequency * 0.72,
        gain: (loose ? 0.07 : 0.05) - index * 0.014,
      });
    });
    if (loose) this._toneVoice({ dur: 0.44, type: 'sine', f0: 96, f1: 42, gain: 0.11, attack: 0.015 });
  }

  /** The bound heart punches open: choked thud, short crack, woody ring. */
  corePunch() {
    this._noiseVoice({ dur: 0.3, type: 'bandpass', freq: 520, freqEnd: 180, q: 1.8, gain: 0.16, attack: 0.005 });
    this._toneVoice({ dur: 0.32, type: 'sine', f0: 120, f1: 44, gain: 0.16, attack: 0.006 });
    [188, 281, 446].forEach((frequency, index) => {
      this._toneVoice({ dur: 0.3, type: 'triangle', f0: frequency, f1: frequency * 0.78, gain: 0.045 - index * 0.011 });
    });
  }

  /** The surface thaws or dries under the axe. */
  surfaceShift(rising = true) {
    this._noiseVoice({
      dur: 0.38,
      type: rising ? 'highpass' : 'bandpass',
      freq: rising ? 1800 : 620,
      freqEnd: rising ? 900 : 240,
      q: 0.8,
      gain: rising ? 0.075 : 0.045,
      attack: 0.015,
    });
  }

  /** A punched-through rotten core: wet, hollow, unpleasant. */
  rot() {
    this._noiseVoice({ dur: 0.4, type: 'bandpass', freq: 300, freqEnd: 85, q: 1.1, gain: 0.15, attack: 0.01 });
    this._toneVoice({ dur: 0.36, type: 'sine', f0: 96, f1: 38, gain: 0.1, attack: 0.008 });
  }

  /** A long dusty collapse for a punched-through hollow heart. */
  collapse() {
    this._noiseVoice({ dur: 1, type: 'lowpass', freq: 900, freqEnd: 120, q: 0.6, gain: 0.13, attack: 0.025 });
    this._toneVoice({ dur: 0.95, type: 'sine', f0: 72, f1: 32, gain: 0.15, attack: 0.015 });
  }

  /** Boss phase-two swell: a low, dissonant heartwood bloom sting. */
  bossPhase() {
    [110, 164.81, 220].forEach((frequency, index) => {
      this._toneVoice({
        dur: 1.35,
        type: index === 2 ? 'triangle' : 'sawtooth',
        f0: frequency,
        f1: frequency * 0.86,
        gain: 0.04 - index * 0.006,
        attack: 0.03,
        lp: 900,
      });
    });
    this._noiseVoice({ dur: 0.9, type: 'bandpass', freq: 240, freqEnd: 900, q: 0.9, gain: 0.035, attack: 0.2 });
  }

  /** Two-beat heartwood pulse under the Phase II mix. */
  heartbeat() {
    [0, 0.18].forEach((offset, index) => {
      this._toneVoice({
        at: offset,
        dur: 0.2,
        type: 'sine',
        f0: index === 0 ? 68 : 54,
        f1: 36,
        gain: index === 0 ? 0.14 : 0.1,
        attack: 0.008,
      });
    });
  }

  /** The expanding shock ring itself: a low pressure wave and its shimmer. */
  shock() {
    this._toneVoice({ dur: 0.7, type: 'sine', f0: 54, f1: 32, gain: 0.16, attack: 0.01 });
    this._noiseVoice({ dur: 0.55, type: 'bandpass', freq: 180, freqEnd: 950, q: 0.9, gain: 0.055, attack: 0.02 });
    this._toneVoice({ at: 0.02, dur: 0.5, type: 'triangle', f0: 196, f1: 147, gain: 0.025, lp: 900 });
  }

  /** A boss arrives: two low drum hits and a rising swell. */
  bossIntro() {
    this._toneVoice({ dur: 0.45, type: 'sine', f0: 74, f1: 38, gain: 0.2 });
    this._toneVoice({ at: 0.3, dur: 0.6, type: 'sine', f0: 62, f1: 30, gain: 0.22 });
    this._noiseVoice({ dur: 1, type: 'bandpass', freq: 180, freqEnd: 1100, q: 1, gain: 0.05, attack: 0.15 });
    this._toneVoice({ at: 0.42, dur: 0.9, type: 'sawtooth', f0: 82.4, f1: 110, gain: 0.022, lp: 500, attack: 0.1 });
  }

  /** A boss round breaks apart: a wide low crack plus a bright debris tail. */
  bossDefeat() {
    this._toneVoice({ dur: 0.6, type: 'sine', f0: 92, f1: 30, gain: 0.22 });
    this._noiseVoice({ dur: 0.9, type: 'lowpass', freq: 1800, freqEnd: 260, q: 0.8, gain: 0.14, attack: 0.02 });
    this._noiseVoice({ at: 0.16, dur: 1.1, type: 'bandpass', freq: 1800, freqEnd: 600, q: 0.7, gain: 0.055, attack: 0.08 });
    this.coin(0.3);
  }

  /** Chapter/campaign completion fanfare. */
  chapter() {
    const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99];
    notes.forEach((frequency, index) => {
      this._toneVoice({ at: index * 0.1, dur: 1.1, type: 'triangle', f0: frequency, f1: frequency, gain: 0.05 });
    });
    this._toneVoice({ dur: 1.4, type: 'sine', f0: 65.41, f1: 65.41, gain: 0.1, attack: 0.06 });
    this._noiseVoice({ at: 0.1, dur: 1.6, type: 'highpass', freq: 3500, freqEnd: 6000, q: 0.6, gain: 0.02, attack: 0.4 });
  }

  /** Run summary cadence: shorter than chapter(), warmer than a UI chime. */
  runComplete() {
    [392, 493.88, 587.33].forEach((frequency, index) => {
      this._toneVoice({ at: index * 0.07, dur: 0.5, type: 'triangle', f0: frequency, f1: frequency, gain: 0.04 });
    });
    this._toneVoice({ at: 0.19, dur: 0.85, type: 'sine', f0: 196, f1: 196, gain: 0.07, attack: 0.02 });
    this.coin(0.03);
  }

  /**
   * Split stinger foley. The musical stinger lives in music.js; this is the
   * wooden body under it. Size 2-6 pieces changes the low end and crackle.
   */
  split(size = 2, opts = {}) {
    const pieces = Math.max(2, Math.min(6, Math.round(safeNumber(size, 2))));
    const level = 0.55 + pieces * 0.075;
    const frozen = opts.weather === 'snow';
    const wet = opts.weather === 'rain';
    const pan = Math.max(-0.7, Math.min(0.7, safeNumber(opts.pan, 0)));
    this._toneVoice({ at: 0.02, dur: 0.4, type: 'sine', f0: 118 + pieces * 2, f1: 38, gain: 0.15 * level, pan: pan * 0.5 });
    this._noiseVoice({
      at: 0.01,
      dur: 0.55,
      type: 'bandpass',
      freq: frozen ? 3000 : wet ? 1100 : 1900,
      freqEnd: wet ? 420 : 640,
      q: 0.85,
      gain: 0.1 * level,
      attack: 0.006,
      pan: pan * 0.6,
    });
    // A little shower of secondary splinter cracks.
    for (let i = 0; i < Math.min(4, pieces - 1); i += 1) {
      this._noiseVoice({
        at: 0.06 + i * 0.055 + Math.random() * 0.03,
        dur: 0.09,
        type: 'bandpass',
        freq: 2400 + Math.random() * 1800,
        freqEnd: 900,
        q: 1.6,
        gain: 0.032,
        pan: pan * 0.4 + (-0.6 + Math.random() * 1.2),
      });
    }
  }

  /** A chip or round landing on the yard. Rate-limited inside the foley. */
  fragment(item = null) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Under load, fragment foley yields more aggressively: with a dozen chips
    // landing at once the frame budget is worth more than every individual tick.
    if (now - this._lastFragmentSound < (this._perfTier ? 0.09 : 0.045)) return;
    this._lastFragmentSound = now;
    const mass = Math.max(0.05, Math.min(2.2, safeNumber(item?.mass, 0.2)));
    const splinter = item?.kind === 'splinter';
    const level = splinter ? 0.014 + mass * 0.008 : 0.03 + mass * 0.045;
    const pan = -0.8 + Math.random() * 1.6;
    this._toneVoice({
      dur: splinter ? 0.05 : 0.12,
      type: 'triangle',
      f0: (splinter ? 620 : 250) + Math.random() * 260,
      f1: splinter ? 380 : 110,
      gain: level,
      pan,
    });
    this._noiseVoice({
      dur: splinter ? 0.04 : 0.08,
      type: 'lowpass',
      freq: splinter ? 3000 : 1100,
      freqEnd: 400,
      q: 0.6,
      gain: level * 0.6,
      pan,
    });
  }

  /**
   * Impact by wood species and hazard. The old (force, speed, weather) call
   * signature still works; opts adds { wood, hazard, hollow, boss, glance, stuck }.
   */
  impact(force = 0.7, speed = 1, weather = 'clear', opts = {}) {
    const power = Math.min(1.25, 0.42 + safeNumber(force, 0.7) * 0.72);
    const frozen = weather === 'snow';
    const wet = weather === 'rain';
    // Aim offset becomes stereo position: a strike off the left cheek sits left
    // of the player, which makes the yard feel wider on headphones.
    const pan = Math.max(-0.7, Math.min(0.7, safeNumber(opts.pan, 0)));
    let profile = WOOD_PROFILES[String(opts.wood || '')] || WOOD_PROFILES.pine;
    if (opts.hollow) profile = WOOD_PROFILES.rottenElm;
    if (frozen) profile = { ...profile, ...FROZEN_PROFILE, thump: profile.thump * 0.9 };
    if (wet) profile = { ...profile, lp: profile.lp * 0.65, hp: profile.hp * 0.7, thump: profile.thump * 0.92 };
    if (opts.boss) profile = { ...profile, thump: profile.thump * 1.08, ring: (profile.ring || 0) + 0.12 };

    // Crack / splinter noise.
    this._noiseVoice({
      dur: 0.42,
      type: 'bandpass',
      freq: frozen ? 2600 : wet ? 760 : profile.hp,
      freqEnd: frozen ? 1800 : wet ? 500 : profile.lpEnd,
      q: 0.9,
      gain: (frozen ? 0.15 : wet ? 0.09 : 0.12) * power,
      attack: 0.004,
      pan: pan * 0.65,
    });
    this._noiseVoice({
      at: 0.012,
      dur: 0.16,
      type: 'highpass',
      freq: frozen ? 2400 : profile.hp * 0.9,
      freqEnd: profile.lp * 0.6,
      q: 0.7,
      gain: 0.07 * power * (profile.crackle || 1),
      attack: 0.003,
      pan: pan * 0.8,
    });

    // Low body thump.
    this._toneVoice({
      dur: 0.28,
      type: 'sine',
      f0: profile.f0 + safeNumber(speed, 1) * 10,
      f1: profile.f1,
      gain: (0.3 * power * (profile.thump || 0.35)) / 0.35,
      attack: 0.004,
      pan: pan * 0.35,
    });

    // A little wood "pop" in the midrange.
    if (!profile.damp) {
      this._toneVoice({
        dur: 0.14,
        type: 'triangle',
        f0: frozen ? 340 : profile.pop,
        f1: frozen ? 190 : profile.popEnd,
        gain: 0.09 * power,
        attack: 0.003,
        pan: pan * 0.7,
      });
    }

    // Dense/iron woods ring; hollow wood rings downward into the cavity.
    if (profile.ring) {
      const ringFreq = profile.damp ? 240 : 1700 + profile.ring * 900;
      this._toneVoice({
        at: 0.01,
        dur: profile.damp ? 0.3 : 0.5,
        type: 'sine',
        f0: ringFreq,
        f1: ringFreq * (profile.damp ? 0.6 : 0.94),
        gain: 0.04 * profile.ring,
        pan: pan * 0.75,
      });
      if (!profile.damp) {
        this._toneVoice({
          at: 0.015,
          dur: 0.38,
          type: 'triangle',
          f0: ringFreq * 1.72,
          f1: ringFreq * 1.6,
          gain: 0.022 * profile.ring,
          pan: pan * 0.75,
        });
      }
    }

    if (opts.hazard) this.hazard(opts.hazard, pan);
    if (opts.glance) this.glance(power * 0.8, pan);
    if (opts.stuck) this.stuck(power, pan);
    // Weather changes the material, not just the filter: frost chatters apart,
    // soaked grain gives a wet slap underneath the thump.
    if (frozen) this.iceCrack(power, pan);
    else if (wet) this.wetSlap(power, pan);
  }

  /** Rolling thunder for the rain bed (sparse, weather-set). */
  thunder(distance = 0.7) {
    const level = Math.max(0.2, Math.min(1, 1.1 - safeNumber(distance, 0.7)));
    // The noise bed is 2 s; split the tail so a long roll never stops early.
    this._noiseVoice({ dur: 1.9, type: 'lowpass', freq: 420, freqEnd: 70, q: 0.7, gain: 0.16 * level, attack: 0.2 });
    this._noiseVoice({ at: 0.7, dur: 1.75, type: 'lowpass', freq: 300, freqEnd: 55, q: 0.6, gain: 0.11 * level, attack: 0.25 });
    this._noiseVoice({ at: 0.12, dur: 1.2, type: 'lowpass', freq: 900, freqEnd: 120, q: 0.6, gain: 0.07 * level, attack: 0.1 });
  }

  /* ------------------------------------------------------------------ *
   *  Assets v2 — yard locomotion and tree foley
   * ------------------------------------------------------------------ */

  /** Surface-aware footstep: a soft body thump plus a short surface scuff. */
  footstep(surface = 'grass', force = 0.7) {
    const level = Math.max(0.2, Math.min(1, safeNumber(force, 0.7)));
    const grass = surface === 'grass';
    const mulch = surface === 'mulch';
    this._toneVoice({
      dur: 0.09,
      type: 'sine',
      f0: grass ? 92 : mulch ? 78 : 68,
      f1: 44,
      gain: 0.05 * level,
      attack: 0.003,
      pan: (Math.random() - 0.5) * 0.35,
    });
    this._noiseVoice({
      dur: grass ? 0.1 : 0.075,
      type: 'bandpass',
      freq: grass ? 1750 : mulch ? 1150 : 720,
      freqEnd: grass ? 520 : mulch ? 430 : 300,
      q: 0.7,
      gain: (grass ? 0.03 : mulch ? 0.038 : 0.028) * level,
      attack: 0.002,
      pan: (Math.random() - 0.5) * 0.4,
    });
  }

  /** A deep trunk thunk when the axe bites a standing tree. */
  treeHit(species = 'oak', force = 0.8) {
    const level = Math.max(0.25, Math.min(1.2, safeNumber(force, 0.8)));
    const heavy = species === 'oak' || species === 'walnut' || species === 'maple';
    this._toneVoice({
      dur: 0.3,
      type: 'sine',
      f0: heavy ? 96 : 128,
      f1: heavy ? 38 : 52,
      gain: 0.22 * level,
      attack: 0.003,
    });
    this._noiseVoice({
      dur: 0.24,
      type: 'bandpass',
      freq: heavy ? 780 : 1100,
      freqEnd: 260,
      q: 0.8,
      gain: 0.075 * level,
      attack: 0.002,
    });
  }

  /** The long, dry crack of a hinge before the tree commits to the fall. */
  treeCreak() {
    this._noiseVoice({ dur: 0.55, type: 'bandpass', freq: 540, freqEnd: 190, q: 3.2, gain: 0.065, attack: 0.05 });
    this._toneVoice({ dur: 0.5, type: 'sawtooth', f0: 132, f1: 74, gain: 0.022, attack: 0.04, lp: 700 });
  }

  /** A heavy ground-shaking crash when the crown lands. */
  treeFall() {
    this._toneVoice({ dur: 0.65, type: 'sine', f0: 74, f1: 28, gain: 0.3, attack: 0.004 });
    this._noiseVoice({ dur: 0.75, type: 'lowpass', freq: 680, freqEnd: 80, q: 0.7, gain: 0.15, attack: 0.008 });
    this._noiseVoice({ at: 0.12, dur: 0.5, type: 'bandpass', freq: 1900, freqEnd: 500, q: 0.8, gain: 0.06, attack: 0.01 });
    for (let i = 0; i < 3; i += 1) {
      this._noiseVoice({ at: 0.2 + i * 0.1, dur: 0.16, type: 'bandpass', freq: 1500 + i * 300, freqEnd: 600, q: 1.2, gain: 0.03, pan: -0.4 + i * 0.4 });
    }
  }
}

export { WOOD_PROFILES, midiToFreq };
