/**
 * Playable lumberjacks for the Assets v2 / Co-op v1 upgrade.
 *
 * Sergey and Alex share the same 24-bone Meshy skeleton and the same six
 * animation clips, so one class drives both. Each character has two PBR
 * costumes; the selected character's default costume is loaded first and any
 * other costume (or the other character) is lazy-loaded on demand.
 *
 * The axe is parented to the RightHand bone and the whole rig is driven by one
 * AnimationMixer with crossfades. `spawnRemoteAvatar()` builds a fully
 * independent clone (own skeleton, mixer and axe) for the online partner,
 * without touching the local player's rig.
 */
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_ROOT = '../assets/models/common/';
const TARGET_HEIGHT = 1.78;

/** Maps the four existing shop axes onto the four supplied skins. */
export const AXE_SKINS = Object.freeze({
  sergey: Object.freeze({
    id: 'sergey',
    file: 'axe_sergey.glb',
    gameId: 'felling',
    label: "Sergey's hatchet",
    length: 0.84,
  }),
  double_bit: Object.freeze({
    id: 'double_bit',
    file: 'axe_double_bit.glb',
    gameId: 'cruiser',
    label: 'Double-bit cruiser',
    length: 0.88,
  }),
  maul: Object.freeze({
    id: 'maul',
    file: 'splitting_maul.glb',
    gameId: 'maul',
    label: 'Splitting maul',
    length: 0.92,
  }),
  golden: Object.freeze({
    id: 'golden',
    file: 'axe_golden.glb',
    gameId: 'tempered',
    label: 'Golden felling axe',
    length: 0.88,
  }),
});

export const GAME_AXE_TO_SKIN = Object.freeze({
  felling: 'sergey',
  cruiser: 'double_bit',
  maul: 'maul',
  tempered: 'golden',
});

/**
 * Character catalogue. Costume ids are the shared co-op protocol ids:
 * Sergey `tee`/`jacket`, Alex `camo`/`bomber`.
 */
export const CHARACTER_DEFS = Object.freeze({
  sergey: Object.freeze({
    id: 'sergey',
    name: 'Sergey',
    defaultCostume: 'tee',
    costumes: Object.freeze({
      tee: Object.freeze({
        id: 'tee',
        name: 'Black tee',
        file: 'char_sergey_animated_pbr.glb',
        walk: 'char_sergey_walking_armature.glb',
        run: 'char_sergey_running_armature.glb',
      }),
      jacket: Object.freeze({
        id: 'jacket',
        name: 'Blue jacket',
        file: 'char_sergey_jacket_animated_pbr.glb',
        walk: 'char_sergey_jacket_walking_armature.glb',
        run: 'char_sergey_jacket_running_armature.glb',
      }),
    }),
  }),
  alex: Object.freeze({
    id: 'alex',
    name: 'Alex',
    defaultCostume: 'camo',
    costumes: Object.freeze({
      camo: Object.freeze({
        id: 'camo',
        name: 'Camo tee',
        file: 'char_alex_animated_pbr.glb',
        walk: 'char_alex_walking_armature.glb',
        run: 'char_alex_running_armature.glb',
      }),
      bomber: Object.freeze({
        id: 'bomber',
        name: 'Navy bomber',
        file: 'char_alex_jacket_animated_pbr.glb',
        walk: 'char_alex_jacket_walking_armature.glb',
        run: 'char_alex_jacket_running_armature.glb',
      }),
    }),
  }),
});

export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTER_DEFS));

export const CHARACTER_COSTUMES = Object.freeze({
  sergey: Object.freeze(['tee', 'jacket']),
  alex: Object.freeze(['camo', 'bomber']),
});

export function normaliseCharacter(id) {
  return CHARACTER_DEFS[id] ? id : 'sergey';
}

export function normaliseCostume(character, id) {
  const def = CHARACTER_DEFS[normaliseCharacter(character)];
  return def.costumes[id] ? id : def.defaultCostume;
}

