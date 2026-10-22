// Swing controller.
//
// The swing is a 1-DOF Lagrangian system: every body/axe point position is a function of the
// swing coordinate q (see humanoid.js). With point masses m_k at p_k(q):
//   T = ½ I(q) q̇²,  I(q) = Σ m_k |∂p_k/∂q|²,   V(q) = Σ m_k g y_k(q)
//   d/dt(∂L/∂q̇) − ∂L/∂q = Q   ⇒   q̈ = (Q − V'(q) − ½ I'(q) q̇²) / I(q)
// Q is the generalised muscle force. Muscles follow a Hill force–velocity curve, so a light axe
// reaches a higher head speed but a heavy maul carries more kinetic energy into the wood.
//
// The whole person + axe ("rig") is placed by a transform (translation + yaw about the vertical)
// that is solved so the lowest point of the blade edge lands exactly on the aimed point of the log
// top, with the blade edge along the chosen split direction.
import * as THREE from 'three';
import { axeFrame, axeMatrix, solvePose } from './humanoid.js';
import { EDGE_POINTS, AXE } from './axe.js';
import { clamp, lerp, smoothstep } from './rng.js';

const QMIN = -0.05, QMAX = 1.6, NT = 480;
const G = 9.81;
const HILL_QD = 17; // swing-coordinate speed at which the muscles produce no more force (rad/s)
const HILL_A = 0.3; // Hill curvature constant (a/F0)
const REF_AXE = { headMass: 2.6, handleMass: 0.9 };
const REF_SPEED = 14.6; // reference 2.6 kg head speed at full power, strength 1 (m/s)
const BLOCK_R = 0.31;

const easeInOut = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const UP = new THREE.Vector3(0, 1, 0);

export class SwingController {
  constructor({ humanoid, axe, logs, blockTop, onEvent }) {
    Object.assign(this, { humanoid, axe, logs, blockTop });
    this.onEvent = onEvent ?? (() => {});
    this.onContact = null; // (contact) => outcome, set by the game
    this.state = 'done';
    this.q = 1.2;
    this.qd = 0;
    this.t = 0; // time in the current state
    this.clock = 0;
    this.power = 0.8;
    this.strength = 1;
    this.trail = [];
    this.frame = {};
    this.pose = {};
    this.m4 = new THREE.Matrix4();
    this.rigM = new THREE.Matrix4();
    this.rigQ = new THREE.Quaternion();
    this.rig = { x: 0, z: 0, yaw: 0 };
    this.rigTarget = { x: 0, z: 0, yaw: 0 };
    this.aim = { x: 0, z: 0, yaw: 0 };
    this.deflect = null;
    this._p = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this.pzCache = new Map();
    this.calibrateStance();
    this.setAxe(REF_AXE, true);
    this.Q0max = this.solveQ0(REF_SPEED);
  }

  // ------------------------------------------------------------------ kinematics helpers

  // Lowest blade-edge point (rig-local) for swing coordinate q.
  edgeLowest(q, out = new THREE.Vector3()) {
    const f = axeFrame(q, this.stanceZ, this.frame);
    axeMatrix(f, this.m4);
    let best = Infinity;
    for (const e of EDGE_POINTS) {
      this._p.copy(e).applyMatrix4(this.m4);
      if (this._p.y < best) {
        best = this._p.y;
        out.copy(this._p);
      }
    }
    return out;
  }

  // All edge points in world space.
  edgeWorld(q, out) {
    const f = axeFrame(q, this.stanceZ, this.frame);
    axeMatrix(f, this.m4).premultiply(this.rigM);
    for (let i = 0; i < EDGE_POINTS.length; i++) (out[i] ??= new THREE.Vector3()).copy(EDGE_POINTS[i]).applyMatrix4(this.m4);
    return out;
  }

