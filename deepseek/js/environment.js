import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createBarkTexture,
  createCloudTexture,
  createDirtPatchTexture,
  createEndGrainTexture,
  createGrassTexture,
  createSidingTexture,
  createWoodTexture,
  mulberry32,
  randomPointInRing,
} from './utils.js';

export const BLOCK = Object.freeze({
  x: 0,
  z: -0.95,
  top: 0.48,
  radius: 0.34,
});

export const LOG = Object.freeze({
  x: 0,
  z: -0.95,
  radius: 0.185,
  height: 0.46,
  baseY: BLOCK.top,
});

/**
 * Collapse a group of static meshes into one mesh per material. This is the
 * single biggest draw-call win in the yard: trees, window trim, fence rails and
 * the house all become a handful of batches.
 */
function mergeStaticGroup(group, { keep = null } = {}) {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const originals = [];

  group.traverse((object) => {
    if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return;
    if (keep && keep(object)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((m) => !m || m.transparent)) return;
    const key = `${materials.map((m) => m.uuid).join('|')}:${object.castShadow ? 1 : 0}:${object.receiveShadow ? 1 : 0}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        materials,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        geometries: [],
      });
    }
    const geometry = object.geometry.clone();
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld);
    geometry.applyMatrix4(matrix);
    buckets.get(key).geometries.push(geometry);
    originals.push(object);
  });

  for (const object of originals) {
    object.parent?.remove(object);
  }

  const mergedMeshes = [];
  for (const bucket of buckets.values()) {
    if (!bucket.geometries.length) continue;
    const merged =
      bucket.geometries.length === 1
        ? bucket.geometries[0]
        : mergeGeometries(bucket.geometries, false);
    if (!merged) {
      for (const geo of bucket.geometries) geo.dispose();
      continue;
    }
    if (bucket.geometries.length > 1) {
      for (const geo of bucket.geometries) geo.dispose();
    }
    const mesh = new THREE.Mesh(
      merged,
      bucket.materials.length === 1 ? bucket.materials[0] : bucket.materials,
    );
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    group.add(mesh);
    mergedMeshes.push(mesh);
  }
  return mergedMeshes;
}

/* ------------------------------------------------------------------ *
 *  Sky
 * ------------------------------------------------------------------ */

function createSky(scene) {
  const uniforms = {
    uTop: { value: new THREE.Color(0x557fa5) },
    uHorizon: { value: new THREE.Color(0xf0d5b1) },
    uSunDir: { value: new THREE.Vector3(-0.45, 0.42, 0.78).normalize() },
    uSunColor: { value: new THREE.Color(0xffd7a0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPosition;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;

      void main() {
        vec3 dir = normalize(vWorldPosition);
        float h = clamp(dir.y, 0.0, 1.0);
        float horizon = smoothstep(-0.06, 0.62, dir.y);
        vec3 color = mix(uHorizon, uTop, horizon);
        color = mix(color, vec3(0.76, 0.79, 0.68), smoothstep(0.0, -0.22, dir.y) * 0.45);
        float sun = max(dot(dir, normalize(uSunDir)), 0.0);
        color += uSunColor * (pow(sun, 480.0) * 2.8 + pow(sun, 20.0) * 0.18);
        float haze = pow(1.0 - h, 12.0) * 0.18;
        color += vec3(1.0, 0.83, 0.59) * haze;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 40, 20), material);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);
  return { sky, uniforms };
}

/* ------------------------------------------------------------------ *
 *  Ground and grass
 * ------------------------------------------------------------------ */

function createGroundTextureSet() {
  return {
    grass: createGrassTexture(21),
    dirt: createDirtPatchTexture(13),
  };
}

function createGround(scene) {
  const textures = createGroundTextureSet();
  const geo = new THREE.PlaneGeometry(90, 90, 90, 90);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dist = Math.hypot(x, z + 0.8);
    let y = 0;
    if (dist > 2.2) {
      const fade = Math.min(1, (dist - 2.2) / 5);
      y =
        (Math.sin(x * 0.54 + z * 0.32) * 0.018 +
          Math.sin(x * 0.19 - z * 0.61) * 0.022 +
          Math.sin(x * 1.7 + z * 1.15) * 0.005) *
        fade;
    }
    pos.setY(i, y);
  }
  geo.computeVertexNormals();

  // Baked colour variation for the software-friendly unlit ground. The high
  // quality material still uses the full grass texture and ignores this layer.
  const colorPos = geo.attributes.position;
  const grassColors = new Float32Array(colorPos.count * 3);
  const grassColor = new THREE.Color();
  for (let i = 0; i < colorPos.count; i++) {
    const x = colorPos.getX(i);
    const z = colorPos.getZ(i);
    const broad = Math.sin(x * 0.37 + 1.1) * 0.035 + Math.cos(z * 0.29 - 0.4) * 0.03;
    const fine = Math.sin(x * 1.9 + z * 1.3) * 0.018 + Math.cos(x * 0.83 - z * 1.7) * 0.014;
    const worn = Math.max(0, 1 - Math.hypot(x, z + 0.9) / 2.4);
    grassColor.setHSL(
      0.24 + broad * 0.25,
      0.38 + fine * 0.5,
      0.235 + broad + fine + worn * 0.028,
    );
    grassColors[i * 3] = grassColor.r;
    grassColors[i * 3 + 1] = grassColor.g;
    grassColors[i * 3 + 2] = grassColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(grassColors, 3));

  const mat = new THREE.MeshStandardMaterial({
    map: textures.grass,
    color: 0xd6dec5,
    roughness: 0.98,
    metalness: 0,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  const simpleGroundMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    color: 0xffffff,
    fog: true,
  });
  simpleGroundMaterial.userData.baseColor = new THREE.Color(0xffffff);
  ground.userData.standardMaterial = mat;
  ground.userData.simpleMaterial = simpleGroundMaterial;
  scene.add(ground);

  // A slightly patchy, worn earth circle under the chopping block.
  const patchMat = new THREE.MeshStandardMaterial({
    map: textures.dirt,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const patch = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48), patchMat);
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(BLOCK.x, 0.012, BLOCK.z + 0.05);
  patch.receiveShadow = true;
  scene.add(patch);

  const moss = new THREE.Group();
  const mossMat = new THREE.MeshStandardMaterial({
    color: 0x4c6334,
    transparent: true,
    opacity: 0.42,
    roughness: 1,
    depthWrite: false,
  });
  for (let i = 0; i < 3; i++) {
    const r = 0.25 + i * 0.24;
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mossMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(BLOCK.x + (i % 2 ? 0.2 : -0.15), 0.018, BLOCK.z + 0.1 + i * 0.05);
    p.scale.set(1.4, 1, 0.8);
    moss.add(p);
  }
  scene.add(moss);

  return { ground, textures, simpleGroundMaterial, moss };
}

const MAX_GRASS = 10500;
const MAX_WEEDS = 520;

function createGrass(scene, preset = null) {
  const random = mulberry32(392);
  const geometry = new THREE.BufferGeometry();
  const w = 0.015;
  const h = 1;
  const positions = new Float32Array([
    -w, 0, 0,
    w, 0, 0,
    -w * 0.58, h * 0.48, 0.002,
    w * 0.62, h * 0.5, -0.002,
    -w * 0.13, h * 0.82, 0.004,
    w * 0.14, h * 0.8, 0.004,
    w * 0.18, h, 0,
  ]);
  const indices = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
  });
  const attachWind = (target) => {
    target.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uWind = { value: 1 };
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uWind;',
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          float windPhase = instanceMatrix[3].x * 0.63 + instanceMatrix[3].z * 0.41;
          float bend = transformed.y * transformed.y;
          transformed.x += sin(uTime * (1.15 + uWind * 0.7) + windPhase) * bend * (0.1 + uWind * 0.15);
          transformed.z += cos(uTime * (0.9 + uWind * 0.5) + windPhase * 1.37) * bend * (0.04 + uWind * 0.07);
        `,
      );
      target.userData.shader = shader;
    };
  };
  attachWind(material);

  const count = MAX_GRASS;
  const grass = new THREE.InstancedMesh(geometry, material, count);
  grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grass.castShadow = false;
  grass.receiveShadow = true;
  grass.frustumCulled = false;
  grass.count = preset?.grass ?? count;

  const dummy = new THREE.Object3D();
  const colors = [
    new THREE.Color(0x62803d),
    new THREE.Color(0x506d36),
    new THREE.Color(0x78904b),
    new THREE.Color(0x435f31),
    new THREE.Color(0x6e7f3b),
    new THREE.Color(0x889a56),
  ];
  for (let i = 0; i < count; i++) {
    const [x, z] = randomPointInRing(random, 1.35, 15.5);
    const atBlock = Math.hypot(x - BLOCK.x, z - BLOCK.z) < 1.2;
    const atPath = z > 2.2 && Math.abs(x - 1.7) < 0.65;
    const scaleH = atBlock ? 0.045 + random() * 0.075 : 0.1 + random() * 0.16 + (random() > 0.9 ? 0.09 : 0);
    const scaleW = 0.65 + random() * 1.15;
    dummy.position.set(x, 0.005, z);
    dummy.rotation.set((random() - 0.5) * 0.18, random() * Math.PI * 2, (random() - 0.5) * 0.22);
    dummy.scale.set(scaleW, atPath ? scaleH * 0.35 : scaleH, scaleW);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    const c = colors[(random() * colors.length) | 0].clone();
    c.offsetHSL((random() - 0.5) * 0.035, (random() - 0.5) * 0.08, (random() - 0.5) * 0.08);
    grass.setColorAt(i, c);
  }
  grass.instanceColor.needsUpdate = true;
  scene.add(grass);

  // Taller, straw-coloured weeds near the fence line.
  const weedGeo = geometry.clone();
  const weedMat = material.clone();
  attachWind(weedMat);
  const weeds = new THREE.InstancedMesh(weedGeo, weedMat, MAX_WEEDS);
  weeds.count = preset?.weeds ?? MAX_WEEDS;
  const weedColors = [new THREE.Color(0x8d8b4d), new THREE.Color(0x9c9156), new THREE.Color(0x747442)];
  for (let i = 0; i < MAX_WEEDS; i++) {
    const side = random() > 0.5 ? 1 : -1;
    const x = side * (6.9 + random() * 1.1);
    const z = -6.0 + random() * 8.3;
    dummy.position.set(x + (random() - 0.5) * 0.7, 0.01, z);
    dummy.rotation.set(0, random() * 6.28, (random() - 0.5) * 0.25);
    dummy.scale.set(0.8 + random() * 0.8, 0.25 + random() * 0.58, 0.8 + random() * 0.8);
    dummy.updateMatrix();
    weeds.setMatrixAt(i, dummy.matrix);
    weeds.setColorAt(i, weedColors[(random() * weedColors.length) | 0]);
  }
  weeds.instanceColor.needsUpdate = true;
  weeds.frustumCulled = false;
  weeds.receiveShadow = true;
  scene.add(weeds);

  return { grass, material, weeds, weedMat };
}

