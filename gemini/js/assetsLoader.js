import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadTreeLibrary } from '../assets/trees_v2/runtime/trees.js';
import { applyWind } from '../assets/trees_v2/runtime/wind.js';

// Ensure BufferAttribute / InterleavedBufferAttribute have getComponent(i, k) for trees_v2 bakeGeometry
for (const Proto of [THREE.BufferAttribute?.prototype, THREE.InterleavedBufferAttribute?.prototype]) {
  if (Proto && typeof Proto.getComponent !== 'function') {
    Proto.getComponent = function getComponent(index, component) {
      let v = this.array[index * this.itemSize + component];
      if (this.normalized) {
        if (this.array instanceof Int8Array) v = Math.max(v / 127, -1);
        else if (this.array instanceof Uint8Array) v /= 255;
        else if (this.array instanceof Int16Array) v = Math.max(v / 32767, -1);
        else if (this.array instanceof Uint16Array) v /= 65535;
      }
      return v;
    };
  }
}

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const textureLoader = new THREE.TextureLoader();

const glbPromiseCache = new Map();
const texturePromiseCache = new Map();
const treeSpeciesCache = {};
const fastMaterialCache = new WeakMap();

export const SETTING_SPECIES = {
  nj: ['pine', 'oak', 'maple', 'birch'],
  tiraspol: ['walnut', 'apricot', 'poplar', 'birch']
};

export const AXE_MODEL_URLS = {
  sergey: './assets/models/common/axe_sergey.glb',
  double_bit: './assets/models/common/axe_double_bit.glb',
  maul: './assets/models/common/splitting_maul.glb',
  golden: './assets/models/common/axe_golden.glb'
};

export const CHARACTER_COSTUMES = {
  sergey: ['tee', 'jacket'],
  alex: ['camo', 'bomber']
};

export const COSTUME_MODEL_URLS = {
  tee: './assets/models/common/char_sergey_animated_pbr.glb',
  jacket: './assets/models/common/char_sergey_jacket_animated_pbr.glb',
  camo: './assets/models/common/char_alex_animated_pbr.glb',
  bomber: './assets/models/common/char_alex_jacket_animated_pbr.glb'
};

export const EXTRA_CLIP_URLS = {
  walk: './assets/models/common/char_sergey_walking_armature.glb',
  run: './assets/models/common/char_sergey_running_armature.glb'
};

export const EXTRA_CLIP_URLS_BY_CHAR = {
  sergey: {
    walk: './assets/models/common/char_sergey_walking_armature.glb',
    run: './assets/models/common/char_sergey_running_armature.glb'
  },
  alex: {
    walk: './assets/models/common/char_alex_walking_armature.glb',
    run: './assets/models/common/char_alex_running_armature.glb'
  }
};

export const CHARACTER_PREVIEW_ART = {
  sergey: {
    tee: './assets/art/nj/nj_keyart.webp',
    jacket: './assets/art/nj/nj_keyart_jacket.webp'
  },
  alex: {
    camo: './assets/art/common/alex_portrait.webp',
    bomber: './assets/art/nj/alex_nj_keyart_jacket.webp'
  }
};

const previewBlobUrlCache = new Map();

export async function preloadCharacterPreviewArt() {
  const urls = [
    CHARACTER_PREVIEW_ART.sergey.tee,
    CHARACTER_PREVIEW_ART.sergey.jacket,
    CHARACTER_PREVIEW_ART.alex.camo,
    CHARACTER_PREVIEW_ART.alex.bomber
  ];
  await Promise.all(
    urls.map(async (url) => {
      if (previewBlobUrlCache.has(url)) return previewBlobUrlCache.get(url);
      try {
        const res = await fetch(url);
        if (!res.ok) return url;
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        previewBlobUrlCache.set(url, objUrl);
        return objUrl;
      } catch {
        return url;
      }
    })
  );
}

