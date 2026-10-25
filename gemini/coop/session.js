// Chopperman co-op session: host-authoritative shared state on top of CoopNet.
// No DOM, no three.js. See README.md for the full message schema.
import { Emitter, encodeState, decodeState, PROTOCOL } from './net.js';

export const CHARACTERS = ['sergey', 'alex'];
export const COSTUMES = { sergey: ['tee', 'jacket'], alex: ['camo', 'bomber'] };
export const AXES = ['sergey', 'double_bit', 'maul', 'golden'];
export const MAX_NAME = 16;
const clampName = s => String(s || 'Lumberjack').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, MAX_NAME) || 'Lumberjack';
const cleanProfile = p => {
  const character = CHARACTERS.includes(p?.character) ? p.character : 'sergey';
  const costume = COSTUMES[character].includes(p?.costume) ? p.costume : COSTUMES[character][0];
  return { name: clampName(p?.name), character, costume, axe: AXES.includes(p?.axe) ? p.axe : 'sergey' };
};
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/** Interpolation buffer. Samples at (now - clockOffset - delayMs) in the sender's timeline; extrapolates <=250 ms, then holds. */
export class SnapshotBuffer {
  constructor({ delayMs = 100, max = 40, now = () => performance.now() } = {}) { this.delay = delayMs; this.max = max; this.now = now; this.snaps = []; this.offset = null; this.lastSeq = -1; }
  push(s, recvNow = this.now()) {
    // unwrap 32-bit sender time relative to the previous snapshot
    let t = s.t; const last = this.snaps[this.snaps.length - 1];
    if (last) { const span = 4294967296; while (t < last.t - span / 2) t += span; }
    if (last && t <= last.t) return false; // out of order / duplicate
    const d = recvNow - t;
    this.offset = this.offset == null ? d : this.offset + (d - this.offset) * (d < this.offset ? 0.5 : 0.02); // track the fastest packets
    this.snaps.push({ ...s, t }); if (this.snaps.length > this.max) this.snaps.shift(); return true;
  }
  get size() { return this.snaps.length; }
  sample(now = this.now()) {
    const n = this.snaps.length; if (!n) return null;
    const rt = now - this.offset - this.delay, a0 = this.snaps[0], z = this.snaps[n - 1];
    if (rt <= a0.t) return { ...a0, stale: false };
    if (rt >= z.t) {
      const over = rt - z.t; const p = n > 1 ? this.snaps[n - 2] : null; const e = Math.min(over, 250) / 1000;
      let vx = 0, vz = 0; if (p && z.t > p.t) { vx = (z.x - p.x) / ((z.t - p.t) / 1000); vz = (z.z - p.z) / ((z.t - p.t) / 1000); }
      const sp = Math.hypot(vx, vz); if (sp > 12) { vx *= 12 / sp; vz *= 12 / sp; }
      return { ...z, x: z.x + vx * e, z: z.z + vz * e, stale: over > 1000 };
    }
    let i = 0; while (i < n - 2 && this.snaps[i + 1].t <= rt) i++;
    const a = this.snaps[i], b = this.snaps[i + 1], k = (rt - a.t) / Math.max(1, b.t - a.t);
    let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return { ...a, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + dy * k, stale: false };
  }
}

export class CoopSession extends Emitter {
  /** o: { net, role:'host'|'guest', profile:{name,character,costume,axe}, seed?, setting?, shareRatio=0.5, maxDmg=5, now() } */
  constructor(o) {
    super();
    this.net = o.net; this.isHost = o.role === 'host'; this.o = { shareRatio: 0.5, maxDmg: 5, now: () => performance.now(), delayMs: 100, ...o };
    this.localId = this.isHost ? 'P1' : null; this.remoteId = this.isHost ? 'P2' : 'P1';
    this.players = new Map(); this.buffers = new Map();
    this.world = { seed: o.seed ?? ((Math.random() * 4294967296) >>> 0), setting: o.setting || 'nj', ...(o.world || {}) };
    this.trees = new Map(); // id -> { hp, max, felled }
    this.logs = new Map(); // id -> { ...info, split:false, by }
    this.totals = { P1: { xp: 0, gold: 0, loot: 0 }, P2: { xp: 0, gold: 0, loot: 0 } };
    this.seq = 0; this.felled = new Set(); this.nextLog = 1; this.rate = new Map(); this.ended = false;
    const lp = cleanProfile(o.profile);
    if (this.isHost) this.players.set('P1', { id: 'P1', ...lp, isHost: true, connected: true, pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim: 'Idle', swinging: false });
    this.buffers.set(this.remoteId, new SnapshotBuffer({ delayMs: this.o.delayMs, now: this.o.now }));
    this._wire();
  }
  get me() { return this.players.get(this.localId); }
  get remote() { return this.players.get(this.remoteId); }
  getPlayers() { return [...this.players.values()]; }

