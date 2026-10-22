/**
 * Original procedural wood-chopping soundtrack for American Split.
 *
 * The band is synthesized live in the browser (no samples, no network assets):
 * - a Karplus-Strong plucked-string voice that reads as banjo / acoustic guitar
 * - a short upright-bass voice (triangle + sine body, soft finger thump)
 * - stomp, clap and lumberjack wood-block percussion
 *
 * A look-ahead scheduler walks a 16th-note grid using AudioContext.currentTime,
 * so tempo changes and combo intensity never drift with setInterval.
 *
 * Scenes: 'menu' (sparse front-porch theme), 'gameplay' (full band, more layers
 * at high combo and in boss phase II), plus short 'stinger' flourishes on splits.
 */

import { midiToFreq } from './audio.js';

/** D minor / Bb / F / C — a plain, rugged front-porch progression. */
const CHORDS = [
  { name: 'Dm', banjo: [62, 65, 69], bass: 38, fifth: 45, melody: [62, 65, 69, 74] },
  { name: 'Bb', banjo: [58, 62, 65], bass: 34, fifth: 41, melody: [58, 62, 65, 70] },
  { name: 'F', banjo: [57, 60, 65], bass: 29, fifth: 36, melody: [57, 60, 65, 69] },
  { name: 'C', banjo: [55, 60, 64], bass: 36, fifth: 43, melody: [55, 60, 64, 67] },
];

/** Bars 4-7 answer the opening phrase and lean on the relative minor. */
const CHORDS_B = [
  { name: 'Dm', banjo: [62, 65, 69], bass: 38, fifth: 45, melody: [62, 66, 69, 74] },
  { name: 'C', banjo: [55, 60, 64], bass: 36, fifth: 43, melody: [55, 60, 64, 67] },
  { name: 'Bb', banjo: [58, 62, 65], bass: 34, fifth: 41, melody: [58, 62, 65, 70] },
  { name: 'A', banjo: [57, 61, 64], bass: 33, fifth: 40, melody: [57, 61, 64, 69] },
];