export function getCharacterPreviewUrl(character = 'sergey', costume = 'tee') {
  const rawUrl =
    CHARACTER_PREVIEW_ART[character]?.[costume] ||
    CHARACTER_PREVIEW_ART.sergey.tee;
  return previewBlobUrlCache.get(rawUrl) || null;
}

export function getGLTFLoader() {
  return gltfLoader;
}

export function loadGLB(url) {
  if (glbPromiseCache.has(url)) {
    return glbPromiseCache.get(url);
  }
  const p = gltfLoader.loadAsync(url).catch((err) => {
    glbPromiseCache.delete(url);
    throw err;
  });
  glbPromiseCache.set(url, p);
  return p;
}

export function loadTexture(url, options = {}) {
  if (texturePromiseCache.has(url)) {
    return texturePromiseCache.get(url);
  }
  const p = textureLoader.loadAsync(url).then((tex) => {
    tex.colorSpace = options.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    if (options.repeat) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(options.repeat[0], options.repeat[1]);
    }
    return tex;
  }).catch((err) => {
    texturePromiseCache.delete(url);
    throw err;
  });
  texturePromiseCache.set(url, p);
  return p;
}

/**
 * Converts a tree MeshStandardMaterial into a fast vertex-lit MeshLambertMaterial
 * while preserving diffuse map, alphaTest, double-sidedness, and wind shader hook.
 */
function optimizeTreeMaterial(srcMat, key = '') {
  if (!srcMat) return srcMat;
  if (fastMaterialCache.has(srcMat)) {
    return fastMaterialCache.get(srcMat);
  }
  if (srcMat.map) {
    srcMat.map.generateMipmaps = false;
    srcMat.map.minFilter = THREE.LinearFilter;
  }
  const isLeaves = key === 'leaves' || srcMat.name === 'leaves';
  const isImpostor = key.startsWith('impostor') || (srcMat.name && srcMat.name.startsWith('impostor'));
  const hasWind = key === 'bark' || isLeaves || isImpostor || Boolean(srcMat.onBeforeCompile?.__isWind);

  const lambert = new THREE.MeshLambertMaterial({
    name: srcMat.name || key,
    color: srcMat.color ? srcMat.color.clone() : new THREE.Color(0xffffff),
    map: srcMat.map || null,
    transparent: Boolean(srcMat.transparent),
    opacity: srcMat.opacity ?? 1.0,
    alphaTest: srcMat.alphaTest || (isLeaves || isImpostor ? 0.5 : 0),
    side: srcMat.side ?? THREE.FrontSide,
    emissive: isLeaves ? new THREE.Color(0.12, 0.14, 0.09) : new THREE.Color(0x000000)
  });

  if (hasWind) {
    applyWind(lambert);
  }

  fastMaterialCache.set(srcMat, lambert);
  return lambert;
}

export async function loadTreeLibForSpecies(speciesList) {
  const missing = speciesList.filter((sp) => !treeSpeciesCache[sp]);
  if (missing.length > 0) {
    const urls = Object.fromEntries(
      missing.map((sp) => [sp, `./assets/trees_v2/models/tree_${sp}.glb`])
    );
    const loaded = await loadTreeLibrary(gltfLoader, urls, { wind: true });
    for (const sp of Object.keys(loaded)) {
      const variants = loaded[sp]?.variants || [];
      for (const v of variants) {
        if (!v) continue;
        for (const [k, mat] of Object.entries(v.materials || {})) {
          v.materials[k] = optimizeTreeMaterial(mat, k);
        }
        for (const lod of ['lod0', 'lod1', 'lod2']) {
          const lodObj = v[lod];
          if (!lodObj) continue;
          for (const propKey of Object.keys(lodObj)) {
            if (propKey.startsWith('mat_')) {
              const partName = propKey.slice(4);
              lodObj[propKey] = optimizeTreeMaterial(lodObj[propKey], partName);
            }
          }
        }
      }
    }
    Object.assign(treeSpeciesCache, loaded);
  }
  const result = {};
  for (const sp of speciesList) {
    if (treeSpeciesCache[sp]) {
      result[sp] = treeSpeciesCache[sp];
    }
  }
  return result;
}

