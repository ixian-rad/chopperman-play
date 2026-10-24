// Co-op glue: wires the shared, harness-neutral module in ./coop/ (createCoop) into this game.
// Everything game-specific the module needs lives here as `hooks`; see coop/README.md.
//
//  * World: the host sends (seed, setting); a guest switches yard and rebuilds the trees from the
//    seed (yard.js resetTrees), so tree ids (= TreeField index), species, positions and hp match.
//  * Trees: while a session exists the local swing only plays chips / sound / wobble and calls
//    session.hitTree(id, power); hp and the fall come back from the host (onTreeHit / onTreeFell).
//  * Logs: the host turns every felled tree into 1-2 shared rounds (spawnLog 'tree-<id>-<n>');
//    both lawns show them. A split claims its round (splitLog): the reward is only requested once
//    the host confirms the claim; the loser gets "log already taken". Rounds that only exist on one
//    lawn are registered as ephemeral logs right before their claim so every split counts toward
//    the shared "team logs split" number.
//  * Rewards: XP / cash go through session.award (actor 100 %, partner 50 %) and are applied in
//    onAward only, never directly (game.js checks game.coop.active()).
//  * Partner: js/avatar.js builds an independent rig for the partner's character / costume / axe.
import * as THREE from 'three';
import { createCoop } from '../coop/index.js';
import { RemoteAvatar, NET_CLIP } from './avatar.js';
import { CHARACTERS, COSTUMES } from './sergey.js';
import { makeLogParams } from './log.js';
import { SPECIES_BY_ID, TREE_WOOD } from './data.js';
import { clamp } from './rng.js';

const $ = (id) => document.getElementById(id);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
function mix(a, b, c) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35) ^ Math.imul(c + 7, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 13)) >>> 0;
}

