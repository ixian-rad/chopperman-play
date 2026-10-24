// Chopperman co-op transport (harness-neutral, ES module, no build step, no dependencies).
//
//   const net = new CoopNet({ backend: 'peerjs' });   // or 'loopback' (BroadcastChannel) or 'trystero'
//   const code = await net.host();                    // -> 'K7QM2'
//   await otherNet.join('K7QM2');
//   net.send({ t: 'hello' });  net.sendState(encodeState({...}));
//   net.on('message', (data, from) => ...);
//
// Messages are either plain JSON-able objects (must have a string `t`) or ArrayBuffers (binary state packets).
// Control messages use the reserved prefix `net.` and never reach the application.
// Topology: exactly one host and (by default) one guest. All traffic is host <-> guest.

export const PROTOCOL = 1;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
export const APP_ID = 'chopperman-coop-v1';
export const PEERJS_VERSION = '1.5.5';
export const PEERJS_CDN = `https://cdn.jsdelivr.net/npm/peerjs@${PEERJS_VERSION}/dist/peerjs.min.js`;
export const TRYSTERO_CDN = 'https://esm.sh/@trystero-p2p/torrent@0.26.0';
export const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // TURN is NOT provided. To support symmetric NATs / strict firewalls add your own server, e.g.
  // window.CHOPPER_COOP_CONFIG = { iceServers: [{urls:'turn:turn.example.com:3478', username:'u', credential:'p'}] }
];

export const ANIMS = ['Idle', 'Axe_Stance', 'Charged_Axe_Chop', 'Heavy_Hammer_Swing', 'Casual_Walk', 'Victory_Cheer', 'Run'];