export function costumeName(character, id) {
  const def = CHARACTER_DEFS[normaliseCharacter(character)];
  return def.costumes[id]?.name || def.costumes[def.defaultCostume].name;
}

export function characterName(id) {
  return CHARACTER_DEFS[normaliseCharacter(id)].name;
}

const assetUrl = (file) => new URL(MODEL_ROOT + file, import.meta.url).href;

/** Principal axis, head end and grip centre of a tool in its own space. */
function analyseTool(root) {
  root.updateMatrixWorld(true);
  const points = [];
  const strideFor = (count) => Math.max(1, Math.floor(count / 2500));
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const attr = object.geometry.attributes.position;
    const stride = strideFor(attr.count);
    const v = new THREE.Vector3();
    for (let i = 0; i < attr.count; i += stride) {
      v.fromBufferAttribute(attr, i).applyMatrix4(object.matrixWorld);
      points.push(v.clone());
    }
  });
  if (!points.length) {
    return { axis: new THREE.Vector3(0, 1, 0), length: 0.9, grip: new THREE.Vector3() };
  }
  const centroid = new THREE.Vector3();
  for (const p of points) centroid.add(p);
  centroid.multiplyScalar(1 / points.length);
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const p of points) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dz = p.z - centroid.z;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  const axis = new THREE.Vector3(0.28, 0.86, 0.42).normalize();
  for (let i = 0; i < 28; i += 1) {
    const nx = xx * axis.x + xy * axis.y + xz * axis.z;
    const ny = xy * axis.x + yy * axis.y + yz * axis.z;
    const nz = xz * axis.x + yz * axis.y + zz * axis.z;
    axis.set(nx, ny, nz);
    if (axis.lengthSq() < 1e-9) break;
    axis.normalize();
  }
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = p.clone().sub(centroid).dot(axis);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const span = Math.max(1e-5, max - min);
  // Compare radial spread at both ends: the axe head is the fat end.
  let nearSpread = 0;
  let nearCount = 0;
  let farSpread = 0;
  let farCount = 0;
  for (const p of points) {
    const rel = p.clone().sub(centroid);
    const along = rel.dot(axis);
    const radial = Math.sqrt(Math.max(0, rel.lengthSq() - along * along));
    if (along < min + span * 0.16) {
      nearSpread += radial;
      nearCount += 1;
    }
    if (along > max - span * 0.16) {
      farSpread += radial;
      farCount += 1;
    }
  }
  nearSpread /= Math.max(1, nearCount);
  farSpread /= Math.max(1, farCount);
  if (nearSpread > farSpread) axis.negate();
  return { axis, points, centroid, length: span, nearSpread, farSpread };
}

/**
 * Build the hand-held wrapper. The returned group has its origin at the grip
 * and its local +Y pointing at the axe head, so the same attach code works for
 * the vertical hatchet, the horizontal double-bit and the diagonal maul.
 */
function buildToolHolder(root, skin) {
  const info = analyseTool(root);
  const align = new THREE.Group();
  align.name = `axe-align-${skin.id}`;
  const q = new THREE.Quaternion().setFromUnitVectors(
    info.axis.clone().normalize(),
    new THREE.Vector3(0, 1, 0),
  );
  align.quaternion.copy(q);
  const pivot = new THREE.Group();
  pivot.add(root);
  align.add(pivot);
  // Rotate/scale first, then measure, so the grip offset is in final space.
  const s = skin.length / Math.max(0.05, info.length);
  align.scale.setScalar(s);
  const points = info.points.map((p) => p.clone().applyQuaternion(q).multiplyScalar(s));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const gripY = minY + (maxY - minY) * 0.24;
  const band = Math.max(0.008, (maxY - minY) * 0.035);
  let gx = 0;
  let gz = 0;
  let gn = 0;
  for (const p of points) {
    if (Math.abs(p.y - gripY) > band) continue;
    gx += p.x;
    gz += p.z;
    gn += 1;
  }
  if (gn > 0) {
    gx /= gn;
    gz /= gn;
  }
  pivot.position.set(-gx, -gripY, -gz);
  align.updateMatrixWorld(true);
  const holder = new THREE.Group();
  holder.name = `axe-holder-${skin.id}`;
  holder.add(align);
  holder.userData.toolDebug = {
    axis: info.axis.toArray(),
    nearSpread: info.nearSpread,
    farSpread: info.farSpread,
    length: info.length,
    gripY,
    pivot: pivot.position.toArray(),
  };
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
  return holder;
}

