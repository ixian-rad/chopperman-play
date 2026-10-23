// Sergey: the rigged, animated player character from the v2 asset pack.
//
// * Two costumes (black tee / blue jacket) share one 24-bone Meshy skeleton. Each costume GLB
//   brings its own six clips; the walking/running armature files add locomotion cycles.
// * Clips are cleaned once: scale tracks and per-bone position tracks are dropped (only the
//   Hips keep a position track), locomotion cycles lose their horizontal root drift, and the
//   armature-only cycles are re-scaled to this model's hip height.
// * An AnimationMixer crossfades between named actions; swings can also be "scrubbed" (the game
//   drives the clip time, so the blade lands exactly when the game's impact happens).
// * The axe is a canonicalised GLB (knob at the origin, handle +Y, blade +X, real length) that
//   rides on a mount under the RightHand bone.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLB, floatGeometry, simplifiedGeometry } from './assets.js';
import { setLowShading, patchScene } from './matpatch.js';

const BASE = 'assets/models/common/';
export const COSTUMES = {
  tee: { name: 'Black tee', url: BASE + 'char_sergey_animated_pbr.glb', walk: BASE + 'char_sergey_walking_armature.glb', run: BASE + 'char_sergey_running_armature.glb' },
  jacket: { name: 'Blue jacket', url: BASE + 'char_sergey_jacket_animated_pbr.glb', walk: BASE + 'char_sergey_jacket_walking_armature.glb', run: BASE + 'char_sergey_jacket_running_armature.glb' },
};

// Axe models. rot: native → "handle along +Y, head up" (radians about Z). len: real length (m).
export const AXE_MODELS = {
  sergey: { name: "Sergey's axe", url: BASE + 'axe_sergey.glb', rotZ: 0, len: 0.8 },
  double_bit: { name: 'Double-bit axe', url: BASE + 'axe_double_bit.glb', rotZ: Math.PI / 2, len: 0.88 },
  maul: { name: 'Splitting maul', url: BASE + 'splitting_maul.glb', rotZ: (120.5 * Math.PI) / 180, len: 0.86, flip: true },
  golden: { name: 'Golden axe', url: BASE + 'axe_golden.glb', rotZ: 0, len: 0.82 },
};

// Swing segments inside the source clips (seconds): start of the lift, top of the backswing,
// the frame range in which the blade comes down, and where the follow-through settles.
export const SWINGS = {
  chop: { clip: 'Charged_Axe_Chop', start: 3.25, top: 4.0, down: [4.0, 4.62], end: 5.3 },
  hammer: { clip: 'Heavy_Hammer_Swing', start: 0.2, top: 1.15, down: [1.15, 1.72], end: 1.79 },
};

// Grip on the RightHand bone (bone units are cm; the mount cancels the armature's 0.01 scale).
const GRIP = new THREE.Vector3(-1.5, 3.5, 0); // heel of the palm
const GRIP_ALONG = 0.06; // handle length behind the grip (m)
const LEFT_GRIP_Y = 0.24; // left hand on the handle in two-handed swings (m from the knob)

const _v = new THREE.Vector3(), _m = new THREE.Matrix4();

