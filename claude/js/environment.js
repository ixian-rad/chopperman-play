// Shared backyard base: sky, lights, lawn + grass, the work-area dirt patch, the lantern and the
// woodpile. The procedural New Jersey house, privacy fence, patio, shrubs and neighbourhood live in
// env.njGroup so the Tiraspol setting (js/yard.js) can hide them; trees come from trees_v2.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from './physics.js';
import { Rng, fbm2, smoothstep, lerp } from './rng.js';
import * as T from './textures.js';
import { WX } from './matpatch.js';

export const YARD = { minX: -11, maxX: 11, minZ: -9, maxZ: 13 };
export const HOUSE_Z = -9;

const std = (params) => new THREE.MeshStandardMaterial(params);

function shadowed(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function box(w, h, d, mat, x, y, z, parent) {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

// Texture clone with a repeat that keeps a constant world-space tile size.
function tiled(tex, w, h, tileW, tileH) {
  const t = tex.clone();
  t.repeat.set(w / tileW, h / tileH);
  t.needsUpdate = true;
  return t;
}

// Derive a normal map from a material's colour map (cached per source canvas).
const normalCache = new Map();
function withNormal(mat, strength = 2, scale = 1) {
  const img = mat.map?.image;
  if (!img) return mat;
  const key = img;
  if (!normalCache.has(key)) normalCache.set(key, T.normalFromCanvas(img, strength));
  const n = normalCache.get(key).clone();
  n.repeat.copy(mat.map.repeat);
  n.needsUpdate = true;
  mat.normalMap = n;
  mat.normalScale = new THREE.Vector2(scale, scale);
  return mat;
}

export function createEnvironment({ scene, renderer, physics }) {
  const env = { updaters: [] };
  const rng = new Rng(2024);
  const nj = new THREE.Group();
  nj.name = 'nj-procedural';
  scene.add(nj);
  env.njGroup = nj;

  // ---------------------------------------------------------------- sky + lights
  // (time of day, sky colours, fog and the environment map are driven by weather.js)
  const sunDir = new THREE.Vector3(-0.5, 0.66, 0.56).normalize();
  const sky = new Sky();
  sky.scale.setScalar(5000);
  sky.renderOrder = 50; // after opaque geometry, so early depth test skips covered sky pixels
  const su = sky.material.uniforms;
  su.turbidity.value = 4.5;
  su.rayleigh.value = 1.4;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);
  env.sky = sky;

  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x50683a, 0.45);
  scene.add(hemi);
  env.hemi = hemi;

  const sun = new THREE.DirectionalLight(0xfff0dc, 3.1);
  sun.position.copy(sunDir).multiplyScalar(45);
  sun.target.position.set(0, 0, 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16;
  sc.near = 5; sc.far = 110;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  env.sun = sun;
  env.lamps = [];

  // ---------------------------------------------------------------- ground
  const grassTex = T.grassTexture();
  // Vertex-coloured lawn (mowing stripes in the yard, patchier neighbour lawns). Low / Potato swap
  // in a coarse copy: software rasterisers pay per vertex and the 2 m grid is 29k triangles.
  const makeGroundGeo = (seg) => {
    const geo = new THREE.PlaneGeometry(240, 240, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = fbm2(x / 9, z / 9, 77, 4);
      const inYard = x > YARD.minX && x < YARD.maxX && z > YARD.minZ && z < YARD.maxZ;
      // Mowing stripes inside the yard, patchier neighbour lawns outside.
      const stripe = inYard ? (Math.floor((x + 30) / 1.1) % 2 ? 1.05 : 0.95) : 1;
      const k = (0.82 + 0.36 * n) * stripe;
      const dry = smoothstep(0.62, 0.8, fbm2(x / 14 + 3, z / 14, 78, 3));
      colors[i * 3] = k * lerp(1, 1.35, dry);
      colors[i * 3 + 1] = k * lerp(1, 1.1, dry);
      colors[i * 3 + 2] = k * lerp(1, 0.9, dry);
      uv.setXY(i, x / 10, z / 10);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  };
  const groundGeo = makeGroundGeo(120);
  env.groundGeo = { hi: groundGeo, lo: makeGroundGeo(30) };
  grassTex.repeat.set(4, 4);
  const ground = new THREE.Mesh(groundGeo, withNormal(std({ map: grassTex, vertexColors: true, roughness: 0.95 }), 2.5, 0.8));
  ground.receiveShadow = true;
  scene.add(ground);
  env.groundBody = physics.addStatic(RAPIER.ColliderDesc.cuboid(120, 0.5, 120), [0, -0.5, 0], null, { friction: 0.9, restitution: 0.15 });

  // Worn dirt + sawdust patch around the chopping block.
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), std({
    map: T.dirtPatchTexture(), transparent: true, roughness: 1, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(0, 0.004, -0.35);
  dirt.receiveShadow = true;
  scene.add(dirt);
  env.dirt = dirt;
  env.ground = ground;

  // ---------------------------------------------------------------- grass blades (instanced tufts)
  {
    const tuft = [];
    const nBlades = 6;
    for (let b = 0; b < nBlades; b++) {
      const a = (b / nBlades) * Math.PI * 2 + rng.float(-0.3, 0.3);
      const r = rng.float(0, 0.035);
      const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      const lean = rng.float(0.05, 0.25);
      const dir = rng.float(0, Math.PI * 2);
      const w = 0.006;
      const h = rng.float(0.7, 1.0);
      const px = Math.cos(dir + Math.PI / 2) * w, pz = Math.sin(dir + Math.PI / 2) * w;
      tuft.push(
        ox - px, 0, oz - pz,
        ox + px, 0, oz + pz,
        ox + Math.cos(dir) * lean * h, h, oz + Math.sin(dir) * lean * h,
      );
    }
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(tuft);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const nrm = new Float32Array(pos.length);
    const col = new Float32Array(pos.length);
    for (let i = 0; i < pos.length / 3; i++) {
      nrm[i * 3 + 1] = 1;
      const tip = pos[i * 3 + 1] > 0.1;
      col[i * 3] = tip ? 0.42 : 0.16;
      col[i * 3 + 1] = tip ? 0.62 : 0.30;
      col[i * 3 + 2] = tip ? 0.22 : 0.09;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Lambert (per-vertex lighting) keeps thousands of thin blades cheap on software GL; the
    // weather tint is injected here because the global patch targets standard materials.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = WX.uTime;
      shader.uniforms.uWind = WX.uWind;
      shader.uniforms.uSnowG = WX.uSnow;
      shader.uniforms.uWetG = WX.uWet;
      shader.uniforms.uFrostG = WX.uFrost;
      shader.fragmentShader = 'uniform float uSnowG, uWetG, uFrostG;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.75, uWetG);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.95), clamp(uSnowG * 0.85 + uFrostG * 0.45, 0.0, 1.0));`,
      );
      shader.vertexShader = 'uniform float uTime, uSnowG;\nuniform vec2 uWind;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ws = length(uWind);
          vec2 wd = ws > 0.01 ? uWind / ws : vec2(1.0, 0.0);
          float sway = sin(uTime * (1.9 + ws * 0.25) + ip.x * 0.7 + ip.z * 0.45) + 0.4 * sin(uTime * 3.7 + ip.x * 2.1);
          float bend = 0.05 + 0.025 * ws;
          transformed.y *= 1.0 - 0.85 * uSnowG;
          transformed.x += (sway * bend + wd.x * ws * 0.012) * position.y * position.y;
          transformed.z += (sway * bend * 0.6 + wd.y * ws * 0.012) * position.y * position.y;
        #endif`,
      );
    };
    const count = 16000;
    const mesh = new THREE.InstancedMesh(g, mat, count);
    env.grass = mesh;
    env.grassMax = count;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    while (n < count) {
      const x = rng.float(YARD.minX + 0.2, YARD.maxX - 0.2);
      const z = rng.float(YARD.minZ + 0.6, YARD.maxZ - 0.2);
      if (x > -5.2 && x < 1.2 && z < -5.4) continue; // patio
      const dc = Math.hypot(x, z + 0.35);
      if (dc < 1.25 && rng.next() > smoothstep(0.9, 1.25, dc)) continue; // trampled work area
      if (x < -9.6 && z > 0.2 && z < 5.8) continue; // woodpile
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.float(0, Math.PI * 2));
      const hs = rng.float(0.05, 0.11) * (0.8 + 0.5 * fbm2(x / 3, z / 3, 4, 2));
      s.set(1, hs, 1);
      p.set(x, 0, z);
      m4.compose(p, q, s);
      mesh.setMatrixAt(n++, m4);
    }
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- fence (6 ft wood privacy fence)
  {
    const fenceTex = T.fenceBoardTexture();
    fenceTex.repeat.set(1 / 0.14, 1 / 1.83);
    const boardMat = withNormal(std({ map: fenceTex, roughness: 0.92 }), 3, 0.7);
    const H = 1.83, W = 0.14;
    const shape = new THREE.Shape();
    shape.moveTo(-W / 2, 0);
    shape.lineTo(W / 2, 0);
    shape.lineTo(W / 2, H - 0.03);
    shape.lineTo(W / 2 - 0.03, H);
    shape.lineTo(-W / 2 + 0.03, H);
    shape.lineTo(-W / 2, H - 0.03);
    shape.closePath();
    const boardGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.017, bevelEnabled: false });
    boardGeo.translate(0, 0.04, -0.0085);
    // Fence runs: [x0, z0, x1, z1]
    const runs = [
      [YARD.minX, HOUSE_Z + 1.2, YARD.minX, YARD.maxZ],
      [YARD.minX, YARD.maxZ, YARD.maxX, YARD.maxZ],
      [YARD.maxX, YARD.maxZ, YARD.maxX, HOUSE_Z + 1.2],
    ];
    let total = 0;
    for (const r of runs) total += Math.ceil(Math.hypot(r[2] - r[0], r[3] - r[1]) / (W + 0.004));
    const boards = new THREE.InstancedMesh(boardGeo, boardMat, total);
    const postMat = std({ color: 0x8a6e52, roughness: 0.9, map: fenceTex });
    const posts = [];
    const rails = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();
    let i = 0;
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      const ang = Math.atan2(-dz, dx);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ang);
      // inward normal (towards yard centre)
      let nx = -dz, nz = dx;
      if (nx * (0 - x0) + nz * (2 - z0) < 0) { nx = -nx; nz = -nz; }
      const nb = Math.ceil(len / (W + 0.004));
      for (let b = 0; b < nb && i < total; b++, i++) {
        const t = (b + 0.5) * (W + 0.004);
        p.set(x0 + dx * t - nx * 0.02, 0, z0 + dz * t - nz * 0.02);
        const lean = (rng.next() - 0.5) * 0.008;
        const qb = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean));
        m4.compose(p, qb, one);
        boards.setMatrixAt(i, m4);
        c.setHSL(0.075 + rng.float(-0.012, 0.012), rng.float(0.22, 0.36), rng.float(0.44, 0.6));
        boards.setColorAt(i, c);
      }
      const nPosts = Math.ceil(len / 2.44);
      for (let k = 0; k <= nPosts; k++) {
        const t = Math.min(len, k * 2.44);
        posts.push([x0 + dx * t + nx * 0.06, z0 + dz * t + nz * 0.06]);
      }
      for (const ry of [0.3, 1.0, 1.65]) {
        rails.push({ x: (x0 + x1) / 2 + nx * 0.04, z: (z0 + z1) / 2 + nz * 0.04, len, ang, y: ry });
      }
      // Fence collider (thin wall).
      const cd = RAPIER.ColliderDesc.cuboid(len / 2, H / 2 + 0.05, 0.05);
      physics.addStatic(cd, [(x0 + x1) / 2, H / 2, (z0 + z1) / 2], q.clone(), { friction: 0.7, restitution: 0.2 });
    }
    boards.instanceMatrix.needsUpdate = true;
    if (boards.instanceColor) boards.instanceColor.needsUpdate = true;
    shadowed(boards);
    nj.add(boards);

    const postGeo = new THREE.BoxGeometry(0.09, 1.95, 0.09);
    postGeo.translate(0, 0.975, 0);
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    posts.forEach(([x, z], k) => {
      m4.makeTranslation(x, 0, z);
      postMesh.setMatrixAt(k, m4);
    });
    shadowed(postMesh);
    nj.add(postMesh);
    const railMat = std({ color: 0x9a7a5a, roughness: 0.9 });
    for (const r of rails) {
      const m = box(r.len, 0.085, 0.038, railMat, r.x, r.y, r.z, nj);
      m.rotation.y = r.ang;
    }
  }

  // ---------------------------------------------------------------- house (generic two-storey colonial facade)
  buildHouse(nj, physics, env);

  // ---------------------------------------------------------------- foundation shrubs
  // (yard trees and the arborvitae hedge are trees_v2 / GLB props, see js/yard.js)
  const shrubMat = std({
    map: T.leafClusterTexture([[56, 98, 46], [70, 116, 52], [46, 84, 40]], 58), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85,
  });
  shrubMat.userData.snowMask = 0.7;
  for (const x of [-6.2, 2.0, 4.6, 6.3]) {
    addShrub(nj, { x, z: HOUSE_Z + 0.7, h: rng.float(0.9, 1.2), r: 0.6, cone: false }, shrubMat, rng);
  }

  // ---------------------------------------------------------------- lanterns
  buildLanterns(scene, physics, env, nj);

  // ---------------------------------------------------------------- woodpile along the left fence
  env.woodpile = buildWoodpile(scene, physics, rng);

  // ---------------------------------------------------------------- neighbourhood beyond the fence
  buildNeighbours(nj, rng);

  env.update = (t) => {
    for (const u of env.updaters) u(t);
  };
  return env;
}