/**
 * The Meshy clips bake some locomotion into the Hips track. That is fine for a
 * cutscene, but a playable character must stay on the wrapper origin. Keep the
 * vertical bob and remove the horizontal root offset.
 */
function stripHipsHorizontal(clip) {
  for (const track of clip.tracks) {
    if (!/^Hips\.position$/.test(track.name)) continue;
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = 0;
      track.values[i + 2] = 0;
    }
  }
  return clip;
}

/** Slice every track to [start,end] seconds and rebase the times to zero. */
function trimClip(clip, start, end) {
  const tracks = [];
  for (const track of clip.tracks) {
    const times = track.times;
    const stride = track.values.length / Math.max(1, times.length);
    const values = track.values;
    const keptTimes = [];
    const keptValues = [];
    const sample = (time) => {
      let index = 0;
      for (let i = 1; i < times.length; i += 1) {
        if (times[i] > time) break;
        index = i;
      }
      const out = [];
      for (let k = 0; k < stride; k += 1) out.push(values[index * stride + k]);
      return out;
    };
    const push = (time, value) => {
      keptTimes.push(time - start);
      keptValues.push(...value);
    };
    push(start, sample(start));
    for (let i = 0; i < times.length; i += 1) {
      if (times[i] <= start || times[i] >= end) continue;
      push(times[i], values.slice(i * stride, i * stride + stride));
    }
    push(end, sample(end));
    const Track = track.constructor;
    tracks.push(new Track(track.name, keptTimes, keptValues));
  }
  const trimmed = new THREE.AnimationClip(`${clip.name}_loop`, end - start, tracks);
  trimmed.blendMode = clip.blendMode;
  return trimmed;
}

/** Build the action map shared by the local rig and remote clones. */
function makeActions(mixer, gltf, walkGltf, runGltf) {
  const actions = new Map();
  const add = (clip, name) => {
    if (!clip) return;
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    actions.set(name, action);
  };
  for (const source of gltf?.animations || []) {
    const clip = source.clone();
    let prepared = clip;
    if (clip.name === 'Axe_Stance') {
      // The authored clip starts with a 3.3 s pick-up crouch that also walks
      // the Hips 0.7 m back. Loop only the standing part, centred on the rig.
      prepared = stripHipsHorizontal(trimClip(clip, 3.35, 6.05));
    } else if (clip.name === 'Charged_Axe_Chop' || clip.name === 'Heavy_Hammer_Swing') {
      prepared = stripHipsHorizontal(clip);
    }
    add(prepared, clip.name);
  }
  const walkClip = walkGltf?.animations?.[0]?.clone?.() || walkGltf?.animations?.[0];
  const runClip = runGltf?.animations?.[0]?.clone?.() || runGltf?.animations?.[0];
  // The armature-only GLBs ship clips whose internal names are
  // "Armature|walking_man|baselayer"; expose the friendly names the state hook
  // and docs use.
  if (walkClip) walkClip.name = 'Walk_Arm';
  if (runClip) runClip.name = 'Run_Arm';
  add(walkClip, 'Walk_Arm');
  add(runClip, 'Run_Arm');
  return actions;
}

