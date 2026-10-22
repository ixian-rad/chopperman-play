// Firewood rounds: procedural geometry with PBR bark / end grain / split-face materials and
// fracture along the grain (vertical planes that contain the log axis direction). Each round
// carries its own defects: knots (branch stubs radiating from the pith), radial seasoning checks
// and, occasionally, an old fence nail grown into the trunk.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER, GROUPS } from './physics.js';
import { Rng, fbm2, valueNoise2, smoothstep, clamp, lerp } from './rng.js';
import * as T from './textures.js';
import { SPECIES, SPECIES_BY_ID } from './data.js';
import { patchMaterial } from './matpatch.js';

export { SPECIES };

const ARC_SEGMENTS = 64;
const ROWS = 14;
const BARK_TILE_U = 0.26;
const BARK_TILE_V = 0.5;
const SPLIT_TILE_V = 0.5;

// ------------------------------------------------------------------------------------ params

// opts: { species, R, H, knotChance, nailChance, sizeBias, traits: [trait ids], reqMul, boss }
export function makeLogParams(seed, opts = {}) {
  const rng = new Rng(seed);
  const species = typeof opts.species === 'string' ? SPECIES_BY_ID[opts.species] : opts.species ?? rng.pick(SPECIES);
  const traits = [...new Set(opts.traits ?? [])];
  const has = (t) => traits.includes(t);
  const sizeBias = opts.sizeBias ?? 0.5;
  const D = has('huge') ? rng.float(0.46, 0.54) : lerp(species.D[0], species.D[1], clamp(rng.float(0, 1) * 0.7 + sizeBias * 0.3, 0, 1));
  const R = opts.R ?? D / 2;
  const H = opts.H ?? (has('huge') ? rng.float(0.36, 0.44) : rng.float(0.3, 0.42));
  const barkT = rng.float(0.010, 0.018) * (species.id === 'cherry' ? 0.7 : species.id === 'hickory' ? 1.4 : 1);
  const barkStart = 1 - barkT / R;
  const sapStart = barkStart * rng.float(0.72, 0.86);
  const nRings = Math.round(rng.int(species.rings[0], species.rings[1]) * (R / 0.15));
  const widths = [];
  for (let i = 0; i < nRings; i++) {
    const age = i / nRings;
    widths.push(Math.max(0.25, (1.5 - 0.8 * age) * (1 + 0.3 * rng.gauss()) * (1 + 0.25 * Math.sin(i * 0.7 + seed))));
  }
  const sum = widths.reduce((x, y) => x + y, 0);
  const rings = [0];
  let acc = 0;
  for (const w of widths) {
    acc += (w / sum) * barkStart;
    rings.push(acc);
  }
  // Knots: branch traces radiating out from the pith. th = angle in log-local xz, r = where the
  // knot crosses the top face (fraction of R), size = knot radius (fraction of R).
  const knots = [];
  const knotChance = opts.knotChance ?? 0.3;
  if (has('knotty')) {
    // Spread 3–5 knots around the round, leaving narrow clear lanes between them.
    const n = rng.int(3, 5);
    const th0 = rng.float(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      knots.push({ th: th0 + (i / n) * Math.PI * 2 + rng.float(-0.35, 0.35), r: rng.float(0.35, 0.72), size: rng.float(0.08, 0.13), severity: rng.float(1.6, 2.2) });
    }
  } else if (rng.next() < knotChance) {
    const n = rng.next() < 0.35 ? 2 : 1;
    const th0 = rng.float(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      knots.push({ th: th0 + i * rng.float(1.6, 3.6), r: rng.float(0.32, 0.72), size: rng.float(0.07, 0.13), severity: rng.float(1.45, 2.1) });
    }
  }
  // Radial seasoning checks, running in from the bark.
  const checks = [];
  const nChecks = rng.int(1, 4);
  for (let i = 0; i < nChecks; i++) {
    checks.push({ th: rng.float(0, Math.PI * 2), len: rng.float(0.3, 0.75), w: rng.float(0.006, 0.014) });
  }
  const nail = rng.next() < (opts.nailChance ?? 0) || opts.nail ? { th: rng.float(0, Math.PI * 2), len: rng.float(0.35, 0.55), h: rng.float(0.45, 0.8) } : null;
  // Variant geometry / physics parameters.
  const twist = has('twisted') ? rng.sign() * rng.float(0.9, 1.6) : 0; // rad of spiral over the height
  const fork = has('forked') ? { th: rng.float(0, Math.PI * 2), h: rng.float(0.5, 0.72), rb: rng.float(0.42, 0.55), tilt: rng.float(0.45, 0.7) } : null;
  const rot = has('rotten') ? rng.float(0.38, 0.6) : 0; // punky core radius (fraction of R)
  let rock = null;
  if (has('rock')) {
    // Keep the stone away from the nail line so the two hazards read separately.
    let th = rng.float(0, Math.PI * 2);
    if (nail && Math.abs(Math.atan2(Math.sin(th - nail.th), Math.cos(th - nail.th))) < 0.8) th += Math.PI;
    rock = { th, h: rng.float(0.35, 0.7), size: rng.float(0.022, 0.032), depth: rng.float(0.3, 0.42) };
  }
  // Energy needed to split through the pith (J): toughness x cross-section x length, then the
  // isotropic variant factors (spiral grain is tougher, a punky core is softer).
  const reqMul = (opts.reqMul ?? 1) * (twist ? 1.3 : 1) * (1 - 0.75 * rot);
  const req = 300 * species.tough * Math.pow((2 * R) / 0.3, 1.6) * Math.pow(H / 0.4, 0.5) * reqMul;
  return {
    seed, species, R, H, barkStart, sapStart, rings, knots, checks, nail, req,
    heart: species.heart, sap: species.sap, innerBark: species.innerBark, outerBark: species.outerBark,
    latewood: species.latewood, bumpSeed: seed % 997,
    traits, twist, fork, rot, rock, soaked: has('soaked'), iced: has('iced'),
    density: species.density * (has('soaked') ? 1.35 : 1) * (1 - 0.4 * rot),
    boss: opts.boss ?? null,
  };
}

