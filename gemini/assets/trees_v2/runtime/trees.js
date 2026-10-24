// trees_v2 runtime: load species GLBs, place many instanced trees, collide, pick, chop, fell, stump.
// three.js r160+ (tested r186). No dependencies beyond three + GLTFLoader (+ meshopt decoder).
import * as THREE from 'three';
import { applyWind, WIND } from './wind.js';

const PARTS = ['stump', 'stump_cap', 'log', 'log_cap', 'branches', 'leaves'];
const PIVOT_PARTS = new Set(['log', 'log_cap', 'branches', 'leaves']);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** Convert (possibly quantized) attributes to float and bake `matrix` in. */
function bakeGeometry(src, matrix) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', '_wind']) {
    const a = src.getAttribute(name); if (!a) continue;
    const n = a.count, size = a.itemSize, arr = new Float32Array(n * size);
    for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  g.applyMatrix4(matrix);
  if (!g.getAttribute('_wind')) g.setAttribute('_wind', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.computeBoundingSphere();
  return g;
}
function mergeGeoms(list) {
  const out = new THREE.BufferGeometry(); const names = ['position', 'normal', 'uv', '_wind'];
  const total = list.reduce((s, g) => s + g.attributes.position.count, 0);
  for (const nm of names) { const size = list[0].getAttribute(nm).itemSize; const arr = new Float32Array(total * size); let o = 0;
    for (const g of list) { arr.set(g.getAttribute(nm).array, o); o += g.getAttribute(nm).array.length; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, size)); }
  const idx = []; let base = 0;
  for (const g of list) { for (const i of g.index.array) idx.push(i + base); base += g.attributes.position.count; }
  out.setIndex(idx); out.computeBoundingSphere(); return out;
}

/**
 * Load species GLBs. `urls` = { oak: 'models/tree_oak.glb', ... }.
 * Returns lib[species] = { variants: [ { meta, lod0:{part:geom}, lod1:{...}, lod2:{impostor}, materials } ] }
 * stump / stump_cap / impostor geometries are in tree-base space (y=0 ground, trunk axis at origin);
 * log / log_cap / branches / leaves are in fall-pivot space (origin on the trunk axis at the cut, y=chopHeight).
 */
export async function loadTreeLibrary(gltfLoader, urls, { wind = true } = {}) {
  const lib = {};
  await Promise.all(Object.entries(urls).map(async ([sp, url]) => {
    const gltf = await gltfLoader.loadAsync(url);
    const scene = gltf.scene; scene.updateMatrixWorld(true);
    const variants = [];
    for (const root of scene.children) {
      if (!root.userData || root.userData.species !== sp) continue;
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      const v = { meta: root.userData, lod0: {}, lod1: {}, lod2: {}, materials: {} };
      root.traverse(o => {
        if (!o.isMesh) return;
        const part = o.userData.part; const lodNode = o.parent.userData.lod ? o.parent : o.parent.parent;
        const lod = (lodNode.userData.lod || 'LOD0').toLowerCase();
        const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        // parts under the fall pivot are stored in pivot space (y = 0 at the cut plane)
        if (PIVOT_PARTS.has(part)) rel.premultiply(new THREE.Matrix4().makeTranslation(0, -root.userData.chopHeight, 0));
        v[lod][part] = bakeGeometry(o.geometry, rel);
        const key = o.material.name || part;
        if (!v.materials[key]) {
          if (wind && (key === 'bark' || key === 'leaves' || key.startsWith('impostor'))) applyWind(o.material);
          if (key === 'leaves') { o.material.alphaToCoverage = true; o.material.emissive = new THREE.Color(0.10, 0.10, 0.08); o.material.emissiveMap = o.material.map; }
          v.materials[key] = o.material;
        }
        v[lod]['mat_' + part] = o.material;
      });
      variants[v.meta.variant] = v;
    }
    lib[sp] = { variants };
  }));
  return lib;
}

