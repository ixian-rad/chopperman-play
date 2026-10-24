// One-call integration: createCoop({...}) wires CoopNet + CoopSession + RemotePlayer + CoopUI + window.chopperTest.coop.
// See README.md. Games only provide `hooks` (profile, local state, avatar spawning, world init, event handlers).
import { CoopNet, Emitter, normalizeCode } from './net.js';
import { CoopSession, CHARACTERS, COSTUMES } from './session.js';
import { RemotePlayer } from './remote_player.js';
import { CoopUI } from './ui.js';
import { CoopVoice, distanceGain, panFor, VOICE_DEFAULTS } from './voice.js';
export { CoopNet, CoopSession, RemotePlayer, CoopUI, CoopVoice, distanceGain, panFor, VOICE_DEFAULTS, CHARACTERS, COSTUMES };

export function createCoop(opts) {
  const { THREE, scene, hooks = {}, getCamera = () => null, getViewportHeight = () => (typeof innerHeight === 'number' ? innerHeight : 800) } = opts;
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const cfg = (typeof window !== 'undefined' && window.CHOPPER_COOP_CONFIG) || {};
  const backend = opts.backend || q.get('coopBackend') || cfg.backend || 'peerjs'; // ?coopBackend=loopback for same-browser tests
  const fallback = opts.fallback ?? cfg.fallback ?? null;
  const E = new Emitter();
  const C = { net: null, session: null, ui: null, remotes: new Map(), endReason: null, error: null, E, backendName: backend, voice: null };
  C.on = (ev, fn) => E.on(ev, fn); C.off = (ev, fn) => E.off(ev, fn);
  C.prefillCode = normalizeCode(q.get('coop') || '') || '';
  const change = () => E.emit('change');
  const profile = () => ({ ...(hooks.getProfile?.() || {}) });
  let started = false;
  // Opt-in proximity voice chat (default OFF, remembered in localStorage). createCoop({ voice: false }) removes it; voice: {minDist, maxDist, curve, pan, ...} tunes it.
  if (opts.voice !== false) {
    C.voice = new CoopVoice({ getPartnerName: () => C.session?.remote?.name || 'Partner', ...(typeof opts.voice === 'object' ? opts.voice : {}), ...(cfg.voice || {}) });
    C.voice.on('change', st => { for (const r of C.remotes.values()) r.setSpeaking?.(!!st.remote.speaking); change(); });
  }

  function netOpts() { return { backend, fallback, hz: opts.hz || 15, ...(opts.net || {}) }; }
  function bindSession(s) {
    C.session = s; C.endReason = null; C.error = null;
    s.on('welcome', ev => { s._ready = (async () => {
      try {
        await hooks.onWorldInit?.({ seed: ev.world.seed, setting: ev.world.setting, isHost: false, fresh: true, sync: ev.sync });
        s.registerTrees(await hooks.getTrees?.() || []);
        for (const id of ev.sync.felled) hooks.onTreeFell?.({ k: 'treeFell', tree: id, by: null, dir: [1, 0], instant: true }, false);
        for (const [id, hp] of Object.entries(ev.sync.damaged)) hooks.onTreeHit?.({ k: 'treeHit', tree: id, hp, by: null, dmg: 0, instant: true }, false);
        for (const l of ev.sync.logs) hooks.onLogSpawned?.({ k: 'logSpawned', log: l.id, info: l, by: null, instant: true }, false);
      } catch (e) { console.error('[coop] world init failed', e); }
      change();
    })(); });
    const local = ev => ev.by === s.localId;
    s.on('treeHit', ev => hooks.onTreeHit?.(ev, local(ev)));
    s.on('treeFell', ev => hooks.onTreeFell?.(ev, local(ev)));
    s.on('logSpawned', ev => hooks.onLogSpawned?.(ev, local(ev)));
    s.on('logSplit', ev => hooks.onLogSplit?.(ev, local(ev)));
    s.on('award', ev => hooks.onAward?.(ev, local(ev)));
    s.on('denied', ev => hooks.onDenied?.(ev));
    s.on('playerJoined', p => { spawnRemote(p); hooks.onPlayerJoined?.(p); change(); });
    s.on('playerUpdated', p => { const r = C.remotes.get(p.id); if (r && p.id !== s.localId) r.setProfile(p); change(); });
    s.on('playerDisconnected', p => { hooks.onPlayerDisconnected?.(p); change(); });
    s.on('playerLeft', p => { dropRemote(p.id); hooks.onPlayerLeft?.(p); change(); });
    s.on('reconnecting', change);
    s.on('ended', ({ reason }) => { C.endReason = reason; for (const id of [...C.remotes.keys()]) dropRemote(id); hooks.onEnded?.(reason); change(); });
    s.net.on('status', change); s.net.on('ping', change);
    C.voice?.attach(s.net);
  }
  function spawnRemote(p) {
    if (p.id === C.session?.localId) return; C.remotes.get(p.id)?.dispose();
    const r = new RemotePlayer({ THREE, scene, info: p, spawnAvatar: hooks.spawnAvatar, nameplate: opts.nameplate !== false });
    r.speaking = !!C.voice?.remote.speaking; C.remotes.set(p.id, r); r.load();
  }
  function dropRemote(id) { C.remotes.get(id)?.dispose(); C.remotes.delete(id); }
  function reset() { if (C.session) { for (const id of [...C.remotes.keys()]) dropRemote(id); } C.voice?.detach(); C.net = null; C.session = null; }

  /** Start hosting. Resolves with the room code. Calls hooks.onWorldInit({seed, setting, isHost:true}) so the host's world matches the seed. */
  C.host = async () => {
    if (C.session && !C.session.ended) throw new Error('already in a session');
    reset(); const net = C.net = new CoopNet(netOpts()); C.error = null;
    const w = hooks.getWorld?.() || {};
    const s = new CoopSession({ net, role: 'host', profile: profile(), seed: w.seed, setting: w.setting });
    bindSession(s); change();
    try { const code = await net.host(opts.code); C.code = code; }
    catch (e) { C.error = e; change(); throw e; }
    await hooks.onWorldInit?.({ seed: s.world.seed, setting: s.world.setting, isHost: true, fresh: false });
    s.registerTrees(await hooks.getTrees?.() || []); change(); return C.code;
  };
  C.join = async code => {
    if (C.session && !C.session.ended) throw new Error('already in a session');
    reset(); const net = C.net = new CoopNet(netOpts()); C.error = null;
    const s = new CoopSession({ net, role: 'guest', profile: profile() }); bindSession(s); change();
    try { C.code = await net.join(code); s.start(); } catch (e) { C.error = e; change(); throw e; }
    await new Promise((res, rej) => { const t = setTimeout(() => rej(Object.assign(new Error('Host did not answer'), { code: 'handshake-timeout' })), 10000); s.once('welcome', () => { clearTimeout(t); res(); }); });
    await s._ready; change(); return C.code;
  };
  C.leave = () => { C.session?.leave(); change(); }; // the voice layer sees the net close and releases the mic + AudioContext
  C.inviteLink = () => { const u = new URL(location.href); u.search = ''; u.searchParams.set('coop', C.code || ''); if (backend === 'loopback') u.searchParams.set('coopBackend', 'loopback'); return u.href; };
  /** true while a session exists (also when hosting alone): route tree hits / awards / logs through the session so the host's progress is recorded. */
  C.inSession = () => !!C.session && !C.session.ended;
  C.active = () => !!C.session && !C.session.ended && C.net?.connected;
  C.setLocalProfile = patch => { C.session?.setLocalProfile(patch); };

  C.uiModel = () => {
    const s = C.session, n = C.net; let status = n?.status || 'idle';
    if (s?.ended) status = 'ended'; if (C.error && status !== 'connected' && status !== 'hosting') status = 'error';
    if (status === 'closed' && !s?.ended) status = 'idle'; if (status === 'idle' && C.endReason) status = 'ended';
    return { status, code: s && !s.ended ? C.code : '', backend: n?.backendUsed || backend, error: C.error, endReason: C.endReason, rtt: n?.rtt ?? null,
      players: s && !s.ended ? s.getPlayers().map(p => ({ id: p.id, name: p.name, character: p.character, costume: p.costume, isHost: p.isHost, isYou: p.id === s.localId, connected: p.connected })) : [] };
  };

  /** Call once per frame with the render timestamp (performance.now()). */
  C.update = (now = performance.now()) => {
    const s = C.session; if (!s || s.ended) return;
    if (C.net.connected && hooks.getLocalState) { const st = hooks.getLocalState(); if (st) s.sendLocalState(st); }
    const cam = getCamera(), vh = getViewportHeight();
    for (const [id, r] of C.remotes) r.update(s.sampleRemote(now), { camera: cam, viewportH: vh });
    if (C.voice?.enabled || C.voice?.graph) { // distance feed for the proximity gain: local position/yaw from the game state, remote from the interpolated avatar state
      const me = s.me, rp = s.remote && C.remotes.get(s.remote.id)?.lastState || s.remote?.pos || null;
      const ly = hooks.getListenerYaw?.(); const lp = me ? { x: me.pos.x, y: me.pos.y, z: me.pos.z, yaw: Number.isFinite(ly) ? ly : me.yaw } : null;
      C.voice.update(now, { local: lp, remote: rp && s.remote?.connected !== false ? rp : null });
    }
  };

  C.mountUI = (o = {}) => { C.ui = new CoopUI({ coop: C, ...o }); return C.ui; };

  function voiceHook() {
    const v = C.voice; if (!v) return undefined;
    return {
      state: () => v.state(), enabled: () => v.enabled, muted: () => v.muted, enable: () => v.enable(), disable: () => v.disable(), toggle: () => v.toggle(), mute: f => v.mute(f),
      gain: () => v.targetGain, gainNodeValue: () => v.gainNodeValue(), distance: () => v.distance, setDistance: d => v.setDistance(d), curve: d => v.curveAt(d), configure: p => v.configure(p),
      remote: () => ({ ...v.remote, callState: v.callState }), note: () => v.note().text, positions: () => v.positions, mock: () => !!v.call?.mock || !!v.graph?.mockGain,
      stored: () => { try { return v.storage?.getItem(v.o.storageKey) ?? null; } catch { return null; } },
      graph: () => ({ active: !!v.graph, mock: !!v.graph?.mockGain, panner: !!v.graph?.panner, ctx: v.ctx?.state ?? null, micTracks: v.stream ? v.stream.getAudioTracks().length : 0, micLive: v.stream ? v.stream.getAudioTracks().filter(t => t.readyState === 'live').length : 0, constraints: v.stream?.getAudioTracks()[0]?.getSettings?.() || null }),
    };
  }
  /** window.chopperTest.coop: used by driver/coop/check_coop.mjs. The game adds `fellTree` (and may override anything). */
  C.testHook = (extra = {}) => ({
    backend: () => backend,
    host: () => C.host(),
    join: code => C.join(code),
    leave: () => C.leave(),
    status: () => C.uiModel().status,
    code: () => C.code || null,
    seed: () => C.session?.world.seed ?? null,
    localId: () => C.session?.localId ?? null,
    players: () => (C.session?.getPlayers() || []).map(p => ({ id: p.id, name: p.name, character: p.character, costume: p.costume, axe: p.axe, isHost: p.isHost, connected: p.connected, pos: p.pos })),
    remote: () => {
      const s = C.session; if (!s) return null; const p = s.remote; const r = p && C.remotes.get(p.id); if (!p || !r) return null;
      const st = r.lastState; const root = r.root;
      return { id: p.id, name: p.name, character: p.character, costume: p.costume, axe: p.axe, connected: p.connected, avatarLoaded: !!r.avatar, visible: !!r.visible, nameplate: !!r.sprite, anim: r.anim, x: st?.x ?? null, y: st?.y ?? null, z: st?.z ?? null, rootX: root?.position.x ?? null, rootZ: root?.position.z ?? null };
    },
    felledTrees: () => [...(C.session?.felled || [])],
    ping: () => C.net?.rtt ?? null,
    stats: () => C.net?.stats ?? null,
    voice: voiceHook(),
    ...extra,
  });
  return C;
}
