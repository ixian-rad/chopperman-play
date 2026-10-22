// Tiny procedural sound effects (Web Audio). The AudioContext is only created after a
// user gesture, so automated/programmatic use never triggers autoplay warnings.
export class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.lastKnock = 0;
    const unlock = () => {
      this.init();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.0;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.8 : 0;
  }

  get ok() {
    return this.ctx && this.enabled && this.ctx.state === 'running';
  }

  _noise(t0, dur, filterType, freq, q, gain, freqEnd) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  _tone(t0, dur, f0, f1, gain, type = 'sine') {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  whoosh(force) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.05;
    this._noise(t, 0.4, 'bandpass', 350, 1.2, 0.12 + 0.25 * force, 1600);
  }

  thunk(strength, wood = true) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const s = Math.max(0.15, strength);
    this._tone(t, 0.22, wood ? 150 : 110, 60, 0.6 * s);
    this._noise(t, 0.09, 'lowpass', 1400, 0.7, 0.5 * s);
    this._tone(t, 0.06, 520, 300, 0.15 * s, 'triangle');
  }

  crack(ratio, frozen = 0) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.thunk(0.9, true);
    // Frozen wood "pings" apart: brighter, sharper crack.
    this._noise(t, 0.16, 'bandpass', 2600 + 1800 * frozen, 0.9, 0.7, 900);
    this._noise(t + 0.02, 0.3, 'highpass', 1800, 0.5, 0.25 * Math.min(2, ratio));
    this._tone(t, 0.12, 380 + 300 * frozen, 180, 0.3, 'triangle');
  }

  glance() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.thunk(0.35, true);
    this._noise(t + 0.01, 0.22, 'bandpass', 1200, 1.5, 0.35, 500);
  }

  clang() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    for (const [f, g] of [[2150, 0.25], [3370, 0.16], [5120, 0.1], [1240, 0.18]]) this._tone(t, 0.6, f, f * 0.98, g, 'sine');
    this._noise(t, 0.05, 'highpass', 4000, 0.7, 0.5);
  }

  // Ice glaze shattering: a bright tinkle of high partials over a crunchy noise burst.
  iceShatter() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.25, 'highpass', 3500, 0.8, 0.45);
    for (let i = 0; i < 7; i++) {
      const f = 2400 + Math.random() * 4200;
      this._tone(t + 0.01 + i * 0.025 + Math.random() * 0.02, 0.18, f, f * 0.97, 0.06, 'sine');
    }
  }

  // Steel on stone: a dull, gritty clank (lower and shorter than the nail's ring).
  stone() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    for (const [f, g] of [[1450, 0.22], [2210, 0.13], [880, 0.2]]) this._tone(t, 0.28, f, f * 0.94, g, 'triangle');
    this._noise(t, 0.12, 'bandpass', 2600, 0.6, 0.7, 1200);
  }

  // Punky, rotten wood: a soft, low, damp thud.
  punk() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.3, 110, 50, 0.55);
    this._noise(t, 0.2, 'lowpass', 600, 0.6, 0.45, 200);
  }

  // Boss round arrives: two low drum hits and a rising swell.
  bossIntro() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.45, 70, 38, 0.8);
    this._tone(t + 0.28, 0.6, 62, 32, 0.9);
    this._noise(t, 0.9, 'bandpass', 200, 1.0, 0.18, 900);
  }

  sharpen() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._noise(t + i * 0.18, 0.14, 'bandpass', 5200, 3, 0.18, 3200);
  }

  ding(n = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const f = 660 * Math.pow(1.06, Math.min(12, n));
    this._tone(t, 0.25, f, f, 0.12, 'sine');
    this._tone(t + 0.06, 0.3, f * 1.5, f * 1.5, 0.08, 'sine');
  }

  levelUp() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this._tone(t + i * 0.09, 0.35, f, f, 0.14, 'triangle'));
  }

  tick() {
    if (!this.ok) return;
    this._tone(this.ctx.currentTime, 0.03, 1800, 1700, 0.04, 'square');
  }

  thunder(dist = 0.7) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noise(t, 2.5 + dist, 'lowpass', 400 - 200 * dist, 0.8, 0.9 * (1.2 - dist), 60);
    this._noise(t + 0.1, 1.2, 'lowpass', 900 - 400 * dist, 0.6, 0.4 * (1.2 - dist), 120);
  }

  // Looping rain hiss and wind roar, faded by the weather.
  ambience(rain, wind) {
    if (!this.ok) return;
    const c = this.ctx;
    if (!this.amb) {
      const mk = (type, freq, q) => {
        const src = c.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const f = c.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = c.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(this.master);
        src.start();
        return { f, g };
      };
      this.amb = { rain: mk('highpass', 2500, 0.3), wind: mk('lowpass', 400, 0.7) };
    }
    const t = c.currentTime;
    this.amb.rain.g.gain.setTargetAtTime(0.12 * rain, t, 0.5);
    this.amb.wind.g.gain.setTargetAtTime(Math.min(0.25, 0.018 * wind), t, 0.5);
    this.amb.wind.f.frequency.setTargetAtTime(250 + 40 * wind, t, 0.5);
  }

  knock(vol) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this.lastKnock < 0.03) return;
    this.lastKnock = now;
    const v = Math.min(1, vol);
    this._tone(now, 0.1, 170 + Math.random() * 60, 90, 0.35 * v);
    this._noise(now, 0.05, 'lowpass', 900, 0.8, 0.25 * v);
  }
}
