// Energy/fracture model for American Split.
//
// This replaces the old "every round needs N bites" counter with a physical
// energy balance. A strike delivers joules from the swing model (js/swingmodel.js);
// the round needs a fracture energy set by its size, species, defects and the
// weather. Below the threshold the blade only penetrates and leaves crack work
// behind; above it the round splits and the surplus energy throws the pieces.
//
//   E_req = 300 J * toughness * (D/0.3 m)^1.6 * (H/0.4 m)^0.5
//           * knots * moisture * frost * chord(offset) * checks
//   E_del = (E_axe + 0.3*E_arms) * wedge * sharpness * edgeCoverage + stored work
//   penetration d = 0.5*E_del / F_cut,  F_cut ~= hardness / sharpness
//
// Wood traits are derived from the existing log profile so every special log
// keeps working: knots, twisted/interlocked grain, forked twin piths, rotten or
// hollow cores, ice glaze, embedded nails/stones and seasoning checks. The
// module is DOM-free and deterministic (seeded RNG) so it can be unit-tested.

// Local helpers keep this module DOM- and three-free so the energy maths can be
// unit-tested directly in Node.
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FRACTURE = Object.freeze({
  baseEnergy: 300, // J at toughness 1, 30 cm diameter, 40 cm height
  diameterExp: 1.6,
  heightExp: 0.5,
  minWorkFraction: 0.22, // accumulated work can never make a round free
  differentPlaneCarry: 0.3, // prior crack work carried when the line changes
  wetEnergy: 0.18, // +18 % required in soaked grain
  frozenEnergy: -0.3, // brittle frozen fibres give way earlier
  checkEnergy: 0.72, // following a seasoning check
  knotEnergy: 0.55, // extra energy on top of the base when crossing a knot
  twistEnergy: 1.3,
  forkAcrossEnergy: 2.6,
  forkAlignedEnergy: 1.1,
  rotEnergy: 0.42, // rotten cores are weak
  ringShakeEnergy: 1.14, // a bound loose ring fights the main plane until sprung
  stumpRootEnergy: 1.22, // root-bound butt: the severed root ring is the shortcut
  rootBrokenEnergy: 0.82,
  bossPhase2Energy: 1.18, // Phase II heartwood is denser and more interlocked
  iceBreakEnergy: 230, // J needed to shatter a glaze instead of skating off it
  stringyChance: 0.55, // interlocked/forked fibres can hold even above threshold
  stringyRatio: 1.3,
  hazardSharpLossNail: 0.12,
  hazardSharpLossStone: 0.24,
});

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};

// The split plane is vertical and contains the contact point, running along the
// horizontal blade direction. Its normal is therefore perpendicular to the
// blade in plan view. A default blade along -Z (the game's swing direction)
// reduces to the old x-offset test.
export function splitPlaneNormal(bladeDir = null) {
  const tx = Number(bladeDir?.x) || 0;
  const tz = Number(bladeDir?.z) || 0;
  const len = Math.hypot(tx, tz);
  if (len < 1e-4) return { x: 1, z: 0 };
  return { x: -tz / len, z: tx / len };
}

export function rotate2D(direction, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: (direction?.x || 0) * c - (direction?.z || 0) * s,
    z: (direction?.x || 0) * s + (direction?.z || 0) * c,
  };
}

function pointToLineDistance(point, aim, normal) {
  return Math.abs(normal.x * ((point.x || 0) - (aim.x || 0)) + normal.z * ((point.z || 0) - (aim.z || 0)));
}

export function planeOffsetFor(aim = { x: 0, z: 0 }, pith = { x: 0, z: 0 }, R = 0.18, bladeDir = null) {
  if (!bladeDir) return ((aim.x || 0) - (pith.x || 0)) / Math.max(1e-4, R);
  const normal = splitPlaneNormal(bladeDir);
  return (
    (normal.x * ((pith.x || 0) - (aim.x || 0)) + normal.z * ((pith.z || 0) - (aim.z || 0))) /
    Math.max(1e-4, R)
  );
}

