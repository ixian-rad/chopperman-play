// Original procedural soundtrack: a rugged folk / lumberjack groove, synthesized live.
//
// Voices: Karplus-Strong banjo, acoustic guitar and upright bass (string buffers rendered once
// per pitch and cached), stomp / clap / shaker / spoons percussion (rendered once), and a
// fiddle lead (detuned saws + vibrato). Notes are queued ahead on AudioContext time by a
// look-ahead scheduler; a timer only wakes it up and never times notes itself.
//
// Sections: 'menu' (relaxed, Travis-picked guitar ~82 BPM), 'gameplay' (boom-chick groove
// 104–118 BPM that adds banjo rolls, shaker, extra stomps and the fiddle as the intensity
// rises) and 'boss' (E minor, four-on-the-floor stomps, fiddle drone, 126 BPM). Chords come
// from seeded progressions, picked 4 bars at a time, so it does not repeat every 8 bars.
import { Rng } from './rng.js';

const LOOKAHEAD = 0.3; // seconds of notes queued ahead
const WAKE_MS = 50;
const MAX_MUSIC = 64; // live music sources
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Chords as semitone offsets from the key root.
const CH = {
  I: [0, 4, 7], ii: [2, 5, 9], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16], bVII: [10, 14, 17],
  i: [0, 3, 7], iv: [5, 8, 12], bVI: [8, 12, 15], bIII: [3, 7, 10], v: [7, 10, 14],
};
const PROG = {
  menu: [['I', 'IV', 'I', 'V'], ['I', 'vi', 'IV', 'V'], ['IV', 'I', 'V', 'I'], ['I', 'I', 'IV', 'IV'], ['vi', 'IV', 'I', 'V'], ['I', 'V', 'IV', 'I']],
  gameplay: [['I', 'I', 'IV', 'I'], ['I', 'IV', 'V', 'I'], ['I', 'bVII', 'IV', 'I'], ['I', 'vi', 'IV', 'V'], ['IV', 'I', 'V', 'V'],
    ['I', 'V', 'vi', 'IV'], ['I', 'I', 'V', 'I'], ['vi', 'V', 'IV', 'I'], ['I', 'bVII', 'I', 'V']],
  boss: [['i', 'bVII', 'bVI', 'bVII'], ['i', 'iv', 'i', 'V'], ['i', 'bVI', 'bIII', 'bVII'], ['i', 'i', 'bVII', 'i'], ['i', 'iv', 'bVII', 'V']],
};
const ROOT = { menu: 43, gameplay: 43, boss: 40 }; // G2, G2, E2
const MAJ_PENT = [0, 2, 4, 7, 9];
const MIN_PENT = [0, 3, 5, 7, 10];
const ROLLS = [[0, 1, 3, 0, 1, 3, 0, 2], [0, 2, 1, 3, 0, 2, 1, 3], [0, 3, 1, 3, 0, 3, 2, 3], [2, 1, 0, 3, 2, 1, 0, 3], [1, 0, 3, 2, 1, 0, 3, 2]];

export class Music {
  constructor(am) {
    this.am = am; // audio manager (owns the context and buses)
    this.rng = new Rng(0x5eed + ((Math.random() * 1e6) | 0));
    this.section = 'menu';
    this.pendingSection = null;
    this.intensity = 0.15;
    this.target = 0.15;
    this.bpm = 82;
    this.step = 0;
    this.barCount = 0;
    this.barInSec = 0;
    this.nextT = 0;
    this.timer = null;
    this.notes = 0;
    this.lastScheduled = -1;
    this.keyOff = 0;
    this.phrase = PROG.menu[0];
    this.cache = new Map();
    this.melody = { last: 74, rhythm: [] };
    this.lastPump = performance.now();
  }

