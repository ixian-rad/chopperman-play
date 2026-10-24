// The two playable backyards built from the v2 asset pack:
//   'nj'       — New Jersey: the procedural house/fence/patio from environment.js plus the sage shed
//                with its chopping zone (stump on mulch, firewood heap, tarp woodpile), arborvitae
//                hedge, patio set, gas grill, porch swing, recycling bin, gate panels, split rails.
//   'tiraspol' — Tiraspol, Transnistria: a whitewashed house with the grapevine door, plank fence
//                with old iron tools and a horseshoe, mangal, bench, Lada, well, tomato beds,
//                khrushchevka blocks behind and the white-and-gold cathedral far in the distance.
// Each setting gets its own trees_v2 TreeField (choppable), player colliders and footstep surfaces.
// Settings are built lazily (GLBs load in parallel) and kept, so switching back is instant.
import * as THREE from 'three';
import { loadGLB, loadTexture, loader, propTemplate, placeProp, instanceProp, lowPoly } from './assets.js';
import { loadTreeLibrary, TreeField } from '../assets/trees_v2/runtime/trees.js';
import { WIND, updateWind, applyWind } from '../assets/trees_v2/runtime/wind.js';
import { patchScene, patchMaterial, setLowShading, lambertCopy } from './matpatch.js';
import { Rng } from './rng.js';
import { setMipFilter } from './textures.js';