// Bake a native axe GLB into the canonical frame and return { mesh, edge, len, headY }.
async function buildAxe(id) {
  const def = AXE_MODELS[id];
  const gltf = await loadGLB(def.url);
  let src = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (!src && o.isMesh) src = o; });
  const geo = floatGeometry(src.geometry);
  geo.applyMatrix4(src.matrixWorld);
  geo.applyMatrix4(_m.makeRotationZ(def.rotZ));
  geo.computeBoundingBox();
  let b = geo.boundingBox;
  const L = b.max.y - b.min.y;
  const pos = geo.getAttribute('position');
  // Centre the handle (lower 45 %) on x = z = 0, knob at y = 0.
  let sx = 0, sz = 0, n = 0;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    if (_v.y < b.min.y + 0.45 * L && _v.y > b.min.y + 0.1 * L) { sx += _v.x; sz += _v.z; n++; }
  }
  geo.translate(-(n ? sx / n : 0), -b.min.y, -(n ? sz / n : 0));
  // Blade side = the side of the head whose extreme is thinnest (the edge); flip it to +X.
  const head = { pos: { x: 0, t: 1 }, neg: { x: 0, t: 1 } };
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    if (_v.y < 0.75 * L) continue;
    if (_v.x > head.pos.x) head.pos.x = _v.x;
    if (_v.x < head.neg.x) head.neg.x = _v.x;
  }
  const thick = (side) => {
    let t = 0;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (_v.y < 0.75 * L) continue;
      if ((side > 0 ? _v.x > head.pos.x * 0.85 : _v.x < head.neg.x * 0.85)) t = Math.max(t, Math.abs(_v.z));
    }
    return t;
  };
  if (def.flip ?? (thick(1) > thick(-1) * 1.05 && id !== 'double_bit')) geo.applyMatrix4(_m.makeRotationY(Math.PI));
  const k = def.len / L;
  geo.scale(k, k, k);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  b = geo.boundingBox;
  // Edge point: middle of the most forward (+X) part of the head.
  let ey = 0, en = 0;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    if (_v.y > 0.7 * def.len && _v.x > b.max.x * 0.85) { ey += _v.y; en++; }
  }
  const edge = new THREE.Vector3(b.max.x, en ? ey / en : def.len * 0.92, 0);
  const mat = src.material;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'axe_' + id;
  return { mesh, edge, len: def.len };
}

// Clean up clips: only quaternions + Hips position; optional root-drift removal / hip rescale.
function cleanClip(clip, name, { inPlace = false, hipScale = 1 } = {}) {
  const tracks = [];
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.');
    if (prop === 'quaternion') tracks.push(t);
    else if (prop === 'position' && bone === 'Hips') {
      const tt = t.clone();
      const v = tt.values;
      if (inPlace || hipScale !== 1) {
        const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) {
          if (inPlace) { v[i] = x0 + (v[i] - x0) * 0.15; v[i + 2] = z0 + (v[i + 2] - z0) * 0.15; }
          v[i + 1] *= hipScale;
        }
      }
      tracks.push(tt);
    }
  }
  const c = new THREE.AnimationClip(name, clip.duration, tracks);
  c.optimize();
  return c;
}