// ---------- helpers ----------
export class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) { (this._h.get(ev) || this._h.set(ev, new Set()).get(ev)).add(fn); return () => this.off(ev, fn); }
  once(ev, fn) { const off = this.on(ev, (...a) => { off(); fn(...a); }); return off; }
  off(ev, fn) { this._h.get(ev)?.delete(fn); }
  emit(ev, ...a) { for (const fn of [...(this._h.get(ev) || [])]) { try { fn(...a); } catch (e) { console.error('[coop] handler error for', ev, e); } } }
}
export function makeRoomCode(len = 5, rnd = Math.random) {
  let s = ''; for (let i = 0; i < len; i++) s += ROOM_ALPHABET[Math.floor(rnd() * ROOM_ALPHABET.length)]; return s;
}
/** Normalise user input: upper-case, drop spaces/dashes. Returns '' when invalid (4-6 chars from the alphabet). */
export function normalizeCode(s) {
  const c = String(s || '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-HJ-NP-Z2-9]{4,6}$/.test(c) ? c : '';
}
export const peerIdFor = code => `${APP_ID}-${code}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, err) => new Promise((res, rej) => { const t = setTimeout(() => rej(Object.assign(new Error(err), { code: err })), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
const randId = () => Math.random().toString(36).slice(2, 10);
const config = () => (typeof window !== 'undefined' && window.CHOPPER_COOP_CONFIG) || {};

// ---------- binary player-state packet (26 bytes) ----------
// 0 u8 kind=1 | 1 u8 flags (bit0 swinging, bit1 running) | 2 u8 anim index | 3 u8 reserved
// 4 u16 seq | 6 u32 sender time ms | 10 f32 x | 14 f32 y | 18 f32 z | 22 f32 yaw
export function encodeState(s) {
  const b = new ArrayBuffer(26), d = new DataView(b);
  d.setUint8(0, 1);
  d.setUint8(1, (s.swinging ? 1 : 0) | (s.running ? 2 : 0));
  const ai = typeof s.anim === 'number' ? s.anim : Math.max(0, ANIMS.indexOf(s.anim));
  d.setUint8(2, ai);
  d.setUint16(4, (s.seq || 0) & 0xffff, true);
  d.setUint32(6, Math.floor(s.t ?? performance.now()) >>> 0, true);
  d.setFloat32(10, s.x, true); d.setFloat32(14, s.y, true); d.setFloat32(18, s.z, true); d.setFloat32(22, s.yaw || 0, true);
  return b;
}
export function decodeState(buf) {
  const ab = buf instanceof ArrayBuffer ? buf : (buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null);
  if (!ab || ab.byteLength < 26) return null;
  const d = new DataView(ab); if (d.getUint8(0) !== 1) return null;
  const f = d.getUint8(1);
  return { swinging: !!(f & 1), running: !!(f & 2), anim: ANIMS[d.getUint8(2)] || 'Idle', seq: d.getUint16(4, true), t: d.getUint32(6, true), x: d.getFloat32(10, true), y: d.getFloat32(14, true), z: d.getFloat32(18, true), yaw: d.getFloat32(22, true) };
}

// ---------- Link: one open duplex connection ----------
export class Link extends Emitter {
  constructor(sendFn, closeFn, voiceFn = null) { super(); this._send = sendFn; this._close = closeFn; this._voice = voiceFn; this.open = true; this.cid = null; }
  /** Voice rides the same link: start an outgoing media call carrying `stream` (MediaStream). Returns a VoiceCall; the other side's link emits 'voice-call'. */
  get voiceCapable() { return typeof this._voice === 'function'; }
  callVoice(stream) { if (!this.open || !this._voice) throw Object.assign(new Error('voice not supported on this link'), { code: 'no-voice' }); return this._voice(stream); }
  send(data) { if (this.open) { try { this._send(data); } catch (e) { this._dead('send-failed'); } } }
  close() { if (!this.open) return; this.open = false; try { this._close(); } catch {} this.emit('close', 'local'); }
  _dead(reason) { if (!this.open) return; this.open = false; try { this._close(); } catch {} this.emit('close', reason); }
  _recv(d) { if (this.open) this.emit('message', d); }
}

// ---------- VoiceCall: transport-neutral wrapper for one media call (PeerJS MediaConnection, or the loopback mock) ----------
// events: 'stream' (remoteStream | null when mock), 'close' (reason), 'error'.  Incoming calls must be answer(stream)ed or close()d.
export class VoiceCall extends Emitter {
  constructor({ incoming = false, answerFn = null, closeFn = null, mock = false } = {}) {
    super(); this.incoming = incoming; this.mock = mock; this._answer = answerFn; this._closeFn = closeFn; this.stream = null; this.open = true; this.answered = !incoming;
  }
  answer(stream) { if (!this.incoming || this.answered || !this.open) return; this.answered = true; this._answer?.(stream); }
  close() { if (!this.open) return; this.open = false; try { this._closeFn?.(); } catch {} this.emit('close', 'local'); }
  _gotStream(s) { if (!this.open) return; this.stream = s; this.emit('stream', s); }
  _ended(reason = 'closed') { if (!this.open) return; this.open = false; this.emit('close', reason); }
}

// ---------- Backend: PeerJS cloud (primary) ----------
export async function loadPeerJS() {
  if (typeof window !== 'undefined' && window.peerjs?.Peer) return window.peerjs.Peer;
  const urls = [new URL('./vendor/peerjs.min.js', import.meta.url).href, PEERJS_CDN];
  let last;
  for (const u of urls) {
    try {
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = () => rej(new Error('load failed ' + u)); document.head.appendChild(s); });
      if (window.peerjs?.Peer) return window.peerjs.Peer;
    } catch (e) { last = e; }
  }
  throw last || new Error('PeerJS not available');
}
export class PeerJsBackend extends Emitter {
  constructor(o = {}) { super(); this.name = 'peerjs'; this.o = o; this.peer = null; this.byPeer = new Map(); }
  _opts() { const c = config(); return { debug: 0, config: { iceServers: c.iceServers || this.o.iceServers || DEFAULT_ICE, iceCandidatePoolSize: 2 }, ...(c.peerServer || {}) }; }
  _wrapCall(call, incoming) {
    const vc = new VoiceCall({ incoming, answerFn: stream => call.answer(stream), closeFn: () => call.close() });
    call.on('stream', s => vc._gotStream(s)); call.on('close', () => vc._ended('closed')); call.on('error', () => vc._ended('error'));
    try { call.peerConnection?.addEventListener('iceconnectionstatechange', () => { if (['failed', 'closed'].includes(call.peerConnection.iceConnectionState)) vc._ended('ice-' + call.peerConnection.iceConnectionState); }); } catch {}
    return vc;
  }
  _hookPeer(peer) { // incoming media calls are routed to the link of the data connection from the same peer id
    peer.on('call', call => { const link = this.byPeer.get(call.peer); if (!link || !link.open) { try { call.close(); } catch {} return; } link.emit('voice-call', this._wrapCall(call, true)); });
  }
  _wrap(conn) {
    const link = new Link(d => conn.send(d), () => conn.close(), stream => this._wrapCall(this.peer.call(conn.peer, stream), false));
    link.peerId = conn.peer; this.byPeer.set(conn.peer, link);
    link.on('close', () => { if (this.byPeer.get(conn.peer) === link) this.byPeer.delete(conn.peer); });
    conn.on('data', d => link._recv(d));
    conn.on('close', () => link._dead('closed'));
    conn.on('error', () => link._dead('error'));
    try { conn.peerConnection?.addEventListener('iceconnectionstatechange', () => { if (conn.peerConnection.iceConnectionState === 'failed') link._dead('ice-failed'); }); } catch {}
    return link;
  }
  async listen(code) {
    const Peer = this.o.Peer || await loadPeerJS();
    const peer = this.peer = new Peer(peerIdFor(code), this._opts()); this._hookPeer(peer);
    await withTimeout(new Promise((res, rej) => {
      peer.on('open', res);
      peer.on('error', e => rej(Object.assign(new Error(e.type), { code: e.type === 'unavailable-id' ? 'id-taken' : e.type })));
    }), 12000, 'signaling-timeout');
    peer.on('connection', conn => conn.on('open', () => this.emit('link', this._wrap(conn))));
    peer.on('disconnected', async () => { // lost signaling only; existing data connections stay up
      for (let i = 0; i < 6 && peer && !peer.destroyed && peer.disconnected; i++) { await sleep(1000 * (i + 1)); try { peer.reconnect(); } catch {} }
    });
    peer.on('error', e => this.emit('error', e));
  }
  async connect(code) {
    const Peer = this.o.Peer || await loadPeerJS();
    if (!this.peer || this.peer.destroyed) {
      const peer = this.peer = new Peer(undefined, this._opts()); this._hookPeer(peer);
      await withTimeout(new Promise((res, rej) => { peer.on('open', res); peer.on('error', e => rej(Object.assign(new Error(e.type), { code: e.type }))); }), 12000, 'signaling-timeout');
    }
    const conn = this.peer.connect(peerIdFor(code), { reliable: true, serialization: 'binary' });
    return await withTimeout(new Promise((res, rej) => {
      conn.on('open', () => res(this._wrap(conn)));
      this.peer.on('error', e => { if (e.type === 'peer-unavailable') rej(Object.assign(new Error('Room not found'), { code: 'not-found' })); });
      conn.on('error', e => rej(Object.assign(new Error('connection error'), { code: 'conn-error' })));
    }), 20000, 'connect-timeout'); // 20 s: ICE fails silently behind symmetric NATs without TURN
  }
  destroy() { try { this.peer?.destroy(); } catch {} this.peer = null; }
}

// ---------- Backend: BroadcastChannel loopback (tests, same-browser play, demo) ----------
export class LoopbackBackend extends Emitter {
  constructor() { super(); this.name = 'loopback'; this.chans = new Set(); this.links = new Set(); }
  _bc(name) { const c = new BroadcastChannel(name); this.chans.add(c); return c; }
  _link(name, side) {
    const bc = this._bc(name); const peerSide = side === 'h' ? 'g' : 'h';
    // Voice over loopback is a MOCK: BroadcastChannel cannot carry a MediaStream, so only call/answer/close signalling crosses and the
    // receiving side gets a VoiceCall with mock=true and stream=null (the voice layer then synthesises a tone source for its WebAudio graph).
    let active = null; const vpost = k => { try { bc.postMessage({ s: side, vc: k }); } catch {} };
    const track = vc => { active?.close(); active = vc; vc.on('close', () => { if (active === vc) active = null; }); return vc; };
    const link = new Link(d => bc.postMessage({ s: side, d }), () => { try { bc.postMessage({ s: side, close: 1 }); } catch {} bc.close(); this.chans.delete(bc); },
      () => { const vc = track(new VoiceCall({ mock: true, closeFn: () => vpost('close') })); vpost('call'); return vc; });
    bc.onmessage = e => {
      const m = e.data; if (!m || m.s !== peerSide) return;
      if (m.close) link._dead('closed');
      else if (m.vc === 'call') { const vc = track(new VoiceCall({ incoming: true, mock: true, answerFn: () => { vpost('answer'); vc._gotStream(null); }, closeFn: () => vpost('close') })); link.emit('voice-call', vc); }
      else if (m.vc === 'answer') active?._gotStream(null);
      else if (m.vc === 'close') active?._ended('closed');
      else if (m.d !== undefined) link._recv(m.d);
    };
    const bye = () => { try { bc.postMessage({ s: side, close: 1 }); } catch {} };
    if (typeof addEventListener === 'function') addEventListener('pagehide', bye);
    this.links.add(link); return link;
  }
  async listen(code) {
    this.code = code;
    const probe = this._bc('chop-loop-lobby-' + code); const myProbe = randId(); let taken = false;
    probe.onmessage = e => { if (e.data?.t === 'taken' && e.data.id === myProbe) taken = true; };
    probe.postMessage({ t: 'probe', id: myProbe }); await sleep(250);
    if (taken) { probe.close(); throw Object.assign(new Error('code taken'), { code: 'id-taken' }); }
    const seen = new Set();
    probe.onmessage = e => {
      const m = e.data; if (!m) return;
      if (m.t === 'probe') probe.postMessage({ t: 'taken', id: m.id });
      else if (m.t === 'hello' && m.cid) { // always answer; re-link on retries
        const name = `chop-loop-link-${code}-${m.cid}-${randId()}`;
        const link = this._link(name, 'h'); probe.postMessage({ t: 'accept', cid: m.cid, name });
        this.emit('link', link); seen.add(m.cid);
      }
    };
  }
  async connect(code) {
    const lobby = this._bc('chop-loop-lobby-' + code); const cid = randId();
    return await new Promise((res, rej) => {
      let n = 0;
      const done = (fn, v) => { clearInterval(iv); lobby.close(); this.chans.delete(lobby); fn(v); };
      lobby.onmessage = e => { const m = e.data; if (m?.t === 'accept' && m.cid === cid) done(res, this._link(m.name, 'g')); };
      const iv = setInterval(() => { if (++n > 15) done(rej, Object.assign(new Error('Room not found'), { code: 'not-found' })); else lobby.postMessage({ t: 'hello', cid }); }, 200);
      lobby.postMessage({ t: 'hello', cid });
    });
  }
  destroy() { for (const l of [...this.links]) l.close(); for (const c of this.chans) try { c.close(); } catch {} this.chans.clear(); this.links.clear(); }
}

// ---------- Backend: Trystero 0.26 (fallback; signaling over public BitTorrent trackers, no PeerJS server) ----------
export class TrysteroBackend extends Emitter {
  constructor(o = {}) { super(); this.name = 'trystero'; this.o = o; this.room = null; this.peers = new Set(); this.links = new Map(); }
  async _join(code) {
    const joinRoom = this.o.joinRoom || (await import(/* @vite-ignore */ this.o.url || TRYSTERO_CDN)).joinRoom;
    const c = config();
    this.room = joinRoom({ appId: APP_ID, rtcConfig: { iceServers: c.iceServers || DEFAULT_ICE }, ...(this.o.rtcPolyfill ? { rtcPolyfill: this.o.rtcPolyfill } : {}), ...(this.o.trysteroConfig || {}) }, code);
    this.action = this.room.makeAction('coop');
    this.action.onMessage = (d, meta) => this.links.get(meta?.peerId)?._recv(d);
    this.room.onPeerJoin = id => { this.peers.add(id); this.emit('peer', id); };
    this.room.onPeerLeave = id => { this.peers.delete(id); this.links.get(id)?._dead('closed'); this.links.delete(id); };
  }
  _linkFor(peerId) {
    const link = new Link(d => this.action.send(d, { target: peerId }), () => {}); this.links.set(peerId, link); return link;
  }
  async listen(code) { await this._join(code); this.on('peer', id => this.emit('link', this._linkFor(id))); }
  async connect(code) {
    if (!this.room) await this._join(code);
    return await withTimeout(new Promise(res => { const have = [...this.peers][0]; if (have) res(this._linkFor(have)); else this.once('peer', id => res(this._linkFor(id))); }), 25000, 'connect-timeout');
  }
  destroy() { try { this.room?.leave(); } catch {} this.room = null; this.peers.clear(); this.links.clear(); }
}

export function makeBackend(kind, opts = {}) {
  if (kind && typeof kind === 'object') return kind;
  if (kind === 'loopback') return new LoopbackBackend();
  if (kind === 'trystero') return new TrysteroBackend(opts);
  return new PeerJsBackend(opts);
}

// ---------- CoopNet: handshake, heartbeat/ping, reconnect, rate-limited state ----------
export class CoopNet extends Emitter {
  /** opts: backend ('peerjs'|'loopback'|'trystero'|object), fallback (backend kind tried if primary signaling fails), hz (state rate, max 20),
   *  pingMs, timeoutMs, graceMs (host keeps the guest's seat), maxPeers(1), now() */
  constructor(o = {}) {
    super();
    this.o = { hz: 15, pingMs: 2000, timeoutMs: 7000, graceMs: 15000, maxPeers: 1, reconnectDelays: [500, 1000, 2000, 4000], now: () => performance.now(), ...o };
    this.o.hz = Math.min(20, Math.max(1, this.o.hz));
    this.backendKind = o.backend || 'peerjs'; this.backend = null;
    this.role = null; this.code = null; this.status = 'idle'; this.rtt = null; this.cid = randId();
    this.links = new Map(); // host: cid -> link ; guest: 'host' -> link
    this.graceTimers = new Map(); this._userClosed = false; this._pending = null; this._lastSend = 0; this._flushT = null;
    this.stats = { sent: 0, recv: 0, bytesSent: 0, bytesRecv: 0 };
  }
  _setStatus(s, extra) { if (this.status !== s) { this.status = s; this.emit('status', s, extra); } }
  _mk(kind) { const b = makeBackend(kind, this.o.backendOpts || {}); b.on?.('error', e => this.emit('error', e)); return b; }
  /** Voice: start a media call to the connected partner over the same link (null if there is no voice-capable open link). */
  callVoice(stream) { const l = [...this.links.values()].find(x => x.open && x.voiceCapable); return l ? l.callVoice(stream) : null; }
  get voiceCapable() { return [...this.links.values()].some(x => x.open && x.voiceCapable); }

  async host(code) {
    if (this.role) throw new Error('already ' + this.role);
    this.role = 'host'; this._userClosed = false;
    const kinds = [this.backendKind, this.o.fallback].filter(Boolean);
    let lastErr;
    for (const kind of kinds) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const c = (attempt === 0 && code) || makeRoomCode(5);
        const b = this._mk(kind);
        try {
          this._setStatus('connecting');
          await b.listen(c);
          this.backend = b; this.backendUsed = b.name; this.code = c;
          b.on('link', l => this._hostLink(l));
          this._startTimers(); this._setStatus('hosting'); return c;
        } catch (e) { lastErr = e; b.destroy?.(); if (e.code !== 'id-taken') break; }
      }
    }
    this.role = null; this._setStatus('error', lastErr); throw lastErr;
  }
  _hostLink(link) {
    let cid = null, ready = false; const timer = setTimeout(() => { if (!ready) link.close(); }, 8000);
    link.on('voice-call', vc => { if (ready && this.links.get(cid) === link) this.emit('voice-call', vc); else vc.close(); });
    link.on('message', d => {
      if (!ready) {
        if (d?.t !== 'net.hi') return;
        if (d.proto !== PROTOCOL) { link.send({ t: 'net.no', why: 'version' }); setTimeout(() => link.close(), 200); return; }
        cid = d.cid; const old = this.links.get(cid);
        if (!old && this.links.size >= this.o.maxPeers) { link.send({ t: 'net.no', why: 'full' }); setTimeout(() => link.close(), 200); return; }
        ready = true; clearTimeout(timer); link.cid = cid;
        const rejoin = !!old || this.graceTimers.has(cid);
        if (old) { old.open = false; try { old._close(); } catch {} }
        clearTimeout(this.graceTimers.get(cid)); this.graceTimers.delete(cid);
        this.links.set(cid, link); link.lastRecv = this.o.now();
        link.send({ t: 'net.ok', proto: PROTOCOL, code: this.code });
        this._setStatus('connected'); this.emit('peer-open', { id: cid, rejoin });
        return;
      }
      this._onMsg(d, link, cid);
    });
    link.on('close', reason => {
      clearTimeout(timer); if (!ready || this.links.get(cid) !== link) return;
      this.links.delete(cid); this._setStatus('hosting'); this.emit('peer-disconnected', { id: cid, reason });
      if (this._userClosed) return;
      this.graceTimers.set(cid, setTimeout(() => { this.graceTimers.delete(cid); this.emit('peer-left', { id: cid, reason }); }, reason === 'bye' ? 0 : this.o.graceMs));
    });
  }

  async join(code) {
    if (this.role) throw new Error('already ' + this.role);
    code = normalizeCode(code); if (!code) throw Object.assign(new Error('Invalid room code'), { code: 'bad-code' });
    this.role = 'guest'; this.code = code; this._userClosed = false;
    try { await this._connectOnce(); } catch (e) { this.role = null; this._setStatus('error', e); this.backend?.destroy?.(); this.backend = null; throw e; }
    this._startTimers(); return code;
  }
  async _connectOnce() {
    this._setStatus(this.status === 'reconnecting' ? 'reconnecting' : 'connecting');
    const kinds = [this.backendKind, this.o.fallback].filter(Boolean); let lastErr;
    for (const kind of kinds) {
      const b = this.backend && this.backend.name === (typeof kind === 'string' ? kind : kind.name) ? this.backend : this._mk(kind);
      try {
        const link = await b.connect(this.code); this.backend = b; this.backendUsed = b.name;
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(Object.assign(new Error('handshake timeout'), { code: 'handshake-timeout' })), 8000);
          link.on('voice-call', vc => { if (this.links.get('host') === link) this.emit('voice-call', vc); else vc.close(); });
          link.on('message', d => {
            if (d?.t === 'net.ok') { clearTimeout(t); res(); }
            else if (d?.t === 'net.no') { clearTimeout(t); rej(Object.assign(new Error(d.why === 'full' ? 'Room is full' : 'Version mismatch'), { code: d.why })); }
            else if (this.links.get('host') === link) this._onMsg(d, link, 'host');
          });
          link.on('close', r => { if (this.links.get('host') === link) this._guestLost(r); else { clearTimeout(t); rej(Object.assign(new Error('closed during handshake'), { code: 'closed' })); } });
          link.send({ t: 'net.hi', cid: this.cid, proto: PROTOCOL });
          this.links.set('host', link); link.lastRecv = this.o.now();
        });
        this._setStatus('connected'); return;
      } catch (e) { lastErr = e; this.links.delete('host'); if (b !== this.backend) b.destroy?.(); if (['full', 'version', 'not-found'].includes(e.code)) break; /* real answer from signaling: do not try the fallback */ }
    }
    throw lastErr;
  }
  async _guestLost(reason) {
    this.links.delete('host');
    if (this._userClosed || this.status === 'closed') return;
    if (reason === 'bye') return this._finish('host-left');
    this._setStatus('reconnecting'); this.emit('reconnecting', reason);
    for (const d of this.o.reconnectDelays) {
      await sleep(d); if (this._userClosed) return;
      try { await this._connectOnce(); this.emit('open', { rejoin: true }); return; }
      catch (e) { if (['full', 'version'].includes(e.code)) break; }
    }
    this._finish('lost');
  }
  _finish(reason) { if (this.status === 'closed') return; this._stopTimers(); this._setStatus('closed', reason); this.emit('close', reason); this.backend?.destroy?.(); this.backend = null; this.role = null; }

  _onMsg(d, link, from) {
    link.lastRecv = this.o.now(); this.stats.recv++; this.stats.bytesRecv += d?.byteLength || 0;
    if (d && typeof d === 'object' && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d) && typeof d.t === 'string' && d.t.startsWith('net.')) {
      if (d.t === 'net.ping') link.send({ t: 'net.pong', ts: d.ts });
      else if (d.t === 'net.pong') { const r = this.o.now() - d.ts; this.rtt = this.rtt == null ? r : this.rtt * 0.7 + r * 0.3; this.emit('ping', this.rtt); }
      else if (d.t === 'net.bye') { link._dead('bye'); }
      return;
    }
    if (d && !(d instanceof ArrayBuffer) && d.buffer instanceof ArrayBuffer) d = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    this.emit('message', d, from);
  }
  _startTimers() {
    this._tm = setInterval(() => {
      const now = this.o.now();
      for (const [id, l] of this.links) {
        if (!l.open) continue;
        l.send({ t: 'net.ping', ts: now });
        if (l.lastRecv && now - l.lastRecv > this.o.timeoutMs) l._dead('timeout');
      }
    }, this.o.pingMs);
  }
  _stopTimers() { clearInterval(this._tm); clearTimeout(this._flushT); for (const t of this.graceTimers.values()) clearTimeout(t); this.graceTimers.clear(); }

  get connected() { return [...this.links.values()].some(l => l.open); }
  /** Send to the other side (host -> all guests, guest -> host). */
  send(msg) {
    for (const l of this.links.values()) if (l.open) { l.send(msg); this.stats.sent++; this.stats.bytesSent += msg?.byteLength || 0; }
  }
  /** Latest-wins, rate-limited (opts.hz, max 20) send for high-frequency ArrayBuffer state. */
  sendState(buf) {
    this._pending = buf; const now = this.o.now(), gap = 1000 / this.o.hz;
    if (now - this._lastSend >= gap) { this._flush(); return; }
    if (!this._flushT) this._flushT = setTimeout(() => { this._flushT = null; this._flush(); }, gap - (now - this._lastSend));
  }
  _flush() { if (!this._pending) return; const b = this._pending; this._pending = null; this._lastSend = this.o.now(); this.send(b); }

  /** Graceful leave. Notifies the other side. */
  disconnect() {
    if (this.role === null && this.status === 'idle') return;
    this._userClosed = true;
    for (const l of this.links.values()) { l.send({ t: 'net.bye' }); }
    const links = [...this.links.values()], backend = this.backend; this.links.clear();
    setTimeout(() => { for (const l of links) l.close(); backend?.destroy?.(); }, 80);
    this._stopTimers(); this._setStatus('closed', 'local'); this.emit('close', 'local'); this.role = null; this.backend = null; this.code = null;
    setTimeout(() => { this.status = 'idle'; }, 100);
  }
}
