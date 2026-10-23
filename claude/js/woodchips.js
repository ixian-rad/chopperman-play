// Wood-chip sprites for tree chopping: point sprites that pick one of the 16 cells of the
// fx_woodchips_sheet_4x4 atlas, spin, fall under gravity and settle on the ground.
// One draw call for all chips; CPU-integrated (a few hundred particles at most).
import * as THREE from 'three';
import { loadTexture } from './assets.js';

const MAX = 360;

const VS = /* glsl */ `
  attribute float aCell, aSize, aAngle, aAlpha;
  uniform float uScale;
  varying float vCell, vAngle, vAlpha;
  #include <fog_pars_vertex>
  void main() {
    vCell = aCell; vAngle = aAngle; vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.05, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FS = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uLight;
  varying float vCell, vAngle, vAlpha;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vAngle), s = sin(vAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
    float cx = mod(vCell, 4.0), cy = floor(vCell / 4.0);
    vec4 t = texture2D(uMap, (vec2(cx, 3.0 - cy) + vec2(p.x, 1.0 - p.y)) / 4.0);
    if (t.a * vAlpha < 0.45) discard;
    gl_FragColor = vec4(t.rgb * uLight, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export class WoodChips {
  constructor(scene) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.cell = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.angle = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aCell', new THREE.BufferAttribute(this.cell, 1));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAngle', new THREE.BufferAttribute(this.angle, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uScale: { value: 400 }, uLight: { value: new THREE.Color(1, 1, 1) } }]);
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, fog: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.list = [];
    loadTexture('assets/art/common/fx_woodchips_sheet_4x4.webp').then((t) => {
      t.generateMipmaps = true;
      this.uniforms.uMap.value = t;
    }).catch(() => {});
  }

  setViewport(height, pixelRatio, camera) {
    // world size (m) → pixels at distance 1
    this.uniforms.uScale.value = (height * pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  }

  // A burst of chips flying back out of the cut. dir = swing direction (player → tree).
  burst(point, dir, n = 24, power = 1) {
    for (let i = 0; i < n; i++) {
      if (this.list.length >= MAX) this.list.shift();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const sp = (1.5 + Math.random() * 3) * power;
      const v = new THREE.Vector3()
        .addScaledVector(dir, -sp * (0.4 + Math.random() * 0.6))
        .addScaledVector(side, (Math.random() - 0.5) * sp * 1.4);
      v.y = 1 + Math.random() * 3.2 * power;
      this.list.push({
        p: point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.12)),
        v, cell: (Math.random() * 16) | 0, size: 0.05 + Math.random() * 0.09, a: Math.random() * 6.28, w: (Math.random() - 0.5) * 24,
        life: 5 + Math.random() * 4, age: 0, rest: false,
      });
    }
  }

  clear() { this.list.length = 0; }

  update(dt, wind = null) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const c = L[i];
      c.age += dt;
      if (c.age > c.life) { L.splice(i, 1); continue; }
      if (c.rest) continue;
      c.v.y -= 9.81 * dt;
      // light chips flutter (quadratic drag) and drift with the wind
      const k = Math.min(1, 1.6 * dt);
      c.v.multiplyScalar(1 - k * 0.5);
      if (wind) { c.v.x += wind.x * 0.25 * dt; c.v.z += wind.z * 0.25 * dt; }
      c.p.addScaledVector(c.v, dt);
      c.a += c.w * dt;
      if (c.p.y < 0.012) { c.p.y = 0.012; c.rest = true; }
    }
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const c = L[i];
      this.pos[i * 3] = c.p.x; this.pos[i * 3 + 1] = c.p.y; this.pos[i * 3 + 2] = c.p.z;
      this.cell[i] = c.cell; this.size[i] = c.size; this.angle[i] = c.a;
      this.alpha[i] = Math.min(1, (c.life - c.age) / 1.5);
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aCell', 'aSize', 'aAngle', 'aAlpha']) this.geo.attributes[k].needsUpdate = true;
    this.points.visible = n > 0 && !!this.uniforms.uMap.value;
  }
}