// ---------------------------------------------------------------------------------------------

function addShrub(scene, s, leafMat, rng) {
  const cards = [];
  const n = s.cone ? 170 : 60;
  for (let i = 0; i < n; i++) {
    const h = rng.next();
    const rad = s.cone ? s.r * (1 - h * 0.85) : s.r * Math.sin(Math.PI * (0.15 + 0.7 * h));
    const a = rng.float(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * rad;
    const size = rng.float(0.45, 0.7) * (s.cone ? 1 : 0.8);
    const pg = new THREE.PlaneGeometry(size, size);
    pg.rotateX(rng.float(0, Math.PI));
    pg.rotateY(rng.float(0, Math.PI));
    const px = Math.cos(a) * rr, pz = Math.sin(a) * rr, py = 0.15 + h * s.h;
    pg.translate(s.x + px, py, s.z + pz);
    const nrm = pg.getAttribute('normal');
    const nv = new THREE.Vector3(px, 0.4, pz).normalize();
    for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, nv.x, nv.y, nv.z);
    cards.push(pg);
  }
  scene.add(shadowed(new THREE.Mesh(mergeGeometries(cards), leafMat)));
}

function buildHouse(scene, physics, env) {
  const Z = HOUSE_Z, X0 = -7, X1 = 7, WALL_H = 6.0, FOUND = 0.4;
  const W = X1 - X0;
  const sidingTex = T.sidingTexture([200, 196, 182]);
  const sidingMat = withNormal(std({ map: tiled(sidingTex, W, WALL_H, 0.8, 0.8), roughness: 0.75 }), 3, 0.8);
  const trimMat = std({ color: 0xf4f2ec, roughness: 0.55 });
  const foundMat = withNormal(std({ map: tiled(T.concreteTexture(), W, FOUND, 2.5, 2.5), color: 0xb8b2a8, roughness: 0.95 }), 2);
  const glassMat = std({ color: 0x1d2a33, roughness: 0.04, metalness: 0.2, envMapIntensity: 2.2 });
  glassMat.userData.porous = 0.2;
  // Some rooms have the lights on in the evening.
  const litGlass = std({ color: 0x1d2a33, roughness: 0.04, metalness: 0.2, envMapIntensity: 2.2, emissive: 0xffc27a, emissiveIntensity: 0 });
  litGlass.userData.porous = 0.2;
  env.windowMat = litGlass;
  litGlass.userData.noLow = true; // its emissive is animated at night
  const shutterMat = std({ color: 0x2a3b2e, roughness: 0.6 });
  const roofTex = T.shingleTexture();

  const house = new THREE.Group();
  scene.add(house);

  // Back wall (facing the yard), side walls and foundation.
  const back = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(W, WALL_H - FOUND), sidingMat));
  back.position.set(0, FOUND + (WALL_H - FOUND) / 2, Z);
  house.add(back);
  box(W + 0.04, FOUND, 0.12, foundMat, 0, FOUND / 2, Z + 0.04, house);
  const depth = 9;
  for (const sx of [X0, X1]) {
    const side = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(depth, WALL_H), std({ map: tiled(sidingTex, depth, WALL_H, 0.8, 0.8), roughness: 0.75 })));
    side.position.set(sx, WALL_H / 2, Z - depth / 2);
    side.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
    house.add(side);
    // Gable triangle.
    const tri = new THREE.Shape();
    tri.moveTo(-depth / 2, 0);
    tri.lineTo(depth / 2, 0);
    tri.lineTo(0, 2.7);
    tri.closePath();
    const tg = new THREE.ShapeGeometry(tri);
    const uv = tg.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.8, uv.getY(i) / 0.8);
    const tm = shadowed(new THREE.Mesh(tg, std({ map: sidingTex, roughness: 0.75 })));
    tm.position.set(sx, WALL_H, Z - depth / 2);
    tm.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
    house.add(tm);
    // Corner boards.
    box(0.14, WALL_H, 0.14, trimMat, sx, WALL_H / 2, Z - 0.05, house);
  }
  // Roof: two shingle planes over a gable running along X.
  const ridgeY = WALL_H + 2.7, eaveZ = Z + 0.45, ridgeZ = Z - depth / 2;
  const slopeLen = Math.hypot(ridgeZ - eaveZ, ridgeY - (WALL_H - 0.25));
  const roofW = W + 0.7;
  const roofMat = withNormal(std({ map: tiled(roofTex, roofW, slopeLen, 1.6, 1.6), roughness: 0.92 }), 3, 0.9);
  const pitch = Math.atan2(ridgeY - (WALL_H - 0.25), eaveZ - ridgeZ);
  for (const s of [1, -1]) {
    const rp = shadowed(new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.08, slopeLen), roofMat));
    const ez = s > 0 ? eaveZ : ridgeZ * 2 - eaveZ;
    rp.position.set(0, (WALL_H - 0.25 + ridgeY) / 2, (ez + ridgeZ) / 2);
    rp.rotation.x = s > 0 ? pitch : -pitch;
    house.add(rp);
  }
  box(roofW, 0.12, 0.2, std({ color: 0x3c3a38, roughness: 0.9 }), 0, ridgeY + 0.03, ridgeZ, house);
  // Fascia + gutter + downspouts.
  box(roofW, 0.22, 0.04, trimMat, 0, WALL_H - 0.3, eaveZ + 0.02, house);
  const gutterMat = std({ color: 0xeeeeea, roughness: 0.4, metalness: 0.1 });
  box(roofW, 0.12, 0.13, gutterMat, 0, WALL_H - 0.3, eaveZ + 0.1, house);
  for (const x of [X0 + 0.25, X1 - 0.25]) {
    box(0.08, WALL_H - 0.4, 0.06, gutterMat, x, (WALL_H - 0.4) / 2 + 0.1, Z + 0.1, house);
    box(0.08, 0.06, 0.35, gutterMat, x, 0.1, Z + 0.3, house);
  }
  // Chimney.
  box(0.9, 3.4, 0.8, std({ color: 0x8a4b3a, roughness: 0.9 }), X0 + 1.6, ridgeY - 0.5, ridgeZ + 0.8, house);

  // Windows.
  const addWindow = (x, y, w, h, shutters = true, lit = false) => {
    const g = new THREE.Group();
    g.position.set(x, y, Z);
    house.add(g);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lit ? litGlass : glassMat);
    glass.position.z = 0.01;
    g.add(glass);
    const f = 0.07;
    box(w + f * 2, f, 0.08, trimMat, 0, h / 2 + f / 2, 0.04, g);
    box(w + f * 2 + 0.08, 0.05, 0.14, trimMat, 0, -h / 2 - 0.025, 0.07, g); // sill
    box(f, h, 0.08, trimMat, -w / 2 - f / 2, 0, 0.04, g);
    box(f, h, 0.08, trimMat, w / 2 + f / 2, 0, 0.04, g);
    box(w, 0.04, 0.05, trimMat, 0, 0, 0.03, g); // meeting rail
    for (const mx of [-w / 6, w / 6]) box(0.022, h, 0.03, trimMat, mx, 0, 0.025, g);
    box(w, 0.022, 0.03, trimMat, 0, h / 4, 0.025, g);
    box(w, 0.022, 0.03, trimMat, 0, -h / 4, 0.025, g);
    if (shutters) {
      for (const s of [-1, 1]) {
        const sh = box(w * 0.45, h + 0.1, 0.035, shutterMat, s * (w / 2 + f + w * 0.24), 0, 0.03, g);
        for (let k = 0; k < 8; k++) {
          box(w * 0.38, 0.012, 0.012, shutterMat, 0, -h / 2 + (k + 0.5) * (h / 8), 0.022, sh);
        }
      }
    }
  };
  const up = FOUND + 3.95;
  addWindow(-4.4, up, 1.0, 1.45);
  addWindow(0.2, up, 1.0, 1.45);
  addWindow(4.4, up, 1.0, 1.45, true, true);
  addWindow(4.1, FOUND + 1.55, 1.1, 1.35, true, true);
  addWindow(-5.7, FOUND + 1.7, 0.8, 1.0, false);

  // Sliding patio door.
  {
    const g = new THREE.Group();
    g.position.set(-2.1, FOUND, Z);
    house.add(g);
    const dw = 1.9, dh = 2.1;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), litGlass);
    glass.position.set(0, dh / 2, 0.01);
    g.add(glass);
    box(dw + 0.16, 0.09, 0.1, trimMat, 0, dh + 0.045, 0.05, g);
    box(0.08, dh, 0.1, trimMat, -dw / 2 - 0.04, dh / 2, 0.05, g);
    box(0.08, dh, 0.1, trimMat, dw / 2 + 0.04, dh / 2, 0.05, g);
    box(0.07, dh, 0.07, trimMat, 0, dh / 2, 0.04, g);
    box(dw, 0.06, 0.12, std({ color: 0x777777, roughness: 0.5, metalness: 0.4 }), 0, 0.03, 0.06, g);
    box(0.03, 0.25, 0.04, std({ color: 0x222222, metalness: 0.6, roughness: 0.4 }), 0.12, 1.0, 0.09, g);
    // Lamp.
    const lamp = box(0.14, 0.26, 0.12, std({ color: 0x1a1a1a, roughness: 0.5 }), dw / 2 + 0.35, 1.95, 0.08, g);
    const bulbMat = std({ color: 0xfff1c8, emissive: 0xffd590, emissiveIntensity: 0.35 });
    bulbMat.userData.noWeather = true;
    box(0.08, 0.14, 0.08, bulbMat, 0, -0.01, 0.0, lamp);
    const porch = new THREE.PointLight(0xffc98a, 0, 11, 2);
    porch.position.set(dw / 2 + 0.35, 1.9, 0.35);
    g.add(porch);
    env.lamps.push({ light: porch, base: 5, mat: bulbMat, emissive: 3, flicker: false, phase: 0, name: 'porch' });
    // Step.
    box(2.3, 0.2, 0.45, foundMat, 0, -FOUND + 0.2 + 0.1, 0.24, g);
  }

  // Patio slab with control joints.
  const patioMat = withNormal(std({ map: tiled(T.concreteTexture(), 6.2, 3.6, 2, 2), roughness: 0.9 }), 2.5);
  const patio = box(6.2, 0.1, 3.6, patioMat, -2.0, 0.05, Z + 1.8, scene);
  patio.castShadow = false;
  for (const x of [-3.55, -0.45]) {
    box(0.015, 0.003, 3.6, std({ color: 0x777066 }), x, 0.1, Z + 1.8, scene).castShadow = false;
  }
  physics.addStatic(RAPIER.ColliderDesc.cuboid(3.1, 0.05, 1.8), [-2.0, 0.05, Z + 1.8]);

  // House collider.
  physics.addStatic(RAPIER.ColliderDesc.cuboid(W / 2, WALL_H / 2, depth / 2), [0, WALL_H / 2, Z - depth / 2]);

  // AC condenser unit on a pad.
  {
    const g = new THREE.Group();
    g.position.set(5.6, 0, Z + 0.75);
    scene.add(g);
    box(0.95, 0.06, 0.95, foundMat, 0, 0.03, 0, g);
    box(0.78, 0.72, 0.78, std({ color: 0xc9c7c0, roughness: 0.5, metalness: 0.3 }), 0, 0.42, 0, g);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 24), std({ color: 0x222222, roughness: 0.7 }));
    fan.position.y = 0.79;
    g.add(fan);
    box(0.7, 0.6, 0.01, std({ color: 0x55534f, roughness: 0.8 }), 0, 0.42, 0.392, g);
    physics.addStatic(RAPIER.ColliderDesc.cuboid(0.39, 0.4, 0.39), [5.6, 0.4, Z + 0.75]);
  }

  // Grill on the patio.
  {
    const g = new THREE.Group();
    g.position.set(-4.3, 0.1, Z + 1.3);
    g.rotation.y = 0.3;
    scene.add(g);
    env.procGrill = g; // replaced by the grill_gas GLB once the NJ props load
    const black = std({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.5 });
    const steel = std({ color: 0xb0b2b5, roughness: 0.3, metalness: 0.9 });
    box(0.9, 0.45, 0.5, black, 0, 0.55, 0, g);
    const lid = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.9, 20, 1, false, 0, Math.PI), black));
    lid.rotation.z = Math.PI / 2;
    lid.position.y = 0.78;
    g.add(lid);
    box(0.4, 0.03, 0.45, steel, 0.68, 0.72, 0, g);
    for (const [x, z] of [[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]]) box(0.04, 0.55, 0.04, steel, x, 0.27, z, g);
    box(0.5, 0.04, 0.04, steel, 0, 1.0, 0.27, g);
    physics.addStatic(RAPIER.ColliderDesc.cuboid(0.55, 0.5, 0.3), [-4.3, 0.6, Z + 1.3]);
  }

  // Patio table + two chairs.
  {
    const wood = std({ color: 0x6e5440, roughness: 0.8 });
    const t = new THREE.Group();
    t.position.set(-1.2, 0.1, Z + 2.2);
    scene.add(t);
    env.procTable = t; // replaced by the patio_set GLB
    const top = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 28), wood));
    top.position.y = 0.72;
    t.add(top);
    box(0.06, 0.7, 0.06, wood, 0, 0.36, 0, t);
    box(0.5, 0.04, 0.5, wood, 0, 0.02, 0, t);
    for (const [cx, cz, ry] of [[-0.85, 0.15, 1.2], [0.85, -0.1, -1.9]]) {
      const c = new THREE.Group();
      c.position.set(cx, 0, cz);
      c.rotation.y = ry;
      t.add(c);
      box(0.46, 0.04, 0.44, wood, 0, 0.45, 0, c);
      box(0.46, 0.5, 0.04, wood, 0, 0.72, -0.2, c);
      for (const [lx, lz] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) box(0.035, 0.45, 0.035, wood, lx, 0.225, lz, c);
    }
    physics.addStatic(RAPIER.ColliderDesc.cylinder(0.38, 0.55), [-1.2, 0.48, Z + 2.2]);
  }
  env.house = house;
}