/** Shared visual tuning for both Meshy characters. */
function tuneCharacterMaterials(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      // The Meshy base-colour texture is a densely-packed 1024² atlas of
      // face, skin, tee and denim islands. Once the renderer drops to 0.2 DPR
      // (the software preset), the high mip levels average those islands
      // together and the black tee turns into camouflage. Mipmaps are the
      // culprit, not the mesh: disabling them on the base-colour map keeps the
      // correct flat colours at every distance.
      const map = material?.map;
      if (map) {
        map.generateMipmaps = false;
        map.minFilter = THREE.LinearFilter;
        map.magFilter = THREE.LinearFilter;
        map.anisotropy = 4;
        map.needsUpdate = true;
      }
      if (material) material.needsUpdate = true;
    }
    if (object.isSkinnedMesh) {
      object.userData.highGeometry = object.geometry;
      object.userData.lowGeometry = object.geometry;
      object.userData.skinned = true;
    }
  });
}

/**
 * Build one costume record (wrapper + cloned/live root + mixer/actions + hand).
 * Local characters pass their freshly parsed GLTF; remotes pass cloneScene.
 */
function buildCostumeRecord({
  scene,
  character,
  id,
  gltf,
  walkGltf,
  runGltf,
  cloneScene = false,
  visible = false,
  addToScene = true,
}) {
  const root = cloneScene ? cloneSkeleton(gltf.scene) : gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const height = Math.max(0.01, box.max.y - box.min.y);
  const scale = TARGET_HEIGHT / height;
  root.scale.multiplyScalar(scale);
  root.position.y -= box.min.y * scale;
  root.position.y -= 0.012; // shoes sit just below the grass line
  tuneCharacterMaterials(root);
  const wrapper = new THREE.Group();
  wrapper.name = `${character}-${id}`;
  wrapper.add(root);
  wrapper.visible = visible;
  if (addToScene) scene.add(wrapper);
  const mixer = new THREE.AnimationMixer(root);
  const actions = makeActions(mixer, gltf, walkGltf, runGltf);
  const rightHand = root.getObjectByName('RightHand') || null;
  const costume = {
    id,
    character,
    root,
    wrapper,
    mixer,
    actions,
    rightHand,
    skinned: [],
  };
  root.traverse((object) => {
    if (object.isSkinnedMesh) costume.skinned.push(object);
  });
  return costume;
}

/** Orient a tool holder in the RightHand bind pose (works for both rigs). */
function orientTool(costume, tool, character) {
  const holder = tool.holder;
  holder.position.set(0, 0, 0);
  holder.scale.set(1, 1, 1);
  const hand = costume.rightHand;
  if (!hand) return;
  costume.root.updateMatrixWorld(true);
  const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
  const handScale = hand.getWorldScale(new THREE.Vector3());
  // The bind-pose wrapper is later turned to face the player's heading, so
  // bias the head outward on the model's left here and it ends up on the
  // character's right (away from the torso) once placed in the yard.
  const desiredDir = new THREE.Vector3(-0.55, 0.76, 0.12).normalize();
  const desired = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), desiredDir);
  // Roll the blade flat toward the swing arc.
  desired.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.5));
  const handInv = handWorld.clone().invert();
  holder.quaternion.copy(handInv).multiply(desired);
  // Meshy hand bones are unit-scale, but compensate if a rig ever is not.
  const safeScale = new THREE.Vector3(
    handScale.x ? 1 / handScale.x : 1,
    handScale.y ? 1 / handScale.y : 1,
    handScale.z ? 1 / handScale.z : 1,
  );
  holder.scale.copy(safeScale);
  // A palm-sized offset keeps the handle in the fist while lifting the blade
  // clear of the shoulder and hip. Alex's torso is slightly slimmer, so his
  // grip sits a touch closer to the palm centre.
  const offsetWorld =
    character === 'alex'
      ? new THREE.Vector3(-0.108, 0.024, 0.05)
      : new THREE.Vector3(-0.12, 0.02, 0.05);
  holder.position.copy(offsetWorld.applyQuaternion(handInv));
}

function attachToolToCostume(costume, tool, character) {
  if (!costume || !tool?.holder || !costume.rightHand) return false;
  if (tool.holder.parent) tool.holder.parent.remove(tool.holder);
  costume.rightHand.add(tool.holder);
  orientTool(costume, tool, character);
  return true;
}

