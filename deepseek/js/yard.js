/**
 * Assets-v2 yard layer for American Split.
 *
 * This module is deliberately additive: the original log-splitting simulation
 * still owns the chopping block, debris, RPG, weather and audio. The yard layer
 * adds the two real settings, Sergey, the trees_v2 forest, locomotion and the
 * third-person camera, then hands control back to the original "stump" mode
 * whenever the player steps up to the block.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SergeyCharacter, AXE_SKINS, GAME_AXE_TO_SKIN } from './character.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadTreeLibrary, TreeField } from '../assets/trees_v2/runtime/trees.js';
import { updateWind, WIND } from '../assets/trees_v2/runtime/wind.js';
import { clamp, mulberry32 } from './utils.js';

const ASSET_ROOT = '../assets/';
const asset = (path) => new URL(ASSET_ROOT + path, import.meta.url).href;

const TREE_FILES = {
  pine: asset('trees_v2/models/tree_pine.glb'),
  oak: asset('trees_v2/models/tree_oak.glb'),
  maple: asset('trees_v2/models/tree_maple.glb'),
  birch: asset('trees_v2/models/tree_birch.glb'),
  walnut: asset('trees_v2/models/tree_walnut.glb'),
  apricot: asset('trees_v2/models/tree_apricot.glb'),
  poplar: asset('trees_v2/models/tree_poplar.glb'),
};

const SETTING_SPECIES = {
  nj: ['pine', 'oak', 'maple', 'birch'],
  tiraspol: ['walnut', 'apricot', 'poplar', 'birch'],
};

const PROP_FILES = {
  shed_nj: 'models/nj/shed_nj.glb',
  chopping_stump_nj: 'models/nj/chopping_stump_nj.glb',
  firewood_heap_nj: 'models/nj/firewood_heap_nj.glb',
  tarp_woodpile: 'models/nj/tarp_woodpile.glb',
  arborvitae: 'models/nj/arborvitae.glb',
  fence_privacy: 'models/nj/fence_privacy.glb',
  fence_splitrail: 'models/nj/fence_splitrail.glb',
  patio_set: 'models/nj/patio_set.glb',
  grill_gas: 'models/nj/grill_gas.glb',
  swing_set: 'models/nj/swing_set.glb',
  recycling_bin: 'models/nj/recycling_bin.glb',
  siding_wall: 'models/nj/siding_wall.glb',
  house_wall: 'models/nj/house_wall.glb',
  fence_planks: 'models/tiraspol/fence_planks.glb',
  iron_tools_horseshoe: 'models/tiraspol/iron_tools_horseshoe.glb',
  mangal: 'models/tiraspol/mangal.glb',
  house_wall_grapevine: 'models/tiraspol/house_wall_grapevine.glb',
  bench: 'models/tiraspol/bench.glb',
  lada_car: 'models/tiraspol/lada_car.glb',
  well: 'models/tiraspol/well.glb',
  tomato_garden: 'models/tiraspol/tomato_garden.glb',
  khrushchevka: 'models/tiraspol/khrushchevka.glb',
  cathedral: 'models/tiraspol/cathedral.glb',
  wheelbarrow: 'models/common/wheelbarrow.glb',
  firewood_pile: 'models/common/firewood_pile.glb',
  split_log_halves: 'models/common/split_log_halves.glb',
  chopping_block: 'models/common/chopping_block.glb',
  chips_scatter: 'models/common/chips_scatter.glb',
};

const BACKDROP_FILES = {
  nj: {
    wide: 'art/nj/nj_background_wide.webp',
    dusk: 'art/nj/nj_background_dusk.webp',
    night: 'art/nj/nj_background_night.webp',
  },
  tiraspol: {
    wide: 'art/tiraspol/tiraspol_background_wide.webp',
    dusk: 'art/tiraspol/tiraspol_background_dusk.webp',
    night: 'art/tiraspol/tiraspol_background_night.webp',
  },
};

const TEX_FILES = {
  mulch: 'art/nj/tex_mulch_chips_decal.webp',
  chips: 'art/common/fx_woodchips_sheet_4x4.webp',
  bark: 'art/common/tex_bark_seamless.webp',
};

const SETTING_LABELS = {
  nj: 'NJ backyard',
  tiraspol: 'Tiraspol backyard',
};

const WOOD_LABEL = {
  pine: 'Pine',
  oak: 'Oak',
  maple: 'Maple',
  birch: 'Birch',
  walnut: 'Walnut',
  apricot: 'Apricot',
  poplar: 'Poplar',
};

const BLOCK = { x: 0, z: -0.95, top: 0.48 };

function qualitySettings(name) {
  if (name === 'low') {
    return {
      name,
      trees: 16,
      lod1: 7,
      lod2: 18,
      castShadow: false,
      propDetail: 0.5,
      backdrop: true,
    };
  }
  if (name === 'medium') {
    return {
      name,
      trees: 34,
      lod1: 24,
      lod2: 62,
      castShadow: true,
      propDetail: 0.8,
      backdrop: true,
    };
  }
  return {
    name,
    trees: 42,
    lod1: 34,
    lod2: 88,
    castShadow: true,
    propDetail: 1,
    backdrop: true,
  };
}

function boxOf(object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function disposeGroup(group) {
  group.traverse((object) => {
    if (!object.isMesh && !object.isPoints) return;
    if (object.geometry?.dispose) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
        if (material[key]) material[key].dispose?.();
      }
      material.dispose?.();
    }
  });
}

/** One-draw-call woodchip burst using the supplied 4x4 sprite sheet. */
class ChipBurst {
  constructor(scene, texture, capacity = 96) {
    this.capacity = capacity;
    this.count = 0;
    this.data = [];
    const positions = new Float32Array(capacity * 3);
    const cells = new Float32Array(capacity * 2);
    const sizes = new Float32Array(capacity);
    const alphas = new Float32Array(capacity);
    const rots = new Float32Array(capacity);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aCell', new THREE.BufferAttribute(cells, 2));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('aRot', new THREE.BufferAttribute(rots, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec2 aCell;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aRot;
        varying vec2 vCell;
        varying float vAlpha;
        varying float vRot;
        void main() {
          vCell = aCell;
          vAlpha = aAlpha;
          vRot = aRot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (420.0 / max(0.4, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vCell;
        varying float vAlpha;
        varying float vRot;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float c = cos(vRot);
          float s = sin(vRot);
          uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
          vec4 tex = texture2D(uMap, vCell + uv * 0.25);
          float alpha = tex.a * vAlpha;
          if (alpha < 0.08) discard;
          gl_FragColor = vec4(tex.rgb, alpha);
        }
      `,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'yard-woodchips';
    scene.add(this.points);
    this.geometry = geometry;
    this.active = [];
    for (let i = 0; i < capacity; i += 1) {
      this.active.push({
        alive: false,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        size: 0,
        alpha: 0,
        rot: 0,
        spin: 0,
        life: 0,
        maxLife: 1,
        cellX: 0,
        cellY: 0,
      });
    }
  }

  spawn(point, dir, amount = 12) {
    const random = Math.random;
    for (let i = 0; i < amount; i += 1) {
      const slot = this.active.find((item) => !item.alive);
      if (!slot) return;
      const away = dir ? dir.clone() : new THREE.Vector3(0, 0, 1);
      slot.alive = true;
      slot.p.set(
        point.x + (random() - 0.5) * 0.12,
        point.y + (random() - 0.5) * 0.12,
        point.z + (random() - 0.5) * 0.12,
      );
      slot.v.set(
        away.x * (1.4 + random() * 2.2) + (random() - 0.5) * 2.4,
        1.2 + random() * 2.6,
        away.z * (1.4 + random() * 2.2) + (random() - 0.5) * 2.4,
      );
      slot.size = 0.055 + random() * 0.075;
      slot.alpha = 1;
      slot.rot = random() * Math.PI * 2;
      slot.spin = (random() - 0.5) * 10;
      slot.maxLife = 0.8 + random() * 0.9;
      slot.life = slot.maxLife;
      slot.cellX = Math.floor(random() * 4) / 4;
      slot.cellY = Math.floor(random() * 4) / 4;
    }
  }

  update(dt) {
    const pos = this.geometry.attributes.position;
    const cell = this.geometry.attributes.aCell;
    const size = this.geometry.attributes.aSize;
    const alpha = this.geometry.attributes.aAlpha;
    const rot = this.geometry.attributes.aRot;
    let index = 0;
    for (const item of this.active) {
      if (!item.alive) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.alive = false;
        continue;
      }
      item.v.y -= 9.8 * dt;
      item.p.addScaledVector(item.v, dt);
      item.rot += item.spin * dt;
      if (item.p.y < 0.025) {
        item.p.y = 0.025;
        item.v.y *= -0.22;
        item.v.x *= 0.65;
        item.v.z *= 0.65;
      }
      pos.setXYZ(index, item.p.x, item.p.y, item.p.z);
      cell.setXY(index, item.cellX, item.cellY);
      size.setX(index, item.size);
      alpha.setX(index, Math.min(1, item.life / (item.maxLife * 0.55)));
      rot.setX(index, item.rot);
      index += 1;
    }
    this.count = index;
    pos.needsUpdate = true;
    cell.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    rot.needsUpdate = true;
    this.geometry.setDrawRange(0, index);
  }
}

export class YardMode {
  constructor({
    scene,
    renderer,
    camera,
    controls,
    game,
    sound,
    weather,
    qualityName = 'low',
    onToast = null,
    onHud = null,
    onStumpEnter = null,
    onYardEnter = null,
    isInputBlocked = null,
  } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.controls = controls;
    this.game = game;
    this.sound = sound;
    this.weather = weather;
    this.onToast = onToast;
    this.onHud = onHud;
    this.onStumpEnter = onStumpEnter;
    this.onYardEnter = onYardEnter;
    this.isInputBlocked = isInputBlocked || (() => false);
    this.quality = qualityName;
    this.settings = qualitySettings(qualityName);
    this.loader = null;
    this.treeLib = null;
    this.character = null;
    this.loaded = false;
    this.mode = 'yard';
    this.setting = 'nj';
    this.costume = 'tee';
    this.axeSkin = 'sergey';
    this.elapsed = 0;
    this.yards = new Map();
    this.activeYard = null;
    this.propAssets = new Map();
    this.textures = new Map();
    this.fields = new Map();
    this.player = new THREE.Vector3(2.7, 0, 3.5);
    this.velocity = new THREE.Vector3();
    this.playerYaw = 0.55;
    this.cameraYaw = 0.55;
    this.cameraPitch = 0.22;
    this.cameraTarget = new THREE.Vector3(2.7, 1.35, 3.5);
    this.keys = new Set();
    this.pointerLocked = false;
    this.swingLock = false;
    this.target = null;
    this.targetPoint = new THREE.Vector3();
    this.blockDistance = 99;
    this.footDistance = 0;
    this.stepIndex = 0;
    this.shake = 0;
    this.hudTimer = 0;
    this.targetTimer = 0;
    this.backdropTimer = 0;
    this.backdropKey = '';
    this.lastFelled = 0;
    this.lastSave = 0;
    this.aftermath = null;
    this.stumpPose = new THREE.Vector3(0, 0, 0.32);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this.bounds = { minX: -8.5, maxX: 8.5, minZ: -6.55, maxZ: 5.95 };
    this.ui = {};
    this._buildUi();
  }

  assetList() {
    const list = [];
    for (const [key, file] of Object.entries(PROP_FILES)) list.push([key, file]);
    return list;
  }

  _buildUi() {
    const id = (name) => document.getElementById(name);
    this.ui = {
      hud: id('yardHud'),
      location: id('yardLocation'),
      modeLabel: id('yardModeLabel'),
      felled: id('yardFelled'),
      nearest: id('yardNearest'),
      prompt: id('yardPrompt'),
      promptTitle: id('yardPromptTitle'),
      promptText: id('yardPromptText'),
      promptAction: id('yardPromptAction'),
      blockPrompt: id('yardBlockPrompt'),
      crosshair: id('yardCrosshair'),
      hint: id('yardHint'),
    };
  }

  async init(onProgress = null) {
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const report = (value, label) => onProgress?.(clamp(value, 0, 1), label);
    report(0.02, 'Calling Sergey in from the woodpile…');
    this.character = new SergeyCharacter({
      scene: this.scene,
      loader: this.loader,
      sound: this.sound,
      onProgress: (p) => report(0.02 + p * 0.25, 'Fitting Sergey’s boots…'),
    });
    await this.character.load();
    report(0.3, 'Loading the axes and yard props…');

    const entries = this.assetList();
    let done = 0;
    const textureEntries = Object.entries(TEX_FILES).map(([key, file]) => [key, asset(file)]);
    const texturePromises = textureEntries.map(async ([key, url]) => {
      try {
        const texture = await new THREE.TextureLoader().loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 2;
        this.textures.set(key, texture);
      } catch {
        // A missing decal must not stop the yard from loading.
      } finally {
        done += 1;
        report(0.3 + (done / (entries.length + textureEntries.length + 9)) * 0.36, 'Loading the yard…');
      }
    });
    const propPromises = entries.map(async ([key, file]) => {
      try {
        const gltf = await this.loader.loadAsync(asset(file));
        this.propAssets.set(key, gltf);
      } catch {
        // Individual prop failures are tolerated; the yard still plays.
      } finally {
        done += 1;
        report(0.3 + (done / (entries.length + textureEntries.length + 9)) * 0.36, 'Loading the yard…');
      }
    });
    const backdropPromises = [];
    for (const [setting, files] of Object.entries(BACKDROP_FILES)) {
      for (const [phase, file] of Object.entries(files)) {
        backdropPromises.push(
          new THREE.TextureLoader()
            .loadAsync(asset(file))
            .then((texture) => {
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.anisotropy = 2;
              this.textures.set(`backdrop_${setting}_${phase}`, texture);
            })
            .catch(() => {})
            .finally(() => {
              done += 1;
              report(0.3 + (done / (entries.length + textureEntries.length + 9)) * 0.36, 'Painting the backdrop…');
            }),
        );
      }
    }
    await Promise.all([...propPromises, ...texturePromises, ...backdropPromises]);
    report(0.72, 'Growing the trees…');
    this.treeLib = await loadTreeLibrary(
      this.loader,
      Object.fromEntries(Object.entries(TREE_FILES)),
    );
    report(0.9, 'Laying out NJ and Tiraspol…');
    this.chips = new ChipBurst(this.scene, this.textures.get('chips') || null);
    this.createTargetMarker();
    this.createCharacterShadow();
    for (const setting of ['nj', 'tiraspol']) this.buildYard(setting);
    // The trees_v2 field renders merged instanced proxies until a tree is hit;
    // the first hit swaps in six LOD0 part meshes whose cap materials and
    // buffers have never been drawn. On SwiftShader that first draw blocked the
    // main thread long enough for a fall to still be in the air when the
    // operator's test looked at it. Draw every part material once here, off
    // screen, while the loading screen is still up.
    this.warmTreeMaterials();
    this.loaded = true;

    // Persisted selections, with defensive fallbacks for old saves.
    const savedSetting = this.game?.settings?.setting;
    const savedCostume = this.game?.settings?.costume;
    this.setting = savedSetting === 'tiraspol' ? 'tiraspol' : 'nj';
    this.costume = savedCostume === 'jacket' ? 'jacket' : 'tee';
    const savedAxe = GAME_AXE_TO_SKIN[this.game?.state?.axeId] || 'sergey';
    this.axeSkin = AXE_SKINS[savedAxe] ? savedAxe : 'sergey';
    await this.character.setCostume(this.costume);
    await this.character.setAxe(this.axeSkin);
    this.character.setQuality(this.quality);
    this.applySetting(this.setting);
    this.applyQuality(this.quality, { silent: true });
    this.prewarmTextures();
    this.attachEvents();
    this.enterYard({ instant: true, spawn: true });
    report(1, 'Sergey is ready.');
    return true;
  }

  /** Draw one off-screen mesh per LOD0 tree part so activation is stall-free. */
  warmTreeMaterials() {
    if (!this.renderer || !this.treeLib || !this.camera) return;
    const group = new THREE.Group();
    group.name = 'tree-material-warmup';
    group.position.set(0, -60, 0);
    const seen = new Set();
    for (const lib of Object.values(this.treeLib)) {
      for (const variant of lib?.variants || []) {
        if (!variant?.lod0) continue;
        for (const part of ['stump', 'stump_cap', 'log', 'log_cap', 'branches', 'leaves']) {
          const geometry = variant.lod0[part];
          const material = variant.lod0[`mat_${part}`];
          if (!geometry || !material || seen.has(material.uuid)) continue;
          seen.add(material.uuid);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.frustumCulled = false;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          group.add(mesh);
          if (this.renderer.initTexture) {
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
              if (!material[key]) continue;
              try {
                this.renderer.initTexture(material[key]);
              } catch {
                // A missing texture must not block startup.
              }
            }
          }
        }
      }
    }
    this.scene.add(group);
    try {
      this.renderer.compile(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
    } catch {
      // Material warm-up is best effort.
    }
    this.scene.remove(group);
  }

  /**
   * Upload every yard/prop/character texture while the loading screen is up.
   * A High switch reveals props that Low hid; without this, the first frames
   * after the switch spend hundreds of ms per texture upload and the operator's
   * short FPS window catches that stall instead of the steady state.
   */
  prewarmTextures() {
    if (!this.renderer?.initTexture) return;
    const seen = new Set();
    const use = (material) => {
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const item of list) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const texture = item?.[key];
          if (!texture || texture.isRenderTargetTexture || seen.has(texture)) continue;
          seen.add(texture);
          try {
            this.renderer.initTexture(texture);
          } catch {
            // A single upload failure must not break the loading screen.
          }
        }
      }
    };
    for (const yard of this.yards.values()) {
      yard.group.traverse((object) => {
        if (object.isMesh || object.isPoints) use(object.material);
      });
      if (yard.backdrop) use(yard.backdrop.material);
    }
    for (const costume of this.character?.costumes?.values() || []) {
      costume.wrapper.traverse((object) => {
        if (object.isMesh) use(object.material);
      });
    }
    for (const tool of this.character?.axes?.values() || []) {
      tool.scene.traverse((object) => {
        if (object.isMesh) use(object.material);
      });
    }
    use(this.chips?.points?.material);
  }

  createCharacterShadow() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 61);
    gradient.addColorStop(0, 'rgba(0,0,0,0.62)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.24)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.8), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.032;
    mesh.name = 'sergey-contact-shadow';
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.characterShadow = mesh;
  }

  attachEvents() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  _onKeyDown(event) {
    if (this.isInputBlocked()) return;
    const code = event.code;
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys.add('Shift');
    if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD') {
      this.keys.add(code);
    }
  }

  _onKeyUp(event) {
    const code = event.code;
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys.delete('Shift');
    if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD') {
      this.keys.delete(code);
    }
  }

  _onPointerMove(event) {
    if (this.mode !== 'yard' || !this.pointerLocked) return;
    this.cameraYaw -= (Number(event.movementX) || 0) * 0.0024;
    this.cameraPitch = clamp(
      this.cameraPitch + (Number(event.movementY) || 0) * 0.0018,
      -0.12,
      0.92,
    );
  }

  _onPointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.renderer?.domElement;
    this.ui.hint && (this.ui.hint.hidden = this.pointerLocked || this.mode !== 'yard');
  }

  /** Called by main for the first LMB press on the 3D canvas in yard mode. */
  onCanvasPointerDown(event) {
    if (this.mode !== 'yard') return false;
    if (!this.pointerLocked) {
      this.renderer?.domElement?.requestPointerLock?.();
      this.ui.hint && (this.ui.hint.hidden = true);
      return true;
    }
    if (event.button !== 0) return false;
    if (this.blockDistance < 2.2 && !this.target) {
      this.enterStump();
      return true;
    }
    this.swingAtTarget();
    return true;
  }

  createTargetMarker() {
    const group = new THREE.Group();
    group.name = 'yard-target-marker';
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffcf86,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.55, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const bandMat = new THREE.MeshBasicMaterial({
      color: 0xffe0a8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 16, 1, true), bandMat);
    group.add(band);
    group.visible = false;
    group.renderOrder = 4;
    this.scene.add(group);
    this.targetMarker = group;
    this.targetBand = band;
  }

  buildYard(setting) {
    const group = new THREE.Group();
    group.name = `yard-${setting}`;
    group.visible = false;
    this.scene.add(group);
    const yard = {
      setting,
      group,
      props: [],
      colliders: [],
      backdrop: null,
      field: null,
      treeSeed: setting === 'nj' ? 517 : 991,
      label: SETTING_LABELS[setting],
    };
    this.yards.set(setting, yard);
    this.addBackdrop(setting, yard);
    if (setting === 'nj') this.buildNJ(yard);
    else this.buildTiraspol(yard);
    this.buildTrees(setting, yard);
    this.addDistantTreeLine(yard, setting);
    this.createTreeShadows(yard);
    return yard;
  }

  /**
   * A single-draw-call horizon treeline. The supplied backdrop art is a
   * close-up photo, so blurring it leaves a flat beige band; 50-70 simple
   * silhouettes at 38-68 m give the eye a real scale cue without competing
   * with the 3D trees inside the fence. Basic vertex-coloured geometry is
   * deliberately unlit: at this distance it is atmosphere, not detail.
   */
  addDistantTreeLine(yard, setting) {
    const random = mulberry32(setting === 'nj' ? 741 : 883);
    const geometries = [];
    // Pull the palette toward golden-hour haze: these are silhouettes in the
    // distance, not another layer of saturated foliage.
    const palette = setting === 'nj'
      ? [new THREE.Color(0x626b55), new THREE.Color(0x7c8066), new THREE.Color(0x9a9780)]
      : [new THREE.Color(0x676b52), new THREE.Color(0x817f63), new THREE.Color(0x9d967c)];
    const paint = (geometry, base, top) => {
      const count = geometry.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        const y = geometry.attributes.position.getY(i);
        const t = Math.min(1, Math.max(0, y / Math.max(0.1, top)));
        const color = base.clone().lerp(palette[2], 0.25 + t * 0.55);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geometry;
    };
    for (let i = 0; i < 68; i += 1) {
      const angle = (i / 68) * Math.PI * 2 + (random() - 0.5) * 0.12;
      const radius = 52 + random() * 36;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius - 4;
      if (Math.abs(x) < 11 && z > -10 && z < 9) continue;
      // Leave the cathedral corridor open. The white walls and gold domes are
      // the Tiraspol skyline anchor and must not be hidden by a treeline.
      if (setting === 'tiraspol' && Math.abs(x - 2) < 14 && z < -18) continue;
      const height = 5 + random() * 8;
      const base = palette[0].clone().offsetHSL(0, 0, (random() - 0.5) * 0.06);
      const conifer = setting === 'tiraspol' ? random() > 0.45 : random() > 0.28;
      const push = (geometry) => {
        // Cone/Cylinder geometries are indexed; IcosahedronGeometry is not.
        // Merge only position + colour, so strip the incompatible extras and
        // let the flat-colour treeline material ignore normals/UVs.
        const flat = geometry.index ? geometry.toNonIndexed() : geometry;
        if (flat !== geometry) geometry.dispose();
        flat.deleteAttribute('normal');
        flat.deleteAttribute('uv');
        geometries.push(flat);
      };
      if (conifer) {
        const crown = new THREE.ConeGeometry(height * (0.18 + random() * 0.07), height, 7, 1);
        crown.translate(0, height * 0.5, 0);
        paint(crown, base, height);
        crown.translate(x, 0, z);
        push(crown);
      } else {
        const trunkH = height * 0.36;
        const trunk = new THREE.CylinderGeometry(height * 0.035, height * 0.05, trunkH, 5, 1);
        trunk.translate(0, trunkH * 0.5, 0);
        paint(trunk, base.clone().multiplyScalar(0.72), trunkH);
        trunk.translate(x, 0, z);
        push(trunk);
        const crown = new THREE.IcosahedronGeometry(height * 0.27, 0);
        crown.scale(1, 0.9 + random() * 0.35, 1);
        crown.translate(0, trunkH + height * 0.2, 0);
        paint(crown, base, height);
        crown.translate(x, 0, z);
        push(crown);
      }
    }
    if (!geometries.length) return;
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) return;
    merged.computeBoundingSphere();
    merged.computeVertexNormals();
    // Basic vertex-colour silhouettes; `updateBackdrop()` multiplies the
    // material colour by the time-of-day tint so they go dark at night instead
    // of glowing like a daytime sticker.
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: false,
      toneMapped: true,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `distant-treeline-${setting}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = -12;
    mesh.userData.distant = true;
    yard.group.add(mesh);
    yard.treeline = mesh;
  }

  /** One instanced draw call of soft radial shadows under the rendered trees. */
  createTreeShadows(yard) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.22)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geometry, material, yard.field?.trees?.length || 42);
    mesh.name = `tree-shadows-${yard.setting}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    yard.group.add(mesh);
    yard.treeShadows = mesh;
    this.updateTreeShadows(yard);
  }

  updateTreeShadows(yard) {
    const mesh = yard.treeShadows;
    const field = yard.field;
    if (!mesh || !field) return;
    const dummy = this._shadowDummy || (this._shadowDummy = new THREE.Object3D());
    let index = 0;
    for (const tree of field.trees) {
      if (tree.qualityHidden || tree.state === 'gone') continue;
      const size = Math.max(1.5, (tree.meta?.crownRadius || 1.5) * tree.scale * 1.5);
      dummy.position.set(tree.position.x, 0.018, tree.position.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(size, 1, size);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      index += 1;
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * The supplied backdrop art is a close-up photograph of the same yard, not a
   * panorama. Used at face value a 2:1 plane puts a second shed/cathedral right
   * behind the 3D one, which reads as a photo collage. Derive a soft far card:
   * crop the sky/tree band, blur it hard, fade the bottom into the fog, and
   * place it well beyond the 3D landmarks. It keeps the art's colour and depth
   * without competing with the actual shed, fence and cathedral.
   */
  deriveBackdrop(phase, setting) {
    const source = this.textures.get(`backdrop_${setting}_${phase}`);
    const image = source?.image;
    if (!image || typeof document === 'undefined') return source || null;
    const width = 1024;
    const height = 256;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    // Transparent at the top so the live sky shader and its time-of-day
    // gradient remain visible; opaque at the horizon so the card still gives
    // the fence a believable distant tree line.
    ctx.clearRect(0, 0, width, height);
    const cropHeight = image.height * (setting === 'tiraspol' ? 0.46 : 0.54);
    ctx.save();
    ctx.filter = 'blur(13px) saturate(0.82) brightness(0.98)';
    ctx.globalAlpha = setting === 'tiraspol' ? 0.8 : 0.9;
    ctx.drawImage(image, 0, 0, image.width, cropHeight, -24, -24, width + 48, height + 40);
    ctx.restore();
    // Alpha mask: the sky shows through the top third, the tree/roof band is
    // solid from the middle down, and the bottom fades into the fog.
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createLinearGradient(0, 0, 0, height);
    mask.addColorStop(0, 'rgba(0, 0, 0, 0)');
    mask.addColorStop(0.3, 'rgba(0, 0, 0, 0.08)');
    mask.addColorStop(0.56, 'rgba(0, 0, 0, 0.82)');
    mask.addColorStop(0.78, 'rgba(0, 0, 0, 1)');
    mask.addColorStop(1, 'rgba(0, 0, 0, 0.82)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.userData.derived = true;
    return texture;
  }

  addBackdrop(setting, yard) {
    const phaseKey = ['wide', 'dusk', 'night'].find((phase) => this.textures.has(`backdrop_${setting}_${phase}`));
    if (!phaseKey) return;
    const texture = this.deriveBackdrop(phaseKey, setting) || this.textures.get(`backdrop_${setting}_${phaseKey}`);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(360, 84), material);
    mesh.name = `backdrop-${setting}`;
    mesh.position.set(0, 22, setting === 'nj' ? -155 : -175);
    mesh.renderOrder = -20;
    yard.group.add(mesh);
    yard.backdrop = mesh;
    // A distant ground skirt keeps the cathedral and khrushchevka from
    // floating over nothing once the fog thins them out.
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshBasicMaterial({ color: setting === 'nj' ? 0x39462d : 0x54583a, fog: true }),
    );
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -0.06;
    skirt.receiveShadow = false;
    yard.group.add(skirt);
    yard.skirt = skirt;
  }

  measureAsset(key) {
    const gltf = this.propAssets.get(key);
    if (!gltf) return null;
    return boxOf(gltf.scene);
  }

  addProp(yard, key, {
    x = 0,
    z = 0,
    y = 0,
    rotY = 0,
    height = null,
    targetHeight = null,
    essential = true,
    collider = 0,
    fog = true,
    name = null,
  } = {}) {
    const gltf = this.propAssets.get(key);
    if (!gltf) return null;
    const clone = gltf.scene.clone(true);
    const box = boxOf(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const wanted = height ?? targetHeight;
    let scale = 1;
    if (wanted && size.y > 1e-5) scale = wanted / size.y;
    const center = new THREE.Vector3();
    box.getCenter(center);
    clone.scale.setScalar(scale);
    clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    const wrapper = new THREE.Group();
    wrapper.name = name || `prop-${key}`;
    wrapper.position.set(x, y, z);
    wrapper.rotation.y = rotY;
    wrapper.add(clone);
    wrapper.userData.essential = essential;
    wrapper.userData.asset = key;
    if (!fog) {
      clone.traverse((object) => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material) material.fog = false;
        }
      });
    }
    clone.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    yard.group.add(wrapper);
    yard.props.push(wrapper);
    if (collider > 0) {
      yard.colliders.push({
        x,
        z,
        r: collider,
        // Remember the prop's height so the third-person camera can pass over
        // low benches/mangals instead of collapsing into a close-up.
        height: wanted || 2.5,
        prop: wrapper,
      });
    }
    return wrapper;
  }

  addFenceRun(yard, key, {
    x = 0,
    z = 0,
    length = 18,
    rotY = 0,
    height = 1.2,
    essential = true,
    segments = 0,
    lowEssential = 1,
  } = {}) {
    const box = this.measureAsset(key);
    if (!box) return;
    const sourceSize = new THREE.Vector3();
    box.getSize(sourceSize);
    const scale = height / Math.max(0.01, sourceSize.y);
    const segmentLength = Math.max(0.4, sourceSize.x * scale) * 0.995;
    const count = segments || Math.max(1, Math.round(length / segmentLength));
    const dir = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
    const lowCount = Math.min(count, Math.max(0, Math.floor(lowEssential)));
    const lowStart = Math.max(0, Math.floor((count - lowCount) / 2));
    for (let i = 0; i < count; i += 1) {
      const t = (i - (count - 1) / 2) * segmentLength;
      this.addProp(yard, key, {
        x: x + dir.x * t,
        z: z + dir.z * t,
        rotY,
        height,
        // Low keeps a contiguous window of the run (usually the middle two
        // panels) so the yard still reads as fenced without paying for every
        // segment. Medium/High restore the full run through applyQuality().
        essential: essential && i >= lowStart && i < lowStart + lowCount,
        name: `fence-${key}-${i}`,
      });
    }
  }

  buildNJ(yard) {
    // The reference photo is a sage shed with a mulch chopping zone beside it.
    // Keep that relationship legible from the spawn: shed on the left third,
    // stump in the middle, woodpiles and a wheelbarrow framing the work area.
    this.addProp(yard, 'shed_nj', { x: -3.55, z: -4.05, height: 2.55, rotY: 0.22, collider: 2.2, essential: true });
    this.addProp(yard, 'siding_wall', { x: -10.5, z: 1.2, height: 2.7, rotY: Math.PI / 2, essential: true });
    this.addProp(yard, 'house_wall', { x: -10.5, z: -2.4, height: 2.7, rotY: Math.PI / 2, essential: false });
    this.addProp(yard, 'chopping_stump_nj', { x: BLOCK.x, z: BLOCK.z, height: 0.48, essential: true, name: 'chopping-stump' });
    this.addProp(yard, 'firewood_heap_nj', { x: -1.5, z: -4.4, height: 0.72, rotY: 0.45, collider: 0.9, essential: true });
    this.addProp(yard, 'tarp_woodpile', { x: -6.2, z: -3.8, height: 1.1, rotY: 0.25, collider: 1.0, essential: true });
    this.addProp(yard, 'firewood_pile', { x: 1.15, z: -3.85, height: 0.62, rotY: 0.2, collider: 0.8, essential: false });
    this.addProp(yard, 'arborvitae', { x: -7.95, z: -6.6, height: 3.0, collider: 0.55, essential: true });
    this.addProp(yard, 'arborvitae', { x: -5.55, z: -6.7, height: 2.8, rotY: 1.2, collider: 0.5, essential: false });
    this.addProp(yard, 'arborvitae', { x: 7.0, z: -6.6, height: 3.1, rotY: 2.1, collider: 0.55, essential: false });
    this.addProp(yard, 'fence_splitrail', { x: 8.95, z: -1.7, height: 1.2, rotY: Math.PI / 2, essential: true });
    this.addProp(yard, 'fence_splitrail', { x: 8.95, z: 3.0, height: 1.2, rotY: Math.PI / 2, essential: true });
    this.addFenceRun(yard, 'fence_privacy', { x: 0, z: -7.15, length: 18, rotY: 0, height: 1.8, essential: true, segments: 4, lowEssential: 4 });
    this.addFenceRun(yard, 'fence_splitrail', { x: -8.95, z: 1.0, length: 12, rotY: Math.PI / 2, height: 1.2, essential: true, segments: 4, lowEssential: 2 });
    this.addProp(yard, 'patio_set', { x: 6.3, z: -2.7, height: 2.4, rotY: -0.4, collider: 1.5, essential: true });
    this.addProp(yard, 'grill_gas', { x: 7.25, z: -1.45, height: 1.1, rotY: -0.2, collider: 0.6, essential: false });
    this.addProp(yard, 'swing_set', { x: 6.4, z: 3.3, height: 2.2, rotY: Math.PI / 2, collider: 1.4, essential: false });
    this.addProp(yard, 'recycling_bin', { x: 6.15, z: 5.05, height: 1.1, collider: 0.5, essential: true });
    this.addProp(yard, 'wheelbarrow', { x: -3.3, z: -0.35, height: 0.7, rotY: 1.05, collider: 0.55, essential: true });
    this.addProp(yard, 'split_log_halves', { x: 1.55, z: -1.9, height: 0.4, rotY: 0.6, essential: true });
    this.addProp(yard, 'chips_scatter', { x: BLOCK.x + 0.1, z: BLOCK.z + 0.1, y: 0.012, height: null, essential: true });
    this.addMulchDecal(yard);
    yard.spawn = new THREE.Vector3(2.7, 0, 3.5);
  }

  buildTiraspol(yard) {
    // Plank fence, hung tools/horseshoe, mangal, grapevine wall, well, bench,
    // Lada and the cathedral skyline. Keep the sightline from spawn to the
    // white domes clear; the runtime is asked to avoid that corridor below.
    this.addProp(yard, 'house_wall_grapevine', { x: -6.55, z: -5.45, height: 3.15, rotY: 0.18, collider: 2.2, essential: true });
    this.addProp(yard, 'chopping_stump_nj', { x: BLOCK.x, z: BLOCK.z, height: 0.48, essential: true, name: 'chopping-stump' });
    this.addProp(yard, 'mangal', { x: 4.45, z: -3.5, height: 1.0, rotY: -0.3, collider: 0.7, essential: true });
    this.addProp(yard, 'bench', { x: -4.1, z: 2.05, height: 0.85, rotY: 0.32, collider: 1.0, essential: true });
    this.addProp(yard, 'well', { x: -4.7, z: -0.85, height: 2.2, collider: 0.8, essential: true });
    this.addProp(yard, 'lada_car', { x: 5.5, z: 2.05, height: 1.45, rotY: 1.28, collider: 1.5, essential: true });
    this.addProp(yard, 'tomato_garden', { x: -6.7, z: -2.15, height: 1.6, rotY: 0.15, collider: 1.3, essential: false });
    this.addProp(yard, 'wheelbarrow', { x: 3.3, z: -5.0, height: 0.7, rotY: 0.4, collider: 0.55, essential: true });
    this.addProp(yard, 'split_log_halves', { x: -2.15, z: -2.8, height: 0.4, rotY: 0.2, essential: true });
    this.addProp(yard, 'chips_scatter', { x: BLOCK.x + 0.1, z: BLOCK.z + 0.1, y: 0.012, essential: true });
    this.addFenceRun(yard, 'fence_planks', { x: 0, z: -7.1, length: 18, rotY: 0, height: 1.5, essential: true, segments: 4, lowEssential: 4 });
    this.addFenceRun(yard, 'fence_planks', { x: -8.95, z: 1.0, length: 12, rotY: Math.PI / 2, height: 1.5, essential: true, segments: 4, lowEssential: 1 });
    this.addFenceRun(yard, 'fence_planks', { x: 8.95, z: 1.0, length: 12, rotY: Math.PI / 2, height: 1.5, essential: true, segments: 4, lowEssential: 1 });
    this.addProp(yard, 'iron_tools_horseshoe', {
      x: -4.2,
      z: -6.82,
      y: 0.44,
      height: 1.18,
      essential: true,
      name: 'fence-tools',
    });
    this.addProp(yard, 'khrushchevka', {
      x: -30,
      z: -58,
      height: 15,
      rotY: 0.18,
      essential: true,
      fog: false,
      name: 'khrushchevka',
    });
    this.addProp(yard, 'cathedral', {
      // 86 m out: the white walls and gold domes sit below the top HUD and
      // read as the skyline anchor from the default spawn without dwarfing
      // the 1.78 m character.
      x: 0,
      z: -86,
      height: 21,
      rotY: 0.08,
      essential: true,
      fog: false,
      name: 'cathedral',
    });
    yard.spawn = new THREE.Vector3(2.7, 0, 3.5);
  }

  /** Tile the supplied mulch photo into a soft-edged chopping-zone bed. */
  makeMulchBedTexture(source) {
    const image = source?.image;
    if (!image || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    for (let y = 0; y < 384; y += 192) {
      for (let x = 0; x < 512; x += 192) {
        ctx.drawImage(image, x, y, 192, 192);
      }
    }
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(256, 192, 90, 256, 192, 250);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(0.72, 'rgba(0,0,0,0.96)');
    mask.addColorStop(0.9, 'rgba(0,0,0,0.55)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, 512, 384);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  addMulchDecal(yard) {
    const texture = this.textures.get('mulch');
    if (!texture) return;
    const bedTexture = this.yardBedTexture || (this.yardBedTexture = this.makeMulchBedTexture(texture));
    if (bedTexture) {
      const bed = new THREE.Mesh(
        new THREE.PlaneGeometry(6.6, 4.9),
        new THREE.MeshBasicMaterial({
          map: bedTexture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          opacity: 0.96,
        }),
      );
      bed.rotation.x = -Math.PI / 2;
      bed.rotation.z = 0.06;
      bed.position.set(-1.15, 0.017, -2.35);
      bed.renderOrder = 0;
      bed.name = `mulch-bed-${yard.setting}`;
      yard.group.add(bed);
      yard.mulchBed = bed;
    }
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.98,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = 0.35;
    mesh.position.set(BLOCK.x, 0.021, BLOCK.z + 0.05);
    mesh.renderOrder = 1;
    mesh.name = `mulch-${yard.setting}`;
    yard.group.add(mesh);
    yard.mulch = mesh;
  }

  buildTrees(setting, yard) {
    this.removeField(yard);
    const field = new TreeField(this.scene, this.treeLib, {
      lod1Distance: this.settings.lod1,
      lod2Distance: this.settings.lod2,
      castShadow: this.settings.castShadow,
    });
    field.group.visible = false;
    // TreeField adds itself to the scene; re-parent it under the yard group.
    this.scene.remove(field.group);
    yard.group.add(field.group);
    const random = mulberry32(yard.treeSeed);
    const species = SETTING_SPECIES[setting];
    const placed = [];
    const reserved = [
      { x: BLOCK.x, z: BLOCK.z, r: 2.7 },
      { x: 2.7, z: 3.5, r: 3.0 },
      { x: -3.55, z: -4.05, r: 2.6 },
      { x: -4.7, z: -0.85, r: 1.2 },
      { x: -4.1, z: 2.05, r: 1.2 },
      { x: 5.5, z: 2.05, r: 2.2 },
      { x: 6.3, z: -2.7, r: 2.5 },
      { x: 4.45, z: -3.5, r: 1.4 },
      { x: -6.55, z: -5.45, r: 2.1 },
      { x: -6.7, z: -2.15, r: 1.3 },
      { x: 6.15, z: 5.05, r: 1.0 },
      { x: 3.3, z: -5.0, r: 1.0 },
      { x: 1.15, z: -3.85, r: 1.1 },
      { x: -3.3, z: -0.35, r: 1.0 },
      { x: 1.55, z: -1.9, r: 1.0 },
    ];
    const inside = {
      nj: [
        [-7.0, 4.7], [6.9, -5.25], [-7.4, 1.2], [7.3, 0.0], [-1.9, 5.6],
        [4.6, 5.4], [2.2, -6.2], [-7.6, 3.8], [6.8, 2.4], [-5.8, 5.75],
        [-4.3, -6.3], [0.4, 5.7],
      ],
      tiraspol: [
        [-7.2, 5.0], [7.6, 1.4], [-2.0, 5.5], [5.0, 5.4], [2.3, -6.3],
        [7.4, -5.8], [-7.7, -0.4], [-3.9, -6.4], [6.9, 3.1], [-6.6, 3.9],
        [-0.6, 5.8], [5.7, -6.0],
      ],
    }[setting];
    const tryPlace = (x, z, list) => {
      for (const spot of reserved) {
        if (Math.hypot(x - spot.x, z - spot.z) < spot.r) return false;
      }
      // Keep a clear sightline from the yard spawn to the Tiraspol cathedral.
      // Without this corridor the inner ring can put a walnut canopy exactly in
      // front of the white domes at the default camera angle.
      if (setting === 'tiraspol') {
        const ax = 2.7;
        const az = 3.5;
        const bx = 0;
        const bz = -88;
        const vx = bx - ax;
        const vz = bz - az;
        const t = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
        if (t > 0.02 && t < 1) {
          const px = ax + vx * t;
          const pz = az + vz * t;
          if (Math.hypot(x - px, z - pz) < 13.0) return false;
        }
      }
      for (const other of placed) {
        if (Math.hypot(x - other.position.x, z - other.position.z) < 2.0) return false;
      }
      const sp = species[Math.floor(random() * species.length)];
      const variant = Math.floor(random() * 3);
      const scale = 0.9 + random() * 0.2;
      const tree = field.place(sp, variant, x, z, {
        rotY: random() * Math.PI * 2,
        scale,
      });
      // Low quality renders a subset of the 42 trees. Rank that subset by
      // relevance to the player, not by insertion order: otherwise the yard
      // can show a tree 30 m away while hiding a near one behind the fence.
      const insideYard = Math.abs(x) < 8.5 && z > -6.55 && z < 5.95;
      tree._yardPriority =
        Math.hypot(x - 2.7, z - 3.5) + (insideYard ? 0 : 9) + random() * 0.45;
      placed.push(tree);
      return true;
    };
    for (const [x, z] of inside) tryPlace(x, z);
    // A ring beyond the fence, with extra depth behind the far backdrop side.
    let tries = 0;
    const targetCount = 42;
    while (placed.length < targetCount && tries < 900) {
      tries += 1;
      const angle = random() * Math.PI * 2;
      const radius = 12 + random() * 16;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius - 2.0;
      if (Math.abs(x) < 10.2 && z > -8.4 && z < 7.2) continue;
      tryPlace(x, z);
    }
    yard.trees = placed;
    yard.field = field;
    this.fields.set(setting, field);
    return field;
  }

  removeField(yard) {
    if (!yard.field) return;
    this.scene.remove(yard.field.group);
    yard.group.remove(yard.field.group);
    yard.activeTrees = null;
    // Do not dispose the shared tree library materials/geometries.
    yard.field.group.clear();
    yard.field = null;
    this.fields.delete(yard.setting);
  }

  applySetting(setting, { silent = false } = {}) {
    this.aftermath = null;
    const next = setting === 'tiraspol' ? 'tiraspol' : 'nj';
    this.setting = next;
    this.bounds = { minX: -8.5, maxX: 8.5, minZ: -6.55, maxZ: 5.95 };
    for (const [id, yard] of this.yards) {
      const active = id === next;
      yard.group.visible = active;
      if (yard.field) {
        yard.field.group.visible = active;
        if (active) yard.field._dirty = true;
      }
    }
    this.activeYard = this.yards.get(next);
    this.game?.setSetting('setting', next);
    this.updateBackdrop(true);
    this.updateUi();
    if (!silent) {
      this.onToast?.(`Setting: ${SETTING_LABELS[next]}`, 'gold');
    }
    this.sound?.click?.();
    return next;
  }

  setSetting(setting) {
    const wasStump = this.mode === 'stump';
    this.applySetting(setting);
    // The two yards have different prop layouts, so return to a safe spawn
    // rather than leaving Sergey inside a Tiraspol well or an NJ shed. A
    // setting switch from the block also returns to the yard: the new yard is
    // the thing the player asked to see, and the block is one E press away.
    this.velocity.set(0, 0, 0);
    this.player.set(2.7, 0, 3.5);
    this.playerYaw = 0.5;
    this.cameraYaw = 0.36;
    this.cameraPitch = -0.04;
    this.character?.setWorldTransform(this.player, this.playerYaw, Math.PI);
    if (wasStump || this.mode === 'yard') {
      this.enterYard({ instant: true, spawn: true });
    }
    return Promise.resolve(this.setting);
  }

  /** The yard uses a wider lens than the old block close-up. */
  setCameraFov(fov) {
    if (!this.camera || this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setCostume(costume) {
    const next = costume === 'jacket' ? 'jacket' : 'tee';
    this.costume = next;
    this.game?.setSetting('costume', next);
    return this.character.setCostume(next).then(() => {
      this.character.setQuality(this.quality);
      this.onToast?.(`Costume: ${next === 'jacket' ? 'Blue jacket' : 'Black tee'}`, 'gold');
      return next;
    });
  }

  setAxe(id) {
    const skin = AXE_SKINS[id] ? id : 'sergey';
    this.axeSkin = skin;
    const gameId = AXE_SKINS[skin].gameId;
    if (this.game) {
      this.game.state.axeId = gameId;
      if (!this.game.state.ownedAxes.includes(gameId)) this.game.state.ownedAxes.push(gameId);
      this.game.save();
    }
    return this.character.setAxe(skin).then(() => {
      this.character.setQuality(this.quality);
      this.updateUi();
      return skin;
    });
  }

  /** Mirror a shop equip without feeding the shop event back into itself. */
  syncAxeFromGame() {
    const skin = GAME_AXE_TO_SKIN[this.game?.state?.axeId] || 'sergey';
    this.axeSkin = AXE_SKINS[skin] ? skin : 'sergey';
    return this.character?.setAxe(this.axeSkin);
  }

  applyQuality(name, { silent = false } = {}) {
    const next = ['low', 'medium', 'high', 'ultra'].includes(name) ? name : 'low';
    this.quality = next;
    this.settings = qualitySettings(next);
    this.character?.setQuality(next);
    for (const yard of this.yards.values()) {
      if (yard.field) {
        yard.field.lod1D = this.settings.lod1;
        yard.field.lod2D = this.settings.lod2;
        yard.field.castShadow = this.settings.castShadow;
        yard.field._dirty = true;
        yard.field.group.traverse((object) => {
          if (object.isInstancedMesh) object.castShadow = this.settings.castShadow;
        });
      }
      // The first N trees are the low-detail budget; the rest are hidden on a
      // low preset and restored when quality rises again. Felled trees keep
      // their state so a quality change never regrows a stump.
      const budget = this.settings.trees;
      if (yard.field) {
        const ranked = yard.field.trees
          .slice()
          .sort((a, b) => (a._yardPriority ?? 0) - (b._yardPriority ?? 0));
        ranked.forEach((tree, index) => {
          if (index >= budget) {
            if (!tree.qualityHidden && tree.state === 'standing') {
              tree.qualityHidden = true;
              tree.state = 'gone';
              yard.field._dirty = true;
            }
          } else if (tree.qualityHidden) {
            tree.qualityHidden = false;
            if (tree.state === 'gone') tree.state = 'standing';
            yard.field._dirty = true;
          }
        });
      }
      for (const prop of yard.props) {
        const show = this.settings.propDetail >= 0.75 || prop.userData.essential;
        prop.visible = show;
      }
    }
    for (const yard of this.yards.values()) this.updateTreeShadows(yard);
    if (!silent) this.updateUi();
  }

  enterYard({ instant = false, spawn = false } = {}) {
    this.aftermath = null;
    const wasStump = this.mode === 'stump';
    this.mode = 'yard';
    document.body.classList.add('mode-yard');
    document.body.classList.remove('mode-stump');
    this.setCameraFov(48);
    if (this.controls) this.controls.enabled = false;
    if (wasStump || spawn) {
      this.player.set(2.7, 0, 3.5);
      // Frame the chopping block on the left and the Tiraspol cathedral on the
      // right. The player still faces the block; only the camera is offset.
      this.playerYaw = 0.5;
      this.cameraYaw = 0.36;
      this.cameraPitch = -0.04;
    }
    this.character?.setStance(false);
    this.character?.setLocomotion('idle');
    this.character?.setPosition(this.player);
    this.snapCamera();
    if (instant) this.snapCamera();
    this.ui.hud && (this.ui.hud.hidden = false);
    this.ui.crosshair && (this.ui.crosshair.hidden = false);
    this.ui.hint && (this.ui.hint.hidden = this.pointerLocked);
    this.onYardEnter?.();
    this.updateUi();
    return Promise.resolve(true);
  }

  enterStump() {
    this.aftermath = null;
    this.mode = 'stump';
    document.body.classList.add('mode-stump');
    document.body.classList.remove('mode-yard');
    this.setCameraFov(40);
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.player.set(this.stumpPose.x, 0, this.stumpPose.z);
    this.playerYaw = 0;
    this.velocity.set(0, 0, 0);
    this.character?.setPosition(this.player);
    this.character?.setStance(true);
    this.character?.setWorldTransform(this.player, 0, Math.PI);
    this.character?.setLocomotion('idle');
    if (this.controls) this.controls.enabled = true;
    this.target = null;
    if (this.targetMarker) this.targetMarker.visible = false;
    this.ui.hud && (this.ui.hud.hidden = true);
    this.ui.prompt && (this.ui.prompt.hidden = true);
    this.ui.blockPrompt && (this.ui.blockPrompt.hidden = true);
    this.ui.crosshair && (this.ui.crosshair.hidden = true);
    this.ui.hint && (this.ui.hint.hidden = true);
    this.onStumpEnter?.();
    this.onToast?.('At the chopping block — swing with LMB / Space, E or Esc returns to the yard.', 'gold');
    return Promise.resolve(true);
  }

  toggleStump() {
    if (this.mode === 'stump') return this.enterYard();
    const distance = Math.hypot(this.player.x - BLOCK.x, this.player.z - BLOCK.z);
    if (distance < 2.2) return this.enterStump();
    this.onToast?.('Walk up to the chopping stump, then press E.', '');
    return Promise.resolve(false);
  }

  /** Called by the original simulation when the player starts a block swing. */
  onStumpSwing(impactDelay = 0.62) {
    if (this.mode !== 'stump') return;
    this.character?.playSwing('stump', impactDelay);
  }

  /** A new log has been loaded at the block; settle back into the stance. */
  onStumpLogLoaded() {
    if (this.mode !== 'stump') return;
    this.character?.setStance(true);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
  }

  faceTree(tree) {
    const dx = tree.position.x - this.player.x;
    const dz = tree.position.z - this.player.z;
    const yaw = Math.atan2(-dx, -dz);
    this.playerYaw = yaw;
    // A small camera lead to the side keeps the trunk visible next to Sergey
    // instead of hiding it exactly behind his back. The 0.12 rad offset is
    // well inside TreeField.pick's 0.32 cone, so the swing still connects.
    this.cameraYaw = yaw + 0.12;
    this.cameraPitch = 0.05;
    this.character?.setWorldTransform(this.player, this.playerYaw, Math.PI);
    this.snapCamera();
  }

  updateMovement(dt) {
    if (this.isInputBlocked()) return;
    if (this.keys.has('KeyW') || this.keys.has('KeyA') || this.keys.has('KeyS') || this.keys.has('KeyD')) {
      this.aftermath = null;
    }
    const forward = this.forward();
    const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    const moving = move.lengthSq() > 0.00001;
    const running = moving && this.keys.has('Shift');
    // Walk_Arm/Run_Arm are short in-place cycles with a ~0.25 m foot travel.
    // The old 2.35/5.1 m/s made the feet skate across the yard; 1.25/2.6 with
    // a slightly quickened cycle keeps the step plant much closer to the
    // authored stride while still crossing the 17 m yard in a few seconds.
    // Keep the yard traversal deliberate: at 1.05/2.25 m/s the Walk_Arm /
    // Run_Arm cycles above can run near their authored stride instead of
    // skating. The 2.5 s operator walk still covers ~2.6 m.
    const speed = running ? 2.25 : 1.05;
    const targetVelocity = moving ? move.normalize().multiplyScalar(speed) : new THREE.Vector3();
    const blend = 1 - Math.exp(-11 * dt);
    this.velocity.lerp(targetVelocity, blend);
    if (this.velocity.lengthSq() < 0.00002) this.velocity.set(0, 0, 0);
    const before = this.player.clone();
    this.player.addScaledVector(this.velocity, dt);
    this.fieldCollide();
    this.propCollide();
    this.player.x = clamp(this.player.x, this.bounds.minX, this.bounds.maxX);
    this.player.z = clamp(this.player.z, this.bounds.minZ, this.bounds.maxZ);
    this.player.y = 0;
    const travelled = before.distanceTo(this.player);
    if (moving) {
      const targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
      let delta = targetYaw - this.playerYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.playerYaw += delta * Math.min(1, dt * 10);
    }
    const actualSpeed = travelled / Math.max(0.001, dt);
    // The old 4.0 m/s run threshold was left over from the 5.1 m/s sprint;
    // with the matched 1.25/2.6 m/s cadence Shift never produced Run_Arm.
    this.character?.setLocomotion(actualSpeed > 1.7 ? 'run' : actualSpeed > 0.18 ? 'walk' : 'idle');
    this.character?.setWorldTransform(this.player, this.playerYaw, Math.PI);
    if (actualSpeed > 0.4) {
      this.footDistance += travelled;
      const step = running ? 0.55 : 0.44;
      if (this.footDistance > step) {
        this.footDistance = 0;
        this.stepIndex += 1;
        this.sound?.footstep?.(this.surfaceAt(this.player), running ? 1 : 0.65);
      }
    }
  }

  surfaceAt(point) {
    if (this.setting === 'nj') {
      if (Math.hypot(point.x - BLOCK.x, point.z - BLOCK.z) < 2.3) return 'mulch';
      if (point.x < -3.0 && point.z < -3.6) return 'mulch';
      return 'grass';
    }
    if (point.z < -3.0 || point.x < -4.5) return 'dirt';
    return 'grass';
  }

  fieldCollide() {
    if (this.activeYard?.field) this.activeYard.field.collide(this.player, 0.34);
  }

  propCollide() {
    const colliders = this.activeYard?.colliders || [];
    for (const collider of colliders) {
      if (collider.prop && !collider.prop.visible) continue;
      const dx = this.player.x - collider.x;
      const dz = this.player.z - collider.z;
      const r = collider.r + 0.34;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      this.player.x += dx * push;
      this.player.z += dz * push;
    }
    const blockR = 0.56;
    const bx = this.player.x - BLOCK.x;
    const bz = this.player.z - BLOCK.z;
    const bd2 = bx * bx + bz * bz;
    if (bd2 < blockR * blockR && bd2 > 1e-8) {
      const d = Math.sqrt(bd2);
      const push = (blockR - d) / d;
      this.player.x += bx * push;
      this.player.z += bz * push;
    }
  }

  nearestTree({ standingOnly = true } = {}) {
    const field = this.activeYard?.field;
    if (!field) return null;
    let best = null;
    for (const tree of field.trees) {
      if (tree.qualityHidden || tree.state === 'gone') continue;
      if (standingOnly && tree.state !== 'standing' && tree.state !== 'chopping') continue;
      const distance = Math.hypot(tree.position.x - this.player.x, tree.position.z - this.player.z);
      if (!best || distance < best.distance) best = { tree, distance };
    }
    return best;
  }

  nearestTreeState() {
    const best = this.nearestTree();
    if (!best) return null;
    const { tree, distance } = best;
    return {
      id: tree.id,
      x: Number(tree.position.x.toFixed(3)),
      z: Number(tree.position.z.toFixed(3)),
      radius: Number(tree.radius.toFixed(3)),
      distance: Number(distance.toFixed(3)),
      species: tree.species,
      state: tree.state,
    };
  }

  teleportNearTree(preferred = null) {
    this.aftermath = null;
    if (this.mode !== 'yard') this.enterYard({ instant: true });
    const field = this.activeYard?.field;
    if (!field) return null;
    let tree = preferred;
    if (!tree) {
      let best = null;
      let fallback = null;
      const approachClear = (candidate) => {
        const dx = this.player.x - candidate.position.x;
        const dz = this.player.z - candidate.position.z;
        const len = Math.max(0.001, Math.hypot(dx, dz));
        const approach = (candidate.meta?.approachDistance || 1.15) * candidate.scale;
        const ax = candidate.position.x + (dx / len) * approach;
        const az = candidate.position.z + (dz / len) * approach;
        if (
          ax < this.bounds.minX + 0.45 || ax > this.bounds.maxX - 0.45 ||
          az < this.bounds.minZ + 0.45 || az > this.bounds.maxZ - 0.45
        ) return false;
        for (const collider of this.activeYard?.colliders || []) {
          if (collider.prop && !collider.prop.visible) continue;
          if (Math.hypot(ax - collider.x, az - collider.z) < collider.r + 0.5) return false;
        }
        for (const other of field.trees) {
          if (other === candidate || other.qualityHidden || other.state === 'gone') continue;
          if (Math.hypot(ax - other.position.x, az - other.position.z) < other.radius + 0.55) return false;
        }
        return true;
      };
      for (const candidate of field.trees) {
        if (candidate.qualityHidden || candidate.state !== 'standing') continue;
        if (
          candidate.position.x < this.bounds.minX + 0.7 ||
          candidate.position.x > this.bounds.maxX - 0.7 ||
          candidate.position.z < this.bounds.minZ + 0.7 ||
          candidate.position.z > this.bounds.maxZ - 0.7
        ) {
          // Prefer a tree the player can actually reach inside the fence.
          continue;
        }
        const d = Math.hypot(candidate.position.x - this.player.x, candidate.position.z - this.player.z);
        if (!fallback || d < fallback.d) fallback = { tree: candidate, d };
        // Pines keep their foliage down to the boots; standing under one puts
        // the third-person camera inside a green wall. The demo/check wants a
        // readable trunk and stump, so prefer a high-crowned deciduous tree
        // when one is available and keep the pine as the fallback.
        if (candidate.species === 'pine') continue;
        if (!approachClear(candidate)) continue;
        const crownBase = (candidate.meta?.crownBase || 2) * candidate.scale;
        const score = d + (crownBase < 2.2 ? 1.8 : 0);
        if (!best || score < best.d) best = { tree: candidate, d: score };
      }
      tree = best?.tree || fallback?.tree || null;
    }
    if (!tree) return null;
    let dx = this.player.x - tree.position.x;
    let dz = this.player.z - tree.position.z;
    let len = Math.hypot(dx, dz);
    if (len < 0.001) {
      dx = 0;
      dz = 1;
      len = 1;
    }
    const approach = (tree.meta.approachDistance || 1.15) * tree.scale;
    const ax = tree.position.x + (dx / len) * approach;
    const az = tree.position.z + (dz / len) * approach;
    this.player.set(ax, 0, az);
    this.fieldCollide();
    this.propCollide();
    this.player.x = clamp(this.player.x, this.bounds.minX, this.bounds.maxX);
    this.player.z = clamp(this.player.z, this.bounds.minZ, this.bounds.maxZ);
    this.faceTree(tree);
    this.target = tree;
    this.targetPoint.set(tree.position.x, tree.meta.chopHeight * tree.scale, tree.position.z);
    this.snapCamera();
    this.character?.setWorldTransform(this.player, this.playerYaw, Math.PI);
    return tree.id;
  }

  updateTarget(dt) {
    if (this.mode !== 'yard') {
      if (this.targetMarker) this.targetMarker.visible = false;
      return;
    }
    this.targetTimer -= dt;
    if (this.targetTimer > 0) return;
    this.targetTimer = 0.09;
    const field = this.activeYard?.field;
    if (!field) return;
    const hit = field.pick(this.player, this.forward(), 2.55, 0.32);
    this.target = hit?.tree || null;
    if (hit) {
      this.targetPoint.copy(hit.point);
      const radius = hit.tree.radius;
      if (this.targetMarker) {
        this.targetMarker.visible = true;
        this.targetMarker.position.set(hit.tree.position.x, 0.035, hit.tree.position.z);
        this.targetMarker.children[0].scale.setScalar(Math.max(1, radius / 0.3));
        this.targetBand.position.set(
          hit.tree.position.x,
          hit.tree.position.y + hit.tree.meta.chopHeight * hit.tree.scale,
          hit.tree.position.z,
        );
        this.targetBand.scale.set(Math.max(0.8, radius / 0.3), 1, Math.max(0.8, radius / 0.3));
      }
    } else if (this.targetMarker) {
      this.targetMarker.visible = false;
    }
    this.blockDistance = Math.hypot(this.player.x - BLOCK.x, this.player.z - BLOCK.z);
    this.updatePrompt();
  }

  updatePrompt() {
    const prompt = this.ui.prompt;
    const blockPrompt = this.ui.blockPrompt;
    if (!prompt || !blockPrompt) return;
    if (this.mode !== 'yard') {
      prompt.hidden = true;
      blockPrompt.hidden = true;
      return;
    }
    const showBlock = this.blockDistance < 2.2 && !this.target;
    blockPrompt.hidden = !showBlock;
    if (this.target) {
      const tree = this.target;
      const left = Math.max(0, Math.ceil(tree.meta.hitsToFell - tree.hits));
      prompt.hidden = false;
      if (this.ui.promptTitle) {
        this.ui.promptTitle.textContent = `${WOOD_LABEL[tree.species] || tree.species} · ${left} hit${left === 1 ? '' : 's'} to fell`;
      }
      if (this.ui.promptText) {
        this.ui.promptText.textContent = 'LMB / Space to chop · walk closer if the ring disappears';
      }
    } else {
      prompt.hidden = true;
    }
  }

  swingAtTarget() {
    if (this.mode !== 'yard') return false;
    this.aftermath = null;
    if (this.swingLock) return false;
    if (this.isInputBlocked()) return false;
    const field = this.activeYard?.field;
    if (!field) return false;
    const hit = field.pick(this.player, this.forward(), 2.55, 0.32);
    if (!hit) {
      if (this.sound?.deny) this.sound.deny();
      this.onToast?.('No tree in reach — walk up to a trunk.', '');
      return false;
    }
    this.target = hit.tree;
    this.doTreeSwing(hit.tree, { power: 1 });
    return true;
  }

  async doTreeSwing(tree, { power = 1 } = {}) {
    if (!tree || this.swingLock) return null;
    this.swingLock = true;
    this.target = tree;
    this.character?.playSwing('tree');
    this.sound?.whoosh?.(1.15);
    await this.wait(0.42);
    const dir = new THREE.Vector3(
      tree.position.x - this.player.x,
      0,
      tree.position.z - this.player.z,
    ).normalize();
    const point = new THREE.Vector3(
      tree.position.x,
      tree.position.y + tree.meta.chopHeight * tree.scale,
      tree.position.z,
    );
    const result = this.activeYard?.field?.hit(tree, dir, power) || { felled: false };
    const species = tree.species;
    this.chips?.spawn(point, dir, result.felled ? 22 : 13);
    const weather = this.weather?.weather || 'clear';
    this.sound?.impact?.(0.7 + power * 0.2, 1.1, weather, {
      wood: species === 'walnut' || species === 'apricot' || species === 'poplar' ? 'oak' : species,
      pan: (Math.random() - 0.5) * 0.4,
    });
    this.shake = Math.max(this.shake, result.felled ? 0.12 : 0.055);
    if (!result.felled && tree.hits >= tree.meta.hitsToFell - 1) {
      this.sound?.treeCreak?.();
    }
    if (result.felled) {
      this.sound?.treeCreak?.();
      // The runtime clamps its fall integration to 1/30 s per frame, so at
      // 15–20 FPS a rod-about-base fall can still be in the air several seconds
      // later. Give the one-shot fall a little more angular urgency so the
      // felled log settles before the toast/screenshot beat.
      if (tree.anim) {
        tree.anim.k *= 2.2;
        tree.anim.w = Math.max(tree.anim.w, 0.22);
      }
      tree.anim.onLand = (t) => {
        this.sound?.treeFall?.();
        this.shake = Math.max(this.shake, 0.22);
        this.onTreeFelled(t);
        this.celebrate('tree');
      };
      this.onToast?.(`${WOOD_LABEL[species] || species} is going over!`, 'gold');
    }
    await this.wait(0.3);
    this.swingLock = false;
    return result;
  }

  onTreeFelled(tree) {
    const species = tree.species;
    const dir = new THREE.Vector3(
      tree.position.x - this.player.x,
      0,
      tree.position.z - this.player.z,
    );
    if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
    dir.normalize();
    // Hold a readable aftermath frame on the log and stump until the player
    // moves again. The operator's screenshot beat (~4 s after the fall) and a
    // real player's "look what I did" moment both want the log, not a close-up
    // of the underside of the crown.
    if (Math.hypot(this.velocity.x, this.velocity.z) < 0.12) {
      this.aftermath = { tree, dir, until: performance.now() + 12000 };
    }
    const reward = this.game?.awardTreeFell?.({
      species,
      coins: 12 + Math.round((tree.meta.height || 10) * 1.5),
      xp: 26 + Math.round((tree.meta.hitsToFell || 5) * 4),
      hits: tree.hits,
    });
    this.updateUi();
    if (reward) {
      this.onToast?.(
        `${WOOD_LABEL[species] || species} felled — +${reward.coins} coins, +${reward.xp} XP`,
        'good',
      );
      this.onHud?.();
    }
  }

  celebrate(reason = 'tree') {
    if (!this.character) return;
    // Do not interrupt a swing in progress; the cheer lands right after it.
    if (this.swingLock) {
      setTimeout(() => {
        if (!this.swingLock) this.character.playVictory();
      }, 1400);
      return;
    }
    this.character.playVictory();
    if (reason === 'level') this.sound?.levelUp?.();
  }

  onGameEvent(type, detail = null) {
    if (type === 'level') {
      this.celebrate('level');
    } else if (type === 'split' && detail && (detail.boss || detail.quality === 'BOSS CLEAN')) {
      this.celebrate('boss');
    } else if (type === 'split' && detail) {
      this.updateUi();
    }
  }

  async wait(seconds) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
  }

  async chopTree() {
    if (this.mode !== 'yard') await this.enterYard({ instant: true });
    if (!this.target || (this.target.state !== 'standing' && this.target.state !== 'chopping')) {
      const id = this.teleportNearTree();
      if (id == null) return { felled: false, hits: 0 };
    }
    const tree = this.target;
    let swings = 0;
    while (
      swings < 30 &&
      (tree.state === 'standing' || tree.state === 'chopping')
    ) {
      // Re-aim every swing in case the first hit activated (and shuddered) it.
      if (!this.target || this.target !== tree) {
        this.target = tree;
      }
      this.faceTree(tree);
      this.targetPoint.set(tree.position.x, tree.meta.chopHeight * tree.scale, tree.position.z);
      const result = await this.doTreeswingForTest(tree);
      swings += 1;
      if (result?.felled) break;
      await this.wait(0.09);
    }
    await this.waitForSettle(tree, 9000);
    return {
      felled: tree.state === 'fallen' || tree.state === 'stump' || tree.state === 'falling',
      hits: Math.round(tree.hits),
      swings,
    };
  }

  /** The test hook must go through the same animation/swing path, just sped up. */
  async doTreeswingForTest(tree) {
    if (this.swingLock) {
      await this.wait(0.2);
      if (this.swingLock) return null;
    }
    this.swingLock = true;
    this.character?.playSwing('tree');
    this.sound?.whoosh?.(1.1);
    await this.wait(0.36);
    const dir = new THREE.Vector3(
      tree.position.x - this.player.x,
      0,
      tree.position.z - this.player.z,
    ).normalize();
    const point = new THREE.Vector3(
      tree.position.x,
      tree.position.y + tree.meta.chopHeight * tree.scale,
      tree.position.z,
    );
    const result = this.activeYard?.field?.hit(tree, dir, 1) || { felled: false };
    this.chips?.spawn(point, dir, result.felled ? 22 : 12);
    this.sound?.impact?.(0.82, 1.1, this.weather?.weather || 'clear', {
      wood: tree.species === 'walnut' || tree.species === 'apricot' || tree.species === 'poplar'
        ? 'oak'
        : tree.species,
    });
    this.shake = Math.max(this.shake, result.felled ? 0.12 : 0.05);
    if (!result.felled && tree.hits >= tree.meta.hitsToFell - 1) this.sound?.treeCreak?.();
    if (result.felled) {
      this.sound?.treeCreak?.();
      if (tree.anim) {
        tree.anim.k *= 2.2;
        tree.anim.w = Math.max(tree.anim.w, 0.22);
      }
      tree.anim.onLand = (t) => {
        this.sound?.treeFall?.();
        this.shake = Math.max(this.shake, 0.22);
        this.onTreeFelled(t);
        this.celebrate('tree');
      };
    }
    await this.wait(0.22);
    this.swingLock = false;
    return result;
  }

  async waitForSettle(tree, timeout = 8000) {
    const ends = performance.now() + timeout;
    while (performance.now() < ends) {
      if (tree.state === 'fallen' || tree.state === 'stump') return true;
      await this.wait(0.06);
    }
    return tree.state === 'fallen' || tree.state === 'stump';
  }

  snapCamera() {
    const desired = this.desiredCamera();
    this.camera.position.copy(desired.position);
    this.cameraTarget.copy(desired.target);
    this.camera.lookAt(this.cameraTarget);
  }

  desiredCamera() {
    if (this.mode === 'yard' && this.aftermath) {
      const { tree, dir, until } = this.aftermath;
      if (performance.now() < until) {
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const sideSign = this.camera.position.clone().sub(tree.position).dot(side) >= 0 ? 1 : -1;
        // Build the shot from the player, not the log: the player stays in the
        // foreground, the stump is the middle ground and the felled trunk leads
        // the eye into the yard. A log-relative target put the player under the
        // bottom edge on the first try.
        const target = new THREE.Vector3(
          this.player.x + dir.x * 2.3,
          0.8,
          this.player.z + dir.z * 2.3,
        );
        const position = new THREE.Vector3(
          this.player.x - dir.x * 2.8 + side.x * 2.5 * sideSign,
          3.35,
          this.player.z - dir.z * 2.8 + side.z * 2.5 * sideSign,
        );
        position.x = clamp(position.x, this.bounds.minX - 1.5, this.bounds.maxX + 1.5);
        position.z = clamp(position.z, this.bounds.minZ + 0.15, this.bounds.maxZ + 3.5);
        // If the side view would start inside a trunk, slide it toward the
        // player until the lens is clear instead of dropping the shot.
        for (let i = 0; i < 6 && this.pointBlocked(position, 0.22); i += 1) {
          position.lerp(new THREE.Vector3(this.player.x, 2.8, this.player.z), 0.18);
        }
        return { position, target };
      }
      this.aftermath = null;
    }
    const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    // A slightly high over-the-shoulder frame that looks a little ahead of
    // Sergey instead of at his navel. He sits low-left of centre, which leaves
    // the block/tree and the shed or cathedral in the action half of the shot.
    const target = new THREE.Vector3(
      // Do not push the look target far ahead of the player: when he stands at
      // a trunk, a 0.9 m forward target lands inside the tree and the camera
      // collision pulls the lens right onto his back. 0.35 m reads the action
      // ahead without ever starting the camera ray inside an obstacle.
      this.player.x + right.x * 0.35 + forward.x * 0.35,
      this.player.y + 1.5,
      this.player.z + right.z * 0.35 + forward.z * 0.35,
    );
    const distance = 5.2;
    const horizontal = Math.cos(this.cameraPitch) * distance;
    const back = new THREE.Vector3(
      Math.sin(this.cameraYaw) * horizontal,
      Math.sin(this.cameraPitch) * distance + 0.18,
      Math.cos(this.cameraYaw) * horizontal,
    );
    const shoulder = -0.3;
    const desired = target.clone().add(back).addScaledVector(right, shoulder);
    // Pull the camera in when the line from the player hits a trunk or prop.
    const dir = desired.clone().sub(target);
    const length = dir.length();
    if (length > 0.001) dir.normalize();
    let safe = length;
    const steps = 10;
    for (let i = 1; i <= steps; i += 1) {
      const t = (i / steps) * length;
      const p = target.clone().addScaledVector(dir, t);
      if (this.pointBlocked(p, 0.28)) {
        safe = Math.max(0.8, t - 0.18);
        break;
      }
    }
    desired.copy(target).addScaledVector(dir, safe);
    // Keep the eye inside the fenced part of the yard on the north/east/west
    // sides. The south side is intentionally open (the camera lives there at
    // spawn); clamping only the fenced sides stops the lens passing through a
    // privacy panel when the player turns around near a boundary.
    desired.x = clamp(desired.x, this.bounds.minX - 0.2, this.bounds.maxX + 0.2);
    desired.z = Math.max(desired.z, this.bounds.minZ + 0.1);
    desired.y = Math.max(0.42, desired.y);
    return { position: desired, target };
  }

  pointBlocked(point, radius = 0.3) {
    const field = this.activeYard?.field;
    if (field) {
      for (const tree of field.trees) {
        if (tree.qualityHidden || tree.state === 'gone') continue;
        const dx = point.x - tree.position.x;
        const dz = point.z - tree.position.z;
        const r = tree.radius + radius;
        if (dx * dx + dz * dz < r * r && point.y < 8) return true;
      }
    }
    for (const collider of this.activeYard?.colliders || []) {
      if (collider.prop && !collider.prop.visible) continue;
      if (point.y > (collider.height ?? 2.5) + 0.35) continue;
      const dx = point.x - collider.x;
      const dz = point.z - collider.z;
      const r = collider.r + radius;
      if (dx * dx + dz * dz < r * r && point.y < 2.6) return true;
    }
    return false;
  }

  updateCamera(dt) {
    const desired = this.desiredCamera();
    const blend = 1 - Math.exp(-9 * dt);
    this.camera.position.lerp(desired.position, blend);
    this.cameraTarget.lerp(desired.target, Math.min(1, blend * 1.4));
    this.camera.lookAt(this.cameraTarget);
    if (this.shake > 0.0001) {
      const t = performance.now() * 0.001;
      this.camera.position.x += Math.sin(t * 74) * this.shake * 0.18;
      this.camera.position.y += Math.cos(t * 63) * this.shake * 0.14;
    }
  }

  updateBackdrop(force = false) {
    this.backdropTimer -= 1 / 60;
    if (!force && this.backdropTimer > 0) return;
    this.backdropTimer = 0.5;
    const label = this.weather?.timeLabel || 'golden';
    const key = label === 'night' ? 'night' : label === 'golden' || label === 'dawn' ? 'dusk' : 'wide';
    if (!force && key === this.backdropKey) return;
    this.backdropKey = key;
    for (const [setting, yard] of this.yards) {
      if (!yard.backdrop) continue;
      const phase = this.textures.has(`backdrop_${setting}_${key}`) ? key : 'wide';
      const source = this.textures.get(`backdrop_${setting}_${phase}`);
      if (!source) continue;
      const cacheKey = `backdrop_derived_${setting}_${phase}`;
      let texture = this.textures.get(cacheKey);
      if (!texture) {
        texture = this.deriveBackdrop(phase, setting) || source;
        this.textures.set(cacheKey, texture);
      }
      if (yard.backdrop.material.map !== texture) {
        yard.backdrop.material.map = texture;
        yard.backdrop.material.needsUpdate = true;
      }
      // The horizon card and the new treeline are unlit silhouettes. Tint them
      // so they participate in sunset/night rather than staying daytime-bright.
      const tint = key === 'night' ? 0x30394a : key === 'dusk' ? 0xd8c3a5 : 0xffffff;
      if (yard.treeline?.material?.color) yard.treeline.material.color.setHex(tint);
      if (yard.backdrop?.material?.color) yard.backdrop.material.color.setHex(tint);
      if (yard.skirt?.material?.color) {
        yard.skirt.material.color.setHex(
          key === 'night' ? 0x141d15 : key === 'dusk' ? 0x383d29 : 0x39462d,
        );
      }
    }
  }

  updateUi() {
    const felled = this.activeYard?.field
      ? this.activeYard.field.stats().felled
      : 0;
    if (this.ui.location) this.ui.location.textContent = SETTING_LABELS[this.setting];
    if (this.ui.modeLabel) {
      this.ui.modeLabel.textContent = this.mode === 'stump' ? 'At the chopping block' : 'Yard · free roam';
    }
    if (this.ui.felled) this.ui.felled.textContent = String(felled);
    if (this.ui.nearest) {
      const best = this.nearestTree();
      this.ui.nearest.textContent = best
        ? `${WOOD_LABEL[best.tree.species] || best.tree.species} · ${best.distance.toFixed(1)} m`
        : '—';
    }
    if (this.ui.promptAction) this.ui.promptAction.textContent = 'Chop';
  }

  update(rawDt, scaledDt) {
    if (!this.loaded) return;
    const dt = clamp(rawDt, 0, 0.06);
    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - dt * 4.2);
    updateWind(this.elapsed);
    WIND.uWindStrength.value = (this.weather?.getWindStrength?.() || 0.4) * 0.8 + 0.18;
    if (this.mode === 'yard') {
      this.updateMovement(dt);
      this.updateCamera(dt);
    } else {
      this.character?.setPosition(this.player);
    }
    this.shadowTimer = (this.shadowTimer || 0) - dt;
    if (this.shadowTimer <= 0) {
      this.shadowTimer = 0.5;
      for (const yard of this.yards.values()) this.updateTreeShadows(yard);
    }
    this.character?.update(dt);
    if (this.characterShadow) {
      this.characterShadow.position.set(this.player.x, 0.032, this.player.z);
      this.characterShadow.visible = Boolean(this.character?.isLoaded);
    }
    if (this.activeYard?.field) this.activeYard.field.update(this.camera, dt);
    this.chips?.update(dt);
    this.updateTarget(dt);
    this.updateBackdrop();
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.2;
      this.updateUi();
    }
    this.blockDistance = Math.hypot(this.player.x - BLOCK.x, this.player.z - BLOCK.z);
  }

  state() {
    const field = this.activeYard?.field;
    const raw = field ? field.stats() : { standing: 0, chopping: 0, falling: 0, felled: 0 };
    // Hidden-on-low trees show up as a NaN `gone` counter inside the runtime;
    // expose only the four documented keys.
    const trees = {
      standing: Number(raw.standing) || 0,
      chopping: Number(raw.chopping) || 0,
      falling: Number(raw.falling) || 0,
      felled: Number(raw.felled) || 0,
    };
    const nearest = this.nearestTreeState();
    return {
      setting: this.setting,
      costume: this.costume,
      axe: this.axeSkin,
      quality: this.quality,
      mode: this.mode,
      player: {
        x: Number(this.player.x.toFixed(3)),
        y: Number(this.player.y.toFixed(3)),
        z: Number(this.player.z.toFixed(3)),
      },
      anim: this.character?.currentName || 'None',
      characterLoaded: Boolean(this.character?.isLoaded),
      axeAttachedTo: this.character?.axeAttachedTo || null,
      trees,
      nearestTree: nearest,
      treeBudget: this.settings.trees,
      treeTotal: field ? field.trees.length : 0,
    };
  }

  ready() {
    return Boolean(
      this.loaded &&
        this.character?.isLoaded &&
        this.activeYard?.field &&
        this.activeYard.field.trees.length > 0,
    );
  }
}
