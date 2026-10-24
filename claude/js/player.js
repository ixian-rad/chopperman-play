// Sergey in the game: two modes.
//  * 'stump' — the original log-splitting game. The Lagrangian swing (swing.js) still decides
//    everything physical; Sergey is placed so his blade edge, at the clip frame where it reaches
//    the log top, lands on the aimed point, and the swing clip is scrubbed from the physics state
//    (wind-up → top → q-driven downswing), so the blade lands exactly when the game's hit happens.
//  * 'yard'  — free roam: WASD (Shift = run), right-drag / arrow keys to look, wheel to zoom, an
//    over-the-shoulder follow camera with damping that pulls in in front of tree trunks. Trees in
//    front of Sergey are targeted with TreeField.pick; LMB / Space swings at them. E at the
//    chopping block (or a click on it) goes back to the stump; Esc at the stump leaves it.
import * as THREE from 'three';
import { Sergey, SWINGS } from './sergey.js';
import { clamp } from './rng.js';
import { WIND } from '../assets/trees_v2/runtime/wind.js';

const UP = new THREE.Vector3(0, 1, 0);
const WALK_SPEED = 1.75, RUN_SPEED = 4.6;
const WALK_CLIP_SPEED = 1.3, RUN_CLIP_SPEED = 4.3; // ground speed the clips were authored at
const REACH = 1.75;
const easeInOut = (t) => t * t * (3 - 2 * t);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  constructor(ctx) {
    // scene, camera, controls, dom, sergey, world, game, swingCtl, logs, audio, woodchips, dust, env, blockTop, ui
    Object.assign(this, ctx);
    this.mode = 'stump';
    this.pos = new THREE.Vector3(2.4, 0, 2.2);
    this.yaw = Math.PI * 1.15;
    this.speed = 0;
    this.camYaw = this.yaw;
    this.camPitch = 0.16;
    this.camDist = 4.0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.keys = new Set();
    this.act = null; // current yard swing
    this.target = null; // picked tree
    this.cheer = 0;
    this.shake = 0;
    this.stumpT = null;
    this.rows = {};
    this.tween = null;
    this.drag = null;
    this.lastSurface = 'grass';
    this.pending = []; // timed callbacks
    this.coop = null; // co-op adapter (js/coopgame.js): tree hits go to the host while a session exists
    this.buildHighlight();
    this.bind();
    this.sergey.onFootstep = (i, run) => this.footstep(run);
  }

  get busy() { return !!this.act; }
  get swingKind() { return this.game.axeStats.headMass >= 3.4 ? 'hammer' : 'chop'; }

  // Precompute the blade tables for the current costume + axe (both swing kinds).
  async refreshBlade() {
    if (!this.sergey.loaded) return;
    const [c, h] = await Promise.all([this.sergey.bladeTable('chop'), this.sergey.bladeTable('hammer')]);
    this.rows = { chop: c, hammer: h };
    this.impCache = {};
  }

  impact(kind, y) {
    const rows = this.rows[kind];
    if (!rows) return null;
    const key = kind + Math.round(y * 200);
    this.impCache ??= {};
    return (this.impCache[key] ??= Sergey.impactAt(rows, y));
  }

  buildHighlight() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.12, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 5;
    ring.visible = false;
    this.scene.add(ring);
    this.ring = ring;
  }

  // ------------------------------------------------------------------ input
  bind() {
    const d = this.dom;
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
      this.keys.add(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.add('Shift');
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.delete('Shift');
    });
    window.addEventListener('blur', () => this.keys.clear());
    d.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'yard') return;
      if (e.button === 2 || e.button === 1) { this.drag = { x: e.clientX, y: e.clientY }; d.setPointerCapture?.(e.pointerId); return; }
      if (e.button !== 0) return;
      // Click on the chopping block → split logs; anywhere else → swing.
      const p = this.groundPoint(e);
      if (p && Math.hypot(p.x, p.z) < 0.75 && this.pos.length() < 4) { this.ui.enterStump(); return; }
      this.swingAtTree();
    });
    d.addEventListener('pointermove', (e) => {
      if (this.mode !== 'yard' || !this.drag) return;
      this.camYaw -= (e.clientX - this.drag.x) * 0.006;
      this.camPitch = clamp(this.camPitch + (e.clientY - this.drag.y) * 0.004, -0.15, 1.2);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    window.addEventListener('pointerup', () => { this.drag = null; });
    d.addEventListener('wheel', (e) => {
      if (this.mode !== 'yard') return;
      e.preventDefault();
      this.camDist = clamp(this.camDist * (e.deltaY > 0 ? 1.1 : 0.9), 2.2, 10);
    }, { passive: false });
  }

  groundPoint(e) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(UP, -0.4), new THREE.Vector3());
  }

  // Keys routed here by input.js while in yard mode (returns true if handled).
  yardKey(code) {
    if (code === 'KeyE') {
      if (this.nearBlock()) this.ui.enterStump();
      return true;
    }
    if (code === 'Space' || code === 'KeyX') { this.swingAtTree(); return true; }
    if (code === 'KeyC') { this.camYaw = this.yaw; this.camPitch = 0.16; this.camDist = 4; return true; }
    return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(code);
  }

  nearBlock() { return Math.hypot(this.pos.x, this.pos.z) < 2.4; }

  // ------------------------------------------------------------------ modes
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.enabled = mode === 'stump';
    this.ring.visible = false;
    this.target = null;
    if (mode === 'yard') {
      // Start where Sergey stands at the block, facing the same way, camera behind him.
      this.pos.set(this.sergey.root.position.x, 0, this.sergey.root.position.z);
      this.world.collide(this.pos, 0.35, this.queueObstacles());
      this.yaw = this.sergey.root.rotation.y;
      this.camYaw = this.yaw;
      this.camPitch = 0.16;
      this.camDist = 4.0;
      this.camPos.copy(this.camera.position);
      this.camLook.copy(this.controls.target);
      this.act = null;
      this.speed = 0;
      this.sergey.play('idle', { fade: 0.3 });
    } else {
      this.act = null;
      this.stumpT = null;
    }
  }

  queueObstacles() {
    const out = [];
    for (const it of this.game.queue) out.push({ x: it.mesh.position.x, z: it.mesh.position.z, r: it.params.R + 0.05 });
    return out;
  }

  // ------------------------------------------------------------------ yard: chopping trees
  swingAtTree(force = false) {
    if (this.mode !== 'yard' || this.act) return false;
    const field = this.world.field;
    const kind = this.swingKind;
    const S = SWINGS[kind];
    const pick = field ? field.pick(this.pos, this.forward(), REACH, 0.45) : null;
    const g = this.game;
    // Stamina, like a medium swing at the block.
    const cost = g.costFor(0.65);
    let tired = false;
    if (force) g.stamina = Math.max(g.stamina, cost);
    if (g.stamina < cost) { tired = true; g.stamina = 0; } else g.stamina -= cost;
    g.restT = 0;
    const tree = pick?.tree ?? null;
    const chopY = tree ? tree.position.y + tree.meta.chopHeight * tree.scale : 0.55;
    const imp = this.impact(kind, chopY);
    const tHit = imp ? imp.t : (S.down[0] + S.down[1]) / 2;
    const speed = kind === 'chop' ? 1.55 : 1.15;
    this.act = { kind, t: S.start, tHit, speed: speed * (tired ? 0.8 : 1), hitDone: false, tree, pick, tired, startPos: this.pos.clone(), placeTo: null };
    if (tree) {
      // Face the trunk and shuffle to where the blade meets the bark.
      const dir = new THREE.Vector3().subVectors(tree.position, this.pos).setY(0).normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      this.act.yaw = yaw;
      if (imp) {
        const bark = tree.position.clone().addScaledVector(dir, -tree.radius * 0.9);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const to = new THREE.Vector3(bark.x - (imp.p.x * c + imp.p.z * s), 0, bark.z - (-imp.p.x * s + imp.p.z * c));
        if (to.distanceTo(this.pos) < 1.4) this.act.placeTo = to;
      }
    }
    this.audio.windup?.(0.6);
    this.game.emit('swing', { yard: true });
    return true;
  }

  updateSwing(dt) {
    const a = this.act;
    const S = SWINGS[a.kind];
    const prevT = a.t;
    a.t += dt * a.speed;
    if (a.yaw !== undefined) this.yaw += wrap(a.yaw - this.yaw) * Math.min(1, dt * 12);
    if (a.placeTo) {
      const k = clamp((a.t - S.start) / Math.max(0.05, S.top - S.start), 0, 1);
      this.pos.lerpVectors(a.startPos, a.placeTo, easeInOut(k));
      this.pos.y = 0;
    }
    if (prevT < S.top && a.t >= S.top) this.audio.whoosh?.(0.7);
    if (!a.hitDone && a.t >= a.tHit) { a.hitDone = true; a.t = Math.max(a.t, a.tHit); this.treeImpact(a); }
    this.sergey.scrubTo(a.kind, Math.min(a.t, S.end), 0.12);
    if (a.t >= S.end) {
      this.act = null;
      this.sergey.play('idle', { fade: 0.35 });
      a.done?.();
    }
  }

  treeImpact(a) {
    const tree = a.tree;
    if (!tree || (tree.state !== 'standing' && tree.state !== 'chopping')) {
      this.audio.miss?.(false, 0.4);
      return;
    }
    const field = this.world.field;
    const dir = new THREE.Vector3().subVectors(tree.position, this.pos).setY(0).normalize();
    const g = this.game;
    const power = (g.axeStats.treePower ?? 1) * (1 + 0.04 * g.p.skills.strength) * (a.tired ? 0.5 : 1);
    const before = tree.hits;
    // Co-op: chips / sound / wobble play right away; hp and the fall come back from the host.
    const shared = !!this.coop?.active();
    const res = shared ? this.wobble(tree) : field.hit(tree, dir, power);
    a.result = res;
    this.chipFx(tree, dir, power, 1);
    this.shake = Math.max(this.shake, 0.3);
    g.sharpness = g.sharpness - 0.002;
    const need = tree.meta.hitsToFell;
    if (!res.felled && before + 2 * power >= need) this.audio.treeCreak?.(0.45, false);
    if (res.felled) this.onFell(tree, true);
    if (shared) this.coop.hitTree(tree, power);
    this.game.emit('change');
  }

  // Hit feedback at the trunk: chips, dust and the species' thunk (vol < 1 for the partner's hits).
  chipFx(tree, dir, power, vol) {
    const point = tree.position.clone().addScaledVector(dir, -tree.radius);
    point.y = tree.position.y + tree.meta.chopHeight * tree.scale;
    this.woodchips.burst(point, dir, Math.round((18 + 10 * power) * (vol < 1 ? 0.7 : 1)), 0.9 + 0.2 * power);
    this.dust.burst(point, vol < 1 ? 10 : 18, 0.35, this.game.rng);
    this.audio.treeHit?.(tree.species, Math.min(1, 0.55 + 0.25 * power) * vol, tree.meta.trunkRadius);
  }

  // The trunk shudder of a hit without touching its hp (co-op: the host owns the hp).
  wobble(tree) {
    const field = this.world.field;
    field.activate(tree);
    tree.anim.shake = 1;
    tree.obj.wind.uWindStrength.value = WIND.uWindStrength.value + 2.5;
    return { felled: false, hits: tree.hits, hitsToFell: tree.meta.hitsToFell };
  }

  // Co-op: the host reports a hit (hp left). The partner's hits get their own chips and sound.
  applyHit(tree, hp, { mine = false, from = null, instant = false } = {}) {
    if (tree.state !== 'standing' && tree.state !== 'chopping') return;
    const need = tree.meta.hitsToFell;
    if (!instant && !mine) {
      this.wobble(tree);
      const src = from ?? this.pos;
      const dir = new THREE.Vector3(tree.position.x - src.x, 0, tree.position.z - src.z);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      dir.normalize();
      const d = Math.hypot(tree.position.x - this.pos.x, tree.position.z - this.pos.z);
      this.chipFx(tree, dir, 1, clamp(1.4 - d / 14, 0.25, 0.9));
    } else if (instant && hp < need) this.world.field.activate(tree);
    tree.hits = Math.max(tree.hits, need - hp);
  }

  // Co-op: the host says this tree falls (toward dir). instant = it was felled before we joined.
  applyFell(tree, dir, { mine = false, by = '', instant = false } = {}) {
    const field = this.world.field;
    if (tree.state !== 'standing' && tree.state !== 'chopping') return;
    tree.hits = Math.max(tree.hits, tree.meta.hitsToFell);
    field.fell(tree, dir);
    if (instant) {
      // Snap to the felled pose, with the log already bucked (cleared) as it would be by now.
      const A = tree.anim;
      A.th = A.rest; A.w = 0; A.bounces = 4; tree.state = 'fallen';
      tree.obj.hinge.quaternion.setFromAxisAngle(A.axis, A.th);
      field.clearLog(tree);
      return;
    }
    this.onFell(tree, mine, by);
  }

  onFell(tree, mine, by = '') {
    this.audio.treeCreak?.(1, true);
    const size = clamp(tree.meta.height * tree.scale / 14, 0.3, 1.2);
    tree.anim.onLand = (t) => this.onTreeLanded(t, size, mine);
    this.game.toast(mine ? `Timber! ${cap(tree.species)} coming down` : `${by || 'Your partner'} felled a ${tree.species}. Timber!`, 'good');
  }

  onTreeLanded(t, size, mine = true) {
    this.audio.treeFall?.(size);
    this.shake = Math.max(this.shake, 0.6 + 0.6 * size);
    // dust + chips where the crown hits the ground
    const a = t.anim;
    const dir = new THREE.Vector3(0, 1, 0).applyAxisAngle(a.axis, a.th).applyAxisAngle(UP, t.rotY).setY(0).normalize();
    const L = (t.meta.height - t.meta.chopHeight) * t.scale;
    for (const f of [0.35, 0.7]) {
      const p = t.position.clone().addScaledVector(dir, L * f);
      p.y = 0.3;
      this.dust.burst(p, Math.round(60 * size), 1.2, this.game.rng);
      this.woodchips.burst(p, dir, 10, 0.6);
    }
    const field = this.world.field;
    // The log is bucked into rounds for the queue: clear it after a while.
    this.later(22, () => this.world.field === field && t.obj && field.clearLog(t));
    if (!mine) return null; // the partner's tree: their reward, our shared half arrives via onAward
    this.cheer = 2.6;
    return this.game.onTreeFelled(t.species, t.meta, size);
  }

  later(sec, fn) { this.pending.push({ t: sec, fn }); }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  footstep(run) {
    if (this.mode !== 'yard') return;
    let kind = this.world.surfaceAt(this.pos.x, this.pos.z);
    const c = this.weather.conditions;
    if (c.snow > 0.35) kind = 'snow';
    else if (c.wet > 0.5 && kind === 'grass') kind = 'wet';
    this.lastSurface = kind;
    this.audio.footstep?.(kind, run);
  }

  // ------------------------------------------------------------------ per frame
  update(dt, simDt = dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); p.fn(); }
    }
    this.cheer = Math.max(0, this.cheer - dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    if (this.mode === 'yard') this.updateYard(dt);
    else this.updateStump(simDt);
    this.sergey.update(dt);
  }

  updateYard(dt) {
    const k = this.keys;
    // camera turn on arrow keys
    if (k.has('ArrowLeft')) this.camYaw += dt * 2.2;
    if (k.has('ArrowRight')) this.camYaw -= dt * 2.2;
    if (k.has('ArrowUp')) this.camPitch = clamp(this.camPitch - dt, -0.15, 1.2);
    if (k.has('ArrowDown')) this.camPitch = clamp(this.camPitch + dt, -0.15, 1.2);
    const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const m = new THREE.Vector3();
    const modal = this.ui.modalOpen();
    if (!this.act && !modal) {
      if (k.has('KeyW')) m.add(f);
      if (k.has('KeyS')) m.sub(f);
      if (k.has('KeyD')) m.add(r);
      if (k.has('KeyA')) m.sub(r);
    }
    const run = k.has('Shift');
    const tired = this.game.stamina < 0.25 * this.game.maxStamina;
    const want = m.lengthSq() > 0 ? (run && !tired ? RUN_SPEED : tired ? WALK_SPEED * 0.75 : WALK_SPEED) : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * (want > this.speed ? 6 : 9));
    if (m.lengthSq() > 0) {
      m.normalize();
      const ty = Math.atan2(m.x, m.z);
      this.yaw += wrap(ty - this.yaw) * Math.min(1, dt * 10);
      this.moveDir = m.clone();
    }
    if (this.speed > 0.02 && this.moveDir) {
      this.pos.addScaledVector(this.moveDir, this.speed * dt);
    }
    if (this.act) this.updateSwing(dt);
    this.world.collide(this.pos, 0.35, this.queueObstacles());
    this.pos.y = 0;
    // animation
    const S = this.sergey;
    if (!this.act) {
      if (this.cheer > 0 && this.speed < 0.3) S.play('cheer', { fade: 0.3, loop: false, from: 0.2 });
      else if (this.speed > 2.6) S.play('run', { fade: 0.25, speed: clamp(this.speed / RUN_CLIP_SPEED, 0.6, 1.5) });
      else if (this.speed > 0.15) {
        // worn out: the plainer walking cycle at a slower pace; otherwise the casual walk
        const tired = this.game.stamina < 0.25 * this.game.maxStamina;
        S.play(tired ? 'walk2' : 'walk', { fade: 0.3, speed: clamp(this.speed / (tired ? 1.5 : WALK_CLIP_SPEED), 0.4, 1.8) });
      }
      else S.play('idle', { fade: 0.35 });
    }
    S.root.position.copy(this.pos);
    S.root.rotation.y = this.yaw;
    // target + highlight
    this.target = !this.act && this.world.field ? this.world.field.pick(this.pos, this.forward(), REACH, 0.45) : this.target;
    const t = this.target?.tree;
    if (t && (t.state === 'standing' || t.state === 'chopping')) {
      this.ring.visible = true;
      this.ring.position.set(t.position.x, t.position.y + 0.03, t.position.z);
      this.ring.scale.setScalar(t.radius + 0.12);
      this.ring.material.opacity = 0.6 + 0.3 * Math.sin(performance.now() * 0.006);
    } else this.ring.visible = false;
    this.updateFollowCam(dt);
  }

  updateFollowCam(dt, snap = false) {
    const look = new THREE.Vector3(this.pos.x, 1.45, this.pos.z);
    const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    look.addScaledVector(r, 0.42); // over the right shoulder
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    let dist = this.camDist;
    // Pull in in front of tree trunks between Sergey and the camera.
    const field = this.world.field;
    if (field) {
      const ax = look.x, az = look.z, bx = look.x - f.x * cp * dist, bz = look.z - f.z * cp * dist;
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
      for (const t of field.trees) {
        if (t.state === 'gone' || t.state === 'falling' || t.state === 'fallen') continue;
        const wx = t.position.x - ax, wz = t.position.z - az;
        if (wx * wx + wz * wz > (dist + 2) * (dist + 2)) continue;
        const u = clamp((wx * vx + wz * vz) / L2, 0, 1);
        const dx = ax + vx * u - t.position.x, dz = az + vz * u - t.position.z;
        const rr = t.radius + 0.3;
        if (dx * dx + dz * dz < rr * rr && u > 0.05) dist = Math.max(1.2, Math.min(dist, dist * u - 0.35));
        // ... and in front of low crowns (apricots, maples and birches hang down to head height),
        // unless Sergey himself stands under that crown.
        if (t.state !== 'standing' && t.state !== 'chopping') continue;
        const cr = t.meta.crownRadius * t.scale * 0.72, cb = (t.meta.crownBase ?? 2) * t.scale;
        const Dx = ax - t.position.x, Dz = az - t.position.z;
        const c0 = Dx * Dx + Dz * Dz - cr * cr;
        if (c0 < 0) continue;
        const b = 2 * (Dx * vx + Dz * vz), disc = b * b - 4 * L2 * c0;
        if (disc <= 0) continue;
        const ue = (-b - Math.sqrt(disc)) / (2 * L2);
        if (ue > 0.05 && ue < 1 && look.y + sp * dist * ue > cb) dist = Math.max(1.2, Math.min(dist, dist * ue - 0.2));
      }
    }
    const want = new THREE.Vector3(look.x - f.x * cp * dist, Math.max(0.35, look.y + sp * dist), look.z - f.z * cp * dist);
    const kp = snap ? 1 : 1 - Math.exp(-9 * dt), kl = snap ? 1 : 1 - Math.exp(-12 * dt);
    this.camPos.lerp(want, kp);
    this.camLook.lerp(look, kl);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.05, n = performance.now();
      this.camera.position.x += Math.sin(n * 0.091) * s;
      this.camera.position.y += Math.sin(n * 0.077 + 1) * s;
      this.camera.position.z += Math.sin(n * 0.083 + 2) * s;
    }
    this.camera.lookAt(this.camLook);
    this.controls.target.copy(this.camLook);
  }

  snapCamera() { this.updateFollowCam(0, true); }

  // Stump mode: place Sergey from the physics rig and scrub the swing clip. Every axe uses the
  // two-handed overhead stroke here (Heavy_Hammer_Swing lands the blade straight in front of him,
  // like a real splitting blow); between swings he waits in Axe_Stance instead of freezing in the
  // impact frame with the blade on the log.
  updateStump(dt) {
    const sw = this.swingCtl, S = this.sergey;
    if (!S.loaded) return;
    const kind = 'hammer';
    const SW = SWINGS[kind];
    const log = this.logs.log;
    const top = this.blockTop + (log ? log.params.H : 0.36);
    const imp = this.impact(kind, top);
    if (!imp) return;
    const pz = sw.contactZ(top);
    const yaw = sw.rig.yaw;
    const ax = sw.rig.x + Math.sin(yaw) * pz, az = sw.rig.z + Math.cos(yaw) * pz;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    S.root.position.set(ax - (imp.p.x * c + imp.p.z * s), 0, az - (-imp.p.x * s + imp.p.z * c));
    S.root.rotation.y = yaw;
    const tImp = imp.t;
    let t = this.stumpT ?? SW.start;
    let rest = false;
    switch (sw.state) {
      case 'windup': t = SW.start + (SW.top - SW.start) * easeInOut(clamp(sw.t / sw.windDur, 0, 1)); break;
      case 'top': t = SW.top; break;
      case 'down': {
        if (this.qKey !== top) { this.qKey = top; this.qContact = sw.qForEdgeY(top); }
        t = SW.top + (tImp - SW.top) * clamp(sw.q / Math.max(0.05, this.qContact), 0, 1);
        break;
      }
      case 'through': case 'blockStuck': t = Math.min(SW.down[1], Math.max(t, tImp) + dt * 0.9); break;
      case 'embed': case 'stuck': case 'rebound': t = tImp + (SW.down[1] - tImp) * 0.12; break; // blade in the wood
      case 'recover': if (sw.t < 0.3) { t = tImp + (SW.down[1] - tImp) * 0.12; break; } rest = true; break; // wrench, then step back
      default: rest = true; // ready / lift / done
    }
    this.stumpT = rest ? SW.start : t;
    if (rest) {
      if (this.cheer > 0 && sw.state !== 'lift') S.play('cheer', { fade: 0.3, loop: false, from: 0.2 });
      // Axe_Stance from 3 s (he straightens up with the axe in hand; the first half of the clip is a
      // crouch), then the breathing Idle loop until the next swing.
      else if (S.current !== 'stance' && S.current !== 'idle') S.play('stance', { fade: 0.35, loop: false, from: 3.0 });
      else if (S.current === 'stance' && S.clipTime > S.cur.clips.stance.duration - 0.1) S.play('idle', { fade: 0.6 });
    } else S.scrubTo(kind, t, S.current === 'stance' ? 0.18 : 0.12);
  }
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