function buildWoodpile(scene, physics, rng) {
  const x0 = -10.35, z0 = 0.6, z1 = 5.6, H = 1.15, D = 0.42;
  // Split firewood piece: a wedge-ish quarter cylinder, axis along X.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.11, 0);
  shape.absarc(0, 0, 0.11, 0, Math.PI / 2 + 0.15, false);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 5 });
  geo.translate(-0.04, -0.04, -D / 2);
  geo.rotateY(Math.PI / 2);
  const tex = T.fenceBoardTexture(77);
  tex.repeat.set(4, 4);
  const mat = std({ map: tex, roughness: 0.9 });
  const count = 520;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  let n = 0;
  for (let row = 0; row < 11 && n < count; row++) {
    for (let zz = z0 + 0.06; zz < z1 - 0.06 && n < count; zz += rng.float(0.1, 0.13)) {
      p.set(x0 + rng.float(-0.04, 0.04), 0.18 + row * 0.095 + rng.float(-0.01, 0.01), zz);
      q.setFromEuler(new THREE.Euler(rng.float(0, Math.PI * 2), rng.float(-0.06, 0.06), rng.float(-0.05, 0.05)));
      s.setScalar(rng.float(0.8, 1.15));
      m4.compose(p, q, s);
      mesh.setMatrixAt(n, m4);
      c.setHSL(0.07 + rng.float(-0.015, 0.02), rng.float(0.25, 0.45), rng.float(0.35, 0.55));
      mesh.setColorAt(n, c);
      n++;
    }
  }
  mesh.count = Math.round(n * 0.45);
  shadowed(mesh);
  scene.add(mesh);
  const frame = std({ color: 0x5a4a3a, roughness: 0.9 });
  box(0.5, 0.12, z1 - z0 + 0.2, frame, x0, 0.06, (z0 + z1) / 2, scene);
  for (const z of [z0 - 0.04, z1 + 0.04]) box(0.09, H + 0.25, 0.09, frame, x0, (H + 0.25) / 2, z, scene);
  physics.addStatic(RAPIER.ColliderDesc.cuboid(0.25, H / 2, (z1 - z0) / 2 + 0.1), [x0, H / 2, (z0 + z1) / 2]);
  // The stack grows as the player splits wood.
  const base = mesh.count;
  return {
    mesh, base, capacity: n,
    setPieces(k) { mesh.count = Math.min(n, base + Math.floor(k / 2)); },
  };
}

