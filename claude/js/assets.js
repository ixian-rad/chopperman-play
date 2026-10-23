// Asset loading for the v2 pack: one GLTFLoader (meshopt + quantization + webp), a shared
// loading tracker for the progress screen, a URL cache, and helpers that scale the ~0.95-unit
// props to real-world sizes and turn repeated props into InstancedMeshes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();

// Progress: every request counts once; listeners get (done, total, label).
export const progress = {
  done: 0, total: 0, listeners: new Set(), label: '',
  add(label) { this.total++; this.label = label; this.emit(); },
  finish() { this.done++; this.emit(); },
  emit() { for (const fn of this.listeners) fn(this.done, this.total, this.label); },
};

const cache = new Map();
export function loadGLB(url) {
  if (!cache.has(url)) {
    progress.add(url.split('/').pop());
    const p = loader.loadAsync(url).then((g) => { progress.finish(); return g; }, (e) => { progress.finish(); throw e; });
    cache.set(url, p);
  }
  return cache.get(url);
}

const texCache = new Map();
export function loadTexture(url, { srgb = true } = {}) {
  if (!texCache.has(url)) {
    progress.add(url.split('/').pop());
    texCache.set(url, texLoader.loadAsync(url).then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      progress.finish();
      return t;
    }, (e) => { progress.finish(); throw e; }));
  }
  return texCache.get(url);
}

// KHR_mesh_quantization stores attributes as normalised integers; transforming those in place
// clamps and re-quantises them, so bake to Float32 first.
export function floatGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const n = a.count, size = a.itemSize, arr = new Float32Array(n * size);
    for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(i, k); // denormalised by three
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (src.index) g.setIndex(src.index.clone());
  for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  return g;
}
// First mesh of a (single-mesh) GLB, with its node transform baked into a geometry copy.
export function firstMesh(gltf) {
  let mesh = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  return mesh;
}

// Normalised prop template: geometry baked so the model stands on y = 0, centred in x/z, scaled
// so its height (or length / width) matches the real size in metres.
// size: { height } | { length } (longest horizontal) | { scale }.
export function propTemplate(gltf, size) {
  const src = firstMesh(gltf);
  const geo = floatGeometry(src.geometry);
  geo.applyMatrix4(src.matrixWorld);
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const s = new THREE.Vector3();
  b.getSize(s);
  let k = 1;
  if (size.height) k = size.height / s.y;
  else if (size.length) k = size.length / Math.max(s.x, s.z);
  else if (size.width) k = size.width / s.x;
  else if (size.scale) k = size.scale;
  const c = new THREE.Vector3();
  b.getCenter(c);
  geo.translate(-c.x, -b.min.y, -c.z);
  geo.scale(k, k, k);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mat = src.material;
  return { geo, mat, size: geo.boundingBox.getSize(new THREE.Vector3()) };
}

// Simplified index buffer for any (float or quantised) geometry, via meshoptimizer (WASM). The
// result shares every vertex attribute with the source (skin weights included), so it can be
// swapped onto the same Mesh / SkinnedMesh. ratio: fraction of triangles to keep; error: allowed
// deviation relative to the mesh extents; maxTris: hard budget.
export async function simplifiedGeometry(geo, { ratio = 0.28, error = 0.025, maxTris = Infinity, sloppy = false } = {}) {
  await MeshoptSimplifier.ready;
  const pa = geo.attributes.position;
  const pos = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) { pos[i * 3] = pa.getX(i); pos[i * 3 + 1] = pa.getY(i); pos[i * 3 + 2] = pa.getZ(i); }
  const src = geo.index ? geo.index.array : Uint32Array.from({ length: pa.count }, (_, i) => i);
  const idx = src instanceof Uint32Array ? src : new Uint32Array(src);
  const target = Math.max(3, Math.floor(Math.min(idx.length * ratio, maxTris * 3) / 3) * 3);
  let [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, error);
  // Meshy meshes are split along every UV seam, so the topology-preserving pass often stalls
  // well above the budget (seams count as locked borders). Then weld the seams by position and
  // simplify again: each kept corner uses one of its welded twins' UVs, which can smear a texture
  // seam slightly — invisible at Low's render scale.
  if (sloppy && out.length > target * 1.4) {
    const key = new Map(), remap = new Uint32Array(pa.count);
    for (let i = 0; i < pa.count; i++) {
      const k = `${Math.round(pos[i * 3] * 2000)},${Math.round(pos[i * 3 + 1] * 2000)},${Math.round(pos[i * 3 + 2] * 2000)}`;
      let j = key.get(k);
      if (j === undefined) { j = i; key.set(k, i); }
      remap[i] = j;
    }
    const welded = idx.map((v) => remap[v]);
    // Prune (experimental in 0.22) also removes small disconnected pieces (leaf cards, planks),
    // which edge collapses alone can never get rid of.
    // With a large error bound Prune can also delete everything that matters (a plank fence kept
    // 100 of 5k triangles, the tomato beds 37 of 10k, one landmark 0), so a result is only taken if
    // it keeps at least half the budget; otherwise the plain welded pass, then the safe one.
    MeshoptSimplifier.useExperimentalFeatures = true;
    const enough = (a) => a.length >= Math.min(out.length, target) * 0.5;
    let w = null;
    try { [w] = MeshoptSimplifier.simplify(welded, pos, 3, target, error, ['Prune']); } catch { w = null; }
    if (!w || !enough(w)) [w] = MeshoptSimplifier.simplify(welded, pos, 3, target, error);
    if (enough(w) && w.length < out.length) out = w;
  }
  const lo = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) lo.setAttribute(k, a);
  lo.setIndex(new THREE.BufferAttribute(out, 1));
  if (!geo.boundingBox) geo.computeBoundingBox();
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  lo.boundingBox = geo.boundingBox.clone();
  lo.boundingSphere = geo.boundingSphere.clone();
  return lo;
}

// Low-poly copy of a template for the Low / Potato presets: software rasterisers pay a lot per
// vertex, and the Meshy props are 3–12k triangles each.
export async function lowPoly(tpl, ratio = 0.28, error = 0.025, maxTris = Infinity, sloppy = true) {
  if (tpl.geoLo) return tpl.geoLo;
  try {
    tpl.geoLo = await simplifiedGeometry(tpl.geo, { ratio, error, maxTris, sloppy });
  } catch (e) {
    console.warn('simplifier unavailable:', e.message);
    tpl.geoLo = tpl.geo;
  }
  return tpl.geoLo;
}

// One prop instance as a plain mesh.
export function placeProp(tpl, parent, x, z, rotY = 0, { y = 0, scale = 1, cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(tpl.geo, tpl.mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.scale.setScalar(scale);
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.userData.tpl = tpl;
  parent.add(m);
  return m;
}

// Many copies of one prop in one draw call. items: [{ x, z, rotY, y?, scale? }].
export function instanceProp(tpl, parent, items, { cast = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(tpl.geo, tpl.mat, items.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  items.forEach((it, i) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.rotY ?? 0);
    p.set(it.x, it.y ?? 0, it.z);
    s.setScalar(it.scale ?? 1);
    if (it.sy) s.y *= it.sy;
    m4.compose(p, q, s);
    im.setMatrixAt(i, m4);
  });
  im.castShadow = cast;
  im.receiveShadow = receive;
  im.computeBoundingSphere();
  im.userData.tpl = tpl;
  parent.add(im);
  return im;
}
