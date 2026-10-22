// Impact resolution: decides what a blade contact does to a round, from the delivered energy,
// where and how the edge landed, the wood's defects and the weather.
//
//  * Edge contact point p and blade direction t are taken into log-local coordinates; the split
//    plane is the vertical plane through p along t (offset e from the pith).
//  * Required energy  E_req = base · knots · moisture · frost · chord · checks − prior crack work
//      base   = 300 J · toughness · (D/0.3 m)^1.6 · (H/0.4 m)^0.5
//      chord  = 0.55 + 0.45·√(1 − (e/R)²)  (an off-centre slab has less fracture area)
//      checks = 0.72 when the blade follows an existing radial seasoning check
//  * Delivered energy E = (E_axe + 0.3·E_arms) · wedge · (0.72 + 0.28·sharpness) · edge coverage
//  * Below the threshold the edge only penetrates: depth = ½E / F_cut, F_cut ∝ hardness / sharpness.
//  * Near the rounded bark edge, on a knot face, or on icy / wet bark the blade can glance off.
import { clamp, smoothstep } from './rng.js';

function segDist2D(ax, az, bx, bz, cx, cz, dx, dz) {
  // Distance between segments AB and CD in the plane.
  const cross = (ux, uz, vx, vz) => ux * vz - uz * vx;
  const d1 = cross(bx - ax, bz - az, cx - ax, cz - az), d2 = cross(bx - ax, bz - az, dx - ax, dz - az);
  const d3 = cross(dx - cx, dz - cz, ax - cx, az - cz), d4 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  const pt = (px, pz, sx, sz, ex, ez) => {
    const vx = ex - sx, vz = ez - sz;
    const l2 = vx * vx + vz * vz || 1e-9;
    const t = clamp(((px - sx) * vx + (pz - sz) * vz) / l2, 0, 1);
    return Math.hypot(px - (sx + vx * t), pz - (sz + vz * t));
  };
  return Math.min(pt(ax, az, cx, cz, dx, dz), pt(bx, bz, cx, cz, dx, dz), pt(cx, cz, ax, az, bx, bz), pt(dx, dz, ax, az, bx, bz));
}

const angMod = (a, m) => ((a % m) + m) % m;

// The weather's conditions as felt by this particular round: a waterlogged round is wet on a
// sunny day, an ice-glazed one is frozen through and icy until the glaze is knocked off.
export function logConditions(cond, P, iceShell = false) {
  const c = { ...cond };
  if (P.soaked) c.wet = Math.max(c.wet ?? 0, 0.9);
  if (P.iced) {
    c.frozen = Math.max(c.frozen ?? 0, 1);
    if (iceShell) c.icy = Math.max(c.icy ?? 0, 0.9);
  }
  return c;
}

// Direction-dependent factors for a vertical split plane with log-local blade direction t and
// offset eN (fraction of R) from the pith: knots crossed, seasoning checks followed, Y-crotch.
export function planeFactors(P, t, eN) {
  const R = P.R;
  const n = { x: -t.z, z: t.x };
  const e = eN * R;
  let knotHit = null;
  for (const k of P.knots) {
    const ux = Math.cos(k.th), uz = Math.sin(k.th);
    const s0 = 0.15 * R, s1 = (k.r + k.size) * R;
    const d0 = (n.x * ux + n.z * uz) * s0 - e, d1 = (n.x * ux + n.z * uz) * s1 - e;
    const dist = (d0 > 0) !== (d1 > 0) ? 0 : Math.min(Math.abs(d0), Math.abs(d1));
    if (dist < k.size * R && (!knotHit || k.severity > knotHit.severity)) knotHit = k;
  }
  let alongCheck = false;
  const ca = Math.atan2(t.z, t.x);
  for (const c of P.checks) {
    const d = Math.abs(angMod(ca - c.th + Math.PI / 2, Math.PI) - Math.PI / 2);
    if (d < 0.22 && Math.abs(eN) < 0.22) alongCheck = true;
  }
  // A crotch only opens along the plane that contains both stems (blade along the branch,
  // through the pith). Across it, the interwoven fibres of the fork need up to 2.6× the energy.
  let fork = 1, forkAligned = false;
  if (P.fork) {
    const cosA = Math.abs(n.x * Math.cos(P.fork.th) + n.z * Math.sin(P.fork.th));
    forkAligned = cosA < 0.26 && Math.abs(eN) < 0.25;
    fork = forkAligned ? 1.1 : 1.55 + 1.05 * cosA + 0.6 * Math.max(0, Math.abs(eN) - 0.25);
  }
  return { knotHit, knot: knotHit ? knotHit.severity : 1, alongCheck, check: alongCheck ? 0.72 : 1, fork, forkAligned };
}

