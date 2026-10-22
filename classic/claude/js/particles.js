// Wood chips (real rigid bodies in Rapier, rendered with an InstancedMesh) and
// sawdust / bark dust (lightweight point particles with drag and ground collision).
import * as THREE from 'three';
import { RAPIER, GROUPS } from './physics.js';
import { dustSprite } from './textures.js';

let MAX_CHIPS = 260;
export function setMaxChips(n) { MAX_CHIPS = n; }

export class Chips {
  constructor(scene, physics) {
    this.physics = physics;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.mat = mat;
    this.mesh = new THREE.InstancedMesh(geo, mat, 400);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // Initialise the colour buffer.
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    this.list = [];
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  // opts.splinter: long thin fibres torn from the split faces; opts.bark: fraction of bark bits;
  // opts.colors: [wood rgb, bark rgb] (0..1).
  burst(origin, normal, edgeDir, count, speed, rng, opts = {}) {
    const wood = opts.colors?.[0] ?? [0.78, 0.62, 0.42];
    const barkC = opts.colors?.[1] ?? [0.2, 0.15, 0.12];
    const barkFrac = opts.bark ?? 0.25;
    for (let i = 0; i < count; i++) {
      if (this.list.length >= MAX_CHIPS) this.remove(0);
      const bark = rng.next() < barkFrac;
      let L = rng.float(0.012, 0.05), W = rng.float(0.006, 0.022), T = rng.float(0.0025, 0.006);
      if (opts.splinter) { L = rng.float(0.05, 0.14); W = rng.float(0.004, 0.009); T = rng.float(0.002, 0.004); }
      const side = rng.sign();
      const along = rng.float(-0.12, 0.12);
      const px = origin.x + edgeDir.x * along + normal.x * side * 0.01;
      const py = origin.y + rng.float(0.005, 0.03) - (opts.splinter ? rng.float(0, 0.15) : 0);
      const pz = origin.z + edgeDir.z * along + normal.z * side * 0.01;
      const up = rng.float(1.2, 4.2) * speed * (opts.splinter ? 0.5 : 1);
      const lat = rng.float(0.4, 2.6) * speed * side;
      const fw = rng.float(-1.2, 1.2) * speed;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.float(0, 6.28), rng.float(0, 6.28), rng.float(0, 6.28)));
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(px, Math.max(0.02, py), pz)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(normal.x * lat + edgeDir.x * fw, up, normal.z * lat + edgeDir.z * fw)
          .setAngvel({ x: rng.float(-40, 40), y: rng.float(-40, 40), z: rng.float(-40, 40) })
          .setCcdEnabled(true)
          .setLinearDamping(0.35)
          .setAngularDamping(0.6),
      );
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(L / 2, T / 2, W / 2)
          .setDensity(550)
          .setFriction(this.friction ?? 0.7)
          .setRestitution(0.2)
          .setCollisionGroups(GROUPS.CHIP),
        body,
      );
      const c = bark ? barkC : wood;
      const k = rng.float(0.82, 1.12);
      const color = new THREE.Color().setRGB(c[0] * k, c[1] * k, c[2] * k);
      // Quadratic drag constant ½ρC_dA/m for the wind model.
      const drag = (0.5 * 1.2 * 1.1 * L * W) / (550 * L * W * T);
      this.list.push({ body, size: new THREE.Vector3(L, T, W), color, drag, mass: 550 * L * W * T });
    }
    this.mesh.count = this.list.length;
    this.list.forEach((c, i) => this.mesh.setColorAt(i, c.color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  // Aerodynamic drag toward the wind velocity (light chips really do blow away in a gust).
  applyWind(wind, dt) {
    const ws = Math.hypot(wind.x, wind.z);
    if (ws < 0.5) return;
    for (const c of this.list) {
      const b = c.body;
      if (b.isSleeping() && ws < 6) continue;
      const v = b.linvel();
      const t = b.translation();
      const shelter = Math.min(1, Math.max(0.15, t.y / 0.4)); // less wind right at ground level
      const rx = wind.x * shelter - v.x, rz = wind.z * shelter - v.z, ry = -v.y * 0.2;
      const rel = Math.hypot(rx, ry, rz);
      const k = c.drag * rel * dt * c.mass * 0.35;
      b.applyImpulse({ x: rx * k, y: ry * k, z: rz * k }, true);
    }
  }

  remove(i) {
    const c = this.list[i];
    this.physics.world.removeRigidBody(c.body);
    this.list.splice(i, 1);
  }

  clear() {
    while (this.list.length) this.remove(this.list.length - 1);
    this.mesh.count = 0;
  }

  sync() {
    const { _m, _p, _q } = this;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      const t = c.body.translation(), r = c.body.rotation();
      _p.set(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      _m.compose(_p, _q, c.size);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const MAX_DUST = 2000;

export class Dust {
  constructor(scene) {
    this.pos = new Float32Array(MAX_DUST * 3);
    this.vel = new Float32Array(MAX_DUST * 3);
    this.life = new Float32Array(MAX_DUST);
    this.maxLife = new Float32Array(MAX_DUST);
    this.alpha = new Float32Array(MAX_DUST);
    this.size = new Float32Array(MAX_DUST);
    this.color = new Float32Array(MAX_DUST * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    this.uniforms = { uMap: { value: dustSprite() }, uScale: { value: 400 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        attribute vec3 aColor;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vAlpha = aAlpha;
          vColor = aColor;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.head = 0;
  }

  setViewport(height, pixelRatio) {
    this.uniforms.uScale.value = height * pixelRatio * 0.5;
  }

  burst(origin, count, speed, rng) {
    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % MAX_DUST;
      const a = rng.float(0, Math.PI * 2);
      const s = rng.float(0.2, 1.6) * speed;
      this.pos[i * 3] = origin.x + rng.float(-0.06, 0.06);
      this.pos[i * 3 + 1] = origin.y + rng.float(0, 0.03);
      this.pos[i * 3 + 2] = origin.z + rng.float(-0.06, 0.06);
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = rng.float(0.4, 2.8) * speed;
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      const L = rng.float(0.8, 2.6);
      this.life[i] = L;
      this.maxLife[i] = L;
      this.size[i] = rng.float(0.006, 0.02);
      const bark = rng.next() < 0.2;
      const t = rng.float(0.85, 1.1);
      this.color[i * 3] = (bark ? 0.25 : 0.85) * t;
      this.color[i * 3 + 1] = (bark ? 0.19 : 0.72) * t;
      this.color[i * 3 + 2] = (bark ? 0.15 : 0.52) * t;
    }
    const g = this.points.geometry;
    g.getAttribute('aSize').needsUpdate = true;
    g.getAttribute('aColor').needsUpdate = true;
  }

  update(dt, wind = null) {
    const drag = Math.exp(-2.2 * dt);
    const wx = wind ? wind.x : 0, wz = wind ? wind.z : 0;
    const wk = 1 - Math.exp(-1.4 * dt);
    let any = false;
    for (let i = 0; i < MAX_DUST; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) { this.alpha[i] = 0; any = true; }
        continue;
      }
      any = true;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j] = this.vel[j] * drag + (wx - this.vel[j]) * wk;
      this.vel[j + 2] = this.vel[j + 2] * drag + (wz - this.vel[j + 2]) * wk;
      this.vel[j + 1] = this.vel[j + 1] * drag - 4.5 * dt; // light particles: reduced effective gravity
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.004) {
        this.pos[j + 1] = 0.004;
        this.vel[j + 1] *= -0.15;
        this.vel[j] *= 0.5;
        this.vel[j + 2] *= 0.5;
      }
      this.alpha[i] = Math.min(1, this.life[i] / this.maxLife[i] * 1.6) * 0.9;
    }
    if (any) {
      const g = this.points.geometry;
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('aAlpha').needsUpdate = true;
    }
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.points.geometry.getAttribute('aAlpha').needsUpdate = true;
  }
}

// Hot sparks (steel on steel): additive points with gravity, drag and ground bounces.
const MAX_SPARKS = 500;
export class Sparks {
  constructor(scene) {
    this.pos = new Float32Array(MAX_SPARKS * 3);
    this.vel = new Float32Array(MAX_SPARKS * 3);
    this.life = new Float32Array(MAX_SPARKS);
    this.maxLife = new Float32Array(MAX_SPARKS);
    this.heat = new Float32Array(MAX_SPARKS);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aHeat', new THREE.BufferAttribute(this.heat, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 400 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aHeat;
        uniform float uScale;
        varying float vHeat;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.004 + 0.006 * aHeat) * uScale / max(0.1, -mv.z);
          vHeat = aHeat;
        }`,
      fragmentShader: /* glsl */ `
        varying float vHeat;
        void main() {
          if (vHeat <= 0.0) discard;
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          vec3 c = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.92, 0.6), vHeat);
          gl_FragColor = vec4(c * (2.0 + 6.0 * vHeat), a * min(1.0, vHeat * 2.0));
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.head = 0;
    this.active = 0;
  }

  setViewport(height, pixelRatio) {
    this.uniforms.uScale.value = height * pixelRatio * 0.5;
  }

  burst(origin, count, speed, rng) {
    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % MAX_SPARKS;
      const a = rng.float(0, Math.PI * 2);
      const el = rng.float(0.1, 1.3);
      const s = rng.float(0.4, 1.0) * speed;
      this.pos.set([origin.x, origin.y + 0.005, origin.z], i * 3);
      this.vel.set([Math.cos(a) * Math.cos(el) * s, Math.sin(el) * s, Math.sin(a) * Math.cos(el) * s], i * 3);
      const L = rng.float(0.25, 0.8);
      this.life[i] = L;
      this.maxLife[i] = L;
      this.heat[i] = 1;
    }
    this.active = MAX_SPARKS;
  }

  update(dt, groundY = 0) {
    if (!this.active) return;
    let any = 0;
    const drag = Math.exp(-1.5 * dt);
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) { this.heat[i] = 0; continue; }
      any++;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j] *= drag; this.vel[j + 2] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - 9.81 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < groundY) {
        this.pos[j + 1] = groundY;
        this.vel[j + 1] *= -0.35;
        this.vel[j] *= 0.6; this.vel[j + 2] *= 0.6;
      }
      this.heat[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aHeat').needsUpdate = true;
    if (!any) this.active = 0;
  }

  clear() {
    this.life.fill(0);
    this.heat.fill(0);
    this.points.geometry.getAttribute('aHeat').needsUpdate = true;
  }
}