/** Instanced, choppable tree field. */
export class TreeField {
  constructor(scene, lib, { lod1Distance = 28, lod2Distance = 70, castShadow = true } = {}) {
    this.scene = scene; this.lib = lib; this.trees = []; this.pools = new Map(); this.active = new Set();
    this.lod1D = lod1Distance; this.lod2D = lod2Distance; this.castShadow = castShadow;
    this.group = new THREE.Group(); this.group.name = 'TreeField'; scene.add(this.group);
    this._dirty = true; this._lastCam = new THREE.Vector3(1e9, 0, 0);
  }
  /** Place a tree. Returns the tree record (id = index). */
  place(species, variant, x, z, { rotY = Math.random() * Math.PI * 2, scale = 1, y = 0 } = {}) {
    const V = this.lib[species].variants[variant]; const m = V.meta;
    const t = { id: this.trees.length, species, variant, meta: m, V, state: 'standing', hits: 0,
      position: new THREE.Vector3(x, y, z), rotY, scale, radius: m.collisionRadius * scale, obj: null, anim: null };
    t.matrix = new THREE.Matrix4().compose(t.position, _q.setFromAxisAngle(_v.set(0, 1, 0), rotY), _s.setScalar(scale));
    this.trees.push(t); this._pool(species, variant).trees.push(t); this._dirty = true; return t;
  }
  _pool(sp, v) {
    const key = sp + v; let p = this.pools.get(key); if (p) return p;
    p = { trees: [], meshes: null, sp, v }; this.pools.set(key, p); return p;
  }
  _buildPool(p) {
    const V = this.lib[p.sp].variants[p.v]; const n = p.trees.length; const piv = new THREE.Matrix4().makeTranslation(0, V.meta.chopHeight, 0);
    const wood = l => mergeGeoms([V[l].stump, V[l].log.clone().applyMatrix4(piv), V[l].branches.clone().applyMatrix4(piv)]);
    const leaves = l => V[l].leaves.clone().applyMatrix4(piv);
    const mk = (geo, mat, shadow) => { const im = new THREE.InstancedMesh(geo, mat, n); im.count = 0; im.frustumCulled = false;
      im.castShadow = shadow && this.castShadow; im.receiveShadow = true; this.group.add(im); return im; };
    p.meshes = {
      lod0: [mk(wood('lod0'), V.lod0.mat_stump, true), mk(leaves('lod0'), V.lod0.mat_leaves, true)],
      lod1: [mk(wood('lod1'), V.lod1.mat_stump, true), mk(leaves('lod1'), V.lod1.mat_leaves, true)],
      lod2: V.lod2.impostor ? [mk(V.lod2.impostor, V.lod2.mat_impostor, false)] : [],
    };
  }
  /** Call each frame (cheap: re-buckets only when the camera moved > 1 m or a tree changed). */
  update(camera, dt) {
    for (const t of this.active) this._animate(t, dt);
    if (!this._dirty && camera.position.distanceToSquared(this._lastCam) < 1) return;
    this._dirty = false; this._lastCam.copy(camera.position);
    const d1 = this.lod1D ** 2, d2 = this.lod2D ** 2;
    for (const p of this.pools.values()) {
      if (!p.meshes) this._buildPool(p);
      const c = { lod0: 0, lod1: 0, lod2: 0 };
      for (const t of p.trees) {
        if (t.state !== 'standing') continue;
        const d = t.position.distanceToSquared(camera.position);
        let l = d < d1 ? 'lod0' : d < d2 || !p.meshes.lod2.length ? 'lod1' : 'lod2';
        for (const im of p.meshes[l]) im.setMatrixAt(c[l], t.matrix); c[l]++;
      }
      for (const l of ['lod0', 'lod1', 'lod2']) for (const im of p.meshes[l]) { im.count = c[l]; im.instanceMatrix.needsUpdate = true; }
    }
  }
  /** Push a point (Vector3, xz) out of every trunk / stump cylinder. */
  collide(pos, radius = 0.35) {
    for (const t of this.trees) {
      if (t.state === 'gone') continue;
      const dx = pos.x - t.position.x, dz = pos.z - t.position.z, r = t.radius + radius, d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
    }
    return pos;
  }
  /** Find the choppable tree in front of the player. Returns { tree, point, approachPoint, distance } or null. */
  pick(origin, forward, reach = 1.6, coneDot = 0.6) {
    let best = null;
    const f = _v.set(forward.x, 0, forward.z).normalize().clone();
    for (const t of this.trees) {
      if (t.state !== 'standing' && t.state !== 'chopping') continue;
      const to = new THREE.Vector3(t.position.x - origin.x, 0, t.position.z - origin.z);
      const dist = to.length() - t.radius; if (dist > reach) continue;
      const dot = to.clone().normalize().dot(f); if (dot < coneDot) continue;
      const score = dist - dot;
      if (!best || score < best.score) {
        const dir = to.normalize();
        best = { tree: t, score, distance: dist,
          point: t.position.clone().addScaledVector(dir, -t.radius).setY(t.position.y + t.meta.chopHeight * t.scale),
          approachPoint: t.position.clone().addScaledVector(dir, -(t.meta.approachDistance * t.scale)) };
      }
    }
    return best;
  }
  /** Swap a pooled tree out to its own meshes (done automatically on first hit). */
  activate(t) {
    if (t.obj) return t.obj;
    const V = t.V, m = t.meta, still = { ...WIND, uWindStrength: { value: WIND.uWindStrength.value } };
    const mat = k => { const src = V.lod0['mat_' + k]; if (k.endsWith('cap')) return src; const c = src.clone(); applyWind(c, still); return c; };
    const root = new THREE.Group(); root.name = `${t.species}_v${t.variant}_#${t.id}`; root.matrixAutoUpdate = false; root.matrix.copy(t.matrix);
    const mesh = k => { const o = new THREE.Mesh(V.lod0[k], mat(k)); o.name = k; o.castShadow = this.castShadow; o.receiveShadow = true; return o; };
    const stump = mesh('stump'), stumpCap = mesh('stump_cap'); stumpCap.visible = false;
    const hinge = new THREE.Group(); hinge.name = 'fall_hinge'; hinge.position.set(0, m.chopHeight, 0);
    const inner = new THREE.Group(); inner.name = 'fall_pivot'; hinge.add(inner);
    const log = mesh('log'), logCap = mesh('log_cap'), br = mesh('branches'), lv = mesh('leaves'); logCap.visible = false;
    inner.add(log, logCap, br, lv); root.add(stump, stumpCap, hinge);
    this.group.add(root); t.obj = { root, stump, stumpCap, hinge, inner, log, logCap, branches: br, leaves: lv, wind: still };
    t.state = 'chopping'; this._dirty = true; this.active.add(t); t.anim = { shake: 0 };
    return t.obj;
  }
  /** One axe hit. `fromDir` = world direction the swing travels (player -> tree). Returns { felled, hits, hitsToFell }. */
  hit(t, fromDir, power = 1) {
    if (t.state !== 'standing' && t.state !== 'chopping') return { felled: false };
    this.activate(t); t.hits += power; t.anim.shake = 1; t.obj.wind.uWindStrength.value = WIND.uWindStrength.value + 2.5;
    const need = t.meta.hitsToFell;
    if (t.hits >= need) { this.fell(t, fromDir); return { felled: true, hits: t.hits, hitsToFell: need }; }
    return { felled: false, hits: t.hits, hitsToFell: need };
  }
  /** Start the fall (hinge at the trunk edge on the far side; rod-about-base dynamics). */
  fell(t, worldDir) {
    this.activate(t);
    const local = worldDir.clone().setY(0).normalize().applyAxisAngle(_v.set(0, 1, 0), -t.rotY);
    const r = t.meta.trunkRadius;
    const o = t.obj; o.hinge.position.set(local.x * r, t.meta.chopHeight, local.z * r); o.inner.position.set(-local.x * r, 0, -local.z * r);
    o.stumpCap.visible = o.logCap.visible = true;
    const L = Math.max(1, (t.meta.height - t.meta.chopHeight) * 0.45 * t.scale);
    t.state = 'falling'; t.radius = t.meta.trunkRadius * t.scale * 1.05;
    t.anim = { axis: new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), local).normalize(), th: 0.02, w: 0.12, k: 1.5 * 9.81 / L,
      rest: Math.PI / 2 - Math.min(0.25, Math.atan2(t.meta.crownRadius * 0.25, t.meta.height * 0.6)), bounces: 0, twist: (Math.random() - 0.5) * 0.3, shake: 0, onLand: null };
    this._dirty = true;
    return t;
  }
  _animate(t, dt) {
    const a = t.anim, o = t.obj; if (!a || !o) return;
    dt = Math.min(dt, 1 / 30);
    if (t.state === 'chopping') { // trunk shudder after a hit
      a.shake = Math.max(0, a.shake - dt * 3); const s = a.shake * 0.012 * Math.sin(performance.now() * 0.05);
      o.inner.rotation.set(s, 0, s * 0.6);
      o.wind.uWindStrength.value += (WIND.uWindStrength.value - o.wind.uWindStrength.value) * Math.min(1, dt * 2);
      return;
    }
    if (t.state === 'falling') {
      a.w += a.k * Math.sin(a.th) * dt; a.th += a.w * dt;
      if (a.th >= a.rest) { a.th = a.rest; a.w = -a.w * 0.22; a.bounces++; o.wind.uWindStrength.value = 3.5;
        if (a.bounces === 1 && a.onLand) a.onLand(t);
        if (Math.abs(a.w) < 0.06 || a.bounces > 3) { a.w = 0; t.state = 'fallen'; } }
      o.hinge.quaternion.setFromAxisAngle(a.axis, a.th);
      o.inner.rotation.set(0, a.twist * (a.th / a.rest), 0);
    }
    if (t.state === 'fallen') { o.wind.uWindStrength.value *= Math.max(0, 1 - dt * 1.5); if (o.wind.uWindStrength.value < 0.01) { o.wind.uWindStrength.value = 0; this.active.delete(t); t.state = 'stump'; } }
    else if (t.state === 'falling') o.wind.uWindStrength.value *= Math.max(0, 1 - dt * 0.5);
  }
  /** Remove the fallen log/crown (e.g. after it was split into firewood). Stump stays. */
  clearLog(t) { if (t.obj) { t.obj.hinge.visible = false; } }
  /** Counts by state: standing, chopping, falling (in the air), felled (log on the ground + stump). */
  stats() { const s = { standing: 0, chopping: 0, falling: 0, felled: 0 }; for (const t of this.trees) s[t.state === 'fallen' || t.state === 'stump' ? 'felled' : t.state]++; return s; }
}
