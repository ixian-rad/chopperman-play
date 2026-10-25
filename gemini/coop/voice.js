// Opt-in proximity voice chat for the co-op module. Audio is peer-to-peer only (WebRTC media call on the same PeerJS peer as the data
// channel), never recorded, never sent to any server of ours. Default OFF; the choice is remembered in localStorage.
//
//   const voice = new CoopVoice({ getPartnerName: () => 'Alex' });   // createCoop() does this for you: coop.voice
//   voice.attach(net);                       // a CoopNet (createCoop re-attaches on every host()/join())
//   await voice.enable();                    // user gesture: asks for the mic, unlocks WebAudio. disable() / mute() / mute(false)
//   voice.setPositions({ x, y, z, yaw }, { x, y, z });  // or voice.update(now, { local, remote }) every frame
//
// Remote audio: MediaStreamSource -> GainNode (distance) -> [StereoPannerNode (optional)] -> destination.
// Gain = distanceGain(distance): full volume inside minDist (3 m), smoothly falling to silent at maxDist (25 m). Changes are applied with
// setTargetAtTime(timeConstant 80 ms) so there are no clicks. Who calls whom: the GUEST calls the HOST once both have voice on; a
// small {t:'voice'} control message over the existing data connection says whether each side has voice on / muted.
// No DOM here (the buttons live in ui.js).
import { Emitter } from './net.js';

export const VOICE_STORAGE_KEY = 'chopperman.coop.voice';
export const VOICE_DEFAULTS = { minDist: 3, maxDist: 25, curve: 'inverse', timeConstant: 0.08, pan: false, panWidth: 0.8, speakingRms: 0.01, speakingHangMs: 350, micHoldMs: 20000, retryMs: 1500, maxRetries: 5, connectTimeoutMs: 15000, mockTone: true };
export const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
export const CURVES = ['inverse', 'linear', 'equalpower', 'smoothstep'];

/** Distance (m) -> gain 0..1. 1 inside minDist, 0 at/after maxDist, continuous and monotonic between. Non-finite distance -> 1 (position unknown). */
export function distanceGain(d, { minDist = VOICE_DEFAULTS.minDist, maxDist = VOICE_DEFAULTS.maxDist, curve = VOICE_DEFAULTS.curve } = {}) {
  if (!Number.isFinite(d)) return 1;
  if (maxDist <= minDist) return d <= minDist ? 1 : 0;
  if (d <= minDist) return 1; if (d >= maxDist) return 0;
  const t = (d - minDist) / (maxDist - minDist);
  switch (curve) {
    case 'linear': return 1 - t;
    case 'equalpower': return Math.cos(t * Math.PI / 2);
    case 'smoothstep': return 1 - t * t * (3 - 2 * t);
    default: { const k = minDist / maxDist; return Math.max(0, Math.min(1, (minDist / d - k) / (1 - k))); } // inverse-distance, rolled off to exactly 0 at maxDist
  }
}
/** Stereo pan -1 (left) .. 1 (right). listener.yaw: radians, forward = (sin yaw, cos yaw) in (x, z) (three.js rotation.y of an object facing +z). Centered when very close. */
export function panFor(listener, remote, width = 0.8) {
  if (!listener || !remote || !Number.isFinite(listener.yaw)) return 0;
  const dx = remote.x - listener.x, dz = remote.z - listener.z, d = Math.hypot(dx, dz); if (!(d > 0.01)) return 0;
  const right = (-dx * Math.cos(listener.yaw) + dz * Math.sin(listener.yaw)) / d; // dot(delta/|delta|, right), right = (-cos yaw, sin yaw)
  return Math.max(-1, Math.min(1, right * width * Math.min(1, d / 2)));
}
export const dist3 = (a, b) => (a && b ? Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0), (a.z || 0) - (b.z || 0)) : null);
const safeStorage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
const errKind = e => { const n = e?.name || ''; if (/NotAllowed|Security|Permission/i.test(n)) return 'denied'; if (/NotFound|Overconstrained|DevicesNotFound/i.test(n)) return 'unavailable'; return 'error'; };
export const MIC_MESSAGES = {
  denied: 'Microphone blocked. Allow microphone access for this site in your browser, then turn voice chat on again. The game continues without voice.',
  unavailable: 'No microphone found. Plug one in, then turn voice chat on again. The game continues without voice.',
  error: 'Could not start the microphone. The game continues without voice.',
};

