// Game rules: progression (XP, levels, skills), economy and shop, stamina, the timing/power meter,
// aiming error, the queue of rounds waiting on the lawn, scoring/combos and persistence.
import * as THREE from 'three';
import { AXES_BY_ID, SPECIES, HONE_TIERS, GLOVES_PRICE, SHARPEN_PRICE, SKILLS, TRAITS, xpForLevel } from './data.js';
import { makeLogParams, makeStaticRound } from './log.js';
import { resolveImpact, logConditions, planeFactors } from './fracture.js';
import { ModeRun, freeVariants } from './modes.js';
import { Rng, clamp } from './rng.js';

const SAVE_KEY = 'backyard-log-splitter-save-v2';
const QUEUE_LEN = 5;
// Queue slots: a row of rounds standing on the lawn to the left of the chopping block.
const SLOTS = [[-2.15, -0.95], [-2.55, -0.55], [-2.95, -0.15], [-3.35, 0.25], [-3.75, 0.65]];

function freshProgress() {
  return {
    v: 2, score: 0, level: 1, xp: 0, cash: 0, skillPoints: 0,
    skills: { strength: 0, endurance: 0, focus: 0 },
    axe: 'utility', owned: ['utility'], sharp: { utility: AXES_BY_ID.utility.sharp }, hone: 0, gloves: false,
    bestCombo: 0, stats: { swings: 0, splits: 0, bullseyes: 0, pieces: 0, glances: 0, nails: 0, misses: 0, stuck: 0 },
    woodpile: 0, logSeq: 1, seenHelp: false,
    records: { timeattack: 0, precision: 0, daily: null, dailyPaid: null, campaign: {} },
    settings: { quality: 'auto', weather: 'clear', hour: 16.5, timeFlow: true, sound: true, slowmo: true },
  };
}

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, physics, logs, swing, chips, dust, sparks, audio, weather, env, blockTop
    this.rng = new Rng((Math.random() * 1e9) | 0);
    this.p = this.load();
    this.stamina = this.maxStamina;
    this.combo = 0;
    this.lastHit = null;
    this.restT = 10;
    this.queue = [];
    this.meter = { active: false, t: 0, value: 0, holdMode: false };
    this.aim = { dx: 0, dz: 0, yaw: 0 };
    this.sway = { x: 0, z: 0 };
    this.messages = [];
    this.listeners = {};
    this.pendingResult = null;
    this.saveT = 0;
    this.needed = null;
    this.fx = { shake: 0 };
    this.mode = null; // null = free play (endless); otherwise a ModeRun
    this.swing.strength = this.strengthMult;
    this.swing.setAxe(this.axeStats);
    this.swing.onContact = (c) => this.onContact(c);
  }

  on(type, fn) { (this.listeners[type] ??= []).push(fn); }
  emit(type, data) { for (const fn of this.listeners[type] ?? []) fn(data); }
  toast(text, kind = 'info', big = false) { this.emit('toast', { text, kind, big }); }

  // ------------------------------------------------------------------ persistence

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const f = freshProgress();
        const p = { ...f, ...d, skills: { ...f.skills, ...d.skills }, stats: { ...f.stats, ...d.stats }, settings: { ...f.settings, ...d.settings },
          records: { ...f.records, ...d.records, campaign: { ...f.records.campaign, ...d.records?.campaign } } };
        if (!AXES_BY_ID[p.axe]) p.axe = 'utility';
        return p;
      }
    } catch (e) { console.warn('Could not load save:', e.message); }
    return freshProgress();
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.p)); } catch { /* private mode */ }
  }

  resetProgress() {
    const settings = this.p.settings;
    if (this.mode) this.endMode('quit', true);
    this.p = freshProgress();
    this.p.settings = settings;
    this.p.seenHelp = true;
    this.combo = 0;
    this.lastHit = null;
    this.swing.strength = this.strengthMult;
    this.swing.setAxe(this.axeStats);
    this.stamina = this.maxStamina;
    this.env.woodpile?.setPieces(0);
    this.rebuildQueue();
    this.nextLog(true);
    this.save();
    this.toast('Progress reset', 'warn');
    this.emit('change');
  }

  // ------------------------------------------------------------------ derived stats

  get axeStats() { return AXES_BY_ID[this.p.axe]; }
  get maxSharp() { return Math.min(1, this.axeStats.sharp + HONE_TIERS.slice(0, this.p.hone).reduce((s, h) => s + h.bonus, 0)); }
  get sharpness() { return this.p.sharp[this.p.axe] ?? this.axeStats.sharp; }
  set sharpness(v) { this.p.sharp[this.p.axe] = clamp(v, 0.15, this.maxSharp); }
  get maxStamina() { return 100 + 15 * this.p.skills.endurance; }
  get strengthMult() { return 1 + 0.06 * this.p.skills.strength; }
  get focus() { return this.p.skills.focus; }
  get unlocked() { return SPECIES.filter((s) => s.unlock <= this.p.level); }
  get xpNext() { return xpForLevel(this.p.level); }
  get regenRate() { return 6 + 1.2 * this.p.skills.endurance; }
  costFor(power, axe = this.axeStats) {
    return (6 + 16 * power * power) * Math.pow((axe.headMass + axe.handleMass) / 2.4, 0.65) * (1 - 0.03 * this.p.skills.endurance);
  }

  // ------------------------------------------------------------------ log queue

  makeParams() {
    return this.mode ? this.mode.nextParams() : this.freeParams();
  }

  // Free play (endless): species and variants follow the player's level.
  freeParams({ noBoss = false } = {}) {
    const L = this.p.level;
    const pool = this.unlocked;
    // Newest unlocks show up more often; knots and nails get more common with level.
    const weights = pool.map((s) => 1 + (s.unlock >= L - 2 ? 1.5 : 0));
    let r = this.rng.next() * weights.reduce((a, b) => a + b, 0);
    let sp = pool[0];
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { sp = pool[i]; break; } }
    const seed = (this.p.logSeq++ * 7919 + ((Math.random() * 1e6) | 0)) >>> 0;
    const tutorial = L === 1 && this.p.stats.splits < 3; // the first rounds are clean and small
    const v = tutorial ? { traits: [], boss: null } : freeVariants(L, this.rng, this.p.logSeq - 1);
    if (noBoss && v.boss) { v.boss = null; v.traits = v.traits.filter((t) => t !== 'huge'); }
    // Punky ironwood is not a thing; a boss gets a toughness discount so it stays beatable.
    if (sp.id === 'ironwood') v.traits = v.traits.filter((t) => t !== 'rotten');
    return makeLogParams(seed, {
      species: sp,
      traits: v.traits,
      boss: v.boss,
      reqMul: v.boss ? 0.85 : 1,
      knotChance: tutorial ? 0 : Math.min(0.55, 0.12 + 0.04 * L),
      nailChance: L < 3 ? 0 : Math.min(0.14, 0.03 + 0.01 * L),
      sizeBias: tutorial ? 0 : clamp(L / 12, 0, 1),
    });
  }

  addToQueue(params) {
    if (!params) return null;
    const mesh = makeStaticRound(params);
    this.scene.add(mesh);
    const item = { params, mesh };
    this.queue.push(item);
    return item;
  }

  layoutQueue(animate = true) {
    this.queue.forEach((it, i) => {
      const [x, z] = SLOTS[Math.min(i, SLOTS.length - 1)];
      it.target = new THREE.Vector3(x, 0, z);
      if (!animate || !it.placed) { it.mesh.position.copy(it.target); it.mesh.rotation.y = it.params.seed % 6.28; it.placed = true; }
    });
  }

  rebuildQueue() {
    for (const it of this.queue) {
      this.scene.remove(it.mesh);
      it.mesh.geometry.dispose();
      it.mesh.traverse((c) => { if (c !== it.mesh && c.userData.ownGeo) c.geometry.dispose(); });
      for (const m of it.mesh.userData.mats ?? []) m.dispose();
    }
    this.queue = [];
    while (this.queue.length < QUEUE_LEN) {
      const params = this.makeParams();
      if (!params) break;
      this.addToQueue(params);
    }
    this.layoutQueue(false);
  }

  // Carry the next round from the queue onto the block.
  nextLog(instant = false) {
    // A finite mode whose rounds are all done ends here (after the last pieces were cleared).
    if (!this.queue.length && this.mode) this.endMode('done', true);
    if (!this.queue.length) this.rebuildQueue();
    const it = this.queue.shift();
    this.addToQueue(this.makeParams());
    this.layoutQueue(true);
    const from = it.mesh.position.clone();
    const fromQuat = it.mesh.quaternion.clone();
    this.scene.remove(it.mesh);
    this.logs.createLog(it.params, null, { mesh: it.mesh, mats: it.mesh.userData.mats, from: instant ? null : from, fromQuat, dur: 0.6 });
    this.aim.dx = 0;
    this.aim.dz = 0;
    this.applyAim();
    this.needed = null;
    if (instant) this.swing.setReady();
    if (it.params.boss) {
      this.toast(`BOSS: ${it.params.boss.name}`, 'boss', true);
      if (it.params.boss.intro) this.toast(it.params.boss.intro, 'info');
      this.audio.bossIntro?.();
      this.fx.shake = Math.max(this.fx.shake, 0.8);
      this.emit('boss', it.params.boss);
    }
    this.emit('log');
  }

  // ------------------------------------------------------------------ modes

  // type: 'campaign' (opts.stage), 'timeattack', 'precision', 'daily'.
  startMode(type, opts = {}) {
    if (this.swing.busy && this.swing.state !== 'done') this.swing.setReady();
    if (this.mode) this.endMode('quit', true);
    this.cancelMeter();
    const run = new ModeRun(this, type, opts);
    this.mode = run;
    this.combo = 0;
    if (run.weather) {
      this.savedWx = { weather: this.p.settings.weather, hour: this.weather.hour };
      this.host?.setWeather(run.weather, true);
      this.weather.applyInstant?.(); // a stage starts in its weather, not halfway through a transition
      if (run.hour !== undefined) this.weather.setHour(run.hour);
    }
    this.resetBoard();
    this.toast(run.name, 'level', true);
    this.emit('mode', run.status());
    this.emit('change');
    return true;
  }

  // reason: 'done' | 'time' | 'quit'. `inline` = called from nextLog (don't place a new round).
  endMode(reason = 'quit', inline = false) {
    const run = this.mode;
    if (!run) return null;
    const sum = run.finish(reason);
    this.mode = null;
    if (this.savedWx) {
      this.host?.setWeather(this.savedWx.weather, true);
      this.weather.setHour(this.savedWx.hour);
      this.savedWx = null;
    }
    this.save();
    this.emit('modeEnd', sum);
    this.emit('change');
    if (!inline) this.resetBoard();
    else this.rebuildQueue();
    return sum;
  }

  // Clear the block and the lawn and put the first round of the current mode on.
  resetBoard() {
    this.cancelMeter();
    this.pendingNext = null;
    this.logs.clearAll();
    this.chips.clear();
    this.rebuildQueue();
    this.nextLog(true);
    this.swing.setReady();
  }

  onLogLanded() {
    this.swing.solveRigTarget();
    if (this.swing.state === 'done') this.swing.liftToLog();
    this.audio.knock(0.6);
    this.dust.burst(new THREE.Vector3(0, this.blockTop + 0.01, 0), 30, 0.3, this.rng);
    this.emit('log');
  }

  // ------------------------------------------------------------------ aiming

  applyAim() {
    const log = this.logs.log;
    const cx = log ? log.pos.x : 0, cz = log ? log.pos.z : 0;
    this.swing.setAim(cx + this.aim.dx, cz + this.aim.dz, this.aim.yaw);
  }

  setAimWorld(x, z) {
    const log = this.logs.log;
    if (!log) return;
    let dx = x - log.pos.x, dz = z - log.pos.z;
    const r = Math.hypot(dx, dz), max = log.params.R * 1.08;
    if (r > max) { dx *= max / r; dz *= max / r; }
    this.aim.dx = dx;
    this.aim.dz = dz;
    this.applyAim();
  }

  nudgeAim(dx, dz) {
    const log = this.logs.log;
    if (!log) return;
    this.setAimWorld(log.pos.x + this.aim.dx + dx, log.pos.z + this.aim.dz + dz);
  }

  rotateBlade(d) {
    this.aim.yaw += d;
    this.applyAim();
    this.needed = null;
    this.emit('yaw', d);
  }

  // ------------------------------------------------------------------ meter

  get meterPeriod() {
    const fr = this.stamina / this.maxStamina;
    return 1.45 * (1 + 0.04 * this.focus) * (0.72 + 0.28 * fr);
  }
  get sweetZone() {
    const half = 0.045 + 0.006 * this.focus;
    return [0.86 - half, 0.86 + half];
  }

  startMeter(holdMode = false) {
    if (!this.swing.canSwing || this.meter.active) return false;
    this.meter.active = true;
    this.meter.t = 0;
    this.meter.t0 = performance.now();
    this.meter.period = this.meterPeriod;
    this.meter.value = 0;
    this.meter.holdMode = holdMode;
    this.emit('meter', true);
    return true;
  }

  cancelMeter() {
    if (!this.meter.active) return;
    this.meter.active = false;
    this.emit('meter', false);
  }

  // Meter value from wall-clock time, so timing is exact even at a low frame rate.
  meterValueNow() {
    const ph = ((performance.now() - this.meter.t0) / 1000 / (this.meter.period ?? this.meterPeriod)) % 2;
    return ph < 1 ? ph : 2 - ph;
  }

  stopMeter() {
    if (!this.meter.active) return false;
    const v = this.meterValueNow();
    this.meter.value = v;
    this.meter.active = false;
    this.emit('meter', false);
    const [lo, hi] = this.sweetZone;
    let timing = 'good', errMul = 1;
    if (v >= lo && v <= hi) { timing = 'perfect'; errMul = 0.35; }
    else if (v > hi) { timing = 'over'; errMul = 1 + 6 * (v - hi); }
    else if (v < 0.35) { timing = 'weak'; errMul = 0.8; }
    return this.doSwing({ power: v, timing, errMul, sway: { ...this.sway } });
  }

  // ------------------------------------------------------------------ swinging

  aimScatter(cond) {
    const fr = this.stamina / this.maxStamina;
    return 0.011 * (1 + 1.2 * (1 - fr) ** 2) * cond.footing * (1 - 0.07 * this.focus) * (1 + cond.wind.speed * 0.025);
  }

  doSwing({ power, timing = 'good', errMul = 1, sway = null, test = false }) {
    if (!this.swing.canSwing) return false;
    const cond = this.weather.conditions;
    let pw = clamp(power, 0, 1);
    const cost = this.costFor(pw);
    let exhausted = false;
    if (this.stamina < cost) {
      pw *= 0.45 + 0.55 * this.stamina / cost;
      exhausted = true;
      this.stamina = 0;
    } else this.stamina -= cost;
    this.restT = 0;
    // Wet hands slip on the handle.
    const slip = !test && this.rng.next() < 0.28 * cond.wet * (this.p.gloves ? 0.25 : 1);
    if (slip) pw *= 0.75;
    const sd = this.aimScatter(cond) * errMul * (slip ? 1.8 : 1) * (exhausted ? 1.6 : 1) * (test ? 0.15 : 1);
    const err = { x: this.rng.gauss(0, sd) + (sway?.x ?? 0), z: this.rng.gauss(0, sd) + (sway?.z ?? 0) };
    // The wind pushes the head sideways a little in strong gusts.
    err.x += cond.wind.x * 0.0009 * (test ? 0 : 1);
    err.z += cond.wind.z * 0.0009 * (test ? 0 : 1);
    const ok = this.swing.requestSwing({ power: pw, error: err });
    if (!ok) return false;
    this.p.stats.swings++;
    this.pendingResult = { timing, power: pw, requested: power, slip, exhausted, error: err };
    if (exhausted) this.toast('Exhausted — weak swing', 'warn');
    if (slip) this.toast('Wet handle — hands slipped!', 'warn');
    this.emit('swing', this.pendingResult);
    return true;
  }

  // Automated test hook: an immediate, reasonably good swing at the current aim.
  testSwing(power) {
    if (this.meter.active) this.cancelMeter();
    if (!this.logs.log) { this.pendingNext = null; this.nextLog(true); }
    const log = this.logs.log;
    if (log && log.anim) { log.anim.t = log.anim.dur; this.logs.animate(0); }
    if (this.swing.state === 'done' || this.swing.state === 'lift') this.swing.setReady();
    if (!this.swing.canSwing) return false;
    let p = power ?? 0.92;
    if (p > 1) p /= 100;
    p = clamp(p, 0.05, 1);
    // The hook must always give a decent swing: act as if the player rested just long enough.
    this.stamina = Math.max(this.stamina, this.costFor(p));
    return this.doSwing({ power: p, timing: 'perfect', errMul: 1, test: true });
  }

  // ------------------------------------------------------------------ impact

  onContact(contact) {
    const log = this.logs.log;
    const cond = this.weather.conditions;
    const pend = this.pendingResult ?? { timing: 'good' };
    const out = resolveImpact({ logs: this.logs, contact, axe: this.axeStats, sharpness: this.sharpness, cond, slip: pend.slip, rng: this.rng });
    const P = log.params;
    const sp = P.species;
    const impact = contact.impact;
    const lc = logConditions(cond, P, !!log.iceShell);
    const n = new THREE.Vector3(-contact.edgeDir.z, 0, contact.edgeDir.x);
    const woodCol = [P.sap[0] / 255 * 0.95, P.sap[1] / 255 * 0.9, P.sap[2] / 255 * 0.85];
    const barkCol = [P.outerBark[0] / 255, P.outerBark[1] / 255, P.outerBark[2] / 255];
    const colors = [woodCol, barkCol];
    const dryK = 1 - 0.55 * lc.wet;
    // Dense ironwood fibres dull the edge several times faster.
    this.sharpness = this.sharpness - 0.004 * sp.hard * (sp.dulls ?? 1);
    // The ice glaze shatters under anything but a feeble glancing tap.
    if (log.iceShell && (out.kind !== 'glance' || contact.Eeff > 140 || this.rng.next() < 0.4)) {
      this.logs.shatterIce();
      out.iceBroke = true;
      const ice = [[0.86, 0.93, 1.0], [0.74, 0.86, 0.96]];
      this.chips.burst(impact, n, contact.edgeDir, 26, 1.1, this.rng, { colors: ice, bark: 0.5 });
      this.dust.burst(impact, 90, 0.9, this.rng);
      this.audio.iceShatter?.();
    }
    this.fx.shake = Math.max(this.fx.shake, 0.25 + 0.5 * clamp(contact.Eeff / 400, 0, 1));
    log.hits++;
    switch (out.kind) {
      case 'split': {
        const pieces = this.logs.split({ primary: out.line, count: out.count, vLat: out.vLat, excess: out.excess, rng: this.rng });
        out.pieces = pieces.length;
        const ex = Math.min(1, out.excess);
        const frozenK = 1 + 0.6 * lc.frozen;
        this.chips.burst(impact, n, contact.edgeDir, Math.round((14 + 16 * ex) * frozenK * dryK), 0.8 + 0.6 * ex, this.rng, { colors, bark: 0.25 });
        const spl = Math.round((sp.interlocked ? 10 : 3) + (out.knotHit ? 8 : 0) + (P.fork ? 8 : 0) + (P.twist ? 5 : 0) + 6 * lc.frozen);
        this.chips.burst(impact, n, contact.edgeDir, spl, 0.6, this.rng, { colors, bark: 0.05, splinter: true });
        this.dust.burst(impact, Math.round((150 + 120 * ex) * dryK), 1.0 + ex, this.rng);
        if (out.crumble) {
          // Punky wood falls apart in soft brown crumbs and a cloud of rot dust.
          const punk = [[0.42, 0.31, 0.2], [0.3, 0.21, 0.13]];
          this.chips.burst(impact, n, contact.edgeDir, 22, 0.5, this.rng, { colors: punk, bark: 0.4 });
          this.dust.burst(impact, 260, 0.7, this.rng);
          this.audio.punk?.();
        } else this.audio.crack(out.ratio, lc.frozen);
        if (P.boss) this.fx.shake = Math.max(this.fx.shake, 1.2);
        this.fx.shake = Math.max(this.fx.shake, 0.6 + 0.4 * ex);
        break;
      }
      case 'stuck':
        this.logs.addCrack(out.line, out.crackDepth, out.crackOpen);
        log.damage += out.damageAdd;
        this.chips.burst(impact, n, contact.edgeDir, Math.round(6 * dryK), 0.5, this.rng, { colors });
        this.dust.burst(impact, Math.round(60 * dryK), 0.6, this.rng);
        this.audio.thunk(Math.min(1, contact.Eeff / 250), true);
        break;
      case 'glance':
        this.chips.burst(impact, n, contact.edgeDir, 8, 0.7, this.rng, { colors, bark: 0.85 });
        this.dust.burst(impact, 40, 0.5, this.rng);
        this.audio.glance();
        break;
      case 'nail': {
        const rock = out.hazard === 'rock';
        this.sparks.burst(out.nailPoint ?? impact, rock ? 140 : 70, rock ? 5.5 : 4.5, this.rng);
        this.emit('sparkLight', out.nailPoint ?? impact);
        this.sharpness = this.sharpness - out.sharpLoss;
        this.chips.burst(impact, n, contact.edgeDir, rock ? 10 : 4, rock ? 0.8 : 0.4, this.rng, { colors: rock ? [[0.5, 0.49, 0.46], [0.36, 0.35, 0.33]] : colors });
        if (rock) this.audio.stone?.(); else this.audio.clang();
        this.fx.shake = Math.max(this.fx.shake, rock ? 1.0 : 0.7);
        break;
      }
    }
    this.scoreOutcome(out, { pend, cond, P, contact });
    return out;
  }

  onBlockHit(info) {
    // A blade that never touched the round hits the chopping block (or the dirt).
    if (info.missedLog && this.logs.log) {
      this.dust.burst(info.impact, 40, 0.5, this.rng);
      this.audio.thunk(Math.min(1, info.Eeff / 200), false);
      if (!info.overBlock) this.sharpness = this.sharpness - 0.03;
      this.scoreOutcome({ kind: 'miss', offset: 1.2, Ein: info.Eeff, vHead: info.vHead }, { pend: this.pendingResult ?? {}, cond: this.weather.conditions, P: this.logs.log.params });
    } else {
      this.audio.thunk(Math.min(1, info.Eeff / 300), false);
    }
  }

  onSwingEnd() {
    if (!this.logs.log) this.pendingNext = { t: 0, pushed: false };
    this.save();
  }

  // Before the next round goes on, sweep split pieces off the block top.
  updatePendingNext(dt) {
    const pn = this.pendingNext;
    if (!pn) return;
    pn.t += dt;
    const on = this.logs.piecesOnBlock();
    if (on.length && !pn.pushed && pn.t > 0.45) {
      pn.pushed = true;
      for (const p of on) {
        const b = p.entry.body;
        const t = b.translation();
        const d = new THREE.Vector3(t.x, 0, t.z);
        if (d.lengthSq() < 1e-6) d.set(this.rng.float(-1, 1), 0, this.rng.float(-1, 1));
        d.normalize();
        const m = b.mass();
        b.applyImpulse({ x: d.x * m * 1.7, y: m * 0.9, z: d.z * m * 1.7 }, true);
        b.applyTorqueImpulse({ x: d.z * m * 0.05, y: 0, z: -d.x * m * 0.05 }, true);
      }
      this.audio.knock(0.4);
    }
    if ((!on.length && pn.t > 0.3) || pn.t > 2.2) {
      this.pendingNext = null;
      this.nextLog();
    }
  }

  // ------------------------------------------------------------------ scoring

  scoreOutcome(out, { pend, cond, P }) {
    const sp = P.species;
    const st = this.p.stats;
    const base = sp.value * Math.pow(P.R / 0.15, 1.2);
    const labels = [];
    let points = 0, xp = 0, cash = 0, mult = 1, clean = false;
    const off = Math.abs(out.offset ?? 0);
    const hitsBefore = (this.logs.log?.hits ?? 1) - 1;
    let grade = '';
    if (out.iceBroke) labels.push('Ice glaze shattered');
    if (out.kind === 'split') {
      st.splits++;
      st.pieces += out.pieces ?? 2;
      if (off < 0.07) { grade = 'Bullseye'; mult *= 1.5; st.bullseyes++; clean = true; }
      else if (off < 0.18) { grade = 'Clean split'; mult *= 1.2; clean = true; }
      else if (off < 0.36) { grade = 'Off-centre'; mult *= 0.8; }
      else { grade = 'Slab'; mult *= 0.5; }
      labels.push(grade);
      if (out.alongCheck) { mult += 0.3; labels.push('Along the check +30%'); }
      if (out.knotDodged) { mult += 0.25; labels.push('Dodged the knot +25%'); }
      if (out.knotHit) { mult += 0.2; labels.push('Through the knot +20%'); }
      if (out.forkAligned) { mult += 0.2; labels.push('Through the crotch +20%'); }
      for (const t of P.traits ?? []) {
        const T = TRAITS[t];
        if (!T || !T.value) continue;
        mult += T.value;
        labels.push(`${T.name} ${T.value > 0 ? '+' : '−'}${Math.round(Math.abs(T.value) * 100)}%`);
      }
      mult = Math.max(0.2, mult);
      if (P.boss) { mult *= 1.5; labels.push(`Boss down ×1.5`); }
      if (hitsBefore === 0) { mult *= 1.25; labels.push('One hit ×1.25'); } else clean = false;
      if ((out.pieces ?? 2) > 2) { mult += 0.1 * (out.pieces - 2); labels.push(`${out.pieces} pieces`); }
      if (out.ratio < 1.45) { mult += 0.1; labels.push('Efficient blow +10%'); }
      if (pend.timing === 'perfect') { mult += 0.15; labels.push('Perfect timing +15%'); }
      if (cond.scoreBonus > 0) { mult *= 1 + cond.scoreBonus; labels.push(`${cond.bonusLabel} ×${(1 + cond.scoreBonus).toFixed(2)}`); }
      if (clean) {
        this.combo++;
        if (this.combo > 1) labels.push(`Combo ×${(1 + 0.15 * Math.min(this.combo - 1, 12)).toFixed(2)}`);
      } else this.combo = 0;
      mult *= 1 + 0.15 * Math.min(Math.max(0, this.combo - 1), 12);
      points = Math.round(base * mult);
      xp = Math.round(points * 0.4 + 10);
      const acc = 1 - clamp(off / 0.6, 0, 1);
      const traitCash = (P.traits ?? []).reduce((k, t) => k * (TRAITS[t]?.cash ?? 1), 1);
      cash = Math.round((out.pieces ?? 2) * sp.price * (0.6 + 0.4 * acc) * (1 + cond.scoreBonus) * traitCash * (out.pieces > 3 && P.rot ? 0.6 : 1));
      if (P.boss) {
        const bounty = Math.round(40 + 0.5 * P.req);
        cash += bounty;
        this.toast(`${P.boss.name} is down! +$${bounty}`, 'boss', true);
      }
      this.p.woodpile += out.pieces ?? 2;
      this.env.woodpile?.setPieces(this.p.woodpile);
    } else if (out.kind === 'stuck') {
      st.stuck++;
      grade = out.stringy ? (P.fork && !out.forkAligned ? 'The fork holds' : 'Stringy fibres hold') : 'Stuck';
      labels.push(`${Math.round(out.ratio * 100)}% of the energy needed`);
      if (out.knotHit) labels.push('Knot in the way');
      if (P.fork && !out.forkAligned) labels.push('Turn the blade along the branch');
      if (P.boss) labels.push(`${P.boss.name}: ${Math.round(100 * this.bossHp(this.logs.log))}% left`);
      xp = 3;
      this.combo = 0;
    } else if (out.kind === 'glance') {
      st.glances++;
      grade = 'Glancing blow';
      labels.push(out.iceShell ? 'The ice glaze deflected it' : cond.icy > 0.3 ? 'Icy bark' : (cond.wet > 0.3 || P.soaked) ? 'Wet bark' : 'Too close to the edge');
      points = -20;
      this.combo = 0;
    } else if (out.kind === 'nail') {
      st.nails++;
      const rock = out.hazard === 'rock';
      grade = rock ? 'Hit a stone!' : 'Hidden nail!';
      labels.push(`Edge ${rock ? 'rolled' : 'chipped'} −${Math.round(out.sharpLoss * 100)}% sharpness`);
      points = rock ? -60 : -40;
      this.combo = 0;
    } else if (out.kind === 'miss') {
      st.misses++;
      grade = 'Missed the log';
      points = -30;
      this.combo = 0;
    }
    this.p.score = Math.max(0, this.p.score + points);
    this.p.cash += cash;
    this.p.bestCombo = Math.max(this.p.bestCombo, this.combo);
    this.lastHit = {
      result: out.kind === 'nail' && out.hazard === 'rock' ? 'rock' : out.kind, grade, points, xp, cash, labels,
      accuracy: Math.round((1 - clamp(off, 0, 1)) * 100) / 100,
      offsetCm: Math.round(off * P.R * 1000) / 10,
      power: Math.round((pend.power ?? 0) * 100) / 100, timing: pend.timing ?? 'test',
      headSpeed: Math.round((out.vHead ?? 0) * 10) / 10,
      energy: Math.round(out.Esplit ?? out.Ein ?? 0), required: Math.round(out.Ereq ?? 0),
      ratio: Math.round((out.ratio ?? 0) * 100) / 100,
      depthCm: out.depth ? Math.round(out.depth * 1000) / 10 : null,
      pieces: out.pieces ?? 0, alongGrain: !!out.alongCheck, knot: out.knotHit ? 'hit' : out.knotDodged ? 'dodged' : 'none',
      species: sp.name, combo: this.combo, time: Date.now(),
      traits: [...(P.traits ?? [])], boss: P.boss?.name ?? null, hits: hitsBefore + 1,
      forkAligned: out.forked ? !!out.forkAligned : null,
    };
    this.mode?.onHit(this.lastHit);
    this.addXp(xp);
    this.emit('hit', this.lastHit);
    this.emit('change');
  }

  addXp(xp) {
    if (xp <= 0) return;
    this.p.xp += xp;
    while (this.p.xp >= this.xpNext) {
      this.p.xp -= this.xpNext;
      this.p.level++;
      this.p.skillPoints++;
      const bonus = 40 * this.p.level;
      this.p.cash += bonus;
      const newSp = SPECIES.filter((s) => s.unlock === this.p.level);
      this.audio.levelUp();
      this.toast(`Level ${this.p.level}! +1 skill point, +$${bonus}`, 'level', true);
      for (const s of newSp) this.toast(`New wood unlocked: ${s.name}`, 'level');
      this.emit('levelUp', this.p.level);
    }
  }

  // ------------------------------------------------------------------ shop

  buyAxe(id) {
    const a = AXES_BY_ID[id];
    if (!a) return false;
    if (this.p.owned.includes(id)) return this.equipAxe(id);
    if (this.p.cash < a.price) { this.toast('Not enough cash', 'warn'); return false; }
    this.p.cash -= a.price;
    this.p.owned.push(id);
    this.p.sharp[id] = a.sharp;
    this.toast(`Bought: ${a.name}`, 'good');
    return this.equipAxe(id);
  }

  equipAxe(id) {
    if (!this.p.owned.includes(id) || this.swing.busy) return false;
    this.p.axe = id;
    if (this.p.sharp[id] === undefined) this.p.sharp[id] = AXES_BY_ID[id].sharp;
    this.swing.setAxe(this.axeStats);
    this.needed = null;
    this.save();
    this.emit('change');
    return true;
  }

  sharpen() {
    if (this.sharpness >= this.maxSharp - 0.005) { this.toast('Already razor sharp', 'info'); return false; }
    if (this.p.cash < SHARPEN_PRICE) { this.toast('Not enough cash', 'warn'); return false; }
    this.p.cash -= SHARPEN_PRICE;
    this.sharpness = this.maxSharp;
    this.audio.sharpen();
    this.toast('Edge sharpened', 'good');
    this.save();
    this.emit('change');
    return true;
  }

  buyHone() {
    const tier = HONE_TIERS[this.p.hone];
    if (!tier) return false;
    if (this.p.cash < tier.price) { this.toast('Not enough cash', 'warn'); return false; }
    this.p.cash -= tier.price;
    this.p.hone++;
    this.sharpness = this.maxSharp;
    this.toast(`Honing level ${this.p.hone}: max sharpness ${Math.round(this.maxSharp * 100)}%`, 'good');
    this.save();
    this.emit('change');
    return true;
  }

  buyGloves() {
    if (this.p.gloves) return false;
    if (this.p.cash < GLOVES_PRICE) { this.toast('Not enough cash', 'warn'); return false; }
    this.p.cash -= GLOVES_PRICE;
    this.p.gloves = true;
    this.toast('Grippy work gloves: −75% handle slip in the wet', 'good');
    this.save();
    this.emit('change');
    return true;
  }

  spendSkill(id) {
    if (this.p.skillPoints <= 0 || !SKILLS[id] || this.p.skills[id] >= SKILLS[id].max) return false;
    this.p.skillPoints--;
    this.p.skills[id]++;
    this.swing.strength = this.strengthMult;
    this.needed = null;
    this.save();
    this.emit('change');
    return true;
  }

  // ------------------------------------------------------------------ per-frame

  // Power needed to split the current log through the aimed line (shown on the meter).
  estimateNeeded() {
    const log = this.logs.log;
    if (!log) return null;
    const P = log.params;
    const cond = this.weather.conditions;
    const t = { x: Math.sin(this.aim.yaw), z: Math.cos(this.aim.yaw) };
    const lt = this.logs.toLocalDir(new THREE.Vector3(t.x, 0, t.z));
    const lp = this.logs.toLocal(new THREE.Vector3(log.pos.x + this.aim.dx, 0, log.pos.z + this.aim.dz));
    const e = (-lt.z * lp.x + lt.x * lp.z) / P.R;
    const lc = logConditions(cond, P, !!log.iceShell);
    const pf = planeFactors(P, lt, e);
    const chord = 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - e * e));
    const req = Math.max(0.25 * P.req, P.req * pf.knot * pf.fork * (1 + 0.18 * lc.wet) * (1 - 0.3 * lc.frozen) * chord * pf.check - log.damage * 0.6);
    const knot = pf.knot, check = pf.check;
    const a = this.axeStats;
    const eff = a.wedge * (0.72 + 0.28 * this.sharpness);
    const need = req / eff;
    const at = (p) => this.swing.predict(p).Eeff;
    const full = at(1);
    let power;
    if (full < need) power = 1 + (need - full) / full;
    else {
      let lo = 0, hi = 1;
      for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (at(m) < need) lo = m; else hi = m; }
      power = hi;
    }
    return { power, req, Efull: full * eff, knot: knot > 1, check: check < 1, fork: P.fork ? (pf.forkAligned ? 'aligned' : 'across') : null };
  }

  // Boss toughness bar: fraction of the pith-line energy still to be put into the crack.
  bossHp(log = this.logs.log) {
    if (!log) return 0;
    return clamp(1 - log.damage / (0.75 * log.params.req), 0, 1);
  }

  update(dt) {
    const cond = this.weather.conditions;
    if (this.mode?.update(dt) && !this.swing.busy) {
      this.toast("Time's up!", 'warn', true);
      this.endMode('time');
    }
    // Stamina regenerates after a short rest.
    this.restT += dt;
    if (this.restT > 0.8 && !this.swing.busy) {
      this.stamina = Math.min(this.maxStamina, this.stamina + this.regenRate * cond.staminaRegen * dt);
    }
    // Meter oscillates 0 → 1 → 0.
    if (this.meter.active) {
      this.meter.t += dt;
      this.meter.value = this.meterValueNow();
    }
    // Aim sway (visible on the reticle while charging): fatigue, wind gusts, footing.
    const fr = this.stamina / this.maxStamina;
    const A = this.meter.active ? 0.003 + 0.016 * (1 - fr) ** 2 + 0.0012 * cond.wind.speed * (0.5 + cond.wind.gust) + 0.012 * (cond.footing - 1) : 0;
    const t = performance.now() / 1000;
    this.sway.x = A * (Math.sin(1.7 * t) + 0.5 * Math.sin(3.1 * t + 1)) / 1.5;
    this.sway.z = A * (Math.cos(1.3 * t) + 0.5 * Math.sin(2.7 * t + 2)) / 1.5;
    // Queue rounds slide into their new slots.
    for (const it of this.queue) {
      if (it.target) it.mesh.position.lerp(it.target, 1 - Math.exp(-6 * dt));
    }
    if (!this.needed && this.logs.log) this.needed = this.estimateNeeded();
    // Collect settled split pieces into the woodpile.
    this.logs.collectSettled();
    this.updatePendingNext(dt);
    this.saveT += dt;
    if (this.saveT > 5) { this.saveT = 0; this.save(); }
    this.fx.shake = Math.max(0, this.fx.shake - dt * 2.5);
  }

  state() {
    const log = this.logs.log;
    return {
      score: this.p.score, combo: this.combo, xp: this.p.xp, xpNext: this.xpNext, level: this.p.level,
      stamina: Math.round(this.stamina * 10) / 10, maxStamina: this.maxStamina,
      logType: log ? log.params.species.name : (this.queue[0]?.params.species.name ?? null),
      lastHit: this.lastHit,
      cash: this.p.cash, axe: this.axeStats.name, sharpness: Math.round(this.sharpness * 100) / 100,
      skillPoints: this.p.skillPoints, skills: { ...this.p.skills }, bestCombo: this.p.bestCombo,
      weather: this.weather.presetId, hour: Math.round(this.weather.hour * 100) / 100,
      swingState: this.swing.state, meter: this.meter.active ? Math.round(this.meter.value * 100) / 100 : null,
      log: log ? {
        species: log.params.species.name, diameterCm: Math.round(log.params.R * 200), heightCm: Math.round(log.params.H * 100),
        knots: log.params.knots.length, nail: !!log.params.nail, checks: log.params.checks.length, hits: log.hits,
        requiredJ: Math.round(log.params.req), damageJ: Math.round(log.damage), ready: log.ready,
        traits: [...(log.params.traits ?? [])], boss: log.params.boss?.name ?? null,
        bossHp: log.params.boss ? Math.round(this.bossHp(log) * 100) / 100 : null, iceShell: !!log.iceShell,
      } : null,
      queue: this.queue.map((q) => q.params.species.name),
      queueTraits: this.queue.map((q) => q.params.traits ?? []),
      stats: { ...this.p.stats }, woodpile: this.p.woodpile,
      mode: this.mode ? this.mode.status() : { type: 'free', name: 'Free play' },
      records: JSON.parse(JSON.stringify(this.p.records)),
    };
  }
}