/**
 * Converts a prop MeshStandardMaterial to a fast MeshLambertMaterial (dropping 1024px normal/roughness maps
 * so software rendering doesn't stall uploading & sampling 3 textures per pixel).
 */
export function toFastPropMaterial(srcMat, fog = true, emissiveBoost = 0) {
  if (!srcMat) return srcMat;
  if (srcMat.map) {
    srcMat.map.generateMipmaps = false;
    srcMat.map.minFilter = THREE.LinearFilter;
  }
  if (fog && emissiveBoost === 0 && fastMaterialCache.has(srcMat)) {
    return fastMaterialCache.get(srcMat);
  }

  const baseColor = srcMat.color ? srcMat.color.clone() : new THREE.Color(0xffffff);
  const emissive =
    emissiveBoost > 0
      ? baseColor.clone().multiplyScalar(emissiveBoost)
      : srcMat.emissive
      ? srcMat.emissive.clone()
      : new THREE.Color(0x000000);

  const lambert = new THREE.MeshLambertMaterial({
    name: srcMat.name || '',
    color: baseColor,
    map: srcMat.map || null,
    transparent: Boolean(srcMat.transparent),
    opacity: srcMat.opacity ?? 1.0,
    alphaTest: srcMat.alphaTest ?? 0,
    depthWrite: srcMat.depthWrite ?? true,
    side: srcMat.side ?? THREE.FrontSide,
    fog: Boolean(fog),
    emissive,
    emissiveIntensity: emissiveBoost > 0 ? 1.0 : srcMat.emissiveIntensity ?? 1.0
  });

  if (fog && emissiveBoost === 0) {
    fastMaterialCache.set(srcMat, lambert);
  }
  return lambert;
}

/**
 * Clones a loaded GLTF scene, scales it uniformly to a target real-world height or length (in metres),
 * centers its XZ origin, and places its base flush at local y = 0 (unless centerOrigin = true).
 */
export function createScaledPropInstance(gltfScene, options = {}) {
  const {
    targetHeight = null,
    targetLength = null,
    x = 0,
    y = 0,
    z = 0,
    rotX = 0,
    rotY = 0,
    rotZ = 0,
    castShadow = false,
    receiveShadow = true,
    fog = true,
    centerOrigin = false,
    emissiveBoost = 0
  } = options;

  if (!gltfScene.userData._cachedBounds) {
    gltfScene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltfScene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    gltfScene.userData._cachedBounds = {
      minY: box.min.y,
      sizeX: size.x,
      sizeY: size.y,
      sizeZ: size.z,
      centerX: center.x,
      centerY: center.y,
      centerZ: center.z
    };
  }

  const b = gltfScene.userData._cachedBounds;
  const clone = gltfScene.clone(true);

  let scale = 1.0;
  if (targetHeight && b.sizeY > 0.001) {
    scale = targetHeight / b.sizeY;
  } else if (targetLength && Math.max(b.sizeX, b.sizeZ) > 0.001) {
    scale = targetLength / Math.max(b.sizeX, b.sizeZ);
  }

  clone.scale.multiplyScalar(scale);
  if (centerOrigin) {
    clone.position.set(-b.centerX * scale, -b.centerY * scale, -b.centerZ * scale);
  } else {
    clone.position.set(-b.centerX * scale, -b.minY * scale, -b.centerZ * scale);
  }

  clone.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = Boolean(castShadow);
      child.receiveShadow = Boolean(receiveShadow);
      if (Array.isArray(child.material)) {
        child.material = child.material.map((m) => toFastPropMaterial(m, fog, emissiveBoost));
      } else if (child.material) {
        child.material = toFastPropMaterial(child.material, fog, emissiveBoost);
      }
    }
  });

  const wrapper = new THREE.Group();
  wrapper.add(clone);
  wrapper.position.set(x, y, z);
  wrapper.rotation.set(rotX, rotY, rotZ);

  return {
    group: wrapper,
    width: b.sizeX * scale,
    height: b.sizeY * scale,
    depth: b.sizeZ * scale
  };
}