  get ctx() { return this.am.ctx; }
  get bus() { return this.am.musicIn; }
  // True while notes are actually being queued.
  get playing() {
    const c = this.ctx;
    return !!(this.timer && c && c.state === 'running' && this.am.prefs.musicOn && !document.hidden && this.lastScheduled > c.currentTime - 0.5);
  }

  start() {
    if (this.timer || !this.ctx) return;
    this.makeDrums();
    this.resync();
    this.timer = setInterval(() => this.pump(), WAKE_MS);
    this.pump();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  resync() { if (this.ctx) this.nextT = this.ctx.currentTime + 0.08; }

  // section: 'menu' | 'gameplay' | 'boss'; intensity 0..1 (smoothed here).
  setState(section, intensity) {
    if (section && section !== this.section && section !== this.pendingSection) this.pendingSection = section;
    if (section === this.section) this.pendingSection = null;
    this.target = clamp(intensity, 0, 1);
  }

  pump() {
    const c = this.ctx;
    const nowMs = performance.now();
    const dt = Math.min(1, (nowMs - this.lastPump) / 1000);
    this.lastPump = nowMs;
    const d = this.target - this.intensity;
    this.intensity += d > 0 ? Math.min(d, 0.35 * dt) : Math.max(d, -0.08 * dt);
    if (!c || c.state !== 'running' || !this.am.prefs.musicOn || document.hidden) return;
    // After a stall (tab hidden, debugger), restart the grid instead of bursting old notes.
    if (this.nextT < c.currentTime - 0.05) this.resync();
    let guard = 0;
    while (this.nextT < c.currentTime + LOOKAHEAD && guard++ < 16) {
      this.schedStep(this.nextT);
      this.nextT += 60 / this.bpm / 4;
    }
  }

  // ------------------------------------------------------------------ structure

  barStart() {
    if (this.pendingSection) {
      this.section = this.pendingSection;
      this.pendingSection = null;
      this.barInSec = 0;
      this.keyOff = 0;
    }
    const sec = this.section, r = this.rng;
    const b = this.barInSec;
    if (b % 4 === 0) {
      // Seeded progression choice; avoid repeating the previous phrase back to back.
      const pool = PROG[sec];
      let p = r.pick(pool);
      if (p === this.phrase) p = r.pick(pool);
      this.phrase = p;
      // Every 16 bars of gameplay, maybe move the key (G → C or A) for a verse, then come home.
      if (sec === 'gameplay' && b % 16 === 0 && b > 0) this.keyOff = r.pick([0, 0, 5, 2]);
      if (b % 8 === 0) this.newMotif();
    }
    this.chordName = this.phrase[b % 4];
    this.chord = CH[this.chordName];
    this.nextChord = CH[this.phrase[(b + 1) % 4]];
    this.root = ROOT[sec] + this.keyOff;
    const I = this.intensity;
    this.bpm = sec === 'menu' ? 82 : sec === 'boss' ? 126 + 4 * I : 104 + 14 * I;
    this.roll = ROLLS[(r.next() * ROLLS.length) | 0];
    this.fill = b % 4 === 3 && I > 0.35 && r.next() < 0.7;
    const bright = sec === 'menu' ? 2600 : sec === 'boss' ? 5000 + 5000 * I : 2200 + 9000 * I;
    this.am.musicBright.frequency.setTargetAtTime(bright, this.ctx.currentTime, 0.8);
  }

  newMotif() {
    // A 2-bar rhythm for the lead (in 8th notes), reused for 8 bars so a tune emerges.
    const r = this.rng;
    const rh = [];
    for (let i = 0; i < 16; i++) {
      const strong = i % 4 === 0;
      rh.push(strong ? r.next() < 0.85 : r.next() < 0.4);
    }
    rh[15] = false;
    this.melody.rhythm = rh;
    this.melody.seed = (r.next() * 1e9) | 0;
  }

  schedStep(t) {
    if (this.step === 0) this.barStart();
    const s = this.step;
    // A light shuffle on the off-8ths.
    const sw = s % 4 === 2 ? 0.12 * (60 / this.bpm / 4) : 0;
    const tt = t + sw;
    if (this.section === 'menu') this.menuStep(s, tt);
    else if (this.section === 'boss') this.bossStep(s, tt);
    else this.gameStep(s, tt);
    this.lastScheduled = t;
    this.step = (s + 1) % 16;
    if (this.step === 0) { this.barInSec++; this.barCount++; }
  }

  // Chord tones placed in a register.
  voicing(lo, hi, chord = this.chord, root = this.root) {
    const out = [];
    for (let m = lo; m <= hi; m++) {
      const pc = ((m - root) % 12 + 12) % 12;
      if (chord.some((c) => ((c % 12) + 12) % 12 === pc)) out.push(m);
    }
    return out;
  }

  chordRoot(chord = this.chord) { return this.root + chord[0]; }

  // ------------------------------------------------------------------ sections

  menuStep(s, t) {
    const I = this.intensity;
    const bassLo = this.chordRoot() + 12; // guitar thumb in the E2–A3 range
    const tones = this.voicing(59, 76);
    // Travis picking: alternating thumb on the beats, treble pinches on the off-8ths.
    if (s % 4 === 0) {
      const alt = (s / 4) % 2 === 1 ? 7 : 0;
      this.pluck(t, bassLo + alt - (bassLo + alt > 64 ? 12 : 0), 0.32, 'guitar', -0.15, 1.2);
    }
    if (s % 4 === 2 || (s === 0 && this.barInSec % 2 === 0)) {
      const idx = (this.barInSec * 3 + s) % tones.length;
      this.pluck(t, tones[idx], 0.2, 'guitar', 0.2, 1.0);
    }
    if (s === 0) this.bassNote(t, this.chordRoot(), 0.22, 1.6);
    if ((s === 4 || s === 12) && I > 0.05) this.drum(t, 'shaker', 0.08, 0.2);
    // A soft harmonica-like pad every other bar.
    if (s === 0 && this.barInSec % 2 === 1) {
      const pad = this.voicing(64, 74);
      this.reed(t, pad[0], 60 / this.bpm * 3.6, 0.03);
      this.reed(t + 0.05, pad[Math.min(1, pad.length - 1)], 60 / this.bpm * 3.4, 0.025);
    }
  }

  gameStep(s, t) {
    const I = this.intensity;
    const root = this.chordRoot();
    // Upright bass: root / fifth, walking into the next chord when the groove heats up.
    if (s === 0) this.bassNote(t, root, 0.5, 0.55);
    if (s === 8) this.bassNote(t, root + 7 - 12 * (root + 7 > 52 ? 1 : 0), 0.42, 0.5);
    if (I > 0.4 && (s === 6 || s === 14)) {
      const nr = this.root + this.nextChord[0];
      const target = s === 14 ? nr + (this.rng.next() < 0.5 ? -1 : 2) : root + 4 - 12 * (root + 4 > 52 ? 1 : 0);
      this.bassNote(t, target, 0.3, 0.25);
    }
    // Stomp on 1 and 3, clap on 2 and 4; pickups and ghost claps at high intensity.
    if (s === 0 || s === 8) this.drum(t, 'stomp', 0.65 + 0.2 * I);
    if (I > 0.6 && (s === 14 || (s === 6 && this.rng.next() < 0.5))) this.drum(t, 'stomp', 0.35);
    if ((s === 4 || s === 12) && I > 0.08) this.drum(t, 'clap', 0.38 + 0.2 * I, 0.1);
    if (I > 0.7 && s === 15 && this.rng.next() < 0.4) this.drum(t, 'clap', 0.15, -0.2);
    if (I > 0.45 && s % 2 === 0) this.drum(t, 'shaker', s % 4 === 2 ? 0.14 : 0.07, 0.35);
    if (I > 0.82 && s % 2 === 1) this.drum(t, 'shaker', 0.05, 0.35);
    if (this.fill && s >= 12) this.drum(t, 'spoons', 0.25 + 0.05 * (s - 12), -0.3);
    // Guitar boom-chick strums on 2 and 4 (down), up-strokes on the "and" when busier.
    if (s === 4 || s === 12) this.strum(t, this.voicing(52, 67), 0.18, true);
    if (I > 0.3 && (s === 6 || s === 14)) this.strum(t, this.voicing(59, 67), 0.09, false);
    // Banjo rolls in 8ths (every other bar at medium intensity), with the high drone string.
    if (I > 0.3 && s % 2 === 0 && (I > 0.6 || this.barInSec % 2 === 0)) {
      const tones = this.voicing(59, 74);
      const set = [tones[0], tones[Math.floor(tones.length / 2)], tones[tones.length - 1], this.root + 24 + (this.keyOff === 5 ? -5 : 0)];
      const n = set[this.roll[(s / 2) % 8]];
      this.pluck(t, n, 0.16 + 0.06 * I, 'banjo', 0.3, 0.6);
    }
    // Fiddle lead at high intensity.
    if (I > 0.72) this.lead(s, t, MAJ_PENT, 0.05 + 0.03 * (I - 0.72) / 0.28);
  }

  bossStep(s, t) {
    const I = this.intensity;
    const root = this.chordRoot();
    if (s % 4 === 0) this.drum(t, 'stomp', 0.8);
    if (s === 0 && this.barInSec % 2 === 0) this.drum(t, 'tom', 0.6);
    if (s === 4 || s === 12) this.drum(t, 'clap', 0.5, 0.1);
    if (s === 7 || s === 15) this.drum(t, 'clap', 0.2, -0.1);
    if (s % 2 === 0) this.drum(t, 'shaker', s % 4 === 2 ? 0.16 : 0.08, 0.35);
    if (this.fill && s >= 12) this.drum(t, 'spoons', 0.3, -0.3);
    // Driving 8th-note bass, root and octave.
    if (s % 2 === 0) this.bassNote(t, root + ((s / 2) % 4 === 3 ? 7 : 0), s % 4 === 0 ? 0.5 : 0.32, 0.22);
    if (s === 4 || s === 10 || s === 12) this.strum(t, this.voicing(52, 66), 0.14, s !== 10);
    if (s % 2 === 0) {
      const tones = this.voicing(59, 74);
      const set = [tones[0], tones[1] ?? tones[0], tones[tones.length - 1], this.root + 19];
      this.pluck(t, set[this.roll[(s / 2) % 8]], 0.15, 'banjo', 0.3, 0.45);
    }
    // Fiddle drone double-stop (root + fifth), re-bowed every half bar.
    if (s === 0 || s === 8) {
      const len = 60 / this.bpm * 2;
      this.fiddle(t, this.root + 24 + this.chord[0], len * 0.98, 0.035);
      this.fiddle(t, this.root + 31 + this.chord[0], len * 0.98, 0.025);
    }
    if (I > 0.9) this.lead(s, t, MIN_PENT, 0.04);
  }

  // Melodic lead on the motif rhythm: chord tones on strong beats, pentatonic steps between.
  lead(s, t, scale, vel) {
    if (s % 2) return;
    const idx = ((this.barInSec % 2) * 8) + s / 2;
    if (!this.melody.rhythm[idx]) return;
    const rng = new Rng(this.melody.seed + idx * 31 + (this.barInSec % 4 < 2 ? 0 : 7));
    let n = this.melody.last;
    if (s % 8 === 0) {
      const tones = this.voicing(67, 86);
      n = tones.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) && rng.next() < 0.8 ? b : a), tones[0]);
    } else {
      const pcs = scale.map((x) => (x + this.root) % 12);
      const step = rng.pick([-2, -1, -1, 1, 1, 2]);
      let cand = n;
      for (let k = 0, moved = 0; k < 12 && moved < Math.abs(step); k++) {
        cand += Math.sign(step);
        if (pcs.includes(((cand % 12) + 12) % 12)) moved++;
      }
      n = clamp(cand, 67, 86);
    }
    this.melody.last = n;
    let len = 1;
    while (idx + len < 16 && !this.melody.rhythm[idx + len] && len < 4) len++;
    this.fiddle(t, n, len * 2 * 60 / this.bpm / 4 * 0.95, vel);
  }

  // ------------------------------------------------------------------ stingers

  // Short celebratory phrase over a brief duck of the groove.
  stinger(kind = 'clean') {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.am.prefs.musicOn) return;
    const now = c.currentTime;
    if (now - (this.lastSting ?? -9) < 0.8) return;
    this.lastSting = now;
    this.am.eventsPlayed['stinger:' + kind] = (this.am.eventsPlayed['stinger:' + kind] ?? 0) + 1;
    const big = kind === 'boss' || kind === 'complete';
    this.duckFor(big ? 2.2 : 0.75, big ? 0.2 : 0.35);
    const minor = this.section === 'boss' && kind !== 'boss';
    const root = (this.section === 'boss' ? 40 : 43) + this.keyOff + 24;
    const arp = minor ? [0, 3, 7, 12, 15] : [0, 4, 7, 12, 16];
    const t = now + 0.03;
    const dt = big ? 0.075 : 0.055;
    arp.forEach((iv, i) => this.pluck(t + i * dt, root + iv, 0.3 - 0.02 * i, 'banjo', -0.2 + 0.1 * i, 0.9, true));
    this.drum(t, 'clap', 0.4, 0, true);
    if (kind === 'perfect' || big) this.pluck(t + 5 * dt, root + 19, 0.28, 'banjo', 0.3, 1.2, true);
    if (big) {
      // Stomp-stomp-clap and a held fiddle note over a full strum.
      this.drum(t + 0.3, 'stomp', 0.8, 0, true);
      this.drum(t + 0.48, 'stomp', 0.8, 0, true);
      this.drum(t + 0.66, 'clap', 0.6, 0, true);
      this.strum(t + 0.66, [root - 12, root - 5, root, root + 4, root + 7], 0.3, true, true);
      this.fiddle(t + 0.66, root + 12, 1.2, 0.07, true);
      this.fiddle(t + 0.66, root + 7, 1.2, 0.05, true);
    }
  }

  duckFor(sec = 0.7, depth = 0.35) {
    const c = this.ctx;
    if (!c) return;
    const g = this.am.duck.gain, t = c.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(depth, t + 0.03);
    g.setValueAtTime(depth, t + sec * 0.4);
    g.linearRampToValueAtTime(1, t + sec);
  }

  // ------------------------------------------------------------------ instruments

  room(force) { return force || this.am.musicVoices < MAX_MUSIC; }

  out(src, nodes, pan) {
    const p = this.am.panNode(pan);
    let cur = src;
    for (const n of [...nodes, p]) { if (n) { cur.connect(n); cur = n; } }
    cur.connect(this.bus);
    this.am.track(src, [...nodes, p].filter(Boolean), 'music');
    this.notes++;
  }

  // Karplus-Strong string, rendered once per (pitch, instrument) and cached.
  string(midi, kind) {
    const key = kind + midi;
    let e = this.cache.get(key);
    if (e) return e;
    const c = this.ctx, sr = c.sampleRate, f = mtof(midi);
    const P = { banjo: { t60: 0.75, blend: 0.4, lp: 0.65, dur: 1.0, pick: 0.13 }, guitar: { t60: 1.6, blend: 1, lp: 0.45, dur: 1.6, pick: 0.2 }, bass: { t60: 1.3, blend: 1, lp: 0.12, dur: 1.4, pick: 0.25 } }[kind];
    const N = Math.max(2, Math.floor(sr / f));
    const len = Math.floor(P.dur * sr);
    const buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    // Excitation: a one-pole low-passed noise burst with a pick-position comb.
    let y = 0;
    for (let i = 0; i < N; i++) { y += P.lp * ((Math.random() * 2 - 1) - y); d[i] = y; }
    const pp = Math.max(1, Math.floor(N * P.pick));
    for (let i = N - 1; i >= pp; i--) d[i] -= 0.8 * d[i - pp];
    const rho = Math.pow(0.001, N / (sr * P.t60));
    const b = P.blend;
    for (let i = N; i < len; i++) {
      const a = d[i - N], a1 = i - N - 1 >= 0 ? d[i - N - 1] : 0;
      d[i] = rho * ((1 - b) * a + b * 0.5 * (a + a1));
    }
    let m = 1e-6;
    for (let i = 0; i < len; i++) m = Math.max(m, Math.abs(d[i]));
    const fade = Math.floor(0.05 * sr);
    for (let i = 0; i < len; i++) d[i] *= (0.8 / m) * (i > len - fade ? (len - i) / fade : 1);
    // The averaging filter adds half a sample of delay; correct the tuning with playbackRate.
    e = { buf, rate: f * (N + 0.5 * b) / sr };
    this.cache.set(key, e);
    return e;
  }

  pluck(t, midi, vel, kind = 'guitar', pan = 0, len = 1, force = false) {
    if (!this.room(force) || !Number.isFinite(midi)) return;
    const c = this.ctx;
    const s = this.string(Math.round(midi), kind);
    const src = c.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = s.rate;
    const g = c.createGain();
    const dur = Math.min(len, s.buf.duration / s.rate);
    g.gain.setValueAtTime(vel, t);
    g.gain.setValueAtTime(vel, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0, t + dur);
    this.out(src, [g], pan);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  strum(t, notes, vel, down = true, force = false) {
    const ns = down ? notes.slice(0, 5) : notes.slice(-3).reverse();
    ns.forEach((m, i) => this.pluck(t + i * (down ? 0.012 : 0.008), m, vel * (1 - 0.08 * i), 'guitar', -0.25 + 0.1 * i, down ? 0.7 : 0.35, force));
  }

  // Upright bass: a KS string plus a soft sine body thump.
  bassNote(t, midi, vel, len = 0.5) {
    if (!this.room()) return;
    while (midi > 52) midi -= 12;
    while (midi < 33) midi += 12;
    this.pluck(t, midi, vel * 0.9, 'bass', -0.05, Math.max(0.3, len * 1.4));
    const c = this.ctx, o = c.createOscillator();
    o.frequency.value = mtof(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel * 0.45, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.2, len));
    this.out(o, [g], 0);
    o.start(t);
    o.stop(t + Math.max(0.2, len) + 0.02);
  }

  // Fiddle: two detuned saws, delayed vibrato, a body band-pass, bowed envelope.
  fiddle(t, midi, len, vel, force = false) {
    if (!this.room(force)) return;
    const c = this.ctx, f = mtof(midi);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.2 + Math.random() * 0.6;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.35, len * 0.6));
    lfo.connect(lg);
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = 3200;
    const body = c.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 2400;
    body.gain.value = 5;
    const g = c.createGain();
    const a = Math.min(0.09, len * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + a);
    g.gain.setValueAtTime(vel * 0.85, t + Math.max(a, len - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.06);
    fl.connect(body).connect(g).connect(this.bus);
    for (const det of [-4, 4]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      lg.connect(o.frequency);
      o.connect(fl);
      this.am.track(o, [], 'music');
      o.start(t);
      o.stop(t + len + 0.1);
    }
    // The vibrato LFO ends last and tears the shared chain down.
    this.am.track(lfo, [lg, fl, body, g], 'music');
    this.notes++;
    lfo.start(t);
    lfo.stop(t + len + 0.12);
  }

  // Harmonica-ish reed pad: a soft pulse wave through a band-pass, slow swell.
  reed(t, midi, len, vel) {
    if (!this.room() || !Number.isFinite(midi)) return;
    const c = this.ctx, o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(midi);
    const fl = c.createBiquadFilter();
    fl.type = 'bandpass';
    fl.frequency.value = 1300;
    fl.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.35);
    g.gain.setValueAtTime(vel, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    this.out(o, [fl, g], 0.1);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  // Percussion buffers, rendered once.
  makeDrums() {
    if (this.drums) return;
    const c = this.ctx, sr = c.sampleRate;
    const mk = (sec, fn) => {
      const n = Math.floor(sec * sr), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
      fn(d, n);
      let m = 1e-6;
      for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i]));
      for (let i = 0; i < n; i++) d[i] *= 0.9 / m;
      return b;
    };
    const reso = (d, f, r) => {
      const w = 2 * Math.PI * f / sr, a1 = 2 * r * Math.cos(w), a2 = -r * r;
      let y1 = 0, y2 = 0;
      for (let i = 0; i < d.length; i++) { const y = d[i] + a1 * y1 + a2 * y2; y2 = y1; y1 = y; d[i] = y; }
    };
    this.drums = {
      // Boot on a wooden porch: pitch-dropping thump + the board's knock.
      stomp: mk(0.35, (d, n) => {
        let ph = 0;
        const k = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const t = i / sr, f = 45 + 110 * Math.exp(-t * 28);
          ph += 2 * Math.PI * f / sr;
          d[i] = Math.sin(ph) * Math.exp(-t * 11);
          if (t < 0.02) k[i] = (Math.random() * 2 - 1) * (1 - t / 0.02);
        }
        reso(k, 260, 0.995);
        for (let i = 0; i < n; i++) d[i] += 0.02 * k[i];
      }),
      tom: mk(0.6, (d, n) => {
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr, f = 70 + 60 * Math.exp(-t * 15);
          ph += 2 * Math.PI * f / sr;
          d[i] = Math.sin(ph) * Math.exp(-t * 6) + 0.1 * (Math.random() * 2 - 1) * Math.exp(-t * 40);
        }
      }),
      // Hand clap: three quick bursts and a short tail, resonant around 1.2 kHz.
      clap: mk(0.25, (d, n) => {
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          let e = 0;
          for (const o of [0, 0.011, 0.023]) if (t >= o && t < o + 0.008) e = Math.max(e, 1 - (t - o) / 0.008);
          if (t >= 0.023) e = Math.max(e, 0.6 * Math.exp(-(t - 0.023) * 30));
          d[i] = (Math.random() * 2 - 1) * e;
        }
        const x = d.slice();
        reso(d, 1150, 0.97);
        for (let i = 0; i < n; i++) d[i] = 0.06 * d[i] + 0.5 * x[i];
        for (let i = n - 1; i > 0; i--) d[i] -= 0.85 * d[i - 1];
      }),
      shaker: mk(0.09, (d, n) => {
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (Math.random() * 2 - 1) * Math.min(1, t / 0.012) * Math.exp(-t * 45); }
        for (let i = n - 1; i > 0; i--) d[i] -= 0.95 * d[i - 1];
      }),
      // Spoons / wood block click.
      spoons: mk(0.08, (d, n) => {
        for (let i = 0; i < 40; i++) d[i] = Math.random() * 2 - 1;
        const x = d.slice();
        reso(d, 1900, 0.993);
        reso(x, 2900, 0.99);
        for (let i = 0; i < n; i++) d[i] += x[i];
      }),
    };
  }

  drum(t, name, vel, pan = 0, force = false) {
    if (!this.room(force)) return;
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.drums[name];
    const g = c.createGain();
    g.gain.value = vel;
    this.out(src, [g], pan);
    src.start(t);
  }
}
