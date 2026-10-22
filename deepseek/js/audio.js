/**
 * Tiny synthesized foley engine. No samples, no network, no console noise:
 * filtered noise for the whoosh and crack, plus a low sine thump.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noise = null;
    this.ambient = null;
    this.ambientState = { weather: 'clear', night: 0, wind: 0 };
  }

  ensure() {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        this.noise = this._makeNoise();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  _makeNoise() {
    const length = this.ctx.sampleRate * 2;
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

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    } else if (enabled && this.ctx) {
      this.master.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.03);
    }
  }

  /** A continuous wind/rain bed under the foley. Starts on the first gesture. */
  setAmbient({ weather = 'clear', night = 0, wind = 0 } = {}) {
    this.ambientState = { weather, night, wind };
    if (!this.enabled || !this.ctx || !this.noise) return;
    if (!this.ambient) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 620;
      filter.Q.value = 0.35;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.ambient = { src, filter, gain };
    }
    const a = this.ambient;
    const now = this.ctx.currentTime;
    const rain = weather === 'rain' ? 1 : 0;
    const snow = weather === 'snow' ? 0.35 : 0;
    const target = (0.012 + (this.ambientState.wind || 0) * 0.012 + rain * 0.04 + snow * 0.012) * (1 - night * 0.35);
    a.gain.gain.setTargetAtTime(Math.max(0.0001, target), now, 0.6);
    const freq = rain ? 1250 : snow ? 900 : 540 - night * 150;
    a.filter.frequency.setTargetAtTime(freq, now, 0.7);
  }

  get ambientLevel() {
    return this.ambient ? Number(this.ambient.gain.gain.value.toFixed(4)) : 0;
  }

  whoosh(intensity = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(320, now);
    band.frequency.exponentialRampToValueAtTime(1200 + intensity * 500, now + 0.38);
    band.frequency.exponentialRampToValueAtTime(420, now + 0.75);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09 * intensity, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.06 * intensity, now + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    src.connect(band).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.85);
  }

  tick(strength = 0.4) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1450, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.025 * strength, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  chime(intensity = 0.7) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [659.25, 987.77, 1318.51];
    notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      const start = now + index * 0.055;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045 * intensity, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.6);
    });
  }

  levelUp() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      const start = now + index * 0.085;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.055, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.74);
    });
  }

  /** Steel wedge driven into an open check: a bright ring and a wood creak. */
  wedge() {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    [1760, 2630].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, now);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.72, now + 0.18);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035 - index * 0.01, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.24);
    });
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(360, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.3);
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.36);
  }

  /**
   * A riving cut: a bright, splintery crack that runs up the check. The second
   * hit on the same line (the grain lock) gets a deeper root-note under it.
   */
  rive(strength = 1, locked = false) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    const level = Math.max(0.35, Math.min(1.4, strength));
    // A narrow high crack: long splinter, not a thud.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2.1;
    band.frequency.setValueAtTime(locked ? 1650 : 2150, now);
    band.frequency.exponentialRampToValueAtTime(locked ? 520 : 760, now + (locked ? 0.44 : 0.3));
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16 * level, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (locked ? 0.5 : 0.34));
    src.connect(band).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.54);
    // A woody mid pop and, for a lock, a low splitting groan.
    const pop = ctx.createOscillator();
    pop.type = 'triangle';
    pop.frequency.setValueAtTime(locked ? 260 : 330, now);
    pop.frequency.exponentialRampToValueAtTime(locked ? 96 : 150, now + 0.11);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.0001, now);
    pg.gain.exponentialRampToValueAtTime(0.1 * level, now + 0.005);
    pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    pop.connect(pg).connect(this.master);
    pop.start(now);
    pop.stop(now + 0.18);
    if (locked) {
      const low = ctx.createOscillator();
      low.type = 'sine';
      low.frequency.setValueAtTime(108, now);
      low.frequency.exponentialRampToValueAtTime(48, now + 0.42);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0.0001, now);
      lg.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      lg.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
      low.connect(lg).connect(this.master);
      low.start(now);
      low.stop(now + 0.5);
    }
  }

  /** The surface thaws or dries under the axe: an ice crack or a wet sigh. */
  surfaceShift(rising = true) {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = rising ? 'highpass' : 'bandpass';
    filter.frequency.setValueAtTime(rising ? 1800 : 620, now);
    filter.frequency.exponentialRampToValueAtTime(rising ? 900 : 240, now + 0.28);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(rising ? 0.09 : 0.055, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.4);
  }

  /** A punched-through rotten core: wet, hollow, and a little unpleasant. */
  rot() {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.1;
    band.frequency.setValueAtTime(300, now);
    band.frequency.exponentialRampToValueAtTime(85, now + 0.32);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    src.connect(band).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.42);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(96, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  /** Boss phase-two swell: a low, dissonant heartwood bloom sting. */
  bossPhase() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    [110, 164.81, 220].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = index === 2 ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(frequency, now);
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.18, now + 0.28);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.82, now + 1.1);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(380, now);
      filter.frequency.exponentialRampToValueAtTime(1200, now + 0.5);
      filter.frequency.exponentialRampToValueAtTime(300, now + 1.35);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05 - index * 0.008, now + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + 1.4);
    });
  }

  /** A wedge driven fully home: bright steel over a deep seated thunk. */
  wedgeHome() {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    [1320, 1980, 2740].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, now);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.84, now + 0.26);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.028 - index * 0.006, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.32);
    });
    const thunk = ctx.createOscillator();
    thunk.type = 'sine';
    thunk.frequency.setValueAtTime(128, now);
    thunk.frequency.exponentialRampToValueAtTime(44, now + 0.2);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, now);
    tg.gain.exponentialRampToValueAtTime(0.2, now + 0.005);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    thunk.connect(tg).connect(this.master);
    thunk.start(now);
    thunk.stop(now + 0.28);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 540;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(0.1, now + 0.012);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    src.connect(filter).connect(ng).connect(this.master);
    src.start(now);
    src.stop(now + 0.22);
  }

  /** A long, dusty collapse for a punched-through hollow heart. */
  collapse() {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'lowpass';
    band.frequency.setValueAtTime(900, now);
    band.frequency.exponentialRampToValueAtTime(120, now + 0.9);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
    src.connect(band).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 1.05);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(72, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.75);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.95);
  }

  /** A two-beat heartwood pulse under the Phase II mix. */
  heartbeat() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.18].forEach((offset, index) => {
      const start = now + offset;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(index === 0 ? 68 : 54, start);
      osc.frequency.exponentialRampToValueAtTime(36, start + 0.16);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.16 : 0.11, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.22);
    });
  }

  impact(force = 0.7, speed = 1, weather = 'clear') {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    const power = Math.min(1.2, 0.45 + force * 0.7);
    const frozen = weather === 'snow';
    const wet = weather === 'rain';

    // Crack / splinter noise.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = frozen ? 1150 : wet ? 520 : 700;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(frozen ? 6200 : 5200, now);
    low.frequency.exponentialRampToValueAtTime(frozen ? 1700 : wet ? 900 : 1100, now + 0.33);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.34 * power, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.08 * power, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    src.connect(high).connect(low).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.46);

    // Low body thump.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105 + speed * 15, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.42 * power, now + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.28);

    // A little wood "pop" in the midrange.
    const woody = ctx.createOscillator();
    woody.type = 'triangle';
    woody.frequency.setValueAtTime(frozen ? 310 : wet ? 185 : 230, now);
    woody.frequency.exponentialRampToValueAtTime(wet ? 105 : 140, now + 0.09);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, now);
    wg.gain.exponentialRampToValueAtTime(0.12 * power, now + 0.005);
    wg.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    woody.connect(wg).connect(this.master);
    woody.start(now);
    woody.stop(now + 0.15);
  }
}