export function woodTraits(log = {}) {
  const density = Number(log.density) || 600;
  return {
    toughness: Number(log.toughness) || 0.65,
    density,
    hardness: clamp(density / 700, 0.45, 1.35),
    twisted: Boolean(log.twisted),
    forked: Boolean(log.twinPith),
    rotted: Boolean(log.hollow),
    ringShake: Boolean(log.ringShake),
    huge: Boolean(log.huge),
    stump: Boolean(log.stump),
    interlocked: Boolean(log.twisted || log.twinPith),
    strikes: Math.max(1, Number(log.strikes) || 1),
  };
}

// Base energy before plane/weather factors. The pacing factor keeps the game's
// existing one-hit rounds (pine, birch) one-hit for a good swing while leaving
// multi-strike rounds to the energy balance.
export function baseRequiredEnergy(log = {}) {
  const traits = woodTraits(log);
  const R = Number(log.radius) || 0.18;
  const H = Number(log.height) || 0.48;
  const D = R * 2;
  const pacing = traits.strikes <= 1 ? 0.82 : 1;
  return (
    FRACTURE.baseEnergy *
    traits.toughness *
    Math.pow(D / 0.3, FRACTURE.diameterExp) *
    Math.pow(H / 0.4, FRACTURE.heightExp) *
    pacing
  );
}

export function knotOnPlane(knots = [], aim = 0, R = 0.18, bladeDir = null) {
  const aimPoint = typeof aim === 'number' ? { x: aim, z: 0 } : aim || { x: 0, z: 0 };
  const normal = splitPlaneNormal(bladeDir);
  let best = null;
  for (const knot of knots) {
    // With a blade direction the knot is crossed when its centre lies close to
    // the vertical split plane, not when its X happens to match the aim.
    const distance = bladeDir
      ? pointToLineDistance(knot, aimPoint, normal)
      : Math.abs((knot.x || 0) - (aimPoint.x || 0));
    const reach = (knot.radius || 0.03) * (bladeDir ? 1.12 : 1) + R * 0.05;
    if (distance <= reach) {
      const severity = clamp(1 - distance / Math.max(1e-4, reach), 0.25, 1);
      if (!best || severity > best.severity) {
        best = { knot, distance, severity };
      }
    }
  }
  return best;
}

export function hazardOnPlane(hazards = [], aim = 0, R = 0.18, bladeDir = null) {
  const aimPoint = typeof aim === 'number' ? { x: aim, z: 0 } : aim || { x: 0, z: 0 };
  const normal = splitPlaneNormal(bladeDir);
  for (const hazard of hazards) {
    const distance = bladeDir
      ? pointToLineDistance(hazard, aimPoint, normal)
      : Math.abs((hazard.x || 0) - (aimPoint.x || 0));
    const reach = (hazard.radius || 0.018) * (bladeDir ? 1.35 : 1) + 0.018;
    if (distance <= reach) {
      return {
        hazard,
        distance,
        type: hazard.type === 'stone' ? 'stone' : 'nail',
      };
    }
  }
  return null;
}

