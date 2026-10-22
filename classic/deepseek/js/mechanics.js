/**
 * Pure, DOM-free game mechanics.
 *
 * These helpers used to live inline in `utils.js` and `main.js`; keeping them
 * here means the deterministic `node --test` suite can exercise the same maths
 * the browser runs. Nothing in this module may import Three.js, Rapier or touch
 * the DOM.
 */

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Small deterministic PRNG (same sequence as the old utils.js helper). */
export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Charge meter: a 0..1 triangle sweep over `period` seconds. */
export function triangleWave(t, period = 1.28) {
  const raw = (t / period) % 2;
  return raw <= 1 ? raw : 2 - raw;
}

/** Show fractional bites ("2.4") without noisy trailing zeroes. */
export function formatBites(value) {
  const n = Math.max(0, Number(value) || 0);
  if (n < 0.05) return '0';
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
}

/**
 * Decay camera shake once per rendered frame (not once per physics step).
 * A 0.09 kick at 0.9/s survives a 16 ms frame and still reads at 15 FPS.
 */
export function decayShake(shake, dt, rate = 0.9) {
  return Math.max(0, (Number(shake) || 0) - Math.max(0, Number(dt) || 0) * rate);
}

/** Timing sweet spot shared by the mouse meter and the test hooks. */
export const METER_SWEET_SPOT = 0.745;
export const METER_SWEET_WIDTH = 0.46;
export const METER_PERFECT_WINDOW = 0.042;

/**
 * Map the raw charge meter value to the swing the player releases.
 * Exactly the mapping `releaseCharge()` has always used.
 */
export function chargeFromMeter(value) {
  const v = clamp(Number(value) || 0, 0, 1);
  const dist = Math.abs(v - METER_SWEET_SPOT);
  return {
    value: v,
    power: 0.26 + v * 0.74,
    timing: clamp(1 - dist / METER_SWEET_WIDTH, 0, 1),
    perfect: dist <= METER_PERFECT_WINDOW,
    coreWindow: v >= 0.9,
  };
}

/**
 * Delivered swing energy (normalised, 1.0 ≈ a clean splitting blow).
 * The terms are the ones `triggerImpact()` has always combined: raw power,
 * timing, head weight, edge sharpness, measured head speed and weather.
 */
export function deliveredEnergy({
  power = 0.75,
  timing = 0.65,
  headWeight = 1,
  sharpness = 1,
  speed = 10,
  weatherSplit = 1,
} = {}) {
  return (
    clamp(Number(power) || 0, 0, 1) *
    (0.72 + clamp(Number(timing) || 0, 0, 1) * 0.32) *
    headWeight *
    (0.62 + sharpness * 0.38) *
    (0.72 + clamp((Number(speed) || 0) / 15, 0.5, 1.8) * 0.28) *
    weatherSplit
  );
}

/**
 * Fracture plan for a bite (extracted from debris.planSplit). Pure so the
 * glance threshold, piece counts and penetration depth can be tested without
 * Rapier or a renderer.
 */
export function planFracture({
  energy = 0.8,
  center = 0.8,
  grain = 0.7,
  power = 0.75,
  toughness = 0.6,
  knotHit = false,
  knotPrecise = false,
  weakHit = false,
  huge = false,
  knots = 0,
  frozen = false,
  splinter = 0,
  qualityLow = true,
} = {}) {
  const effective = (energy * (0.72 + center * 0.28) * (0.7 + grain * 0.3)) / Math.max(0.01, toughness);
  const glancing =
    center < (weakHit ? 0.12 : 0.3) ||
    effective < 0.62 ||
    (knotHit && !knotPrecise && effective < 1.05 && !weakHit);
  const maxPieces = huge ? 5 : 4;
  let mainPieces = huge ? 3 : 2;
  if (effective >= 0.98) mainPieces = huge ? 4 : 3;
  if (effective >= 1.32 && grain >= 0.48) mainPieces = maxPieces;
  if (knotHit && knotPrecise) mainPieces = Math.min(maxPieces, mainPieces + 1);
  if (glancing) mainPieces = huge ? 3 : 2;
  if (frozen && effective > 1.2) mainPieces = Math.min(maxPieces, mainPieces + 1);
  const splinterBase =
    2 +
    Math.round(effective * 2.6) +
    Math.round((splinter || 0) * 5) +
    (glancing ? 2 : 0) +
    (knots || 0) +
    (huge ? 2 : 0);
  return {
    glancing,
    mainPieces: clamp(mainPieces, 2, maxPieces),
    splinterCount: clamp(splinterBase, 2, qualityLow ? 8 : 14),
    effective: Number(effective.toFixed(3)),
    penetration: Number((0.016 + effective * 0.035).toFixed(3)),
    energy: Number(energy.toFixed(3)),
    power,
    knotHit,
    knotPrecise,
  };
}

