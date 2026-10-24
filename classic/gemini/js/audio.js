/**
 * Procedural Web Audio Synthesizer & Folk/Lumberjack Soundtrack Manager.
 * Zero external audio assets or libraries; pure Web Audio API synthesis.
 * Routes all SFX, weather/time ambient beds, and look-ahead procedural music
 * through a master DynamicsCompressorNode limiter with voice capping & leak-free cleanup.
 */

export const AUDIO_STORAGE_KEY = 'nj_backyard_axe_audio_v1';
const MAX_ACTIVE_VOICES = 42;

export class SoundEffects {
  constructor() {
    this.ctx = null;
    this.enabled = true;

    // Persisted Volume & Mute state (Music ON by default at modest volume)
    this.sfxVolume = 0.8;
    this.musicVolume = 0.45;
    this.sfxMuted = false;
    this.musicMuted = false;

    // Master graph nodes
    this.masterCompressor = null;
    this.masterGain = null;
    this.sfxBus = null;
    this.ambienceBus = null;
    this.musicBus = null;
    this.musicDuckGain = null;

    // Reusable noise & Karplus-Strong pluck buffers
    this._whiteNoiseBuf = null;
    this._pinkNoiseBuf = null;
    this._brownNoiseBuf = null;
    this._pluckCache = new Map();

    // Voice tracking & rate-limiting
    this._liveVoices = new Set();
    this.eventsPlayed = {};
    this._lastKnockTime = 0;
    this._lastHoverTime = 0;
    this._lastWindupCreakTime = 0;
    this._lastMeterTickTime = 0;
    this._lastMeterZone = '';

    // Ambient soundscape state & continuous crossfading beds
    this._ambientInitialized = false;
    this._ambientBeds = null;
    this._currentAmbientWeather = 'sun';
    this._currentIsNight = false;
    this._ambientOneShotTimer = 0;
    this._cricketTimer = 0;
    this._birdTimer = 0;
    this._dripTimer = 0;

    // Procedural Lumberjack Folk Soundtrack Scheduler state
    this.musicSection = 'menu'; // 'menu' | 'gameplay' | 'boss'
    this.intensity = 0.22; // 0..1
    this._targetIntensity = 0.22;
    this._musicSchedulerActive = false;
    this._schedulerTimer = null;
    this._nextNoteTime = 0;
    this._currentStep = 0; // 0..127 (8 bars of 16th notes)
    this._phraseCount = 0;
    this._musicSeed = 0x6c756d62; // Seeded PRNG state for chord/melody variation
    this._activeProgression = null;
    this._lastScheduledNoteTime = 0;
    this._isHidden = false;
    this._unlockedByGesture = false;
    this._demoTimers = [];

    this.loadSettings();
    this._bindLifecycleListeners();
  }

  /**
   * Loads persisted volume and mute settings from localStorage.
   */
  loadSettings() {
    try {
      const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      if (typeof data.sfxVolume === 'number' && Number.isFinite(data.sfxVolume)) {
        this.sfxVolume = Math.max(0, Math.min(1, data.sfxVolume));
      }
      if (typeof data.musicVolume === 'number' && Number.isFinite(data.musicVolume)) {
        this.musicVolume = Math.max(0, Math.min(1, data.musicVolume));
      }
      if (typeof data.sfxMuted === 'boolean') {
        this.sfxMuted = data.sfxMuted;
      }
      if (typeof data.musicMuted === 'boolean') {
        this.musicMuted = data.musicMuted;
      }
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  /**
   * Persists current volume and mute settings to localStorage.
   */
  saveSettings() {
    try {
      const payload = {
        sfxVolume: Math.round(this.sfxVolume * 100) / 100,
        musicVolume: Math.round(this.musicVolume * 100) / 100,
        sfxMuted: Boolean(this.sfxMuted),
        musicMuted: Boolean(this.musicMuted)
      };
      window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Binds first-user-gesture unlock and document visibilitychange handling.
   */
  _bindLifecycleListeners() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const unlockHandler = () => {
      this._unlockedByGesture = true;
      this.unlockAndStart();
    };

    ['pointerdown', 'keydown', 'click'].forEach((evt) => {
      window.addEventListener(evt, unlockHandler, { passive: true });
    });

    document.addEventListener('visibilitychange', () => {
      this._isHidden = Boolean(document.hidden);
      if (this._isHidden) {
        this._pauseForHiddenTab();
      } else if (this._unlockedByGesture) {
        this._resumeFromHiddenTab();
      }
    });
  }

  _pauseForHiddenTab() {
    if (this._schedulerTimer) {
      clearInterval(this._schedulerTimer);
      this._schedulerTimer = null;
    }
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  _resumeFromHiddenTab() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    if (!this.musicMuted && this.musicVolume > 0 && this.enabled) {
      this._nextNoteTime = ctx.currentTime + 0.06;
      this.startMusic();
    }
  }

  /**
   * Unlocks/resumes the AudioContext and starts the procedural soundtrack if music is on.
   */
  unlockAndStart() {
    this._unlockedByGesture = true;
    const ctx = this._ensureContext();
    if (!ctx) return null;
    this._initAmbientBeds();
    if (!this.musicMuted && this.musicVolume > 0 && this.enabled) {
      this.startMusic();
    }
    return ctx;
  }

  /**
   * Ensures the Web Audio context, master compressor/limiter, buses, and shared noise buffers exist.
   */
  _ensureContext() {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
        this._buildMasterGraph();
        this._buildSharedNoiseBuffers();
      }
      if (this.ctx.state === 'suspended' && !this._isHidden) {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  _buildMasterGraph() {
    const ctx = this.ctx;
    if (!ctx) return;

    // Master Limiter / Compressor so simultaneous splits, thunder, and music never clip
    this.masterCompressor = ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.setValueAtTime(-8, ctx.currentTime);
    this.masterCompressor.knee.setValueAtTime(6, ctx.currentTime);
    this.masterCompressor.ratio.setValueAtTime(12, ctx.currentTime);
    this.masterCompressor.attack.setValueAtTime(0.003, ctx.currentTime);
    this.masterCompressor.release.setValueAtTime(0.14, ctx.currentTime);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.95, ctx.currentTime);

    this.sfxBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicDuckGain = ctx.createGain();
    this.musicDuckGain.gain.setValueAtTime(1.0, ctx.currentTime);

    this.sfxBus.connect(this.masterCompressor);
    this.ambienceBus.connect(this.sfxBus);
    this.musicDuckGain.connect(this.musicBus);
    this.musicBus.connect(this.masterCompressor);
    this.masterCompressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    this._syncBusGains();
  }

  _syncBusGains() {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return;
    const now = this.ctx.currentTime;
    const effSfx = this.sfxMuted ? 0.0 : this.sfxVolume;
    const effMusic = this.musicMuted ? 0.0 : this.musicVolume;
    this.sfxBus.gain.setTargetAtTime(effSfx, now, 0.02);
    this.ambienceBus.gain.setTargetAtTime(effSfx > 0 ? 0.75 : 0.0, now, 0.03);
    this.musicBus.gain.setTargetAtTime(effMusic, now, 0.03);
  }

  setSfxVolume(val) {
    this.sfxVolume = Math.max(0, Math.min(1, Number(val) || 0));
    if (this.sfxVolume > 0 && this.sfxMuted) {
      this.sfxMuted = false;
    }
    this._syncBusGains();
    this.saveSettings();
    return this.sfxVolume;
  }

  setMusicVolume(val) {
    this.musicVolume = Math.max(0, Math.min(1, Number(val) || 0));
    if (this.musicVolume > 0 && this.musicMuted) {
      this.musicMuted = false;
    }
    this._syncBusGains();
    if (this.musicVolume > 0 && !this.musicMuted && this._unlockedByGesture) {
      this.startMusic();
    } else if (this.musicVolume <= 0) {
      this.stopMusic();
    }
    this.saveSettings();
    return this.musicVolume;
  }

  toggleSfxMute(forceState = null) {
    this.sfxMuted = typeof forceState === 'boolean' ? forceState : !this.sfxMuted;
    this._syncBusGains();
    this.saveSettings();
    return this.sfxMuted;
  }

  toggleMusicMute(forceState = null) {
    this.musicMuted = typeof forceState === 'boolean' ? forceState : !this.musicMuted;
    this._syncBusGains();
    if (this.musicMuted) {
      this.stopMusic();
    } else {
      this._unlockedByGesture = true;
      this.startMusic();
    }
    this.saveSettings();
    return this.musicMuted;
  }

  /**
   * Pre-computes reusable 2-second White, Pink, and Brown noise buffers to avoid per-event allocations.
   */
  _buildSharedNoiseBuffers() {
    const ctx = this.ctx;
    if (!ctx) return;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.0);

    // 1. White Noise
    this._whiteNoiseBuf = ctx.createBuffer(1, len, sr);
    const wData = this._whiteNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      wData[i] = Math.random() * 2 - 1;
    }

    // 2. Pink Noise (Paul Kellet's 1/f filter approximation)
    this._pinkNoiseBuf = ctx.createBuffer(1, len, sr);
    const pData = this._pinkNoiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      pData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    // 3. Brown / Red Noise (integrated white noise for deep rumble/wind/thunder)
    this._brownNoiseBuf = ctx.createBuffer(1, len, sr);
    const brData = this._brownNoiseBuf.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      brData[i] = lastOut * 3.2;
    }
  }

  /**
   * Generates or retrieves a cached Karplus-Strong plucked string AudioBuffer
   * for authentic banjo or acoustic guitar synthesis without runtime buffer churn.
   */
  _getKarplusStrongBuffer(freq, instrument = 'banjo') {
    const ctx = this.ctx;
    if (!ctx) return null;
    const roundedFreq = Math.max(55, Math.min(1800, Math.round(freq * 10) / 10));
    const key = `${instrument}_${roundedFreq}`;
    if (this._pluckCache.has(key)) {
      return this._pluckCache.get(key);
    }
    if (this._pluckCache.size > 72) {
      const firstKey = this._pluckCache.keys().next().value;
      this._pluckCache.delete(firstKey);
    }

    const sr = ctx.sampleRate;
    const dur = instrument === 'banjo' ? 0.42 : 0.58;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);