/* ------------------------------------------------------------------ *
 *  Fence
 * ------------------------------------------------------------------ */

function makePicketGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.062, 0);
  shape.lineTo(0.062, 0);
  shape.lineTo(0.062, 0.82);
  shape.lineTo(0.02, 0.88);
  shape.lineTo(0, 0.93);
  shape.lineTo(-0.02, 0.88);
  shape.lineTo(-0.062, 0.82);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -0.0175);
  return geo;
}

function createFence(scene, woodTexture) {
  const group = new THREE.Group();
  group.name = 'weathered-fence';
  const random = mulberry32(771);

  const picketMat = new THREE.MeshStandardMaterial({
    map: woodTexture,
    color: 0xcfc1a8,
    roughness: 0.92,
    metalness: 0,
    vertexColors: true,
  });
  const railMat = new THREE.MeshStandardMaterial({
    map: woodTexture,
    color: 0xa9987e,
    roughness: 0.95,
  });
  const postMat = new THREE.MeshStandardMaterial({
    map: woodTexture,
    color: 0x9c8a6d,
    roughness: 0.95,
  });
  const picketGeo = makePicketGeometry();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const picketGeometries = [];
  const railGeometries = [];
  const postGeometries = [];
  const runMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();

  function addRun(centerX, centerZ, length, rotY) {
    const spacing = 0.155;
    const count = Math.floor(length / spacing);
    runMatrix.compose(
      new THREE.Vector3(centerX, 0, centerZ),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(1, 1, 1),
    );
    for (let i = 0; i < count; i++) {
      dummy.position.set(
        -length / 2 + i * spacing + (random() - 0.5) * 0.012,
        (random() - 0.5) * 0.018,
        (random() - 0.5) * 0.028,
      );
      dummy.rotation.set((random() - 0.5) * 0.008, (random() - 0.5) * 0.035, (random() - 0.5) * 0.012);
      dummy.scale.set(1 + (random() - 0.5) * 0.08, 0.92 + random() * 0.16, 1);
      dummy.updateMatrix();
      worldMatrix.multiplyMatrices(runMatrix, dummy.matrix);
      let geometry = picketGeo.clone();
      if (geometry.index) geometry = geometry.toNonIndexed();
      geometry.applyMatrix4(worldMatrix);
      color.setHSL(0.09 + random() * 0.025, 0.16 + random() * 0.12, 0.62 + random() * 0.13);
      const positions = geometry.attributes.position.count;
      const colors = new Float32Array(positions * 3);
      for (let v = 0; v < positions; v++) {
        colors[v * 3] = color.r;
        colors[v * 3 + 1] = color.g;
        colors[v * 3 + 2] = color.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      picketGeometries.push(geometry);
    }

    // Rails and posts behind the pickets.
    for (const y of [0.28, 0.68]) {
      const geometry = new THREE.BoxGeometry(length, 0.085, 0.065);
      worldMatrix.compose(
        new THREE.Vector3(centerX, y, centerZ),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
        new THREE.Vector3(1, 1, 1),
      );
      geometry.applyMatrix4(worldMatrix);
      railGeometries.push(geometry);
    }
    const postCount = Math.ceil(length / 2.15) + 1;
    for (let i = 0; i < postCount; i++) {
      const x = -length / 2 + (i / (postCount - 1)) * length;
      const post = new THREE.BoxGeometry(0.12, 1.15, 0.12);
      post.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(
          runMatrix,
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, 0.55, -0.085),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (random() - 0.5) * 0.012)),
            new THREE.Vector3(1, 1, 1),
          ),
        ),
      );
      postGeometries.push(post);
      const cap = new THREE.BoxGeometry(0.15, 0.035, 0.15);
      cap.applyMatrix4(new THREE.Matrix4().multiplyMatrices(
        runMatrix,
        new THREE.Matrix4().makeTranslation(x, 1.14, -0.085),
      ));
      postGeometries.push(cap);
    }
  }

  addRun(0, -6.45, 17.5, 0);
  addRun(-8.72, -2.0, 9.1, Math.PI / 2);
  addRun(8.72, -2.0, 9.1, Math.PI / 2);

  const mergedPickets = mergeGeometries(picketGeometries, false);
  for (const geometry of picketGeometries) geometry.dispose();
  if (mergedPickets) {
    const mesh = new THREE.Mesh(mergedPickets, picketMat);
    mesh.name = 'fence-pickets';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const mergedRails = mergeGeometries(railGeometries, false);
  for (const geometry of railGeometries) geometry.dispose();
  if (mergedRails) {
    const mesh = new THREE.Mesh(mergedRails, railMat);
    mesh.name = 'fence-rails';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const mergedPosts = mergeGeometries(postGeometries, false);
  for (const geometry of postGeometries) geometry.dispose();
  if (mergedPosts) {
    const mesh = new THREE.Mesh(mergedPosts, postMat);
    mesh.name = 'fence-posts';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  picketGeo.dispose();
  scene.add(group);
  return { group, picketMat, railMat, postMat };
}

/* ------------------------------------------------------------------ *
 *  Trees, shrubs and background greenery
 * ------------------------------------------------------------------ */

function createTrees(scene) {
  const random = mulberry32(66);
  const barkTex = createBarkTexture(121, 2, 2.5);
  const trunkMat = new THREE.MeshStandardMaterial({
    map: barkTex,
    color: 0x8f7a5c,
    roughness: 1,
  });
  const leafMats = [
    new THREE.MeshStandardMaterial({ color: 0x425f2d, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x526f34, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x607b3d, roughness: 0.92, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x354d29, roughness: 0.9, flatShading: true }),
  ];
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const leafPalette = [0x425f2d, 0x526f34, 0x607b3d, 0x354d29, 0x4a6b36, 0x263b20];
  const canopyMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
  });
  const trees = [];
  const forest = new THREE.Group();
  forest.name = 'tree-line';

  function makeTree(x, z, scale, seed, autumn = false) {
    const rnd = mulberry32(seed);
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    tree.scale.setScalar(scale);

    const trunkHeight = 3.7 + rnd() * 1.4;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.29, trunkHeight, 9, 4),
      trunkMat,
    );
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    // A few chunky branches.
    const branchCount = 5 + ((rnd() * 3) | 0);
    for (let i = 0; i < branchCount; i++) {
      const a = rnd() * Math.PI * 2;
      const len = 1.2 + rnd() * 1.1;
      const start = new THREE.Vector3(0, trunkHeight * (0.55 + rnd() * 0.35), 0);
      const end = new THREE.Vector3(
        Math.cos(a) * len * (0.65 + rnd() * 0.4),
        start.y + 0.7 + rnd() * 0.8,
        Math.sin(a) * len * (0.65 + rnd() * 0.4),
      );
      const g = new THREE.CylinderGeometry(0.025, 0.08, 1, 6);
      const branch = new THREE.Mesh(g, trunkMat);
      branch.position.copy(start.clone().add(end).multiplyScalar(0.5));
      branch.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        end.clone().sub(start).normalize(),
      );
      branch.scale.y = start.distanceTo(end);
      branch.castShadow = true;
      tree.add(branch);
    }

    const crownY = trunkHeight + 0.1;
    const leafGeometries = [];
    const addCanopyBlob = (geometry, position, scale, rotation, colorHex, jitter = 0.05) => {
      let geo = geometry.clone();
      if (geo.index) geo = geo.toNonIndexed();
      const matrix = new THREE.Matrix4().compose(
        position,
        new THREE.Quaternion().setFromEuler(rotation),
        scale,
      );
      geo.applyMatrix4(matrix);
      const count = geo.attributes.position.count;
      const colors = new Float32Array(count * 3);
      const color = new THREE.Color(colorHex);
      color.offsetHSL((rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      leafGeometries.push(geo);
    };

    const blobCount = 17 + ((rnd() * 9) | 0);
    for (let i = 0; i < blobCount; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (1.9 + rnd() * 0.65);
      const y = crownY + (rnd() - 0.35) * 2.1 - r * 0.1;
      const palette = autumn ? leafPalette.slice(0, 2) : leafPalette;
      addCanopyBlob(
        leafGeo,
        new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        new THREE.Vector3(0.9 + rnd() * 1.2, 0.7 + rnd() * 0.95, 0.9 + rnd() * 1.2),
        new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3),
        palette[(rnd() * palette.length) | 0],
      );
    }

    // A dark inner crown keeps the silhouette from looking hollow.
    addCanopyBlob(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.Vector3(0, crownY + 0.35, 0),
      new THREE.Vector3(2.25, 1.65, 2.1),
      new THREE.Euler(0, 0, 0),
      0x263b20,
      0.02,
    );

    const mergedCanopy = mergeGeometries(leafGeometries, false);
    for (const geometry of leafGeometries) geometry.dispose();
    if (mergedCanopy) {
      const canopy = new THREE.Mesh(mergedCanopy, canopyMaterial);
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      tree.add(canopy);
    }

    tree.rotation.y = rnd() * Math.PI * 2;
    forest.add(tree);
    trees.push({
      group: tree,
      baseRotation: tree.rotation.y,
      phase: rnd() * 6.28,
      scale,
    });
    return tree;
  }

  makeTree(-5.4, -4.5, 1.18, 12);
  makeTree(6.55, -4.9, 1.34, 25);
  makeTree(-7.7, -7.7, 1.0, 40);
  makeTree(7.5, -8.2, 0.95, 57);
  makeTree(-10.2, 0.8, 1.05, 71);
  mergeStaticGroup(forest);
  scene.add(forest);
  trees.forest = forest;

  // Low shrubs along the fence and foundation.
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x3c572f, roughness: 1, flatShading: true });
  const shrubMat2 = new THREE.MeshStandardMaterial({ color: 0x4a6638, roughness: 1, flatShading: true });
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 1);
  const shrubs = new THREE.Group();
  for (let i = 0; i < 22; i++) {
    const x = -7.9 + random() * 15.8;
    const z = -6.15 + random() * 0.3;
    if (Math.abs(x) < 2.6) continue;
    const s = 0.5 + random() * 0.65;
    const bush = new THREE.Mesh(shrubGeo, i % 2 ? shrubMat : shrubMat2);
    bush.position.set(x, s * 0.42, z);
    bush.scale.set(s * (0.8 + random() * 0.6), s * (0.6 + random() * 0.4), s);
    bush.rotation.y = random() * 6;
    bush.castShadow = true;
    bush.receiveShadow = true;
    shrubs.add(bush);
  }
  mergeStaticGroup(shrubs);
  scene.add(shrubs);

  return { trees, leafMats, shrubs };
}