export function setupCoop(ctx) {
  const { scene, camera, renderer, game, player, world, sergey, swingCtl, logs, ready, profile, setSetting, isLow } = ctx;
  const avatars = new Set();
  const pending = new Map(); // claimed log id -> reward waiting for the host's verdict
  let ephSeq = 0;
  let dropT = 0;
  const S = () => coop.session;
  const nameOf = (id) => S()?.players.get(id)?.name ?? 'Your partner';
  const treeById = (id) => world.field?.trees[+id] ?? null;
  const remoteRoot = () => { for (const r of coop.remotes.values()) if (r.visible && r.root) return r.root; return null; };
  const bigToast = (text, kind = 'info') => game.toast(text, kind, true);

  function spawnTreeLogs(tree) {
    const hits = tree.meta.hitsToFell ?? 5;
    const n = hits >= 8 ? 2 : 1;
    const wood = TREE_WOOD[tree.species] ?? 'pine';
    const size = clamp((tree.meta.height * tree.scale) / 14, 0.3, 1.2);
    for (let i = 1; i <= n; i++) S().spawnLog({ id: `tree-${tree.id}-${i}`, species: wood, seed: mix(world.seed, tree.id, i), size, tree: tree.id });
  }

  // The round on our block was split by the partner: put the next one on (unless mid-swing,
  // in which case our own claim will be refused).
  function dropBlockLog() {
    if (swingCtl.busy) return;
    game.cancelMeter();
    game.pendingNext = null;
    logs.clearAll();
    game.nextLog(true);
  }

  function flushPending() {
    // The session ended before the host answered: keep what the player earned.
    for (const r of pending.values()) game.applyAward(r.xp, r.cash);
    pending.clear();
  }

  const coop = createCoop({
    THREE, scene,
    getCamera: () => camera,
    getViewportHeight: () => renderer.domElement.clientHeight || innerHeight,
    hooks: {
      getProfile: () => profile(),
      getWorld: () => ({ seed: world.seed, setting: world.id ?? 'nj' }),
      onWorldInit: async ({ seed, setting, isHost }) => {
        await ready;
        player.act = null;
        player.target = null;
        if (!isHost && world.id !== setting) await setSetting(setting);
        // Guest: discard local felled / damaged trees; host: a fresh shared yard (felled trees are
        // never saved, so this only resets the current visit).
        await world.resetTrees(seed);
        player.target = null;
      },
      getTrees: async () => {
        await ready;
        return (world.field?.trees ?? []).map((t) => ({ id: t.id, hp: t.meta.hitsToFell, x: t.position.x, z: t.position.z }));
      },
      getLocalState: () => {
        const r = sergey.root;
        const key = sergey.current;
        return { x: r.position.x, y: r.position.y, z: r.position.z, yaw: r.rotation.y, anim: NET_CLIP[key] ?? 'Idle', swinging: key === 'chop' || key === 'hammer', running: key === 'run' };
      },
      spawnAvatar: async ({ character, costume, axe }) => {
        const av = new RemoteAvatar(scene, { character, costume, axe, low: isLow() });
        avatars.add(av);
        try { await av.load(); } catch (e) { console.warn('[coop] partner model failed to load', e); }
        return {
          root: av.root, headHeight: av.headHeight, yawOffset: 0,
          setAnim: (clip) => av.setAnim(clip),
          dispose: () => { avatars.delete(av); av.dispose(); },
        };
      },
      onTreeHit: (ev, mine) => {
        const t = treeById(ev.tree);
        if (t) player.applyHit(t, ev.hp, { mine, instant: !!ev.instant, from: remoteRoot()?.position ?? null });
        game.emit('change');
      },
      onTreeFell: (ev, mine) => {
        const t = treeById(ev.tree);
        if (!t) return;
        const live = t.state === 'standing' || t.state === 'chopping';
        player.applyFell(t, new THREE.Vector3(ev.dir?.[0] ?? 1, 0, ev.dir?.[1] ?? 0), { mine, by: nameOf(ev.by), instant: !!ev.instant });
        if (S()?.isHost && !ev.instant && live) spawnTreeLogs(t);
        game.emit('change');
      },
      onLogSpawned: (ev) => {
        const info = ev.info || {};
        if (info.eph || info.split) return;
        const sp = SPECIES_BY_ID[info.species];
        if (!sp) return;
        const params = makeLogParams(info.seed >>> 0, { species: sp, traits: [], knotChance: 0.2, nailChance: 0, sizeBias: clamp((info.size ?? 0.6) * 0.6, 0, 1) });
        params.coopLog = ev.log;
        game.addSharedRound(params);
      },
      onLogSplit: (ev, mine) => {
        if (mine) {
          const r = pending.get(ev.log);
          pending.delete(ev.log);
          if (r && (r.xp || r.cash)) S().award({ xp: r.xp, gold: r.cash, reason: 'split' });
        } else {
          const lawn = game.removeSharedRound(ev.log);
          const block = logs.log?.params.coopLog === ev.log;
          if (block) dropBlockLog();
          if (lawn || block) game.toast(`${nameOf(ev.by)} split that round first: log already taken`, 'warn', true);
        }
        updateHud();
      },
      onDenied: (ev) => {
        if (ev.kind !== 'logSplit') return; // refused tree hits (already felled) need no message
        pending.delete(ev.log);
        bigToast('Log already taken: your partner split it first. No reward for this one.', 'warn');
        updateHud();
      },
      onAward: (ev, mine) => {
        game.applyAward(ev.xp | 0, ev.gold | 0);
        const money = ev.gold ? `, +$${ev.gold}` : '';
        if (ev.shared) game.toast(`${nameOf(ev.by)} +${ev.xp} XP${money} shared`, 'good');
        else if (mine && ev.reason === 'tree') game.toast(`Tree felled: +${ev.xp} XP${money}`, 'good');
      },
      onPlayerJoined: (p) => {
        bigToast(`${p.name} joined as ${CHARACTERS[p.character]?.name ?? cap(p.character)} (${COSTUMES[p.costume]?.name ?? p.costume})`, 'good');
        updateHud();
      },
      onPlayerLeft: (p) => { clearTimeout(dropT); bigToast(`${p.name} left. Back to single player.`, 'warn'); updateHud(); },
      // A deliberate Disconnect also reports a dropped link first: only warn if it is not
      // followed by the "left" notice right away.
      onPlayerDisconnected: (p) => {
        clearTimeout(dropT);
        dropT = setTimeout(() => { if (S()?.remote && !S().remote.connected) bigToast(`${p.name} lost the connection. Waiting for them to come back…`, 'warn'); }, 1500);
        updateHud();
      },
      onEnded: (reason) => {
        flushPending();
        const host = S()?.players.get('P1');
        if (reason === 'host-left') bigToast(`${host?.name ?? 'The host'} left. Back to single player.`, 'warn');
        else if (reason === 'lost') bigToast('Connection lost. Back to single player.', 'warn');
        else bigToast('You left co-op. Back to single player.', 'info');
        updateHud();
      },
    },
  });

  // Game / player adapters (see game.js scoreOutcome + onTreeFelled, player.js treeImpact).
  game.coop = {
    active: () => coop.inSession(),
    award: ({ xp = 0, cash = 0, reason = '' }) => { if (xp || cash) S().award({ xp, gold: cash, reason }); },
    split: (P, reward) => {
      let id = P.coopLog;
      delete P.coopLog; // a reset + re-split of the same round is a new (ephemeral) claim
      if (!id) {
        id = `${S().localId ?? 'P'}-e${++ephSeq}-${Math.random().toString(36).slice(2, 6)}`;
        S().spawnLog({ id, eph: 1 });
      }
      pending.set(id, reward);
      S().splitLog(id);
    },
  };
  player.coop = {
    active: () => coop.inSession(),
    hitTree: (tree, power) => S().hitTree(tree.id, Math.min(5, power)),
  };

  // HUD: shared "team logs split" counter, only while a session exists.
  function teamSplits() {
    let n = 0;
    for (const l of S()?.logs.values() ?? []) if (l.split) n++;
    return n;
  }
  function updateHud() {
    const row = $('h-teamrow');
    if (!row) return;
    const on = coop.inSession();
    row.classList.toggle('hidden', !on);
    if (!on) return;
    $('h-team').textContent = String(teamSplits());
    const p = S().remote;
    $('h-partner').textContent = p ? `with ${p.name}${p.connected ? '' : ' (reconnecting)'}` : 'waiting for a partner';
  }
  coop.on('change', updateHud);

  // Nameplates: the module's sprite is rendered inside the 3D view, which Low / Potato draw at
  // 0.3x resolution (blurry text). Draw the name as a crisp DOM label at the sprite's position and
  // keep the module's sprite (it still drives remote().nameplate) fully transparent.
  const plates = new Map(); // remote id -> div
  const _p = new THREE.Vector3();
  function updatePlates() {
    const seen = new Set();
    for (const [id, r] of coop.remotes) {
      const sp = r.sprite;
      if (!sp) continue;
      seen.add(id);
      if (sp.material.opacity !== 0) sp.material.opacity = 0;
      let el = plates.get(id);
      if (!el) { el = document.createElement('div'); el.className = 'nameplate'; document.body.appendChild(el); plates.set(id, el); }
      const name = r.info.name || 'Player';
      if (el.textContent !== name) el.textContent = name;
      el.classList.toggle('host', !!r.info.isHost);
      // Voice chat: the module sets r.speaking (it would redraw its own sprite, which is hidden here).
      el.classList.toggle('speaking', !!r.speaking);
      _p.copy(sp.position).project(camera);
      const on = r.visible && _p.z < 1 && Math.abs(_p.x) < 1.05 && Math.abs(_p.y) < 1.05;
      el.hidden = !on;
      if (on) {
        const w = renderer.domElement.clientWidth || innerWidth, h = renderer.domElement.clientHeight || innerHeight;
        el.style.transform = `translate(${((_p.x + 1) / 2) * w}px, ${((1 - _p.y) / 2) * h}px) translate(-50%, -50%)`;
      }
    }
    for (const [id, el] of plates) if (!seen.has(id)) { el.remove(); plates.delete(id); }
  }

  return {
    coop,
    avatars,
    remoteRoot,
    teamSplits,
    update(now, dt) {
      coop.update(now);
      for (const av of avatars) av.update(dt);
      updatePlates();
    },
    setLow(on) { for (const av of avatars) av.setLow(on); },
    profileChanged() { coop.setLocalProfile(profile()); },
  };
}
