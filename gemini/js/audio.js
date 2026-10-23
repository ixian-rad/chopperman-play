/**
 * Procedural Web Audio synthesizer for woodchopping & RPG sound effects.
 * Zero external audio assets needed; failsafe in headless or restricted browser contexts.
 */
export class SoundEffects {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  _ensureContext() {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  playWhoosh(forceRatio = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const duration = 0.24;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(170, now);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(200, 540 * forceRatio),
        now + duration * 0.7
      );
      filter.Q.value = 2.2;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(
        0.18 * Math.min(1.4, forceRatio),
        now + duration * 0.5
      );
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(now);
      noise.stop(now + duration);
    } catch {
      // Ignore audio errors in headless environments
    }
  }

  playWoodSplit(forceRatio = 1.0, isFrozen = false) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;

      // 1. Sharp fiber crack (higher frequency if frozen wood)
      const crackDur = isFrozen ? 0.14 : 0.17;
      const bufLen = Math.floor(ctx.sampleRate * crackDur);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const out = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        const env = Math.pow(1 - i / bufLen, isFrozen ? 1.8 : 2.2);
        out[i] = (Math.random() * 2 - 1) * env;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buf;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(isFrozen ? 1650 : 1180, now);
      bandpass.Q.value = isFrozen ? 2.0 : 1.4;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.46 * Math.min(1.5, forceRatio), now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + crackDur);

      noise.connect(bandpass);
      bandpass.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(now);

      // 2. Deep chopping block thump
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(isFrozen ? 190 : 155, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);

      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.42 * Math.min(1.4, forceRatio), now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(thumpGain);
      thumpGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);
    } catch {
      // Ignore audio errors
    }
  }

  playWoodWedge(forceRatio = 0.8) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.12);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.36 * Math.min(1.3, forceRatio), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);
    } catch {
      // Ignore audio errors
    }
  }

  playSparkClang(intensity = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const freqs = [1840, 2760, 4120];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        osc.type = idx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(f, now);
        osc.frequency.exponentialRampToValueAtTime(f * 0.92, now + 0.28);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime((0.12 / (idx + 1)) * intensity, now);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.29);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
      });
    } catch {
      // Ignore audio errors
    }
  }

  playWoodKnock(intensity = 0.5) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const baseFreq = 220 + Math.random() * 140;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, now + 0.07);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(Math.min(0.18, intensity * 0.14), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {
      // Ignore audio errors
    }
  }

  playLevelUp() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now + i * 0.07);
        gain.gain.linearRampToValueAtTime(0.12, now + i * 0.07 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.26);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.28);
      });
    } catch {
      // Ignore audio errors
    }
  }

  playUpgrade() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.14);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.17);
    } catch {
      // Ignore audio errors
    }
  }
}