/* ------------------------------------------------------------------ *
 *  House facade
 * ------------------------------------------------------------------ */

function createHouse(scene) {
  const group = new THREE.Group();
  group.position.set(-2.8, 0, -10.1);
  group.name = 'generic-house';

  const siding = createSidingTexture(9);
  const wood = createWoodTexture({ base: '#6d4b30', seed: 22, grain: 48 });
  const shingle = createWoodTexture({
    base: '#494742',
    dark: '#262622',
    light: '#666158',
    grain: 100,
    planks: 14,
    seed: 31,
    repeatX: 3,
    repeatY: 4,
  });

  const wallMat = new THREE.MeshStandardMaterial({ map: siding, color: 0xdfe5dd, roughness: 0.86 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe6e2d4, roughness: 0.65 });
  const roofMat = new THREE.MeshStandardMaterial({ map: shingle, color: 0xaaa69c, roughness: 0.96 });
  const doorMat = new THREE.MeshStandardMaterial({ map: wood, color: 0x76523a, roughness: 0.8 });
  const foundationMat = new THREE.MeshStandardMaterial({ color: 0x545750, roughness: 1 });
  const windowMaterials = [];
  const glassMats = {
    lit: new THREE.MeshStandardMaterial({
      color: 0xd9b57a,
      roughness: 0.16,
      metalness: 0.42,
      emissive: 0x62411d,
      emissiveIntensity: 0.6,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x9bb4bb,
      roughness: 0.16,
      metalness: 0.42,
      emissive: 0x10181b,
      emissiveIntensity: 0.2,
    }),
  };
  windowMaterials.push(glassMats.lit, glassMats.dark);

  const main = new THREE.Mesh(new THREE.BoxGeometry(9.2, 4.75, 4.2), wallMat);
  main.position.set(0, 2.375, 0);
  main.castShadow = true;
  main.receiveShadow = true;
  group.add(main);

  const foundation = new THREE.Mesh(new THREE.BoxGeometry(9.35, 0.45, 4.35), foundationMat);
  foundation.position.set(0, 0.225, 0);
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  group.add(foundation);

  // Eave roof: two sloping slabs meeting at a ridge.
  const roofFront = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.18, 2.85), roofMat);
  roofFront.position.set(0, 5.15, 1.35);
  roofFront.rotation.x = 0.52;
  roofFront.castShadow = true;
  roofFront.receiveShadow = true;
  group.add(roofFront);

  const roofBack = roofFront.clone();
  roofBack.position.z = -1.35;
  roofBack.rotation.x = -0.52;
  group.add(roofBack);

  const ridge = new THREE.Mesh(new THREE.BoxGeometry(9.9, 0.22, 0.25), roofMat);
  ridge.position.set(0, 5.88, 0);
  ridge.castShadow = true;
  group.add(ridge);

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.75, 0.62), foundationMat);
  chimney.position.set(3.0, 5.9, -0.5);
  chimney.castShadow = true;
  group.add(chimney);
  const chimneyCap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.76), trimMat);
  chimneyCap.position.set(3.0, 6.8, -0.5);
  group.add(chimneyCap);

  // Trim boards.
  const corners = [-4.55, 4.55];
  for (const x of corners) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.8, 0.12), trimMat);
    trim.position.set(x, 2.4, 2.12);
    trim.castShadow = true;
    group.add(trim);
  }
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.16, 0.14), trimMat);
  fascia.position.set(0, 4.74, 2.14);
  group.add(fascia);

  function addWindow(x, y, w, h, lit = false) {
    const frame = new THREE.Group();
    frame.position.set(x, y, 2.13);
    const glassMat = lit ? glassMats.lit : glassMats.dark;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w - 0.16, h - 0.16, 0.035), glassMat);
    glass.castShadow = false;
    frame.add(glass);

    const border = 0.07;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, border, 0.09), trimMat);
    top.position.y = h / 2;
    const bottom = top.clone();
    bottom.position.y = -h / 2;
    const left = new THREE.Mesh(new THREE.BoxGeometry(border, h, 0.09), trimMat);
    left.position.x = -w / 2;
    const right = left.clone();
    right.position.x = w / 2;
    for (const m of [top, bottom, left, right]) {
      m.castShadow = true;
      frame.add(m);
    }
    const muntinV = new THREE.Mesh(new THREE.BoxGeometry(0.035, h, 0.06), trimMat);
    const muntinH = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.06), trimMat);
    frame.add(muntinV, muntinH);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.08, 0.18), trimMat);
    sill.position.y = -h / 2 - 0.06;
    sill.position.z = 0.04;
    sill.castShadow = true;
    frame.add(sill);
    group.add(frame);
  }

  addWindow(-2.9, 3.2, 1.3, 1.55, false);
  addWindow(0.0, 3.2, 1.3, 1.55, true);
  addWindow(2.9, 3.2, 1.3, 1.55, false);
  addWindow(-2.9, 1.25, 1.25, 1.5, false);
  addWindow(2.9, 1.25, 1.25, 1.5, false);

  // Door and small stoop.
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.22, 2.3, 0.1), trimMat);
  doorFrame.position.set(0, 1.15, 2.13);
  group.add(doorFrame);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.04, 2.12, 0.08), doorMat);
  door.position.set(0, 1.08, 2.22);
  door.castShadow = true;
  group.add(door);
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xc7a65b, metalness: 0.85, roughness: 0.25 }),
  );
  knob.position.set(0.37, 1.05, 2.28);
  group.add(knob);
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.16, 0.8), foundationMat);
  step.position.set(0, 0.08, 2.55);
  step.receiveShadow = true;
  step.castShadow = true;
  group.add(step);

  // Downspout for a bit of suburban specificity.
  const spoutMat = new THREE.MeshStandardMaterial({ color: 0xd9d6c9, roughness: 0.55, metalness: 0.15 });
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 4.65, 8), spoutMat);
  spout.position.set(4.48, 2.35, 2.18);
  group.add(spout);
  const spoutElbow = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.4, 8), spoutMat);
  spoutElbow.rotation.z = Math.PI / 2;
  spoutElbow.position.set(4.32, 0.08, 2.18);
  group.add(spoutElbow);

  // A pitched porch / awning over the door.
  const awning = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.12, 1.05), roofMat);
  awning.position.set(0, 2.62, 2.68);
  awning.rotation.x = 0.28;
  awning.castShadow = true;
  group.add(awning);
  for (const x of [-1.45, 1.45]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.48, 0.1), trimMat);
    post.position.set(x, 1.24, 3.04);
    post.castShadow = true;
    group.add(post);
  }

  group.rotation.y = 0.07;
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.castShadow ?? true;
      o.receiveShadow = true;
    }
  });
  mergeStaticGroup(group);
  scene.add(group);
  return { group, wallMat, roofMat, windowMaterials };
}