// Direction/plane-dependent required energy. `offset` is the split plane's
// perpendicular distance from the pith, normalised by the radius.
export function requiredEnergy({
  log = {},
  aim = { x: 0, z: 0 },
  piths = [{ x: 0, z: 0 }],
  knots = [],
  conditions = {},
  grain = 0.7,
  riving = false,
  offset = 0,
  strikes = null,
  bladeDir = null,
  rootBroken = false,
  bossPhase = 1,
} = {}) {
  const traits = woodTraits(log);
  const R = Number(log.radius) || 0.18;
  const H = Number(log.height) || 0.48;
  const D = R * 2;
  const factors = {};
  let energy =
    FRACTURE.baseEnergy *
    traits.toughness *
    Math.pow(D / 0.3, FRACTURE.diameterExp) *
    Math.pow(H / 0.4, FRACTURE.heightExp);
  if ((strikes ?? traits.strikes) <= 1) energy *= 0.82;

  if (traits.twisted) {
    energy *= FRACTURE.twistEnergy;
    factors.twisted = FRACTURE.twistEnergy;
  }

  if (traits.ringShake) {
    energy *= FRACTURE.ringShakeEnergy;
    factors.ringShake = FRACTURE.ringShakeEnergy;
  }

  if (traits.stump) {
    const rootFactor = rootBroken ? FRACTURE.rootBrokenEnergy : FRACTURE.stumpRootEnergy;
    energy *= rootFactor;
    factors.stumpRoots = rootFactor;
  }

  if (Number(bossPhase) >= 2) {
    energy *= FRACTURE.bossPhase2Energy;
    factors.bossPhase = FRACTURE.bossPhase2Energy;
  }

  const knot = knotOnPlane(knots, aim, R, bladeDir);
  if (knot) {
    const mult = 1 + FRACTURE.knotEnergy * knot.severity;
    energy *= mult;
    factors.knot = mult;
  }

  if (traits.forked) {
    const pithX = piths.reduce((sum, p) => sum + (p.x || 0), 0) / Math.max(1, piths.length);
    const aligned = Math.abs(aim.x - pithX) < R * 0.25;
    const mult = aligned ? FRACTURE.forkAlignedEnergy : FRACTURE.forkAcrossEnergy;
    energy *= mult;
    factors.fork = mult;
    factors.forkAligned = aligned;
  }

  if (traits.rotted) {
    energy *= 1 - FRACTURE.rotEnergy;
    factors.rot = 1 - FRACTURE.rotEnergy;
  }

  const wet = clamp(conditions.wet ?? 0, 0, 1);
  const frozen = clamp(conditions.frozen ?? 0, 0, 1);
  energy *= 1 + FRACTURE.wetEnergy * wet;
  energy *= Math.max(0.55, 1 + FRACTURE.frozenEnergy * frozen);
  if (wet > 0.02) factors.wet = 1 + FRACTURE.wetEnergy * wet;
  if (frozen > 0.02) factors.frozen = Math.max(0.55, 1 + FRACTURE.frozenEnergy * frozen);

  // An off-centre split has less fracture area: chord(offset).
  const eN = clamp(offset, -0.98, 0.98);
  const chord = 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - eN * eN));
  energy *= chord;
  factors.chord = chord;

  // Following a seasoning check or a natural grain seam.
  if (riving) {
    energy *= FRACTURE.checkEnergy;
    factors.check = FRACTURE.checkEnergy;
  } else if (grain > 0.55) {
    const mult = 1 - 0.12 * ((grain - 0.55) / 0.45);
    energy *= mult;
    factors.grain = mult;
  }

  return {
    total: Math.max(40, energy),
    factors,
    knot,
    traits,
    chord,
    wet,
    frozen,
  };
}

function planeOffset(aim, pith, R, bladeDir = null) {
  return planeOffsetFor(aim, pith, R, bladeDir);
}

export class FractureState {
  constructor() {
    this.round = null;
    this.reset();
  }

  reset() {
    this.work = 0;
    this.workPlane = null;
    this.workNormal = null;
    this.planeOffset = 0;
    this.deliveredTotal = 0;
    this.lastDelivered = 0;
    this.lastRequired = 0;
    this.required = 0;
    this.lastOutcome = 'ready';
    this.lastRatio = 0;
    this.lastEnergyGain = 0;
    this.penetration = 0;
    this.crackDepth = 0;
    this.glanceRisk = 0;
    this.iceShell = false;
    this.iceBroken = false;
    this.hazard = null;
    this.knot = null;
    this.lastSwing = null;
    this.lastSharpLoss = 0;
    this.stringy = false;
    this.lastBladeDir = null;
    this.lastTwistAngle = 0;
    this.lastFactors = null;
    this.rootBroken = false;
    this.bossPhase = 1;
    this.seed = 1;
    this.random = mulberry32(1);
    this.strikes = 1;
    this.conditions = { wet: 0, frozen: 0, icy: 0 };
    this.required = 0;
  }

  setRound({ log, knots = [], hazards = [], conditions = {}, seed = 1, strikes = null, piths = null } = {}) {
    this.reset();
    this.log = log || {};
    this.knots = knots || [];
    this.hazards = hazards || [];
    this.conditions = { wet: 0, frozen: 0, icy: 0, ...conditions };
    this.iceShell = Boolean(this.conditions.icy > 0.45 || this.conditions.iceShell);
    this.strikes = Math.max(1, Number(strikes) || Number(this.log.strikes) || 1);
    this.seed = seed >>> 0 || 1;
    this.random = mulberry32(this.seed * 2654435761 + 17);
    const generatedPiths = this.log.twinPith
      ? [
          { x: -Math.abs(this.log.radius || 0.18) * 0.16, z: 0 },
          { x: Math.abs(this.log.radius || 0.18) * 0.16, z: 0 },
        ]
      : [{ x: 0, z: 0 }];
    this.piths = Array.isArray(piths) && piths.length
      ? piths.map((pith) => ({ x: Number(pith.x) || 0, z: Number(pith.z) || 0 }))
      : generatedPiths;
    const setup = requiredEnergy({
      log: this.log,
      aim: { x: this.piths[0].x, z: this.piths[0].z },
      piths: this.piths,
      knots: this.knots,
      conditions: this.conditions,
      strikes: this.strikes,
      rootBroken: this.rootBroken,
    });
    this.required = setup.total;
    this.lastFactors = setup.factors;
    return this.snapshot();
  }