function hazardHit(p, t, P, R, half) {
  // Radial hazard lines (nail, stone) vs. the blade edge segment in the top plane.
  const hz = [];
  if (P.nail) hz.push({ type: 'nail', th: P.nail.th, len: P.nail.len, tol: 0.01 });
  if (P.rock) hz.push({ type: 'rock', th: P.rock.th, len: P.rock.depth, tol: 0.012 + P.rock.size * 0.6 });
  for (const h of hz) {
    const u = { x: Math.cos(h.th), z: Math.sin(h.th) };
    const r0 = R * 1.02, r1 = R * (1 - h.len);
    const d = segDist2D(p.x - t.x * half, p.z - t.z * half, p.x + t.x * half, p.z + t.z * half, u.x * r0, u.z * r0, u.x * r1, u.z * r1);
    if (d < h.tol) return { ...h, u, r0, r1 };
  }
  return null;
}

export function resolveImpact({ logs, contact, axe, sharpness, cond: weatherCond, slip, rng }) {
  const log = logs.log;
  const P = log.params;
  const cond = logConditions(weatherCond, P, !!log.iceShell);
  const R = P.R;
  const p = logs.toLocal(contact.impact);
  const t = logs.toLocalDir(contact.edgeDir);
  const n = { x: -t.z, z: t.x };
  const e = n.x * p.x + n.z * p.z; // perpendicular offset of the split plane from the pith
  const a = t.x * p.x + t.z * p.z; // contact position along the blade line
  const rN = Math.hypot(p.x, p.z) / R;
  const out = {
    offset: e / R, along: a / R, rN, coverage: contact.coverage, vHead: contact.vHead,
    Ein: contact.Eeff, knotHit: null, knotDodged: false, alongCheck: false, slip,
  };

  out.iceShell = !!log.iceShell;

  // ---------------------------------------------------------------- hidden nail / grown-in stone
  const hz = hazardHit(p, t, P, R, 0.055);
  if (hz) {
    out.kind = 'nail';
    out.hazard = hz.type;
    // A stone is far worse for the edge than a soft fence nail.
    out.sharpLoss = hz.type === 'rock' ? 0.2 + 0.14 * clamp(contact.Eeff / 300, 0, 1) : 0.12 + 0.1 * clamp(contact.Eeff / 300, 0, 1);
    const s = clamp(p.x * hz.u.x + p.z * hz.u.z, hz.r1, R);
    out.nailPoint = logs.toWorld(hz.u.x * s, hz.u.z * s);
    out.nailPoint.y = contact.impact.y;
    out.Esplit = 0;
    out.Ereq = P.req;
    out.ratio = 0;
    return out;
  }

  // ---------------------------------------------------------------- knots / checks / fork
  const onKnotFace = P.knots.find((k) => Math.hypot(p.x - Math.cos(k.th) * k.r * R, p.z - Math.sin(k.th) * k.r * R) < k.size * R * 1.1);
  const pf = planeFactors(P, t, out.offset);
  out.knotHit = pf.knotHit;
  out.alongCheck = pf.alongCheck;
  out.forkAligned = pf.forkAligned;
  out.forked = !!P.fork;
  out.knotDodged = P.knots.length > 0 && !out.knotHit && Math.abs(out.offset) < 0.3;

  // ---------------------------------------------------------------- glancing blow
  const wet = cond.wet ?? 0, icy = cond.icy ?? 0, frozen = cond.frozen ?? 0;
  const g0 = 0.8 - 0.1 * wet - 0.12 * icy + 0.08 * (sharpness - 0.6);
  let pGlance = smoothstep(g0, 1.02, rN);
  if (contact.coverage < 0.4) pGlance += 0.3;
  if (onKnotFace) pGlance += 0.22 + 0.1 * icy;
  pGlance += 0.05 * wet;
  // An ice glaze deflects light or edge-on blows; a heavy blow punches through it.
  if (log.iceShell) pGlance += 0.35 * clamp(1.3 - contact.Eeff / 250, 0, 1);
  if (P.rot && rN < P.rot) pGlance *= 0.3; // the edge sinks into punky wood
  out.pGlance = clamp(pGlance, 0, 0.97);
  if (rng.next() < out.pGlance) {
    out.kind = 'glance';
    out.Esplit = 0;
    out.Ereq = P.req;
    out.ratio = 0;
    return out;
  }

  // ---------------------------------------------------------------- energy balance
  const line = logs.lineFromImpact(contact.impact, contact.edgeDir, 1, rng);
  const sameLine = log.crackLine && Math.abs(log.crackLine.e - line.e) < 0.03 &&
    Math.abs(log.crackLine.nx * line.nx + log.crackLine.nz * line.nz) > 0.95;
  const priorWork = log.damage * (sameLine ? 1 : 0.3);
  const chord = 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - out.offset * out.offset));
  const base = P.req * pf.knot * pf.fork * (1 + 0.18 * wet) * (1 - 0.3 * frozen) * chord * pf.check;
  const Ereq = Math.max(0.25 * base, base - priorWork);
  const eff = axe.wedge * (0.72 + 0.28 * sharpness) * (slip ? 0.65 : 1) * (0.6 + 0.4 * contact.coverage);
  const Esplit = contact.Eeff * eff;
  const ratio = Esplit / Ereq;
  Object.assign(out, { Ereq, Esplit, ratio, base, priorWork, sameLine, eff });

  // Cutting resistance for the penetration depth (frozen fibres resist the edge more).
  const Fcut = 9000 * P.species.hard * (1.5 - 0.7 * sharpness) * Math.pow(axe.wedge, 0.6) * (1 + 0.35 * frozen) * (1 - 0.5 * (P.rot ?? 0));
  out.depth = clamp((0.5 * contact.Eeff) / Fcut, 0.004, P.H * 0.75);

  // Interlocked elm and a mis-aimed fork both have fibres that hold even with enough energy.
  const stringy = ((P.species.interlocked && ratio < 1.3) || (P.fork && !pf.forkAligned && ratio < 1.4)) && rng.next() < 0.55;
  if (ratio < 1 || stringy) {
    out.kind = 'stuck';
    out.stringy = stringy && ratio >= 1;
    out.line = sameLine ? log.crackLine : line;
    out.crackDepth = Math.min(P.H * 0.85, out.depth + 0.08 * Math.min(ratio, 1.3) * P.H / 0.35);
    out.crackOpen = 0.0015 + 0.005 * Math.min(ratio, 1.2);
    out.damageAdd = 0.6 * Esplit;
    return out;
  }

  // ---------------------------------------------------------------- split
  out.kind = 'split';
  const excess = Math.max(0, ratio - 1);
  let count = 2;
  const brittle = 0.25 * frozen;
  if (Math.abs(out.offset) < 0.45) {
    if (rng.next() < smoothstep(1.35, 2.0, ratio) + brittle) count = 3;
    if (count === 3 && rng.next() < smoothstep(1.9, 2.8, ratio) + brittle * 0.6) count = 4;
    if (P.species.interlocked && count > 2 && rng.next() < 0.6) count--;
  }
  // A punky core crumbles: the halves fall apart into extra chunks.
  if (P.rot && count < 4 && rng.next() < 0.4 + P.rot) count++;
  out.crumble = !!P.rot;
  line.rough = 1 + (out.knotHit ? 1.6 : 0) + (P.species.interlocked ? 1.2 : 0) + (P.fork ? 1.0 : 0) + (P.rot ? 0.8 : 0) - 0.3 * frozen;
  line.tilt = (out.knotHit ? rng.float(-0.12, 0.12) : rng.float(-0.03, 0.03));
  if (sameLine) Object.assign(line, { nx: log.crackLine.nx, nz: log.crackLine.nz, e: log.crackLine.e });
  out.line = line;
  out.count = count;
  out.excess = excess;
  out.vLat = Math.min(3.4, (0.55 + 1.15 * Math.sqrt(Math.min(excess, 3)) + 0.2 * Math.min(1, contact.vHead / 12)) * (0.8 + 0.2 * axe.wedge)) * (P.rot ? 0.6 : 1);
  out.remain = Math.max(0.06, (Esplit - 0.7 * Ereq) / Math.max(1, Esplit));
  return out;
}