/* ------------------------------------------------------------------ *
 *  Yard props: block, woodpile, bucket, path
 * ------------------------------------------------------------------ */

function createChoppingBlock(scene) {
  const bark = createBarkTexture(44, 2.4, 1.3);
  const endGrain = createEndGrainTexture(32, 512);
  const barkMat = new THREE.MeshStandardMaterial({ map: bark, color: 0x9c8663, roughness: 1 });
  const topMat = new THREE.MeshStandardMaterial({ map: endGrain, color: 0xdcb57b, roughness: 0.9 });
  const sideMat = new THREE.MeshStandardMaterial({ map: endGrain, color: 0xc19b62, roughness: 0.94 });

  const group = new THREE.Group();
  group.position.set(BLOCK.x, 0, BLOCK.z);
  group.rotation.y = 0.2;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(BLOCK.radius * 0.96, BLOCK.radius * 1.08, BLOCK.top, 28, 4),
    [barkMat, topMat, sideMat],
  );
  trunk.position.y = BLOCK.top / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  // Bark ridges.
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x4b3b28, roughness: 1 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
    const r = BLOCK.radius * (0.99 + Math.random() * 0.03);
    const ridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.33 + Math.random() * 0.12, 0.018),
      ridgeMat,
    );
    ridge.position.set(Math.cos(a) * r, 0.23 + Math.random() * 0.02, Math.sin(a) * r);
    ridge.rotation.y = -a;
    group.add(ridge);
  }

  // Old axe scars on the rim.
  const scarMat = new THREE.MeshStandardMaterial({ color: 0x8e653c, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const scar = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.012, 0.025),
      scarMat,
    );
    const a = Math.random() * Math.PI * 2;
    scar.position.set(Math.cos(a) * 0.24, BLOCK.top + 0.003, Math.sin(a) * 0.24);
    scar.rotation.y = -a;
    group.add(scar);
  }

  // A wedge left in the block, off to one side.
  const wedgeMat = new THREE.MeshStandardMaterial({ color: 0x6f7475, metalness: 0.8, roughness: 0.38 });
  const wedgeShape = new THREE.Shape();
  wedgeShape.moveTo(-0.07, 0);
  wedgeShape.lineTo(0.07, 0);
  wedgeShape.lineTo(0.035, 0.15);
  wedgeShape.lineTo(-0.035, 0.15);
  wedgeShape.closePath();
  const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
  wedgeGeo.translate(0, 0, -0.015);
  const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedge.position.set(0.16, BLOCK.top - 0.055, 0.08);
  wedge.rotation.set(0.08, -0.6, -0.15);
  wedge.castShadow = true;
  group.add(wedge);

  mergeStaticGroup(group, { keep: (object) => Array.isArray(object.material) });
  scene.add(group);
  return { group, trunk, barkMat, topMat };
}

