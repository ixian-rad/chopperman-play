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

  playWhetstoneHone() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const dur = 0.22;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400, now);
      bp.frequency.exponentialRampToValueAtTime(4800, now + dur);
      bp.Q.value = 5.5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noise.connect(bp);
      bp.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + dur);

      // High metallic ring tail
      const ring = ctx.createOscillator();
      ring.type = 'sine';
      ring.frequency.setValueAtTime(3120, now + 0.04);
      ring.frequency.exponentialRampToValueAtTime(3640, now + 0.26);
      const rGain = ctx.createGain();
      rGain.gain.setValueAtTime(0.07, now + 0.04);
      rGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.28);
      ring.connect(rGain);
      rGain.connect(ctx.destination);
      ring.start(now + 0.04);
      ring.stop(now + 0.29);
    } catch {
      // Ignore audio errors
    }
  }

  playBossSplit() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.45, false);
      const now = ctx.currentTime;
      const sub = ctx.createOscillator();
      sub.type = 'sawtooth';
      sub.frequency.setValueAtTime(92, now);
      sub.frequency.exponentialRampToValueAtTime(28, now + 0.36);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      sub.connect(gain);
      gain.connect(ctx.destination);
      sub.start(now);
      sub.stop(now + 0.39);
    } catch {
      // Ignore audio errors
    }
  }

  playWedgePlant() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Crisp steel set-tap into wood kerf
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1420, now);
      osc.frequency.exponentialRampToValueAtTime(620, now + 0.09);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    } catch {
      // Ignore audio errors
    }
  }

  playWedgeHammer(depthStage = 1) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 1. Ringing forged-steel sledge/maul anvil ping (pitch rises as wedge tightens!)
      const pitchShift = 1.0 + Math.min(3, depthStage) * 0.08;
      const freqs = [2120 * pitchShift, 3180 * pitchShift, 4640 * pitchShift];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        osc.type = idx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(f, now);
        osc.frequency.exponentialRampToValueAtTime(f * 0.96, now + 0.34);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.16 / (idx + 1), now);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.36);
      });

      // 2. Deep internal wood fiber groan under wedge tension
      this.playFiberCreak(1.1);
    } catch {
      // Ignore audio errors
    }
  }

  playFiberCreak(intensity = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(115, now);
      osc.frequency.linearRampToValueAtTime(78, now + 0.07);
      osc.frequency.linearRampToValueAtTime(142, now + 0.14);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14 * Math.min(1.5, intensity), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.17);
    } catch {
      // Ignore audio errors
    }
  }

  playBranchLop() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.05, false);
      this.playFiberCreak(0.9);
    } catch {
      // Ignore audio errors
    }
  }

  playRockRicochet() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playSparkClang(1.35);
      const now = ctx.currentTime;
      // Heavy granite crunch noise burst
      const dur = 0.16;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(860, now);
      bp.Q.value = 1.8;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noise.connect(bp);
      bp.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + dur);
    } catch {
      // Ignore audio errors
    }
  }

  playLogFlip() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Short loft whoosh followed by solid inverted wood thump on the block
      this.playWhoosh(0.65);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(168, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.22);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.setValueAtTime(0.32, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + 0.08);
      osc.stop(now + 0.24);
    } catch {
      // Ignore audio errors
    }
  }

  playTandemCrackWalk() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWedgeHammer(3);
      this.playWoodSplit(1.25, true);
    } catch {
      // Ignore audio errors
    }
  }

  playKindlingShatter() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.3, false);
      // Multi-stick kindling clatter cascade
      [0.05, 0.11, 0.17].forEach((delay, idx) => {
        setTimeout(() => {
          this.playWoodKnock(0.75 - idx * 0.15);
        }, delay * 1000);
      });
    } catch {
      // Ignore audio errors
    }
  }

  playSapSizzle() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const dur = 0.25;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.4);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(3400, now);
      bp.frequency.exponentialRampToValueAtTime(1600, now + dur);
      bp.Q.value = 2.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      src.connect(bp);
      bp.connect(gain);
      gain.connect(ctx.destination);
      src.start(now);
      src.stop(now + dur);
    } catch {
      // Ignore audio errors
    }
  }

  playBurlShear() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playBranchLop();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.15);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.17);
    } catch {
      // Ignore audio errors
    }
  }

  playBonfireStoke() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 1. Warm low fire whoosh
      const dur = 0.34;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, now);
      lp.frequency.exponentialRampToValueAtTime(980, now + dur * 0.6);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noise.connect(lp);
      lp.connect(g);
      g.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + dur);

      // 2. Crisp ember crackle pops
      [0.06, 0.14, 0.22].forEach((offset) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1400 + Math.random() * 900, now + offset);
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0.05, now + offset);
        cg.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.025);
        osc.connect(cg);
        cg.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.03);
      });
    } catch {
      // Ignore audio errors
    }
  }

  playThunderclap(intensity = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 1. Sharp electrostatic lightning crack
      const crackDur = 0.18;
      const crackLen = Math.floor(ctx.sampleRate * crackDur);
      const crackBuf = ctx.createBuffer(1, crackLen, ctx.sampleRate);
      const crackData = crackBuf.getChannelData(0);
      for (let i = 0; i < crackLen; i++) {
        crackData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / crackLen, 1.8);
      }
      const crackSrc = ctx.createBufferSource();
      crackSrc.buffer = crackBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.setValueAtTime(1450, now);
      hp.Q.value = 1.1;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.28 * intensity, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + crackDur);
      crackSrc.connect(hp);
      hp.connect(cg);
      cg.connect(ctx.destination);
      crackSrc.start(now);
      crackSrc.stop(now + crackDur);

      // 2. Deep rolling suburban thunderstorm rumble
      const rumbleDur = 0.75;
      const rumbleLen = Math.floor(ctx.sampleRate * rumbleDur);
      const rumbleBuf = ctx.createBuffer(1, rumbleLen, ctx.sampleRate);
      const rumbleData = rumbleBuf.getChannelData(0);
      for (let i = 0; i < rumbleLen; i++) {
        const t = i / rumbleLen;
        const env = Math.sin(t * Math.PI) * (0.7 + 0.3 * Math.sin(t * 28));
        rumbleData[i] = (Math.random() * 2 - 1) * env;
      }
      const rumbleSrc = ctx.createBufferSource();
      rumbleSrc.buffer = rumbleBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(145, now + 0.04);
      lp.frequency.exponentialRampToValueAtTime(52, now + rumbleDur);
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.34 * intensity, now + 0.04);
      rg.gain.exponentialRampToValueAtTime(0.001, now + 0.04 + rumbleDur);
      rumbleSrc.connect(lp);
      lp.connect(rg);
      rg.connect(ctx.destination);
      rumbleSrc.start(now + 0.04);
      rumbleSrc.stop(now + 0.04 + rumbleDur);
    } catch {
      // Ignore audio errors
    }
  }

  playPeaveyHeave() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 1. Steel cant-hook dog-tooth bite clink into bark
      const clink = ctx.createOscillator();
      clink.type = 'triangle';
      clink.frequency.setValueAtTime(1680, now);
      clink.frequency.exponentialRampToValueAtTime(740, now + 0.09);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.2, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      clink.connect(cg);
      cg.connect(ctx.destination);
      clink.start(now);
      clink.stop(now + 0.11);

      // 2. Ash-handle lever creak + heavy log seat thud on the oak block
      this.playFiberCreak(0.95);
      const thud = ctx.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(142, now + 0.1);
      thud.frequency.exponentialRampToValueAtTime(44, now + 0.25);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.001, now);
      tg.gain.setValueAtTime(0.34, now + 0.1);
      tg.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      thud.connect(tg);
      tg.connect(ctx.destination);
      thud.start(now + 0.1);
      thud.stop(now + 0.27);
    } catch {
      // Ignore audio errors
    }
  }

  playLightningFissureShatter() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.38, true);
      this.playSapSizzle();
    } catch {
      // Ignore audio errors
    }
  }

  playGeodeCrystalShatter() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.25, true);
      const now = ctx.currentTime;
      const crystalNotes = [1567.98, 2093.0, 2637.02, 3135.96];
      crystalNotes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const t0 = now + i * 0.032;
        osc.frequency.setValueAtTime(freq, t0);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.04, t0 + 0.34);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.09 / (1 + i * 0.25), t0);
        gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.36);
      });
    } catch {
      // Ignore audio errors
    }
  }

  playContractComplete() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 1. Crisp twine-tie & roadside cash-box clink
      const clink = ctx.createOscillator();
      clink.type = 'triangle';
      clink.frequency.setValueAtTime(2240, now);
      clink.frequency.exponentialRampToValueAtTime(3480, now + 0.09);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.14, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      clink.connect(cg);
      cg.connect(ctx.destination);
      clink.start(now);
      clink.stop(now + 0.11);

      // 2. Cheerful 3-note contract payout chime
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        const t0 = now + 0.05 + idx * 0.055;
        osc.frequency.setValueAtTime(f, t0);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.11, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.25);
      });
    } catch {
      // Ignore audio errors
    }
  }

  playCritterScatter() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Quick bluejay chirp + wing flutter
      [0, 0.07].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const t0 = now + offset;
        osc.frequency.setValueAtTime(i === 0 ? 2680 : 3240, t0);
        osc.frequency.exponentialRampToValueAtTime(1920, t0 + 0.055);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.055, t0);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.06);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.065);
      });
    } catch {
      // Ignore audio errors
    }
  }

  playEmberTemperIgnite() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playBonfireStoke();
      this.playWhetstoneHone();
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Subtle procedural backyard weather, bonfire crackle & time-of-day soundscape pulse.
   * Only runs when AudioContext is already unlocked and running.
   */
  tickAmbientSoundscape(dt, weather = 'sun', timeOfDay = 17.0, bonfireLevel = 1) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    this._ambientTimer = (this._ambientTimer || 0) + dt;
    if (this._ambientTimer < 1.8) return;
    this._ambientTimer = 0;

    try {
      const now = this.ctx.currentTime;
      const isNight = timeOfDay < 5.8 || timeOfDay > 19.2;

      if (bonfireLevel >= 2 && weather !== 'rain') {
        // Subtle backyard firepit ember pop
        const popOsc = this.ctx.createOscillator();
        popOsc.type = 'triangle';
        popOsc.frequency.setValueAtTime(1150 + Math.random() * 600, now + 0.03);
        const pg = this.ctx.createGain();
        pg.gain.setValueAtTime(0.014 * Math.min(2, bonfireLevel * 0.45), now + 0.03);
        pg.gain.exponentialRampToValueAtTime(0.0005, now + 0.06);
        popOsc.connect(pg);
        pg.connect(this.ctx.destination);
        popOsc.start(now + 0.03);
        popOsc.stop(now + 0.065);
      }

      if (weather === 'rain') {
        // Gentle rain patter pulse
        const dur = 0.35;
        const len = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1900, now);
        bp.Q.value = 1.2;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.018, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.ctx.destination);
        src.start(now);
        src.stop(now + dur);
      } else if (isNight && (weather === 'sun' || weather === 'fog')) {
        // Subtle suburban NJ evening cricket double-chirp
        [0, 0.09].forEach((offset) => {
          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(4180, now + offset);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.001, now + offset);
          g.gain.linearRampToValueAtTime(0.012, now + offset + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0005, now + offset + 0.065);
          osc.connect(g);
          g.connect(this.ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.07);
        });
      }
    } catch {
      // Ignore audio errors
    }
  }
}