function setCostumeQuality(costume, quality) {
  const low = quality === 'low' || quality === 'ultra-low';
  for (const mesh of costume.skinned) {
    const high = mesh.userData.highGeometry;
    const reduced = mesh.userData.lowGeometry;
    const next = low && reduced ? reduced : high;
    if (next && mesh.geometry !== next) mesh.geometry = next;
  }
  costume.wrapper.traverse((object) => {
    if (object.isMesh) object.castShadow = !low;
  });
}

export class PlayableCharacter {
  constructor({ scene, loader, sound = null, onProgress = null, character = 'sergey' } = {}) {
    this.scene = scene;
    this.loader = loader;
    this.sound = sound;
    this.onProgress = onProgress;
    this.character = normaliseCharacter(character);
    this.costumes = new Map();
    this._costumePromises = new Map();
    this.axes = new Map();
    this._axesPromise = null;
    this.activeCostume = null;
    this.characterId = this.character;
    this.costumeId = CHARACTER_DEFS[this.character].defaultCostume;
    this.axeId = 'sergey';
    this.axeHolder = null;
    this.axeAttachedTo = null;
    this.loaded = false;
    this.quality = 'low';
    this.stance = false;
    this.oneShot = null;
    this.oneShotName = '';
    this.locomotion = 'idle';
    this.availableClips = {};
    this._finishedHandler = null;
  }

  /** Every URL this character can ever need (used by progress + docs/tests). */
  assetUrls(character = this.character) {
    const def = CHARACTER_DEFS[normaliseCharacter(character)];
    const urls = {};
    for (const costume of Object.values(def.costumes)) {
      urls[costume.id] = assetUrl(costume.file);
      urls[`walk_${costume.id}`] = assetUrl(costume.walk);
      urls[`run_${costume.id}`] = assetUrl(costume.run);
    }
    for (const skin of Object.values(AXE_SKINS)) urls[`axe_${skin.id}`] = assetUrl(skin.file);
    return urls;
  }

  /** Load the selected character's default costume plus all four small axes. */
  async load(character = this.character) {
    this.character = normaliseCharacter(character);
    const def = CHARACTER_DEFS[this.character];
    let done = 0;
    const tick = () => {
      done += 1;
      this.onProgress?.(Math.min(1, done / 6));
    };
    await Promise.all([this._loadAxes(tick), this.ensureCostume(def.defaultCostume, tick)]);
    this.loaded = this.costumes.size > 0;
    return this.loaded;
  }

  _loadAxes(tick = () => {}) {
    if (this._axesPromise) return this._axesPromise;
    this._axesPromise = (async () => {
      await Promise.all(
        Object.values(AXE_SKINS).map(async (skin) => {
          try {
            const gltf = await this.loader.loadAsync(assetUrl(skin.file));
            const root = gltf.scene;
            const holder = buildToolHolder(root, skin);
            this.axes.set(skin.id, { holder, scene: root, skin });
          } catch {
            // A missing axe GLB falls back to the old yard axe; the rest of
            // the asset pack still loads.
          } finally {
            tick();
          }
        }),
      );
    })();
    return this._axesPromise;
  }

  /** Lazy-load one costume of the current character. */
  ensureCostume(id, tick = null) {
    const def = CHARACTER_DEFS[this.character];
    const costumeDef = def.costumes[id];
    if (!costumeDef) return Promise.resolve(null);
    if (this.costumes.has(id)) return Promise.resolve(this.costumes.get(id));
    if (this._costumePromises.has(id)) return this._costumePromises.get(id);
    const promise = (async () => {
      const [gltf, walkGltf, runGltf] = await Promise.all([
        this.loader.loadAsync(assetUrl(costumeDef.file)).catch(() => null),
        this.loader.loadAsync(assetUrl(costumeDef.walk)).catch(() => null),
        this.loader.loadAsync(assetUrl(costumeDef.run)).catch(() => null),
      ]);
      if (!gltf) {
        this._costumePromises.delete(id);
        return null;
      }
      try {
        const costume = buildCostumeRecord({
          scene: this.scene,
          character: this.character,
          id,
          gltf,
          walkGltf,
          runGltf,
        });
        this.costumes.set(id, costume);
        this.loaded = true;
        tick?.();
        return costume;
      } catch {
        this._costumePromises.delete(id);
        return null;
      }
    })();
    this._costumePromises.set(id, promise);
    return promise;
  }