function createWoodpile(scene, sharedBark, sharedEnd, random) {
  const group = new THREE.Group();
  group.position.set(-3.4, 0, -3.95);
  group.rotation.y = 0.08;
  const barkMat = new THREE.MeshStandardMaterial({ map: sharedBark, color: 0x9a8462, roughness: 1 });
  const endMat = new THREE.MeshStandardMaterial({ map: sharedEnd, color: 0xd2ad77, roughness: 0.92 });
  const logGeo = new THREE.CylinderGeometry(0.115, 0.13, 0.86, 12, 1);
  const logGeometries = [];
  const dummy = new THREE.Object3D();
  for (let row = 0; row < 4; row++) {
    const count = 8 - row;
    for (let i = 0; i < count; i++) {
      dummy.rotation.set(0, (random() - 0.5) * 0.06, Math.PI / 2);
      dummy.position.set((row % 2) * 0.1 + (random() - 0.5) * 0.05, 0.13 + row * 0.205, (i - count / 2) * 0.24 + (random() - 0.5) * 0.025);
      dummy.updateMatrix();
      const geo = logGeo.clone();
      geo.applyMatrix4(dummy.matrix);
      logGeometries.push(geo);
    }
  }
  const mergedLogs = mergeGeometries(logGeometries, true);
  if (mergedLogs) {
    const logs = new THREE.Mesh(mergedLogs, [barkMat, endMat, endMat]);
    logs.castShadow = true;
    logs.receiveShadow = true;
    group.add(logs);
  }
  for (const geo of logGeometries) geo.dispose();
  logGeo.dispose();
  // A canvas tarp draped over one end.
  const tarp = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.05, 1.05),
    new THREE.MeshStandardMaterial({ color: 0x3f514b, roughness: 0.9 }),
  );
  tarp.position.set(0.34, 0.9, -0.32);
  tarp.rotation.z = -0.04;
  tarp.castShadow = true;
  group.add(tarp);
  scene.add(group);
  return group;
}

function createBucket(scene) {
  const group = new THREE.Group();
  group.position.set(1.5, 0, -1.7);
  group.rotation.y = -0.3;
  const metal = new THREE.MeshStandardMaterial({ color: 0x8b9290, metalness: 0.72, roughness: 0.42 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.33, 16, 1, true), metal);
  body.position.y = 0.165;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), metal);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.005;
  group.add(bottom);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 6, 20), metal);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.33;
  group.add(rim);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.008, 5, 20, Math.PI), metal);
  handle.position.y = 0.34;
  handle.rotation.z = Math.PI;
  group.add(handle);
  // Kindling in the bucket.
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x9b7a4c, roughness: 0.95 });
  for (let i = 0; i < 6; i++) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.42, 5), stickMat);
    stick.position.set((Math.random() - 0.5) * 0.15, 0.38 + Math.random() * 0.07, (Math.random() - 0.5) * 0.15);
    stick.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
    group.add(stick);
  }
  mergeStaticGroup(group);
  scene.add(group);
  return group;
}