  setConditions(conditions = {}, meta = {}) {
    this.conditions = { ...this.conditions, ...conditions };
    this.bossPhase = Number(meta.bossPhase) || this.bossPhase || 1;
    // A shattered glaze stays off for the rest of the round even while the
    // surface sampler still reports snow on the log.
    this.iceShell = Boolean(
      !this.iceBroken && (this.conditions.icy > 0.45 || this.conditions.iceShell),
    );
    // Keep the displayed requirement in step with the live surface (rain can
    // soak the round and frost can leave it while it is still on the block).
    if (this.log) {
      const pith = this.piths?.[0] || { x: 0, z: 0 };
      const setup = requiredEnergy({
        log: this.log,
        aim: { x: pith.x, z: pith.z },
        piths: this.piths,
        knots: this.knots,
        conditions: this.conditions,
        strikes: this.strikes,
        rootBroken: this.rootBroken,
        bossPhase: this.bossPhase,
      });
      this.required = setup.total;
      this.lastFactors = setup.factors;
    }
  }

  preview(aim = { x: 0, z: 0 }, extra = {}) {
    if (!this.log) return null;
    const pith = this.piths?.[0] || { x: 0, z: 0 };
    const R = Number(this.log.radius) || 0.18;
    return requiredEnergy({
      log: this.log,
      aim,
      piths: this.piths,
      knots: this.knots,
      conditions: this.conditions,
      offset: planeOffset(aim, pith, R, extra.bladeDir),
      grain: extra.grain ?? 0.7,
      riving: Boolean(extra.riving),
      strikes: this.strikes,
      bladeDir: extra.bladeDir,
      rootBroken: extra.rootBroken ?? this.rootBroken,
      bossPhase: extra.bossPhase ?? 1,
    });
  }