  // Solve q in [lo, hi] such that the lowest edge point is at height y (edge height decreases with q).
  qForEdgeY(y, lo = 0.35, hi = QMAX - 0.02) {
    const p = this._w;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (this.edgeLowest(mid, p).y > y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Rig-local z of the edge contact point for a log top at height y (cached per mm).
  contactZ(y) {
    const key = Math.round(y * 1000);
    if (!this.pzCache.has(key)) this.pzCache.set(key, this.edgeLowest(this.qForEdgeY(y)).z);
    return this.pzCache.get(key);
  }

  // Mass points (positions) as a function of q. Arms are lumped at shoulder–hand midpoints.
  massPoints(q, pts) {
    const f = axeFrame(q, this.stanceZ, this.frame);
    const O = f.O, h = f.h, b = f.b;
    const set = (i, v) => pts[i].copy(v);
    set(0, O).addScaledVector(h, AXE.headCenter.y).addScaledVector(b, AXE.headCenter.x); // head
    set(1, O).addScaledVector(h, 0.15);
    set(2, O).addScaledVector(h, 0.35);
    set(3, O).addScaledVector(h, 0.55);
    set(4, f.G); // lower hand
    set(5, O).addScaledVector(h, f.upperGrip); // upper hand
    set(6, f.S).add(f.G).multiplyScalar(0.5); // left arm
    set(7, f.S).add(pts[5]).multiplyScalar(0.5); // right arm
    return pts;
  }

  buildTables(axe) {
    const masses = [axe.headMass, axe.handleMass / 3, axe.handleMass / 3, axe.handleMass / 3, 0.6, 0.6, 1.7, 1.7];
    this.masses = masses;
    const n = masses.length;
    const a = Array.from({ length: n }, () => new THREE.Vector3());
    const b = Array.from({ length: n }, () => new THREE.Vector3());
    const c = Array.from({ length: n }, () => new THREE.Vector3());
    this.tI = new Float64Array(NT + 1);
    this.tIaxe = new Float64Array(NT + 1);
    this.tIarms = new Float64Array(NT + 1);
    this.tV = new Float64Array(NT + 1);
    this.tHead = new Float64Array(NT + 1);
    const eps = 1e-4;
    for (let i = 0; i <= NT; i++) {
      const q = QMIN + ((QMAX - QMIN) * i) / NT;
      this.massPoints(q - eps, a);
      this.massPoints(q + eps, b);
      this.massPoints(q, c);
      let I = 0, Ia = 0, V = 0;
      for (let k = 0; k < n; k++) {
        const d2 = b[k].distanceToSquared(a[k]) / (4 * eps * eps);
        I += masses[k] * d2;
        if (k < 4) Ia += masses[k] * d2;
        V += masses[k] * G * c[k].y;
        if (k === 0) this.tHead[i] = Math.sqrt(d2);
      }
      this.tI[i] = I;
      this.tIaxe[i] = Ia;
      this.tIarms[i] = I - Ia;
      this.tV[i] = V;
    }
  }

  lookup(table, q) {
    const x = clamp((q - QMIN) / (QMAX - QMIN), 0, 1) * NT;
    const i = Math.min(NT - 1, Math.floor(x));
    const t = x - i;
    return table[i] * (1 - t) + table[i + 1] * t;
  }

  dlookup(table, q) {
    const h = (QMAX - QMIN) / NT;
    return (this.lookup(table, q + h) - this.lookup(table, q - h)) / (2 * h);
  }

  // Activation profile along the arc (the shoulders/trunk ease off after the release).
  muscle(q) {
    return 1 - 0.3 * smoothstep(0.9, 1.15, q);
  }

  // Effort needed early in the downswing just to rotate the axe forward over the top
  // (counteracts the backward gravity torque while the head is still behind the body).
  holdEffort(q) {
    return Math.max(0, this.dlookup(this.tV, q)) * 1.15;
  }

  hill(qd) {
    const x = Math.max(0, qd) / HILL_QD;
    return Math.max(0, (1 - x) / (1 + x / HILL_A));
  }

  generalizedForce(q, qd) {
    return this.holdEffort(q) + this.Q0 * this.muscle(q) * this.hill(qd);
  }

  // Place the person so the blade lands on the rig origin for a nominal 36 cm log.
  calibrateStance() {
    this.stanceZ = 0;
    const qh = this.qForEdgeY(this.blockTop + 0.36);
    const p = this.edgeLowest(qh);
    this.stanceZ = -p.z;
    this.qHitNominal = qh;
    this.pzCache.clear();
  }

  setAxe(axe, skipEvent = false) {
    this.axeStats = axe;
    this.buildTables(axe);
    if (!skipEvent && this.axe.setType) this.axe.setType(axe);
  }

  // Integrate a free downswing from the top to the nominal impact; returns head speed.
  simulateDown(Q0) {
    const saved = this.Q0;
    this.Q0 = Q0;
    let q = 0, qd = 0;
    const h = 1 / 1500;
    for (let i = 0; i < 6000 && q < this.qHitNominal; i++) {
      const I = this.lookup(this.tI, q);
      const qdd = (this.generalizedForce(q, qd) - this.dlookup(this.tV, q) - 0.5 * this.dlookup(this.tI, q) * qd * qd) / I;
      qd = Math.max(0, qd + qdd * h);
      q += qd * h;
    }
    this.Q0 = saved;
    return { vHead: this.lookup(this.tHead, q) * qd, ...this.energies(q, qd) };
  }

  solveQ0(targetSpeed) {
    let lo = 0, hi = 20000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.simulateDown(mid).vHead < targetSpeed) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  effortFor(power) {
    return this.Q0max * this.strength * (0.04 + 0.96 * Math.pow(clamp(power, 0, 1), 1.25));
  }

  // Predicted impact numbers for a power setting (used by the HUD's energy estimate).
  predict(power) {
    return this.simulateDown(this.effortFor(power));
  }

  // ------------------------------------------------------------------ rig placement

  // Aim: world point on the log top + blade (split line) direction angle.
  setAim(x, z, yaw) {
    this.aim.x = x;
    this.aim.z = z;
    this.aim.yaw = yaw;
    this.solveRigTarget();
  }

  solveRigTarget() {
    const log = this.logs.log;
    const top = log ? this.blockTop + log.params.H : this.blockTop + 0.36;
    const pz = this.contactZ(top);
    const { x, z, yaw } = this.aim;
    // T = A − RotY(yaw)·(0, 0, pz)
    this.rigTarget.x = x - Math.sin(yaw) * pz;
    this.rigTarget.z = z - Math.cos(yaw) * pz;
    this.rigTarget.yaw = yaw;
  }

  updateRigMatrix() {
    this.rigQ.setFromAxisAngle(UP, this.rig.yaw);
    this.rigM.makeRotationY(this.rig.yaw).setPosition(this.rig.x, 0, this.rig.z);
  }

  toWorld(v) {
    return v.applyMatrix4(this.rigM);
  }

  // ------------------------------------------------------------------ public API

  get busy() {
    return !['ready', 'done'].includes(this.state);
  }

  get canSwing() {
    const log = this.logs.log;
    return this.state === 'ready' && log && log.ready;
  }

  // Teleport to the aiming pose over the current log (or resting on the block).
  setReady(teleport = true) {
    const log = this.logs.log;
    this.solveRigTarget();
    Object.assign(this.rig, this.rigTarget);
    this.updateRigMatrix();
    this.q = log ? this.qForEdgeY(this.blockTop + log.params.H + 0.001) : this.qForEdgeY(this.blockTop - 0.01);
    this.qd = 0;
    this.state = log ? 'ready' : 'done';
    this.t = 0;
    this.trail = [];
    this.applyPose(teleport);
  }

  // Lift the axe out of the block and settle on a newly placed log.
  liftToLog() {
    const log = this.logs.log;
    if (!log) return;
    this.solveRigTarget();
    this.liftFrom = this.q;
    this.liftRig = { ...this.rig };
    this.liftTo = this.qForEdgeY(this.blockTop + log.params.H + 0.001);
    this.state = 'lift';
    this.t = 0;
  }

  // power 0..1; error = world-space aim error {x, z} applied to the stance.
  requestSwing({ power = 0.8, error = null } = {}) {
    if (!this.canSwing) return false;
    this.power = clamp(power, 0, 1);
    this.Q0 = this.effortFor(this.power);
    this.solveRigTarget();
    Object.assign(this.rig, this.rigTarget);
    if (error) {
      this.rig.x += error.x;
      this.rig.z += error.z;
    }
    this.updateRigMatrix();
    this.windFrom = this.q;
    this.windDur = 0.32 + 0.42 * clamp(this.q, 0, 1.4);
    this.state = 'windup';
    this.t = 0;
    this.trail = [];
    this.nearImpactSent = false;
    this.contactDone = false;
    this.deflect = null;
    this.onEvent('swingStart', { power: this.power });
    return true;
  }

  // ------------------------------------------------------------------ simulation step

  update(dt) {
    this.t += dt;
    this.clock += dt;
    switch (this.state) {
      case 'ready': {
        // Shuffle the feet toward the aimed stance.
        const k = 1 - Math.exp(-9 * dt);
        this.rig.x += (this.rigTarget.x - this.rig.x) * k;
        this.rig.z += (this.rigTarget.z - this.rig.z) * k;
        let dy = this.rigTarget.yaw - this.rig.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.rig.yaw += dy * k;
        const log = this.logs.log;
        if (log) this.q = this.qForEdgeY(this.blockTop + log.params.H + 0.001, 0.35, QMAX - 0.02);
        this.updateRigMatrix();
        break;
      }
      case 'done':
        break;
      case 'lift': {
        const s = clamp(this.t / 0.45, 0, 1);
        const e = easeInOut(s);
        this.q = lerp(this.liftFrom, this.liftTo, e) - 0.25 * Math.sin(Math.PI * s);
        this.rig.x = lerp(this.liftRig.x, this.rigTarget.x, e);
        this.rig.z = lerp(this.liftRig.z, this.rigTarget.z, e);
        let dy = this.rigTarget.yaw - this.liftRig.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.rig.yaw = this.liftRig.yaw + dy * e;
        this.updateRigMatrix();
        if (s >= 1) { this.state = 'ready'; this.t = 0; this.onEvent('ready', {}); }
        break;
      }
      case 'windup': {
        const s = clamp(this.t / this.windDur, 0, 1);
        this.q = lerp(this.windFrom, 0, easeInOut(s));
        if (s >= 1) {
          this.state = 'top';
          this.t = 0;
        }
        break;
      }
      case 'top':
        if (this.t > 0.12) {
          this.state = 'down';
          this.t = 0;
          this.qd = 0;
          this.onEvent('downswing', { power: this.power });
        }
        break;
      case 'down':
      case 'through':
        this.integrate(dt);
        break;
      case 'embed': {
        const s = clamp(this.t / this.embedDur, 0, 1);
        this.q = lerp(this.embedFrom, this.embedTo, 1 - (1 - s) * (1 - s));
        if (s >= 1) { this.state = 'stuck'; this.t = 0; }
        break;
      }
      case 'rebound': {
        // Steel on steel: the axe bounces back up off the nail.
        const s = clamp(this.t / 0.28, 0, 1);
        this.q = this.embedFrom - 0.32 * Math.sin(Math.PI * 0.5 * s) * (1 - 0.3 * s);
        if (s >= 1) { this.state = 'stuck'; this.t = 0.5; }
        break;
      }
      case 'stuck':
        if (this.t > 0.75) {
          this.state = 'recover';
          this.t = 0;
          this.recoverFrom = this.q;
          const log = this.logs.log;
          this.solveRigTarget();
          this.recoverRig = { ...this.rig };
          this.recoverTo = log ? this.qForEdgeY(this.blockTop + log.params.H + 0.001) : this.q;
          this.onEvent('wrench', {});
        }
        break;
      case 'recover': {
        // Wrench the axe free: small rocking lift, then settle on the log top.
        const s = clamp(this.t / 0.7, 0, 1);
        const e = easeInOut(s);
        const wobble = 0.03 * Math.sin(s * Math.PI * 3) * (1 - s);
        this.q = lerp(this.recoverFrom, this.recoverTo, e) + wobble - 0.12 * Math.sin(Math.PI * s);
        this.rig.x = lerp(this.recoverRig.x, this.rigTarget.x, e);
        this.rig.z = lerp(this.recoverRig.z, this.rigTarget.z, e);
        this.updateRigMatrix();
        if (s >= 1) { this.state = this.logs.log ? 'ready' : 'done'; this.t = 0; this.onEvent('ready', {}); }
        break;
      }
      case 'blockStuck':
        if (this.t > 0.55) { this.state = 'done'; this.t = 0; this.onEvent('swingEnd', {}); if (this.logs.log) this.liftToLog(); }
        break;
    }
    if (this.deflect) {
      const s = clamp(this.deflect.t / 0.12, 0, 1);
      this.deflect.t += dt;
      const e = s - this.deflect.applied;
      this.rig.x += this.deflect.x * e;
      this.rig.z += this.deflect.z * e;
      this.deflect.applied = s;
      this.updateRigMatrix();
      if (s >= 1) this.deflect = null;
    }
    this.applyPose(false);
  }

  // Lowest world height among edge points that are over the log disk (or Infinity).
  _logContact(q, log, pts) {
    this.edgeWorld(q, pts);
    const cx = log.pos.x, cz = log.pos.z, R = log.params.R;
    let best = Infinity, idx = -1, inside = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (Math.hypot(p.x - cx, p.z - cz) <= R) {
        inside++;
        if (p.y < best) { best = p.y; idx = i; }
      }
    }
    return { y: best, idx, coverage: inside / pts.length };
  }

  integrate(dt) {
    const SUB = 12;
    const h = dt / SUB;
    const log = this.state === 'down' && !this.contactDone ? this.logs.log : null;
    const pts = (this._pts ??= []);
    for (let i = 0; i < SUB; i++) {
      const q = this.q, qd = this.qd;
      const I = this.lookup(this.tI, q);
      const dI = this.dlookup(this.tI, q);
      const dV = this.dlookup(this.tV, q);
      const Q = this.generalizedForce(q, qd);
      const qdd = (Q - dV - 0.5 * dI * qd * qd) / I;
      const qdNew = q <= 0 ? Math.max(0, qd + qdd * h) : qd + qdd * h;
      const qNew = Math.min(QMAX - 0.01, q + qdNew * h);
      if (log) {
        const top = this.blockTop + log.params.H;
        const c = this._logContact(qNew, log, pts);
        if (c.y <= top) {
          // Refine the contact instant by bisection.
          let lo = q, hi = qNew;
          for (let k = 0; k < 30; k++) {
            const mid = (lo + hi) / 2;
            if (this._logContact(mid, log, pts).y > top) lo = mid;
            else hi = mid;
          }
          this.q = hi;
          this.qd = qdNew;
          this.logContact(log);
          return;
        }
      }
      // Block (or ground) contact.
      const low = this.edgeLowest(qNew, this._p);
      this.toWorld(low);
      const overBlock = Math.hypot(low.x, low.z) < BLOCK_R;
      if ((overBlock && low.y <= this.blockTop - 0.012) || low.y <= 0.02 || qNew >= QMAX - 0.011) {
        this.q = qNew;
        this.qd = qdNew;
        this.blockImpact(overBlock);
        return;
      }
      this.q = qNew;
      this.qd = qdNew;
      if (!this.nearImpactSent && log && this.state === 'down') {
        const qr = this.qForEdgeY(this.blockTop + log.params.H, 0.35, QMAX - 0.02);
        if (qdNew > 0 && (qr - qNew) / qdNew < 0.05) {
          this.nearImpactSent = true;
          this.onEvent('nearImpact', {});
        }
      }
    }
    const tp = this.edgeLowest(this.q).clone();
    this.trail.push(this.toWorld(tp));
    if (this.trail.length > 400) this.trail.shift();
  }

  energies(q, qd) {
    const Eaxe = 0.5 * this.lookup(this.tIaxe, q) * qd * qd;
    const Earms = 0.5 * this.lookup(this.tIarms, q) * qd * qd;
    return { Eaxe, Earms, Eeff: Eaxe + 0.3 * Earms, vHead: this.lookup(this.tHead, q) * qd };
  }

  edgeDirWorld() {
    const f = axeFrame(this.q, this.stanceZ, this.frame);
    const d = new THREE.Vector3(0, 0, Math.sign(f.h.z) || 1).applyQuaternion(this.rigQ);
    d.y = 0;
    return d.normalize();
  }

  logContact(log) {
    this.contactDone = true;
    const pts = this._pts;
    const c = this._logContact(this.q, log, pts);
    const impact = pts[Math.max(0, c.idx)].clone();
    impact.y = this.blockTop + log.params.H;
    const edgeDir = this.edgeDirWorld();
    const en = this.energies(this.q, this.qd);
    const contact = { impact, edgeDir, coverage: c.coverage, edgePoints: pts.map((p) => p.clone()), ...en, power: this.power, q: this.q, qd: this.qd };
    const out = this.onContact ? this.onContact(contact) : { kind: 'stuck', depth: 0.02 };
    this.lastContact = contact;
    this.lastOutcome = out;
    const top = this.blockTop + log.params.H;
    switch (out.kind) {
      case 'split':
        // Energy spent in fracture; the rest carries the axe through to the block.
        this.qd *= Math.sqrt(clamp(out.remain ?? 0.3, 0.05, 1));
        this.state = 'through';
        this.t = 0;
        break;
      case 'glance': {
        this.qd *= 0.62;
        this.state = 'through';
        this.t = 0;
        const n = new THREE.Vector3(impact.x - log.pos.x, 0, impact.z - log.pos.z).normalize().multiplyScalar(0.07);
        this.deflect = { x: n.x, z: n.z, t: 0, applied: 0 };
        break;
      }
      case 'nail':
        this.embedFrom = this.q;
        this.qd = 0;
        this.state = 'rebound';
        this.t = 0;
        break;
      default: {
        const depth = clamp(out.depth ?? 0.02, 0.004, log.params.H * 0.8);
        this.embedFrom = this.q;
        this.embedTo = this.qForEdgeY(top - depth, this.q - 1e-6, QMAX - 0.02);
        this.embedDur = 0.02 + 0.03 * clamp(out.ratio ?? 0.5, 0, 1);
        this.qd = 0;
        this.state = 'embed';
        this.t = 0;
      }
    }
  }

  blockImpact(overBlock) {
    const impact = this.toWorld(this.edgeLowest(this.q, new THREE.Vector3()));
    const en = this.energies(this.q, this.qd);
    const edgeDir = this.edgeDirWorld();
    this.qd = 0;
    this.state = 'blockStuck';
    this.t = 0;
    this.onEvent('blockHit', { impact, edgeDir, overBlock, missedLog: !this.contactDone, ...en });
  }

  applyPose(teleport) {
    const breathe = (this.state === 'ready' || this.state === 'done') ? 0.012 * Math.sin(this.clock * 1.7) : 0;
    const log = this.logs.log;
    // Look at the aimed point, expressed in rig-local coordinates.
    const la = (this._la ??= new THREE.Vector3());
    const inv = (this._inv ??= new THREE.Matrix4()).copy(this.rigM).invert();
    la.set(this.aim.x, this.blockTop + (log ? log.params.H : 0.05), this.aim.z).applyMatrix4(inv);
    const P = solvePose(this.q, this.stanceZ, { breathe, lookAt: la }, this.pose);
    this.humanoid.group.position.set(this.rig.x, 0, this.rig.z);
    this.humanoid.group.quaternion.copy(this.rigQ);
    this.humanoid.setPose(P);
    this.humanoid.updateColliders(P, teleport, this.rigM);
    this.axe.setMatrix(axeMatrix(P, this.m4).premultiply(this.rigM), teleport);
  }

  headSpeedNow() {
    return this.lookup(this.tHead, this.q) * this.qd;
  }
}
