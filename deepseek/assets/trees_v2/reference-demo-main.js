import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadTreeLibrary, TreeField } from '../runtime/trees.js';
import { WIND, updateWind } from '../runtime/wind.js';

const Q = new URLSearchParams(location.search);
const N = +(Q.get('n') || 50);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb9cbe0, 45, 150);
// sky dome
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x4f86c6) }, bot: { value: new THREE.Color(0xdfe9f2) } },
  vertexShader: 'varying vec3 vp; void main(){ vp=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform vec3 top,bot; varying vec3 vp; void main(){ gl_FragColor=vec4(mix(bot,top,pow(max(vp.y,0.),0.6)),1.); }' }));
scene.add(sky);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);
scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x6a5a40, 1.7));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6); sun.position.set(-30, 45, 25); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 140 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; scene.add(sun, sun.target);

// ground: procedural grass
function grassTex() { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#56763a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) { const x = Math.random() * 512, y = Math.random() * 512, l = 30 + Math.random() * 30, h = 75 + Math.random() * 30;
    g.fillStyle = `hsl(${h},${35 + Math.random() * 25}%,${l}%)`; g.fillRect(x, y, 1.2, 2 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// backyard fence + shed
const fenceMat = new THREE.MeshStandardMaterial({ color: 0xcdb48e, roughness: 0.9 });
const YARD = 46;
for (const [x, z, w, d] of [[0, -YARD, 2 * YARD, 0.12], [0, YARD, 2 * YARD, 0.12], [-YARD, 0, 0.12, 2 * YARD], [YARD, 0, 0.12, 2 * YARD]]) {
  const f = new THREE.Mesh(new THREE.BoxGeometry(w, 1.8, d), fenceMat); f.position.set(x, 0.9, z); f.castShadow = f.receiveShadow = true; scene.add(f); }
const shed = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.8 })); shed.position.set(8, 1.3, -10); shed.castShadow = shed.receiveShadow = true; scene.add(shed);
const block = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.38, 0.5, 18), new THREE.MeshStandardMaterial({ color: 0x9a7a52, roughness: 0.9 })); block.position.set(2, 0.25, 4); block.castShadow = true; scene.add(block);

// trees
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const SPECIES = ['pine', 'oak', 'maple', 'birch', 'walnut', 'apricot', 'poplar'];
const t0 = performance.now();
const lib = await loadTreeLibrary(loader, Object.fromEntries(SPECIES.map(s => [s, `../models/tree_${s}.glb`])));
const loadMs = performance.now() - t0;
const field = new TreeField(scene, lib);
// deterministic scatter with spacing scaled by crown radius
let seed = +(Q.get('seed') || 7); const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const placed = [];
if (Q.get('lineup')) { // all species / variants in a row (for the beauty shot)
  SPECIES.forEach((s, i) => { for (let v = 0; v < 3; v++) placed.push(field.place(s, v, (i - 3) * 12.5 + (v - 1) * 2.5, -4 - v * 13, { rotY: rnd() * 6.28 })); });
} else {
  let tries = 0;
  while (placed.length < N && tries++ < 20000) {
    const s = SPECIES[Math.floor(rnd() * SPECIES.length)], v = Math.floor(rnd() * 3), m = lib[s].variants[v].meta;
    const x = (rnd() * 2 - 1) * (YARD - 3), z = (rnd() * 2 - 1) * (YARD - 3);
    if (Math.hypot(x, z - 8) < 7 || Math.hypot(x - 8, z + 10) < 5) continue;
    const r = m.crownRadius * 0.75;
    if (placed.some(p => Math.hypot(p.position.x - x, p.position.z - z) < r + p.meta.crownRadius * 0.75)) continue;
    placed.push(field.place(s, v, x, z, { rotY: rnd() * 6.28, scale: 0.9 + rnd() * 0.2 }));
  }
}

// player
const player = { pos: new THREE.Vector3(0, 0, 14), yaw: 0, pitch: 0.05, vel: new THREE.Vector3() };
if (Q.get('cam')) { const [x, y, z, yaw, pitch] = Q.get('cam').split(',').map(Number); player.pos.set(x, 0, z); player.eye = y; player.yaw = yaw; player.pitch = pitch; }
const keys = {}; addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') chop(); if (e.code.startsWith('Digit')) WIND.uWindStrength.value = [0, 0.6, 1.2, 2.6][+e.key] ?? 1; if (e.code === 'KeyL') lodTint(); });
addEventListener('keyup', e => keys[e.code] = false);
const startEl = document.getElementById('start');
startEl.onclick = () => renderer.domElement.requestPointerLock();
if (Q.get('auto') || Q.get('cam') || Q.get('nostart')) startEl.style.display = 'none';
document.addEventListener('pointerlockchange', () => startEl.style.display = document.pointerLockElement ? 'none' : 'flex');
addEventListener('mousemove', e => { if (!document.pointerLockElement) return; player.yaw -= e.movementX * 0.0022; player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0022, -1.3, 1.3); });
addEventListener('mousedown', () => { if (document.pointerLockElement) chop(); });

