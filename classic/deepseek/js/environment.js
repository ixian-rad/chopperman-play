import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createBarkTexture,
  createCloudTexture,
  createDirtPatchTexture,
  createEndGrainTexture,
  createGrassTexture,
  createShadowBlobTexture,
  createSidingTexture,
  createSurfaceMaps,
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
      #include <common>
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

        // Warm light pooling on the sun side of the sky. This is what makes the
        // golden hour read as a direction rather than a flat orange gradient.
        vec2 dh = normalize(dir.xz + vec2(0.0001));
        vec2 sh = normalize(uSunDir.xz + vec2(0.0001));
        float side = max(dot(dh, sh), 0.0);
        float vanish = 1.0 - h;
        float band = side * side * side * vanish * vanish * vanish;
        color += uSunColor * band * 0.3;

        // pow(sun, 480) is one of the most expensive per-pixel ops in the whole
        // frame on a software rasteriser. A smoothstep disc reads the same and
        // costs two compares; keep the cheaper broad aureole.
        vec3 sunDir = normalize(uSunDir);
        float sun = max(dot(dir, sunDir), 0.0);
        float sunDisc = smoothstep(0.9992, 0.99965, sun);
        color += uSunColor *
          (sunDisc * 2.8 + pow(sun, 20.0) * 0.22 + sun * sun * sun * sun * 0.05);
        float haze = vanish * vanish * vanish * vanish * vanish * vanish *
          vanish * vanish * vanish * vanish * vanish * vanish * 0.18;
        color += vec3(1.0, 0.83, 0.59) * haze;

        // A sub-LSB dither kills the banding the gradient shows on an 8-bit
        // framebuffer without adding a texture fetch.
        float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        color += (dither - 0.5) * (1.5 / 255.0);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), material);
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
  const geo = new THREE.PlaneGeometry(90, 90, 44, 44);
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
    map: textures.grass,
    // The unlit low preset needs a brighter albedo than the lit PBR path:
    // there is no sun to lift the dark, saturated grass texture.
    color: new THREE.Color(1.9, 1.8, 1.35),
    fog: true,
  });
  simpleGroundMaterial.userData.baseColor = new THREE.Color(1.9, 1.8, 1.35);
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
  const patch = new THREE.Mesh(new THREE.CircleGeometry(1.75, 24), patchMat);
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

  // SwiftShader pays a surprising fixed cost for instanced draws even when
  // only a few blades are visible. Bake a small merged copy of the same blades
  // for the Low preset: one ordinary draw, no per-instance vertex attributes,
  // and the same silhouette. Medium+ keeps the instanced meshes for density.
  const merged = buildMergedBlades([
    { mesh: grass, max: 900 },
    { mesh: weeds, max: 90 },
  ]);
  scene.add(merged);

  return { grass, material, weeds, weedMat, merged, mergedMaterial: merged.material };
}