  /**
   * Resolve one blade contact.
   *
   * @returns {object} outcome, energy balance, penetration and the number of
   *   "bite-equivalent" units to hand back to the legacy strike registrar.
   */
  resolve({
    aim = { x: 0, z: 0 },
    delivered = 0,
    sharpness = 1,
    wedge = 1,
    coverage = 1,
    grain = 0.7,
    riving = false,
    weakHit = false,
    hollowHit = false,
    wedgeStored = 0,
    swing = null,
    forceClean = false,
    commit = true,
    bossPhase = 1,
    bladeDir = null,
    rootBroken = null,
    // When the caller already resolved a local hazard contact, trust it. The
    // fallback plane test is for standalone/unit use.
    hazardContact,
  } = {}) {
    if (!this.log) {
      return {
        outcome: 'stuck',
        delivered: 0,
        required: 0,
        remaining: 0,
        ratio: 0,
        energyGain: 0.1,
        penetration: 0.01,
        crackDepth: 0.02,
        work: 0,
      };
    }
    const R = Number(this.log.radius) || 0.18;
    const H = Number(this.log.height) || 0.48;
    const pith = this.piths?.[0] || { x: 0, z: 0 };
    const traits = woodTraits(this.log);
    if (rootBroken != null) this.rootBroken = Boolean(rootBroken);
    this.bossPhase = Number(bossPhase) || 1;
    // Interlocked/twisted grain rotates the split plane as the crack deepens.
    // The strike still lands on `aim`, but the plane that would open at this
    // depth is turned a few degrees, so a line that worked at the surface can
    // wander deeper in.
    let localBladeDir = bladeDir;
    let twistAngle = 0;
    if (traits.twisted && bladeDir) {
      twistAngle = 0.11 * Math.sin((this.work * 1.35 + 0.12) * Math.PI * 2);
      localBladeDir = rotate2D(bladeDir, twistAngle);
    }
    // Track the geometric plane separately from the twisted effective offset:
    // spiral grain wanders with depth but a second blow on the same contact is
    // still working the same crack. Direction jitter from the animation frame
    // must not reset the ledger, so the tolerance is a little generous.
    const rawOffset = planeOffset(aim, pith, R, bladeDir);
    const offset = planeOffset(aim, pith, R, localBladeDir);
    const rawNormal = splitPlaneNormal(bladeDir);
    const rN = Math.hypot((aim.x || 0) - (pith.x || 0), (aim.z || 0) - (pith.z || 0)) / R;
    const knotHit = knotOnPlane(this.knots, aim, R, localBladeDir);
    const hazard =
      hazardContact === undefined ? hazardOnPlane(this.hazards, aim, R, localBladeDir) : hazardContact;
    const req = requiredEnergy({
      log: this.log,
      aim,
      piths: this.piths,
      knots: this.knots,
      conditions: this.conditions,
      offset,
      grain,
      riving,
      strikes: this.strikes,
      bladeDir: localBladeDir,
      rootBroken: this.rootBroken,
      bossPhase,
    });
    const requiredTotal = req.total;
    this.required = requiredTotal;
    this.lastFactors = req.factors;
    this.lastBladeDir = localBladeDir ? { ...localBladeDir } : null;
    this.lastTwistAngle = twistAngle;

    const samePlane =
      this.workPlane != null &&
      Math.abs(rawOffset - this.planeOffset) < 0.2 &&
      (!this.workNormal ||
        rawNormal.x * this.workNormal.x + rawNormal.z * this.workNormal.z > 0.985);
    const prior = this.work * (samePlane ? 1 : FRACTURE.differentPlaneCarry);
    // A seasoning check / weak seam / punky core lowers the total work needed.
    let special = 1;
    if (riving) special *= FRACTURE.checkEnergy;
    if (weakHit) special *= 0.55;
    if (hollowHit) special *= 0.5;
    const requiredRemaining = Math.max(
      requiredTotal * FRACTURE.minWorkFraction,
      requiredTotal * special - prior * requiredTotal,
    );

    const wedgeJ = Math.max(0, Number(wedgeStored) || 0);
    const eff =
      clamp(wedge, 0.5, 1.6) *
      (0.72 + 0.28 * clamp(sharpness, 0.25, 2)) *
      (0.6 + 0.4 * clamp(coverage, 0.2, 1));
    const deliveredEff = Math.max(0, delivered) * eff + wedgeJ;
    const ratio = deliveredEff / Math.max(1, requiredRemaining);

    // Glancing: bark edge, wet/icy bark, a knot face or a light edge-on blow.
    const wet = this.conditions.wet || 0;
    const icy = this.conditions.icy || 0;
    let pGlance = smoothstep(
      0.82 - 0.1 * wet - 0.12 * icy + 0.06 * (clamp(sharpness, 0, 2) - 0.8),
      1.04,
      rN,
    );
    if (coverage < 0.4) pGlance += 0.3;
    if (knotHit) pGlance += 0.18 * knotHit.severity;
    if (wet > 0.2) pGlance += 0.05 * wet;
    if (this.iceShell) {
      // A heavy blow punches through the glaze; a light one skates off.
      const heavy = deliveredEff >= FRACTURE.iceBreakEnergy;
      pGlance += (heavy ? 0.12 : 0.45) * clamp(1.25 - deliveredEff / 300, 0, 1);
      if (heavy) pGlance *= 0.5;
    }
    if (traits.rotted && Math.abs(offset) < 0.6) pGlance *= 0.35;
    pGlance = clamp(pGlance, 0, 0.96);
    const glanced = !forceClean && this.random() < pGlance;
    // A solid strike shatters the ice shell for the rest of the round. The
    // surface sampler can keep reporting snow; FractureState remembers.
    const brokeIce =
      this.iceShell && !glanced && deliveredEff >= FRACTURE.iceBreakEnergy;
    if (brokeIce) {
      this.iceBroken = true;
      this.iceShell = false;
    }
    this.stringy = false;

    // Embedded steel or stone always wins: no split, rolled edge, sparks.
    if (hazard) {
      const sharpLoss =
        hazard.type === 'stone'
          ? FRACTURE.hazardSharpLossStone
          : FRACTURE.hazardSharpLossNail;
      this.lastOutcome = hazard.type === 'stone' ? 'stone' : 'nail';
      this.hazard = hazard;
      this.lastDelivered = deliveredEff;
      this.lastRequired = requiredRemaining;
      this.lastRatio = 0;
      this.lastEnergyGain = 0.1;
      this.lastSharpLoss = sharpLoss;
      this.stringy = false;
      this.penetration = 0.004;
      this.crackDepth = 0.01;
      this.glanceRisk = pGlance;
      this.workPlane = rawOffset;
      this.planeOffset = rawOffset;
      this.workNormal = rawNormal;
      this.lastSwing = swing;
      return {
        outcome: this.lastOutcome,
        delivered: deliveredEff,
        required: requiredTotal,
        remaining: requiredRemaining,
        ratio: 0,
        energyGain: 0.1,
        penetration: 0.004,
        crackDepth: 0.01,
        sharpLoss,
        hazard,
        work: this.work,
        glanceRisk: pGlance,
        traits: traits,
        rootBroken: this.rootBroken,
        factors: req.factors,
      };
    }

    // A blade that skates off does no fracture work; a heavy blow may knock a
    // chunk out of an ice glaze and expose the wood underneath.
    if (glanced) {
      this.lastOutcome = 'glance';
      this.lastDelivered = deliveredEff;
      this.lastRequired = requiredRemaining;
      this.lastRatio = ratio;
      this.lastEnergyGain = 0.12;
      this.lastSharpLoss = 0;
      this.penetration = 0.004;
      this.crackDepth = 0.008;
      this.glanceRisk = pGlance;
      this.hazard = null;
      this.knot = knotHit?.knot || null;
      this.workPlane = rawOffset;
      this.planeOffset = rawOffset;
      this.workNormal = rawNormal;
      this.lastSwing = swing;
      return {
        outcome: 'glance',
        delivered: deliveredEff,
        required: requiredTotal,
        remaining: requiredRemaining,
        ratio,
        energyGain: 0.12,
        penetration: 0.004,
        crackDepth: 0.008,
        knot: knotHit?.knot || null,
        work: this.work,
        glanceRisk: pGlance,
        traits,
        factors: req.factors,
        iceBroken: false,
        stringy: false,
        rootBroken: this.rootBroken,
      };
    }

    // Cutting resistance: hard, dense wood and a blunt edge resist penetration.
    const frozen = this.conditions.frozen || 0;
    const fCut =
      9000 *
      traits.hardness *
      (1.5 - 0.7 * clamp(sharpness, 0.2, 1.8)) *
      Math.pow(clamp(wedge, 0.6, 1.5), 0.6) *
      (1 + 0.35 * frozen) *
      (1 - 0.5 * (traits.rotted ? 0.6 : 0));
    const penetration = clamp((0.5 * deliveredEff) / fCut, 0.004, H * 0.75);

    const workAdd = deliveredEff / requiredTotal;
    const nextWork = clamp(prior + workAdd, 0, 1);
    // Interlocked elm or a crossed fork can still hold above the energy
    // threshold: the fibres stretch and the bit sticks instead of opening a
    // clean split. Enough surplus energy eventually tears it free.
    const stringy =
      !forceClean &&
      this.work < 0.99 &&
      (traits.interlocked || traits.forked) &&
      ratio >= 1 &&
      ratio < FRACTURE.stringyRatio &&
      this.random() < FRACTURE.stringyChance;
    this.stringy = stringy;
    // Cumulative crack work must be able to finish the round. (The old clamp
    // at 0.995 made the 0.999 test unreachable for very tough rounds.)
    const split = !stringy && (nextWork >= 0.999 || ratio >= 1);
    const crackDepth = Math.min(H * 0.9, penetration + 0.08 * Math.min(ratio, 1.3) * (H / 0.35));
    const energyGain = split
      ? this.strikes
      : Math.max(0.08, Math.min(this.strikes, workAdd * this.strikes));

    if (!commit) {
      // A wedge, ring arc or root notch spends the blow on a secondary target;
      // it should not silently advance the main split-plane crack work.
      this.lastDelivered = deliveredEff;
      this.lastRequired = requiredRemaining;
      this.lastRatio = ratio;
      this.lastSharpLoss = 0;
      this.penetration = penetration;
      this.crackDepth = crackDepth;
      this.glanceRisk = pGlance;
      this.lastSwing = swing;
      return {
        outcome: 'stuck',
        delivered: deliveredEff,
        required: requiredTotal,
        remaining: requiredRemaining,
        ratio,
        energyGain: 0,
        penetration,
        crackDepth,
        work: this.work,
        workAdd: 0,
        glanceRisk: pGlance,
        traits,
        factors: req.factors,
        chord: req.chord,
        samePlane,
        iceBroken: brokeIce,
        stringy,
        rootBroken: this.rootBroken,
      };
    }

    this.work = split ? 1 : Math.min(nextWork, 0.995);
    this.workPlane = rawOffset;
    this.planeOffset = rawOffset;
    this.workNormal = rawNormal;
    this.deliveredTotal += deliveredEff;
    this.lastDelivered = deliveredEff;
    this.lastRequired = requiredRemaining;
    this.lastRatio = ratio;
    this.lastEnergyGain = energyGain;
    this.lastSharpLoss = 0;
    this.penetration = penetration;
    this.crackDepth = crackDepth;
    this.glanceRisk = pGlance;
    this.hazard = null;
    this.knot = knotHit?.knot || null;
    this.lastOutcome = split ? 'split' : 'stuck';
    this.lastSwing = swing;
    if (split) this.work = 1;

    return {
      outcome: this.lastOutcome,
      delivered: deliveredEff,
      required: requiredTotal,
      remaining: requiredRemaining,
      ratio,
      energyGain,
      penetration,
      crackDepth,
      crackOpen: 0.0015 + 0.005 * Math.min(ratio, 1.2),
      knot: knotHit?.knot || null,
      knotSeverity: knotHit?.severity || 0,
      forkAligned: req.factors.forkAligned ?? null,
      riving,
      work: this.work,
      workAdd,
      glanceRisk: pGlance,
      traits,
      factors: req.factors,
      chord: req.chord,
      samePlane,
      iceBroken: brokeIce,
      stringy,
      rootBroken: this.rootBroken,
      bladeDir: localBladeDir ? { ...localBladeDir } : null,
      twistAngle: Number(twistAngle.toFixed(3)),
    };
  }

