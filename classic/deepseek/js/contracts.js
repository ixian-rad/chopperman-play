/**
 * Deterministic challenge contracts that reuse the existing run modes.
 *
 * A contract never re-implements the swing loop. It seeds a fixed deck and then
 * grades the strikes the game already resolves:
 *   sprint     -> Time Attack, but 90 seconds and a seeded deck
 *   route      -> Daily Seed, but a six-log route with a saved medal
 *   precision6 -> Precision, but six marked targets and a 55/30/15 grade
 *
 * Pure logic only (no DOM / Three.js), so it can be checked in Node.
 */

export const CONTRACT_STORAGE_KEY = 'americanSplit.contracts.v1';

export const SPRINT_DECK = Object.freeze([
  'pine',
  'birch',
  'spruce',
  'oak',
  'rottenElm',
  'knottyOak',
  'forkedElm',
  'hickory',
  'ironwood',
]);

export const ROUTE_DECK = Object.freeze([
  'pine',
  'spruce',
  'rottenElm',
  'forkedElm',
  'ironwood',
  'hickory',
]);

export const PRECISION_DECK = Object.freeze([
  'spruce',
  'oak',
  'knottyOak',
  'forkedElm',
  'hickory',
  'birch',
]);

// Hand-placed end-grain targets. Each asks for a different contact point and a
// different power, so the six logs read as six distinct shots.
export const PRECISION_TARGETS = Object.freeze([
  Object.freeze({ x: 0.045, z: -0.04, power: 65, name: 'Low-left sapwood' }),
  Object.freeze({ x: -0.065, z: 0.045, power: 80, name: 'High-right heart' }),
  Object.freeze({ x: 0.005, z: 0.09, power: 95, name: 'North knot shoulder' }),
  Object.freeze({ x: 0.075, z: 0.06, power: 70, name: 'Fork seam' }),
  Object.freeze({ x: -0.055, z: 0.065, power: 90, name: 'Tight check' }),
  Object.freeze({ x: -0.095, z: 0.015, power: 105, name: 'Bark-side rive' }),
]);

export const CONTRACTS = Object.freeze([
  Object.freeze({
    id: 'sprint',
    mode: 'time',
    name: 'Sprint Contract',
    short: 'SPRINT',
    icon: '90s',
    time: 90,
    target: 0,
    deck: SPRINT_DECK,
    desc: '90 seconds, a seeded nine-log deck. Clean splits buy +2.5 s. Medals reward clears and accuracy.',
  }),
  Object.freeze({
    id: 'route',
    mode: 'daily',
    name: 'Daily Route',
    short: 'ROUTE',
    icon: '6',
    time: 0,
    target: 6,
    deck: ROUTE_DECK,
    daily: true,
    desc: 'The UTC date picks six logs: pine, spruce, hollow elm, forked elm, ironwood, hickory. Same route for everyone.',
  }),
  Object.freeze({
    id: 'precision6',
    mode: 'precision',
    name: 'Precision Six',
    short: 'P-SIX',
    icon: '6',
    time: 0,
    target: 6,
    deck: PRECISION_DECK,
    precision: true,
    ammo: 12,
    desc: 'Six marked targets, twelve strikes. Contact 55%, grain 30%, power 15%. Bullseyes chain for bonus points.',
  }),
]);

export function contractFor(id) {
  return CONTRACTS.find((item) => item.id === id) || CONTRACTS[0];
}