export class Sergey {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); // world placement (yaw only); feet at y = 0
    this.root.name = 'Sergey';
    scene.add(this.root);
    this.models = {}; // costume id -> { model, mixer, actions, hand, mount, clips }
    this.costume = null;
    this.axeId = null;
    this.axes = {};
    this.current = null; // current action name
    this.loaded = false;
    this.scrub = null; // { name, time } while the game drives a swing clip
    this.carry = 0; // 0 = swing grip at the knob, 1 = carried by the throat (head just below the fist)
    this.onFootstep = null;
    this._lastPhase = 0;
    this.low = false;
  }

  get cur() { return this.models[this.costume]; }
  get axe() { return this.axes[this.axeId]; }
  get handBone() { return this.cur?.hand ?? null; }

  loadCostume(id) {
    this._loads ??= {};
    return (this._loads[id] ??= this._loadCostume(id));
  }

  async _loadCostume(id) {
    const def = COSTUMES[id];
    const [g, gw, gr] = await Promise.all([loadGLB(def.url), loadGLB(def.walk), loadGLB(def.run)]);
    const model = g.scene;
    model.updateMatrixWorld(true);
    let hipsRestY = 97;
    const hips = model.getObjectByName('Hips');
    if (hips) hipsRestY = hips.position.y;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) o.material.userData.porous = 0.6;
      }
    });
    const hipMean = (clip) => {
      const t = clip.tracks.find((k) => k.name === 'Hips.position');
      if (!t) return hipsRestY;
      let s = 0;
      for (let i = 1; i < t.values.length; i += 3) s += t.values[i];
      return s / (t.values.length / 3);
    };
    const src = Object.fromEntries(g.animations.map((c) => [c.name, c]));
    const clips = {
      idle: cleanClip(src.Idle, 'Idle'),
      stance: cleanClip(src.Axe_Stance, 'Axe_Stance'),
      chop: cleanClip(src.Charged_Axe_Chop, 'Charged_Axe_Chop'),
      hammer: cleanClip(src.Heavy_Hammer_Swing, 'Heavy_Hammer_Swing'),
      walk: cleanClip(src.Casual_Walk, 'Casual_Walk', { inPlace: true }),
      cheer: cleanClip(src.Victory_Cheer, 'Victory_Cheer'),
    };
    const wc = gw.animations[0], rc = gr.animations[0];
    if (wc) clips.walk2 = cleanClip(wc, 'Walking', { inPlace: true, hipScale: (hipsRestY * 0.985) / hipMean(wc) });
    if (rc) clips.run = cleanClip(rc, 'Running', { inPlace: true, hipScale: (hipsRestY * 0.955) / hipMean(rc) });
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const [k, c] of Object.entries(clips)) actions[k] = mixer.clipAction(c);
    const hand = model.getObjectByName('RightHand');
    const mount = new THREE.Group();
    mount.name = 'axeMount';
    mount.scale.setScalar(100);
    mount.position.copy(GRIP);
    // canonical axe (X blade, Y handle) → hand bone. The Meshy swing clips carry the handle as an
    // extension of the hand's +Y (finger) axis with the edge leading toward −Z.
    mount.quaternion.setFromRotationMatrix(_m.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
    const inner = new THREE.Group();
    inner.name = 'axeInner';
    inner.position.set(0, -GRIP_ALONG, 0);
    mount.add(inner);
    hand?.add(mount);
    const rec = { id, model, mixer, actions, clips, hand, mount, inner, feet: [model.getObjectByName('LeftToeBase'), model.getObjectByName('RightToeBase')], skins: [],
      leftArm: ['LeftArm', 'LeftForeArm', 'LeftHand'].map((n) => model.getObjectByName(n)) };
    // Point on the handle the left hand reaches for in two-handed swings (canonical axe space).
    rec.leftGrip = new THREE.Object3D();
    rec.leftGrip.position.set(0, LEFT_GRIP_Y, 0);
    inner.add(rec.leftGrip);
    // Low / Potato: a simplified skin (~30 % of the 20k triangles; same vertices and skin weights),
    // which also halves his cost in the shadow pass.
    model.traverse((o) => { if (o.isSkinnedMesh) rec.skins.push(o); });
    await Promise.all(rec.skins.map(async (m) => {
      m.userData.geoHi = m.geometry;
      try { m.userData.geoLo = await simplifiedGeometry(m.geometry, { ratio: 0.3, error: 0.01, maxTris: 6500 }); } catch { m.userData.geoLo = m.geometry; }
    }));
    patchScene(model); // weather shading on the PBR skin before a Low Lambert copy is made of it
    this.applyLow(rec);
    this.models[id] = rec;
    return rec;
  }

  setLow(on) {
    this.low = on;
    for (const rec of Object.values(this.models)) this.applyLow(rec);
  }

  applyLow(rec) {
    for (const m of rec.skins) m.geometry = this.low ? m.userData.geoLo : m.userData.geoHi;
    // Lambert skin on Low / Potato (colour map + weather tint; no normal map / specular).
    setLowShading(rec.model, this.low, { skinned: true });
  }

  async loadAxe(id) {
    if (!this.axes[id]) this.axes[id] = buildAxe(id);
    return this.axes[id];
  }

  // Switch costume (keeps the current animation state and the axe).
  async setCostume(id) {
    if (!COSTUMES[id]) id = 'tee';
    const rec = await this.loadCostume(id);
    if (this.costume === id && rec.model.parent === this.root) return rec;
    const prev = this.cur;
    const prevName = this.current;
    if (prev) { this.root.remove(prev.model); prev.mixer.stopAllAction(); }
    this.costume = id;
    this.root.add(rec.model);
    if (this.axeId) await this.setAxe(this.axeId, true);
    this.current = null;
    this.play(prevName ?? 'idle', { fade: 0 });
    this.loaded = true;
    this._blade = null; // blade tables depend on costume + axe
    return rec;
  }

  async setAxe(id, force = false) {
    if (!AXE_MODELS[id]) id = 'sergey';
    const ax = await this.loadAxe(id);
    if (this.axeId === id && !force && ax.mesh.parent === this.cur?.inner) return;
    this.axeId = id;
    const rec = this.cur;
    if (rec) {
      rec.inner.clear();
      rec.inner.add(ax.mesh, rec.leftGrip);
    }
    this._blade = null;
  }

  setAxeVisible(v) { const a = this.axes[this.axeId]; if (a) a.then?.((x) => { x.mesh.visible = v; }); }

  // ------------------------------------------------------------------ animation
  play(name, { fade = 0.25, loop = true, speed = 1, restart = false, from = 0 } = {}) {
    const rec = this.cur;
    if (!rec || !rec.actions[name]) return null;
    this.scrub = null;
    const a = rec.actions[name];
    const prev = this.current ? rec.actions[this.current] : null;
    a.paused = false;
    if (prev === a && !restart) { a.timeScale = speed; return a; }
    a.reset();
    a.time = from;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.timeScale = speed;
    a.setEffectiveWeight(1);
    a.play();
    if (prev && prev !== a && fade > 0) prev.crossFadeTo(a, fade, false);
    else if (prev && prev !== a) prev.stop();
    this.current = name;
    return a;
  }

  // Drive a clip's time directly (swings synced to the game's impact).
  scrubTo(name, time, fade = 0.15) {
    const rec = this.cur;
    if (!rec) return;
    const a = rec.actions[name];
    if (this.current !== name) {
      const prev = this.current ? rec.actions[this.current] : null;
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.setEffectiveWeight(1);
      a.play();
      if (prev && fade > 0) prev.crossFadeTo(a, fade, false);
      else prev?.stop();
      this.current = name;
    }
    a.paused = true;
    a.time = time;
    this.scrub = { name, time };
  }

  get clipTime() { return this.current ? this.cur?.actions[this.current]?.time ?? 0 : 0; }

  update(dt) {
    const rec = this.cur;
    if (!rec) return;
    rec.mixer.update(dt);
    // Slide the grip along the handle: swings hold the knob end, walking carries it by the throat.
    const want = this.scrub || this.current === 'cheer' ? 0 : 1;
    this.carry += (want - this.carry) * Math.min(1, dt * 10);
    const len = AXE_MODELS[this.axeId]?.len ?? 0.8;
    rec.inner.position.y = -GRIP_ALONG - this.carry * (len - 0.2);
    // Two-handed swings: the clips swing a one-handed tool, so pull the left hand onto the handle
    // with a two-bone IK (blended in as the grip slides down to the knob).
    const w = this.scrub && this.ikOn !== false ? 1 - this.carry : 0;
    if (w > 0.02) twoBoneIK(this.root, rec.leftArm, rec.leftGrip, w);
    // Footsteps: a toe reaching its lowest point (descending → rising) while walking/running.
    if (this.onFootstep && (this.current === 'walk' || this.current === 'walk2' || this.current === 'run')) {
      this.root.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) {
        const f = rec.feet[i];
        if (!f) continue;
        const y = f.getWorldPosition(_v).y - this.root.position.y;
        const st = (this._feet ??= [{ y, down: false }, { y, down: false }])[i];
        const dy = y - st.y;
        if (dy < -0.002) st.down = true;
        else if (dy > 0.002 && st.down) { st.down = false; if (st.y < 0.1) this.onFootstep(i, this.current === 'run'); }
        st.y = y;
      }
    }
  }

  // ------------------------------------------------------------------ blade tracking

  // Sample the downswing of a swing kind: [{ t, p: Vector3 }] with p = blade edge in root-local
  // space. Evaluated on a hidden clone of the rig so the visible pose is never disturbed.
  // Cached per costume + axe.
  async bladeTable(kind) {
    const ax = await this.axes[this.axeId];
    const key = `${this.costume}|${this.axeId}|${kind}`;
    this._tables ??= {};
    if (this._tables[key]) return this._tables[key];
    const rec = this.cur;
    if (!rec.sampler) {
      const model = cloneSkinned(rec.model);
      const mixer = new THREE.AnimationMixer(model);
      rec.sampler = { model, mixer, inner: model.getObjectByName('axeInner'), actions: {} };
    }
    const smp = rec.sampler;
    smp.inner.clear();
    const probe = new THREE.Object3D();
    probe.position.copy(ax.edge);
    smp.inner.add(probe);
    const S = SWINGS[kind];
    const clip = rec.clips[kind];
    smp.mixer.stopAllAction();
    const a = smp.mixer.clipAction(clip);
    a.reset().play();
    a.paused = true;
    const rows = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const t = S.down[0] + ((S.down[1] - S.down[0]) * i) / N;
      a.time = t;
      smp.mixer.update(0);
      smp.model.updateMatrixWorld(true);
      rows.push({ t, p: probe.getWorldPosition(new THREE.Vector3()) });
    }
    this._tables[key] = rows;
    return rows;
  }

  // Time in the downswing at which the blade edge first reaches height y (root-local) and the
  // edge position there. Falls back to the lowest sample.
  static impactAt(rows, y) {
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (a.p.y >= y && b.p.y <= y) {
        const k = (a.p.y - y) / Math.max(1e-6, a.p.y - b.p.y);
        return { t: a.t + (b.t - a.t) * k, p: a.p.clone().lerp(b.p, k) };
      }
    }
    let lo = rows[0];
    for (const r of rows) if (r.p.y < lo.p.y) lo = r;
    return { t: lo.t, p: lo.p.clone() };
  }
}

