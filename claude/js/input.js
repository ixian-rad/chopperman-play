// Mouse-first controls with a keyboard fallback, plus the 3D aiming reticle on the log top.
//  * Hover the log top: the reticle follows the cursor (strike point); the white line is the
//    split plane along the blade.
//  * Hold LMB: charge the meter; drag horizontally to turn the blade; release to swing.
//    A quick click starts the meter in "click mode" — click again (or Space) to stop it.
//  * Right-drag orbits the camera (OrbitControls), wheel zooms, Shift+wheel turns the blade.
//  * assets v2: while Sergey roams the yard (`yard` = true) the log-aiming handlers stand down and
//    keys go to actions.yardKey first (WASD / Space / E are handled by js/player.js).
import * as THREE from 'three';

export class Input {
  constructor({ dom, camera, controls, game, scene, blockTop, actions }) {
    Object.assign(this, { dom, camera, controls, game, scene, blockTop, actions });
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.press = null;
    this.hoverLog = false;
    this.yard = false;
    this.buildReticle();
    this.bind();
  }

  buildReticle() {
    const g = new THREE.Group();
    const mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -6 });
    this.ringMat = mat(0x9bff8a, 0.9);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.024, 40), this.ringMat);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.004, 16), this.ringMat);
    dot.rotation.x = -Math.PI / 2;
    g.add(dot);
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    this.lineMat = mat(0xffffff, 0.75);
    this.line = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.005), this.lineMat);
    this.line.rotation.x = -Math.PI / 2;
    g.add(this.line);
    this.reticle = g;
    g.renderOrder = 10;
    this.scene.add(g);
    // Pith marker.
    this.pithMat = mat(0xffd27a, 0.5);
    const pith = new THREE.Mesh(new THREE.RingGeometry(0.005, 0.008, 20), this.pithMat);
    pith.rotation.x = -Math.PI / 2;
    this.pith = pith;
    this.scene.add(pith);
  }

  pointerToPlane(e, y) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    this.plane.constant = -y;
    return this.ray.ray.intersectPlane(this.plane, this.hit);
  }

  logTop() {
    const log = this.game.logs.log;
    return log ? this.blockTop + log.params.H : this.blockTop;
  }

  bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointermove', (e) => this.onMove(e));
    d.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    d.addEventListener('wheel', (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.game.rotateBlade(Math.sign(e.deltaY || e.deltaX) * 0.08);
      }
    }, { capture: true, passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  onMove(e) {
    if (this.yard) return;
    const log = this.game.logs.log;
    if (!log) return;
    if (this.press && this.press.button === 0) {
      const dx = e.clientX - this.press.lastX;
      this.press.lastX = e.clientX;
      if (Math.abs(e.clientX - this.press.x) > 6) this.press.dragged = true;
      if (this.press.dragged) this.game.rotateBlade(dx * 0.0065);
      return;
    }
    if (this.game.meter.active) return; // aim is locked while charging
    const p = this.pointerToPlane(e, this.logTop());
    if (!p) return;
    const r = Math.hypot(p.x - log.pos.x, p.z - log.pos.z);
    this.hoverLog = r < log.params.R * 1.25;
    if (this.hoverLog && !this.game.swing.busy) this.game.setAimWorld(p.x, p.z);
  }

  onDown(e) {
    if (e.button !== 0 || this.yard) return;
    const g = this.game;
    // Second click in click mode stops the meter.
    if (g.meter.active && !g.meter.holdMode) {
      g.stopMeter();
      return;
    }
    const log = g.logs.log;
    if (!log) return;
    const p = this.pointerToPlane(e, this.logTop());
    const onLog = p && Math.hypot(p.x - log.pos.x, p.z - log.pos.z) < log.params.R * 1.25;
    if (!onLog) return;
    g.setAimWorld(p.x, p.z);
    if (g.startMeter(true)) {
      this.press = { button: 0, x: e.clientX, lastX: e.clientX, t: performance.now(), dragged: false };
      this.dom.setPointerCapture?.(e.pointerId);
    }
  }

  onUp(e) {
    if (e.button !== 0 || !this.press) return;
    const g = this.game;
    const held = performance.now() - this.press.t;
    const dragged = this.press.dragged;
    this.press = null;
    if (!g.meter.active) return;
    if (held < 220 && !dragged) {
      g.meter.holdMode = false; // quick click: keep the meter running until the next click
      return;
    }
    g.stopMeter();
  }

  onKey(e) {
    const t = e.target;
    if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === 'text')) return;
    const g = this.game;
    const A = this.actions;
    const step = e.shiftKey ? 0.03 : 0.01;
    if (this.yard) {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'Escape') { A.closeModals(); return; }
      if (A.yardKey?.(e.code, e)) return;
      if (e.repeat) return;
      A.key?.(e.code, e);
      return;
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (e.repeat) return;
        if (g.meter.active) g.stopMeter();
        else g.startMeter(false);
        break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        e.preventDefault();
        // Nudge relative to the camera view.
        const f = new THREE.Vector3();
        this.camera.getWorldDirection(f);
        f.y = 0;
        f.normalize();
        const r = new THREE.Vector3(-f.z, 0, f.x);
        const v = new THREE.Vector3();
        if (e.code === 'ArrowLeft') v.addScaledVector(r, -step);
        if (e.code === 'ArrowRight') v.addScaledVector(r, step);
        if (e.code === 'ArrowUp') v.addScaledVector(f, step);
        if (e.code === 'ArrowDown') v.addScaledVector(f, -step);
        g.nudgeAim(v.x, v.z);
        break;
      }
      case 'KeyQ': g.rotateBlade(-0.13); break;
      case 'KeyE': g.rotateBlade(0.13); break;
      case 'Escape':
        // Esc cancels the meter, then closes dialogs, then leaves the block for the yard.
        if (g.meter.active) g.cancelMeter();
        else if (A.modalOpen?.()) A.closeModals();
        else A.leaveStump?.();
        break;
      default:
        if (e.repeat) return;
        A.key?.(e.code, e);
    }
  }

  // Per-frame reticle update.
  update() {
    const g = this.game;
    const log = g.logs.log;
    const show = !this.yard && log && log.ready && !g.swing.busy && g.swing.state === 'ready';
    this.reticle.visible = !!show;
    const fog = g.weather.conditions.fog > 0.03;
    this.pith.visible = !!show && !fog;
    if (!show) return;
    const y = this.blockTop + log.params.H + 0.0015;
    const ax = log.pos.x + g.aim.dx + g.sway.x, az = log.pos.z + g.aim.dz + g.sway.z;
    this.reticle.position.set(ax, y, az);
    this.reticle.rotation.y = g.aim.yaw;
    const R = log.params.R;
    // Split line (along the blade, local +Z) spans the chord through the aim point.
    this.line.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    const off = Math.hypot(g.aim.dx, g.aim.dz) / R;
    const n = { x: Math.cos(g.aim.yaw), z: -Math.sin(g.aim.yaw) };
    const e = Math.abs(n.x * g.aim.dx + n.z * g.aim.dz) / R;
    const chord = 2 * R * Math.sqrt(Math.max(0.05, 1 - Math.min(1, e) ** 2)) + 0.02;
    this.line.scale.x = chord;
    this.ringMat.color.setHSL(0.33 * Math.max(0, 1 - off / 0.5), 0.9, 0.6);
    this.pith.position.set(log.pos.x, y, log.pos.z);
  }
}