    const period = Math.max(4, Math.round(sr / roundedFreq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) {
      // Initial pick excitation: brighter impulse for banjo, warmer rounded excitation for guitar
      const phase = i / period;
      const pick = instrument === 'banjo'
        ? (Math.random() * 2 - 1) * 0.75 + Math.sin(phase * Math.PI * 4) * 0.35
        : (Math.random() * 2 - 1) * 0.45 + Math.sin(phase * Math.PI * 2) * 0.55;
      ring[i] = pick;
    }

    const damping = instrument === 'banjo' ? 0.986 : 0.992;
    const brightness = instrument === 'banjo' ? 0.34 : 0.5;
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const idx = i % period;
      const cur = ring[idx];
      // Banjo head membrane adds slight nonlinear twang saturation
      const sample = instrument === 'banjo' ? Math.tanh(cur * 1.45) : cur;
      out[i] = sample * Math.pow(1 - i / len, instrument === 'banjo' ? 1.35 : 1.1);
      const filtered = ((1 - brightness) * cur + brightness * prev) * damping;
      ring[idx] = filtered;
      prev = cur;
    }

    this._pluckCache.set(key, buf);
    return buf;
  }

  /**
   * Records a named SFX event in `this.eventsPlayed` for telemetry and testing.
   */
  _recordEvent(name) {
    if (!name) return;
    this.eventsPlayed[name] = (this.eventsPlayed[name] || 0) + 1;
  }

  /**
   * Registers an active one-shot source node, enforces the simultaneous voice cap,
   * and attaches an automatic disconnect/cleanup callback on `ended`.
   */
  _registerVoice(sourceNode, stopTime, nodesToDisconnect = []) {
    if (!sourceNode || !this.ctx) return false;
    this._pruneExpiredVoices();

    if (this._liveVoices.size >= MAX_ACTIVE_VOICES) {
      // Steal the voice closest to finishing so new foreground SFX always play cleanly
      let oldest = null;
      for (const v of this._liveVoices) {
        if (!oldest || v.stopTime < oldest.stopTime) {
          oldest = v;
        }
      }
      if (oldest) {
        oldest.cleanup();
      }
    }

    let cleaned = false;
    const entry = {
      sourceNode,
      stopTime: stopTime || this.ctx.currentTime + 0.3,
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        this._liveVoices.delete(entry);
        try {
          sourceNode.onended = null;
          sourceNode.disconnect();
        } catch {
          // Ignore already disconnected
        }
        for (let i = 0; i < nodesToDisconnect.length; i++) {
          try {
            if (nodesToDisconnect[i]) nodesToDisconnect[i].disconnect();
          } catch {
            // Ignore
          }
        }
      }
    };

    this._liveVoices.add(entry);
    sourceNode.onended = entry.cleanup;
    return true;
  }

  _pruneExpiredVoices() {
    if (!this.ctx) {
      this._liveVoices.clear();
      return;
    }
    const now = this.ctx.currentTime;
    for (const entry of this._liveVoices) {
      if (now > entry.stopTime + 0.08) {
        entry.cleanup();
      }
    }
  }

  getActiveVoiceCount() {
    this._pruneExpiredVoices();
    const ambientCount = this._ambientInitialized && !this.sfxMuted && this.sfxVolume > 0 ? 4 : 0;
    return this._liveVoices.size + ambientCount;
  }

  /**
   * Helper to play a sliced noise burst from the shared noise buffers with zero allocation.
   */
  _playNoiseSlice({
    type = 'pink',
    startTime = null,
    duration = 0.2,
    filterType = 'bandpass',
    freqStart = 800,
    freqEnd = null,
    q = 1.5,
    gainStart = 0.2,
    gainPeak = null,
    destination = null
  }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const buf =
      type === 'brown'
        ? this._brownNoiseBuf
        : type === 'white'
        ? this._whiteNoiseBuf
        : this._pinkNoiseBuf;
    if (!buf) return;

    const t0 = Math.max(ctx.currentTime, startTime ?? ctx.currentTime);
    const dur = Math.max(0.015, Math.min(1.8, duration));
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(20, freqStart), t0);
    if (freqEnd && freqEnd !== freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur * 0.85);
    }
    filter.Q.setValueAtTime(q, t0);

    const gain = ctx.createGain();
    if (gainPeak !== null && gainPeak > gainStart) {
      gain.gain.setValueAtTime(Math.max(0.0005, gainStart), t0);
      gain.gain.linearRampToValueAtTime(gainPeak, t0 + dur * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    } else {
      gain.gain.setValueAtTime(Math.max(0.0005, gainStart), t0);
      gain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    }

    const dest = destination || this.sfxBus || ctx.destination;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    this._registerVoice(src, t0 + dur + 0.02, [filter, gain]);
    const maxOffset = Math.max(0, 1.9 - dur);
    const randomOffset = Math.random() * maxOffset;
    src.start(t0, randomOffset, dur);
    src.stop(t0 + dur + 0.01);
  }

  /**
   * Helper to play a one-shot synthesized oscillator tone with pitch & gain envelopes.
   */
  _playTone({
    oscType = 'triangle',
    startTime = null,
    duration = 0.16,
    freqStart = 220,
    freqMid = null,
    freqEnd = null,
    gainPeak = 0.2,
    attack = 0.005,
    filterFreq = null,
    destination = null
  }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = Math.max(ctx.currentTime, startTime ?? ctx.currentTime);
    const dur = Math.max(0.015, duration);

    const osc = ctx.createOscillator();
    osc.type = oscType;
    osc.frequency.setValueAtTime(Math.max(18, freqStart), t0);
    if (freqMid !== null) {
      osc.frequency.linearRampToValueAtTime(Math.max(18, freqMid), t0 + dur * 0.45);
      if (freqEnd !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(18, freqEnd), t0 + dur);
      }
    } else if (freqEnd !== null && freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(18, freqEnd), t0 + dur);
    }

    const gain = ctx.createGain();
    if (attack > 0.002) {
      gain.gain.setValueAtTime(0.0005, t0);
      gain.gain.linearRampToValueAtTime(Math.max(0.001, gainPeak), t0 + Math.min(dur * 0.4, attack));
    } else {
      gain.gain.setValueAtTime(Math.max(0.001, gainPeak), t0);
    }
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);

    const dest = destination || this.sfxBus || ctx.destination;
    const nodes = [gain];

    if (filterFreq) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(filterFreq, t0);
      osc.connect(lp);
      lp.connect(gain);
      nodes.push(lp);
    } else {
      osc.connect(gain);
    }
    gain.connect(dest);

    this._registerVoice(osc, t0 + dur + 0.02, nodes);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  // ============================================================================
  // 1. SWING & WINDUP SFX
  // ============================================================================

  /**
   * Subtle leather-grip & hickory tension creak when mouse-dragging into overhead windup.
   */
  playWindupCreak(windupRatio = 0.5) {
    const nowPerf = performance.now();
    if (nowPerf - this._lastWindupCreakTime < 170) return;
    this._lastWindupCreakTime = nowPerf;
    this._recordEvent('windup_creak');

    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const clamped = Math.max(0.1, Math.min(1.0, windupRatio));
      this._playTone({
        oscType: 'sawtooth',
        duration: 0.075,
        freqStart: 95 + clamped * 45,
        freqEnd: 135 + clamped * 65,
        gainPeak: 0.045 * clamped,
        attack: 0.015,
        filterFreq: 340
      });
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Swing whoosh scaled by swing power/speed (pitch + loudness + length), mouse-drag swings included.
   */
  playWhoosh(forceRatio = 1.0, isMouseDrag = false) {
    this._recordEvent('whoosh');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const power = Math.max(0.25, Math.min(1.6, Number(forceRatio) || 1.0));
      // Faster/harder swings have a tighter, brighter, louder aerodynamic whoosh; softer swings are longer & lower
      const duration = Math.max(0.16, Math.min(0.32, 0.28 - (power - 0.6) * 0.07));
      const startFreq = (isMouseDrag ? 185 : 155) * (0.85 + power * 0.2);
      const peakFreq = Math.max(220, (isMouseDrag ? 620 : 540) * Math.pow(power, 1.15));
      const peakGain = Math.min(0.34, 0.17 * Math.pow(power, 1.1));

      this._playNoiseSlice({
        type: 'pink',
        duration,
        filterType: 'bandpass',
        freqStart: startFreq,
        freqEnd: peakFreq,
        q: isMouseDrag ? 2.6 : 2.1,
        gainStart: 0.008,
        gainPeak
      });

      // Low-end axe head air-displacement whistle
      this._playTone({
        oscType: 'sine',
        duration: duration * 0.85,
        freqStart: 95 * power,
        freqEnd: 210 * power,
        gainPeak: peakGain * 0.35,
        attack: duration * 0.35
      });
    } catch {
      // Ignore audio errors
    }
  }

  // ============================================================================
  // 2. WOOD IMPACTS BY SPECIES, STATE, GLANCES & HAZARDS
  // ============================================================================

  /**
   * Comprehensive wood impact dispatcher tailored to wood species (softwood/hardwood/ironwood)
   * and wood condition (knots, wet, frozen, hollow/rotten, glancing, block overstrike).
   */
  playStrikeImpact(strikeResult, forceRatio = 1.0) {
    if (!strikeResult) return;
    const power = Math.max(0.3, Math.min(1.6, Number(forceRatio) || 1.0));
    const species = strikeResult.logType || 'pine';

    // Determine wood hardness tier
    const softwoods = ['pine', 'birch', 'hollow_sycamore', 'pitch_pine', 'swamp_cypress'];
    const ironwoods = [
      'ironwood_hazard',
      'boss_oak',
      'boss_stump',
      'boss_osage',
      'boss_bogoak',
      'boss_locust',
      'boss_ironbark'
    ];
    const isSoftwood = softwoods.includes(species);
    const isIronwood = ironwoods.includes(species);

    if (strikeResult.glancing) {
      this.playGlancingBlow(
        power,
        species === 'frozen_tamarack' || strikeResult.weather === 'snow',
        species === 'swamp_cypress' || strikeResult.weather === 'rain'
      );
      return;
    }

    if (strikeResult.hitNail) {
      this.playNailHazardClang(power);
      return;
    }

    if (strikeResult.hitRock) {
      this.playRockRicochet(power);
      return;
    }

    // Layer 1: Wood-species body impact resonance
    if (isIronwood) {
      this._recordEvent('wood_impact_ironwood');
      this._playTone({
        oscType: 'triangle',
        duration: 0.14,
        freqStart: 245,
        freqEnd: 68,
        gainPeak: 0.28 * power
      });
      this._playTone({
        oscType: 'sine',
        duration: 0.09,
        freqStart: 1920,
        freqEnd: 1240,
        gainPeak: 0.09 * power
      });
    } else if (isSoftwood) {
      this._recordEvent('wood_impact_soft');
      this._playTone({
        oscType: 'sine',
        duration: 0.16,
        freqStart: 138,
        freqEnd: 44,
        gainPeak: 0.26 * power
      });
    } else {
      this._recordEvent('wood_impact_hard');
      this._playTone({
        oscType: 'triangle',
        duration: 0.15,
        freqStart: 182,
        freqEnd: 52,
        gainPeak: 0.28 * power
      });
      this._playNoiseSlice({
        type: 'pink',
        duration: 0.08,
        filterType: 'bandpass',
        freqStart: 1380,
        freqEnd: 880,
        q: 2.2,
        gainStart: 0.16 * power
      });
    }

    // Layer 2: Specific wood conditions (knot, wet, frozen, hollow/rotten)
    if (strikeResult.hitKnot) {
      this.playKnotImpact(power);
    }
    if (species === 'swamp_cypress' || strikeResult.weather === 'rain') {
      this.playWetWoodImpact(power * 0.85);
    }
    if (species === 'frozen_tamarack' || strikeResult.weather === 'snow') {
      if (strikeResult.split) {
        this.playIceShatter(power);
      } else {
        this.playIceCrack(power);
      }
    }
    if (
      species === 'hollow_sycamore' ||
      species === 'geode_sycamore' ||
      strikeResult.hitHollowVoid ||
      strikeResult.borerGalleryShatter
    ) {
      this.playHollowImpact(power, Boolean(strikeResult.hitHollowVoid));
    }

    // Layer 3: Progressive cracking on partial hits, or Boss Hit / Phase Break
    if (!strikeResult.split) {
      const maxHp = Math.max(1, (strikeResult.remainingHp || 0) + (strikeResult.damage || 50));
      const damageRatio = Math.max(0.15, Math.min(0.95, 1 - (strikeResult.remainingHp || 0) / maxHp));
      this.playProgressiveCrack(damageRatio);

      if (strikeResult.isBoss) {
        this.playBossHit(damageRatio);
        if (
          strikeResult.slabSheared ||
          strikeResult.rootButtressSheared ||
          damageRatio >= 0.48
        ) {
          this.playBossPhaseBreak();
        }
      }
    }
  }

  playKnotImpact(forceRatio = 1.0) {
    this._recordEvent('knot_impact');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      // Dense compressed-grain knot thwack + handle shock vibration hum
      this._playTone({
        oscType: 'triangle',
        duration: 0.13,
        freqStart: 310,
        freqEnd: 112,
        gainPeak: 0.24 * Math.min(1.4, forceRatio)
      });
      this._playTone({
        oscType: 'sawtooth',
        duration: 0.19,
        freqStart: 148,
        freqMid: 136,
        freqEnd: 142,
        gainPeak: 0.11,
        filterFreq: 380
      });
    } catch {
      // Ignore
    }
  }

  playWetWoodImpact(forceRatio = 1.0) {
    this._recordEvent('wet_wood_impact');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      // Damp squelch / waterlogged sap splash
      this._playNoiseSlice({
        type: 'white',
        duration: 0.14,
        filterType: 'bandpass',
        freqStart: 680,
        freqEnd: 2150,
        q: 3.4,
        gainStart: 0.15 * Math.min(1.3, forceRatio)
      });
    } catch {
      // Ignore
    }
  }

  playHollowImpact(forceRatio = 1.0, hitVoid = false) {
    this._recordEvent('hollow_impact');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      // Booming hollow drum cavity resonance + dry punky rot crumble
      const baseF = hitVoid ? 168 : 215;
      this._playTone({
        oscType: 'sine',
        duration: 0.24,
        freqStart: baseF,
        freqEnd: baseF * 0.68,
        gainPeak: 0.26 * Math.min(1.4, forceRatio)
      });
      this._playNoiseSlice({
        type: 'pink',
        duration: 0.15,
        filterType: 'bandpass',
        freqStart: 420,
        freqEnd: 260,
        q: 4.5,
        gainStart: 0.16
      });
    } catch {
      // Ignore
    }
  }

  playGlancingBlow(forceRatio = 1.0, isFrozen = false, isWet = false) {
    this._recordEvent('glancing_blow');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      // Skittering bark scrape + off-axis steel blade ring + block rim clip
      this._playNoiseSlice({
        type: 'white',
        duration: 0.15,
        filterType: 'bandpass',
        freqStart: isFrozen ? 2800 : isWet ? 1400 : 1950,
        freqEnd: 920,
        q: 2.8,
        gainStart: 0.2 * Math.min(1.4, forceRatio)
      });
      this._playTone({
        oscType: 'sine',
        duration: 0.22,
        freqStart: 1580,
        freqEnd: 1390,
        gainPeak: 0.12
      });
      this.playBlockAnvilHit(forceRatio * 0.75);
    } catch {
      // Ignore
    }
  }

  playBlockAnvilHit(forceRatio = 1.0) {
    this._recordEvent('block_anvil_hit');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      // Deep oak chopping block end-grain thud
      this._playTone({
        oscType: 'triangle',
        duration: 0.18,
        freqStart: 122,
        freqEnd: 38,
        gainPeak: 0.28 * Math.min(1.4, forceRatio),
        filterFreq: 280
      });
    } catch {
      // Ignore
    }
  }

  playNailHazardClang(intensity = 1.0) {
    this._recordEvent('nail_clang');
    this.playSparkClang(intensity * 1.35);
  }

  playSparkClang(intensity = 1.0) {
    this._recordEvent('spark_clang');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const mult = Math.max(0.3, Math.min(1.6, intensity));
      const freqs = [1840, 2760, 4120, 5540];
      freqs.forEach((f, idx) => {
        this._playTone({
          oscType: idx === 0 ? 'triangle' : 'sine',
          startTime: now,
          duration: 0.3 + idx * 0.03,
          freqStart: f,
          freqEnd: f * 0.93,
          gainPeak: (0.13 / (idx + 1)) * mult
        });
      });
      // High incandescent spark sizzle
      this._playNoiseSlice({
        type: 'white',
        startTime: now,
        duration: 0.14,
        filterType: 'highpass',
        freqStart: 4200,
        q: 1.2,
        gainStart: 0.1 * mult
      });
    } catch {
      // Ignore audio errors
    }
  }

  playRockRicochet(intensity = 1.0) {
    this._recordEvent('rock_ricochet');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playSparkClang(1.25 * intensity);
      // Heavy granite stone crunch + ricochet whine
      this._playNoiseSlice({
        type: 'brown',
        duration: 0.18,
        filterType: 'bandpass',
        freqStart: 860,
        freqEnd: 420,
        q: 1.8,
        gainStart: 0.34
      });
      this._playTone({
        oscType: 'sine',
        duration: 0.21,
        freqStart: 2480,
        freqEnd: 1620,
        gainPeak: 0.09
      });
    } catch {
      // Ignore audio errors
    }
  }

  playIceCrack(intensity = 1.0) {
    this._recordEvent('ice_crack');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      this._playNoiseSlice({
        type: 'white',
        startTime: now,
        duration: 0.11,
        filterType: 'bandpass',
        freqStart: 3200,
        freqEnd: 1850,
        q: 3.2,
        gainStart: 0.18 * intensity
      });
      this._playTone({
        oscType: 'sine',
        startTime: now,
        duration: 0.12,
        freqStart: 2840,
        freqEnd: 1960,
        gainPeak: 0.08 * intensity
      });
    } catch {
      // Ignore
    }
  }

  playIceShatter(intensity = 1.0) {
    this._recordEvent('ice_shatter');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      this.playIceCrack(intensity);
      [2637, 3322, 4186, 4978].forEach((freq, i) => {
        this._playTone({
          oscType: 'sine',
          startTime: now + i * 0.022,
          duration: 0.18,
          freqStart: freq,
          freqEnd: freq * 0.96,
          gainPeak: 0.075 / (1 + i * 0.25)
        });
      });
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // 3. PROGRESSIVE CRACKING, CLEAN SPLIT & FRAGMENT LANDINGS
  // ============================================================================

  /**
   * Progressive wood-fiber snapping & creaking as a split develops across multiple hits.
   */
  playProgressiveCrack(damageRatio = 0.5) {
    this._recordEvent('progressive_crack');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const ratio = Math.max(0.1, Math.min(1.0, damageRatio));
      const snapCount = 2 + Math.floor(ratio * 3);
      for (let i = 0; i < snapCount; i++) {
        const tOffset = i * 0.032;
        const snapFreq = 950 + ratio * 650 + i * 180;
        this._playNoiseSlice({
          type: 'white',
          startTime: now + tOffset,
          duration: 0.038,
          filterType: 'bandpass',
          freqStart: snapFreq,
          q: 3.5,
          gainStart: 0.14 * (0.6 + ratio * 0.5)
        });
      }
      this.playFiberCreak(0.8 + ratio * 0.5);
    } catch {
      // Ignore
    }
  }

  playFiberCreak(intensity = 1.0) {
    this._recordEvent('fiber_creak');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this._playTone({
        oscType: 'sawtooth',
        duration: 0.16,
        freqStart: 118,
        freqMid: 78,
        freqEnd: 146,
        gainPeak: 0.14 * Math.min(1.5, intensity),
        filterFreq: 420
      });
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Clean wood split: satisfying wood-core "pop" + tearing wood fibers + deep chopping block thump.
   */
  playWoodSplit(forceRatio = 1.0, isFrozen = false) {
    this._recordEvent('wood_split');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const mult = Math.max(0.4, Math.min(1.5, forceRatio));

      // 1. Satisfying wood-grain release "POP"
      this._playTone({
        oscType: 'triangle',
        startTime: now,
        duration: 0.095,
        freqStart: isFrozen ? 340 : 275,
        freqEnd: 58,
        gainPeak: 0.42 * mult
      });

      // 2. Sharp wood fiber crack & tearing grain rip
      const crackDur = isFrozen ? 0.15 : 0.19;
      this._playNoiseSlice({
        type: 'pink',
        startTime: now,
        duration: crackDur,
        filterType: 'bandpass',
        freqStart: isFrozen ? 1720 : 1220,
        freqEnd: isFrozen ? 980 : 640,
        q: isFrozen ? 2.0 : 1.4,
        gainStart: 0.46 * mult
      });

      // Secondary fiber-tear tail
      this._playNoiseSlice({
        type: 'white',
        startTime: now + 0.035,
        duration: 0.14,
        filterType: 'bandpass',
        freqStart: 2150,
        freqEnd: 820,
        q: 2.2,
        gainStart: 0.22 * mult
      });

      // 3. Deep oak chopping-block anvil thump
      this._playTone({
        oscType: 'sine',
        startTime: now + 0.01,
        duration: 0.21,
        freqStart: isFrozen ? 185 : 152,
        freqEnd: 40,
        gainPeak: 0.42 * mult
      });

      if (isFrozen) {
        this.playIceShatter(mult * 0.85);
      }

      // Trigger celebratory musical stinger & duck soundtrack briefly
      this.playCelebratoryStinger(mult >= 1.25);
    } catch {
      // Ignore audio errors
    }
  }

  playWoodWedge(forceRatio = 0.8) {
    this._recordEvent('wood_wedge');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const mult = Math.max(0.3, Math.min(1.4, forceRatio));
      this._playTone({
        oscType: 'sine',
        duration: 0.13,
        freqStart: 142,
        freqEnd: 50,
        gainPeak: 0.36 * mult
      });
      this._playNoiseSlice({
        type: 'pink',
        duration: 0.07,
        filterType: 'bandpass',
        freqStart: 880,
        freqEnd: 460,
        q: 2.4,
        gainStart: 0.16 * mult
      });
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Rate-limited wooden fragment landing thud & roll clatter scaled by impact speed.
   */
  playWoodKnock(intensity = 0.5, isRoll = false) {
    const nowPerf = performance.now();
    if (nowPerf - this._lastKnockTime < 42) return;
    this._lastKnockTime = nowPerf;

    this._recordEvent(isRoll ? 'fragment_roll' : 'wood_knock');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const clamped = Math.max(0.08, Math.min(1.2, intensity));
      const baseFreq = (isRoll ? 310 : 215) + Math.random() * 130;
      const gainVal = Math.min(0.24, clamped * 0.18);

      this._playTone({
        oscType: 'triangle',
        startTime: now,
        duration: isRoll ? 0.055 : 0.085,
        freqStart: baseFreq,
        freqEnd: baseFreq * 0.44,
        gainPeak: gainVal,
        filterFreq: 680
      });

      // Subtle secondary roll/settle tap when a heavy log half lands
      if (!isRoll && clamped > 0.45) {
        this._recordEvent('fragment_roll');
        this._playTone({
          oscType: 'sine',
          startTime: now + 0.075,
          duration: 0.05,
          freqStart: baseFreq * 1.18,
          freqEnd: baseFreq * 0.6,
          gainPeak: gainVal * 0.48
        });
      }
    } catch {
      // Ignore audio errors
    }
  }

  // ============================================================================
  // 4. WEDGES, PEAVEY & LOG MANIPULATION
  // ============================================================================

  playWedgePlant() {
    this._recordEvent('wedge_plant');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Crisp forged-steel set-tap into wood kerf + wood fiber bite
      this._playTone({
        oscType: 'triangle',
        startTime: now,
        duration: 0.1,
        freqStart: 1480,
        freqEnd: 620,
        gainPeak: 0.2
      });
      this._playNoiseSlice({
        type: 'pink',
        startTime: now + 0.015,
        duration: 0.06,
        filterType: 'bandpass',
        freqStart: 1150,
        q: 2.5,
        gainStart: 0.12
      });
    } catch {
      // Ignore audio errors
    }
  }

  playWedgeHammer(depthStage = 1) {
    this._recordEvent('wedge_hammer');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 1. Ringing forged-steel sledge/maul anvil tink (pitch rises as wedge tightens!)
      const pitchShift = 1.0 + Math.min(3, depthStage) * 0.085;
      const freqs = [2120 * pitchShift, 3180 * pitchShift, 4640 * pitchShift];
      freqs.forEach((f, idx) => {
        this._playTone({
          oscType: idx === 0 ? 'triangle' : 'sine',
          startTime: now,
          duration: 0.34,
          freqStart: f,
          freqEnd: f * 0.96,
          gainPeak: 0.16 / (idx + 1)
        });
      });

      // 2. High-friction wood-on-steel squeak + deep internal wood fiber groan
      this._playTone({
        oscType: 'sine',
        startTime: now + 0.025,
        duration: 0.09,
        freqStart: 2280,
        freqEnd: 1720,
        gainPeak: 0.065
      });
      this.playFiberCreak(1.15);
    } catch {
      // Ignore audio errors
    }
  }

  playTandemCrackWalk() {
    this._recordEvent('tandem_crack_walk');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWedgeHammer(3);
      this.playProgressiveCrack(0.95);
    } catch {
      // Ignore audio errors
    }
  }

  playWedgeExtract(didSplit = false) {
    this._recordEvent('wedge_extract');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Strained kerf levering creak + extraction pop
      this.playFiberCreak(1.2);
      this._playTone({
        oscType: 'triangle',
        startTime: now + 0.04,
        duration: 0.09,
        freqStart: 190,
        freqEnd: 380,
        gainPeak: 0.16
      });
      if (didSplit) {
        this.playWoodSplit(1.15, false);
      }
    } catch {
      // Ignore
    }
  }

  playLogRotate() {
    this._recordEvent('log_rotate');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      // Rough bark scuffing on the oak chopping block
      this._playNoiseSlice({
        type: 'brown',
        duration: 0.09,
        filterType: 'bandpass',
        freqStart: 360,
        freqEnd: 520,
        q: 2.0,
        gainStart: 0.14
      });
    } catch {
      // Ignore
    }
  }

  playLogFlip() {
    this._recordEvent('log_flip');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      this.playWhoosh(0.65);
      this._playTone({
        oscType: 'triangle',
        startTime: now + 0.08,
        duration: 0.16,
        freqStart: 168,
        freqEnd: 46,
        gainPeak: 0.32
      });
    } catch {
      // Ignore audio errors
    }
  }

  playPeaveyHeave() {
    this._recordEvent('peavey_heave');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 1. Steel cant-hook dog-tooth bite clink into bark
      this._playTone({
        oscType: 'triangle',
        startTime: now,
        duration: 0.1,
        freqStart: 1680,
        freqEnd: 740,
        gainPeak: 0.2
      });
      // 2. Ash-handle lever creak + heavy log seat thud on the oak block
      this.playFiberCreak(0.95);
      this._playTone({
        oscType: 'sine',
        startTime: now + 0.1,
        duration: 0.17,
        freqStart: 142,
        freqEnd: 44,
        gainPeak: 0.34
      });
    } catch {
      // Ignore audio errors
    }
  }

  // ============================================================================
  // 5. BOSSES (INTRO STING, HIT, PHASE BREAK, DEFEATED FANFARE)
  // ============================================================================

  playBossIntro() {
    this._recordEvent('boss_intro');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Ominous low mountain-horn power fifth (E2 + B2 -> Eb2 + Bb2) + heavy anvil thud
      [82.41, 123.47, 164.81].forEach((freq, idx) => {
        this._playTone({
          oscType: 'sawtooth',
          startTime: now + idx * 0.04,
          duration: 0.58,
          freqStart: freq,
          freqEnd: freq * 0.94,
          gainPeak: 0.14 / (1 + idx * 0.3),
          attack: 0.06,
          filterFreq: 520
        });
      });
      this._playTone({
        oscType: 'sine',
        startTime: now,
        duration: 0.32,
        freqStart: 110,
        freqEnd: 32,
        gainPeak: 0.34
      });
    } catch {
      // Ignore
    }
  }

  playBossHit(damageRatio = 0.4) {
    this._recordEvent('boss_hit');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      this._playTone({
        oscType: 'sawtooth',
        startTime: now,
        duration: 0.22,
        freqStart: 96 + damageRatio * 30,
        freqEnd: 34,
        gainPeak: 0.26,
        filterFreq: 320
      });
    } catch {
      // Ignore
    }
  }

  playBossPhaseBreak() {
    this._recordEvent('boss_phase_break');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Heavy structural timber fracture + brass warning stab
      this._playNoiseSlice({
        type: 'pink',
        startTime: now,
        duration: 0.22,
        filterType: 'bandpass',
        freqStart: 1150,
        freqEnd: 480,
        q: 1.6,
        gainStart: 0.32
      });
      [146.83, 220.0].forEach((f) => {
        this._playTone({
          oscType: 'sawtooth',
          startTime: now + 0.02,
          duration: 0.28,
          freqStart: f,
          freqEnd: f * 1.04,
          gainPeak: 0.14,
          filterFreq: 680
        });
      });
    } catch {
      // Ignore
    }
  }

  playBossSplit() {
    this._recordEvent('boss_split');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.45, false);
      const now = ctx.currentTime;
      // Seismic sub-bass drop
      this._playTone({
        oscType: 'sawtooth',
        startTime: now,
        duration: 0.42,
        freqStart: 92,
        freqEnd: 26,
        gainPeak: 0.34,
        filterFreq: 260
      });
      this.playBossDefeatedFanfare();
    } catch {
      // Ignore audio errors
    }
  }

  playBossDefeatedFanfare() {
    this._recordEvent('boss_fanfare');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Triumphant 4-step lumberjack brass & banjo victory fanfare (D4 - F#4 - A4 - D5)
      const notes = [293.66, 369.99, 440.0, 587.33];
      notes.forEach((freq, i) => {
        const t0 = now + 0.08 + i * 0.095;
        const dur = i === notes.length - 1 ? 0.48 : 0.22;
        this._playTone({
          oscType: 'sawtooth',
          startTime: t0,
          duration: dur,
          freqStart: freq,
          freqEnd: freq * 1.005,
          gainPeak: 0.15,
          attack: 0.015,
          filterFreq: 1650
        });
        this._playKarplusPluck(freq * 2, t0, 0.12, 'banjo', this.sfxBus);
      });
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // 6. SPECIAL LOG SHATTERS & BONFIRE / WHETSTONE SFX
  // ============================================================================

  playBranchLop() {
    this._recordEvent('branch_lop');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.05, false);
      this.playFiberCreak(0.9);
    } catch {
      // Ignore audio errors
    }
  }

  playBurlShear() {
    this._recordEvent('burl_shear');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playBranchLop();
      this._playTone({
        oscType: 'triangle',
        duration: 0.16,
        freqStart: 280,
        freqEnd: 95,
        gainPeak: 0.24
      });
    } catch {
      // Ignore audio errors
    }
  }

  playKindlingShatter() {
    this._recordEvent('kindling_shatter');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.3, false);
      const now = ctx.currentTime;
      // Multi-stick kindling clatter cascade scheduled on AudioContext time
      [0.05, 0.1, 0.15, 0.21].forEach((delay, idx) => {
        this._playTone({
          oscType: 'triangle',
          startTime: now + delay,
          duration: 0.065,
          freqStart: 260 + idx * 55,
          freqEnd: 115 + idx * 20,
          gainPeak: 0.16 * (1 - idx * 0.18)
        });
      });
    } catch {
      // Ignore audio errors
    }
  }

  playSapSizzle() {
    this._recordEvent('sap_sizzle');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this._playNoiseSlice({
        type: 'white',
        duration: 0.25,
        filterType: 'bandpass',
        freqStart: 3400,
        freqEnd: 1600,
        q: 2.6,
        gainStart: 0.16
      });
    } catch {
      // Ignore audio errors
    }
  }

  playWhetstoneHone() {
    this._recordEvent('whetstone_hone');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      this._playNoiseSlice({
        type: 'white',
        startTime: now,
        duration: 0.22,
        filterType: 'bandpass',
        freqStart: 2400,
        freqEnd: 4800,
        q: 5.5,
        gainStart: 0.02,
        gainPeak: 0.18
      });
      this._playTone({
        oscType: 'sine',
        startTime: now + 0.04,
        duration: 0.25,
        freqStart: 3120,
        freqEnd: 3640,
        gainPeak: 0.08
      });
    } catch {
      // Ignore audio errors
    }
  }

  playBonfireStoke() {
    this._recordEvent('bonfire_stoke');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      this._playNoiseSlice({
        type: 'brown',
        startTime: now,
        duration: 0.34,
        filterType: 'lowpass',
        freqStart: 420,
        freqEnd: 980,
        q: 1.0,
        gainStart: 0.05,
        gainPeak: 0.24
      });
      [0.06, 0.14, 0.22].forEach((offset) => {
        this._playTone({
          oscType: 'square',
          startTime: now + offset,
          duration: 0.028,
          freqStart: 1400 + Math.random() * 900,
          freqEnd: 820,
          gainPeak: 0.055
        });
      });
    } catch {
      // Ignore audio errors
    }
  }

  playEmberTemperIgnite() {
    this._recordEvent('ember_ignite');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playBonfireStoke();
      this.playWhetstoneHone();
    } catch {
      // Ignore audio errors
    }
  }

  playLightningFissureShatter() {
    this._recordEvent('lightning_fissure_shatter');
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
    this._recordEvent('geode_shatter');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this.playWoodSplit(1.25, true);
      const now = ctx.currentTime;
      const crystalNotes = [1567.98, 2093.0, 2637.02, 3135.96];
      crystalNotes.forEach((freq, i) => {
        this._playTone({
          oscType: 'sine',
          startTime: now + i * 0.032,
          duration: 0.34,
          freqStart: freq,
          freqEnd: freq * 1.04,
          gainPeak: 0.095 / (1 + i * 0.25)
        });
      });
    } catch {
      // Ignore audio errors
    }
  }

  // ============================================================================
  // 7. UI CLICKS, HOVERS, SHOP, ERRORS & TIMING METER SFX
  // ============================================================================

  playUIHover() {
    const nowPerf = performance.now();
    if (nowPerf - this._lastHoverTime < 65) return;
    this._lastHoverTime = nowPerf;
    this._recordEvent('ui_hover');

    if (!this.ctx || this.ctx.state !== 'running') return;
    try {
      this._playTone({
        oscType: 'sine',
        duration: 0.016,
        freqStart: 1020,
        freqEnd: 1340,
        gainPeak: 0.025
      });
    } catch {
      // Ignore
    }
  }

  playUIClick() {
    this._recordEvent('ui_click');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this._playTone({
        oscType: 'triangle',
        duration: 0.028,
        freqStart: 640,
        freqEnd: 260,
        gainPeak: 0.09
      });
    } catch {
      // Ignore
    }
  }

  playUpgrade() {
    this._recordEvent('shop_upgrade');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const chord = [587.33, 880.0, 1174.66];
      chord.forEach((f, idx) => {
        this._playTone({
          oscType: 'triangle',
          startTime: now + idx * 0.04,
          duration: 0.18,
          freqStart: f,
          freqEnd: f * 1.02,
          gainPeak: 0.13 / (1 + idx * 0.2)
        });
      });
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Not-enough-currency or locked action buzz.
   */
  playErrorBuzz() {
    this._recordEvent('error_buzz');
    this.unlockAndStart();
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [165, 118].forEach((freq, idx) => {
        this._playTone({
          oscType: 'sawtooth',
          startTime: now + idx * 0.085,
          duration: 0.08,
          freqStart: freq,
          freqEnd: freq * 0.92,
          gainPeak: 0.12,
          filterFreq: 480
        });
      });
    } catch {
      // Ignore
    }
  }

  playMeterStart() {
    this._recordEvent('meter_start');
    this.unlockAndStart();
    this._lastMeterZone = '';
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this._playTone({
        oscType: 'triangle',
        duration: 0.045,
        freqStart: 520,
        freqEnd: 820,
        gainPeak: 0.11
      });
    } catch {
      // Ignore
    }
  }

  /**
   * Subtle timing-meter tick pulsed as the needle crosses zones or every ~85ms.
   */
  playMeterTick(meterPos = 0.5) {
    const zone =
      meterPos >= 0.68 && meterPos <= 0.86
        ? 'sweet'
        : meterPos > 0.86
        ? 'wild'
        : meterPos >= 0.35
        ? 'solid'
        : 'weak';
    const nowPerf = performance.now();
    if (zone === this._lastMeterZone && nowPerf - this._lastMeterTickTime < 85) {
      return;
    }
    this._lastMeterZone = zone;
    this._lastMeterTickTime = nowPerf;
    this._recordEvent('meter_tick');

    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const freq = zone === 'sweet' ? 1480 : 780 + meterPos * 520;
      this._playTone({
        oscType: 'sine',
        duration: 0.022,
        freqStart: freq,
        freqEnd: freq * 0.85,
        gainPeak: zone === 'sweet' ? 0.085 : 0.045
      });
    } catch {
      // Ignore
    }
  }

  /**
   * Golden sweet-spot bell ding when locking the timing meter in the 135% PERFECT zone.
   */
  playPerfectZoneDing() {
    this._recordEvent('perfect_zone_ding');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [1046.5, 1567.98, 2093.0].forEach((freq, idx) => {
        this._playTone({
          oscType: 'sine',
          startTime: now + idx * 0.018,
          duration: 0.28,
          freqStart: freq,
          freqEnd: freq * 1.005,
          gainPeak: 0.12 / (1 + idx * 0.3)
        });
      });
    } catch {
      // Ignore
    }
  }

  playMeterLock(zone = 'solid') {
    this._recordEvent('meter_lock');
    if (zone === 'sweet') {
      this.playPerfectZoneDing();
      return;
    }
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const f = zone === 'solid' ? 680 : zone === 'wild' ? 420 : 310;
      this._playTone({
        oscType: 'triangle',
        duration: 0.07,
        freqStart: f,
        freqEnd: f * 1.12,
        gainPeak: 0.1
      });
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // 8. REWARDS (POINTS, COMBO RISING PITCH, PERFECT HIT, LEVEL UP, CONTRACTS, ACHIEVEMENTS)
  // ============================================================================

  playPointsGain(points = 100) {
    if (points <= 0) return;
    this._recordEvent('points_gain');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const baseF = 680 + Math.min(450, points * 0.45);
      this._playTone({
        oscType: 'sine',
        duration: 0.075,
        freqStart: baseF,
        freqEnd: baseF * 1.25,
        gainPeak: 0.075
      });
    } catch {
      // Ignore
    }
  }

  /**
   * Rising-pitch chime as combo streak increments (1x, 2x, 3x ... 12x+).
   */
  playComboIncrement(combo = 1) {
    this._recordEvent('combo_up');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const semitones = Math.min(16, Math.max(0, combo - 1));
      const freq = 392.0 * Math.pow(2, semitones / 12);
      this._playTone({
        oscType: 'triangle',
        startTime: now,
        duration: 0.16,
        freqStart: freq,
        freqEnd: freq * 1.06,
        gainPeak: 0.11
      });
      if (combo >= 5 && combo % 5 === 0) {
        this.playAchievement();
      }
    } catch {
      // Ignore
    }
  }

  playComboBreak() {
    this._recordEvent('combo_break');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      this._playTone({
        oscType: 'sawtooth',
        duration: 0.18,
        freqStart: 295,
        freqEnd: 135,
        gainPeak: 0.1,
        filterFreq: 520
      });
    } catch {
      // Ignore
    }
  }

  playPerfectHit() {
    this._recordEvent('perfect_hit');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [587.33, 880.0, 1174.66, 1479.98].forEach((f, idx) => {
        this._playTone({
          oscType: 'triangle',
          startTime: now + idx * 0.025,
          duration: 0.26,
          freqStart: f,
          freqEnd: f * 1.01,
          gainPeak: 0.11 / (1 + idx * 0.2)
        });
      });
    } catch {
      // Ignore
    }
  }

  playLevelUp() {
    this._recordEvent('level_up');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, i) => {
        this._playTone({
          oscType: 'triangle',
          startTime: now + i * 0.07,
          duration: 0.28,
          freqStart: freq,
          freqEnd: freq * 1.01,
          gainPeak: 0.14,
          attack: 0.015
        });
      });
    } catch {
      // Ignore audio errors
    }
  }

  playContractComplete() {
    this._recordEvent('contract_complete');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 1. Crisp twine-tie & roadside cash-box clink
      this._playTone({
        oscType: 'triangle',
        startTime: now,
        duration: 0.1,
        freqStart: 2240,
        freqEnd: 3480,
        gainPeak: 0.14
      });
      // 2. Cheerful 4-note contract payout chime
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((f, idx) => {
        this._playTone({
          oscType: 'triangle',
          startTime: now + 0.05 + idx * 0.055,
          duration: 0.24,
          freqStart: f,
          gainPeak: 0.11
        });
      });
    } catch {
      // Ignore audio errors
    }
  }

  playAchievement() {
    this._recordEvent('achievement');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = [587.33, 739.99, 880.0, 1174.66, 1479.98];
      notes.forEach((f, idx) => {
        this._playTone({
          oscType: 'sine',
          startTime: now + idx * 0.045,
          duration: 0.25,
          freqStart: f,
          freqEnd: f * 1.015,
          gainPeak: 0.1
        });
      });
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // 9. WEATHER / TIME AMBIENCE & CROSSFADE BEDS
  // ============================================================================

  /**
   * Initializes persistent looping ambient filter beds (sun breeze, rain bed, wind gusts, snow hush)
   * that smoothly crossfade when weather or time-of-day changes.
   */
  _initAmbientBeds() {
    if (this._ambientInitialized || !this.ctx || !this._pinkNoiseBuf || !this._brownNoiseBuf) {
      return;
    }
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;

      const makeLoopBed = (buf, filterType, freq, q) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.setValueAtTime(freq, now);
        filter.Q.setValueAtTime(q, now);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.ambienceBus);
        src.start(now, Math.random() * 1.5);
        return { src, filter, gain };
      };

      this._ambientBeds = {
        sun: makeLoopBed(this._pinkNoiseBuf, 'lowpass', 360, 0.7),
        rain: makeLoopBed(this._pinkNoiseBuf, 'bandpass', 1750, 0.85),
        wind: makeLoopBed(this._brownNoiseBuf, 'bandpass', 340, 2.2),
        snow: makeLoopBed(this._brownNoiseBuf, 'lowpass', 180, 0.6)
      };
      this._ambientInitialized = true;
      this._applyWeatherCrossfade(this._currentAmbientWeather, this._currentIsNight);
    } catch {
      // Ignore ambient bed init errors
    }
  }

  /**
   * Crossfades ambient weather beds when weather or day/night changes.
   */
  setWeatherAmbience(weather = 'sun', timeOfDay = 17.0) {
    const isNight = timeOfDay < 5.8 || timeOfDay > 19.2;
    if (weather !== this._currentAmbientWeather) {
      this._recordEvent('weather_crossfade');
    }
    this._currentAmbientWeather = weather;
    this._currentIsNight = isNight;
    if (this._ambientInitialized) {
      this._applyWeatherCrossfade(weather, isNight);
    }
  }

  _applyWeatherCrossfade(weather, isNight) {
    if (!this._ambientBeds || !this.ctx) return;
    const now = this.ctx.currentTime;
    const tau = 0.35; // Smooth ~1s exponential crossfade

    const targets = {
      sun: weather === 'sun' ? (isNight ? 0.008 : 0.018) : 0.0001,
      rain: weather === 'rain' ? 0.055 : 0.0001,
      wind: weather === 'wind' ? 0.065 : weather === 'rain' ? 0.025 : 0.004,
      snow: weather === 'snow' || weather === 'fog' ? 0.022 : 0.0001
    };

    this._ambientBeds.sun.gain.gain.setTargetAtTime(targets.sun, now, tau);
    this._ambientBeds.rain.gain.gain.setTargetAtTime(targets.rain, now, tau);
    this._ambientBeds.wind.gain.gain.setTargetAtTime(targets.wind, now, tau);
    this._ambientBeds.snow.gain.gain.setTargetAtTime(targets.snow, now, tau);
  }

  playThunderclap(intensity = 1.0) {
    this._recordEvent('thunderclap');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const mult = Math.max(0.3, Math.min(1.5, intensity));
      // 1. Sharp electrostatic lightning crack
      this._playNoiseSlice({
        type: 'white',
        startTime: now,
        duration: 0.18,
        filterType: 'bandpass',
        freqStart: 1450,
        freqEnd: 680,
        q: 1.1,
        gainStart: 0.28 * mult
      });
      // 2. Deep rolling suburban thunderstorm rumble
      this._playNoiseSlice({
        type: 'brown',
        startTime: now + 0.04,
        duration: 0.82,
        filterType: 'lowpass',
        freqStart: 155,
        freqEnd: 46,
        q: 0.9,
        gainStart: 0.04,
        gainPeak: 0.36 * mult
      });
    } catch {
      // Ignore audio errors
    }
  }

  playCritterScatter() {
    this._recordEvent('critter_scatter');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [0, 0.07].forEach((offset, i) => {
        this._playTone({
          oscType: 'sine',
          startTime: now + offset,
          duration: 0.06,
          freqStart: i === 0 ? 2680 : 3240,
          freqEnd: 1920,
          gainPeak: 0.06
        });
      });
    } catch {
      // Ignore audio errors
    }
  }

  /**
   * Steps the procedural backyard weather beds, birdsong, rain drips, wind gusts,
   * bonfire crackle, evening crickets, and look-ahead music scheduler.
   */
  tickAmbientSoundscape(
    dt,
    weather = 'sun',
    timeOfDay = 17.0,
    bonfireLevel = 1,
    windStrength = 0.2
  ) {
    // Smoothly approach target music intensity
    this.intensity += (this._targetIntensity - this.intensity) * Math.min(1, dt * 3.2);

    if (!this.enabled || !this.ctx || this.ctx.state !== 'running' || this._isHidden) {
      return;
    }

    this._initAmbientBeds();

    const isNight = timeOfDay < 5.8 || timeOfDay > 19.2;
    if (weather !== this._currentAmbientWeather || isNight !== this._currentIsNight) {
      this.setWeatherAmbience(weather, timeOfDay);
    }

    // Modulate wind filter cutoff smoothly with wind gusts
    if (this._ambientBeds && this._ambientBeds.wind) {
      const gustCutoff = 220 + Math.min(1.5, windStrength) * 320 + Math.sin(this.ctx.currentTime * 1.7) * 85;
      this._ambientBeds.wind.filter.frequency.setTargetAtTime(
        Math.max(120, gustCutoff),
        this.ctx.currentTime,
        0.12
      );
    }

    // Keep look-ahead music scheduler fed even if setInterval is throttled
    if (this._musicSchedulerActive && !this.musicMuted && this.musicVolume > 0) {
      this._tickMusicScheduler();
    }

    this._ambientOneShotTimer += dt;
    if (this._ambientOneShotTimer < 1.35) return;
    this._ambientOneShotTimer = 0;

    try {
      const now = this.ctx.currentTime;

      // 1. Backyard Bonfire ember crackle pop
      if (bonfireLevel >= 2 && weather !== 'rain') {
        this._recordEvent('ambient_fire_pop');
        this._playTone({
          oscType: 'triangle',
          startTime: now + 0.02,
          duration: 0.038,
          freqStart: 1150 + Math.random() * 600,
          freqEnd: 580,
          gainPeak: 0.016 * Math.min(2, bonfireLevel * 0.45),
          destination: this.ambienceBus
        });
      }

      // 2. Weather & Time-of-Day organic one-shots
      if (weather === 'rain') {
        // Raindrop puddle drips
        this._recordEvent('ambient_rain_drip');
        const dripFreq = 980 + Math.random() * 540;
        this._playTone({
          oscType: 'sine',
          startTime: now,
          duration: 0.045,
          freqStart: dripFreq,
          freqEnd: dripFreq * 1.42,
          gainPeak: 0.022,
          destination: this.ambienceBus
        });
      } else if (weather === 'wind') {
        // Gusting leaf-swirl whoosh
        this._recordEvent('ambient_wind_gust');
        this._playNoiseSlice({
          type: 'pink',
          startTime: now,
          duration: 0.48,
          filterType: 'bandpass',
          freqStart: 280,
          freqEnd: 620,
          q: 2.8,
          gainStart: 0.004,
          gainPeak: 0.028,
          destination: this.ambienceBus
        });
      } else if (weather === 'snow') {
        // Quiet winter frost shimmer
        this._recordEvent('ambient_snow_hush');
        this._playTone({
          oscType: 'sine',
          startTime: now,
          duration: 0.22,
          freqStart: 3136,
          freqEnd: 3180,
          gainPeak: 0.006,
          attack: 0.05,
          destination: this.ambienceBus
        });
      } else if (isNight && (weather === 'sun' || weather === 'fog')) {
        // Suburban NJ evening cricket double-chirp
        this._recordEvent('ambient_cricket');
        [0, 0.085].forEach((offset) => {
          this._playTone({
            oscType: 'sine',
            startTime: now + offset,
            duration: 0.06,
            freqStart: 4180,
            freqEnd: 4120,
            gainPeak: 0.014,
            attack: 0.012,
            destination: this.ambienceBus
          });
        });
      } else if (!isNight && weather === 'sun') {
        // Melodic daytime backyard birdsong (chickadee / song sparrow two-note call)
        this._recordEvent('ambient_bird');
        const baseBird = 2480 + Math.random() * 620;
        this._playTone({
          oscType: 'sine',
          startTime: now,
          duration: 0.085,
          freqStart: baseBird,
          freqEnd: baseBird * 1.12,
          gainPeak: 0.016,
          attack: 0.015,
          destination: this.ambienceBus
        });
        this._playTone({
          oscType: 'sine',
          startTime: now + 0.11,
          duration: 0.12,
          freqStart: baseBird * 0.84,
          freqEnd: baseBird * 0.82,
          gainPeak: 0.014,
          attack: 0.015,
          destination: this.ambienceBus
        });
      }
    } catch {
      // Ignore ambient audio errors
    }
  }

  // ============================================================================
  // 10. ORIGINAL PROCEDURAL FOLK / LUMBERJACK SOUNDTRACK SCHEDULER
  // ============================================================================

  /**
   * Deterministic LCG PRNG so chord progressions & banjo/fiddle licks vary across 8-bar phrases.
   */
  _nextMusicRand() {
    this._musicSeed = (Math.imul(this._musicSeed, 1664525) + 1013904223) >>> 0;
    return (this._musicSeed >>> 8) / 16777216;
  }

  /**
   * Updates the soundtrack section ('menu' | 'gameplay' | 'boss') and dynamic intensity (0..1)
   * based on combo streak, active boss log, game mode, and idle state.
   */
  updateMusicState({
    isBoss = false,
    combo = 0,
    isSwinging = false,
    shopOpen = false,
    gameMode = 'campaign',
    isActiveGameplay = true
  } = {}) {
    let nextSection = 'gameplay';
    if (isBoss && !shopOpen) {
      nextSection = 'boss';
    } else if (shopOpen || !isActiveGameplay) {
      nextSection = 'menu';
    } else {
      nextSection = 'gameplay';
    }

    if (nextSection !== this.musicSection) {
      this.musicSection = nextSection;
      this._activeProgression = this._pickProgressionForSection(nextSection);
      if (nextSection === 'boss') {
        this.playBossIntro();
      }
    }

    if (nextSection === 'menu') {
      this._targetIntensity = 0.22;
    } else if (nextSection === 'boss') {
      this._targetIntensity = Math.min(1.0, 0.84 + Math.min(0.16, combo * 0.03));
      this.intensity = Math.max(this.intensity, 0.78);
    } else {
      const modeBoost = gameMode === 'time_attack' ? 0.15 : gameMode === 'endless' ? 0.08 : 0;
      const swingBoost = isSwinging ? 0.08 : 0;
      const streakBoost = Math.min(0.52, combo * 0.065);
      this._targetIntensity = Math.max(0.32, Math.min(1.0, 0.35 + streakBoost + modeBoost + swingBoost));
      if (isSwinging || combo > 0) {
        this.intensity = Math.max(this.intensity, this._targetIntensity * 0.85);
      }
    }
  }

  /**
   * Starts the look-ahead Web Audio soundtrack scheduler.
   */
  startMusic() {
    if (!this.enabled || this.musicMuted || this.musicVolume <= 0) {
      this._musicSchedulerActive = false;
      return false;
    }
    const ctx = this._ensureContext();
    if (!ctx) return false;

    if (!this._activeProgression) {
      this._activeProgression = this._pickProgressionForSection(this.musicSection);
    }

    if (!this._musicSchedulerActive) {
      this._musicSchedulerActive = true;
      this._nextNoteTime = ctx.currentTime + 0.03;
    }

    this._tickMusicScheduler();

    if (!this._schedulerTimer) {
      this._schedulerTimer = setInterval(() => {
        if (!this._musicSchedulerActive || this._isHidden || this.musicMuted) return;
        this._tickMusicScheduler();
      }, 40);
    }
    return true;
  }

  stopMusic() {
    this._musicSchedulerActive = false;
    if (this._schedulerTimer) {
      clearInterval(this._schedulerTimer);
      this._schedulerTimer = null;
    }
  }

  /**
   * Look-ahead scheduler on AudioContext.currentTime (schedules 140ms ahead).
   */
  _tickMusicScheduler() {
    if (!this.ctx || !this._musicSchedulerActive || this.musicMuted || this.musicVolume <= 0) {
      return;
    }
    const now = this.ctx.currentTime;
    if (this._nextNoteTime < now - 0.25) {
      this._nextNoteTime = now + 0.02;
    }

    const lookAhead = 0.14;
    let guard = 0;
    while (this._nextNoteTime < now + lookAhead && guard < 16) {
      this._scheduleMusicStep(this._currentStep, this._nextNoteTime);
      this._advanceMusicStep();
      guard++;
    }
  }

  _getCurrentBpm() {
    if (this.musicSection === 'menu') return 92;
    if (this.musicSection === 'boss') return 120 + Math.round(this.intensity * 4);
    return 106 + Math.round(this.intensity * 14); // 106..120 BPM in gameplay
  }

  _advanceMusicStep() {
    const bpm = this._getCurrentBpm();
    const sixteenthDur = 60 / bpm / 4;
    // Slight folk swing feel on even/odd 16th notes
    const swingOffset = this._currentStep % 2 === 0 ? sixteenthDur * 1.06 : sixteenthDur * 0.94;
    this._nextNoteTime += swingOffset;
    this._currentStep = (this._currentStep + 1) % 128;
    if (this._currentStep === 0) {
      this._phraseCount++;
      this._activeProgression = this._pickProgressionForSection(this.musicSection);
    }
  }

  /**
   * Picks a seeded 8-bar folk/bluegrass chord progression with variations so it doesn't loop identically.
   */
  _pickProgressionForSection(section) {
    // Each chord entry: { root: Hz (bass), notes: [Hz, Hz, Hz, Hz] (banjo/guitar chord tones), lead: [Hz...] }
    const CHORDS = {
      G: { root: 98.0, fifth: 146.83, notes: [196.0, 246.94, 293.66, 392.0], lead: [392.0, 440.0, 493.88, 587.33] },
      C: { root: 65.41, fifth: 98.0, notes: [261.63, 329.63, 392.0, 523.25], lead: [392.0, 440.0, 523.25, 659.25] },
      D: { root: 73.42, fifth: 110.0, notes: [293.66, 369.99, 440.0, 587.33], lead: [440.0, 493.88, 587.33, 659.25] },
      F: { root: 87.31, fifth: 130.81, notes: [261.63, 349.23, 440.0, 523.25], lead: [349.23, 440.0, 523.25, 587.33] },
      A: { root: 110.0, fifth: 82.41, notes: [220.0, 277.18, 329.63, 440.0], lead: [440.0, 493.88, 554.37, 659.25] },
      Em: { root: 82.41, fifth: 123.47, notes: [164.81, 196.0, 246.94, 329.63], lead: [329.63, 392.0, 440.0, 493.88] },
      B7: { root: 61.74, fifth: 92.5, notes: [185.0, 246.94, 293.66, 369.99], lead: [369.99, 440.0, 493.88, 587.33] }
    };

    const menuSets = [
      ['G', 'G', 'C', 'G', 'D', 'C', 'G', 'D'],
      ['G', 'Em', 'C', 'D', 'G', 'C', 'D', 'G'],
      ['G', 'C', 'G', 'D', 'Em', 'C', 'D', 'G']
    ];
    const gameplaySets = [
      ['D', 'D', 'C', 'G', 'D', 'F', 'C', 'D'],
      ['D', 'G', 'D', 'C', 'G', 'F', 'A', 'D'],
      ['D', 'C', 'G', 'D', 'F', 'G', 'A', 'D'],
      ['D', 'F', 'C', 'G', 'D', 'C', 'A', 'D']
    ];
    const bossSets = [
      ['Em', 'Em', 'G', 'A', 'Em', 'C', 'B7', 'Em'],
      ['Em', 'D', 'C', 'B7', 'Em', 'G', 'A', 'B7'],
      ['Em', 'G', 'A', 'C', 'Em', 'D', 'B7', 'Em']
    ];

    const pool =
      section === 'boss' ? bossSets : section === 'menu' ? menuSets : gameplaySets;
    const idx = Math.floor(this._nextMusicRand() * pool.length) % pool.length;
    return pool[idx].map((name) => CHORDS[name] || CHORDS.D);
  }

  /**
   * Schedules a single 16th-note step of the procedural lumberjack soundtrack.
   */
  _scheduleMusicStep(step, noteTime) {
    if (!this.ctx || !this.musicDuckGain) return;
    this._lastScheduledNoteTime = noteTime;

    const bar = Math.floor(step / 16) % 8;
    const stepInBar = step % 16;
    const prog = this._activeProgression || this._pickProgressionForSection(this.musicSection);
    const chord = prog[bar] || prog[0];
    const inten = this.intensity;
    const isMenu = this.musicSection === 'menu';
    const isBoss = this.musicSection === 'boss';

    // 1. UPRIGHT BASS (low sine/triangle with woody pluck pitch envelope)
    if (stepInBar === 0) {
      this._playUprightBass(chord.root, noteTime, isMenu ? 0.42 : 0.34, isBoss ? 0.34 : 0.28);
    } else if (stepInBar === 8) {
      this._playUprightBass(chord.fifth, noteTime, isMenu ? 0.38 : 0.32, isBoss ? 0.3 : 0.25);
    } else if (!isMenu && (inten > 0.42 || isBoss) && (stepInBar === 4 || stepInBar === 12)) {
      const walkFreq = stepInBar === 4 ? chord.root * 1.122 : chord.fifth * 0.89;
      this._playUprightBass(walkFreq, noteTime, 0.22, 0.19);
    }

    // 2. STOMP-CLAP LUMBERJACK PERCUSSION (boot stomp + hand clap + brushed shaker)
    if (!isMenu) {
      // Boot stomp on beats 1 and 3 (plus syncopated stomp on 3-and at higher intensity)
      if (stepInBar === 0 || stepInBar === 8 || ((inten > 0.6 || isBoss) && stepInBar === 10)) {
        this._playBootStomp(noteTime, stepInBar === 0 ? 0.32 : 0.25);
      }
      // Hand clap / rim clack backbeat on beats 2 and 4
      if (stepInBar === 4 || stepInBar === 12) {
        this._playHandClap(noteTime, 0.18 + inten * 0.08);
      }
      // Brushed train-beat shaker on off-beat 16ths when intensity rises
      if ((inten > 0.35 || isBoss) && stepInBar % 2 === 1) {
        const accent = stepInBar % 4 === 3 ? 1.25 : 0.75;
        this._playShakerBrush(noteTime, 0.035 * accent * (0.6 + inten * 0.5));
      }
    } else if (stepInBar === 0) {
      // Gentle front-porch heel tap on beat 1 in menu
      this._playBootStomp(noteTime, 0.14);
    }

    // 3. ACOUSTIC GUITAR & CLAWHAMMER BANJO (Karplus-Strong string plucks)
    if (isMenu) {
      // Relaxed front-porch acoustic picking on 8th notes
      if (stepInBar % 2 === 0) {
        const pattern = [0, 2, 1, 3, 0, 2, 3, 1];
        const noteIdx = pattern[(stepInBar / 2) % pattern.length];
        const freq = chord.notes[noteIdx % chord.notes.length];
        const inst = stepInBar === 6 || stepInBar === 14 ? 'banjo' : 'guitar';
        this._playKarplusPluck(freq, noteTime, 0.16, inst, this.musicDuckGain);
      }
    } else {
      // Driving acoustic guitar rhythm chop on beats 1-and, 2, 3-and, 4
      if (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14) {
        const gFreq = chord.notes[(stepInBar / 2) % chord.notes.length] * 0.5;
        this._playKarplusPluck(gFreq, noteTime, 0.15, 'guitar', this.musicDuckGain);
      }

      // Clawhammer / Scruggs 16th-note Banjo Roll (densifies as combo/intensity increases!)
      const playEverySixteenth = inten >= 0.45 || isBoss;
      if (playEverySixteenth || stepInBar % 2 === 0 || stepInBar === 3 || stepInBar === 11) {
        const rollPattern = [0, 1, 2, 3, 1, 2, 0, 3, 1, 3, 2, 0, 1, 2, 3, 2];
        let pickIdx = rollPattern[stepInBar];
        if (this._nextMusicRand() < 0.18) {
          pickIdx = (pickIdx + 1) % chord.notes.length;
        }
        const banjoFreq = chord.notes[pickIdx];
        const accent = stepInBar % 4 === 0 ? 1.2 : 0.88;
        this._playKarplusPluck(
          banjoFreq,
          noteTime,
          0.16 * accent * (0.75 + inten * 0.35),
          'banjo',
          this.musicDuckGain
        );
      }
    }

    // 4. FIDDLE / HARMONICA FOLK LEAD DRONE (enters at higher combo intensity or during Boss rounds!)
    if ((inten >= 0.52 || isBoss) && (stepInBar === 0 || stepInBar === 6 || stepInBar === 12)) {
      const leadPool = chord.lead || chord.notes;
      const lIdx = Math.floor(this._nextMusicRand() * leadPool.length) % leadPool.length;
      const leadFreq = leadPool[lIdx];
      const dur = stepInBar === 0 ? 0.36 : 0.24;
      this._playFiddleLead(leadFreq, noteTime, dur, 0.065 * (0.6 + inten * 0.5));
    }
  }

  _playKarplusPluck(freq, startTime, gainVal = 0.16, instrument = 'banjo', destination = null) {
    if (!this.ctx) return;
    const buf = this._getKarplusStrongBuffer(freq, instrument);
    if (!buf) return;

    const t0 = Math.max(this.ctx.currentTime, startTime);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, gainVal), t0);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + buf.duration * 0.95);

    const dest = destination || this.musicDuckGain || this.ctx.destination;
    src.connect(gain);
    gain.connect(dest);

    this._registerVoice(src, t0 + buf.duration + 0.02, [gain]);
    src.start(t0);
    src.stop(t0 + buf.duration);
  }

  _playUprightBass(freq, startTime, duration = 0.32, gainVal = 0.26) {
    this._playTone({
      oscType: 'triangle',
      startTime,
      duration,
      freqStart: freq * 1.03, // Subtle finger-pluck pitch drop
      freqEnd: freq,
      gainPeak: gainVal,
      attack: 0.008,
      filterFreq: 290,
      destination: this.musicDuckGain
    });
  }

  _playBootStomp(startTime, gainVal = 0.28) {
    // Low porch-board boot thump + woody heel transient
    this._playTone({
      oscType: 'sine',
      startTime,
      duration: 0.15,
      freqStart: 112,
      freqEnd: 38,
      gainPeak: gainVal,
      destination: this.musicDuckGain
    });
    this._playNoiseSlice({
      type: 'brown',
      startTime,
      duration: 0.055,
      filterType: 'bandpass',
      freqStart: 190,
      q: 2.0,
      gainStart: gainVal * 0.55,
      destination: this.musicDuckGain
    });
  }

  _playHandClap(startTime, gainVal = 0.18) {
    // Multi-tap lumberjack hand clap
    [0, 0.011, 0.023].forEach((offset, idx) => {
      this._playNoiseSlice({
        type: 'pink',
        startTime: startTime + offset,
        duration: idx === 2 ? 0.085 : 0.032,
        filterType: 'bandpass',
        freqStart: 1350 + idx * 180,
        q: 1.9,
        gainStart: gainVal * (idx === 2 ? 0.9 : 0.55),
        destination: this.musicDuckGain
      });
    });
  }

  _playShakerBrush(startTime, gainVal = 0.04) {
    this._playNoiseSlice({
      type: 'white',
      startTime,
      duration: 0.042,
      filterType: 'highpass',
      freqStart: 4400,
      q: 1.0,
      gainStart: gainVal,
      destination: this.musicDuckGain
    });
  }

  _playFiddleLead(freq, startTime, duration = 0.3, gainVal = 0.07) {
    if (!this.ctx || !this.musicDuckGain) return;
    const t0 = Math.max(this.ctx.currentTime, startTime);
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t0);
    // Slight folk fiddle slide-in
    osc.frequency.setValueAtTime(freq * 0.97, t0);
    osc.frequency.linearRampToValueAtTime(freq, t0 + 0.045);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(980, t0);
    filter.Q.setValueAtTime(1.4, t0);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0008, t0);
    gain.gain.linearRampToValueAtTime(gainVal, t0 + Math.min(0.06, duration * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicDuckGain);

    this._registerVoice(osc, t0 + duration + 0.02, [filter, gain]);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  /**
   * Short celebratory banjo/fiddle stinger on a clean split or perfect hit that briefly ducks the music!
   */
  playCelebratoryStinger(isPerfect = false) {
    this._recordEvent('music_stinger');
    const ctx = this._ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Briefly duck background soundtrack so split & stinger shine through
      if (this.musicDuckGain) {
        this.musicDuckGain.gain.cancelScheduledValues(now);
        this.musicDuckGain.gain.setValueAtTime(this.musicDuckGain.gain.value, now);
        this.musicDuckGain.gain.linearRampToValueAtTime(0.26, now + 0.025);
        this.musicDuckGain.gain.setValueAtTime(0.26, now + 0.26);
        this.musicDuckGain.gain.linearRampToValueAtTime(1.0, now + 0.68);
      }

      const lick = isPerfect
        ? [587.33, 739.99, 880.0, 1174.66]
        : [440.0, 587.33, 739.99];
      lick.forEach((f, i) => {
        this._playKarplusPluck(f, now + 0.03 + i * 0.055, 0.15, 'banjo', this.sfxBus);
      });
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // 11. TEST HOOKS: getAudioState() & audioDemo(seconds)
  // ============================================================================

  /**
   * Returns the structured audio state snapshot required by `window.getAudioState()`.
   */
  getAudioState() {
    const ctxState = this.ctx ? this.ctx.state : 'suspended';
    const musicOn = Boolean(this.enabled && !this.musicMuted && this.musicVolume > 0);
    const musicPlaying = Boolean(
      musicOn && this._musicSchedulerActive && !this._isHidden
    );
    return {
      ctxState,
      musicOn,
      musicPlaying,
      musicSection: this.musicSection,
      intensity: Math.round(Math.max(0, Math.min(1, this.intensity)) * 1000) / 1000,
      activeVoices: this.getActiveVoiceCount(),
      sfxVolume: Math.round(this.sfxVolume * 100) / 100,
      musicVolume: Math.round(this.musicVolume * 100) / 100,
      eventsPlayed: { ...this.eventsPlayed }
    };
  }

  /**
   * Runs an automated audio & gameplay showcase (`window.audioDemo(seconds)`) that
   * unlocks/starts the soundtrack, cycles sections ('menu' -> 'gameplay' -> 'boss'),
   * and triggers varied woodchopping SFX, wedges, hazards, rewards, and weather crossfades.
   */
  runAudioDemo(seconds = 60, sim = null) {
    this._clearDemoTimers();
    const totalSec = Math.max(2, Math.min(180, Number(seconds) || 60));

    this.musicMuted = false;
    this.sfxMuted = false;
    if (this.musicVolume <= 0) this.musicVolume = 0.48;
    if (this.sfxVolume <= 0) this.sfxVolume = 0.82;
    this._syncBusGains();
    this.unlockAndStart();
    this.updateMusicState({ isBoss: false, combo: 2, isSwinging: true, isActiveGameplay: true });

    // Immediate opening showcase burst so even a short check sees music + rich SFX right away
    this.playUIClick();
    if (sim && typeof sim.swing === 'function') {
      sim.swing(1.15);
    } else {
      this.playWhoosh(1.15);
      this.playWoodSplit(1.15, false);
    }

    const steps = [
      { t: 0.8, fn: () => { this.playWedgePlant(); if (sim) sim.plantSplittingWedge(); } },
      { t: 1.5, fn: () => { this.playWedgeHammer(2); if (sim) sim.swing(1.25); } },
      { t: 2.6, fn: () => { this.playPeaveyHeave(); this.playKnotImpact(1.0); if (sim) sim.heaveLogWithPeavey(); } },
      { t: 3.4, fn: () => { if (sim) sim.swing(1.35); else this.playWoodSplit(1.35, false); this.playPerfectZoneDing(); } },
      { t: 4.5, fn: () => { this.playLogFlip(); this.playWetWoodImpact(0.95); if (sim) sim.flipActiveLog(); } },
      { t: 5.4, fn: () => { this.playRockRicochet(1.1); this.playNailHazardClang(1.0); this.playWhetstoneHone(); if (sim) sim.honeAxeBlade(); } },
      { t: 6.5, fn: () => { this.playGlancingBlow(0.9, true, false); this.playIceShatter(1.1); this.playBonfireStoke(); if (sim) sim.stokeBackyardBonfire(); } },
      { t: 7.6, fn: () => { this.playThunderclap(1.0); this.playUpgrade(); if (sim) sim.triggerThunderstormBolt(); } },
      {
        t: 8.8,
        fn: () => {
          if (sim && sim.gameState && sim.choppingStation) {
            sim.gameState.setLogType('boss_oak', true);
            sim.choppingStation.reset('boss_oak');
            if (typeof sim._refreshAllHUD === 'function') sim._refreshAllHUD();
          }
          this.playBossIntro();
          this.updateMusicState({ isBoss: true, combo: 6, isSwinging: true, isActiveGameplay: true });
        }
      },
      { t: 10.0, fn: () => { this.playBossHit(0.5); this.playBossPhaseBreak(); this.playProgressiveCrack(0.75); } },
      { t: 11.5, fn: () => { if (sim) sim.swing(1.4); else this.playBossSplit(); this.playContractComplete(); if (sim) sim.bundleFirewoodContract(); } }
    ];

    steps.forEach(({ t, fn }) => {
      if (t <= totalSec) {
        const id = setTimeout(() => {
          try { fn(); } catch { /* ignore */ }
        }, t * 1000);
        this._demoTimers.push(id);
      }
    });

    // Periodic swings & varied weather/SFX across the rest of `totalSec`
    const weathers = ['sun', 'rain', 'snow', 'wind', 'fog'];
    let loopIdx = 0;
    for (let sec = 13.0; sec < totalSec; sec += 2.2) {
      const id = setTimeout(() => {
        try {
          loopIdx++;
          const w = weathers[loopIdx % weathers.length];
          if (sim && sim.atmosphere) {
            sim.atmosphere.setWeather(w);
          }
          this.setWeatherAmbience(w, loopIdx % 3 === 0 ? 21.5 : 16.5);
          if (loopIdx % 4 === 0) {
            this.playWedgePlant();
            this.playWedgeHammer((loopIdx % 3) + 1);
          }
          if (sim && typeof sim.swing === 'function') {
            sim.swing(0.95 + (loopIdx % 4) * 0.12);
          } else {
            this.playWhoosh(1.1);
            this.playWoodSplit(1.1, w === 'snow');
          }
        } catch {
          // Ignore
        }
      }, sec * 1000);
      this._demoTimers.push(id);
    }

    return this.getAudioState();
  }

  _clearDemoTimers() {
    while (this._demoTimers.length > 0) {
      clearTimeout(this._demoTimers.pop());
    }
  }
}