/** One note per bar for the front-porch melody, D natural minor. */
const MENU_MOTIF = [69, 67, 65, 64, 62, 64, 65, 62, 69, 72, 74, 73, 69, 67, 65, 62];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safe(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class MusicDirector {
  constructor(sound) {
    this.sound = sound;
    this.ctx = null;
    this.bus = null;
    this.enabled = true;
    this.scene = 'menu';
    this.intensity = 0;
    this.bossPhase = 1;
    this.step = 0;
    this.nextStepTime = 0;
    this.timer = 0;
    this._running = false;
    this._voices = new Set();
    this._ksCache = new Map();
    this._maxMusicVoices = 18;
    this._lookahead = 0.16;
    this._lastStinger = 0;
    // A short, cheap porch-room send built from two filtered delay taps. It is
    // created once per context and shared by every instrument, so no voice
    // carries its own reverb node.
    this.mix = null;
    this.roomIn = null;
    this.roomTaps = [];
    this._roomReady = false;
    this._startedAt = 0;
    this._transitionGate = 0;
  }

  get sceneName() {
    return this.scene;
  }

  get bpm() {
    return this._bpm();
  }

  /* ------------------------------------------------------------------ *
   *  Lifecycle
   * ------------------------------------------------------------------ */

  get playing() {
    return Boolean(this._running && this.enabled && this.ctx && this.ctx.state === 'running');
  }

  get activeVoices() {
    this._sweep();
    return this._voices.size;
  }

  start() {
    const ctx = this.sound.ensure();
    if (!ctx) return false;
    this.ctx = ctx;
    this.bus = this.sound.musicBus;
    this._setupRoom();
    if (!this.enabled) return false;
    if (this._running) return true;
    this._running = true;
    this._voices.clear();
    this._startedAt = ctx.currentTime;
    this.nextStepTime = ctx.currentTime + 0.09;
    this.step = 0;
    if (this.mix) {
      // Fade the band in instead of starting the first pluck at full level.
      this.mix.gain.cancelScheduledValues(ctx.currentTime);
      this.mix.gain.setValueAtTime(0.0001, ctx.currentTime);
      this.mix.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.32);
    }
    this.timer = setInterval(() => this._schedule(), 40);
    return true;
  }

  stop() {
    this._running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
    for (const voice of [...this._voices]) this._release(voice);
    this._voices.clear();
  }

  /** Create the shared dry mix and porch-room delay send once per context. */
  _setupRoom() {
    if (this._roomReady || !this.ctx || !this.bus) return;
    const ctx = this.ctx;
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.0001;
    this.mix.connect(this.bus);
    this.roomIn = ctx.createGain();
    this.roomIn.gain.value = 0.3;
    this.mix.connect(this.roomIn);
    const makeTap = (delayTime, feedback, level, tone) => {
      const delay = ctx.createDelay(0.6);
      delay.delayTime.value = delayTime;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = tone;
      low.Q.value = 0.35;
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 170;
      const wet = ctx.createGain();
      wet.gain.value = level;
      const fb = ctx.createGain();
      fb.gain.value = feedback;
      // delay -> high -> low -> wet -> music bus, with a damped feedback loop.
      this.roomIn.connect(delay);
      delay.connect(high).connect(low);
      low.connect(wet).connect(this.bus);
      low.connect(fb).connect(delay);
      return { delay, low, high, wet, fb };
    };
    // Three short, mutually prime delays read as a small wooden room / porch.
    this.roomTaps = [
      makeTap(0.083, 0.2, 0.26, 2500),
      makeTap(0.127, 0.16, 0.18, 1900),
      makeTap(0.043, 0.1, 0.11, 3200),
    ];
    this._roomReady = true;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.stop();
    } else if (this.ctx) {
      this.start();
    }
  }

  setScene(scene) {
    const next = scene === 'gameplay' ? 'gameplay' : 'menu';
    if (next === this.scene) return;
    this.scene = next;
    if (this._running && this.ctx) {
      // Start the new scene on a clean downbeat, but cover the cut with a short
      // pickup fill from the outgoing chord. A hard reset alone is jarring.
      const now = this.ctx.currentTime;
      this._transitionFill(now + 0.015);
      this.step = 0;
      this.nextStepTime = now + 0.12;
      if (this.roomIn) {
        const wet = next === 'menu' ? 0.36 : this.bossPhase >= 2 ? 0.2 : 0.27;
        this.roomIn.gain.setTargetAtTime(wet, now, 0.25);
      }
    }
  }

  /** Three-note pickup and a bass step that hand the new scene its downbeat. */
  _transitionFill(at) {
    if (this._transitionGate && at - this._transitionGate < 0.12) return;
    this._transitionGate = at;
    const chord = this._chordForBar(Math.floor(this.step / 16));
    const notes = chord.banjo;
    notes.forEach((note, index) => {
      this._pluck(note + 12, at + index * 0.045, 0.05, 0.24, -0.32 + index * 0.32);
    });
    this._bass(chord.bass, at, 0.24, 0.11);
  }

  setIntensity(value) {
    this.intensity = clamp(safe(value, 0), 0, 1);
  }

  setBossPhase(phase) {
    this.bossPhase = Math.max(1, Math.round(safe(phase, 1)));
  }

  /* ------------------------------------------------------------------ *
   *  Look-ahead scheduler
   * ------------------------------------------------------------------ */

  _bpm() {
    if (this.scene === 'menu') return 88;
    const base = 108 + this.intensity * 12;
    return this.bossPhase >= 2 ? base + 8 : base;
  }

  _stepDuration() {
    // 16th note at the current scene tempo.
    return 60 / this._bpm() / 4;
  }

  _schedule() {
    if (!this._running || !this.ctx || this.ctx.state !== 'running') return;
    this._sweep();
    const now = this.ctx.currentTime;
    // A hidden tab, a suspended context or a slow frame can leave nextStepTime
    // far in the past. Drop the missed grid instead of firing a burst of notes
    // all at once when the context resumes.
    if (this.nextStepTime < now - 0.12) this.nextStepTime = now + 0.03;
    const horizon = now + this._lookahead;
    let guard = 0;
    while (this.nextStepTime < horizon && guard < 16) {
      this._scheduleStep(this.step, this.nextStepTime);
      this.nextStepTime += this._stepDuration();
      this.step += 1;
      guard += 1;
    }
  }

  /** Four bars of the home phrase, then four of the answering phrase. */
  _chordForBar(bar) {
    const phrase = Math.floor(bar / 4) % 2;
    return (phrase === 1 ? CHORDS_B : CHORDS)[bar % 4];
  }

  _scheduleStep(step, time) {
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const chord = this._chordForBar(bar);
    if (this.scene === 'menu') this._menuStep(beat, bar, chord, time);
    else this._gameplayStep(beat, bar, chord, time);
  }

  _menuStep(beat, bar, chord, time) {
    // Sparse porch theme: stomp + bass on the downbeat, a fingerpicked chord
    // roll, and a melody note every other bar. Plenty of air.
    if (beat === 0) {
      this._stomp(time, 0.22);
      this._bass(chord.bass, time, 1.4, 0.2);
      this._pluck(chord.banjo[0], time + 0.01, 0.13, 1.1, -0.2);
      this._pluck(chord.banjo[2], time + 0.13, 0.1, 1.0, 0.2);
    } else if (beat === 8) {
      this._stomp(time, 0.13);
      this._bass(chord.fifth - 12, time, 1.2, 0.16);
      this._pluck(chord.banjo[1], time + 0.02, 0.1, 0.9, 0.15);
    }
    if (beat === 3 || beat === 6 || beat === 11 || beat === 14) {
      const note = chord.banjo[(beat + bar) % chord.banjo.length];
      this._pluck(note, time, 0.085, 0.7, beat % 2 ? 0.28 : -0.28);
    }
    if (beat === 12 && bar % 2 === 0) {
      const melody = chord.melody[bar % chord.melody.length];
      this._pluck(melody, time, 0.1, 1.0, 0.1);
    }
    // The front-porch tune: one clear motif note per bar so the menu has a
    // memorable melody instead of only arpeggios.
    if (beat === 0 || (beat === 8 && bar % 2 === 1)) {
      const motif = MENU_MOTIF[bar % MENU_MOTIF.length];
      this._pluck(motif, time + 0.035, beat === 0 ? 0.075 : 0.055, beat === 0 ? 1.25 : 0.8, 0.06);
    }
    if (bar % 4 === 3 && beat === 15) {
      // Turnaround: a low fifth walks back to the top.
      this._bass(chord.fifth - 12, time, 0.5, 0.12);
    }
  }

  _gameplayStep(beat, bar, chord, time) {
    const hot = this.intensity;
    const boss = this.bossPhase >= 2;
    // Stomp-clap backbone: stomps on 1, the "and" of 2, 3 and the "and" of 4.
    if (beat === 0 || beat === 8 || (hot > 0.25 && beat === 6) || (hot > 0.55 && beat === 14)) {
      this._stomp(time, beat === 0 ? 0.24 : 0.16);
    }
    if (beat === 4 || beat === 12) this._clap(time, 0.09 + hot * 0.03);
    if (boss && (beat === 7 || beat === 15)) this._block(time, 0.11);

    // Upright bass: root-heavy walking feel.
    if (beat === 0) this._bass(chord.bass, time, 0.55, 0.22);
    else if (beat === 4) this._bass(chord.bass + 7, time, 0.35, 0.15);
    else if (beat === 8) this._bass(chord.bass + 12, time, 0.4, 0.16);
    else if (beat === 12) this._bass(chord.fifth - 12, time, 0.35, 0.15);
    else if (hot > 0.35 && (beat === 2 || beat === 10)) {
      this._bass(chord.bass + 12, time, 0.22, 0.1);
    } else if (hot > 0.68 && (beat === 6 || beat === 14)) {
      this._bass(chord.bass + 7, time, 0.18, 0.09);
    }
    // Phase II gets a low heartwood drone and a heavier off-beat stomp.
    if (boss && beat === 0) this._bass(chord.bass - 12, time, 0.95, 0.08);
    if (boss && beat === 10) this._stomp(time, 0.09);

    // Banjo/guitar. The chord rolls on eighths; high combo adds 16th passing
    // notes and a syncopated accent, so the loop audibly tightens.
    const tones = chord.banjo;
    if (beat % 2 === 0) {
      const idx = (beat / 2 + bar) % tones.length;
      const accent = beat === 0 || beat === 8;
      this._pluck(tones[idx], time, accent ? 0.15 : 0.105, accent ? 0.9 : 0.55, idx === 0 ? -0.24 : 0.2);
    }
    if (hot > 0.5 && beat % 2 === 1 && beat % 4 !== 3) {
      const passing = tones[(beat + bar) % tones.length] + (beat > 7 ? 12 : 0);
      this._pluck(passing, time, 0.055, 0.34, beat % 2 ? 0.34 : -0.34);
    }
    if (beat === 3 && hot > 0.62) {
      this._pluck(tones[2] + 12, time, 0.06, 0.4, 0.3);
    }
    if (boss && beat === 11) {
      this._pluck(chord.melody[2], time, 0.09, 0.6, -0.1);
    }
    // A sparse high counter-melody once the combo is really moving.
    if (hot > 0.42 && !boss && (beat === 14 && bar % 2 === 1)) {
      this._pluck(MENU_MOTIF[bar % MENU_MOTIF.length] + 12, time, 0.045, 0.45, 0.3);
    }
    if (bar % 4 === 3 && beat === 15) {
      // A short rising fill into the next phrase.
      [0, 1, 2].forEach((n) => this._pluck(chord.melody[n], time + n * 0.055, 0.055, 0.28, 0.1 * n));
    }
    if (this.intensity > 0.82 && beat === 0) this._stomp(time + 0.005, 0.08);
  }

  /* ------------------------------------------------------------------ *
   *  Split stinger
   * ------------------------------------------------------------------ */

  /** Short musical flourish layered over a split. Size 2-6 widens the voicing. */
  stinger(size = 2) {
    // Never create an AudioContext here: stingers may be requested by a
    // programmatic swing before the player's first gesture. The band must be
    // running (which only happens after unlockAudio) for a stinger to land.
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    if (!this.enabled) return;
    if (ctx.currentTime - this._lastStinger < 0.09) return;
    this._lastStinger = ctx.currentTime;
    const chord = this._chordForBar(Math.floor(this.step / 16));
    const at = ctx.currentTime + 0.015;
    const pieces = clamp(Math.round(safe(size, 2)), 2, 6);
    const lift = pieces >= 4 ? 12 : 0;
    const notes = [chord.banjo[0] + lift, chord.banjo[1] + lift, chord.banjo[2] + lift];
    notes.forEach((note, index) => {
      this._pluck(note, at + index * 0.055, 0.1 - index * 0.012, 0.7, -0.2 + index * 0.2);
    });
    if (pieces >= 4) {
      this._pluck(notes[2] + 12, at + 0.17, 0.06, 0.6, 0.35);
    }
    this._bass(chord.bass, at, 0.5, 0.12);
  }

  /* ------------------------------------------------------------------ *
   *  Instruments
   * ------------------------------------------------------------------ */

  _pluck(midi, at, gain = 0.12, dur = 0.7, pan = 0) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    if (this._voices.size >= this._maxMusicVoices) this._steal();
    const out = this.mix || this.bus;
    const t = at + (Math.random() - 0.5) * 0.0025;
    const src = this.ctx.createBufferSource();
    src.buffer = this._ksBuffer(Math.max(24, Math.min(96, Math.round(midi))));
    // A few cents of random detune and a moving pick brightness keep repeated
    // notes from sounding like the same sample retriggered.
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.008;
    const env = this.ctx.createGain();
    const level = Math.max(0.0003, gain * (0.9 + Math.random() * 0.2));
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const body = this.ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 260 + Math.random() * 70;
    body.Q.value = 0.8;
    body.gain.value = 2.2;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2500 + Math.random() * 1700;
    filter.Q.value = 0.45;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    src.connect(body).connect(filter).connect(env).connect(panner).connect(out);
    const stop = t + dur + 0.05;
    src.start(t, 0);
    src.stop(stop);
    this._track(src, [src, body, filter, env, panner], stop);
  }

  _bass(midi, at, dur = 0.6, gain = 0.16) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    if (this._voices.size >= this._maxMusicVoices) this._steal();
    const out = this.mix || this.bus;
    const freq = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.995, at + dur);
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq, at);
    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.55;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0003, gain), at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    osc.connect(env);
    sub.connect(subGain).connect(env);
    env.connect(filter).connect(out);
    const stop = at + dur + 0.05;
    osc.start(at);
    sub.start(at);
    osc.stop(stop);
    sub.stop(stop);
    this._track(osc, [osc, sub, subGain, env, filter], stop);
  }

  _stomp(at, gain = 0.2) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    if (this._voices.size >= this._maxMusicVoices) this._steal();
    const out = this.mix || this.bus;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(76, at);
    osc.frequency.exponentialRampToValueAtTime(38, at + 0.16);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    osc.connect(env).connect(out);
    const stop = at + 0.23;
    osc.start(at);
    osc.stop(stop);
    this._track(osc, [osc, env], stop);
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.sound.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const nEnv = this.ctx.createGain();
    nEnv.gain.setValueAtTime(0.0001, at);
    nEnv.gain.exponentialRampToValueAtTime(gain * 0.5, at + 0.004);
    nEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
    noise.connect(filter).connect(nEnv).connect(out);
    const nStop = at + 0.13;
    noise.start(at, Math.random() * 1.5);
    noise.stop(nStop);
    this._track(noise, [noise, filter, nEnv], nStop);
  }

  _clap(at, gain = 0.09) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const out = this.mix || this.bus;
    for (let i = 0; i < 3; i += 1) {
      if (this._voices.size >= this._maxMusicVoices) this._steal();
      const t = at + i * 0.012;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.sound.noise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1250 + i * 250;
      filter.Q.value = 1.4;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain * (1 - i * 0.22), t + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      noise.connect(filter).connect(env).connect(out);
      const stop = t + 0.11;
      noise.start(t, Math.random() * 1.5);
      noise.stop(stop);
      this._track(noise, [noise, filter, env], stop);
    }
  }

  _block(at, gain = 0.09) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const out = this.mix || this.bus;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, at);
    osc.frequency.exponentialRampToValueAtTime(520, at + 0.05);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    osc.connect(env).connect(out);
    const stop = at + 0.11;
    osc.start(at);
    osc.stop(stop);
    this._track(osc, [osc, env], stop);
  }

  /* ------------------------------------------------------------------ *
   *  Karplus-Strong string buffers (generated once, cached)
   * ------------------------------------------------------------------ */

  _ksBuffer(midi) {
    const cached = this._ksCache.get(midi);
    if (cached) return cached;
    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate;
    const freq = midiToFreq(midi);
    const seconds = midi < 48 ? 2.1 : midi < 60 ? 1.7 : 1.35;
    const length = Math.max(64, Math.floor(sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const period = Math.max(2, Math.round(sampleRate / freq));
    // Excitation: a short, bright pick noise shaped over one period.
    let last = 0;
    for (let i = 0; i < period && i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.35 + white * 0.65;
      data[i] = last * (1 - i / period) * 0.9;
    }
    // Karplus-Strong feedback: averaging lowpass plus per-sample damping.
    const decay = 0.9962 - Math.max(0, (midi - 60) * 0.00004);
    for (let i = period; i < length; i += 1) {
      const a = data[i - period];
      const b = i - period - 1 >= 0 ? data[i - period - 1] : 0;
      data[i] = (a + b) * 0.5 * decay;
    }
    // Force a clean tail so the loop never ends on a click.
    const fade = Math.floor(sampleRate * 0.12);
    for (let i = Math.max(0, length - fade); i < length; i += 1) {
      data[i] *= (length - i) / fade;
    }
    this._ksCache.set(midi, buffer);
    return buffer;
  }

  /* ------------------------------------------------------------------ *
   *  Voice cleanup (music voices mirror the foley limiter)
   * ------------------------------------------------------------------ */

  _track(source, nodes, stopAt) {
    const voice = { source, nodes: nodes.filter(Boolean), stopAt, dead: false };
    this._voices.add(voice);
    if (source) {
      source.addEventListener('ended', () => this._release(voice), { once: true });
    }
    return voice;
  }

  _release(voice) {
    if (!voice || voice.dead) return;
    voice.dead = true;
    this._voices.delete(voice);
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  _steal() {
    let oldest = null;
    for (const voice of this._voices) {
      if (!oldest || voice.stopAt < oldest.stopAt) oldest = voice;
    }
    if (!oldest) return;
    try {
      oldest.source.stop();
    } catch {
      /* already stopped */
    }
    this._release(oldest);
  }

  _sweep() {
    if (!this.ctx || this._voices.size === 0) return;
    const now = this.ctx.currentTime;
    for (const voice of [...this._voices]) {
      if (voice.stopAt && now > voice.stopAt + 0.25) this._release(voice);
    }
  }
}

export { CHORDS };