export class CoopVoice extends Emitter {
  /** o: { storage, storageKey, AudioContext, getUserMedia(constraints), getPartnerName(), now(), minDist, maxDist, curve, timeConstant, pan, ... see VOICE_DEFAULTS } */
  constructor(o = {}) {
    super();
    this.o = { ...VOICE_DEFAULTS, now: () => performance.now(), getPartnerName: () => 'Partner', storageKey: VOICE_STORAGE_KEY, ...o };
    this.storage = 'storage' in o ? o.storage : safeStorage();
    this.enabled = this._load(); this.muted = false;
    this.mic = 'idle'; this.stream = null; this.ctx = null; this.net = null; this._unsub = [];
    this.remote = { on: false, muted: false, speaking: false }; this.local = { speaking: false };
    this.call = null; this.callState = 'none'; this.graph = null; this.retries = 0; this.failed = false;
    this.positions = { local: null, remote: null }; this._override = null; this.distance = null; this.targetGain = 0; this._lastTarget = null;
    this._q = Promise.resolve(); this._lastLevel = 0; this._loudAt = { remote: -1e9, local: -1e9 }; this._micTimer = null; this._retryT = null; this._connT = null; this._gestureOff = null; this._localMeter = null;
  }
  // ----- persistence -----
  _load() { try { return this.storage?.getItem(this.o.storageKey) === '1'; } catch { return false; } }
  _save() { try { this.storage?.setItem(this.o.storageKey, this.enabled ? '1' : '0'); } catch {} }
  get config() { const { minDist, maxDist, curve } = this.o; return { minDist, maxDist, curve }; }
  /** Tune the roll-off (e.g. configure({ minDist: 5, maxDist: 40, curve: 'linear' })). */
  configure(p = {}) { for (const k of ['minDist', 'maxDist', 'curve', 'timeConstant', 'pan', 'panWidth']) if (p[k] !== undefined) this.o[k] = p[k]; this._lastTarget = null; this._emit(); }
  curveAt(d) { return distanceGain(d, this.o); }
  get partner() { try { return this.o.getPartnerName?.() || 'Partner'; } catch { return 'Partner'; } }
  get active() { return !!this.stream; }
  get connected() { return this.callState === 'connected'; }

  // ----- net wiring -----
  attach(net) {
    this.detach(); this.net = net; const on = (ev, fn) => this._unsub.push(net.on(ev, fn));
    on('message', d => { if (d && typeof d === 'object' && d.t === 'voice') this._onRemoteState(d); });
    on('voice-call', vc => this._onIncoming(vc));
    on('peer-open', () => this._sync()); on('open', () => this._sync());
    on('peer-disconnected', () => this._peerGone()); on('reconnecting', () => this._peerGone());
    on('peer-left', () => this._peerGone());
    on('status', s => { if (s === 'connected') this._sync(); else if (s === 'closed' || s === 'error') this._sessionEnded(); });
    on('close', () => this._sessionEnded());
    if (net.connected) this._sync();
    return this;
  }
  detach() { for (const u of this._unsub) { try { u(); } catch {} } this._unsub = []; if (this.net && (this.net.connected || this.stream || this.call)) this._sessionEnded(); this.net = null; }
  get _isGuest() { return this.net?.role === 'guest'; }