/**
 * One scored cut in the combo / economy loop (the per-hit part of
 * GameState.registerSplit). Kept pure so the economy can be tuned and tested
 * without a save file; the class still owns persistence and progression.
 */
export function scoreCut({
  speciesBasePoints = 70,
  speciesToughness = 0.55,
  center = 0.8,
  grain = 0.7,
  timing = 0.8,
  energy = 1,
  perfect = false,
  knotPrecise = false,
  weakHit = false,
  hollowCollapse = false,
  hollowRimTear = false,
  wedgeHit = false,
  wedgeHomed = false,
  wedgeBounced = false,
  undercut = false,
  rootRingBroken = false,
  riving = false,
  grainLock = false,
  rivingBonus = 0,
  crossedGrain = false,
  ringCut = false,
  ringLoose = false,
  corePunch = false,
  boss = false,
  modeScale = 1,
  glancing = false,
  knotHit = false,
  knotCount = 0,
  hazardHit = false,
  partial = false,
  damage = partial ? 0.5 : 1,
  comboBefore = 0,
  clean = null,
} = {}) {
  let base =
    speciesBasePoints +
    center * 150 +
    grain * 95 +
    timing * 125 +
    Math.min(1.4, energy) * 55 +
    speciesToughness * 45;
  if (perfect) base += 70;
  if (knotPrecise) base += 55;
  if (weakHit) base += 110;
  if (hollowCollapse) base += 85;
  if (hollowRimTear) base += 25;
  if (wedgeHit) base += wedgeHomed ? 70 : wedgeBounced ? 10 : 45;
  if (undercut) base += 55;
  if (rootRingBroken) base += 90;
  if (riving) base += 28;
  if (grainLock) base += 52 + rivingBonus * 30;
  if (crossedGrain) base -= 20;
  if (ringCut) base += ringLoose ? 95 : 38;
  if (corePunch) base += 45;
  if (boss) base *= 2.15;
  base *= modeScale || 1;

  let penalty = 0;
  const cleanCut =
    clean ??
    (!glancing &&
      energy >= 0.58 &&
      (weakHit ||
        wedgeHit ||
        ringCut ||
        center * 0.54 + grain * 0.27 + timing * 0.19 >= 0.56));
  if (glancing) {
    base *= 0.24;
    penalty += 45;
  } else if (!clean) {
    penalty += 20;
  }
  if (knotHit && !knotPrecise) penalty += 22 + knotCount * 9;
  if (hazardHit) penalty += 28;
  if (center < 0.42) penalty += Math.round((0.42 - center) * 90);

  const comboMultiplier = cleanCut ? 1 + Math.min(comboBefore, 10) * 0.18 : 0;
  let points;
  if (partial) {
    const bite = base * (0.12 + damage * 0.1);
    points = Math.max(3, Math.round(bite * (1 + Math.min(comboBefore, 10) * 0.05)));
  } else {
    points = Math.max(0, Math.round(base * comboMultiplier - penalty));
  }
  const partialPenalty = partial ? Math.round(penalty * 0.45) : 0;
  const scoreDelta = partial
    ? Math.max(0, points - partialPenalty)
    : Math.max(-40, points - penalty);
  return { clean: cleanCut, base, penalty, points, scoreDelta, comboMultiplier };
}

/**
 * Impact juice timers, extracted from `triggerImpact()` so the feel can be
 * tuned and regression-tested without a renderer. `hitStop` freezes the sim
 * briefly, `slowMo` runs a perfect split in slow motion, and `shake` is the
 * camera kick amplitude. The browser applies a reduced-motion multiplier to
 * the shake only; the timing stays identical so gameplay is unaffected.
 */
export function juiceFor({
  perfect = false,
  grainLock = false,
  corePunch = false,
  glancing = false,
  hazardHit = false,
  boss = false,
  partial = false,
  power = 0.75,
} = {}) {
  const hitStop = grainLock ? 0.15 : perfect ? 0.13 : glancing ? 0.055 : 0.08;
  const slowMo = grainLock ? 0.45 : corePunch ? 0.18 : perfect && !partial ? 0.5 : 0;
  const shake =
    (partial ? 0.022 : 0.045) +
    clamp(Number(power) || 0, 0, 1) * 0.07 +
    (perfect ? 0.025 : 0) +
    (hazardHit ? 0.06 : 0) +
    (boss && !partial ? 0.03 : 0);
  return {
    hitStop: Number(hitStop.toFixed(3)),
    slowMo: Number(slowMo.toFixed(3)),
    shake: Number(shake.toFixed(4)),
  };
}