  /** Swap the playable model. Default costume of the new character. */
  async setCharacter(character) {
    const next = normaliseCharacter(character);
    if (next === this.character && this.activeCostume) return this.character;
    const previous = this.activeCostume;
    this.character = next;
    this.characterId = next;
    this.oneShot = null;
    this.oneShotName = '';
    this.locomotion = 'idle';
    this.stance = false;
    for (const costume of this.costumes.values()) costume.wrapper.visible = false;
    const def = CHARACTER_DEFS[next];
    const costume = await this.ensureCostume(def.defaultCostume);
    if (!costume) return this.character;
    this.activeCostume = null;
    if (previous) previous.wrapper.visible = false;
    this._activateCostume(costume, { time: 0, fade: false });
    return this.character;
  }

  /** Switch costume within the current character, lazy-loading it if needed. */
  setCostume(id) {
    const def = CHARACTER_DEFS[this.character];
    if (!def.costumes[id]) return Promise.resolve(this.costumeId);
    if (this.activeCostume && id === this.costumeId) return Promise.resolve(this.costumeId);
    return this.ensureCostume(id).then((costume) => {
      if (!costume) return this.costumeId;
      this._activateCostume(costume);
      return this.costumeId;
    });
  }

  _activateCostume(next, { time = null, fade = true } = {}) {
    const previous = this.activeCostume;
    const previousName = this.currentName;
    const previousTime = previous?.actions.get(previousName)?.time || 0;
    for (const costume of this.costumes.values()) costume.wrapper.visible = false;
    this.costumeId = next.id;
    this.activeCostume = next;
    next.wrapper.visible = true;
    this.syncVisibility();
    const action =
      next.actions.get(previousName) || next.actions.get('Idle');
    if (action) {
      for (const other of next.actions.values()) other.stop();
      action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      action.time = time == null ? previousTime % Math.max(0.01, action.getClip().duration) : time;
      this.action = action;
    }
    this.attachAxe();
    setCostumeQuality(next, this.quality);
    this.applyLocomotion(true);
    if (!fade) {
      // The first activation should not cross-fade from a hidden default pose.
      this.action?.setEffectiveWeight(1);
    }
  }

  /** Attach the currently selected axe to the active costume. */
  attachAxe() {
    const costume = this.activeCostume;
    const tool = this.axes.get(this.axeId) || this.axes.get('sergey');
    if (!costume || !tool || !costume.rightHand) return false;
    if (this.axeHolder && this.axeHolder.parent) this.axeHolder.parent.remove(this.axeHolder);
    const ok = attachToolToCostume(costume, tool, this.character);
    this.axeHolder = tool.holder;
    this.axeAttachedTo = ok ? costume.rightHand.name : null;
    return ok;
  }

  setQuality(name) {
    this.quality = name;
    for (const costume of this.costumes.values()) setCostumeQuality(costume, name);
    this.syncVisibility();
  }

  syncVisibility() {
    for (const costume of this.costumes.values()) {
      costume.wrapper.visible = costume === this.activeCostume;
    }
  }

  setAxe(id) {
    if (!this.axes.has(id)) return Promise.resolve(this.axeId);
    this.axeId = id;
    this.attachAxe();
    return Promise.resolve(this.axeId);
  }

  get currentName() {
    return this.action?.getClip?.()?.name || 'None';
  }

  get isLoaded() {
    return this.loaded && Boolean(this.activeCostume);
  }

  get position() {
    return this.activeCostume?.wrapper.position || new THREE.Vector3();
  }

  setStance(on) {
    this.stance = Boolean(on);
    this.applyLocomotion(true);
  }