// Materials (textures are generated per log so rings, knots and checks match on all faces).
export function makeLogMaterials(params, { weathered = false } = {}) {
  const lut = T.buildRingLUT(params);
  const bark = T.barkTextures(params.species, 101 + (params.seed % 3));
  const end = weathered ? { map: T.blockTopTexture(lut, params.seed), normal: null } : T.endGrainTextures(params, lut, params.seed);
  const split = T.splitFaceTextures(params, lut, params.seed + 3);
  const mats = [
    new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughnessMap: bark.rough, roughness: 1 }),
    new THREE.MeshStandardMaterial({ map: end.map, normalMap: end.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.86 }),
    new THREE.MeshStandardMaterial({ map: split.map, normalMap: split.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.74 }),
  ];
  mats[0].userData.sharedBark = true;
  if (params.soaked) {
    // Waterlogged: dark, saturated and slightly glossy all the way through.
    for (const m of mats) { m.color.setRGB(0.62, 0.6, 0.58); m.roughness *= 0.62; }
  }
  mats.forEach((m, i) => patchMaterial(m, { porous: i === 0 ? 1 : 1.15 }));
  return mats;
}

export function disposeMaterials(mats) {
  for (const m of mats) {
    for (const k of ['map', 'normalMap', 'roughnessMap']) {
      if (m[k] && !m.userData.sharedBark) m[k].dispose();
    }
    m.dispose();
  }
}

// ------------------------------------------------------------------------------------ polygons

// Polygon vertex: { x, z, edge: { split: lineId } | null, lines: [lineIds] }
// `edge` describes the edge from this vertex to the next one (null = bark arc).
export function circlePolygon(R) {
  const verts = [];
  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const a = (i / ARC_SEGMENTS) * Math.PI * 2;
    verts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, edge: null, lines: [] });
  }
  return verts;
}

// Keep the part of a convex polygon where side * (n·p - e) >= 0.
export function clipPolygon(verts, line, side) {
  const out = [];
  const f = (v) => side * (line.nx * v.x + line.nz * v.z - line.e);
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const da = f(a), db = f(b);
    if (da >= 0) out.push({ ...a, lines: [...a.lines] });
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      const lines = [line.id];
      if (a.edge && a.edge.split !== undefined) lines.push(a.edge.split);
      const ip = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, lines };
      if (da >= 0) {
        ip.edge = { split: line.id }; // leaving: next edge runs along the clip line
      } else {
        ip.edge = a.edge; // entering: continue along the original edge
      }
      out.push(ip);
    }
  }
  return out;
}

function polygonArea(v) {
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

function polygonCentroid(v) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    const cr = p.x * q.z - q.x * p.z;
    a += cr;
    cx += (p.x + q.x) * cr;
    cz += (p.z + q.z) * cr;
  }
  a /= 2;
  return { x: cx / (6 * a), z: cz / (6 * a), area: Math.abs(a) };
}

// Subdivide split edges so the fibrous displacement has vertices to act on.
function refine(verts) {
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    out.push(a);
    if (a.edge && a.edge.split !== undefined) {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(len / 0.011));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, edge: a.edge, lines: [a.edge.split] });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------ geometry