function createPath(scene) {
  const random = mulberry32(444);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8f8a78, roughness: 0.95 });
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.36, 0.38, 0.055, 9);
  for (let i = 0; i < 8; i++) {
    const stone = new THREE.Mesh(geo, mat);
    stone.position.set(1.7 + Math.sin(i * 0.7) * 0.34, 0.02, 3.6 - i * 0.66);
    stone.rotation.y = random() * 3;
    stone.scale.set(1 + random() * 0.3, 1, 0.72 + random() * 0.22);
    stone.receiveShadow = true;
    stone.castShadow = true;
    group.add(stone);
  }
  mergeStaticGroup(group);
  scene.add(group);
  return group;
}

function createGardenBed(scene) {
  const group = new THREE.Group();
  group.position.set(5.35, 0, -5.3);
  const soil = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 0.14, 1.05),
    new THREE.MeshStandardMaterial({ color: 0x4b3a27, roughness: 1 }),
  );
  soil.position.y = 0.07;
  soil.receiveShadow = true;
  group.add(soil);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x888370, roughness: 1 });
  for (let i = 0; i < 7; i++) {
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), stoneMat);
    stone.position.set(-1.45 + i * 0.48, 0.12, i % 2 ? 0.42 : -0.45);
    stone.rotation.set(Math.random() * 2, Math.random() * 2, 0);
    group.add(stone);
  }
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x536b35, roughness: 1 });
  const flowerMats = [
    new THREE.MeshStandardMaterial({ color: 0xd5a143, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xa84d39, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xc9b9a0, roughness: 0.8 }),
  ];
  for (let i = 0; i < 18; i++) {
    const x = (Math.random() - 0.5) * 2.7;
    const z = (Math.random() - 0.5) * 0.7;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.3 + Math.random() * 0.26, 4), stemMat);
    stem.position.set(x, 0.2, z);
    group.add(stem);
    const flower = new THREE.Mesh(new THREE.DodecahedronGeometry(0.035 + Math.random() * 0.025, 0), flowerMats[i % 3]);
    flower.position.set(x, 0.37 + Math.random() * 0.22, z);
    group.add(flower);
  }
  mergeStaticGroup(group);
  scene.add(group);
  return group;
}

function createWheelbarrow(scene) {
  const group = new THREE.Group();
  group.position.set(4.6, 0, 0.0);
  group.rotation.y = -0.55;
  const metal = new THREE.MeshStandardMaterial({ color: 0x526a5e, metalness: 0.45, roughness: 0.58 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x84623d, roughness: 0.9 });
  const tray = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  tray.scale.set(1, 0.46, 0.72);
  tray.rotation.x = Math.PI;
  tray.position.y = 0.5;
  tray.castShadow = true;
  group.add(tray);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 8, 18), new THREE.MeshStandardMaterial({ color: 0x24261f, roughness: 0.8 }));
  wheel.position.set(0, 0.2, 0.48);
  wheel.castShadow = true;
  group.add(wheel);
  for (const x of [-0.34, 0.34]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.15, 6), wood);
    handle.rotation.x = Math.PI / 2.3;
    handle.position.set(x, 0.45, -0.2);
    group.add(handle);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.5, 6), wood);
    leg.position.set(x, 0.25, 0.18);
    group.add(leg);
  }
  mergeStaticGroup(group);
  scene.add(group);
  return group;
}

/* ------------------------------------------------------------------ *
 *  Sky extras
 * ------------------------------------------------------------------ */

function createClouds(scene) {
  const tex = createCloudTexture(3);
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    color: 0xfff2dd,
    fog: false,
  });
  const clouds = [];
  const specs = [
    [-20, 15, -30, 20, 8],
    [14, 18, -34, 26, 9],
    [25, 13, -20, 17, 6],
    [-28, 12, -14, 15, 5],
  ];
  for (const [x, y, z, sx, sy] of specs) {
    const sprite = new THREE.Sprite(material.clone());
    sprite.position.set(x, y, z);
    sprite.scale.set(sx, sy, 1);
    sprite.material.opacity = 0.38 + Math.random() * 0.16;
    scene.add(sprite);
    clouds.push(sprite);
  }
  return clouds;
}

function createMotes(scene) {
  const count = 110;
  const random = mulberry32(932);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (random() - 0.5) * 15;
    positions[i * 3 + 1] = 0.4 + random() * 4.3;
    positions[i * 3 + 2] = (random() - 0.5) * 12 - 1.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffe5b0,
    size: 0.025,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return { points, positions, random };
}

/* ------------------------------------------------------------------ *
 *  Atmosphere props: lanterns, puddles, snow
 * ------------------------------------------------------------------ */

function createLanterns(scene) {
  const group = new THREE.Group();
  group.name = 'yard-lanterns';
  const wood = new THREE.MeshStandardMaterial({ color: 0x5d4830, roughness: 0.92 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x25261f, metalness: 0.6, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffc978,
    emissive: 0xffa73d,
    emissiveIntensity: 0.2,
    roughness: 0.3,
    transparent: true,
    opacity: 0.9,
  });
  const lanterns = [];
  const specs = [
    { x: 2.7, z: 1.45, h: 1.9, rot: -0.35 },
    { x: -3.2, z: -2.35, h: 1.72, rot: 0.5 },
  ];
  for (const spec of specs) {
    const post = new THREE.Group();
    post.position.set(spec.x, 0, spec.z);
    post.rotation.y = spec.rot;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.075, spec.h, 0.075), wood);
    pole.position.y = spec.h / 2;
    pole.castShadow = true;
    pole.receiveShadow = true;
    post.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.055, 0.055), wood);
    arm.position.set(0.16, spec.h - 0.06, 0);
    arm.castShadow = true;
    post.add(arm);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 5, 10), iron);
    hook.position.set(0.34, spec.h - 0.12, 0);
    hook.rotation.x = Math.PI / 2;
    post.add(hook);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.2, 6), iron);
    body.position.set(0.34, spec.h - 0.27, 0);
    body.castShadow = true;
    post.add(body);
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.064, 0.14, 6), glass);
    bulb.position.set(0.34, spec.h - 0.27, 0);
    post.add(bulb);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.09, 6), iron);
    cap.position.set(0.34, spec.h - 0.14, 0);
    post.add(cap);
    const light = new THREE.PointLight(0xffb25e, 0, 9.5, 2);
    light.position.set(0.34, spec.h - 0.27, 0);
    post.add(light);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xffb25e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.scale.set(1.15, 1.15, 1);
    glow.position.copy(light.position);
    post.add(glow);
    const structureMeshes = mergeStaticGroup(post);
    group.add(post);
    lanterns.push({ light, glow, bulb, intensity: 2.5, structureMeshes });
  }
  scene.add(group);
  return lanterns;
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,210,140,0.85)');
  g.addColorStop(0.4, 'rgba(255,170,80,0.3)');
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSnowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 30, 128, 128, 126);
  g.addColorStop(0, 'rgba(245,250,255,0.94)');
  g.addColorStop(0.6, 'rgba(236,245,252,0.82)');
  g.addColorStop(0.88, 'rgba(228,240,250,0.3)');
  g.addColorStop(1, 'rgba(228,240,250,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const random = mulberry32(77);
  for (let i = 0; i < 900; i++) {
    const x = random() * 256;
    const y = random() * 256;
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(160,186,210,0.12)';
    ctx.beginPath();
    ctx.ellipse(x, y, 1 + random() * 4, 0.6 + random() * 2, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createPuddles(scene) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x33434b,
    roughness: 0.12,
    metalness: 0.32,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    envMapIntensity: 1.6,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const puddles = [];
  const specs = [
    [1.15, 1.05, 0.75, 0.42, 0.3],
    [-1.35, 1.55, 0.95, 0.55, -0.5],
    [-0.4, 2.65, 0.7, 0.35, 0.9],
    [2.05, -0.1, 0.55, 0.3, -0.8],
    [-2.3, 0.2, 0.8, 0.36, 0.2],
    [0.9, -2.7, 0.6, 0.28, 1.2],
    [-1.7, -1.4, 0.48, 0.24, -0.2],
  ];
  for (const [x, z, sx, sz, rot] of specs) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 22), material.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rot;
    mesh.scale.set(sx, sz, 1);
    mesh.position.set(x, 0.026, z);
    mesh.visible = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    puddles.push(mesh);
  }
  return puddles;
}

