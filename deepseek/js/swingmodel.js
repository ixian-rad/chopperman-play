// Swing model: a compact 1-DOF Lagrangian swing with a Hill force–velocity
// muscle curve. Every axe point is treated as a point mass on a rigid arc
// about the shoulder: I = sum(m_k r_k^2). The downswing integrates
//
//   qdd = (Q_muscle(q, qd) + Q_gravity(q) - c*qd) / I
//   Q_muscle = Q0 * effort * muscle(q) * hill(qd)
//   hill(qd) = max(0, (1 - qd/wMax) / (1 + qd/(a*wMax)))
//
// A light head accelerates to a higher speed; a heavy maul carries more
// kinetic energy into the round. This module is deliberately DOM-free so the
// numbers can be unit-tested in Node and reused by the HUD estimate.

const G = 9.81;
const TWO_PI = Math.PI * 2;

export const SWING_CONSTANTS = Object.freeze({
  armInertia: 1.35, // kg m^2: trunk + both arms, about the shoulder
  armShare: 0.3, // share of arm work that reaches the head at impact
  headRadius: 0.92, // m, shoulder to head centre
  handleRadius: 0.48, // m, shoulder to handle centre of mass
  handleInertiaShare: 0.33,
  q0: 780, // N m peak muscle torque at full effort
  omegaMax: 26, // rad/s, Hill zero-force velocity
  hillA: 0.3, // Hill curvature
  friction: 0.35, // N m s/rad, shoulder damping
  startAngle: 2.4, // rad from the bottom of the arc
  minAngle: 0,
  maxTime: 1.4,
  step: 1 / 900,
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};

// Convert the game's abstract axe weight to a real head mass in kg.
export function headMassFor(weight = 1) {
  return clamp(2.05 * weight, 1.2, 6.2);
}

export function handleMassFor(headMass = 2) {
  return clamp(0.42 + headMass * 0.2, 0.55, 1.5);
}

// Hill force–velocity factor, 0 at qd >= wMax, ~1 at rest.
export function hillFactor(qd = 0) {
  const c = SWING_CONSTANTS;
  const x = Math.max(0, qd) / c.omegaMax;
  return Math.max(0, (1 - x) / (1 + x / c.hillA));
}

// Predicted delivered energy for a swing input. `timing` is the meter result:
// a well-timed stop recruits the trunk and arms instead of just the shoulders.
export function simulateSwing({
  power = 0.8,
  timing = 0.75,
  strength = 1,
  headMass = 2.05,
  handleMass = 0.82,
  startAngle = SWING_CONSTANTS.startAngle,
} = {}) {
  const c = SWING_CONSTANTS;
  const effort = clamp(
    (0.07 + 0.93 * Math.pow(clamp(power, 0, 1), 1.18)) *
      (0.86 + 0.14 * clamp(timing, 0, 1)) *
      clamp(strength, 0.5, 2.2),
    0,
    1.45,
  );
  const rHead = c.headRadius;
  const headI = headMass * rHead * rHead + handleMass * c.handleRadius * c.handleRadius * c.handleInertiaShare;
  const inertia = c.armInertia + headI;
  const gravityLoad = (headMass + handleMass * 0.5) * G * rHead * 0.92;
  let theta = clamp(startAngle, 0.5, TWO_PI * 0.49);
  let omega = 0;
  let t = 0;
  // Activation eases off as the blade turns over through the bottom.
  const muscle = (q) => 1 - 0.22 * smoothstep(0.05, 0.6, 1.55 - q);
  while (theta > c.minAngle && t < c.maxTime) {
    const hill = hillFactor(omega);
    const gravity = gravityLoad * Math.sin(theta);
    const torque = c.q0 * effort * muscle(theta) * hill + gravity - c.friction * omega;
    omega = Math.max(0, omega + (torque / inertia) * c.step);
    theta -= omega * c.step;
    t += c.step;
  }
  const vHead = omega * rHead;
  const eHead = 0.5 * headI * omega * omega;
  const eArms = 0.5 * c.armInertia * omega * omega;
  const eEffective = eHead + c.armShare * eArms;
  return {
    effort,
    omega: Number(omega.toFixed(3)),
    vHead: Number(vHead.toFixed(3)),
    headMass: Number(headMass.toFixed(3)),
    inertia: Number(inertia.toFixed(3)),
    eHead: Number(eHead.toFixed(1)),
    eArms: Number(eArms.toFixed(1)),
    eEffective: Number(eEffective.toFixed(1)),
    duration: Number(t.toFixed(3)),
  };
}

// Cheap estimate used by the HUD (same model, fewer samples).
export function predictSwing(opts = {}) {
  const saved = SWING_CONSTANTS.step;
  try {
    // Constants are frozen; re-run the same integrator at a coarser step by
    // temporarily replacing the step in the local loop is overkill. The full
    // integration is ~1.4k steps and only runs on a meter tick.
    void saved;
    return simulateSwing(opts);
  } catch {
    return simulateSwing(opts);
  }
}

export function energyText(joules) {
  const j = Math.max(0, Number(joules) || 0);
  return `${Math.round(j)} J`;
}

export { clamp, smoothstep };