// Deterministic surface position for polygon point p at height y. Pieces sharing a split
// line evaluate the same function, so mating faces match exactly.
function surfacePoint(params, lines, p, y, out) {
  const { R, H } = params;
  let x = p.x, z = p.z;
  const r = Math.hypot(x, z);
  // Bark irregularity near the rim.
  const rimW = smoothstep(R - 0.012, R, r);
  if (rimW > 0) {
    const th = Math.atan2(z, x);
    const u = th / (Math.PI * 2);
    const bump = 0.012 * (fbm2(u * 3, y * 6, params.bumpSeed, 3, 3, 0) - 0.5) +
      0.004 * (valueNoise2(u * 25, y * 40, params.bumpSeed + 1, 25, 0) - 0.5);
    x += (x / r) * bump * R * rimW * 3;
    z += (z / r) * bump * R * rimW * 3;
  }
  for (const id of lines) {
    const L = params.lines?.[id];
    if (!L) continue;
    const s = p.x * -L.nz + p.z * L.nx; // coordinate along the line
    const taper = 1 - smoothstep(R - 0.02, R - 0.002, r);
    const fib = (valueNoise2(s * 110 + 13, y * 2.2, L.seed) - 0.5) * 0.0045 +
      (valueNoise2(s * 340, y * 6, L.seed + 1) - 0.5) * 0.0015;
    const wander = (fbm2(s * 7 + 3, y * 3.2, L.seed + 2, 3) - 0.5) * 0.016 * (L.rough ?? 1) + L.tilt * (y - H / 2) +
      (params.twist ?? 0) * 0.3 * s * (y / H - 0.5); // spiral grain twists the face into a helicoid
    const d = (fib + wander) * taper;
    x += L.nx * d;
    z += L.nz * d;
  }
  out.x = x;
  out.z = z;
}