/** Merge instanced blades into one non-instanced BufferGeometry for Low. */
function buildMergedBlades(sources) {
  const positions = [];
  const colors = [];
  const indices = [];
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  let vertexOffset = 0;
  for (const { mesh, max } of sources) {
    const geometry = mesh.geometry;
    const array = geometry.attributes.position.array;
    const index = geometry.index ? geometry.index.array : null;
    const vertexCount = array.length / 3;
    const instanced = Math.min(mesh.count, max);
    for (let i = 0; i < instanced; i++) {
      mesh.getMatrixAt(i, matrix);
      const r = mesh.instanceColor ? mesh.instanceColor.getX(i) : 1;
      const g = mesh.instanceColor ? mesh.instanceColor.getY(i) : 1;
      const b = mesh.instanceColor ? mesh.instanceColor.getZ(i) : 1;
      for (let k = 0; k < vertexCount; k++) {
        point.fromArray(array, k * 3).applyMatrix4(matrix);
        positions.push(point.x, point.y, point.z);
        colors.push(r, g, b);
      }
      if (index) {
        for (let j = 0; j < index.length; j++) indices.push(vertexOffset + index[j]);
      } else {
        for (let j = 0; j < vertexCount; j++) indices.push(vertexOffset + j);
      }
      vertexOffset += vertexCount;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.userData.baseColor = new THREE.Color(0xffffff);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: 1 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uTime;\nuniform float uWind;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
        float windPhase = position.x * 0.63 + position.z * 0.41;
        float bend = transformed.y * transformed.y;
        transformed.x += sin(uTime * (1.15 + uWind * 0.7) + windPhase) * bend * (0.1 + uWind * 0.15);
        transformed.z += cos(uTime * (0.9 + uWind * 0.5) + windPhase * 1.37) * bend * (0.04 + uWind * 0.07);
      `,
    );
    material.userData.shader = shader;
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'grass-merged';
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.visible = false;
  return mesh;
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
    bevelEnabled: false,
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
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
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
      new THREE.IcosahedronGeometry(1, 0),
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
      x,
      z,
      crownY,
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
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 0);
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
  const barkMaps = createSurfaceMaps(bark, {
    normalStrength: 2.0,
    roughnessBase: 0.9,
    roughnessContrast: 0.16,
  });
  const endMaps = createSurfaceMaps(endGrain, {
    normalStrength: 0.8,
    roughnessBase: 0.7,
    roughnessContrast: 0.26,
  });
  const barkMat = new THREE.MeshStandardMaterial({
    map: bark,
    color: 0x9c8663,
    roughness: 1,
    normalMap: barkMaps?.normalMap || null,
    roughnessMap: barkMaps?.roughnessMap || null,
  });
  if (barkMaps) barkMat.normalScale.set(1.0, 1.0);
  const topMat = new THREE.MeshStandardMaterial({
    map: endGrain,
    color: 0xdcb57b,
    roughness: 1,
    normalMap: endMaps?.normalMap || null,
    roughnessMap: endMaps?.roughnessMap || null,
  });
  if (endMaps) topMat.normalScale.set(0.55, 0.55);
  const sideMat = new THREE.MeshStandardMaterial({
    map: endGrain,
    color: 0xc19b62,
    roughness: 1,
    normalMap: endMaps?.normalMap || null,
    roughnessMap: endMaps?.roughnessMap || null,
  });
  if (endMaps) sideMat.normalScale.set(0.7, 0.7);

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
  const barkMaps = createSurfaceMaps(sharedBark, {
    normalStrength: 2.2,
    roughnessBase: 0.9,
    roughnessContrast: 0.14,
  });
  const endMaps = createSurfaceMaps(sharedEnd, {
    normalStrength: 0.7,
    roughnessBase: 0.74,
    roughnessContrast: 0.22,
  });
  const barkMat = new THREE.MeshStandardMaterial({
    map: sharedBark,
    color: 0x9a8462,
    roughness: 1,
    normalMap: barkMaps?.normalMap || null,
    roughnessMap: barkMaps?.roughnessMap || null,
  });
  if (barkMaps) barkMat.normalScale.set(1, 1);
  const endMat = new THREE.MeshStandardMaterial({
    map: sharedEnd,
    color: 0xd2ad77,
    roughness: 1,
    normalMap: endMaps?.normalMap || null,
    roughnessMap: endMaps?.roughnessMap || null,
  });
  if (endMaps) endMat.normalScale.set(0.6, 0.6);
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
  // A warm additive pool on the lawn under each lantern. Low-quality yard
  // materials are unlit (MeshBasic), so the real PointLight cannot tint them;
  // these decals are what make night read as lantern-lit instead of a dark
  // silhouette. One shared material and one quad per lamp: two extra draws.
  const poolTexture = makeGlowTexture();
  const poolMaterial = new THREE.MeshBasicMaterial({
    map: poolTexture,
    color: 0xffa956,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
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
    // Elliptical pool on the ground beneath the hanging bulb. Rotate the
    // local 0.34 m arm offset by the post's yaw so the pool sits under the lamp.
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMaterial);
    pool.rotation.x = -Math.PI / 2;
    pool.rotation.z = spec.rot * 0.35;
    pool.scale.set(2.7, 1.65, 1);
    pool.position.set(
      spec.x + Math.cos(spec.rot) * 0.34,
      0.042,
      spec.z - Math.sin(spec.rot) * 0.34,
    );
    pool.renderOrder = 2;
    scene.add(pool);
    const structureMeshes = mergeStaticGroup(post);
    group.add(post);
    lanterns.push({ light, glow, bulb, pool, intensity: 2.5, structureMeshes });
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

/**
 * A single merged batch of autumn leaves around the block and woodpile. The
 * lawn is a big empty plane at Low; a little ground litter adds near-field
 * detail for one draw call and ~220 triangles, with vertex colours so it
 * survives the quality switch to the unlit material set.
 */
function createLeafLitter(scene) {
  const random = mulberry32(0x1eaf);
  const positions = [];
  const colors = [];
  const indices = [];
  const palette = [0xa8582f, 0x8c4a22, 0xc07a3a, 0x6f4a27, 0xb98a3d, 0x7d5a30];
  const color = new THREE.Color();
  const count = 120;
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 0.65 + random() * 3.4;
    const x = Math.cos(angle) * radius;
    const z = -0.95 + Math.sin(angle) * radius * 0.9;
    // Keep the leaf litter out of the flagstone path approach.
    if (z > 2.0 && Math.abs(x - 1.7) < 0.75) continue;
    const yaw = random() * Math.PI * 2;
    const sx = 0.035 + random() * 0.055;
    const sz = sx * (0.55 + random() * 0.5);
    const tilt = (random() - 0.5) * 0.22;
    const y = 0.022 + random() * 0.012;
    color.setHex(palette[(random() * palette.length) | 0]);
    color.offsetHSL(0, (random() - 0.5) * 0.1, (random() - 0.5) * 0.12);
    const base = positions.length / 3;
    const corners = [
      [0, sz], [sx, 0], [0, -sz], [-sx, 0],
    ];
    for (let c = 0; c < 4; c++) {
      const lx = corners[c][0];
      const lz = corners[c][1];
      const rx = lx * Math.cos(yaw) - lz * Math.sin(yaw);
      const rz = lx * Math.sin(yaw) + lz * Math.cos(yaw);
      positions.push(x + rx, y + rz * tilt, z + rz);
      const shade = 0.86 + random() * 0.24;
      colors.push(color.r * shade, color.g * shade, color.b * shade);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'leaf-litter';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
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

/**
 * Snow that accumulates on things above the ground: fence rails, the roof
 * ridge and porch awning, and flattened caps on the tree crowns. All pieces
 * are merged into a single static mesh (one draw call) and the shared material
 * fades with snow intensity, so a storm reads as accumulation rather than a
 * white lawn plane with green trees.
 */
function createSnowCaps(scene, treeList = [], house = null) {
  const parts = [];
  const push = (geometry, x, y, z, rotY = 0) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    parts.push(g);
  };
  const box = (w, h, d, x, y, z, rotY = 0) =>
    push(new THREE.BoxGeometry(w, h, d), x, y, z, rotY);
  const blob = (sx, sy, sz, x, y, z, rotY = 0) => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(sx, sy, sz);
    push(g, x, y, z, rotY);
  };

  // Fence rails: the long back run plus the two side runs. The rail top is at
  // y = 0.68 with 0.085 thickness, so the snow slab sits just above it.
  box(17.5, 0.035, 0.1, 0, 0.742, -6.45);
  box(9.1, 0.035, 0.1, -8.72, 0.742, -2, Math.PI / 2);
  box(9.1, 0.035, 0.1, 8.72, 0.742, -2, Math.PI / 2);

  // House (group at -2.8, -10.1, yaw 0.07): roof ridge, porch awning and the
  // chimney cap catch the most snow.
  if (house) {
    const yaw = house.rotation?.y || 0;
    const hx = house.position?.x || 0;
    const hz = house.position?.z || 0;
    box(9.9, 0.05, 0.36, hx, 6.02, hz, yaw);
    box(3.15, 0.035, 1.08, hx, 2.76, hz + 2.68, yaw);
    box(0.78, 0.04, 0.82, hx + 3.0, 6.9, hz - 0.5, yaw);
  }

  // Tree crowns: two overlapping flattened blobs per tree give a dusted,
  // irregular cap instead of a single white mushroom.
  for (const tree of treeList) {
    const s = tree.scale || 1;
    const crownY = (tree.crownY || 4.5) * s;
    blob(2.25 * s, 0.42 * s, 2.1 * s, tree.x, crownY + 1.55 * s, tree.z, 0.4);
    blob(1.3 * s, 0.3 * s, 1.45 * s, tree.x + 0.7 * s, crownY + 1.9 * s, tree.z - 0.35 * s, 1.1);
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xf3f9ff,
    roughness: 0.96,
    metalness: 0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = 'snow-caps';
  mesh.visible = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/**
 * One instanced batch of soft radial AO decals. Real shadows are off on Low,
 * so these contact patches are what stop the block, woodpile and props from
 * looking like stickers floating on the lawn. Single draw call, no per-frame
 * work, and they also darken the ground beneath the block on High.
 */
function createContactShadows(scene) {
  const texture = createShadowBlobTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x090705,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  // Ordered by importance: Low draws only the first four (block, woodpile,
  // the AO patch under the log, bucket) and skips the scattered small props.
  const specs = [
    { x: BLOCK.x, z: BLOCK.z, y: 0.012, sx: 1.38, sz: 1.38, rot: 0 },
    { x: -3.4, z: -3.95, y: 0.012, sx: 1.75, sz: 1.3, rot: 0.08 },
    // AO on the block's top face, under the log.
    { x: BLOCK.x, z: BLOCK.z, y: BLOCK.top + 0.004, sx: 0.46, sz: 0.46, rot: 0.2 },
    { x: 1.5, z: -1.7, y: 0.012, sx: 0.5, sz: 0.5, rot: 0 },
    { x: 2.7, z: 1.45, y: 0.012, sx: 0.42, sz: 0.42, rot: 0 },
    { x: -3.2, z: -2.35, y: 0.012, sx: 0.42, sz: 0.42, rot: 0 },
    { x: 4.6, z: 0.0, y: 0.012, sx: 0.72, sz: 0.46, rot: -0.55 },
  ];
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    material,
    specs.length,
  );
  const dummy = new THREE.Object3D();
  specs.forEach((spec, index) => {
    dummy.position.set(spec.x, spec.y, spec.z);
    dummy.rotation.set(-Math.PI / 2, 0, spec.rot);
    dummy.scale.set(spec.sx, spec.sz, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.userData.maxCount = specs.length;
  scene.add(mesh);
  return mesh;
}

function buildSimpleMaterialSet(root, sunState = null) {
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
    // Remember the source so live material changes (wet bark, frost whitening,
    // hazard scorch) can be re-tinted into the unlit clone when the weather
    // grade refreshes.
    simple.userData.refreshFrom = material;
    simple.userData.colorScale = 0.95;
    // Unlit Basic materials were the main reason Low looked like a flat
    // poster: no sun, no normals, no form. Inject a single per-vertex sun
    // term into the existing Basic shader (one dot product, no extra draw or
    // light loop) so the house, fence, trees and log read as volumes. The
    // shared uniforms are driven by WeatherSystem so the shade direction and
    // warmth follow the real sun, golden hour and night.
    const previousCompile = typeof material.onBeforeCompile === 'function'
      ? material.onBeforeCompile
      : null;
    simple.onBeforeCompile = (shader, rendererInstance) => {
      if (previousCompile) previousCompile.call(simple, shader, rendererInstance);
      if (!sunState) return;
      shader.uniforms.uSunDirView = sunState.direction;
      shader.uniforms.uSunColor = sunState.color;
      shader.uniforms.uSunStrength = sunState.strength;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vSunLit;\nuniform vec3 uSunDirView;',
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
            vSunLit = clamp(dot(normalize(normalMatrix * normal), normalize(uSunDirView)) * 0.5 + 0.5, 0.0, 1.0);
          `,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vSunLit;\nuniform vec3 uSunColor;\nuniform float uSunStrength;',
        )
        .replace(
          '#include <tonemapping_fragment>',
          /* glsl */ `vec3 shadeTint = vec3(0.82, 0.86, 1.0);
            vec3 sunTint = mix(shadeTint, uSunColor, vSunLit);
            gl_FragColor.rgb *= mix(vec3(1.0), sunTint * (0.82 + 0.32 * vSunLit), uSunStrength);
            #include <tonemapping_fragment>`,
        );
    };
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
  sun.shadow.camera.far = 24;
  // Tight fit around the chopping block, the log and the humanoid. A 16 m
  // frustum wasted most of the shadow map on the lawn; 9 m doubles the usable
  // texel density at the same 512/1024/2048 map size.
  sun.shadow.camera.left = -4.5;
  sun.shadow.camera.right = 4.5;
  sun.shadow.camera.top = 4.5;
  sun.shadow.camera.bottom = -4.5;
  sun.shadow.camera.updateProjectionMatrix();
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
  // createTrees returns the tree array plus its merged forest group; expose the
  // group at the top level so the wind sway and shadow LOD actually run.
  trees.forest = trees.trees?.forest || null;
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
  const leafLitter = createLeafLitter(scene);
  const snowOverlay = createSnowOverlay(scene);
  const snowCaps = createSnowCaps(scene, trees.trees || [], house.group);
  const contactShadows = createContactShadows(scene);

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
    leafLitter,
    snowOverlay,
    snowCaps,
    contactShadows,
    ground,
    windowMaterials: [...(house.windowMaterials || [])],
    elapsed: 0,
    grassShader: grass.material.userData.shader,
    wind: 1,
    wetness: 0,
    snowIntensity: 0,
    rainIntensity: 0,
    fogIntensity: 0,
  };

  // Shared uniforms for the cheap directional shading used by Low's unlit
  // material clones. WeatherSystem writes them once per frame.
  const simpleSunState = {
    direction: { value: new THREE.Vector3(0.35, 0.82, 0.45).normalize() },
    color: { value: new THREE.Color(0xffe2b8) },
    strength: { value: 0.55 },
  };
  const simpleSunScratch = new THREE.Vector3();
  const simpleSet = buildSimpleMaterialSet(scene, simpleSunState);

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
    for (const [source, simple] of simpleSet.cache) {
      const base = simple.userData.baseColor;
      if (!base) continue;
      if (source?.color) {
        base.copy(source.color).multiplyScalar(simple.userData.colorScale ?? 0.95);
      }
      simple.color.copy(base).multiply(color).multiplyScalar(intensity);
    }
    const groundMaterial = ground.ground?.material;
    if (groundMaterial && groundMaterial.userData.baseColor) {
      groundMaterial.color.copy(groundMaterial.userData.baseColor).multiply(color).multiplyScalar(intensity);
    }
    const mergedGrass = grass.mergedMaterial;
    if (mergedGrass?.userData.baseColor) {
      mergedGrass.color.copy(mergedGrass.userData.baseColor).multiply(color).multiplyScalar(intensity);
    }
  }

  function update(dt, elapsed) {
    state.elapsed = elapsed;
    state.simpleActive = simpleSet.states[0]?.object.material !== simpleSet.states[0]?.original;
    // Only one of the instanced / merged grass paths is visible; update both so
    // a live quality switch never starts with stale wind uniforms.
    for (const material of [grass.grass?.material, grass.weedMat, grass.mergedMaterial]) {
      const shader = material?.userData?.shader;
      if (!shader) continue;
      shader.uniforms.uTime.value = elapsed;
      shader.uniforms.uWind.value = state.wind;
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

  /**
   * Drive the cheap directional term on the Low material clones. The world
   * sun direction is rotated into view space with the camera so the shading
   * survives orbit; colour and strength follow the time-of-day pass.
   */
  function setSimpleSun(sceneDirection, camera, color, strength = 0.55) {
    if (!sceneDirection) return;
    if (camera?.matrixWorldInverse) {
      simpleSunScratch.copy(sceneDirection).transformDirection(camera.matrixWorldInverse);
      simpleSunState.direction.value.copy(simpleSunScratch);
    } else {
      simpleSunState.direction.value.copy(sceneDirection).normalize();
    }
    if (color) simpleSunState.color.value.copy(color);
    simpleSunState.strength.value = THREE.MathUtils.clamp(strength, 0, 1);
  }

  /**
   * Remember the current storm intensities inside `state` (the returned
   * object also exposes copies), so a live quality switch can re-apply
   * opacity to the freshly swapped lit/unlit snow and puddle materials.
   */
  function setStormIntensity(snow = 0, rain = 0, fog = 0) {
    state.snowIntensity = THREE.MathUtils.clamp(snow, 0, 1);
    state.rainIntensity = THREE.MathUtils.clamp(rain, 0, 1);
    state.fogIntensity = THREE.MathUtils.clamp(fog, 0, 1);
  }

  function setQuality(p) {
    if (!p) return;
    state.quality = p;
    // Low-quality software rendering uses the pre-merged blade batch: one
    // ordinary draw instead of two instanced draws, and materially cheaper in
    // SwiftShader. Medium+ keeps the instanced meshes for full density.
    const useMergedGrass = Boolean(p.simpleMaterials);
    if (grass.grass) {
      grass.grass.count = Math.min(MAX_GRASS, p.grass);
      grass.grass.visible = !useMergedGrass;
    }
    if (grass.weeds) {
      grass.weeds.count = Math.min(MAX_WEEDS, p.weeds);
      grass.weeds.visible = !useMergedGrass;
    }
    if (grass.merged) grass.merged.visible = useMergedGrass;
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
    // A quality switch swaps the snow/puddle materials back to their lit
    // originals. The last weather pass wrote opacity onto whichever material
    // was active then, so re-apply the cached intensity to the new one.
    state.snowIntensity = state.snowIntensity || 0;
    state.rainIntensity = state.rainIntensity || 0;
    if (snowOverlay) {
      snowOverlay.material.opacity = state.snowIntensity * 0.82;
      snowOverlay.visible = state.snowIntensity > 0.03;
    }
    if (snowCaps) {
      snowCaps.material.opacity = state.snowIntensity * 0.94;
      snowCaps.visible = state.snowIntensity > 0.03;
    }
    for (const puddle of puddles) {
      puddle.material.opacity = state.rainIntensity > 0.08
        ? 0.18 + state.rainIntensity * 0.42
        : 0;
      puddle.visible = state.rainIntensity > 0.08;
    }
    if (ground.ground) {
      const useSimpleGround = Boolean(p.simpleGround);
      ground.ground.material = useSimpleGround
        ? ground.ground.userData.simpleMaterial
        : ground.ground.userData.standardMaterial;
      ground.ground.receiveShadow = !useSimpleGround && Boolean(p.shadows);
    }
    if (snowOverlay) snowOverlay.receiveShadow = Boolean(p.shadows);
    if (contactShadows) {
      contactShadows.count = p.simpleMaterials
        ? Math.min(4, contactShadows.userData.maxCount)
        : contactShadows.userData.maxCount;
    }
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
  state.setSimpleSun = setSimpleSun;
  state.setStormIntensity = setStormIntensity;
  state.simpleSunState = simpleSunState;
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