  // ----- user API -----
  /** Turn voice chat on. Call from a click/tap (mic prompt + AudioContext unlock). Resolves { ok, reason? }. */
  async enable() {
    this.enabled = true; this._save(); this.failed = false; this.retries = 0; this._ensureCtx(); this.mic = this.stream ? 'on' : 'pending'; this._emit();
    if (!this.net?.connected) { // not in a session yet: only check that the mic works (the permission prompt appears now, not mid-game), then let go of it
      const r = await this._acquire(true); if (!r.ok) return r; this._releaseMic('ready'); this._emit(); return { ok: true };
    }
    await this._sync(); return this.enabled ? { ok: true } : { ok: false, reason: this.mic };
  }
  disable() {
    this.enabled = false; this._save(); this.failed = false; this._closeCall('local'); this._releaseMic('idle'); this._closeCtx();
    this.remote.speaking = false; this._announce(); this._emit(); return { ok: true };
  }
  toggle() { return this.enabled ? this.disable() : this.enable(); }
  /** mute() toggles, mute(true|false) sets. Muting disables the mic track (silence is sent) and tells the partner (for the HUD). Returns the new muted flag. */
  mute(flag) {
    this.muted = flag === undefined ? !this.muted : !!flag;
    for (const t of this.stream?.getAudioTracks?.() || []) t.enabled = !this.muted;
    if (this.muted) this.local.speaking = false;
    this._announce(); this._emit(); return this.muted;
  }
  setPositions(local, remote) { this.positions = { local: local || null, remote: remote || null }; }
  /** Test/debug override: force the distance in metres (null = back to the real positions). */
  setDistance(d) { this._override = d == null ? null : +d; this._lastTarget = null; }

  // ----- per frame -----
  /** Call once per frame. Optionally feeds positions: update(now, { local:{x,y,z,yaw}, remote:{x,y,z} | null }). */
  update(now = this.o.now(), pos) {
    if (pos) this.setPositions(pos.local, pos.remote);
    const g = this.graph; const d = this._override ?? dist3(this.positions.local, this.positions.remote);
    this.distance = Number.isFinite(d) ? d : null;
    const target = g ? distanceGain(d, this.o) : 0; this.targetGain = target;
    if (g && (this._lastTarget == null || Math.abs(target - this._lastTarget) > 0.0005)) { g.gain.gain.setTargetAtTime(target, this.ctx.currentTime, this.o.timeConstant); this._lastTarget = target; }
    if (g?.panner) g.panner.pan.setTargetAtTime(this.o.pan ? panFor(this.positions.local, this.positions.remote, this.o.panWidth) : 0, this.ctx.currentTime, this.o.timeConstant);
    if (now - this._lastLevel >= 80) { this._lastLevel = now; this._measure(now); }
  }
  _measure(now) {
    let changed = false; const rms = a => { if (!a) return 0; if (!this._buf || this._buf.length !== a.fftSize) this._buf = new Float32Array(a.fftSize); a.getFloatTimeDomainData(this._buf); let s = 0; for (let i = 0; i < this._buf.length; i++) s += this._buf[i] * this._buf[i]; return Math.sqrt(s / this._buf.length); };
    const hang = this.o.speakingHangMs;
    if (this.graph?.analyser) { if (rms(this.graph.analyser) > this.o.speakingRms) this._loudAt.remote = now; }
    const rs = this.graph && !this.remote.muted && now - this._loudAt.remote < hang; if (rs !== this.remote.speaking) { this.remote.speaking = rs; changed = true; }
    if (this._localMeter) { if (!this.muted && rms(this._localMeter.analyser) > this.o.speakingRms) this._loudAt.local = now; }
    const ls = !!this._localMeter && !this.muted && now - this._loudAt.local < hang; if (ls !== this.local.speaking) { this.local.speaking = ls; changed = true; }
    if (changed) this._emit();
  }