  _wire() {
    const n = this.net;
    n.on('message', (d, from) => this._onMessage(d, from));
    if (this.isHost) {
      n.on('peer-open', ({ id, rejoin }) => this._hostPeerOpen(id, rejoin));
      n.on('peer-disconnected', () => { const p = this.remote; if (p) { p.connected = false; this.emit('playerUpdated', p); this.emit('playerDisconnected', p); } });
      n.on('peer-left', () => this._hostPeerLeft());
    } else {
      n.on('open', () => this._guestHello(true)); // reconnect: re-announce
      n.on('reconnecting', () => this.emit('reconnecting'));
      n.on('close', reason => this._end(reason === 'local' ? 'left' : reason));
    }
  }
  /** Guest: call right after net.join() resolves. Host: call after net.host(). */
  start() { if (!this.isHost) this._guestHello(false); }
  _guestHello(rejoin) { this.net.send({ t: 'hello', proto: PROTOCOL, profile: cleanProfile(this.o.profile), rejoin }); }
  _end(reason) { if (this.ended) return; this.ended = true; this.emit('ended', { reason }); }
  leave() { this.net.disconnect(); if (this.isHost) this._end('left'); }

  // ----- host side -----
  _hostPeerOpen(id, rejoin) { this._pendingGuest = { id, rejoin }; }
  _hostPeerLeft() { const p = this.remote; if (p) { this.players.delete('P2'); this.buffers.get('P2')?.snaps.splice(0); this.emit('playerLeft', p); } }
  _onHello(d) {
    const lp = cleanProfile(d.profile); const had = this.players.get('P2');
    const p = { id: 'P2', ...lp, isHost: false, connected: true, pos: had?.pos || { x: 0, y: 0, z: 0 }, yaw: had?.yaw || 0, anim: 'Idle', swinging: false };
    this.players.set('P2', p); this.buffers.set('P2', new SnapshotBuffer({ delayMs: this.o.delayMs, now: this.o.now }));
    const damaged = {}; for (const [id, t] of this.trees) if (!t.felled && t.hp < t.max) damaged[id] = t.hp;
    this.net.send({ t: 'welcome', you: 'P2', proto: PROTOCOL, world: this.world, players: this.getPlayers().map(x => this._pub(x)), sync: { felled: [...this.felled], damaged, logs: [...this.logs.entries()].map(([id, l]) => ({ id, ...l })), totals: this.totals }, shareRatio: this.o.shareRatio });
    this.emit(had ? 'playerUpdated' : 'playerJoined', p); if (had && !had.connected) this.emit('playerReconnected', p);
  }
  _pub(p) { return { id: p.id, name: p.name, character: p.character, costume: p.costume, axe: p.axe, isHost: p.isHost }; }