// Shepherd's-hook lantern by the chopping block + string lights over the patio.
function buildLanterns(scene, physics, env, nj) {
  const iron = std({ color: 0x1c1c1e, roughness: 0.55, metalness: 0.75 });
  const g = new THREE.Group();
  g.position.set(2.35, 0, -2.0); // clear of Sergey's stance circle around the block
  scene.add(g);
  const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 1.75, 8), iron));
  post.position.y = 0.875;
  g.add(post);
  const hook = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.01, 6, 16, Math.PI), iron));
  hook.position.set(0.12, 1.75, 0);
  g.add(hook);
  const lantern = new THREE.Group();
  lantern.position.set(0.24, 1.47, 0);
  g.add(lantern);
  const glassMat = std({ color: 0xffe2b0, emissive: 0xffb050, emissiveIntensity: 0.2, roughness: 0.2, transparent: true, opacity: 0.85 });
  glassMat.userData.noWeather = true;
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 12), glassMat);
  lantern.add(glass);
  const cap = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.07, 12), iron));
  cap.position.y = 0.115;
  lantern.add(cap);
  const baseM = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), iron));
  baseM.position.y = -0.09;
  lantern.add(baseM);
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.16, 0.008), iron);
    const a = (i / 4) * Math.PI * 2;
    bar.position.set(Math.cos(a) * 0.062, 0, Math.sin(a) * 0.062);
    lantern.add(bar);
  }
  const light = new THREE.PointLight(0xffa850, 0, 9, 2);
  light.position.set(0.24, 1.47, 0);
  g.add(light);
  env.lamps.push({ light, base: 7, mat: glassMat, emissive: 4, flicker: true, phase: 1.7, name: 'lantern' });
  physics.addStatic(RAPIER.ColliderDesc.cylinder(0.875, 0.02), [g.position.x, 0.875, g.position.z]);

  // String lights from the house corner to a post at the patio edge.
  const p0 = new THREE.Vector3(-4.9, 2.4, HOUSE_Z + 0.1), p1 = new THREE.Vector3(0.9, 2.3, HOUSE_Z + 3.6);
  const postS = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), std({ color: 0x5a4636, roughness: 0.9 })));
  postS.position.set(p1.x, 1.2, p1.z);
  nj.add(postS);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc070, emissiveIntensity: 0.1 });
  bulbMat.userData.noWeather = true;
  const pts = [];
  const N = 18;
  const bulbGeo = new THREE.SphereGeometry(0.03, 8, 6);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = new THREE.Vector3().lerpVectors(p0, p1, t);
    p.y -= Math.sin(Math.PI * t) * 0.45;
    pts.push(p);
    if (i > 0 && i < N) {
      const b = new THREE.Mesh(bulbGeo, bulbMat);
      b.position.copy(p).y -= 0.05;
      nj.add(b);
    }
  }
  nj.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x111111 })));
  const sl = new THREE.PointLight(0xffc070, 0, 8, 2);
  sl.position.copy(pts[N / 2]).y -= 0.2;
  nj.add(sl);
  env.lamps.push({ light: sl, base: 3, mat: bulbMat, emissive: 3.5, flicker: false, phase: 0, name: 'string' });
}