// Build a BufferGeometry for a convex polygonal prism of wood with groups:
// 0 = bark, 1 = end grain (top/bottom), 2 = split faces.
export function buildWoodGeometry(params, polygon) {
  const { R, H } = params;
  let verts = refine(polygon);
  const ccw = polygonArea(verts) > 0; // in (x,z) space
  const parts = [[], [], []];
  const tmp = { x: 0, z: 0 };

  // Runs of consecutive edges of the same kind.
  const n = verts.length;
  const kindOf = (v) => (v.edge && v.edge.split !== undefined ? `s${v.edge.split}` : 'bark');
  let start = 0;
  if (n > 0) {
    // Start at a kind change so runs don't wrap (unless the whole loop is bark).
    for (let i = 0; i < n; i++) {
      if (kindOf(verts[i]) !== kindOf(verts[(i - 1 + n) % n])) { start = i; break; }
    }
  }
  const runs = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const kind = kindOf(verts[i]);
    if (!cur || cur.kind !== kind) {
      cur = { kind, idx: [i] };
      runs.push(cur);
    } else cur.idx.push(i);
  }
  const closedLoop = runs.length === 1;
  for (const run of runs) {
    const last = run.idx[run.idx.length - 1];
    run.idx.push((last + 1) % n);
  }

  for (const run of runs) {
    const isBark = run.kind === 'bark';
    const cols = run.idx.length;
    const pos = new Float32Array(cols * (ROWS + 1) * 3);
    const uv = new Float32Array(cols * (ROWS + 1) * 2);
    let thPrev = null, thOff = 0;
    for (let c = 0; c < cols; c++) {
      const v = verts[run.idx[c]];
      let th = Math.atan2(v.z, v.x);
      if (thPrev !== null) {
        while (th + thOff - thPrev > Math.PI) thOff -= Math.PI * 2;
        while (th + thOff - thPrev < -Math.PI) thOff += Math.PI * 2;
      }
      th += thOff;
      thPrev = th;
      const lines = isBark ? [] : v.lines;
      for (let r = 0; r <= ROWS; r++) {
        const y = (r / ROWS) * H;
        surfacePoint(params, lines, v, y, tmp);
        const k = c * (ROWS + 1) + r;
        pos[k * 3] = tmp.x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = tmp.z;
        if (isBark) {
          const tiles = Math.max(2, Math.round((2 * Math.PI * R) / BARK_TILE_U));
          uv[k * 2] = ((th + (params.twist ?? 0) * (y / H)) / (Math.PI * 2)) * tiles;
          uv[k * 2 + 1] = y / BARK_TILE_V;
        } else {
          uv[k * 2] = clamp(Math.hypot(v.x, v.z) / R, 0, 1);
          uv[k * 2 + 1] = y / SPLIT_TILE_V;
        }
      }
    }
    const index = [];
    for (let c = 0; c < cols - 1; c++) {
      for (let r = 0; r < ROWS; r++) {
        const a = c * (ROWS + 1) + r, b = (c + 1) * (ROWS + 1) + r;
        // Outward facing for a CCW (x,z) polygon: (a, a+1, b) ordering.
        if (ccw) index.push(a, a + 1, b, b, a + 1, b + 1);
        else index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    if (closedLoop) {
      // Weld normals across the seam of a full cylinder.
      const nrm = g.getAttribute('normal');
      const lastC = cols - 1;
      for (let r = 0; r <= ROWS; r++) {
        const i0 = r, i1 = lastC * (ROWS + 1) + r;
        const nx = nrm.getX(i0) + nrm.getX(i1), ny = nrm.getY(i0) + nrm.getY(i1), nz = nrm.getZ(i0) + nrm.getZ(i1);
        const l = Math.hypot(nx, ny, nz) || 1;
        nrm.setXYZ(i0, nx / l, ny / l, nz / l);
        nrm.setXYZ(i1, nx / l, ny / l, nz / l);
      }
    }
    parts[isBark ? 0 : 2].push(g);
  }

  // Caps.
  for (const top of [true, false]) {
    const y = top ? H : 0;
    const contour = verts.map((v) => {
      surfacePoint(params, v.lines, v, y, tmp);
      return new THREE.Vector2(tmp.x, tmp.z);
    });
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const pos = new Float32Array(contour.length * 3);
    const uv = new Float32Array(contour.length * 2);
    const Rt = R * 1.0;
    contour.forEach((p, i) => {
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = p.y;
      uv[i * 2] = p.x / (2 * Rt) + 0.5;
      uv[i * 2 + 1] = p.y / (2 * Rt) + 0.5;
    });
    const index = [];
    for (const [a, b, c] of tris) {
      const ax = contour[a].x, az = contour[a].y;
      const ny = (contour[b].y - az) * (contour[c].x - ax) - (contour[b].x - ax) * (contour[c].y - az);
      const up = ny > 0;
      if (up === top) index.push(a, b, c);
      else index.push(a, c, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const nrm = new Float32Array(contour.length * 3);
    for (let i = 0; i < contour.length; i++) nrm[i * 3 + 1] = top ? 1 : -1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(index);
    parts[1].push(g);
  }

  const groups = parts.map((list) => (list.length ? mergeGeometries(list) : null));
  const present = [];
  const matIndex = [];
  groups.forEach((g, i) => { if (g) { present.push(g); matIndex.push(i); } });
  const merged = mergeGeometries(present, true);
  merged.groups.forEach((gr, i) => { gr.materialIndex = matIndex[i]; });
  for (const g of [...parts.flat(), ...present]) g.dispose();
  return merged;
}

// Convex-hull points for the collider: the undisplaced polygon shrunk slightly so that
// neighbouring pieces never start in contact.
function colliderPoints(polygon, H, centroid, inset = 0.003) {
  const pts = [];
  for (const v of polygon) {
    const dx = v.x - centroid.x, dz = v.z - centroid.z;
    const l = Math.hypot(dx, dz) || 1;
    const k = Math.max(0, (l - inset) / l);
    for (const y of [-H / 2 + 0.002, H / 2 - 0.002]) pts.push(dx * k, y, dz * k);
  }
  return new Float32Array(pts);
}

// ------------------------------------------------------------------------------------ manager

const _q = new THREE.Quaternion();

export class LogManager {
  constructor({ scene, physics, blockTop }) {
    this.scene = scene;
    this.physics = physics;
    this.blockTop = blockTop;
    this.log = null; // current intact log
    this.pieces = []; // split pieces (all logs)
    this.crack = null;
    this.friction = 0.75;
    this.maxPieces = 28;
    this.blockR = 0.31;
    this.dying = [];
  }

  // Put a round on the chopping block. `src` may be a seed or a params object. With
  // opts.mesh/mats an existing queue mesh is reused; with opts.from it is carried over in an arc.
  createLog(src, state = null, opts = {}) {
    this.removeIntact();
    this.clearPiecesNearBlock();
    const params = typeof src === 'object' ? src : makeLogParams(src);
    params.lines = {};
    const rng = new Rng(params.seed + 77);
    const mats = opts.mats ?? makeLogMaterials(params);
    let mesh = opts.mesh;
    if (!mesh) {
      mesh = new THREE.Mesh(buildWoodGeometry(params, circlePolygon(params.R)), mats);
      mesh.castShadow = mesh.receiveShadow = true;
      addDecorations(mesh, params, mats);
    }
    const pos = new THREE.Vector3(rng.float(-0.01, 0.01), this.blockTop + 0.001, rng.float(-0.01, 0.01));
    const rotY = state?.rotY ?? rng.float(0, Math.PI * 2);
    mesh.position.copy(pos);
    mesh.rotation.set(0, rotY, 0);
    if (!mesh.parent) this.scene.add(mesh);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + params.H / 2, pos.z),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(params.H / 2, params.R).setCollisionGroups(GROUPS.LOG).setFriction(0.7),
      body,
    );
    const iceShell = mesh.children.find((c) => c.userData.deco === 'ice') ?? null;
    this.log = { params, mesh, body, mats, pos, rotY, damage: 0, crackLine: null, rng, hits: 0, ready: true, anim: null, iceShell };
    if (opts.from) {
      const fromQ = opts.fromQuat ?? new THREE.Quaternion();
      this.log.anim = { t: 0, dur: opts.dur ?? 0.6, from: opts.from.clone(), fromQ: fromQ.clone(), toQ: new THREE.Quaternion().setFromEuler(mesh.rotation) };
      this.log.ready = false;
      mesh.position.copy(opts.from);
      mesh.quaternion.copy(fromQ);
    }
    if (state) {
      this.log.damage = state.damage ?? 0;
      this.log.hits = state.hits ?? 0;
      if (state.crackLine) this.addCrack(state.crackLine, state.crackDepth, state.crackOpen);
    }
    return this.log;
  }

  snapshot() {
    const L = this.log;
    if (!L) return null;
    return { params: L.params, rotY: L.rotY, damage: L.damage, hits: L.hits, crackLine: L.crackLine, crackDepth: L.crackDepth, crackOpen: L.crackOpen };
  }

  // Animate the round being carried onto the block.
  animate(dt) {
    const L = this.log;
    if (!L || !L.anim) return;
    const A = L.anim;
    A.t += dt;
    const s = clamp(A.t / A.dur, 0, 1);
    const e = s * s * (3 - 2 * s);
    L.mesh.position.lerpVectors(A.from, L.pos, e);
    L.mesh.position.y += Math.sin(Math.PI * e) * 0.45;
    L.mesh.quaternion.slerpQuaternions(A.fromQ, A.toQ, e);
    if (s >= 1) {
      L.mesh.position.copy(L.pos);
      L.mesh.quaternion.copy(A.toQ);
      L.anim = null;
      L.ready = true;
      this.onLanded?.(L);
    }
  }

  // Knock the ice glaze off the current round (returns true if there was one).
  shatterIce() {
    const L = this.log;
    if (!L?.iceShell) return false;
    L.mesh.remove(L.iceShell);
    disposeDeco(L.iceShell);
    L.iceShell = null;
    return true;
  }

  removeIntact() {
    if (this.crack) {
      this.scene.remove(this.crack);
      this.crack.geometry.dispose();
      this.crack.material.dispose();
      this.crack = null;
    }
    if (!this.log) return;
    this.scene.remove(this.log.mesh);
    this.log.mesh.geometry.dispose();
    for (const c of [...this.log.mesh.children]) if (c.userData.deco) disposeDeco(c);
    if (!this.log.sharedMats) disposeMaterials(this.log.mats);
    if (this.log.body) this.physics.world.removeRigidBody(this.log.body);
    this.log = null;
  }

  clearAll() {
    this.removeIntact();
    for (const p of this.pieces) this.disposePiece(p);
    for (const p of this.dying) this.disposePiece(p);
    this.pieces = [];
    this.dying = [];
  }

  disposePiece(p) {
    this.physics.removeSynced(p.entry);
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    for (const c of [...p.mesh.children]) if (c.userData.deco) disposeDeco(c);
    p.matsRef.count--;
    if (p.matsRef.count === 0) disposeMaterials(p.matsRef.mats);
  }

  clearPiecesNearBlock() {
    this.pieces = this.pieces.filter((p) => {
      const t = p.entry.body.translation();
      if (Math.hypot(t.x, t.z) < 0.55 && t.y > this.blockTop - 0.05) {
        this.disposePiece(p);
        return false;
      }
      return true;
    });
    while (this.pieces.length > this.maxPieces) this.disposePiece(this.pieces.shift());
  }

  // Remove pieces that have come to rest (or are old) and report them, so they can be stacked.
  collectSettled(minAge = 2.4, maxAge = 8) {
    const out = [];
    this.pieces = this.pieces.filter((p) => {
      const age = this.physics.time - p.born;
      const b = p.entry.body;
      const v = b.linvel();
      const t = b.translation();
      const onBlock = Math.hypot(t.x, t.z) < this.blockR && t.y > this.blockTop;
      const still = b.isSleeping() || (Math.hypot(v.x, v.y, v.z) < 0.05 && age > minAge);
      if (!onBlock && ((age > minAge && still) || age > maxAge)) {
        out.push({ mass: p.mass, species: p.species, pos: { x: t.x, y: t.y, z: t.z } });
        this.retire(p);
        return false;
      }
      return true;
    });
    return out;
  }

  // Pieces still standing on the chopping block (they must be knocked off before the next round).
  piecesOnBlock() {
    return this.pieces.filter((p) => {
      const t = p.entry.body.translation();
      return Math.hypot(t.x, t.z) < this.blockR + 0.02 && t.y > this.blockTop - 0.02;
    });
  }

  // Shrink a collected piece away (it "goes to the woodpile").
  retire(p) {
    this.physics.removeSynced(p.entry);
    p.dying = 0;
    this.dying.push(p);
  }

  setFriction(f) {
    this.friction = f;
    for (const p of this.pieces) p.collider.setFriction(f);
  }

  toLocal(world) {
    const L = this.log;
    const dx = world.x - L.pos.x, dz = world.z - L.pos.z;
    const c = Math.cos(L.rotY), s = Math.sin(L.rotY);
    // Inverse of rotation about Y by rotY (three.js convention: x' = x c + z s, z' = -x s + z c).
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }

  toLocalDir(d) {
    const c = Math.cos(this.log.rotY), s = Math.sin(this.log.rotY);
    const x = d.x * c - d.z * s, z = d.x * s + d.z * c;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  }

  toWorld(lx, lz) {
    const L = this.log;
    const d = this.toWorldDir(lx, lz);
    return d.add(L.pos);
  }

  toWorldDir(lx, lz) {
    const c = Math.cos(this.log.rotY), s = Math.sin(this.log.rotY);
    return new THREE.Vector3(lx * c + lz * s, 0, -lx * s + lz * c);
  }

  // Line through a world-space impact point, parallel to the (world) blade edge direction.
  lineFromImpact(impactWorld, edgeDirWorld, id, rng, maxOffset = 0.62) {
    const L = this.log;
    const p = this.toLocal(impactWorld);
    const t = this.toLocalDir(edgeDirWorld);
    const nx = -t.z, nz = t.x;
    let e = nx * p.x + nz * p.z;
    e = clamp(e, -maxOffset * L.params.R, maxOffset * L.params.R);
    return { id, nx, nz, e, seed: (L.params.seed * 31 + id * 7 + L.hits * 13) % 100000, tilt: rng.float(-0.03, 0.03), rough: 1 };
  }

  // Partial split: crack opens, axe remains embedded.
  addCrack(line, depth, open) {
    const L = this.log;
    L.crackLine = line;
    L.crackDepth = depth;
    L.crackOpen = open;
    if (this.crack) {
      this.scene.remove(this.crack);
      this.crack.geometry.dispose();
      this.crack.material.dispose();
    }
    const R = L.params.R;
    const half = Math.sqrt(Math.max(0, R * R - line.e * line.e)) + 0.002;
    const g = new THREE.BoxGeometry(half * 2, depth, open);
    // Taper the crack: narrower at the bottom.
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0) pos.setZ(i, pos.getZ(i) * 0.15);
    }
    g.translate(0, -depth / 2 + 0.0008, 0);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x1a120c }));
    // Position in log-local space then transform into world.
    const cx = line.nx * line.e, cz = line.nz * line.e;
    const local = new THREE.Object3D();
    local.position.set(cx, L.params.H, cz);
    local.rotation.y = Math.atan2(-line.nx, -line.nz); // maps local X onto the line tangent (−nz, nx)
    local.updateMatrix();
    L.mesh.updateMatrixWorld(true);
    mesh.applyMatrix4(local.matrix);
    mesh.applyMatrix4(L.mesh.matrixWorld);
    this.scene.add(mesh);
    this.crack = mesh;
  }

  // Split the current intact log along `primary` (log-local line). Returns the created pieces.
  // count = 2..4 pieces; vLat = separation speed of the halves (wedge action).
  split({ primary, count, vLat, excess, rng }) {
    const L = this.log;
    const params = L.params;
    params.lines = { 1: { ...primary, id: 1 } };
    primary = params.lines[1];
    if (params.R < 0.135) count = Math.min(count, 3);

    const polys = [];
    const halves = [+1, -1].map((side) => ({ side, poly: clipPolygon(circlePolygon(params.R), primary, side) }));
    // Secondary cracks go into the bigger half first.
    const areaOf = (h) => polygonCentroid(h.poly).area;
    const bigger = areaOf(halves[0]) >= areaOf(halves[1]) ? 1 : -1;
    const secondarySides = count <= 2 ? [] : count === 3 ? [bigger] : [1, -1];
    for (const h of halves) {
      if (secondarySides.includes(h.side) && h.poly.length >= 3) {
        const id = h.side > 0 ? 2 : 3;
        const ang = Math.atan2(primary.nz, primary.nx) + Math.PI / 2 + rng.float(-0.45, 0.45);
        const mx = Math.cos(ang), mz = Math.sin(ang);
        const f = rng.float(-0.025, 0.025) * params.R / 0.15;
        params.lines[id] = { id, nx: mx, nz: mz, e: f, seed: (params.seed * 13 + id * 101) % 100000, tilt: rng.float(-0.04, 0.04), rough: primary.rough };
        for (const s2 of [1, -1]) {
          polys.push({ poly: clipPolygon(h.poly, params.lines[id], s2), dir: [h.side * primary.nx + s2 * mx * 0.8, h.side * primary.nz + s2 * mz * 0.8] });
        }
      } else {
        polys.push({ poly: h.poly, dir: [h.side * primary.nx, h.side * primary.nz] });
      }
    }

    const density = params.density ?? params.species.density;
    const totalMass = Math.PI * params.R * params.R * params.H * density;
    // Bark decorations (fork stub, stone, nail head) travel with the piece they belong to.
    const decos = L.mesh.children.filter((c) => c.userData.deco && c.userData.deco !== 'ice');
    const matsRef = { mats: L.mats, count: 0 };
    const base = L.pos.clone();
    const rot = _q.clone().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, L.rotY);
    const created = [];
    for (const { poly, dir } of polys) {
      if (poly.length < 3) continue;
      const cen = polygonCentroid(poly);
      if (cen.area < 1e-5) continue;
      const geo = buildWoodGeometry(params, poly);
      geo.translate(-cen.x, -params.H / 2, -cen.z);
      const mesh = new THREE.Mesh(geo, L.mats);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      const dl = Math.hypot(dir[0], dir[1]) || 1;
      const dWorld = this.toWorldDir(dir[0] / dl, dir[1] / dl);
      const cWorld = this.toWorldDir(cen.x, cen.z);
      const p = base.clone().add(cWorld).addScaledVector(dWorld, 0.004);
      p.y = this.blockTop + params.H / 2 + 0.002;
      const hull = colliderPoints(poly, params.H, cen);
      let cd = RAPIER.ColliderDesc.convexHull(hull);
      if (!cd) cd = RAPIER.ColliderDesc.cuboid(0.05, params.H / 2, 0.05);
      cd.setDensity(density).setFriction(this.friction).setRestitution(0.12).setCollisionGroups(GROUPS.PIECE_NO_AXE);
      const mass = cen.area * params.H * density;
      // Momentum share: lighter pieces fly faster (equal and opposite impulses from the wedge).
      const speed = vLat * clamp(Math.sqrt(totalMass / polys.length / mass), 0.75, 1.4) * rng.float(0.85, 1.15);
      const v = dWorld.clone().multiplyScalar(speed);
      v.y = rng.float(0.0, 0.5) * Math.min(1, excess) - 0.15;
      // Tip outward: top moves away from the split faster than the base.
      const w = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, dWorld).multiplyScalar((speed / (params.H / 2)) * rng.float(0.3, 0.5));
      w.y += rng.float(-1.0, 1.0) + (params.twist ?? 0) * rng.float(1.5, 3.0);
      const bd = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinvel(v.x, v.y, v.z)
        .setAngvel({ x: w.x, y: w.y, z: w.z })
        .setCcdEnabled(true)
        .setLinearDamping(0.02)
        .setAngularDamping(0.08);
      const body = this.physics.world.createRigidBody(bd);
      const collider = this.physics.world.createCollider(cd, body);
      mesh.position.copy(p);
      mesh.quaternion.copy(rot);
      const entry = this.physics.addSynced(body, mesh);
      matsRef.count++;
      const piece = { mesh, entry, collider, matsRef, born: this.physics.time, axeEnabled: false, lastVel: v.clone(), mass, species: params.species.id, cen };
      this.pieces.push(piece);
      created.push(piece);
    }
    for (const d of decos) {
      let best = null, bestDot = -Infinity;
      for (const pc of created) {
        const dot = pc.cen.x * d.position.x + pc.cen.z * d.position.z;
        if (dot > bestDot) { bestDot = dot; best = pc; }
      }
      L.mesh.remove(d);
      if (!best) { disposeDeco(d); continue; }
      d.position.x -= best.cen.x;
      d.position.y -= params.H / 2;
      d.position.z -= best.cen.z;
      best.mesh.add(d);
    }
    // Remove the intact log but keep its materials (now owned by the pieces).
    L.sharedMats = true;
    this.removeIntact();
    return created;
  }

  update(dt) {
    this.animate(dt);
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const p = this.dying[i];
      p.dying += dt;
      const k = 1 - p.dying / 0.45;
      if (k <= 0) {
        this.disposePiece(p);
        this.dying.splice(i, 1);
      } else {
        p.mesh.scale.setScalar(k);
        p.mesh.position.y -= dt * 0.08;
      }
    }
    for (const p of this.pieces) {
      if (!p.entry.body) continue;
      if (!p.axeEnabled && this.physics.time - p.born > 0.18) {
        p.collider.setCollisionGroups(GROUPS.PIECE);
        p.axeEnabled = true;
      }
    }
  }
}