  // ----- state / notes -----
  state() {
    const t = this.stream?.getAudioTracks?.()[0];
    return { enabled: this.enabled, muted: this.muted, mic: this.mic, micActive: !!this.stream, micEnabled: t ? t.enabled : null, call: this.callState, failed: this.failed,
      remote: { ...this.remote }, local: { ...this.local }, distance: this.distance, gain: this.targetGain, gainNode: this.gainNodeValue(), audio: this.ctx?.state ?? 'none', blocked: this.audioBlocked, pan: !!this.o.pan,
      config: this.config, constraints: this.lastConstraints || null, session: !!this.net?.connected, note: this.note().text };
  }
  gainNodeValue() { return this.graph ? this.graph.gain.gain.value : null; }
  get audioBlocked() { return !!this.ctx && this.ctx.state === 'suspended'; }
  note() {
    const n = this.partner, w = (text, kind) => ({ text, kind });
    if (['denied', 'unavailable', 'error'].includes(this.mic)) return w(MIC_MESSAGES[this.mic], 'err');
    if (!this.enabled) return this.remote.on ? w(`${n} has voice chat on. Turn voice chat on to talk.`, 'warn') : w('', '');
    if (!this.net?.connected) return w('Voice chat is on. It starts when a partner connects.', '');
    if (this.audioBlocked) return w('Click or tap the page once to enable sound.', 'warn');
    if (!this.remote.on) return w(`${n} has voice chat off, so there is no audio. Ask them to turn it on.`, 'warn');
    if (this.failed) return w('Voice connection failed. Some networks block it. The game is unaffected.', 'err');
    if (this.callState !== 'connected') return w('Connecting voice…', 'warn');
    return this.muted ? w('Your mic is muted.', 'warn') : w(`Voice on. ${n} gets quieter as you move apart.`, 'ok');
  }
  _emit() { this.emit('change', this.state()); }