  play(name, { fade = 0.18, loop = true, timeScale = 1, startTime = 0, force = false } = {}) {
    const costume = this.activeCostume;
    if (!costume) return null;
    const action = costume.actions.get(name);
    if (!action) return null;
    if (!force && action === this.action && loop) {
      action.setEffectiveTimeScale(timeScale);
      return action;
    }
    const previous = this.action;
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    if (startTime) action.time = startTime;
    action.play();
    if (previous && previous !== action) {
      action.crossFadeFrom(previous, Math.max(0.01, fade), false);
    }
    this.action = action;
    if (!loop) {
      this.oneShot = action;
      this.oneShotName = name;
      this.oneShotEnds =
        performance.now() + ((action.getClip().duration - startTime) * 1000) / Math.max(0.05, timeScale);
    } else {
      this.oneShot = null;
      this.oneShotName = '';
    }
    return action;
  }

  applyLocomotion(force = false) {
    if (!this.activeCostume) return;
    if (this.oneShot && !force) return;
    const name =
      this.locomotion === 'run'
        ? this.activeCostume.actions.has('Run_Arm')
          ? 'Run_Arm'
          : this.activeCostume.actions.has('Casual_Walk')
            ? 'Casual_Walk'
            : 'Walk_Arm'
        : this.locomotion === 'walk'
          ? this.activeCostume.actions.has('Walk_Arm')
            ? 'Walk_Arm'
            : 'Casual_Walk'
          : this.stance
            ? 'Axe_Stance'
            : 'Idle';
    const action = this.activeCostume.actions.get(name);
    if (!action) return;
    const speed =
      this.locomotion === 'run' ? 2.7 : this.locomotion === 'walk' ? 2.1 : 1;
    this.play(name, { fade: 0.2, loop: true, timeScale: speed, force });
  }

  setLocomotion(mode) {
    if (this.locomotion === mode) return;
    this.locomotion = mode;
    if (this.oneShot) return;
    this.applyLocomotion();
  }

  playSwing(kind = 'chop', impactDelay = null) {
    // Heavy_Hammer_Swing is the authored clip whose right hand actually travels
    // out to the chopping point. Charged_Axe_Chop is mostly a long crouching
    // charge (7.7 s) and played at a fixed 1.35x it kept the axe down by the
    // boots while the log was already splitting. Use the hammer action for both
    // modes and phase it so the blade reaches full extension on the same frame
    // the simulation lands its impact.
    const hasHammer = this.activeCostume?.actions.has('Heavy_Hammer_Swing');
    const name = hasHammer
      ? 'Heavy_Hammer_Swing'
      : this.activeCostume?.actions.has('Charged_Axe_Chop')
        ? 'Charged_Axe_Chop'
        : 'Axe_Stance';
    const action = this.activeCostume?.actions.get(name);
    const clip = action?.getClip();
    const contactTime = Math.min(1.0, Math.max(0.2, (clip?.duration || 1.8) * 0.55));
    const startTime = name === 'Heavy_Hammer_Swing' ? 0.05 : 0;
    const delay = Math.max(0.16, impactDelay || (kind === 'stump' ? 0.62 : 0.36));
    const timeScale = Math.min(4.6, Math.max(0.8, (contactTime - startTime) / delay));
    return this.play(name, {
      fade: 0.09,
      loop: false,
      timeScale,
      startTime,
      force: true,
    });
  }

  playVictory() {
    if (!this.activeCostume?.actions.has('Victory_Cheer')) return;
    this.stance = false;
    this.play('Victory_Cheer', { fade: 0.22, loop: false, timeScale: 1.35, force: true });
  }

  update(dt) {
    if (!this.activeCostume) return;
    if (this.oneShot && performance.now() > this.oneShotEnds + 40) {
      this.oneShot = null;
      this.oneShotName = '';
      this.applyLocomotion(true);
    }
    this.activeCostume.mixer.update(dt);
  }

  setWorldTransform(position, yaw, facingOffset = Math.PI) {
    const costume = this.activeCostume;
    if (!costume) return;
    costume.wrapper.position.set(position.x, position.y || 0, position.z);
    costume.wrapper.rotation.y = yaw + facingOffset;
  }