function createSnowOverlay(scene) {
  const texture = makeSnowTexture();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xeef6fd,
    roughness: 0.92,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(0, 0.038, -0.4);
  plane.visible = false;
  scene.add(plane);
  return plane;
}

function buildSimpleMaterialSet(root) {
  const cache = new Map();
  const states = [];
  const makeLambert = (material) => {
    if (!material || !material.isMeshStandardMaterial) return material;
    // Emissive glass (windows, lanterns) stays on the lit path so night light
    // and weather can still drive its emissive intensity.
    if (material.emissive && material.emissive.getHex() !== 0) return material;
    if (cache.has(material)) return cache.get(material);
    const simple = new THREE.MeshBasicMaterial({
      color: material.color ? material.color.clone().multiplyScalar(0.95) : new THREE.Color(0xffffff),
      map: material.map || null,
      transparent: material.transparent,
      opacity: material.opacity,
      alphaTest: material.alphaTest,
      side: material.side,
      vertexColors: material.vertexColors,
      depthWrite: material.depthWrite,
      depthTest: material.depthTest,
      fog: material.fog,
      toneMapped: material.toneMapped,
      polygonOffset: material.polygonOffset,
      polygonOffsetFactor: material.polygonOffsetFactor,
      polygonOffsetUnits: material.polygonOffsetUnits,
    });
    simple.name = `${material.name || 'material'}-low`;
    simple.userData = { ...material.userData };
    simple.userData.baseColor = simple.color.clone();
    // Preserve the grass wind hook when the material is swapped at low quality.
    if (typeof material.onBeforeCompile === 'function') {
      simple.onBeforeCompile = material.onBeforeCompile;
    }
    cache.set(material, simple);
    return simple;
  };

  root.traverse((object) => {
    if (!object.isMesh || object.name === 'ground' || !object.material) return;
    if (object.userData.originalMaterial) return;
    const original = object.material;
    const simple = Array.isArray(original) ? original.map((m) => makeLambert(m)) : makeLambert(original);
    object.userData.originalMaterial = original;
    object.userData.simpleMaterial = simple;
    states.push({ object, original, simple });
  });

  return {
    cache,
    states,
    apply(enabled) {
      for (const entry of states) {
        entry.object.material = enabled ? entry.simple : entry.original;
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 *  Main environment assembly
 * ------------------------------------------------------------------ */

export function createEnvironment(scene, renderer, preset = null) {
  scene.fog = new THREE.Fog(0xbcc4ad, 15, 52);
  scene.background = new THREE.Color(0xaebfae);

  const sky = createSky(scene);
  const clouds = createClouds(scene);

  const hemi = new THREE.HemisphereLight(0xc7dded, 0x3f4b2e, 1.35);
  scene.add(hemi);

  const shadowSize = preset?.shadowSize ?? 2048;
  const sun = new THREE.DirectionalLight(0xffe0b0, 3.15);
  sun.position.set(-6.5, 11.5, 5.2);
  sun.target.position.set(0, 0.7, -1.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 28;
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = preset?.shadowRadius ?? 3;
  scene.add(sun);
  scene.add(sun.target);

  const rim = new THREE.DirectionalLight(0xa9c6db, 0.42);
  rim.position.set(7, 4.5, -8);
  scene.add(rim);

  const moon = new THREE.DirectionalLight(0x9fb6e0, 0);
  moon.position.set(5, 9, -7);
  moon.castShadow = false;
  scene.add(moon);

  const warmFill = new THREE.PointLight(0xffc17b, 1.2, 12, 2.0);
  warmFill.position.set(-3.8, 3.2, -7.3);
  scene.add(warmFill);

  const ground = createGround(scene);
  const grass = createGrass(scene, preset);
  const woodTexture = createWoodTexture({
    base: '#806246',
    dark: '#493728',
    light: '#b09370',
    grain: 100,
    planks: 7,
    seed: 92,
    repeatX: 1,
    repeatY: 1,
  });
  const fence = createFence(scene, woodTexture);
  const trees = createTrees(scene);
  const house = createHouse(scene);
  const block = createChoppingBlock(scene);
  const barkTex = createBarkTexture(82, 1.2, 1.3);
  const endTex = createEndGrainTexture(74, 256);
  const woodpile = createWoodpile(scene, barkTex, endTex, mulberry32(313));
  const bucket = createBucket(scene);
  const path = createPath(scene);
  const garden = createGardenBed(scene);
  const wheelbarrow = createWheelbarrow(scene);
  const motes = createMotes(scene);

  // Faint darker tree line beyond the fence to give the yard depth.
  const distantMat = new THREE.MeshStandardMaterial({ color: 0x3c4f35, roughness: 1, flatShading: true });
  const distant = new THREE.Group();
  for (let i = 0; i < 13; i++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), distantMat);
    const x = -18 + i * 3.1 + Math.random() * 1.4;
    blob.position.set(x, 3.2 + Math.random() * 1.8, -14 - Math.random() * 4);
    blob.scale.set(3 + Math.random() * 2.2, 2.5 + Math.random() * 2.4, 2);
    distant.add(blob);
  }
  mergeStaticGroup(distant);
  scene.add(distant);

  const lowDetailRoots = [wheelbarrow, garden, distant, ground.moss, trees.shrubs, path];
  for (const cloud of clouds) cloud.userData.lowDetail = true;

  const lanterns = createLanterns(scene);
  const puddles = createPuddles(scene);
  const snowOverlay = createSnowOverlay(scene);

  const state = {
    sun,
    moon,
    hemi,
    rim,
    warmFill,
    sky,
    clouds,
    grass,
    trees,
    house,
    fence,
    block,
    motes,
    lanterns,
    puddles,
    snowOverlay,
    ground,
    windowMaterials: [...(house.windowMaterials || [])],
    elapsed: 0,
    grassShader: grass.material.userData.shader,
    wind: 1,
    wetness: 0,
  };

  const simpleSet = buildSimpleMaterialSet(scene);

  function applySimpleMaterials(enabled) {
    simpleSet.apply(enabled);
    state.windowMaterials.length = 0;
    for (const material of house.windowMaterials || []) {
      state.windowMaterials.push(enabled ? simpleSet.cache.get(material) || material : material);
    }
  }

  function applyAmbientTint(color, intensity) {
    const key = `${color.getHexString()}:${intensity.toFixed(2)}`;
    if (state._ambientKey === key) return;
    state._ambientKey = key;
    for (const simple of simpleSet.cache.values()) {
      const base = simple.userData.baseColor;
      if (!base) continue;
      simple.color.copy(base).multiply(color).multiplyScalar(intensity);
    }
    const groundMaterial = ground.ground?.material;
    if (groundMaterial && groundMaterial.userData.baseColor) {
      groundMaterial.color.copy(groundMaterial.userData.baseColor).multiply(color).multiplyScalar(intensity);
    }
  }

  function update(dt, elapsed) {
    state.elapsed = elapsed;
    state.simpleActive = simpleSet.states[0]?.object.material !== simpleSet.states[0]?.original;
    const activeGrassMaterial = grass.grass?.material || grass.material;
    const shader = activeGrassMaterial.userData.shader;
    if (shader) {
      shader.uniforms.uTime.value = elapsed;
      shader.uniforms.uWind.value = state.wind;
    }
    const activeWeedMaterial = grass.weeds?.material || grass.weedMat;
    const weedShader = activeWeedMaterial.userData.shader;
    if (weedShader) {
      weedShader.uniforms.uTime.value = elapsed + 2.1;
      weedShader.uniforms.uWind.value = state.wind * 1.15;
    }

    // The whole tree line breathes gently with the wind. The individual trees
    // are batched into two draw calls, so this is a single group transform.
    if (trees.forest) {
      trees.forest.rotation.z = Math.sin(elapsed * 0.17) * 0.0035 * (0.4 + state.wind);
      trees.forest.rotation.y = Math.sin(elapsed * 0.09) * 0.002 * (0.4 + state.wind);
    }

    // Floating pollen.
    if (motes.points.visible) {
      const pos = motes.points.geometry.attributes.position;
      const count = Math.min(pos.count, motes.points.geometry.drawRange.count);
      for (let i = 0; i < count; i++) {
        const y = pos.getY(i) + dt * 0.018;
        pos.setY(i, y > 5.1 ? 0.35 : y);
        pos.setX(i, pos.getX(i) + Math.sin(elapsed * 0.21 + i) * dt * (0.002 + state.wind * 0.002));
      }
      pos.needsUpdate = true;
    }

    for (const cloud of clouds) {
      cloud.position.x += dt * (0.016 + state.wind * 0.03);
      if (cloud.position.x > 38) cloud.position.x = -38;
    }
  }

  function setWind(strength) {
    state.wind = THREE.MathUtils.clamp(strength ?? 1, 0, 2.4);
  }

  function setWetness(value) {
    state.wetness = THREE.MathUtils.clamp(value ?? 0, 0, 1);
    const materials = [
      ground.ground.material,
      block.topMat,
      block.barkMat,
      block.trunk.material,
    ];
    for (const mat of materials) {
      if (!mat || Array.isArray(mat)) continue;
      if (mat.userData.baseRoughness === undefined) {
        mat.userData.baseRoughness = mat.roughness ?? 0.9;
      }
      mat.roughness = mat.userData.baseRoughness * (1 - state.wetness * 0.48);
      if (mat.userData.baseMetalness === undefined) {
        mat.userData.baseMetalness = mat.metalness ?? 0;
      }
      mat.metalness = mat.userData.baseMetalness + state.wetness * 0.08;
    }
    for (const puddle of puddles) {
      puddle.material.roughness = 0.08 + (1 - state.wetness) * 0.4;
    }
  }

  function setQuality(p) {
    if (!p) return;
    state.quality = p;
    if (grass.grass) grass.grass.count = Math.min(MAX_GRASS, p.grass);
    if (grass.weedMat?.userData.shader) {
      grass.weedMat.userData.shader.uniforms.uWind.value = state.wind;
    }
    if (grass.weeds) grass.weeds.count = Math.min(MAX_WEEDS, p.weeds);
    if (motes.points) {
      motes.points.visible = p.motes > 0;
      motes.points.geometry.setDrawRange(0, Math.max(0, Math.min(110, p.motes)));
    }
    const showDetails = (p.envDetail ?? 1) >= 0.7;
    for (const root of lowDetailRoots) {
      if (root) root.visible = showDetails;
    }
    for (const cloud of clouds) cloud.visible = showDetails;
    const size = p.shadowSize;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      sun.shadow.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
    }
    sun.shadow.radius = p.shadowRadius ?? 2;
    sun.castShadow = Boolean(p.shadows) && size > 0;
    applySimpleMaterials(Boolean(p.simpleMaterials));
    if (ground.ground) {
      const useSimpleGround = Boolean(p.simpleGround);
      ground.ground.material = useSimpleGround
        ? ground.ground.userData.simpleMaterial
        : ground.ground.userData.standardMaterial;
      ground.ground.receiveShadow = !useSimpleGround && Boolean(p.shadows);
    }
    if (snowOverlay) snowOverlay.receiveShadow = Boolean(p.shadows);
    const canopyShadows = Boolean(p.shadows) && p.name !== 'Low';
    if (trees.forest) {
      trees.forest.traverse((object) => {
        if (object.isMesh) object.castShadow = canopyShadows;
      });
    }
    fence.group.traverse((object) => {
      if (object.isMesh) object.castShadow = canopyShadows;
    });
    renderer.shadowMap.needsUpdate = true;
  }

  function updateShadow() {
    renderer.shadowMap.needsUpdate = true;
  }

  state.setQuality = setQuality;
  state.setAmbientLight = applyAmbientTint;
  state.onAmbient = null;
  state.setWind = setWind;
  state.setWetness = setWetness;
  state.updateShadow = updateShadow;
  setQuality(preset || {
    name: 'High',
    grass: MAX_GRASS,
    weeds: MAX_WEEDS,
    motes: 100,
    shadowSize: 2048,
    shadowRadius: 3,
  });

  return {
    ...state,
    update,
    materials: {
      woodTexture,
    },
  };
}
