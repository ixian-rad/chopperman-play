// Static-geometry batching for the Low / Potato presets. Software rasterisers (SwiftShader,
// llvmpipe) pay a large fixed cost per draw call, and the procedural NJ house, fence and
// neighbourhood are ~260 small meshes. mergeStatic() bakes every plain mesh of a subtree into one
// mesh per material (built once, on first use); setMerged() flips between the batched copy and the
// originals, which the higher presets keep (they want per-mesh culling and shadow flags).
// Static InstancedMeshes are expanded into the batch too: SwiftShader handles many small instances
// very badly (the 443-board privacy fence alone was ~4 ms of a 22 ms Low frame; baked, ~0).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lambertCopy } from './matpatch.js';

const ATTRS = ['position', 'normal', 'uv', 'color'];

function within(o, roots) {
  for (let q = o; q; q = q.parent) if (roots.includes(q)) return true;
  return false;
}
function shown(o, root) {
  for (let q = o; q && q !== root; q = q.parent) if (!q.visible) return false;
  return true;
}

export function mergeStatic(root, { exclude = [] } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    if (!o.geometry?.attributes.position || o.geometry.morphAttributes.position || within(o, exclude) || !shown(o, root)) return;
    if (o.isInstancedMesh && o.count < 1) return;
    const mat = o.userData.hiMat ?? o.material;
    // Per-instance colours become a vertex colour attribute (on a Lambert copy: the batch is only
    // ever shown on the Lambert presets).
    const icol = !!(o.isInstancedMesh && o.instanceColor);
    const names = ATTRS.filter((n) => n !== 'color' && o.geometry.attributes[n]);
    if (icol || o.geometry.attributes.color) names.push('color');
    const key = mat.uuid + '|' + icol + '|' + names.join(',') + '|' + names.map((n) => (n === 'color' && icol ? 3 : o.geometry.attributes[n].itemSize)).join('');
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, names, icol, list: [] }));
    b.list.push(o);
  });
  const group = new THREE.Group();
  group.name = root.name + '-merged';
  group.visible = false;
  const sources = [];
  const m = new THREE.Matrix4();
  const im = new THREE.Matrix4();
  const c = new THREE.Color();
  const piece = (o, inst, names) => {
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    for (const n of names) if (src.attributes[n]) g.setAttribute(n, src.attributes[n].clone());
    const count = src.attributes.position.count;
    if (inst >= 0 && o.instanceColor) {
      o.getColorAt(inst, c);
      const col = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) { col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const idx = src.index ? Array.from(src.index.array) : Array.from({ length: count }, (_, i) => i);
    m.multiplyMatrices(inv, o.matrixWorld);
    if (inst >= 0) { o.getMatrixAt(inst, im); m.multiply(im); }
    if (m.determinant() < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.applyMatrix4(m);
    return g;
  };
  for (const b of buckets.values()) {
    if (b.list.length < 2 && !b.list[0].isInstancedMesh) continue;
    const geos = [];
    for (const o of b.list) {
      if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) geos.push(piece(o, i, b.names));
      else geos.push(piece(o, -1, b.names));
    }
    const geo = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!geo) continue;
    let mat = b.mat;
    if (b.icol) { mat = lambertCopy(b.mat); mat.vertexColors = true; }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = b.list.some((o) => o.receiveShadow);
    mesh.castShadow = false;
    mesh.userData.castOrig = false;
    mesh.renderOrder = b.list[0].renderOrder;
    group.add(mesh);
    sources.push(...b.list);
  }
  root.add(group);
  return { group, sources };
}

export function setMerged(batch, on) {
  if (!batch) return;
  batch.group.visible = on;
  for (const o of batch.sources) o.visible = !on;
}