function buildNeighbours(scene, rng) {
  const colors = [[210, 200, 170], [170, 186, 196], [200, 180, 160], [190, 196, 184]];
  const spots = [
    { x: -12, z: 30, w: 12, d: 9, ry: 0 },
    { x: 13, z: 31, w: 13, d: 9, ry: 0 },
    { x: -27, z: 2, w: 9, d: 12, ry: -Math.PI / 2 },
    { x: 27, z: 0, w: 9, d: 12, ry: Math.PI / 2 },
  ];
  spots.forEach((s, i) => {
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.ry;
    scene.add(g);
    const tex = T.sidingTexture(colors[i % colors.length], 60 + i);
    const H = 5.6;
    const wall = withNormal(std({ map: tiled(tex, s.w, H, 0.8, 0.8), roughness: 0.8 }), 3, 0.8);
    const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(s.w, H, s.d), wall));
    body.position.y = H / 2;
    g.add(body);
    const roofMat = std({ color: rng.pick([0x4a4644, 0x5a4a40, 0x3e4248]), roughness: 0.9 });
    // Triangular prism along X with the apex up.
    const rr = (s.d + 0.6) / Math.sqrt(3);
    const roofGeo = new THREE.CylinderGeometry(rr, rr, s.w + 0.6, 3, 1, false, Math.PI / 2);
    roofGeo.rotateZ(Math.PI / 2);
    const sy = 2.3 / (1.5 * rr);
    roofGeo.scale(1, sy, 1);
    const roof = shadowed(new THREE.Mesh(roofGeo, roofMat));
    roof.position.y = H + 0.5 * rr * sy;
    g.add(roof);
    const winMat = std({ color: 0x223038, roughness: 0.1, envMapIntensity: 1.5 });
    for (let k = 0; k < 4; k++) {
      for (const y of [1.6, 4.0]) {
        const wm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), winMat);
        wm.position.set(-s.w / 2 + (k + 0.5) * (s.w / 4), y, -s.d / 2 - 0.01);
        wm.rotation.y = Math.PI;
        g.add(wm);
      }
    }
  });

  // Utility pole and wires behind the back fence.
  const poleMat = std({ color: 0x5b4a3a, roughness: 0.95 });
  const poles = [[-24, 16.5], [4, 16.5], [32, 16.5]];
  for (const [x, z] of poles) {
    const p = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 11, 10), poleMat));
    p.position.set(x, 5.5, z);
    scene.add(p);
    box(0.12, 0.12, 2.0, poleMat, x, 10.2, z, scene);
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
  for (let i = 0; i < poles.length - 1; i++) {
    for (const off of [-0.9, 0, 0.9]) {
      const pts = [];
      const [ax, az] = poles[i], [bx, bz] = poles[i + 1];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        pts.push(new THREE.Vector3(lerp(ax, bx, t) + off * 0, 10.28 - Math.sin(Math.PI * t) * 0.9, lerp(az, bz, t) + off));
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
    }
  }
}