// axe (simple view-model) + chips
const axe = new THREE.Group();
const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.75, 8), new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.7 })); handle.position.y = 0.3;
const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.025), new THREE.MeshStandardMaterial({ color: 0x5b6066, metalness: 0.6, roughness: 0.4 })); head.position.set(0.06, 0.64, 0);
axe.add(handle, head); camera.add(axe); scene.add(camera); axe.position.set(0.32, -0.42, -0.55); axe.rotation.set(-0.3, 0, -0.25);
let swing = 0;
const chips = []; const chipGeo = new THREE.BoxGeometry(0.05, 0.015, 0.03), chipMat = new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.9 });
function spawnChips(p, dir) { for (let i = 0; i < 10; i++) { const c = new THREE.Mesh(chipGeo, chipMat); c.position.copy(p); c.userData.v = new THREE.Vector3(-dir.x + (Math.random() - .5) * 1.5, 1 + Math.random() * 2, -dir.z + (Math.random() - .5) * 1.5).multiplyScalar(2); c.userData.life = 1.5; scene.add(c); chips.push(c); } }
const targetEl = document.getElementById('target');
function forward() { return new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)); }
function chop() {
  if (swing > 0) return; swing = 1;
  const hit = field.pick(player.pos, forward(), 1.7);
  if (!hit) return;
  setTimeout(() => {
    const dir = new THREE.Vector3().subVectors(hit.tree.position, player.pos).setY(0).normalize();
    const r = field.hit(hit.tree, dir); spawnChips(hit.point, dir);
    if (r.felled) hit.tree.anim.onLand = t => { thud = 0.6; };
  }, 140);
}
let thud = 0;
let tinted = false; function lodTint() { tinted = !tinted; for (const p of field.pools.values()) if (p.meshes) ['lod0', 'lod1', 'lod2'].forEach((l, i) => p.meshes[l].forEach(im => { im.material = im.material.clone(); im.material.color.set(tinted ? [0xffffff, 0xffd060, 0xff6060][i] : 0xffffff); })); }

// loop
const clock = new THREE.Clock(); let frames = 0, acc = 0, fps = 0, cpuAcc = 0;
const fpsEl = document.getElementById('fps'), infoEl = document.getElementById('info'), countsEl = document.getElementById('counts');
function step(dt) {
  const speed = keys.ShiftLeft ? 7 : 3.6; const f = forward(), r = new THREE.Vector3(-f.z, 0, f.x);
  const mv = new THREE.Vector3(); if (keys.KeyW) mv.add(f); if (keys.KeyS) mv.sub(f); if (keys.KeyD) mv.add(r); if (keys.KeyA) mv.sub(r);
  if (mv.lengthSq()) player.pos.addScaledVector(mv.normalize(), speed * dt);
  field.collide(player.pos, 0.35);
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -YARD + 0.6, YARD - 0.6); player.pos.z = THREE.MathUtils.clamp(player.pos.z, -YARD + 0.6, YARD - 0.6);
  const eye = player.eye ?? 1.7;
  camera.position.set(player.pos.x, eye + (thud > 0 ? Math.sin(thud * 60) * thud * 0.05 : 0), player.pos.z); thud = Math.max(0, thud - dt);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  if (swing > 0) { swing = Math.max(0, swing - dt * 3.2); const s = Math.sin((1 - swing) * Math.PI); axe.rotation.x = -0.3 - s * 1.4; axe.position.y = -0.42 + s * 0.12; }
  for (let i = chips.length - 1; i >= 0; i--) { const c = chips[i]; c.userData.v.y -= 9.8 * dt; c.position.addScaledVector(c.userData.v, dt); c.rotation.x += dt * 9; if (c.position.y < 0.01) { c.position.y = 0.01; c.userData.v.set(0, 0, 0); } if ((c.userData.life -= dt) < 0) { scene.remove(c); chips.splice(i, 1); } }
  updateWind(clock.elapsedTime);
  field.update(camera, dt);
  const hit = field.pick(player.pos, forward(), 1.7);
  if (hit) { targetEl.style.display = 'block'; targetEl.textContent = `${hit.tree.species[0].toUpperCase() + hit.tree.species.slice(1)} (variant ${hit.tree.variant + 1}) — ${hit.tree.hits}/${hit.tree.meta.hitsToFell} hits`; } else targetEl.style.display = 'none';
}
function hud() { const s = field.stats(); countsEl.textContent = `trees ${field.trees.length} · standing ${s.standing} · chopping ${s.chopping} · falling ${s.falling} · felled ${s.felled}`; }
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1); const c0 = performance.now();
  step(dt); renderer.render(scene, camera); cpuAcc += performance.now() - c0;
  frames++; acc += dt;
  if (acc >= 0.5) { fps = frames / acc; fpsEl.textContent = `${fps.toFixed(0)} fps · ${(cpuAcc / frames).toFixed(1)} ms CPU/frame`; frames = 0; acc = 0; cpuAcc = 0;
    const s = field.stats(); hud();
    infoEl.textContent = `draw calls ${renderer.info.render.calls} · tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k · load ${loadMs.toFixed(0)} ms`; }
  if (!window.__manual) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// automation hooks for headless screenshots / tests
window.__demo = { THREE, field, player, camera, chop, step, renderer, scene, lib, get fps() { return fps; },
  render() { renderer.render(scene, camera); }, advance(sec, h = 1 / 30) { window.__manual = true; for (let t = 0; t < sec; t += h) { clock.elapsedTime += h; step(h); } hud(); fpsEl.textContent = 'manual step (screenshot mode)'; renderer.render(scene, camera); }, faceTree(t, dist = 1.2) { const d = new THREE.Vector3().subVectors(player.pos, t.position).setY(0).normalize(); player.pos.copy(t.position).addScaledVector(d, t.radius + dist); player.yaw = Math.atan2(d.x, d.z); } };
window.__ready = true;