  // ----- messages -----
  _onMessage(d, from) {
    if (d instanceof ArrayBuffer) return this._onState(d);
    if (!d || typeof d.t !== 'string') return;
    const h = this._handlers[d.t]; if (h) h.call(this, d);
  }
  _onState(buf) {
    const s = decodeState(buf); if (!s) return;
    const id = this.remoteId; const p = this.players.get(id); if (!p) return;
    s.x = num(s.x); s.y = num(s.y); s.z = num(s.z); s.yaw = num(s.yaw);
    if (!this.buffers.get(id).push(s)) return;
    p.pos = { x: s.x, y: s.y, z: s.z }; p.yaw = s.yaw; p.anim = s.anim; p.swinging = s.swinging;
  }
  get _handlers() {
    return {
      hello(d) { if (this.isHost) this._onHello(d); },
      welcome(d) {
        if (this.isHost) return;
        this.localId = d.you; this.world = d.world; this.o.shareRatio = d.shareRatio ?? this.o.shareRatio;
        this.players.clear(); for (const p of d.players) this.players.set(p.id, { ...p, connected: true, pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim: 'Idle', swinging: false });
        const mine = cleanProfile(this.o.profile); this.players.set(this.localId, { id: this.localId, ...mine, isHost: false, connected: true, pos: { x: 0, y: 0, z: 0 }, yaw: 0, anim: 'Idle', swinging: false });
        for (const id of d.sync.felled) { this.felled.add(id); }
        for (const [id, hp] of Object.entries(d.sync.damaged)) { const t = this.trees.get(id); if (t) t.hp = hp; else this.trees.set(id, { hp, max: hp, felled: false, preset: true }); }
        for (const l of d.sync.logs) this.logs.set(l.id, l);
        this.totals = d.sync.totals || this.totals; this.nextLog = 1 + this.logs.size;
        this.emit('welcome', { world: this.world, you: this.localId, players: this.getPlayers(), sync: d.sync });
        for (const p of this.getPlayers()) if (p.id !== this.localId) this.emit('playerJoined', p);
      },
      profile(d) {
        const id = this.isHost ? 'P2' : d.id; const p = this.players.get(id); if (!p) return;
        Object.assign(p, cleanProfile(d.profile)); this.emit('playerUpdated', p);
        if (this.isHost) this.net.send({ t: 'profile', id: 'P2', profile: cleanProfile(d.profile) });
      },
      hit(d) { if (this.isHost) this._hostHit('P2', d.tree, d.dmg); },
      logSpawn(d) { if (this.isHost) this._hostLogSpawn('P2', d.info); },
      logSplit(d) { if (this.isHost) this._hostLogSplit('P2', d.log, d.info); },
      award(d) { if (this.isHost) this._hostAward('P2', d.xp, d.gold, d.loot, d.reason); },
      ev(d) { if (!this.isHost) this._applyEvent(d); },
      denied(d) { this.emit('denied', d); },
    };
  }

  // ----- API used by the game -----
  /** Both sides, after world generation: [{id, hp, x, z}] so the host can adjudicate hits. Safe to call again after a world change. */
  registerTrees(list) {
    for (const { id, hp, x, z } of list) {
      const key = String(id); const prev = this.trees.get(key);
      this.trees.set(key, { hp: prev?.preset ? prev.hp : hp, max: hp, x, z, felled: this.felled.has(key) });
    }
  }
  setWorld(w) { Object.assign(this.world, w); }
  /** Local profile changed (character/costume/axe/name). */
  setLocalProfile(patch) {
    Object.assign(this.o.profile, patch); const lp = cleanProfile(this.o.profile); const me = this.me;
    if (me) { Object.assign(me, lp); }
    if (this.isHost) { this.net.send({ t: 'profile', id: 'P1', profile: lp }); } else this.net.send({ t: 'profile', profile: lp });
  }
  /** Call every frame (cheap): the net layer rate-limits to <= 20 Hz. state: {x,y,z,yaw,anim,swinging,running} */
  sendLocalState(s) {
    const me = this.me; if (!me || !this.net.connected) return;
    me.pos = { x: s.x, y: s.y, z: s.z }; me.yaw = s.yaw; me.anim = s.anim; me.swinging = !!s.swinging;
    this.net.sendState(encodeState({ ...s, seq: this.seq++, t: this.o.now() }));
  }
  /** Interpolated state of the remote player at render time, or null. */
  sampleRemote(now) { return this.buffers.get(this.remoteId)?.sample(now) ?? null; }

  /** A local swing landed on tree `id`. Play your own chips/sound immediately; hp & falling come back as 'treeHit'/'treeFell'. */
  hitTree(id, dmg = 1) {
    id = String(id); dmg = Math.min(this.o.maxDmg, Math.max(0, num(dmg, 1)));
    if (this.isHost) this._hostHit('P1', id, dmg); else this.net.send({ t: 'hit', tree: id, dmg });
  }
  /** A log exists that both players should see (e.g. split halves). Host assigns the id: listen to 'logSpawned'. */
  spawnLog(info = {}) { if (this.isHost) this._hostLogSpawn('P1', info); else this.net.send({ t: 'logSpawn', info }); }
  /** Claim a log for splitting. First claim wins; the loser gets 'denied' {kind:'logSplit'}. */
  splitLog(logId, info = {}) { if (this.isHost) this._hostLogSplit('P1', String(logId), info); else this.net.send({ t: 'logSplit', log: String(logId), info }); }
  /** Ask for XP / gold / loot. Actor gets the full amount, partner gets shareRatio of it (host decides). */
  award({ xp = 0, gold = 0, loot = 0, reason = '' } = {}) { if (this.isHost) this._hostAward('P1', xp, gold, loot, reason); else this.net.send({ t: 'award', xp, gold, loot, reason }); }

