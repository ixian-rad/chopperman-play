import { clamp, mulberry32, scoreCut } from './mechanics.js';
import {
  CAMPAIGN_LENGTH,
  campaignMeta,
  campaignRound,
  campaignUnlockedChapter,
} from './campaign.js';

/**
 * Game rules, progression and persistence for American Split.
 *
 * This module is deliberately DOM-free: main.js owns the presentation and the
 * physics/visual outcome, then hands a split report to GameState.registerSplit().
 */

export const SAVE_KEY = 'americanSplit.save.v3';

export const LOG_TYPES = Object.freeze([
  Object.freeze({
    id: 'pine',
    name: 'White Pine',
    short: 'PINE',
    blurb: 'Soft, straight grain. A forgiving first round.',
    tier: 1,
    difficulty: 1,
    toughness: 0.55,
    density: 430,
    radius: 0.174,
    height: 0.46,
    strikes: 1,
    knots: 0,
    unlockLevel: 1,
    basePoints: 70,
    barkColor: 0x9b7d58,
    barkTint: 0xb79c74,
    cutColor: 0xe4c18a,
    cutTint: 0xecc994,
    ringColor: 0x986534,
    seed: 211,
  }),
  Object.freeze({
    id: 'birch',
    name: 'Paper Birch',
    short: 'BIRCH',
    blurb: 'Pale, tight bark. Clean checks reward a centred strike.',
    tier: 1,
    difficulty: 1.4,
    toughness: 0.64,
    density: 480,
    radius: 0.178,
    height: 0.47,
    strikes: 1,
    knots: 0,
    unlockLevel: 1,
    basePoints: 90,
    barkColor: 0xcac2ac,
    barkTint: 0xd8d2c2,
    cutColor: 0xe7c98f,
    cutTint: 0xefd39b,
    ringColor: 0x9b7346,
    seed: 223,
  }),
  Object.freeze({
    id: 'spruce',
    name: 'Red Spruce',
    short: 'SPRUCE',
    blurb: 'A sticky, springy round with one hidden knot.',
    tier: 2,
    difficulty: 1.8,
    toughness: 0.74,
    density: 505,
    radius: 0.181,
    height: 0.48,
    strikes: 2,
    knots: 1,
    unlockLevel: 2,
    basePoints: 115,
    barkColor: 0x8a5e43,
    barkTint: 0xa87453,
    cutColor: 0xdcb57e,
    cutTint: 0xe4c08c,
    ringColor: 0x8d5b30,
    seed: 237,
  }),
  Object.freeze({
    id: 'rottenElm',
    name: 'Hollow Elm',
    short: 'HOLLOW ELM',
    blurb: 'Punky, rotten heartwood. It gives way fast, but pays little and bursts into splinters.',
    tier: 2,
    difficulty: 2.1,
    toughness: 0.5,
    density: 390,
    radius: 0.198,
    height: 0.51,
    strikes: 2,
    knots: 0,
    hollow: true,
    unlockLevel: 3,
    basePoints: 120,
    barkColor: 0x77685a,
    barkTint: 0x93836e,
    cutColor: 0xbfa278,
    cutTint: 0xcbb087,
    ringColor: 0x6f5232,
    seed: 307,
  }),
  Object.freeze({
    id: 'oak',
    name: 'White Oak',
    short: 'OAK',
    blurb: 'Dense and cross-grained. You will need real momentum.',
    tier: 3,
    difficulty: 2.4,
    toughness: 0.88,
    density: 690,
    radius: 0.185,
    height: 0.49,
    strikes: 2,
    knots: 1,
    unlockLevel: 3,
    basePoints: 155,
    barkColor: 0x7b6a55,
    barkTint: 0x9b8a71,
    cutColor: 0xd4ad72,
    cutTint: 0xddb97f,
    ringColor: 0x846032,
    seed: 251,
  }),
  Object.freeze({
    id: 'knottyOak',
    name: 'Knotty Oak',
    short: 'KNOT OAK',
    blurb: 'Two hard knots. Hit between them or the bit will deflect.',
    tier: 3,
    difficulty: 2.9,
    toughness: 0.96,
    density: 720,
    radius: 0.189,
    height: 0.49,
    strikes: 2,
    knots: 2,
    unlockLevel: 4,
    basePoints: 185,
    barkColor: 0x72614d,
    barkTint: 0x928069,
    cutColor: 0xd0a568,
    cutTint: 0xdbb376,
    ringColor: 0x7d592e,
    seed: 263,
  }),
  Object.freeze({
    id: 'forkedElm',
    name: 'Forked Red Elm',
    short: 'FORKED ELM',
    blurb: 'A trunk that forked low and healed into twin piths. Read either heart, or the seam between them.',
    tier: 4,
    difficulty: 3.1,
    toughness: 1.01,
    density: 760,
    radius: 0.196,
    height: 0.5,
    strikes: 3,
    knots: 1,
    twinPith: true,
    pithSpread: 0.34,
    pithAngle: 0.38,
    unlockLevel: 5,
    basePoints: 205,
    barkColor: 0x6f5f4a,
    barkTint: 0x8d7b61,
    cutColor: 0xd7b177,
    cutTint: 0xe0c08a,
    ringColor: 0x856139,
    seed: 271,
  }),
  Object.freeze({
    id: 'hickory',
    name: 'Shagbark Hickory',
    short: 'HICKORY',
    blurb: 'The honest test. Dense, stringy, and famously tough.',
    tier: 4,
    difficulty: 3.4,
    toughness: 1.08,
    density: 810,
    radius: 0.19,
    height: 0.5,
    strikes: 3,
    knots: 1,
    unlockLevel: 6,
    basePoints: 225,
    barkColor: 0x8e7d63,
    barkTint: 0xac9b80,
    cutColor: 0xd9b67c,
    cutTint: 0xe2c48e,
    ringColor: 0x8c663a,
    seed: 277,
  }),
  Object.freeze({
    id: 'knottyHickory',
    name: 'Knotty Hickory',
    short: 'KNOT HICKORY',
    blurb: 'Old-growth heartwood and two knots. Precise or nothing.',
    tier: 4,
    difficulty: 3.9,
    toughness: 1.18,
    density: 850,
    radius: 0.194,
    height: 0.5,
    strikes: 3,
    knots: 2,
    unlockLevel: 8,
    basePoints: 275,
    barkColor: 0x847156,
    barkTint: 0xa38f72,
    cutColor: 0xd3ad73,
    cutTint: 0xddba86,
    ringColor: 0x855f34,
    seed: 293,
  }),
  Object.freeze({
    id: 'ringShakeWalnut',
    name: 'Ring-Shaken Walnut',
    short: 'RING WALNUT',
    blurb:
      'A loose growth ring has separated from the heart. The bound core fights the bit; chase the pale loose-ring arc as it shifts, then split the freed heart.',
    tier: 5,
    difficulty: 4.1,
    toughness: 1.24,
    density: 900,
    radius: 0.199,
    height: 0.52,
    strikes: 3,
    knots: 1,
    hazards: 1,
    ringShake: true,
    ringShakeRadius: 0.63,
    unlockLevel: 9,
    basePoints: 330,
    barkColor: 0x5a4a38,
    barkTint: 0x7a6750,
    cutColor: 0xd6b07a,
    cutTint: 0xe0c08a,
    ringColor: 0x7a5432,
    seed: 347,
  }),
  Object.freeze({
    id: 'ironwood',
    name: 'Ironwood',
    short: 'IRONWOOD',
    blurb: 'Sinks in water, rings like a bell, and hides stone and old nails. Four solid bites.',
    tier: 5,
    difficulty: 4.6,
    toughness: 1.55,
    density: 1180,
    radius: 0.201,
    height: 0.53,
    strikes: 4,
    knots: 2,
    hazards: 2,
    unlockLevel: 10,
    basePoints: 390,
    barkColor: 0x4b4438,
    barkTint: 0x6c6250,
    cutColor: 0xc7a166,
    cutTint: 0xd2ae75,
    ringColor: 0x65411f,
    seed: 331,
  }),
  Object.freeze({
    id: 'twistedColossus',
    name: 'Twisted Colossus',
    short: 'COLOSSUS',
    blurb:
      'A butt-cut hackberry with interlocked, spiralling grain. The checks wander, the heart is sealed, and five solid bites are only the start. Set a wedge in the kerf and let iron do the rest.',
    tier: 5,
    difficulty: 5,
    toughness: 1.42,
    density: 1020,
    radius: 0.252,
    height: 0.6,
    strikes: 5,
    knots: 2,
    hazards: 1,
    twisted: true,
    huge: true,
    unlockLevel: 10,
    basePoints: 520,
    barkColor: 0x493f33,
    barkTint: 0x6b5c48,
    cutColor: 0xd8b782,
    cutTint: 0xe3c692,
    ringColor: 0x59391b,
    seed: 419,
  }),
  Object.freeze({
    id: 'ironStump',
    name: 'Ancient Iron Stump',
    short: 'IRON STUMP',
    blurb:
      'A fluted, root-bound stump with a rotten heart, iron-hard grain, and old stone in the rings. Five bites, and the hollow core is the only honest shortcut.',
    tier: 6,
    difficulty: 5.6,
    toughness: 1.68,
    density: 1240,
    radius: 0.244,
    height: 0.58,
    strikes: 5,
    knots: 2,
    hazards: 2,
    hollow: true,
    hollowRadius: 0.27,
    hollowOffset: 0.36,
    huge: true,
    stump: true,
    unlockLevel: 12,
    basePoints: 640,
    barkColor: 0x3f382d,
    barkTint: 0x5e5343,
    cutColor: 0xc9a36a,
    cutTint: 0xd7b77f,
    ringColor: 0x5a3a1c,
    seed: 457,
  }),
]);