// Two-bone IK (after Daniel Holden's "simple two-joint IK"): rotate shoulder + elbow so the end
// bone reaches the target's world position; w blends from the animated pose (0) to full IK (1).
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
const _x0 = new THREE.Vector3(), _x1 = new THREE.Vector3();
const acosC = (x) => Math.acos(Math.min(1, Math.max(-1, x)));
function twoBoneIK(root, [A, B, C], target, w) {
  if (!A || !B || !C) return;
  root.updateMatrixWorld(true);
  A.getWorldPosition(_a); B.getWorldPosition(_b); C.getWorldPosition(_c); target.getWorldPosition(_t);
  // aim the wrist a little short of the handle so the palm, not the wrist, sits on it
  _t.addScaledVector(_x0.subVectors(_b, _t).normalize(), 0.07);
  A.getWorldQuaternion(_qa); B.getWorldQuaternion(_qb);
  const lab = _b.distanceTo(_a), lcb = _c.distanceTo(_b);
  const lat = Math.min(Math.max(_t.distanceTo(_a), 0.01), lab + lcb - 0.01);
  const ac = _x0.subVectors(_c, _a).normalize(), ab = _x1.subVectors(_b, _a).normalize();
  const ac_ab0 = acosC(ac.dot(ab));
  const ba = new THREE.Vector3().subVectors(_a, _b).normalize(), bc = new THREE.Vector3().subVectors(_c, _b).normalize();
  const ba_bc0 = acosC(ba.dot(bc));
  const at = new THREE.Vector3().subVectors(_t, _a).normalize();
  const ac_at0 = acosC(ac.dot(at));
  const ac_ab1 = acosC((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat));
  const ba_bc1 = acosC((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb));
  const axis0 = new THREE.Vector3().crossVectors(ac, ab).normalize();
  const axis1 = new THREE.Vector3().crossVectors(ac, at).normalize();
  if (axis0.lengthSq() < 0.5) return;
  const iqa = _qa.clone().invert(), iqb = _qb.clone().invert();
  const rot = (bone, axisW, iq, ang) => {
    if (!(Math.abs(ang) > 1e-5) || axisW.lengthSq() < 0.5) return;
    _ax.copy(axisW).applyQuaternion(iq).normalize();
    _q.setFromAxisAngle(_ax, ang * w);
    bone.quaternion.multiply(_q);
  };
  rot(A, axis0, iqa, ac_ab1 - ac_ab0);
  rot(B, axis0, iqb, ba_bc1 - ba_bc0);
  rot(A, axis1, iqa, ac_at0);
  root.updateMatrixWorld(true);
}