/**
 * 4x4 Woodchips Sprite Sheet Particle Emitter (`assets/art/common/fx_woodchips_sheet_4x4.webp`).
 * Shares a single WebGLTexture and a single Material across pre-sliced UV cell geometries
 * so spawning woodchips never triggers new texture uploads or shader compilations mid-swing.
 */
export class WoodchipsSpriteBurst {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'WoodchipsSpriteBurstGroup';
    this.scene.add(this.group);

    this.activeChips = [];
    this.pool = [];
    this.cellGeometries = [];
    this.sharedMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this._ready = false;

    this._buildCellGeometries();
    this._initAtlas();
  }

  _buildCellGeometries() {
    for (let i = 0; i < 8; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const geo = new THREE.PlaneGeometry(0.16, 0.16);
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) {
        const u = uv.getX(k);
        const v = uv.getY(k);
        uv.setXY(k, (col + u) * 0.25, (3 - row + v) * 0.25);
      }
      uv.needsUpdate = true;
      this.cellGeometries.push(geo);
    }
  }

  async _initAtlas() {
    try {
      const baseTex = await loadTexture('./assets/art/common/fx_woodchips_sheet_4x4.webp');
      this.sharedMat.map = baseTex;
      this.sharedMat.needsUpdate = true;
      this._ready = true;
    } catch {
      this.sharedMat.color.setHex(0xd8b47c);
      this._ready = true;
    }
  }

  spawn(worldPoint, swingDir = null, count = 10) {
    if (!this.cellGeometries.length) return;
    const dx = swingDir ? -swingDir.x : 0;
    const dz = swingDir ? -swingDir.z : 1;

    for (let i = 0; i < count; i++) {
      let mesh = this.pool.pop();
      const geo = this.cellGeometries[i % this.cellGeometries.length];
      if (!mesh) {
        mesh = new THREE.Mesh(geo, this.sharedMat);
      } else {
        mesh.geometry = geo;
      }
      mesh.visible = true;
      mesh.position.set(
        worldPoint.x + (Math.random() - 0.5) * 0.16,
        worldPoint.y + (Math.random() - 0.5) * 0.12,
        worldPoint.z + (Math.random() - 0.5) * 0.16
      );
      const scale = 0.65 + Math.random() * 0.85;
      mesh.scale.setScalar(scale);
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );
      this.group.add(mesh);

      const vel = new THREE.Vector3(
        dx * (1.2 + Math.random() * 1.8) + (Math.random() - 0.5) * 3.2,
        1.4 + Math.random() * 2.8,
        dz * (1.2 + Math.random() * 1.8) + (Math.random() - 0.5) * 3.2
      );
      const rotVel = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      );
      this.activeChips.push({
        mesh,
        vel,
        rotVel,
        life: 0.75 + Math.random() * 0.45
      });
    }
  }

  update(dt) {
    for (let i = this.activeChips.length - 1; i >= 0; i--) {
      const c = this.activeChips[i];
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.visible = false;
        this.group.remove(c.mesh);
        this.pool.push(c.mesh);
        this.activeChips.splice(i, 1);
        continue;
      }
      if (c.mesh.position.y > 0.02) {
        c.vel.y -= 9.81 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.rotVel.x * dt;
        c.mesh.rotation.y += c.rotVel.y * dt;
        c.mesh.rotation.z += c.rotVel.z * dt;
        if (c.mesh.position.y < 0.02) {
          c.mesh.position.y = 0.02;
          c.vel.set(0, 0, 0);
          c.mesh.rotation.x = -Math.PI / 2;
        }
      }
    }
  }
}