/** A boss round arrives after every N clean splits. Endless runs press the pace. */
export const BOSS_EVERY = 5;
export const ENDLESS_BOSS_EVERY = 3;
export const CAMPAIGN_SPLITS = 60;

export const CHAPTERS = Object.freeze([
  Object.freeze({ index: 1, id: 'woodpile', name: 'The Woodpile', from: 0, blurb: 'Learn the checks and build a rhythm.' }),
  Object.freeze({ index: 2, id: 'oldgrowth', name: 'Old Growth', from: 8, blurb: 'Knots, tough grain, and the first real bosses.' }),
  Object.freeze({ index: 3, id: 'ironfrost', name: 'Iron & Frost', from: 20, blurb: 'Hazards, hollow rounds, and iron-hard heartwood.' }),
  Object.freeze({ index: 4, id: 'heartwood', name: 'Heartwood', from: 40, blurb: 'Everything the yard can throw at an axe.' }),
  Object.freeze({ index: 5, id: 'lastring', name: 'The Last Ring', from: CAMPAIGN_SPLITS, blurb: 'The stump at the back of the yard. One last round for the whole campaign.' }),
]);

/**
 * Challenge runs reuse the normal split loop; they only change pacing, scoring,
 * and what ends the run. Free Chop keeps the long campaign going.
 */
// Fixed decks keep Daily and Precision comparable between profiles. The base
// ladder position and permanent bench are deliberately ignored in these runs.
const DAILY_DECK = Object.freeze([
  'pine',
  'birch',
  'spruce',
  'oak',
  'rottenElm',
  'knottyOak',
  'forkedElm',
  'hickory',
]);

const PRECISION_DECK = Object.freeze([
  'spruce',
  'oak',
  'knottyOak',
  'forkedElm',
  'hickory',
  'rottenElm',
  'oak',
  'knottyHickory',
  'ironwood',
  'forkedElm',
  'knottyHickory',
  'birch',
]);

export const RUN_MODES = Object.freeze([
  Object.freeze({
    id: 'free',
    name: 'Free Chop',
    short: 'FREE',
    desc: 'The long campaign. Chapters, bosses, and permanent progression.',
    time: 0,
    target: 0,
    scoreScale: 1,
  }),
  Object.freeze({
    id: 'campaign',
    name: 'Campaign',
    short: 'STORY',
    desc: 'Six chapters, 18 logs: two ordinary rounds and one boss each. The Iron Crown closes the yard.',
    time: 0,
    target: CAMPAIGN_LENGTH,
    scoreScale: 1.08,
    campaign: true,
  }),
  Object.freeze({
    id: 'time',
    name: 'Time Attack',
    short: 'TIME',
    desc: '75 seconds. Every clean split adds 2.5 seconds. Chase the clock.',
    time: 75,
    target: 0,
    scoreScale: 1.1,
  }),
  Object.freeze({
    id: 'precision',
    name: 'Precision',
    short: 'PRECISION',
    desc: '12 fixed rounds. Only pith-and-grain strikes bite; a loaner bench keeps scores comparable.',
    time: 0,
    target: 12,
    scoreScale: 1.35,
    precision: true,
    deck: PRECISION_DECK,
    loadout: Object.freeze({
      axeId: 'tempered',
      level: 10,
      upgrades: Object.freeze({ sharpness: 2, weight: 1, stamina: 2 }),
    }),
  }),
  Object.freeze({
    id: 'endless',
    name: 'Endless',
    short: 'ENDLESS',
    desc: 'Boss every 3 clean splits and the wood grows tougher. No finish line.',
    time: 0,
    target: 0,
    scoreScale: 1.2,
    endless: true,
  }),
  Object.freeze({
    id: 'daily',
    name: 'Daily Seed',
    short: 'DAILY',
    desc: '8 rounds with the same knots, weather, fixed deck, and loaner axe for everyone today.',
    time: 0,
    target: 8,
    scoreScale: 1.15,
    daily: true,
    deck: DAILY_DECK,
    loadout: Object.freeze({
      axeId: 'cruiser',
      level: 8,
      upgrades: Object.freeze({ sharpness: 2, weight: 1, stamina: 2 }),
    }),
  }),
  Object.freeze({
    id: 'trial',
    name: 'Colossus Trial',
    short: 'COLOSSUS',
    desc: 'Three interlocked Colossus rounds on a loaned maul. No level gate; set wedges and break the yard boss.',
    time: 0,
    target: 3,
    scoreScale: 1.25,
    trial: true,
    fixedLogId: 'twistedColossus',
    // A trial must be the same fight for a level-1 player and a veteran. The
    // loaner bench is applied by GameState's effective-stat getters; permanent
    // gear and upgrades are untouched.
    loadout: Object.freeze({
      axeId: 'maul',
      level: 12,
      upgrades: Object.freeze({ sharpness: 2, weight: 2, stamina: 3 }),
    }),
  }),
  Object.freeze({
    id: 'stump',
    name: 'Iron Stump Trial',
    short: 'STUMP',
    desc: 'Three rotten, rock-riddled Ancient Iron Stumps on a loaned maul. Read the hollow, set wedges, and break the oldest stump in the yard.',
    time: 0,
    target: 3,
    scoreScale: 1.35,
    trial: true,
    stumpTrial: true,
    fixedLogId: 'ironStump',
    loadout: Object.freeze({
      axeId: 'maul',
      level: 14,
      upgrades: Object.freeze({ sharpness: 3, weight: 2, stamina: 3 }),
    }),
  }),
]);

export function modeFor(id) {
  return RUN_MODES.find((mode) => mode.id === id) || RUN_MODES[0];
}