  setPosition(position) {
    const costume = this.activeCostume;
    if (!costume) return;
    costume.wrapper.position.set(position.x, position.y || 0, position.z);
  }

  state() {
    return {
      character: this.character,
      costume: this.costumeId,
      axe: this.axeId,
      characterLoaded: Boolean(this.isLoaded),
      anim: this.currentName,
      axeAttachedTo: this.axeAttachedTo,
    };
  }
}

/** Backwards-compatible name for the old single-character call sites. */
export class SergeyCharacter extends PlayableCharacter {}

/* ------------------------------------------------------------------ *
 *  Remote co-op avatar
 * ------------------------------------------------------------------ */

const REMOTE_CLIPS = new Set([
  'Charged_Axe_Chop',
  'Heavy_Hammer_Swing',
  'Victory_Cheer',
]);

function cacheLoad(cache, key, factory) {
  if (!cache) return factory();
  if (cache.has(key)) return cache.get(key);
  const promise = Promise.resolve().then(factory);
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

/**
 * Load (or reuse) one character costume + axe and return a fully independent
 * avatar: SkeletonUtils-cloned skeleton/meshes, own AnimationMixer, own axe.
 * The co-op module only calls `setAnim()` and places `root`; `update()` must be
 * pumped by the game each frame so the remote mixer advances.
 */
export async function spawnRemoteAvatar({
  scene,
  loader,
  character = 'sergey',
  costume = null,
  axe = 'sergey',
  cache = null,
  quality = 'low',
}) {
  const charId = normaliseCharacter(character);
  const def = CHARACTER_DEFS[charId];
  const costumeId = def.costumes[costume] ? costume : def.defaultCostume;
  const costumeDef = def.costumes[costumeId];
  const assets = await cacheLoad(cache, `char:${charId}:${costumeId}`, async () => {
    const [gltf, walkGltf, runGltf] = await Promise.all([
      loader.loadAsync(assetUrl(costumeDef.file)),
      loader.loadAsync(assetUrl(costumeDef.walk)).catch(() => null),
      loader.loadAsync(assetUrl(costumeDef.run)).catch(() => null),
    ]);
    return { gltf, walkGltf, runGltf };
  });
  const skin = AXE_SKINS[axe] || AXE_SKINS.sergey;
  const axeGltf = await cacheLoad(cache, `axe:${skin.id}`, () =>
    loader.loadAsync(assetUrl(skin.file)),
  );
  const record = buildCostumeRecord({
    scene,
    character: charId,
    id: costumeId,
    gltf: assets.gltf,
    walkGltf: assets.walkGltf,
    runGltf: assets.runGltf,
    cloneScene: true,
    visible: true,
  });
  setCostumeQuality(record, quality);
  const tool = { holder: buildToolHolder(axeGltf.scene.clone(true), skin), skin };
  attachToolToCostume(record, tool, charId);

  let current = null;
  const avatar = {
    root: record.wrapper,
    headHeight: 2.08,
    yawOffset: Math.PI,
    record,
    get anim() {
      return current?.getClip?.()?.name || 'Idle';
    },
    setAnim(name) {
      const mapped = name === 'Casual_Walk' ? 'Walk_Arm' : name === 'Run' ? 'Run_Arm' : name;
      let action = record.actions.get(mapped) || record.actions.get('Idle');
      if (!action) return;
      if (action === current) return;
      const previous = current;
      current = action;
      const once = REMOTE_CLIPS.has(action.getClip().name);
      action.reset();
      action.enabled = true;
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(1);
      action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      action.clampWhenFinished = true;
      action.play();
      if (previous && previous !== action && previous.isRunning()) {
        action.crossFadeFrom(previous, 0.12, false);
      }
    },
    update(dt) {
      record.mixer.update(dt);
    },
    dispose() {
      record.mixer.stopAllAction();
      record.wrapper.removeFromParent();
    },
  };
  avatar.setAnim('Idle');
  return avatar;
}