  // ----- host adjudication -----
  _limited(id, key, perSec) {
    const now = this.o.now(); const k = id + key; const r = this.rate.get(k) || { t: now, n: 0 };
    if (now - r.t > 1000) { r.t = now; r.n = 0; } r.n++; this.rate.set(k, r); return r.n > perSec;
  }
  _emitAll(ev) { this.net.send({ t: 'ev', ...ev }); this._applyEvent(ev); }
  _hostHit(by, id, dmg) {
    id = String(id); dmg = Math.min(this.o.maxDmg, Math.max(0, num(dmg, 1)));
    const t = this.trees.get(id); if (!t || t.felled || this.felled.has(id) || dmg <= 0) { if (by !== 'P1') this.net.send({ t: 'denied', kind: 'hit', tree: id }); return; }
    if (this._limited(by, 'hit', 12)) return;
    t.hp = Math.max(0, t.hp - dmg);
    this._emitAll({ k: 'treeHit', tree: id, hp: t.hp, max: t.max, by, dmg });
    if (t.hp <= 0) {
      const ap = this.players.get(by)?.pos, tp = Number.isFinite(t.x) && Number.isFinite(t.z) ? t : null;
      let dx = 1, dz = 0; if (ap && tp) { dx = tp.x - ap.x; dz = tp.z - ap.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
      this._emitAll({ k: 'treeFell', tree: id, by, dir: [+dx.toFixed(3), +dz.toFixed(3)] });
    }
  }
  _hostLogSpawn(by, info) {
    if (this._limited(by, 'log', 20)) return;
    const id = String(info?.id ?? `L${this.nextLog++}`); if (this.logs.has(id)) return;
    this._emitAll({ k: 'logSpawned', log: id, info: { ...info, id }, by });
  }
  _hostLogSplit(by, id, info) {
    const l = this.logs.get(id); if (!l || l.split) { if (by !== 'P1') this.net.send({ t: 'denied', kind: 'logSplit', log: id }); else this.emit('denied', { kind: 'logSplit', log: id }); return; }
    this._emitAll({ k: 'logSplit', log: id, by, info: info || {} });
  }
  _hostAward(by, xp, gold, loot, reason) {
    if (this._limited(by, 'award', 10)) return;
    const c = v => Math.min(100000, Math.max(0, Math.floor(num(v)))); xp = c(xp); gold = c(gold); loot = c(loot);
    if (!xp && !gold && !loot) return;
    const r = this.o.shareRatio, partner = by === 'P1' ? 'P2' : 'P1';
    const sh = v => Math.floor(v * r);
    for (const [pid, f] of [[by, v => v], [partner, sh]]) {
      const a = { xp: f(xp), gold: f(gold), loot: f(loot) }; const T = this.totals[pid];
      T.xp += a.xp; T.gold += a.gold; T.loot += a.loot;
      if (pid === 'P1') this._applyEvent({ k: 'award', to: 'P1', by, ...a, reason, shared: pid !== by });
      else this.net.send({ t: 'ev', k: 'award', to: 'P2', by, ...a, reason, shared: pid !== by });
    }
  }
  _applyEvent(ev) {
    switch (ev.k) {
      case 'treeHit': { const t = this.trees.get(ev.tree); if (t) t.hp = ev.hp; break; }
      case 'treeFell': { this.felled.add(ev.tree); const t = this.trees.get(ev.tree); if (t) { t.felled = true; t.hp = 0; } break; }
      case 'logSpawned': this.logs.set(ev.log, { ...ev.info, split: false }); break;
      case 'logSplit': { const l = this.logs.get(ev.log); if (l) { l.split = true; l.by = ev.by; } break; }
      case 'award': if (ev.to !== this.localId) return; break;
    }
    this.emit(ev.k, ev);
  }
}