export const SETTINGS = {
  nj: { name: 'NJ backyard', species: ['pine', 'oak', 'maple', 'birch'] },
  tiraspol: { name: 'Tiraspol backyard', species: ['walnut', 'apricot', 'poplar', 'birch'] },
};
export const BOUNDS = { minX: -10.55, maxX: 10.55, minZ: -8.35, maxZ: 12.55 };
// World seed. Every tree's id (its index), species, variant, position, rotation, scale and so its
// hp (meta.hitsToFell) come from Rng(treeSeed(seed, setting)), never Math.random(), so two co-op
// clients build identical yards from the host's (seed, setting). DEFAULT_SEED keeps the classic
// single-player layout of assets-v2.
export const DEFAULT_SEED = 1;
export function treeSeed(seed, setting) {
  if ((seed >>> 0) === DEFAULT_SEED) return setting === 'nj' ? 9101 : 4242;
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ (setting === 'nj' ? 0x51ed : 0x7a11);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const M = 'assets/models/';
const treeLibs = {}; // species -> Promise<lib entry>
function loadSpecies(list) {
  const need = list.filter((s) => !treeLibs[s]);
  if (need.length) {
    const p = loadTreeLibrary(loader, Object.fromEntries(need.map((s) => [s, `assets/trees_v2/models/tree_${s}.glb`])));
    for (const s of need) treeLibs[s] = p.then((lib) => lib[s]);
  }
  return Promise.all(list.map((s) => treeLibs[s])).then((arr) => Object.fromEntries(list.map((s, i) => [s, arr[i]])));
}

// Low / Potato: the pooled trees get a Lambert copy of their bark / leaf / impostor material that
// keeps the wind sway and the weather tint (PBR leaves with alpha cards were the costliest pixels).
const treeLow = new WeakMap();
function lowTreeMat(m) {
  let l = treeLow.get(m);
  if (l) return l;
  l = lambertCopy(m);
  l.alphaToCoverage = false;
  applyWind(l);
  l.customProgramCacheKey = () => 'trees_v2_wind|wx-lambert';
  treeLow.set(m, l);
  return l;
}

// Mark meshes so post.js leaves their shadow flags to us (yard.applyQuality decides).
function ownShadows(root, cast) {
  root.traverse((o) => { if (o.isMesh) { o.userData.castOrig = false; o.userData.yardCast = cast; } });
}

export class YardWorld {
  constructor({ scene, env, physics, block, camera }) {
    Object.assign(this, { scene, env, physics, block, camera });
    this.settings = {}; // id -> built setting
    this.id = null;
    this.quality = null;
    this.time = 0;
    this.seed = DEFAULT_SEED;
    this.libs = {}; // setting id -> species library (kept for rebuilding the trees)
  }

  get cur() { return this.settings[this.id]; }
  get field() { return this.cur?.field ?? null; }

  // Build (once) and show a setting. Resolves when it is visible.
  async setSetting(id) {
    if (!SETTINGS[id]) id = 'nj';
    if (!this.settings[id]) this.settings[id] = this.build(id);
    const S = await this.settings[id];
    this.settings[id] = S;
    for (const [k, v] of Object.entries(this.settings)) if (v.group) v.group.visible = k === id;
    this.id = id;
    const nj = id === 'nj';
    this.env.njGroup.visible = nj;
    if (this.env.procGrill) this.env.procGrill.visible = nj && !S.hasGrill;
    if (this.env.procTable) this.env.procTable.visible = nj && !S.hasPatio;
    this.env.dirt.visible = !S.mulch;
    this.block.visible = !S.blockModel;
    this.env.ground.material.color.set(nj ? 0xffffff : 0xe6dcae);
    if (this.quality) this.applyQuality(this.quality);
    return S;
  }

  async build(id) {
    const group = new THREE.Group();
    group.name = 'setting-' + id;
    group.visible = false;
    this.scene.add(group);
    const S = { id, group, colliders: [], surfaces: [], trees: [], field: null, insideTreeIds: [] };
    const [lib] = await Promise.all([loadSpecies(SETTINGS[id].species), id === 'nj' ? this.buildNJ(S) : this.buildTiraspol(S)]);
    this.libs[id] = lib;
    this.buildTrees(S, lib, this.seed);
    this.circle(S, 2.35, -2.0, 0.12); // the shepherd's-hook lantern (environment.js)
    // Low-poly versions of every prop for the Low / Potato presets.
    // Budgets: repeated props (fence panels, hedge, blocks of flats) and far landmarks get the
    // fewest triangles per copy; a single prop keeps up to ~1.8k.
    const tpls = new Map();
    group.traverse((o) => {
      const t = o.userData.tpl;
      if (!t) return;
      const r = tpls.get(t) ?? { n: 0, far: false };
      r.n += o.isInstancedMesh ? o.count : 1;
      r.far ||= !!o.userData.far;
      tpls.set(t, r);
    });
    await Promise.all([...tpls].map(([t, r]) => (r.n > 1 || r.far
      ? lowPoly(t, 0.2, 0.5, Math.max(400, Math.min(1500, 6000 / r.n)))
      : lowPoly(t, 0.3, 0.05, 1600, false)))); // single props: topology-preserving only (welding tears them)
    ownShadows(group, true);
    patchScene(group);
    return S;
  }

  // ------------------------------------------------------------------ props helpers
  async tpl(path, size) { return propTemplate(await loadGLB(M + path + '.glb'), size); }

  box(S, x, z, hw, hd, rot = 0) { S.colliders.push({ type: 'box', x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot) }); }
  circle(S, x, z, r) { S.colliders.push({ type: 'circle', x, z, r }); }
  // Collider from a template's footprint at a placement (shrink = fraction of the half extents).
  boxFor(S, tpl, x, z, rot = 0, shrink = 0.9, scale = 1) {
    this.box(S, x, z, tpl.size.x * 0.5 * shrink * scale, tpl.size.z * 0.5 * shrink * scale, rot);
  }

  async chopZone(S, stumpPath, stumpSize) {
    const st = await this.tpl(stumpPath, stumpSize);
    // Fit the stump's footprint to the physics block (r = 0.31) so logs sit on its top.
    const k = (0.31 * 2.25) / Math.max(st.size.x, st.size.z);
    const m = placeProp(st, S.group, 0, 0, 0.6, { scale: 1 });
    m.scale.set(k, 0.46 / st.size.y, k);
    S.blockModel = m;
    this.circle(S, 0, 0, 0.42);
  }

  // ------------------------------------------------------------------ New Jersey
  async buildNJ(S) {
    const g = S.group;
    const [shed, tarp, heap, patio, grill, swing, bin, priv, rail, arbor, wheel, chips, halves] = await Promise.all([
      this.tpl('nj/shed_nj', { height: 2.4 }), this.tpl('nj/tarp_woodpile', { height: 1.1 }), this.tpl('nj/firewood_heap_nj', { height: 0.7 }),
      this.tpl('nj/patio_set', { height: 2.4 }), this.tpl('nj/grill_gas', { height: 1.15 }), this.tpl('nj/swing_set', { height: 2.2 }),
      this.tpl('nj/recycling_bin', { height: 1.1 }), this.tpl('nj/fence_privacy', { height: 1.83 }), this.tpl('nj/fence_splitrail', { height: 1.2 }),
      this.tpl('nj/arborvitae', { height: 3.0 }), this.tpl('common/wheelbarrow', { height: 0.7 }), this.tpl('common/chips_scatter', { scale: 1 }),
      this.tpl('common/split_log_halves', { height: 0.28 }),
      this.chopZone(S, 'nj/chopping_stump_nj', { height: 0.46 }),
      this.mulch(S),
    ]);
    // Shed + chopping zone (after the reference photo: stump in front, tarp pile beside the shed).
    placeProp(shed, g, -4.5, -3.7, 0.55);
    this.boxFor(S, shed, -4.5, -3.7, 0.55, 0.95);
    placeProp(tarp, g, -7.3, -2.4, 1.3);
    this.boxFor(S, tarp, -7.3, -2.4, 1.3, 0.9);
    placeProp(heap, g, -1.9, -2.7, 0.3);
    this.circle(S, -1.9, -2.7, 0.7);
    placeProp(chips, g, 0.1, -0.1, 0.4, { y: 0.008, cast: false }).userData.detail = 1;
    placeProp(halves, g, 1.05, 0.55, 2.2, { cast: true }).userData.detail = 1;
    placeProp(wheel, g, 2.4, -2.2, -0.9).userData.detail = 1;
    // Patio: umbrella set + gas grill replace the procedural ones.
    placeProp(patio, g, -1.3, -7.0, 0.2, { y: 0.1 });
    this.circle(S, -1.3, -7.0, 1.15);
    S.hasPatio = true;
    placeProp(grill, g, -4.4, -7.75, 0.15, { y: 0.1 });
    this.boxFor(S, grill, -4.4, -7.75, 0.15);
    S.hasGrill = true;
    placeProp(swing, g, 6.6, 8.6, Math.PI + 0.25);
    this.boxFor(S, swing, 6.6, 8.6, Math.PI + 0.25, 0.85);
    placeProp(bin, g, 7.4, -7.9, -0.4);
    this.circle(S, 7.4, -7.9, 0.4);
    // Gate panels closing the gaps between the house corners and the side fences.
    const gates = [];
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) gates.push({ x: side * (7.65 + i * priv.size.x), z: -7.8, rotY: 0 });
    instanceProp(priv, g, gates);
    this.box(S, 9, -7.8, 2.1, 0.12);
    this.box(S, -9, -7.8, 2.1, 0.12);
    // Split-rail border around the porch swing corner.
    const rails = [];
    for (let i = 0; i < 3; i++) rails.push({ x: 4.0 + i * rail.size.x * 0.98, z: 6.2, rotY: 0 });
    instanceProp(rail, g, rails).userData.detail = 1;
    // Arborvitae hedge along the back fence.
    const rng = new Rng(77);
    const hedge = [];
    for (let x = -9.6; x <= 9.7; x += 1.45) hedge.push({ x: x + rng.float(-0.15, 0.15), z: 12.0 + rng.float(-0.12, 0.12), rotY: rng.float(0, 6.28), scale: rng.float(0.9, 1.15) });
    // every other shrub first, so Low can draw just those (scaled up a little to close the gaps)
    const hedgeOrdered = [...hedge.filter((_, i) => i % 2 === 0), ...hedge.filter((_, i) => i % 2 === 1)];
    instanceProp(arbor, g, hedgeOrdered).userData.lowCount = Math.ceil(hedge.length / 2);
    this.box(S, 0, 12.0, 10.6, 0.55);
    // House + AC unit (procedural, in env.njGroup).
    this.box(S, 0, -9.6, 7.2, 1.25);
    this.box(S, 5.6, -8.25, 0.5, 0.5);
    // Footstep surfaces.
    S.surfaces.push({ type: 'circle', x: 0, z: -0.2, r: 1.9, kind: 'mulch' });
    S.surfaces.push({ type: 'rect', x0: -5.1, x1: 1.1, z0: -9, z1: -5.4, kind: 'hard' });
    S.surfaces.push({ type: 'rect', x0: -9.2, x1: -2.6, z0: -5.4, z1: -1.5, kind: 'mulch' });
  }

  async mulch(S) {
    const tex = await loadTexture('assets/art/nj/tex_mulch_chips_decal.webp');
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.005, -0.25);
    m.receiveShadow = true;
    m.renderOrder = 1;
    S.group.add(m);
    // a second, larger patch under the shed and the tarp pile
    const m2 = m.clone();
    m2.scale.set(1.9, 1.3, 1);
    m2.rotation.z = 0.5;
    m2.position.set(-5.6, 0.004, -3.1);
    S.group.add(m2);
    S.mulch = true;
  }

  // ------------------------------------------------------------------ Tiraspol
  async buildTiraspol(S) {
    const g = S.group;
    const [wall, fence, tools, mangal, bench, lada, well, tomato, khrush, cath, pile, wheel, halves, oldStump] = await Promise.all([
      this.tpl('tiraspol/house_wall_grapevine', { height: 3.0 }), this.tpl('tiraspol/fence_planks', { height: 1.9 }),
      this.tpl('tiraspol/iron_tools_horseshoe', { height: 0.7 }), this.tpl('tiraspol/mangal', { height: 0.85 }),
      this.tpl('tiraspol/bench', { height: 0.85 }), this.tpl('tiraspol/lada_car', { height: 1.45 }), this.tpl('tiraspol/well', { height: 2.2 }),
      this.tpl('tiraspol/tomato_garden', { height: 1.6 }), this.tpl('tiraspol/khrushchevka', { height: 15 }), this.tpl('tiraspol/cathedral', { height: 31 }),
      this.tpl('common/firewood_pile', { height: 0.8 }), this.tpl('common/wheelbarrow', { height: 0.7 }), this.tpl('common/split_log_halves', { height: 0.28 }),
      this.tpl('common/stump', { height: 0.42 }),
      this.chopZone(S, 'common/chopping_block', { height: 0.46 }),
    ]);
    // Whitewashed single-storey house with a green tin roof; the grapevine door vignette in front.
    this.buildHouseT(g);
    placeProp(wall, g, -2.6, -8.75, 0);
    this.box(S, 0, -9.6, 7.4, 1.3);
    placeProp(bench, g, 1.3, -8.15, 0);
    this.boxFor(S, bench, 1.3, -8.15, 0);
    // Plank fence on three sides (instanced), iron tools + horseshoe hung on the left run.
    const runs = [[-10.95, -8.6, -10.95, 12.95], [-10.95, 12.95, 10.95, 12.95], [10.95, 12.95, 10.95, -8.6]];
    const panels = [];
    const w = fence.size.x * 0.985;
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / w);
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      const rot = Math.atan2(-dz, dx);
      for (let i = 0; i < n; i++) {
        const t = Math.min(len - w / 2, (i + 0.5) * w);
        panels.push({ x: x0 + dx * t, z: z0 + dz * t, rotY: rot + (i % 2 ? Math.PI : 0), sy: 1 + ((i * 7) % 5) * 0.012 });
      }
    }
    instanceProp(fence, g, panels);
    placeProp(tools, g, -10.82, -3.2, Math.PI / 2, { y: 0.95 });
    // Courtyard: mangal, the Lada, the well, tomato beds, firewood.
    placeProp(mangal, g, -4.6, -5.6, 0.25);
    this.boxFor(S, mangal, -4.6, -5.6, 0.25);
    placeProp(lada, g, 7.6, -3.6, Math.PI / 2 + 0.06);
    this.boxFor(S, lada, 7.6, -3.6, Math.PI / 2 + 0.06, 0.95);
    placeProp(well, g, 6.4, 6.8, -0.4);
    this.circle(S, 6.4, 6.8, 0.9);
    for (const [x, z, r] of [[-6.2, 9.2, 0.05], [-3.4, 9.4, -0.08]]) {
      placeProp(tomato, g, x, z, r);
      this.boxFor(S, tomato, x, z, r);
    }
    placeProp(pile, g, -7.4, -1.6, 1.4);
    this.boxFor(S, pile, -7.4, -1.6, 1.4);
    placeProp(wheel, g, 2.3, -2.4, -0.7).userData.detail = 1;
    placeProp(halves, g, 1.0, 0.6, 2.0).userData.detail = 1;
    placeProp(oldStump, g, 4.4, 2.6, 1.0);
    this.circle(S, 4.4, 2.6, 0.45);
    // Background: a row of khrushchevka blocks and the cathedral 80–150 m away.
    instanceProp(khrush, g, [
      { x: 22, z: -30, rotY: 0.1 }, { x: 31, z: -28.5, rotY: 0.1 }, { x: 40, z: -27, rotY: 0.1 },
      { x: -32, z: 26, rotY: Math.PI / 2 }, { x: 30, z: 24, rotY: -0.1 },
    ]);
    // ~145 m away, on a sightline just left of the house roof as seen from the chopping block, so
    // its gold domes rise over the fence between the HUD panels.
    const c = placeProp(cath, g, -99, -105, 0.75, { receive: false });
    c.userData.far = true;
    S.cathedral = c;
    // Dusty courtyard dirt around the block.
    S.surfaces.push({ type: 'circle', x: 0, z: -0.3, r: 2.2, kind: 'dirt' });
    S.surfaces.push({ type: 'rect', x0: -7, x1: 9, z0: -8.6, z1: -4.2, kind: 'dirt' });
    this.dirtYard(g);
  }

  buildHouseT(g) {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3f7a62, roughness: 0.45, metalness: 0.55 });
    roofMat.userData.porous = 0.15;
    const trim = new THREE.MeshStandardMaterial({ color: 0x5d7fa8, roughness: 0.7 });
    const W = 14, D = 8, H = 2.9, Z = -9;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
    body.position.set(0, H / 2, Z - D / 2);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.45, D + 0.1), new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 1 }));
    base.position.set(0, 0.22, Z - D / 2);
    g.add(base);
    // hip-ish roof: a 4-sided pyramid frustum
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1, 1, 4, 1), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set((W + 1.2) / Math.SQRT2, 1.6, (D + 1.2) / Math.SQRT2);
    roof.position.set(0, H + 0.8, Z - D / 2);
    roof.castShadow = true;
    g.add(roof);
    // blue-framed windows
    const glass = new THREE.MeshStandardMaterial({ color: 0x23323c, roughness: 0.08, metalness: 0.2 });
    for (const x of [1.8, 4.6]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.45, 0.06), trim);
      f.position.set(x, 1.75, Z + 0.03);
      g.add(f);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.2), glass);
      gl.position.set(x, 1.75, Z + 0.07);
      g.add(gl);
    }
  }

  dirtYard(g) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const grd = x.createRadialGradient(128, 128, 20, 128, 128, 128);
    grd.addColorStop(0, 'rgba(120,98,70,0.95)');
    grd.addColorStop(0.6, 'rgba(126,104,74,0.75)');
    grd.addColorStop(1, 'rgba(126,104,74,0)');
    x.fillStyle = grd;
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      x.fillStyle = `rgba(${70 + Math.random() * 80},${55 + Math.random() * 60},${40 + Math.random() * 40},${Math.random() * 0.5})`;
      const r = Math.random() * 128, a = Math.random() * 6.28;
      x.fillRect(128 + Math.cos(a) * r * 0.9, 128 + Math.sin(a) * r * 0.9, 2, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 6.5), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(1, 0.004, -6.2);
    m.receiveShadow = true;
    g.add(m);
  }

  // ------------------------------------------------------------------ trees
  buildTrees(S, lib, seed = DEFAULT_SEED) {
    const field = new TreeField(this.scene, lib, { lod1Distance: 28, lod2Distance: 70, castShadow: true });
    S.group.add(field.group);
    S.field = field;
    S.seed = seed;
    const rng = new Rng(treeSeed(seed, S.id));
    const R = () => rng.next();
    const inside = S.id === 'nj'
      ? [['maple', 2, -7.4, 8.4], ['birch', 0, 8.0, 3.0], ['birch', 2, 2.6, 8.6], ['pine', 2, 9.2, 10.4], ['oak', 2, 8.7, -4.0],
        ['birch', 1, -9.2, -6.2], ['pine', 1, -3.6, 10.3], ['maple', 1, 1.0, 9.6], ['birch', 2, -5.6, 3.6]]
      : [['walnut', 1, 7.6, 9.6], ['apricot', 0, -7.0, 7.0], ['apricot', 1, 5.4, 7.6], ['apricot', 2, -4.6, 6.4], ['birch', 1, 9.0, 1.4],
        ['walnut', 2, 9.0, -6.6], ['apricot', 2, 0.6, 9.8], ['birch', 2, -1.4, 11.2], ['apricot', 0, -6.6, 9.8]];
    for (const [sp, v, x, z] of inside) {
      const t = field.place(sp, v, x, z, { rotY: R() * Math.PI * 2, scale: 0.9 + R() * 0.2 });
      t.inside = true;
    }
    // Outside the fence: weighted species, spaced by crown size, away from the houses.
    const weights = S.id === 'nj' ? { pine: 3, oak: 2, maple: 3, birch: 2 } : { poplar: 4, walnut: 2, apricot: 2, birch: 2 };
    const pool = Object.entries(weights).flatMap(([s, w]) => Array(w).fill(s));
    const avoid = S.id === 'nj'
      ? [[-12, 30, 8], [13, 31, 8.5], [-27, 2, 8], [27, 0, 8], [0, -13, 11]]
      : [[22, -30, 7], [31, -28.5, 7], [40, -27, 7], [-32, 26, 7], [30, 24, 7], [0, -13, 11], [-99, -105, 26]];
    const placed = field.trees.map((t) => ({ x: t.position.x, z: t.position.z, r: t.meta.crownRadius * 0.55 }));
    let tries = 0;
    while (field.trees.length < 52 && tries++ < 4000) {
      const sp = pool[(R() * pool.length) | 0];
      const v = (R() * 3) | 0;
      const m = lib[sp].variants[v].meta;
      const a = R() * Math.PI * 2, d = 13 + Math.pow(R(), 1.3) * 30;
      let x = Math.cos(a) * d, z = 2 + Math.sin(a) * d;
      // Tiraspol: poplars line the street behind the back fence.
      if (S.id === 'tiraspol' && sp === 'poplar' && R() < 0.6) { x = -24 + R() * 48; z = 16 + R() * 3; }
      if (x > BOUNDS.minX - 1.6 && x < BOUNDS.maxX + 1.6 && z > -9.5 && z < BOUNDS.maxZ + 1.6) continue;
      if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
      // keep the view from the block to the cathedral clear
      if (S.id === 'tiraspol') { const a = Math.atan2(x - 1.85, -(z - 2.75)) * 57.3; if (a > -52 && a < -34 && z < 0) continue; }
      const r = m.crownRadius * 0.55;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.8)) continue;
      placed.push({ x, z, r });
      field.place(sp, v, x, z, { rotY: R() * Math.PI * 2, scale: 0.9 + R() * 0.2 });
    }
    // Keep-order for quality culling: inside trees first, then the nearest outside ones.
    S.order = [...field.trees].sort((a, b) => (b.inside ? 1 : 0) - (a.inside ? 1 : 0) || a.position.length() - b.position.length());
    field.update(this.camera, 0); // builds the instanced pools now so they can be patched
  }

  // Co-op: rebuild the current setting's trees from `seed` with every tree standing and unhurt
  // (a joining guest discards its own felled / damaged trees; the host's state is applied after).
  // Skipped when the field already matches and nothing was touched.
  async resetTrees(seed = this.seed) {
    this.seed = seed >>> 0;
    const S = this.cur;
    if (!S) return null;
    const old = S.field;
    const pristine = old && S.seed === this.seed && old.trees.every((t) => (t.state === 'standing' || (t.state === 'gone' && t.culled)) && !t.hits);
    if (pristine) return old;
    if (old) {
      old.group.removeFromParent();
      for (const p of old.pools.values()) for (const im of p.meshes ? [...p.meshes.lod0, ...p.meshes.lod1, ...p.meshes.lod2] : []) { im.geometry.dispose(); im.dispose?.(); }
      for (const t of old.trees) t.obj?.root.traverse((o) => { if (o.isMesh && o.material !== t.V.lod0['mat_' + o.name]) o.material.dispose?.(); });
    }
    this.buildTrees(S, this.libs[S.id], this.seed);
    ownShadows(S.field.group, true);
    patchScene(S.field.group);
    if (this.quality) this.applyQuality(this.quality);
    return S.field;
  }

  // ------------------------------------------------------------------ per-quality
  applyQuality(P) {
    this.quality = P;
    const S = this.cur;
    if (!S || !S.field) return;
    const f = S.field;
    f.lod1D = P.treeLod1;
    f.lod2D = P.treeLod2;
    S.order.forEach((t, i) => {
      const keep = i < P.trees;
      if (!keep && t.state === 'standing') { t.state = 'gone'; t.culled = true; }
      else if (keep && t.culled && t.state === 'gone') { t.state = 'standing'; t.culled = false; }
    });
    f._dirty = true;
    const lo = !!P.propLow;
    for (const c of S.group.children) if (c !== f.group) setLowShading(c, lo);
    setMipFilter(lo, S.group);
    for (const p of f.pools.values()) {
      for (const im of p.meshes ? [...p.meshes.lod0, ...p.meshes.lod1, ...p.meshes.lod2] : []) {
        if (lo && !im.userData.hiMat && im.material.isMeshStandardMaterial) { im.userData.hiMat = im.material; im.material = lowTreeMat(im.material); }
        else if (!lo && im.userData.hiMat) { im.material = im.userData.hiMat; delete im.userData.hiMat; }
      }
    }
    S.group.traverse((o) => {
      const t = o.userData.tpl;
      if (t) o.geometry = lo && t.geoLo ? t.geoLo : t.geo;
      if (o.isInstancedMesh && o.userData.lowCount) { o.userData.fullCount ??= o.count; o.count = lo ? o.userData.lowCount : o.userData.fullCount; }
      if (o.userData.detail) o.visible = !lo;
    });
    const shadows = P.shadows;
    S.group.traverse((o) => {
      if (!o.isMesh) return;
      let isTree = false;
      for (let q = o.parent; q && !isTree; q = q.parent) isTree = q === f.group;
      const far = o.userData.far;
      o.castShadow = shadows && !far && (isTree ? P.treeShadows : P.propShadows) && o.userData.yardCast !== false;
    });
    f.castShadow = shadows && P.treeShadows;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, camera, weather) {
    this.time += dt;
    updateWind(this.time);
    const w = weather.conditions.wind;
    WIND.uWindStrength.value += (Math.min(2.6, 0.25 + w.speed / 4) - WIND.uWindStrength.value) * Math.min(1, dt);
    if (w.speed > 0.1) WIND.uWindDir.value.set(w.x, w.z).normalize();
    const f = this.field;
    if (f) {
      // TreeField clamps its animation step to 1/30 s, which slows a fall to a crawl at software-GL
      // frame rates; sub-step the active (chopped / falling) trees so they fall in real time.
      const n = Math.min(10, Math.ceil(dt * 30 - 1e-6));
      for (let i = 1; i < n; i++) for (const t of [...f.active]) f._animate(t, dt / n);
      f.update(camera, n > 1 ? dt / n : dt);
      // three.js still issues a draw for an InstancedMesh with count 0 (and the pools are not
      // frustum-culled): 12 pools x 5 LOD meshes were ~55 empty draws per frame on software GL.
      for (const p of f.pools.values()) {
        if (!p.meshes) continue;
        for (const l of ['lod0', 'lod1', 'lod2']) for (const im of p.meshes[l]) im.visible = im.count > 0;
      }
      // Trees that left their instanced pool (chopped) get the weather shading too.
      for (const t of f.active) {
        if (t.wxDone || !t.obj) continue;
        t.wxDone = true;
        t.obj.root.traverse((o) => {
          if (!o.isMesh) return;
          o.userData.castOrig = false;
          o.castShadow = !!this.quality?.shadows;
          // activate() clones bark/leaf materials and re-applies only the wind hook
          const m = o.material;
          if (m && m.onBeforeCompile.__isWind) { m.userData.wxPatched = false; patchMaterial(m); }
        });
      }
    }
  }

  // Push a point (xz) out of trunks, props and the yard bounds.
  collide(p, r = 0.35, queue = []) {
    const S = this.cur;
    if (!S) return p;
    S.field?.collide(p, r);
    for (const c of S.colliders) {
      if (c.type === 'circle') pushCircle(p, c.x, c.z, c.r + r);
      else {
        // into box space
        const dx = p.x - c.x, dz = p.z - c.z;
        let lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
        const hx = c.hw + r, hz = c.hd + r;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
          const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
          if (px < pz) lx = Math.sign(lx || 1) * hx; else lz = Math.sign(lz || 1) * hz;
          p.x = c.x + lx * c.c + lz * c.s;
          p.z = c.z - lx * c.s + lz * c.c;
        }
      }
    }
    for (const q of queue) pushCircle(p, q.x, q.z, q.r + r);
    p.x = Math.min(BOUNDS.maxX - r, Math.max(BOUNDS.minX + r, p.x));
    p.z = Math.min(BOUNDS.maxZ - r, Math.max(BOUNDS.minZ + r, p.z));
    return p;
  }

  surfaceAt(x, z) {
    for (const s of this.cur?.surfaces ?? []) {
      if (s.type === 'circle' ? Math.hypot(x - s.x, z - s.z) < s.r : x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return s.kind;
    }
    return 'grass';
  }

  insideBounds(x, z, m = 0.4) { return x > BOUNDS.minX + m && x < BOUNDS.maxX - m && z > BOUNDS.minZ + m && z < BOUNDS.maxZ - m; }
}

function pushCircle(p, x, z, r) {
  const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
  if (d2 < r * r && d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
}