export function dayStamp(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

export function dailySeed(date = new Date()) {
  return hashText(dayStamp(date));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * One completed target attempt. Aim is 55% of the score, grain 30%, power 15%,
 * matching Codex's Precision Six grading. The bullseye is deliberately tight.
 */
export function precisionGrade(result = {}, target = null) {
  if (!target) return null;
  const finite =
    result.contact !== false &&
    Number.isFinite(result.aimX) &&
    Number.isFinite(result.aimZ) &&
    Number.isFinite(result.power);
  const distance = finite ? Math.hypot(result.aimX - target.x, result.aimZ - target.z) : Infinity;
  // Outside twice the 9 cm grade radius the bit is in the wrong part of the
  // round entirely, so grain and power cannot rescue the shot.
  const contact = finite && distance <= 0.18;
  const aim = contact ? clamp(1 - distance / 0.09, 0, 1) : 0;
  const grain = contact ? clamp(((result.grain ?? 0) - 0.18) / 0.82, 0, 1) : 0;
  const power = contact
    ? clamp(1 - Math.abs(result.power * 100 - target.power) / 50, 0, 1)
    : 0;
  const quality = contact ? Math.round(100 * (aim * 0.55 + grain * 0.3 + power * 0.15)) : 0;
  return {
    quality,
    aim: Number(aim.toFixed(3)),
    grain: Number(grain.toFixed(3)),
    power: Number(power.toFixed(3)),
    distance: Number.isFinite(distance) ? Number(distance.toFixed(4)) : null,
    bullseye:
      contact &&
      distance <= 0.025 &&
      grain >= 0.956 &&
      Math.abs(result.power * 100 - target.power) <= 15,
    target: { ...target },
  };
}

export function contractMedal(result) {
  if (!result || !result.clears) return 'practice';
  const accuracy = 1 - (result.misses || 0) / Math.max(1, result.swings || 1);
  if (result.kind === 'precision6') {
    if (result.clears < 6) return 'practice';
    if (result.points >= 690 && (result.bullseyes || 0) >= 4 && (result.misses || 0) === 0) return 'gold';
    if (result.points >= 480) return 'silver';
    return 'bronze';
  }
  if (result.kind === 'route') {
    if (result.clears < 6) return 'practice';
    if (result.elapsed <= 90 && (result.misses || 0) === 0 && (result.cleanSplits || 0) >= 3) return 'gold';
    if (result.elapsed <= 150 && accuracy >= 0.8) return 'silver';
    return 'bronze';
  }
  if (result.clears >= 6 && accuracy >= 0.9) return 'gold';
  if (result.clears >= 4 && accuracy >= 0.8) return 'silver';
  return 'bronze';
}

function compareResults(candidate, previous) {
  if (!previous) return true;
  if (candidate.score !== previous.score) return candidate.score > previous.score;
  return (candidate.elapsed ?? Infinity) < (previous.elapsed ?? Infinity);
}

export class ContractRun {
  constructor(kind = 'sprint', { storage = null, seedDate = '' } = {}) {
    this.def = contractFor(kind);
    this.kind = this.def.id;
    this.storage = storage;
    this.date = this.def.id === 'route' ? seedDate || dayStamp() : '';
    this.seed = hashText(`${this.kind}:${this.def.id === 'route' ? this.date : dayStamp()}`);
    this.started = false;
    this.finished = false;
    this.elapsed = 0;
    this.swings = 0;
    this.misses = 0;
    this.clears = 0;
    this.cleanSplits = 0;
    this.bullseyes = 0;
    this.points = 0;
    this.combo = 0;
    this.pendingQuality = 0;
    this.pendingAttempts = 0;
    this.lastGrade = null;
    this.result = null;
    this.history = [];
    this.best = 0;
    this.bestRecord = null;
    this._load();
  }

  get mode() {
    return this.def.mode;
  }

  get remaining() {
    return this.def.id === 'sprint' ? Math.max(0, this.def.time - this.elapsed) : null;
  }

  get deck() {
    return [...this.def.deck];
  }

  get target() {
    return this.def.precision ? PRECISION_TARGETS[clamp(this.clears, 0, PRECISION_TARGETS.length - 1)] : null;
  }

  targetFor(index) {
    if (!this.def.precision) return null;
    return PRECISION_TARGETS[clamp(Math.round(index), 0, PRECISION_TARGETS.length - 1)];
  }

  get attemptsLeft() {
    return this.def.ammo ? Math.max(0, this.def.ammo - this.swings) : null;
  }

  get key() {
    return this.def.id === 'route' ? `route:${this.date}` : this.def.id;
  }

  _load() {
    if (!this.storage) return;
    try {
      const raw = JSON.parse(this.storage.getItem(CONTRACT_STORAGE_KEY) || '{}');
      if (!raw || typeof raw !== 'object') return;
      const record = raw[this.key];
      if (record && typeof record === 'object' && Number.isFinite(record.score)) {
        this.best = record.score;
        this.bestRecord = record;
      }
      this.history = Array.isArray(raw._history) ? raw._history.slice(0, 5) : [];
    } catch {
      // Storage is optional; a blocked localStorage never blocks a contract.
    }
  }

  _save() {
    if (!this.storage) return;
    try {
      const raw = JSON.parse(this.storage.getItem(CONTRACT_STORAGE_KEY) || '{}');
      const records = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      records[this.key] = this.bestRecord || this.best;
      records._history = this.history;
      this.storage.setItem(CONTRACT_STORAGE_KEY, JSON.stringify(records));
    } catch {
      // Results remain on screen for this session.
    }
  }

  begin() {
    if (this.finished) return false;
    this.started = true;
    return true;
  }

  tick(dt) {
    if (!this.started || this.finished) return;
    this.elapsed += Math.max(0, Number(dt) || 0);
    if (this.def.id === 'sprint') this.elapsed = Math.min(this.def.time, this.elapsed);
  }

  /** Count one resolved swing and grade it when the kind asks for a grade. */
  recordStrike(hit = {}) {
    if (this.finished) return {};
    this.swings += 1;
    const contact = !hit.glancing && !hit.hazardHit;
    if (!contact) this.misses += 1;
    if (hit.clean) this.cleanSplits += 1;
    // A split is a clear even when it was rough: the next log is on the block,
    // so a contract must advance the round or a heavy multi-bite log stalls it.
    if (!hit.partial) this.clears += 1;

    if (!this.def.precision) {
      return { contact, swings: this.swings, attemptsLeft: this.attemptsLeft };
    }

    const target = this.targetFor(hit.logIndex ?? this.clears);
    const grade = precisionGrade(
      {
        aimX: hit.aimX,
        aimZ: hit.aimZ,
        grain: hit.grain,
        power: hit.power,
        contact,
      },
      target,
    );
    this.pendingQuality += grade.quality;
    this.pendingAttempts += 1;

    let points = 0;
    if (!hit.partial) {
      const firstStrike = this.pendingAttempts === 1;
      this.combo = firstStrike && grade.bullseye ? this.combo + 1 : 0;
      if (firstStrike && grade.bullseye) this.bullseyes += 1;
      points = Math.round(this.pendingQuality / Math.max(1, this.pendingAttempts));
      if (firstStrike) points += 25;
      points += Math.min(3, this.combo) * 10;
      this.points += points;
      this.lastGrade = { ...grade, points };
      this.pendingQuality = 0;
      this.pendingAttempts = 0;
    }
    // The contract ends on either six cleared logs or twelve spent strikes.
    this._finishPrecisionIfDone();
    return {
      contact,
      grade: this.lastGrade && !hit.partial ? { ...this.lastGrade } : { ...grade },
      points,
      attemptsLeft: this.attemptsLeft,
      finished: this.finished,
    };
  }

  _finishPrecisionIfDone() {
    if (this.finished) return;
    if ((this.def.ammo && this.swings >= this.def.ammo) || this.clears >= this.def.target) {
      // main.js passes the current run score at finish; keep a provisional one.
      this.finished = true;
    }
  }

  finish(score = 0, { elapsed = this.elapsed } = {}) {
    if (this.result) return this.result;
    this.finished = true;
    const cleanScore = Math.max(0, Math.round(Number(score) || 0));
    const result = {
      kind: this.kind,
      mode: this.mode,
      name: this.def.name,
      date: this.date,
      score: cleanScore,
      points: Math.round(this.points),
      elapsed: Number(Math.max(0, Number(elapsed) || 0).toFixed(1)),
      clears: this.clears,
      swings: this.swings,
      misses: this.misses,
      cleanSplits: this.cleanSplits,
      bullseyes: this.bullseyes,
      attemptsLeft: this.attemptsLeft,
      best: this.best,
    };
    result.medal = contractMedal(result);
    result.newBest = compareResults(result, this.bestRecord);
    this.result = result;
    if (result.newBest) {
      this.bestRecord = { ...result };
      this.best = result.score;
    }
    result.best = this.best;
    this.history = [{ ...result }, ...this.history].slice(0, 5);
    this._save();
    return result;
  }

  snapshot() {
    return {
      kind: this.kind,
      name: this.def.name,
      mode: this.mode,
      date: this.date,
      seed: this.seed,
      started: this.started,
      finished: this.finished,
      elapsed: Number(this.elapsed.toFixed(1)),
      remaining: this.remaining,
      clears: this.clears,
      target: this.def.target,
      swings: this.swings,
      misses: this.misses,
      cleanSplits: this.cleanSplits,
      bullseyes: this.bullseyes,
      points: Math.round(this.points),
      attemptsLeft: this.attemptsLeft,
      combo: this.combo,
      targetRing: this.targetFor(this.clears),
      lastGrade: this.lastGrade ? { ...this.lastGrade } : null,
      best: this.best,
      bestRecord: this.bestRecord ? { ...this.bestRecord } : null,
      result: this.result ? { ...this.result } : null,
      history: this.history.map((item) => ({ ...item })),
    };
  }
}

/** Medals share a colour language in the DOM. */
export function medalLabel(medal) {
  return medal ? medal.charAt(0).toUpperCase() + medal.slice(1) : 'Practice';
}