  snapshot() {
    if (!this.log) {
      return {
        required: 0,
        remaining: 0,
        work: 0,
        delivered: 0,
        deliveredTotal: 0,
        outcome: 'ready',
        ratio: 0,
        penetration: 0,
        crackDepth: 0,
        glanceRisk: 0,
        traits: null,
        conditions: { ...this.conditions },
      };
    }
    return {
      required: Number(this.required.toFixed(1)),
      remaining: Number((this.required * (1 - this.work)).toFixed(1)),
      work: Number(this.work.toFixed(4)),
      delivered: Number(this.lastDelivered.toFixed(1)),
      deliveredTotal: Number(this.deliveredTotal.toFixed(1)),
      outcome: this.lastOutcome,
      ratio: Number(this.lastRatio.toFixed(3)),
      energyGain: Number(this.lastEnergyGain.toFixed(3)),
      penetration: Number(this.penetration.toFixed(4)),
      crackDepth: Number(this.crackDepth.toFixed(4)),
      glanceRisk: Number(this.glanceRisk.toFixed(3)),
      knot: this.knot ? { x: Number(this.knot.x.toFixed(3)), z: Number(this.knot.z.toFixed(3)) } : null,
      hazard: this.hazard ? this.hazard.type : null,
      traits: woodTraits(this.log),
      conditions: { ...this.conditions },
      swing: this.lastSwing,
      iceShell: Boolean(this.iceShell),
      iceBroken: Boolean(this.iceBroken),
      stringy: Boolean(this.stringy),
      sharpLoss: Number(this.lastSharpLoss.toFixed(3)),
      rootBroken: Boolean(this.rootBroken),
      bossPhase: Number(this.bossPhase || 1),
      bladeDir: this.lastBladeDir ? { ...this.lastBladeDir } : null,
      twistAngle: Number(this.lastTwistAngle.toFixed(3)),
      factors: this.lastFactors || null,
      split: this.work >= 1,
    };
  }
}