/** Stable UTC date string plus a numeric hash for the daily run. */
export function dayStamp(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function dailySeed(date = new Date()) {
  const stamp = dayStamp(date);
  let hash = 2166136261;
  for (let i = 0; i < stamp.length; i++) {
    hash ^= stamp.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Turn a shared `YYYY-MM-DD` seed back into a UTC date, or null if invalid. */
export function seedDate(stamp) {
  if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return null;
  const date = new Date(`${stamp}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || dayStamp(date) !== stamp ? null : date;
}

const BOSS_NAMES = Object.freeze([
  'The Knotty Patriarch',
  'Old Widowmaker',
  'The Ironheart Stump',
  'Grandmother Ironwood',
]);

export function chapterFor(cleanSplits = 0) {
  let chapter = CHAPTERS[0];
  for (const item of CHAPTERS) {
    if (cleanSplits >= item.from) chapter = item;
  }
  return chapter;
}

const BOSS_MECHANICS = Object.freeze([
  Object.freeze({
    id: 'heartwood',
    label: 'Exposed heartwood',
    hint: 'Strike the glowing heartwood band for +1 bite',
    inner: 0.54,
    outer: 0.92,
    arc: 2.45,
    bonus: 1,
  }),
  Object.freeze({
    id: 'sapseam',
    label: 'Sap seam',
    hint: 'A narrow sap seam hides between the rings',
    inner: 0.42,
    outer: 0.74,
    arc: 1.9,
    bonus: 1,
  }),
  Object.freeze({
    id: 'ringshake',
    label: 'Ring shake',
    hint: 'The split follows the old ring shake near the bark',
    inner: 0.66,
    outer: 0.97,
    arc: 2.8,
    bonus: 1,
  }),
]);

/** Scale the current species into a multi-strike boss round. */
export function makeBossProfile(species, bossIndex = 0) {
  const victory = Math.max(0, bossIndex);
  const factor = 1 + victory * 0.13;
  const mechanic = BOSS_MECHANICS[victory % BOSS_MECHANICS.length];
  // Later bosses have learned to guard their heart: the seam is sealed under a
  // shell of sound rings until the player opens it with a normal bite.
  const seamPhase = victory >= 1;
  return {
    ...species,
    id: species.id,
    name: BOSS_NAMES[victory % BOSS_NAMES.length],
    short: 'BOSS',
    blurb: `${species.blurb} This one has survived decades of bad axes. ${mechanic.hint}.${
      seamPhase ? ' Its seam is sealed until you open the rings.' : ''
    }`,
    boss: true,
    bossIndex: victory,
    bossMechanic: mechanic,
    bossSeamSealed: seamPhase,
    seamPhase,
    difficulty: 5,
    toughness: species.toughness * (1.04 + victory * 0.07),
    radius: species.radius * (1.07 + victory * 0.012),
    height: species.height * 1.08,
    strikes: Math.max(3, (species.strikes || 1) + 2 + (victory > 2 ? 1 : 0)),
    knots: Math.min(4, (species.knots || 0) + 1 + Math.floor(victory / 3)),
    hazards: Math.max(1, species.hazards || 0),
    basePoints: Math.round(species.basePoints * 2.35 * factor),
    unlockLevel: species.unlockLevel,
  };
}

/** Deterministic embedded nails/stones for a round. */
export function makeHazards(species, seedOffset = 0) {
  const count = species.hazards || 0;
  if (!count) return [];
  const random = mulberry32((species.seed || 1) * 29 + seedOffset * 53 + 17);
  const hazards = [];
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const radius = species.radius * (0.28 + random() * 0.52);
    hazards.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      angle,
      radius: 0.013 + random() * 0.008,
      type: random() < 0.62 ? 'nail' : 'stone',
      seed: Math.floor(random() * 1e6),
    });
  }
  return hazards;
}

export const AXES = Object.freeze([
  Object.freeze({
    id: 'felling',
    name: 'Yard Felling Axe',
    short: 'Felling',
    desc: 'The reliable starter. Balanced enough for softwood, honest work on oak.',
    sharpness: 1,
    weight: 1,
    stamina: 1,
    cost: 0,
    unlockLevel: 1,
    color: '#c9c6bb',
  }),
  Object.freeze({
    id: 'maul',
    name: 'Splitting Maul',
    short: 'Maul',
    desc: 'A heavy poll and a blunt wedge. Deeper penetration, thirstier work.',
    sharpness: 0.94,
    weight: 1.42,
    stamina: 1.28,
    cost: 340,
    unlockLevel: 2,
    color: '#9ba1a0',
  }),
  Object.freeze({
    id: 'cruiser',
    name: 'Hickory Cruiser',
    short: 'Cruiser',
    desc: 'A limbing axe rehung for splitting. Fast head speed, little fatigue.',
    sharpness: 1.2,
    weight: 0.84,
    stamina: 0.88,
    cost: 900,
    unlockLevel: 4,
    color: '#d6cfbd',
  }),
  Object.freeze({
    id: 'tempered',
    name: 'Tempered Master',
    short: 'Master',
    desc: 'Hand-forged, thin-bevel, and beautifully balanced. The last axe you need.',
    sharpness: 1.46,
    weight: 1.02,
    stamina: 0.94,
    cost: 2100,
    unlockLevel: 7,
    color: '#f0e7cc',
  }),
]);

export const UPGRADES = Object.freeze({
  sharpness: Object.freeze({
    id: 'sharpness',
    name: 'Sharpness',
    icon: 'edge',
    max: 5,
    baseCost: 120,
    growth: 1.55,
    desc: 'A keener bevel bites deeper and wastes less energy in the kerf.',
  }),
  weight: Object.freeze({
    id: 'weight',
    name: 'Head Weight',
    icon: 'weight',
    max: 5,
    baseCost: 105,
    growth: 1.5,
    desc: 'More momentum per swing. Splits harder, drains stamina faster.',
  }),
  stamina: Object.freeze({
    id: 'stamina',
    name: 'Conditioning',
    icon: 'lungs',
    max: 5,
    baseCost: 110,
    growth: 1.48,
    desc: 'A bigger wind and faster recovery between rounds.',
  }),
});

export const WEATHER_OPTIONS = Object.freeze(['clear', 'rain', 'snow', 'fog', 'wind']);
export const TIME_OPTIONS = Object.freeze(['dawn', 'noon', 'golden', 'night']);

export function xpToNext(level) {
  // Level 2 lands around the third clean split, level 3 around the seventh.
  return Math.round(560 + (level - 1) * 185 + Math.pow(level, 1.4) * 24);
}

export function upgradeCost(stat, currentLevel) {
  const def = UPGRADES[stat];
  if (!def) return Infinity;
  return Math.round(def.baseCost * Math.pow(def.growth, currentLevel));
}

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultState() {
  return {
    version: 5,
    score: 0,
    coins: 0,
    xp: 0,
    level: 1,
    combo: 0,
    bestCombo: 0,
    stamina: 100,
    axeId: 'felling',
    ownedAxes: ['felling'],
    upgrades: { sharpness: 0, weight: 0, stamina: 0 },
    logIndex: 0,
    splits: 0,
    attempts: 0,
    cleanSplits: 0,
    totalScore: 0,
    bossesDefeated: 0,
    edgeWear: 0,
    honed: 0,
    wedges: 0,
    wedgesPulled: 0,
    campaignComplete: false,
    // Highest chapter available from the Campaign chapter row. Persisted so a
    // later session can continue the story at the chapter it reached.
    campaignChapter: 1,
    records: { time: 0, precision: 0, endless: 0, daily: 0, trial: 0, stump: 0, campaign: 0, dailyDate: '' },
    history: { time: [], precision: [], endless: [], daily: [], trial: [], stump: [], campaign: [] },
    lastHit: null,
    settings: {
      quality: 'auto',
      autoQuality: true,
      timeOfDay: 'golden',
      weather: 'clear',
      autoTime: false,
      sound: true,
      music: true,
      musicVolume: 0.35,
      sfxVolume: 0.8,
    },
    createdAt: Date.now(),
  };
}

/** Fresh session-only run state. Kept in one place so new modes stay consistent. */
function makeRunState(overrides = {}) {
  return {
    mode: 'free',
    active: false,
    customSeed: false,
    score: 0,
    splits: 0,
    bosses: 0,
    timeLeft: 0,
    target: 0,
    startedAt: 0,
    endedAt: 0,
    dailySeed: 0,
    dailyDate: '',
    lastEndReason: '',
    // Per-run colour for the summary and the share line. Reset with the run.
    bestCombo: 0,
    wedgesDriven: 0,
    hollowsCollapsed: 0,
    phaseTwo: false,
    // A forced species / loaner bench makes a run comparable even for a brand
    // new profile. Both are ignored once the run ends.
    logId: '',
    deck: null,
    loadout: null,
    // A contract is a seeded overlay on an existing mode; it never replaces the
    // mode's normal rules. Only session state, so quitting drops the contract.
    contractId: '',
    contractSeed: 0,
    ...overrides,
  };
}

export class GameState {
  constructor({ storage = null, now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = now;
    this.listeners = new Set();
    this.state = defaultState();
    // Run state is intentionally session-only: refreshing a save never resumes a
    // half-expired Time Attack clock. Permanent records live in state.records.
    this.run = makeRunState();
    this.load();
  }

  emit(type = 'change', detail = null) {
    for (const listener of this.listeners) {
      try {
        listener(type, detail, this);
      } catch (error) {
        console.error('GameState listener failed', error);
      }
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The authored campaign round currently on the block, or null. */
  get campaignPlan() {
    if (!this.run || !this.run.active || this.run.mode !== 'campaign') return null;
    return campaignRound(this.run.splits, LOG_TYPES);
  }

  get campaignMeta() {
    if (!this.run || !this.run.active || this.run.mode !== 'campaign') return null;
    return campaignMeta(this.run.splits, LOG_TYPES);
  }

  get species() {
    // The authored campaign is its own 18-round deck. It deliberately ignores
    // the free-chop ladder position so a new profile can play the story.
    const campaign = this.campaignPlan;
    if (campaign) return campaign;
    // Trial (and any future scripted run) can force a species without touching
    // the player's saved ladder position. Daily/Precision step through a fixed
    // deck keyed to the number of clean splits, so every profile meets the same
    // rounds with the same loaner bench.
    if (this.run?.active && Array.isArray(this.run.deck) && this.run.deck.length) {
      const index = clamp(Math.round(finite(this.run.splits, 0)), 0, this.run.deck.length - 1);
      const forced = LOG_TYPES.find((item) => item.id === this.run.deck[index]);
      if (forced) return forced;
    }
    const forcedId = this.run?.active ? this.run.logId : '';
    if (forcedId) {
      const forced = LOG_TYPES.find((item) => item.id === forcedId);
      if (forced) return forced;
    }
    const index = clamp(Math.round(finite(this.state.logIndex, 0)), 0, LOG_TYPES.length - 1);
    return LOG_TYPES[index];
  }

  /** Effective trial bench, or null for normal play. */
  get loadout() {
    return this.run?.active && this.run.loadout ? this.run.loadout : null;
  }

  get axe() {
    const axeId = this.loadout?.axeId || this.state.axeId;
    return AXES.find((item) => item.id === axeId) || AXES[0];
  }

  get effectiveUpgrades() {
    return this.loadout ? { ...this.loadout.upgrades } : this.state.upgrades;
  }

  get effectiveLevel() {
    return this.loadout ? Math.max(1, this.loadout.level || 1) : this.state.level;
  }

  get maxStamina() {
    const upgrades = this.effectiveUpgrades;
    return Math.round(
      100 +
        upgrades.stamina * 9 +
        Math.max(0, this.effectiveLevel - 1) * 2.5,
    );
  }

  get staminaRegen() {
    const upgrades = this.effectiveUpgrades;
    return 6.2 + upgrades.stamina * 1.35 + Math.max(0, this.effectiveLevel - 1) * 0.22;
  }

  get staminaCost() {
    const upgrades = this.effectiveUpgrades;
    return 10.5 * this.axe.stamina * (1 + upgrades.weight * 0.055);
  }

  get sharpness() {
    const upgrades = this.effectiveUpgrades;
    const bench = this.axe.sharpness * (1 + upgrades.sharpness * 0.065);
    const wear = this.loadout ? 0 : clamp(this.state.edgeWear, 0, 1);
    return Math.max(0.35, bench * (1 - wear * 0.36));
  }

  get edgeIntegrity() {
    if (this.loadout) return 1;
    return clamp(1 - this.state.edgeWear, 0, 1);
  }

  get mode() {
    return modeFor(this.run.mode);
  }

  get runActive() {
    return Boolean(this.run.active);
  }

  /** Boss cadence is run-relative so a challenge always starts at wave 1. */
  get bossEvery() {
    if (this.run.mode === 'campaign') return 3;
    return this.run.mode === 'endless' ? ENDLESS_BOSS_EVERY : BOSS_EVERY;
  }

  /** Campaign bosses close every third round (2 ordinary + 1 boss). */
  get campaignBossReady() {
    return this.run.mode === 'campaign' && this.run.splits % 3 === 2;
  }

  get runCleanSplits() {
    return this.run.active ? this.run.splits : this.state.cleanSplits;
  }

  get bossIndex() {
    return this.run.active ? this.run.bosses : this.state.bossesDefeated;
  }

  get nextBossAt() {
    return this.bossEvery * (this.bossIndex + 1);
  }

  get bossReady() {
    return this.runCleanSplits >= this.nextBossAt;
  }

  /** Start a fresh challenge run. Progression and gear are preserved. */
  startMode(modeId = 'free', options = {}) {
    const def = modeFor(modeId);
    // Campaign chapter select: start the run at the first round of a chapter.
    // Other modes ignore this and always start from the top of their deck.
    const campaignStart = def.campaign
      ? clamp(Math.round(finite(options.startRound, 0)), 0, Math.max(0, def.target - 1))
      : 0;
    if (def.id === 'free') {
      this.run.mode = 'free';
      this.run.active = false;
      this.run.logId = '';
      this.run.deck = null;
      this.run.loadout = null;
      // Dropping a loaner bench can lower max stamina; never leave the bar overfull.
      this.state.stamina = Math.min(this.state.stamina, this.maxStamina);
      this.state.combo = 0;
      this.save();
      this.emit('mode', { mode: def, run: { ...this.run } });
      return { ok: true, mode: def, run: { ...this.run } };
    }

    const sharedDate = def.daily ? seedDate(options.seedDate) : null;
    const date = sharedDate ? dayStamp(sharedDate) : dayStamp();
    const dateSeed = def.daily ? dailySeed(sharedDate || new Date()) : 0;
    // A shared historical seed is a fun run, not today's official daily. It
    // records in history but must never overwrite today's daily record.
    if (def.id === 'daily' && !sharedDate && this.state.records.dailyDate !== date) {
      this.state.records.daily = 0;
    }
    let deck = null;
    if (def.deck) {
      deck = [...def.deck];
      // The daily deck is shuffled by the UTC seed. The set of rounds is fixed,
      // so the only thing the profile can bring is skill.
      if (def.daily) {
        const random = mulberry32(dateSeed ^ 0x9e3779b9);
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
      }
    }
    this.run = makeRunState({
      mode: def.id,
      active: true,
      timeLeft: def.time || 0,
      target: def.target || 0,
      startedAt: this.now(),
      splits: campaignStart,
      dailySeed: dateSeed,
      dailyDate: def.daily ? date : '',
      customSeed: Boolean(sharedDate),
      logId: def.fixedLogId || '',
      deck,
      loadout: def.loadout ? { ...def.loadout, upgrades: { ...def.loadout.upgrades } } : null,
    });
    // A challenge starts from a clean bench: full wind, fresh edge, first log.
    // A forced-log run (Trial) leaves the player's saved ladder position alone:
    // the species getter overrides it while the run is active, and quitting or
    // reloading returns to the same free-chop round.
    this.state.combo = 0;
    if (!def.fixedLogId && !deck && !def.campaign) this.state.logIndex = 0;
    this.state.edgeWear = 0;
    this.refillStamina();
    this.state.lastHit = null;
    this.save();
    this.emit('mode', { mode: def, run: { ...this.run } });
    return { ok: true, mode: def, run: { ...this.run } };
  }

  /** Close the current challenge run and persist its best score. */
  endRun(reason = 'time', record = true) {
    if (!this.run.active) return null;
    const def = modeFor(this.run.mode);
    if (def.campaign && this.run.splits >= def.target) this.state.campaignComplete = true;
    this.run.active = false;
    this.run.endedAt = this.now();
    this.run.lastEndReason = reason;
    const recordsThisRun = !(def.daily && this.run.customSeed);
    const previousBest = this.state.records[def.id] || 0;
    if (record && recordsThisRun) {
      this.state.records[def.id] = Math.max(previousBest, this.run.score);
      if (def.daily) this.state.records.dailyDate = this.run.dailyDate;
    }
    const best = this.state.records[def.id] || 0;
    const entry = {
      score: this.run.score,
      splits: this.run.splits,
      bosses: this.run.bosses,
      bestCombo: Math.max(0, this.run.bestCombo || 0),
      wedges: Math.max(0, this.run.wedgesDriven || 0),
      hollows: Math.max(0, this.run.hollowsCollapsed || 0),
      phaseTwo: Boolean(this.run.phaseTwo),
      reason,
      date: this.run.dailyDate || '',
      at: this.now(),
    };
    if (record) {
      const history = Array.isArray(this.state.history[def.id]) ? this.state.history[def.id] : [];
      this.state.history[def.id] = [entry, ...history].slice(0, 5);
    }
    const history = this.state.history[def.id] || [];
    const summary = {
      mode: def.id,
      modeName: def.name,
      score: this.run.score,
      splits: this.run.splits,
      bosses: this.run.bosses,
      bestCombo: entry.bestCombo,
      wedges: entry.wedges,
      hollows: entry.hollows,
      phaseTwo: entry.phaseTwo,
      best,
      newBest: record && recordsThisRun && this.run.score > previousBest,
      customSeed: Boolean(this.run.customSeed),
      reason,
      campaign: Boolean(def.campaign),
      campaignComplete: Boolean(this.state.campaignComplete),
      contractId: this.run.contractId || '',
      contractSeed: this.run.contractSeed || 0,
      dailyDate: this.run.dailyDate,
      dailySeed: this.run.dailySeed,
      timeLeft: Math.max(0, this.run.timeLeft),
      level: this.state.level,
      loadout: Boolean(this.run.loadout),
      history: history.map((item) => ({ ...item })),
    };
    summary.share = this.shareString(summary);
    this.run.timeLeft = 0;
    this.run.logId = '';
    this.run.deck = null;
    this.run.loadout = null;
    this.state.stamina = Math.min(this.state.stamina, this.maxStamina);
    this.save();
    this.emit('runEnd', summary);
    return summary;
  }

  /** Compact, copyable result line for the run summary. */
  shareString(summary) {
    const mode = modeFor(summary.mode);
    const seed = summary.mode === 'daily' && summary.dailyDate ? ` · seed ${summary.dailyDate}` : '';
    const gear = summary.loadout ? ' · loaner bench' : '';
    const combo = summary.bestCombo ? ` · best ×${summary.bestCombo}` : '';
    return `AMERICAN SPLIT · ${mode.short} · ${summary.score.toLocaleString()} pts · ${summary.splits} rounds · ${summary.bosses} bosses${combo} · level ${summary.level}${gear}${seed}`;
  }

  get honeCost() {
    const wear = clamp(this.state.edgeWear, 0, 1);
    return Math.max(24, Math.round(26 + wear * 190));
  }

  canHone() {
    if (this.state.edgeWear <= 0.008) {
      return { ok: false, reason: 'Edge is already sharp', cost: 0 };
    }
    const cost = this.honeCost;
    if (this.state.coins < cost) {
      return { ok: false, reason: `${cost - this.state.coins} more coins`, cost };
    }
    return { ok: true, cost };
  }

  /** Spend coins to bring a chipped edge back to full sharpness. */
  honeEdge() {
    const check = this.canHone();
    if (!check.ok) return check;
    this.state.coins -= check.cost;
    this.state.edgeWear = 0;
    this.state.honed = (this.state.honed || 0) + 1;
    this.save();
    this.emit('shop', { type: 'hone', cost: check.cost });
    return { ok: true, cost: check.cost };
  }

  /** Nails, stones, and bone-dry knots take chips out of the edge. */
  dullEdge(amount = 0.14) {
    // The loaner axe is the trial's fixed variable: hazards still spark and
    // cost points, but they do not carry permanent edge damage out of the run.
    if (this.loadout) return 0;
    const before = this.state.edgeWear;
    this.state.edgeWear = clamp(before + amount, 0, 0.92);
    return this.state.edgeWear - before;
  }

  /** The edge slowly recovers between rounds as the player hones it by hand. */
  regenEdge(dt, rate = 0.028) {
    if (this.state.edgeWear <= 0) return 0;
    const before = this.state.edgeWear;
    this.state.edgeWear = Math.max(0, before - rate * dt);
    return before - this.state.edgeWear;
  }

  /** Run-colour counters used by the summary and final share string. */
  noteWedge() {
    if (this.run.active) this.run.wedgesDriven = (this.run.wedgesDriven || 0) + 1;
  }

  noteBossPhase(phase = 1) {
    if (!this.run.active) return;
    if (phase >= 2) this.run.phaseTwo = true;
  }

  get headWeight() {
    return this.axe.weight * (1 + this.effectiveUpgrades.weight * 0.052);
  }

  get xpNeeded() {
    return xpToNext(this.state.level);
  }

  get xpProgress() {
    return clamp(this.state.xp / this.xpNeeded, 0, 1);
  }

  get bestUnlockedLogIndex() {
    let best = 0;
    for (let i = 0; i < LOG_TYPES.length; i++) {
      if (LOG_TYPES[i].unlockLevel <= this.state.level) best = i;
    }
    return best;
  }

  get currentLog() {
    return this.species;
  }

  get equippedAxe() {
    return this.axe;
  }

  get upgradeLevels() {
    return { ...this.effectiveUpgrades };
  }

  get settings() {
    return this.state.settings;
  }

  setSetting(key, value) {
    if (!(key in this.state.settings)) return false;
    this.state.settings[key] = value;
    this.save();
    this.emit('settings', { key, value });
    return true;
  }

  setQuality(quality) {
    this.state.settings.quality = quality;
    this.state.settings.autoQuality = quality === 'auto';
    this.save();
    this.emit('quality', { quality });
  }

  /* ---------------------------------------------------------------- *
   *  Persistence
   * ---------------------------------------------------------------- */

  load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      this.state = this.sanitize(parsed);
    } catch {
      this.state = defaultState();
    }
  }

  sanitize(saved) {
    const base = defaultState();
    const merged = {
      ...base,
      ...saved,
      upgrades: { ...base.upgrades, ...(saved.upgrades || {}) },
      settings: { ...base.settings, ...(saved.settings || {}) },
    };
    merged.score = Math.max(0, Math.round(finite(merged.score, 0)));
    merged.totalScore = Math.max(0, Math.round(finite(merged.totalScore, merged.score)));
    merged.coins = Math.max(0, Math.round(finite(merged.coins, 0)));
    merged.level = clamp(Math.round(finite(merged.level, 1)), 1, 99);
    merged.xp = Math.max(0, Math.round(finite(merged.xp, 0)));
    merged.combo = Math.max(0, Math.round(finite(merged.combo, 0)));
    merged.bestCombo = Math.max(merged.combo, Math.round(finite(merged.bestCombo, 0)));
    merged.splits = Math.max(0, Math.round(finite(merged.splits, 0)));
    merged.attempts = Math.max(0, Math.round(finite(merged.attempts, 0)));
    merged.cleanSplits = Math.max(0, Math.round(finite(merged.cleanSplits, 0)));
    merged.bossesDefeated = Math.max(0, Math.round(finite(merged.bossesDefeated, 0)));
    merged.edgeWear = clamp(finite(merged.edgeWear, 0), 0, 0.92);
    merged.honed = Math.max(0, Math.round(finite(merged.honed, 0)));
    merged.wedges = Math.max(0, Math.round(finite(merged.wedges, 0)));
    merged.wedgesPulled = Math.max(0, Math.round(finite(merged.wedgesPulled, 0)));
    merged.campaignComplete = Boolean(merged.campaignComplete);
    merged.campaignChapter = clamp(
      Math.round(finite(merged.campaignChapter, 1)),
      1,
      Math.max(1, Math.ceil(CAMPAIGN_LENGTH / 3)),
    );
    const savedRecords = saved.records && typeof saved.records === 'object' ? saved.records : {};
    merged.records = {
      ...base.records,
      time: Math.max(0, Math.round(finite(savedRecords.time, 0))),
      precision: Math.max(0, Math.round(finite(savedRecords.precision, 0))),
      endless: Math.max(0, Math.round(finite(savedRecords.endless, 0))),
      daily: Math.max(0, Math.round(finite(savedRecords.daily, 0))),
      trial: Math.max(0, Math.round(finite(savedRecords.trial, 0))),
      stump: Math.max(0, Math.round(finite(savedRecords.stump, 0))),
      campaign: Math.max(0, Math.round(finite(savedRecords.campaign, 0))),
      dailyDate: typeof savedRecords.dailyDate === 'string' ? savedRecords.dailyDate : '',
    };
    // Keep the last five runs per mode. Old saves simply start with empty lists.
    merged.history = { ...base.history };
    const savedHistory = saved.history && typeof saved.history === 'object' ? saved.history : {};
    for (const key of Object.keys(merged.history)) {
      const list = Array.isArray(savedHistory[key]) ? savedHistory[key] : [];
      merged.history[key] = list
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          score: Math.max(0, Math.round(finite(item.score, 0))),
          splits: Math.max(0, Math.round(finite(item.splits, 0))),
          bosses: Math.max(0, Math.round(finite(item.bosses, 0))),
          bestCombo: Math.max(0, Math.round(finite(item.bestCombo, 0))),
          wedges: Math.max(0, Math.round(finite(item.wedges, 0))),
          hollows: Math.max(0, Math.round(finite(item.hollows, 0))),
          phaseTwo: Boolean(item.phaseTwo),
          reason: typeof item.reason === 'string' ? item.reason : '',
          date: typeof item.date === 'string' ? item.date : '',
          at: Math.max(0, Math.round(finite(item.at, 0))),
        }))
        .slice(0, 5);
    }
    // Forked Red Elm was inserted at index 6 in save version 4, so shift older
    // indexes at or above that point to keep the player's current species.
    const savedVersion = Math.round(finite(saved.version, 0));
    if (savedVersion < 4) {
      const oldIndex = Math.round(finite(merged.logIndex, 0));
      merged.logIndex = Math.min(LOG_TYPES.length - 1, oldIndex + (oldIndex >= 6 ? 1 : 0));
    }
    // Ring-Shaken Walnut was inserted at index 9 in save version 5, so a version
    // 4 save at or above Ironwood shifts up one rung and keeps its species.
    if (savedVersion < 5) {
      const oldIndex = Math.round(finite(merged.logIndex, 0));
      merged.logIndex = Math.min(LOG_TYPES.length - 1, oldIndex + (oldIndex >= 9 ? 1 : 0));
    }
    merged.logIndex = clamp(Math.round(finite(merged.logIndex, 0)), 0, LOG_TYPES.length - 1);
    merged.version = 5;
    for (const key of Object.keys(base.upgrades)) {
      merged.upgrades[key] = clamp(
        Math.round(finite(merged.upgrades[key], 0)),
        0,
        UPGRADES[key].max,
      );
    }
    if (!AXES.some((a) => a.id === merged.axeId)) merged.axeId = 'felling';
    if (!Array.isArray(merged.ownedAxes)) merged.ownedAxes = ['felling'];
    merged.ownedAxes = [...new Set(['felling', merged.axeId, ...merged.ownedAxes])].filter((id) =>
      AXES.some((a) => a.id === id),
    );
    if (!['auto', 'low', 'medium', 'high', 'ultra'].includes(merged.settings.quality)) {
      merged.settings.quality = 'auto';
    }
    merged.settings.autoQuality = merged.settings.quality === 'auto';
    if (!TIME_OPTIONS.includes(merged.settings.timeOfDay)) merged.settings.timeOfDay = 'golden';
    if (!WEATHER_OPTIONS.includes(merged.settings.weather)) merged.settings.weather = 'clear';
    // Audio settings persist independently: the topbar speaker is the SFX mute,
    // while the Settings panel has separate music/SFX volumes and mutes.
    merged.settings.sound = merged.settings.sound !== false;
    merged.settings.music = merged.settings.music !== false;
    merged.settings.musicVolume = clamp(finite(merged.settings.musicVolume, 0.35), 0, 1);
    merged.settings.sfxVolume = clamp(finite(merged.settings.sfxVolume, 0.8), 0, 1);
    merged.stamina = clamp(finite(merged.stamina, 100), 0, 200);
    merged.lastHit =
      merged.lastHit && typeof merged.lastHit === 'object' ? merged.lastHit : null;
    return merged;
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.state));
      return true;
    } catch {
      return false;
    }
  }

  resetProgress() {
    const settings = { ...this.state.settings };
    this.state = defaultState();
    this.state.settings = settings;
    this.run = makeRunState();
    this.save();
    this.emit('reset', null);
    return this.snapshot();
  }

  /* ---------------------------------------------------------------- *
   *  Stamina
   * ---------------------------------------------------------------- */

  refillStamina() {
    this.state.stamina = this.maxStamina;
  }

  spendStamina(amount = this.staminaCost) {
    const cost = Math.max(0, amount);
    const available = this.state.stamina;
    this.state.stamina = Math.max(0, available - cost);
    return {
      cost,
      spent: Math.min(cost, available),
      remaining: this.state.stamina,
      winded: available < cost * 0.7,
    };
  }

  regenStamina(dt, multiplier = 1) {
    const max = this.maxStamina;
    const before = this.state.stamina;
    this.state.stamina = Math.min(max, before + this.staminaRegen * dt * multiplier);
    return this.state.stamina - before;
  }

  /* ---------------------------------------------------------------- *
   *  Scoring
   * ---------------------------------------------------------------- */

  /**
   * Register the outcome of one strike.
   *
   * @param {object} report
   * @param {number} report.center      0..1, 1 is dead centre
   * @param {number} report.grain       0..1, alignment with a natural check
   * @param {number} report.timing      0..1, quality of the meter stop
   * @param {boolean} report.perfect     meter stopped in the perfect band
   * @param {boolean} report.glancing   blade skated or clipped the rim
   * @param {boolean} report.knotHit    blade met a knot
   * @param {boolean} report.knotPrecise strike threaded between knots
   * @param {number} report.energy       delivered energy, roughly 0.3..2.2
   * @param {number} report.mainPieces  number of grain-aligned rounds produced
   * @param {number} report.power       swing power 0..1
   * @param {number} report.aimX        aim offset in metres
   * @param {number} report.aimZ        aim offset in metres
   */
  registerSplit(report) {
    const species = this.species;
    const center = clamp(finite(report.center, 0), 0, 1);
    const grain = clamp(finite(report.grain, 0), 0, 1);
    const timing = clamp(finite(report.timing, 0), 0, 1);
    const energy = Math.max(0, finite(report.energy, 1));
    const glancing = Boolean(report.glancing);
    const knotHit = Boolean(report.knotHit);
    const knotPrecise = Boolean(report.knotPrecise);
    const perfect = Boolean(report.perfect);
    const weakHit = Boolean(report.weakHit);
    const wedgeHit = Boolean(report.wedgeHit);
    const wedgeHomed = Boolean(report.wedgeHomed);
    const wedgeBounced = Boolean(report.wedgeBounced);
    const wedgeDepth = clamp(finite(report.wedgeDepth, 0), 0, 1);
    const undercut = Boolean(report.undercut);
    const rootRingBroken = Boolean(report.rootRingBroken);
    const riving = Boolean(report.riving);
    const grainLock = Boolean(report.grainLock);
    const crossedGrain = Boolean(report.crossedGrain);
    const rivingBonus = clamp(finite(report.rivingBonus, 0), 0, 1);
    const ringCut = Boolean(report.ringCut);
    const ringLoose = Boolean(report.ringLoose);
    const corePunch = Boolean(report.corePunch);
    const coreCracked = Boolean(report.coreCracked);

    const control = clamp(center * 0.54 + grain * 0.27 + timing * 0.19, 0, 1);
    // A boss seam is an intentional off-pith target: control still affects the
    // payout, but it should not turn a precise seam strike into a "ROUGH" hit.
    // A wedge strike is likewise a deliberate steel target, not a wild chop.
    const clean =
      !glancing &&
      energy >= 0.58 &&
      (weakHit || wedgeHit || ringCut || control >= 0.56);
    const partial = Boolean(report.partial);
    const boss = Boolean(report.boss || species.boss);
    const hazardHit = Boolean(report.hazardHit);
    // The fracture model knows how much edge a nail/stone actually took; fall
    // back to the old flat chip for callers that predate the energy ledger.
    const sharpLoss = clamp(finite(report.sharpLoss, 0.13), 0, 0.4);
    const hollowHit = Boolean(report.hollowHit);
    const hollowCollapse = Boolean(report.hollowCollapse);
    const hollowRimTear = Boolean(report.hollowRimTear);
    const strikesRequired = Math.max(
      1,
      Math.round(finite(report.strikesRequired, species.strikes || 1)),
    );
    const strikesLeft = Math.max(
      0,
      Math.round(finite(report.strikesLeft, partial ? 1 : 0)),
    );
    const damage = clamp(finite(report.damage, partial ? 0.5 : 1), 0, 1);

    const comboBefore = this.state.combo;
    // Pure scoring maths lives in mechanics.js so the node tests and the game
    // cannot drift apart. A partial strike is a real bite, but it is not a
    // split: it pays a fraction of the points and XP.
    const cut = scoreCut({
      speciesBasePoints: species.basePoints,
      speciesToughness: species.toughness,
      center,
      grain,
      timing,
      energy,
      perfect,
      knotPrecise,
      weakHit,
      hollowCollapse,
      hollowRimTear,
      wedgeHit,
      wedgeHomed,
      wedgeBounced,
      undercut,
      rootRingBroken,
      riving,
      grainLock,
      rivingBonus,
      crossedGrain,
      ringCut,
      ringLoose,
      corePunch,
      boss,
      modeScale: this.run.active ? modeFor(this.run.mode).scoreScale || 1 : 1,
      glancing,
      knotHit,
      knotCount: species.knots,
      hazardHit,
      partial,
      damage,
      comboBefore,
      clean,
    });
    const points = cut.points;
    const penalty = cut.penalty;
    const scoreDelta = cut.scoreDelta;
    const comboMultiplier = cut.comboMultiplier;
    if (hazardHit) this.dullEdge(sharpLoss);
    this.state.score = Math.max(0, this.state.score + scoreDelta);
    this.state.totalScore += Math.max(0, scoreDelta);
    if (this.run.active) {
      this.run.score += Math.max(0, scoreDelta);
      if (!partial && clean) {
        this.run.splits += 1;
        if (this.run.mode === 'time') {
          // Time Attack rewards momentum: clean splits buy back clock.
          this.run.timeLeft = Math.min(120, this.run.timeLeft + 2.5);
        }
      }
    }
    const xpGain = Math.max(
      partial ? 3 : 4,
      Math.round(points * (partial ? 0.3 : 0.34) + (clean ? (partial ? 6 : 18) : 6)),
    );
    const coinGain = Math.max(1, Math.round(points * (partial ? 0.07 : 0.11)));
    this.state.coins += coinGain;

    if (!partial) {
      if (clean) {
        this.state.combo = comboBefore + 1;
        this.state.cleanSplits += 1;
        this.state.splits += 1;
        if (boss) {
          if (this.run.active) this.run.bosses += 1;
          else this.state.bossesDefeated += 1;
        }
      } else {
        this.state.combo = 0;
        this.state.splits += 1;
      }
    } else if (glancing) {
      this.state.combo = 0;
    }
    this.state.bestCombo = Math.max(this.state.bestCombo, this.state.combo);
    if (this.run.active) {
      this.run.bestCombo = Math.max(this.run.bestCombo || 0, this.state.combo);
      if (hollowCollapse) {
        this.run.hollowsCollapsed = (this.run.hollowsCollapsed || 0) + 1;
      }
      if (wedgeHit && !wedgeBounced) this.noteWedge();
      this.noteBossPhase(finite(report.bossPhase, 1));
    }
    this.state.attempts += 1;

    const levelBefore = this.state.level;
    this.state.xp += xpGain;
    let levelsGained = 0;
    while (this.state.xp >= xpToNext(this.state.level) && this.state.level < 99) {
      this.state.xp -= xpToNext(this.state.level);
      this.state.level += 1;
      levelsGained += 1;
    }
    if (levelsGained > 0) {
      this.state.stamina = Math.min(
        this.maxStamina,
        this.state.stamina + levelsGained * 22,
      );
    }

    const campaignRunComplete =
      this.run.active &&
      this.run.mode === 'campaign' &&
      this.run.splits >= modeFor('campaign').target;
    const campaignJustCompleted =
      campaignRunComplete ||
      (!this.run.active &&
        !this.state.campaignComplete &&
        this.state.cleanSplits >= CAMPAIGN_SPLITS);
    if (campaignJustCompleted) this.state.campaignComplete = true;
    // Unlock the next chapter as soon as a chapter boss falls, so quitting after
    // a boss does not throw the player back to Chapter 1 next session.
    if (this.run.active && this.run.mode === 'campaign' && !partial) {
      this.state.campaignChapter = Math.max(
        this.state.campaignChapter || 1,
        campaignUnlockedChapter(this.run.splits),
      );
    }

    // Advance the log ladder only after a clean, controlled split. A forced-log
    // run (Trial) and a fixed-deck run (Daily/Precision) must not overwrite the
    // player's saved ladder position. The campaign has its own deck.
    let nextLog = this.species;
    if (
      !partial &&
      !this.run.logId &&
      !(this.run.deck && this.run.deck.length) &&
      this.run.mode !== 'campaign'
    ) {
      if (clean) {
        const best = this.bestUnlockedLogIndex;
        const target = Math.min(this.state.logIndex + 1, best, LOG_TYPES.length - 1);
        this.state.logIndex = target;
        nextLog = this.species;
      } else {
        // A botched strike leaves the same species on the block for a retry.
        this.state.logIndex = Math.min(this.state.logIndex, this.bestUnlockedLogIndex);
        nextLog = this.species;
      }
    }

    const quality = partial
      ? glancing
        ? 'GLANCING'
        : 'BITE'
      : glancing
        ? 'GLANCING'
        : clean
          ? boss
            ? 'BOSS CLEAN'
            : comboBefore > 0
              ? 'STREAK'
              : 'CLEAN'
          : 'ROUGH';

    const lastHit = {
      time: this.now(),
      quality,
      clean,
      glancing,
      perfect,
      partial,
      boss,
      weakHit,
      hazardHit,
      sharpLoss: Number(sharpLoss.toFixed(3)),
      fractureOutcome: report.fractureOutcome || null,
      crackWork: Number(clamp(finite(report.crackWork, 0), 0, 1).toFixed(3)),
      energyDelivered: Number(finite(report.energyDelivered, 0).toFixed(1)),
      energyRequired: Number(finite(report.energyRequired, 0).toFixed(1)),
      hollowHit,
      hollowCollapse,
      hollowRimTear,
      wedgeHit,
      wedgeHomed,
      wedgeBounced,
      wedgeDepth: Number(wedgeDepth.toFixed(2)),
      undercut,
      rootsCut: Math.max(0, Math.round(finite(report.rootsCut, 0))),
      rootUnstable: Boolean(report.rootUnstable),
      rootRingBroken,
      rootBonus: Number(finite(report.rootBonus, 0).toFixed(2)),
      riving,
      grainLock,
      crossedGrain,
      rivingBonus: Number(rivingBonus.toFixed(2)),
      rivingStreak: Math.max(0, Math.round(finite(report.rivingStreak, 0))),
      ringCut,
      ringCuts: Math.max(0, Math.round(finite(report.ringCuts, 0))),
      ringLoose,
      ringBound: Boolean(report.ringBound),
      corePunch,
      coreCracked,
      ringCutsNeeded: Math.max(1, Math.round(finite(report.ringCutsNeeded, 2))),
      strikesRequired,
      strikesLeft,
      strikesLeftExact: Number(finite(report.strikesLeft, strikesLeft).toFixed(2)),
      damage: Number(damage.toFixed(2)),
      points: scoreDelta,
      basePoints: Math.round(cut.base),
      penalty,
      xp: xpGain,
      coins: coinGain,
      combo: this.state.combo,
      comboMultiplier: Number(comboMultiplier.toFixed(2)),
      center: Number(center.toFixed(3)),
      grain: Number(grain.toFixed(3)),
      timing: Number(timing.toFixed(3)),
      energy: Number(energy.toFixed(3)),
      power: Number(clamp(finite(report.power, 0.7), 0, 1).toFixed(3)),
      mainPieces: partial ? 0 : Math.max(2, Math.round(finite(report.mainPieces, 2))),
      knotHit,
      knotPrecise,
      aimX: Number(finite(report.aimX, 0).toFixed(3)),
      aimZ: Number(finite(report.aimZ, 0).toFixed(3)),
      logType: species.name,
      logId: species.id,
      campaignChapter: species.campaignChapter || null,
      campaignChapterName: species.campaignChapterName || null,
      campaignRound: species.campaignRound || null,
      campaignBoss: Boolean(species.boss),
      contractId: this.run.contractId || '',
      levelsGained,
      level: this.state.level,
      edgeIntegrity: Number(this.edgeIntegrity.toFixed(2)),
      runMode: this.run.mode,
      runSplit: this.run.active && !partial ? this.run.splits : null,
      campaignJustCompleted,
    };
    this.state.lastHit = lastHit;
    this.state.stamina = clamp(this.state.stamina, 0, this.maxStamina);
    this.save();
    this.emit('split', lastHit);
    if (levelsGained > 0) {
      this.emit('level', {
        level: this.state.level,
        from: levelBefore,
        levelsGained,
        unlocked: LOG_TYPES.filter((t) => t.unlockLevel === this.state.level),
      });
    }
    if (campaignJustCompleted && !this.run.active) {
      this.emit('campaign', {
        cleanSplits: this.state.cleanSplits,
        score: this.state.score,
        totalScore: this.state.totalScore,
        bossesDefeated: this.state.bossesDefeated,
        level: this.state.level,
        bestCombo: this.state.bestCombo,
      });
    }
    return lastHit;
  }

  registerMiss(reason = 'miss') {
    this.state.combo = 0;
    this.state.attempts += 1;
    const lastHit = {
      time: this.now(),
      quality: 'MISS',
      clean: false,
      glancing: true,
      perfect: false,
      points: -30,
      penalty: 30,
      xp: 0,
      coins: 0,
      combo: 0,
      center: 0,
      grain: 0,
      timing: 0,
      energy: 0,
      mainPieces: 0,
      reason,
      logType: this.species.name,
      logId: this.species.id,
    };
    this.state.score = Math.max(0, this.state.score - 30);
    this.state.lastHit = lastHit;
    this.save();
    this.emit('split', lastHit);
    return lastHit;
  }

  /* ---------------------------------------------------------------- *
   *  Shop
   * ---------------------------------------------------------------- */

  canBuyAxe(axeId) {
    const axe = AXES.find((a) => a.id === axeId);
    if (!axe) return { ok: false, reason: 'Unknown axe' };
    if (axe.id === this.state.axeId) return { ok: false, reason: 'Equipped' };
    if (this.state.level < axe.unlockLevel) {
      return { ok: false, reason: `Unlocks at level ${axe.unlockLevel}` };
    }
    if (this.state.coins < axe.cost) {
      return { ok: false, reason: `${axe.cost - this.state.coins} more coins` };
    }
    return { ok: true, axe };
  }

  buyAxe(axeId) {
    const check = this.canBuyAxe(axeId);
    if (!check.ok) return check;
    this.state.coins -= check.axe.cost;
    this.state.axeId = check.axe.id;
    if (!this.state.ownedAxes.includes(check.axe.id)) {
      this.state.ownedAxes.push(check.axe.id);
    }
    this.save();
    this.emit('shop', { type: 'axe', axe: check.axe });
    return { ok: true, axe: check.axe };
  }

  get ownedAxes() {
    return new Set(['felling', this.state.axeId, ...(this.state.ownedAxes || [])]);
  }

  equipAxe(axeId) {
    const axe = AXES.find((a) => a.id === axeId);
    if (!axe) return false;
    if (this.state.level < axe.unlockLevel) return false;
    if (!this.ownedAxes.has(axe.id)) return false;
    this.state.axeId = axe.id;
    this.save();
    this.emit('shop', { type: 'equip', axe });
    return true;
  }

  canUpgrade(stat) {
    const def = UPGRADES[stat];
    if (!def) return { ok: false, reason: 'Unknown upgrade' };
    const level = this.state.upgrades[stat];
    if (level >= def.max) return { ok: false, reason: 'Fully upgraded' };
    const cost = upgradeCost(stat, level);
    if (this.state.coins < cost) return { ok: false, reason: `${cost - this.state.coins} more coins` };
    return { ok: true, cost, level };
  }

  buyUpgrade(stat) {
    const check = this.canUpgrade(stat);
    if (!check.ok) return check;
    this.state.coins -= check.cost;
    this.state.upgrades[stat] = check.level + 1;
    if (stat === 'stamina') {
      this.state.stamina = Math.min(this.maxStamina, this.state.stamina + 10);
    }
    this.save();
    this.emit('shop', { type: 'upgrade', stat, level: this.state.upgrades[stat] });
    return { ok: true, stat, level: this.state.upgrades[stat], cost: check.cost };
  }

  /* ---------------------------------------------------------------- *
   *  Snapshot
   * ---------------------------------------------------------------- */

  snapshot() {
    return {
      score: this.state.score,
      combo: this.state.combo,
      xp: this.state.xp,
      level: this.state.level,
      stamina: Number(this.state.stamina.toFixed(1)),
      logType: this.species.name,
      lastHit: this.state.lastHit ? { ...this.state.lastHit } : null,
      // Extra, non-required context:
      logId: this.species.id,
      logIndex: this.state.logIndex,
      trial: this.run.mode === 'trial',
      runLogId: this.run.logId || '',
      runLoadout: Boolean(this.loadout),
      runDeck: this.run.deck ? [...this.run.deck] : [],
      runDeckStage: this.run.deck ? Math.min(this.run.splits, this.run.deck.length - 1) : 0,
      runCustomSeed: Boolean(this.run.customSeed),
      maxStamina: this.maxStamina,
      xpNeeded: this.xpNeeded,
      coins: this.state.coins,
      bestCombo: this.state.bestCombo,
      splits: this.state.splits,
      cleanSplits: this.state.cleanSplits,
      bossesDefeated: this.state.bossesDefeated,
      nextBossAt: this.nextBossAt,
      bossReady: this.bossReady,
      chapter: chapterFor(this.state.cleanSplits),
      chapterName: chapterFor(this.state.cleanSplits).name,
      chapterIndex: chapterFor(this.state.cleanSplits).index,
      campaign: this.campaignMeta,
      campaignPlan: this.campaignPlan
        ? {
            round: this.campaignPlan.campaignRound,
            chapter: this.campaignPlan.campaignChapter,
            chapterName: this.campaignPlan.campaignChapterName,
            boss: Boolean(this.campaignPlan.boss),
            finalBoss: Boolean(this.campaignPlan.finalBoss),
            crownSections: this.campaignPlan.crownSections || 0,
          }
        : null,
      campaignProgress: this.run.mode === 'campaign' ? this.run.splits : 0,
      campaignLength: CAMPAIGN_LENGTH,
      contractId: this.run.contractId || '',
      contractSeed: this.run.contractSeed || 0,
      edgeIntegrity: Number(this.edgeIntegrity.toFixed(2)),
      edgeWear: Number(this.state.edgeWear.toFixed(2)),
      honeCost: this.honeCost,
      honed: this.state.honed || 0,
      wedges: this.state.wedges || 0,
      mode: this.run.mode,
      modeName: this.mode.name,
      runActive: this.run.active,
      runScore: this.run.score,
      runSplits: this.run.splits,
      runBosses: this.run.bosses,
      runTarget: this.run.target,
      runTimeLeft: Number(Math.max(0, this.run.timeLeft).toFixed(2)),
      runBestCombo: this.run.bestCombo || 0,
      runWedges: this.run.wedgesDriven || 0,
      runHollows: this.run.hollowsCollapsed || 0,
      runPhaseTwo: Boolean(this.run.phaseTwo),
      runBest: this.state.records[this.run.mode] || 0,
      records: { ...this.state.records },
      history: Object.fromEntries(
        Object.entries(this.state.history || {}).map(([key, list]) => [
          key,
          Array.isArray(list) ? list.map((item) => ({ ...item })) : [],
        ]),
      ),
      dailySeed: this.run.dailySeed,
      dailyDate: this.run.dailyDate,
      campaignComplete: Boolean(this.state.campaignComplete),
      campaignChapter: clamp(
        Math.round(finite(this.state.campaignChapter, 1)),
        1,
        Math.max(1, Math.ceil(CAMPAIGN_LENGTH / 3)),
      ),
      campaignChapters: Math.max(1, Math.ceil(CAMPAIGN_LENGTH / 3)),
      bossIndex: this.bossIndex,
      bossEvery: this.bossEvery,
      strikes: this.species.strikes || 1,
      staminaCost: Number(this.staminaCost.toFixed(1)),
      staminaRegen: Number(this.staminaRegen.toFixed(1)),
      axe: this.axe.id,
      axeName: this.axe.name,
      upgrades: { ...this.effectiveUpgrades },
      permanentUpgrades: { ...this.state.upgrades },
      effectiveLevel: this.effectiveLevel,
      sharpness: Number(this.sharpness.toFixed(2)),
      headWeight: Number(this.headWeight.toFixed(2)),
      settings: { ...this.state.settings },
    };
  }
}

/** Deterministic knot layout for a species, so resetScene reproduces the same log. */
export function makeKnots(species, seedOffset = 0) {
  const random = mulberry32(species.seed * 17 + seedOffset * 41);
  const knots = [];
  const piths = [];
  if (species.twinPith) {
    const spread = species.radius * (species.pithSpread || 0.32);
    const angle = species.pithAngle || 0;
    piths.push(
      { x: Math.cos(angle) * spread, z: Math.sin(angle) * spread },
      { x: -Math.cos(angle) * spread, z: -Math.sin(angle) * spread },
    );
  }
  for (let i = 0; i < species.knots; i++) {
    let angle = (i / Math.max(1, species.knots)) * Math.PI * 2 + random() * 1.3;
    let radius = species.radius * (0.42 + random() * 0.26);
    let knotRadius = 0.028 + random() * 0.022;
    // Never bury a fork pith under a knot: the twin hearts are the point of the
    // round, and a pith strike must be readable and clean.
    for (let attempt = 0; attempt < 14; attempt++) {
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const blocked = piths.some(
        (pith) => Math.hypot(x - pith.x, z - pith.z) < knotRadius * 1.9 + species.radius * 0.1,
      );
      if (!blocked) break;
      angle += Math.PI * (0.45 + random() * 0.55);
      radius = species.radius * (0.48 + random() * 0.24);
      knotRadius = 0.026 + random() * 0.018;
    }
    knots.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      angle,
      radius: knotRadius,
      seed: Math.floor(random() * 1e6),
    });
  }
  return knots;
}
