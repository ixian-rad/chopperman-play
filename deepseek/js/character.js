/**
 * Sergey — the playable lumberjack for the Assets v2 upgrade.
 *
 * Loads the two PBR costumes, the animation clips (including the armature-only
 * walking/running clips), and the four axe skins. The axe is parented to the
 * RightHand bone and the whole rig is driven by one AnimationMixer with
 * crossfades. Both presets share the clean 20.7k-triangle source mesh: the old
 * vertex-clustered Low copy only saved ~1% of the triangles and its merged UV
 * seams speckled the black tee, so it was removed.
 */
import * as THREE from 'three';

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
      // Clamp to the nearest authored key; the subclip only trims, so this is
      // accurate enough for a continuous stance loop.
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

export class SergeyCharacter {

  constructor({ scene, loader, sound = null, onProgress = null } = {}) {
    this.scene = scene;
    this.loader = loader;
    this.sound = sound;
    this.onProgress = onProgress;
    this.costumes = new Map();
    this.axes = new Map();
    this.activeCostume = null;
    this.costumeId = 'tee';
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

  assetUrls() {
    return {
      tee: assetUrl('char_sergey_animated_pbr.glb'),
      jacket: assetUrl('char_sergey_jacket_animated_pbr.glb'),
      walkTee: assetUrl('char_sergey_walking_armature.glb'),
      runTee: assetUrl('char_sergey_running_armature.glb'),
      walkJacket: assetUrl('char_sergey_jacket_walking_armature.glb'),
      runJacket: assetUrl('char_sergey_jacket_running_armature.glb'),
      ...Object.fromEntries(
        Object.values(AXE_SKINS).map((skin) => [`axe_${skin.id}`, assetUrl(skin.file)]),
      ),
    };
  }

  async load() {
    const urls = this.assetUrls();
    let done = 0;
    const total = Object.keys(urls).length;
    const tick = () => {
      done += 1;
      this.onProgress?.(done / total);
    };
    const loadOne = async (url) => {
      try {
        const gltf = await this.loader.loadAsync(url);
        return gltf;
      } catch {
        // A missing character/axe GLB falls back to the procedural humanoid
        // and the old yard axe; the rest of the asset pack still loads.
        return null;
      } finally {
        tick();
      }
    };
    const entries = await Promise.all(
      Object.entries(urls).map(async ([key, url]) => [key, await loadOne(url)]),
    );
    const assets = Object.fromEntries(entries);
    for (const id of ['tee', 'jacket']) {
      const gltf = assets[id];
      if (!gltf) continue;
      const walkGltf = assets[id === 'tee' ? 'walkTee' : 'walkJacket'];
      const runGltf = assets[id === 'tee' ? 'runTee' : 'runJacket'];
      try {
        this.costumes.set(id, this.buildCostume(id, gltf, walkGltf, runGltf));
      } catch {
        // Skip a broken costume; the other one (or the fallback) still works.
      }
    }
    for (const skin of Object.values(AXE_SKINS)) {
      const gltf = assets[`axe_${skin.id}`];
      if (!gltf) continue;
      try {
        const root = gltf.scene;
        const holder = buildToolHolder(root, skin);
        this.axes.set(skin.id, { holder, scene: root, skin });
      } catch {
        // Skip a broken axe skin.
      }
    }
    this.loaded = this.costumes.size > 0;
    return this.loaded;
  }

  buildCostume(id, gltf, walkGltf, runGltf) {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const height = Math.max(0.01, box.max.y - box.min.y);
    const scale = TARGET_HEIGHT / height;
    root.scale.multiplyScalar(scale);
    root.position.y -= box.min.y * scale;
    root.position.y -= 0.012; // tennis shoes sit just below the grass line
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
        // culprit, not the mesh: disabling them on the base-colour map keeps
        // the correct flat colours at every distance. The normal/roughness
        // maps can keep their mips (they are detail-only).
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
        // Keep the LOD pointers on the mesh, not on the geometry: after the
        // first swap mesh.geometry is the reduced geometry, so geometry-level
        // userData would lose the original and High could never get it back.
        // The old vertex-cluster copy only saved ~1% of the triangles on this
        // 20.7k-tri mesh (UV/skin boundaries keep most clusters apart) and its
        // merged seams produced skin-coloured speckles on the black tee at
        // low DPR. Sharing the clean source mesh is both better looking and
        // effectively the same vertex cost.
        object.userData.highGeometry = object.geometry;
        object.userData.lowGeometry = object.geometry;
        object.userData.skinned = true;
      }
    });
    const wrapper = new THREE.Group();
    wrapper.name = `sergey-${id}`;
    wrapper.add(root);
    wrapper.visible = false;
    this.scene.add(wrapper);
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map();
    const add = (clip, name) => {
      if (!clip) return;
      const action = mixer.clipAction(clip);
      action.clampWhenFinished = true;
      actions.set(name, action);
    };
    for (const clip of gltf.animations || []) {
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
    const walkClip = walkGltf?.animations?.[0];
    const runClip = runGltf?.animations?.[0];
    // The armature-only GLBs ship clips whose internal names are
    // "Armature|walking_man|baselayer"; expose the friendly names the state
    // hook and docs use.
    if (walkClip) walkClip.name = 'Walk_Arm';
    if (runClip) runClip.name = 'Run_Arm';
    add(walkClip, 'Walk_Arm');
    add(runClip, 'Run_Arm');
    const rightHand = root.getObjectByName('RightHand') || null;
    const costume = {
      id,
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

  /** Attach the currently selected axe to the active costume. */
  attachAxe() {
    const costume = this.activeCostume;
    const tool = this.axes.get(this.axeId) || this.axes.get('sergey');
    if (!costume || !tool || !costume.rightHand) return false;
    if (this.axeHolder && this.axeHolder.parent) this.axeHolder.parent.remove(this.axeHolder);
    costume.rightHand.add(tool.holder);
    this.axeHolder = tool.holder;
    this.axeAttachedTo = costume.rightHand.name;
    this.applyHandOrientation(costume, tool);
    return true;
  }

  /**
   * Orient the tool relative to the hand in the bind pose. We pick a natural
   * carry direction (head out and slightly down), then store it as a local
   * quaternion so the animations carry the axe correctly.
   */
  applyHandOrientation(costume, tool) {
    const holder = tool.holder;
    holder.position.set(0, 0, 0);
    holder.scale.set(1, 1, 1);
    const hand = costume.rightHand;
    if (!hand) return;
    costume.root.updateMatrixWorld(true);
    const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
    const handScale = hand.getWorldScale(new THREE.Vector3());
    // The bind-pose wrapper is later turned to face the player's heading, so
    // bias the head outward on the model's left here and it ends up on Sergey's
    // right (away from the torso) once the character is placed in the yard.
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
    // clear of the shoulder and hip in the carry/idle poses.
    const offsetWorld = new THREE.Vector3(-0.12, 0.02, 0.05);
    holder.position.copy(offsetWorld.applyQuaternion(handInv));
  }

  setQuality(name) {
    this.quality = name;
    const low = name === 'low' || name === 'ultra-low';
    for (const costume of this.costumes.values()) {
      for (const mesh of costume.skinned) {
        const high = mesh.userData.highGeometry;
        const reduced = mesh.userData.lowGeometry;
        const next = low && reduced ? reduced : high;
        if (next && mesh.geometry !== next) mesh.geometry = next;
      }
    }
    for (const costume of this.costumes.values()) {
      costume.wrapper.traverse((object) => {
        if (object.isMesh) object.castShadow = !low;
      });
    }
    this.syncVisibility();
  }

  syncVisibility() {
    for (const [id, costume] of this.costumes) costume.wrapper.visible = id === this.costumeId;
  }

  setCostume(id) {
    if (!this.costumes.has(id)) return Promise.resolve(this.costumeId);
    if (!this.activeCostume) {
      this.costumeId = id;
      this.activeCostume = this.costumes.get(id);
      this.activeCostume.wrapper.visible = true;
      this.syncVisibility();
      const idle = this.activeCostume.actions.get('Idle');
      if (idle) {
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        this.action = idle;
      }
      this.attachAxe();
      this.setQuality(this.quality);
      return Promise.resolve(this.costumeId);
    }
    if (id === this.costumeId) return Promise.resolve(this.costumeId);
    const previous = this.activeCostume;
    const next = this.costumes.get(id);
    // Carry the current motion across the swap so the change is not a pop.
    const previousName = this.currentName;
    const previousTime = previous?.actions.get(previousName)?.time || 0;
    if (previous) previous.wrapper.visible = false;
    this.costumeId = id;
    this.activeCostume = next;
    next.wrapper.visible = true;
    this.syncVisibility();
    const action = next.actions.get(previousName) || next.actions.get('Idle');
    if (action) {
      for (const other of next.actions.values()) other.stop();
      action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      action.time = previousTime % Math.max(0.01, action.getClip().duration);
      this.action = action;
    }
    this.attachAxe();
    this.applyLocomotion(true);
    return Promise.resolve(this.costumeId);
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
      this.oneShotEnds = performance.now() + (action.getClip().duration - startTime) * 1000 / Math.max(0.05, timeScale);
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
    // Match the authored cycle to the ground speed. Walk_Arm covers about
    // 0.5 m per 1.07 s cycle and Run_Arm about 0.52 m per 0.67 s cycle, so a
    // 1.05 m/s walk needs ~2.1x and a 2.25 m/s run ~2.7x. The old 1.6x walk
    // cycle skated ~65%; this keeps the foot plant close to the turf.
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
    // The axe head is ~0.95 m in front of the chest at 1.0 s into
    // Heavy_Hammer_Swing — the natural contact frame for a trunk or block.
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
      costume: this.costumeId,
      axe: this.axeId,
      characterLoaded: Boolean(this.isLoaded),
      anim: this.currentName,
      axeAttachedTo: this.axeAttachedTo,
    };
  }
}