  // ----- mic -----
  async _acquire(probe = false) {
    if (this.stream) { this.mic = 'on'; return { ok: true }; }
    const gum = this.o.getUserMedia || (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia ? c => navigator.mediaDevices.getUserMedia(c) : null);
    this.lastConstraints = MIC_CONSTRAINTS;
    if (!gum) return this._micFail('unavailable');
    this.mic = 'pending'; this._emit();
    try { this.stream = await gum(MIC_CONSTRAINTS); }
    catch (e) { return this._micFail(errKind(e)); }
    if (!this.enabled) { this._releaseMic('idle'); return { ok: false, reason: 'disabled' }; } // turned off while the prompt was open
    for (const t of this.stream.getAudioTracks?.() || []) { t.enabled = !this.muted; t.addEventListener?.('ended', () => { if (this.stream) { this._releaseMic('error'); this._closeCall('local'); this._announce(); this._emit(); } }); }
    this.mic = 'on'; this._localMeterOn(); this._emit(); return { ok: true };
  }
  _micFail(kind) { this.mic = kind; this.enabled = false; this._save(); this._emit(); return { ok: false, reason: kind }; }
  _releaseMic(next) { // stops every track (the browser's recording indicator goes off); an error state is kept until the next enable()
    clearTimeout(this._micTimer); this._micTimer = null; this._localMeterOff();
    if (this.stream) { for (const t of this.stream.getTracks?.() || []) { try { t.stop(); } catch {} } this.stream = null; }
    if (next !== undefined && !['denied', 'unavailable', 'error'].includes(this.mic)) this.mic = next;
    this.local.speaking = false;
  }
  _localMeterOn() {
    if (!this.ctx || !this.stream || this._localMeter || !this.ctx.createAnalyser) return;
    try { const src = this.ctx.createMediaStreamSource(this.stream), analyser = this.ctx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser); this._localMeter = { src, analyser }; } catch {}
  }
  _localMeterOff() { if (this._localMeter) { try { this._localMeter.src.disconnect(); } catch {} this._localMeter = null; } }

  // ----- AudioContext (autoplay policy) -----
  _ensureCtx() {
    if (!this.ctx) {
      const AC = this.o.AudioContext || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
      if (!AC) return null;
      this.ctx = new AC({ latencyHint: 'interactive' }); this.ctx.onstatechange = () => this._emit();
    }
    this._resume(); this._armGesture(); return this.ctx;
  }
  _resume() { try { const p = this.ctx?.state === 'suspended' && this.ctx.resume?.(); p?.then?.(() => this._emit(), () => {}); } catch {} }
  _armGesture() { // autoplay policy: if the browser still blocks audio, the next click/tap/key resumes it
    if (this._gestureOff || typeof document === 'undefined' || !document.addEventListener) return;
    const h = () => { this._resume(); if (this.ctx?.state === 'running') this._disarmGesture(); };
    const evs = ['pointerdown', 'keydown', 'touchend', 'click']; for (const e of evs) document.addEventListener(e, h, true);
    this._gestureOff = () => { for (const e of evs) document.removeEventListener(e, h, true); this._gestureOff = null; };
  }
  _disarmGesture() { this._gestureOff?.(); }
  _closeCtx() { this._disarmGesture(); this._localMeterOff(); if (this.ctx) { const c = this.ctx; this.ctx = null; try { c.onstatechange = null; c.close?.(); } catch {} } }

  // ----- reconcile: mic held while in a session, announce, call -----
  _sync() { return (this._q = this._q.then(() => this._syncNow()).catch(e => console.error('[coop voice]', e))); }
  async _syncNow() {
    const connected = !!this.net?.connected;
    if (this.enabled && connected) {
      clearTimeout(this._micTimer); this._micTimer = null;
      this._ensureCtx();
      if (!this.stream) { const r = await this._acquire(); if (!r.ok) { this._announce(); return; } }
      this._localMeterOn();
    } else if (this.stream && !connected && !this._micTimer) { // brief outage (reconnect): keep the mic, but not forever
      this._micTimer = setTimeout(() => { this._micTimer = null; if (!this.net?.connected) { this._releaseMic(this.enabled ? 'ready' : 'idle'); this._emit(); } }, this.o.micHoldMs);
    }
    if (!this.enabled && this.stream) this._releaseMic('idle');
    this._announce(); this._maybeCall(); this._emit();
  }
  _announce(re = false) { if (this.net?.connected) this.net.send({ t: 'voice', on: !!(this.enabled && this.stream), muted: this.muted, ...(re ? { re: true } : {}) }); }
  _onRemoteState(d) {
    const was = this.remote.on; this.remote.on = !!d.on; this.remote.muted = !!d.muted;
    if (this.remote.muted) { this.remote.speaking = false; this._loudAt.remote = -1e9; }
    if (this.graph?.mockGain) this.graph.mockGain.gain.value = this.remote.muted ? 0 : this.graph.mockLevel;
    if (!d.re) this._announce(true); // answer with our own state so a lost first announce never matters
    if (was && !this.remote.on) { this._closeCall('local'); } // partner turned voice off: drop the call and silence
    this.failed = false; if (!was && this.remote.on) this.retries = 0;
    this._maybeCall(); this._emit();
  }
  _peerGone() {
    this._closeCall('local'); this.remote.on = false; this.remote.speaking = false; this.retries = 0; this.failed = false;
    this._sync(); // releases the mic after micHoldMs if nobody comes back
    this._emit();
  }
  _sessionEnded() {
    this._closeCall('local'); this.remote = { on: false, muted: false, speaking: false }; this.retries = 0; this.failed = false;
    this._releaseMic(this.stream && this.enabled ? 'ready' : undefined); this._closeCtx(); this._emit();
  }

  // ----- calls -----
  _maybeCall() {
    if (!this._isGuest || !this.enabled || !this.stream || !this.remote.on || !this.net?.connected || this.failed) return;
    if (this.call && this.call.open) return;
    let vc = null; try { vc = this.net.callVoice(this.stream); } catch (e) { console.warn('[coop voice] call failed', e); }
    if (!vc) return; this._wire(vc, 'calling');
  }
  async _onIncoming(vc) {
    await this._q; // let a pending mic acquisition finish
    if (!this.enabled || !this.stream || !this.net?.connected) { vc.close(); return; }
    this.remote.on = true; this._closeCall('local'); this._wire(vc, 'connecting'); vc.answer(this.stream); this._emit();
  }
  _wire(vc, state) {
    this.call = vc; this.callState = state;
    vc.on('stream', s => { if (this.call === vc) this._attachRemote(vc, s); });
    vc.on('close', reason => { if (this.call !== vc) return; this.call = null; this._teardownRemote(); this.callState = 'none'; clearTimeout(this._connT); if (reason !== 'local') this._scheduleRetry(); this._emit(); });
    clearTimeout(this._connT); this._connT = setTimeout(() => { if (this.call === vc && this.callState !== 'connected') { vc.close(); this._scheduleRetry(); } }, this.o.connectTimeoutMs);
    this._emit();
  }
  _scheduleRetry() {
    if (!this._isGuest) return; // the host just waits for the guest to call again
    if (this.retries >= this.o.maxRetries) { this.failed = true; this._emit(); return; }
    this.retries++; clearTimeout(this._retryT); this._retryT = setTimeout(() => this._maybeCall(), this.o.retryMs * this.retries);
  }
  _closeCall(reason) { clearTimeout(this._connT); clearTimeout(this._retryT); const vc = this.call; this.call = null; this.callState = 'none'; this._teardownRemote(); if (vc) { try { vc.close(); } catch {} } }

  // ----- remote audio graph -----
  _attachRemote(vc, stream) {
    const ctx = this._ensureCtx(); if (!ctx) { this.callState = 'connected'; this._emit(); return; }
    if (this.graph && stream && this.graph.stream === stream) return;
    this._teardownRemote();
    const g = { stream, nodes: [] }; const add = n => { g.nodes.push(n); return n; };
    let src;
    if (stream) {
      // Chromium only delivers a remote WebRTC stream to WebAudio if it is also attached to a (muted) media element.
      if (typeof Audio !== 'undefined' && typeof stream.getTracks === 'function' && typeof MediaStream !== 'undefined' && stream instanceof MediaStream) { try { g.el = new Audio(); g.el.muted = true; g.el.srcObject = stream; } catch {} }
      src = add(ctx.createMediaStreamSource(stream));
    } else if (this.o.mockTone && ctx.createOscillator && ctx.createMediaStreamDestination) { // loopback mock: no real audio can cross, synthesise a quiet tone
      const osc = add(ctx.createOscillator()); osc.frequency.value = 220; g.mockGain = add(ctx.createGain()); g.mockLevel = 0.02; g.mockGain.gain.value = this.remote.muted ? 0 : g.mockLevel; g.osc = osc;
      const dest = add(ctx.createMediaStreamDestination()); osc.connect(g.mockGain); g.mockGain.connect(dest); osc.start();
      src = add(ctx.createMediaStreamSource(dest.stream)); g.stream = dest.stream;
    } else { this.callState = 'connected'; this._emit(); return; }
    g.gain = add(ctx.createGain()); this.targetGain = distanceGain(this._override ?? dist3(this.positions.local, this.positions.remote), this.o); g.gain.gain.value = this.targetGain; this._lastTarget = this.targetGain; // start at the right level: no fade-in pop
    if (ctx.createAnalyser) { g.analyser = add(ctx.createAnalyser()); g.analyser.fftSize = 512; src.connect(g.analyser); }
    src.connect(g.gain);
    if (ctx.createStereoPanner) { g.panner = add(ctx.createStereoPanner()); g.gain.connect(g.panner); g.panner.connect(ctx.destination); } else g.gain.connect(ctx.destination);
    g.src = src; this.graph = g; this.callState = 'connected'; this.retries = 0; this.failed = false; clearTimeout(this._connT); this._resume(); this._emit();
  }
  _teardownRemote() {
    const g = this.graph; if (!g) return; this.graph = null; this._lastTarget = null;
    try { g.osc?.stop(); } catch {}
    for (const n of g.nodes) { try { n.disconnect(); } catch {} }
    if (g.el) { try { g.el.srcObject = null; } catch {} }
    this.remote.speaking = false;
  }
  /** Leave everything clean (page unload / game teardown). */
  dispose() { this.detach(); this._closeCall('local'); this._releaseMic('idle'); this._closeCtx(); clearTimeout(this._micTimer); }
}