// Bark decorations: nail head, grown-in stone, fork stub, ice glaze. Children of the round's mesh
// (log-local coordinates, origin at the bottom centre) tagged with userData.deco.
function disposeDeco(o) {
  o.parent?.remove(o);
  if (o.userData.ownGeo) o.geometry.dispose();
  if (o.userData.ownMat) o.material.dispose();
}

const rockMat = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.78, metalness: 0.05 });
const rockGeo = new THREE.IcosahedronGeometry(1, 1);
{
  // Lumpy river stone.
  const pos = rockGeo.getAttribute('position');
  const rr = new Rng(91);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.82 + 0.3 * valueNoise2(pos.getX(i) * 2 + 3, pos.getY(i) * 2 + pos.getZ(i), 5) + rr.float(-0.04, 0.04);
    pos.setXYZ(i, pos.getX(i) * k * 1.2, pos.getY(i) * k * 0.85, pos.getZ(i) * k);
  }
  rockGeo.computeVertexNormals();
}
const iceMat = new THREE.MeshStandardMaterial({ color: 0xd8ecff, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.38, depthWrite: false });
iceMat.userData.noWeather = true;

export function addDecorations(mesh, params, mats) {
  addNailHead(mesh, params);
  const { R, H } = params;
  if (params.rock) {
    const k = params.rock;
    const st = new THREE.Mesh(rockGeo, rockMat);
    st.scale.setScalar(k.size);
    st.position.set(Math.cos(k.th) * (R - k.size * 0.35), H * k.h, Math.sin(k.th) * (R - k.size * 0.35));
    st.rotation.set(1.3 * k.th, k.th, 0.4);
    st.castShadow = true;
    st.userData.deco = 'rock';
    mesh.add(st);
  }
  if (params.fork) {
    // The second stem of the Y: a sawn-off branch leaning out of the side, bark matching the round.
    const f = params.fork;
    const rb = f.rb * R, len = R * 1.05;
    const g = new THREE.CylinderGeometry(rb * 0.9, rb, len, 18, 1);
    g.translate(0, len / 2, 0);
    const stub = new THREE.Mesh(g, [mats[0], mats[1], mats[1]]);
    const ax = new THREE.Vector3(Math.cos(f.th) * Math.sin(f.tilt), Math.cos(f.tilt), Math.sin(f.th) * Math.sin(f.tilt));
    stub.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax);
    stub.position.set(Math.cos(f.th) * R * 0.55, H * f.h - rb * 0.6, Math.sin(f.th) * R * 0.55);
    stub.castShadow = stub.receiveShadow = true;
    stub.userData.deco = 'fork';
    stub.userData.ownGeo = true;
    mesh.add(stub);
  }
  if (params.iced) {
    const g = new THREE.CylinderGeometry(R + 0.007, R + 0.009, H + 0.008, 40, 1);
    g.translate(0, H / 2 + 0.002, 0);
    const shell = new THREE.Mesh(g, iceMat);
    shell.renderOrder = 2;
    shell.userData.deco = 'ice';
    shell.userData.ownGeo = true;
    mesh.add(shell);
  }
}

// A rusty nail head sticking out of the bark (the hint that something hard is inside).
const nailMat = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.55, metalness: 0.7 });
const nailGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 10);
nailGeo.rotateZ(Math.PI / 2);
export function addNailHead(mesh, params) {
  if (!params.nail) return;
  const n = params.nail;
  const head = new THREE.Mesh(nailGeo, nailMat);
  // Local (x, z) = (cos th, sin th) * R; mesh space matches log-local.
  head.position.set(Math.cos(n.th) * (params.R + 0.003), params.H * n.h, Math.sin(n.th) * (params.R + 0.003));
  head.rotation.y = -n.th;
  head.castShadow = true;
  head.userData.deco = 'nail';
  mesh.add(head);
}

// Static decorative / chopping-block / queued rounds share the same geometry builder.
export function makeStaticRound(params, { weathered = false } = {}) {
  params.lines = {};
  const mats = makeLogMaterials(params, { weathered });
  const geo = buildWoodGeometry(params, circlePolygon(params.R));
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = mesh.receiveShadow = true;
  if (!weathered) addDecorations(mesh, params, mats);
  mesh.userData.mats = mats;
  return mesh;
}

export { lerp };
