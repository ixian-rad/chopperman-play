import * as THREE from 'three';
import {
  createBarkTexture,
  createEndGrainTexture,
  mulberry32,
} from './utils.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

function addTriangle(target, a, b, c, ua, ub, uc) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const normal = new THREE.Vector3().crossVectors(ab, ac).normalize();
  target.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  target.normals.push(
    normal.x, normal.y, normal.z,
    normal.x, normal.y, normal.z,
    normal.x, normal.y, normal.z,
  );
  target.uvs.push(ua.x, ua.y, ub.x, ub.y, uc.x, uc.y);
}

/**
 * Builds one radial wedge of a log. Cut faces and bark faces are batched into
 * material groups, and the geometry is recentered on its rough centroid so it
 * can be handed to a rigid body with minimal fuss.
 */
function createWedge(a0, a1, radius, height, segments = 4, seed = 1, lift = 0) {
  const random = mulberry32(seed);
  const topY = height / 2 + lift;
  const bottomY = -height / 2;
  const topCenter = new THREE.Vector3(0, topY, 0);
  const bottomCenter = new THREE.Vector3(0, bottomY, 0);
  const top = [];
  const bottom = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = a0 + (a1 - a0) * t;
    const r = radius * (1 + (random() - 0.5) * 0.022);
    top.push(new THREE.Vector3(Math.cos(a) * r, topY, Math.sin(a) * r));
    bottom.push(new THREE.Vector3(Math.cos(a) * r, bottomY, Math.sin(a) * r));
  }

  const cut = { positions: [], normals: [], uvs: [] };
  const bark = { positions: [], normals: [], uvs: [] };
  const uv = (v) => new THREE.Vector2(v.x / (radius * 2) + 0.5, v.z / (radius * 2) + 0.5);
  const uvSide = (v, a) => new THREE.Vector2(a / TAU, v.y / height + 0.5);

  for (let i = 0; i < segments; i++) {
    addTriangle(cut, topCenter, top[i + 1], top[i], uv(topCenter), uv(top[i + 1]), uv(top[i]));
  }
  for (let i = 0; i < segments; i++) {
    addTriangle(cut, bottomCenter, bottom[i], bottom[i + 1], uv(bottomCenter), uv(bottom[i]), uv(bottom[i + 1]));
  }
  // Radial split faces.
  addTriangle(cut, topCenter, top[0], bottom[0], uvSide(topCenter, a0), uvSide(top[0], a0), uvSide(bottom[0], a0));
  addTriangle(cut, topCenter, bottom[0], bottomCenter, uvSide(topCenter, a0), uvSide(bottom[0], a0), uvSide(bottomCenter, a0));
  addTriangle(cut, topCenter, bottom[segments], top[segments], uvSide(topCenter, a1), uvSide(bottom[segments], a1), uvSide(top[segments], a1));
  addTriangle(cut, topCenter, bottomCenter, bottom[segments], uvSide(topCenter, a1), uvSide(bottomCenter, a1), uvSide(bottom[segments], a1));

  for (let i = 0; i < segments; i++) {
    const a = a0 + (a1 - a0) * (i / segments);
    addTriangle(bark, top[i], top[i + 1], bottom[i + 1], uvSide(top[i], a), uvSide(top[i + 1], a), uvSide(bottom[i + 1], a));
    addTriangle(bark, top[i], bottom[i + 1], bottom[i], uvSide(top[i], a), uvSide(bottom[i + 1], a), uvSide(bottom[i], a));
  }

  const positions = [...cut.positions, ...bark.positions];
  const normals = [...cut.normals, ...bark.normals];
  const uvs = [...cut.uvs, ...bark.uvs];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.addGroup(0, cut.positions.length / 3, 0);
  geometry.addGroup(cut.positions.length / 3, bark.positions.length / 3, 1);
  geometry.computeBoundingSphere();

  const centroid = new THREE.Vector3();
  const uniquePoints = [topCenter, bottomCenter, ...top, ...bottom];
  for (const p of uniquePoints) centroid.add(p);
  centroid.divideScalar(uniquePoints.length);
  geometry.translate(-centroid.x, -centroid.y, -centroid.z);

  const hullPoints = [];
  for (const p of uniquePoints) {
    hullPoints.push(p.x - centroid.x, p.y - centroid.y, p.z - centroid.z);
  }
  const bounds = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const size = bounds.getSize(new THREE.Vector3());
  return {
    geometry,
    hullPoints: new Float32Array(hullPoints),
    centroid,
    fallbackHalf: new THREE.Vector3(
      Math.max(0.015, size.x / 2),
      Math.max(0.015, size.y / 2),
      Math.max(0.015, size.z / 2),
    ),
  };
}

function makeSoftParticleTexture(inner = 'rgba(255,241,213,0.9)') {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  g.addColorStop(0, inner);
  g.addColorStop(0.3, 'rgba(222,196,151,0.55)');
  g.addColorStop(1, 'rgba(198,169,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class DustBurst {
  constructor(scene, origin, count, power, texture, scale = 1, color = 0xd7bd91) {
    this.scene = scene;
    this.life = 0;
    this.maxLife = 2.4;
    this.origin = origin.clone();
    this.random = mulberry32((Math.random() * 1e9) | 0);
    this.velocities = [];
    this.points = null;
    this.material = new THREE.PointsMaterial({
      map: texture,
      size: 0.09 * scale,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      color,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    });
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = this.random() * TAU;
      const r = this.random() * 0.22;
      positions[i * 3] = origin.x + Math.cos(a) * r;
      positions[i * 3 + 1] = origin.y + (this.random() - 0.25) * 0.16;
      positions[i * 3 + 2] = origin.z + Math.sin(a) * r;
      this.velocities.push(
        new THREE.Vector3(
          Math.cos(a) * (0.2 + this.random() * 0.9),
          0.2 + this.random() * 1.3 * power,
          Math.sin(a) * (0.2 + this.random() * 0.9) - 0.3,
        ),
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt) {
    this.life += dt;
    const pos = this.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = this.velocities[i];
      v.y -= dt * 0.55;
      v.multiplyScalar(1 - dt * 1.15);
      pos.setX(i, pos.getX(i) + v.x * dt);
      pos.setY(i, pos.getY(i) + v.y * dt);
      pos.setZ(i, pos.getZ(i) + v.z * dt);
    }
    pos.needsUpdate = true;
    const t = this.life / this.maxLife;
    this.material.opacity = Math.max(0, 0.48 * (1 - t * t));
    this.points.scale.setScalar(1 + this.life * 0.34);
    if (this.life >= this.maxLife) this.dispose();
    return this.life < this.maxLife;
  }

  dispose() {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
  }
}

class SparkBurst {
  constructor(scene, origin, count = 18, power = 1) {
    this.scene = scene;
    this.life = 0;
    this.maxLife = 0.75;
    this.velocities = [];
    this.random = mulberry32((Math.random() * 1e9) | 0);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      const a = this.random() * TAU;
      const up = 0.3 + this.random() * 1.4;
      this.velocities.push(
        new THREE.Vector3(
          Math.cos(a) * (0.8 + this.random() * 2.6) * power,
          up * (0.7 + power),
          Math.sin(a) * (0.8 + this.random() * 2.6) * power,
        ),
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffd27a,
        size: 0.04,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt) {
    this.life += dt;
    const pos = this.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = this.velocities[i];
      v.y -= dt * 5.4;
      v.multiplyScalar(1 - dt * 0.8);
      pos.setX(i, pos.getX(i) + v.x * dt);
      pos.setY(i, pos.getY(i) + v.y * dt);
      pos.setZ(i, pos.getZ(i) + v.z * dt);
    }
    pos.needsUpdate = true;
    this.points.material.opacity = Math.max(0, 1 - this.life / this.maxLife);
    if (this.life >= this.maxLife) this.dispose();
    return this.life < this.maxLife;
  }

  dispose() {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
  }
}

const FALLBACK_LOG = Object.freeze({
  id: 'pine',
  name: 'White Pine',
  radius: 0.174,
  height: 0.46,
  knots: 0,
  density: 430,
  toughness: 0.55,
  barkTint: 0xb79c74,
  cutTint: 0xecc994,
  seed: 211,
});

export class DebrisSystem {
  constructor(scene, world, RAPIER, quality = null) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.random = mulberry32(8801);
    this.dustTexture = makeSoftParticleTexture();
    this.pieces = [];
    this.chips = [];
    this.dust = [];
    this.sparks = [];
    this.intactBody = null;
    this.intactCollider = null;
    this.fragmentCount = 0;
    this.mainPieces = 0;
    this.splinterCount = 0;
    this.active = false;
    this.log = FALLBACK_LOG;
    this.radius = this.log.radius;
    this.height = this.log.height;
    this.baseY = 0.48;
    this.heightOffset = 0;
    this.logCenter = new THREE.Vector3(0, this.baseY + this.height / 2, -0.95);
    this.knots = [];
    this.seams = [];
    this.hazards = [];
    this.piths = [{ x: 0, z: 0 }];
    this.weakAngle = 0;
    this.weakMarker = null;
    this.weakMaterials = [];
    this.weakOrb = null;
    this.weakPulse = 0;
    this.strikesRequired = 1;
    this.strikesDone = 0;
    this.crackLines = 0;
    this.weather = null;
    this.quality = quality;
    this.wetness = 0;
    this.wetnessTarget = 0;
    this.snowLoad = 0;
    this.weatherAge = 0;
    this.weatherDrying = 0;
    this.weatherCarried = false;
    this.carriedSnow = 0;
    this.carriedWetness = 0;
    this.seamTwist = 0;
    this.seamSealed = false;
    this.bossPhase = 1;
    this.bossPhaseFlash = 0;
    this.wedges = 0;
    this.maxWedges = 2;
    this.wedgeMeshes = [];
    this.wedgeSlots = [];
    this.wedgeStrikes = 0;
    this.lastCrackAngle = 0;
    this.kerf = null;
    this.kerfWater = null;
    this.kerfWidth = 0;
    this.kerfFillType = null;
    this.hollowCore = null;
    this.hollowCollapsed = false;
    this.hollowCavity = null;
    this.hollowCavityMat = new THREE.MeshStandardMaterial({
      color: 0x1b1008,
      roughness: 1,
      metalness: 0,
      emissive: 0x090403,
      emissiveIntensity: 0.55,
      side: THREE.DoubleSide,
    });
    this.hollowPuddle = null;
    this.hollowCap = null;
    this.hollowShaft = null;
    this.hollowBottom = null;
    this.hollowDepth = 0;
    this.hollowHoleRadius = 0;
    this.hollowRimTorn = false;
    // The "master check" is the one radial split line the player can rive.
    // It is deliberately separate from the boss seam, root notches, and hollow
    // core so the end grain does not become a pile of magic targets.
    this.rivingStreak = 0;
    this.lastRiveAngle = null;
    this.masterSeam = null;
    this.masterCheckLine = null;
    this.masterCheckGlint = null;
    this.masterCheckPulse = 0;
    this.shock = 0;
    this.shockCount = 0;
    this.shockRing = null;
    this.heartPulse = 0;
    this.disposable = new Set();
    this.intactDisposables = [];
    this.splinterMat = new THREE.MeshStandardMaterial({ color: 0xd8b780, roughness: 0.86 });
    this.frostMat = new THREE.MeshStandardMaterial({
      color: 0xdcecf4,
      roughness: 0.55,
      metalness: 0.02,
    });
    this.snowTexture = makeSoftParticleTexture('rgba(239,249,255,0.94)');
    this.materialCache = new Map();
    this.knotMat = new THREE.MeshStandardMaterial({ color: 0x2d1c10, roughness: 0.82 });
    this.wedgeMat = new THREE.MeshStandardMaterial({
      color: 0xc7d0cd,
      roughness: 0.3,
      metalness: 0.55,
      emissive: 0x1a1f1d,
    });
    this.hazardMats = {
      nail: new THREE.MeshStandardMaterial({
        color: 0x8f9694,
        metalness: 0.85,
        roughness: 0.34,
        emissive: 0x120b06,
      }),
      stone: new THREE.MeshStandardMaterial({
        color: 0x77756b,
        roughness: 0.96,
        metalness: 0.02,
      }),
      rust: new THREE.MeshStandardMaterial({
        color: 0x6e3d1e,
        roughness: 1,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    };
    this.crackMat = new THREE.LineBasicMaterial({
      color: 0x3b2817,
      transparent: true,
      opacity: 0.55,
    });
    this.chipGeometries = [
      new THREE.TetrahedronGeometry(0.04, 0),
      new THREE.BoxGeometry(0.045, 0.009, 0.1),
      new THREE.ConeGeometry(0.024, 0.11, 3),
      new THREE.BoxGeometry(0.012, 0.016, 0.14),
    ];
    this.buildIntactLog();
  }

  setQuality(preset) {
    this.quality = preset;
  }

  setWeather(modifiers, { carry = false } = {}) {
    this.weather = modifiers;
    this.wetnessTarget = Math.max(modifiers?.wetness || 0, 0);
    this.carriedSnow = this.snowLoad;
    this.carriedWetness = this.wetness;
    this.weatherCarried = Boolean(carry);
    if (carry) {
      // The weather lives across rounds: a round that was worked leaves less
      // snow on the next log, but a storm keeps packing it back on. Rain-fed
      // grain stays damp; clear weather slowly takes both away.
      this.snowLoad = Math.min(1, this.snowLoad * 0.82);
      this.wetness = Math.min(1, this.wetness * 0.9);
      if (this.wetnessTarget > 0.2) this.wetness = Math.max(this.wetness, this.wetnessTarget * 0.8);
    } else {
      this.wetness = this.wetnessTarget;
      this.snowLoad = modifiers?.frozen ? 1 : 0;
      this.weatherAge = 0;
      this.weatherDrying = 0;
    }
    this.setWetness(this.wetness);
  }

  /** Frost still packed in the end grain, independent of the current sky. */
  get surfaceFrozen() {
    return this.snowLoad > 0.45;
  }

  /** Damp grain, either from live rain or carried moisture. */
  get surfaceWet() {
    return !this.surfaceFrozen && this.wetness > 0.22;
  }

  /** What the player is actually striking, not just the weather preset. */
  get surfaceState() {
    if (this.surfaceFrozen) return 'snow';
    if (this.surfaceWet) return 'wet';
    return null;
  }

  /** Residual snow that is no longer frost-packed enough to change the bite. */
  get thawing() {
    return this.snowLoad > 0.02 && !this.surfaceFrozen;
  }

  setWetness(value) {
    this.wetness = Math.min(1, Math.max(0, value));
    this.applyWetnessMaterials();
  }

  applyWetnessMaterials() {
    for (const mat of this.materialCache.values()) {
      if (mat.userData.kind === 'cut') {
        mat.roughness = 0.72 + (1 - this.wetness) * 0.16;
      } else if (mat.userData.kind === 'bark') {
        mat.roughness = 0.86 + (1 - this.wetness) * 0.14;
      }
    }
  }

  /**
   * Snow packs on in a storm and melts back into the grain on a thaw; rain
   * wets the end grain and then dries. This runs inside a live round, so the
   * surface is not a static paint job: the snow cap fades, the wet sheen fades,
   * and the change is exposed as weatherAge/weatherDrying for the HUD and tests.
   */
  updateWeather(dt) {
    if (!this.weather) return;
    const frozen = Boolean(this.weather.frozen);
    const targetWet = Math.max(this.weather.wetness || 0, 0);
    const rate = Math.min(0.12, Math.max(0.001, dt));
    this.weatherAge += rate;
    const snowBefore = this.snowLoad;
    // A storm packs snow back on; once the sky clears, the carried cap melts
    // much faster than it accumulated, so the thaw is visible within a round.
    if (frozen) this.snowLoad = Math.min(1, this.snowLoad + rate * 0.04);
    else this.snowLoad = Math.max(0, this.snowLoad - rate * 0.045);
    const wetBefore = this.wetness;
    if (targetWet > this.wetness) this.wetness = Math.min(targetWet, this.wetness + rate * 0.05);
    else this.wetness = Math.max(targetWet, this.wetness - rate * 0.045);
    this.wetnessTarget = targetWet;
    this.weatherDrying = targetWet > 0.2
      ? Math.min(1, Math.max(0, 1 - this.wetness / targetWet))
      : 0;
    if (Math.abs(this.wetness - wetBefore) > 0.002) this.applyWetnessMaterials();
    const surface = this.weatherSurface;
    if (!surface) return;
    if (surface.type === 'snow') {
      const visible = this.snowLoad > 0.02;
      if (surface.cap) {
        surface.cap.visible = visible;
        surface.cap.material.opacity = visible ? 0.08 + this.snowLoad * 0.72 : 0;
      }
      if (surface.frost) {
        surface.frost.visible = visible;
        surface.frost.material.opacity = visible ? 0.12 + this.snowLoad * 0.68 : 0;
      }
      if (surface.skirt) surface.skirt.visible = visible;
      if (surface.melt) {
        const thaw = visible && !this.weather?.frozen && this.snowLoad < 0.9;
        surface.melt.visible = thaw;
        surface.melt.material.opacity = thaw ? (0.9 - this.snowLoad) * 0.34 : 0;
        surface.melt.scale.setScalar(1 + (1 - this.snowLoad) * 0.08);
      }
    } else if (surface.type === 'wet') {
      const visible = this.wetness > 0.02;
      if (surface.rim) {
        surface.rim.visible = visible;
        surface.rim.material.opacity = visible
          ? (0.16 + Math.min(1, this.wetness) * 0.16) * (0.05 + this.wetness * 0.85)
          : 0;
      }
      if (surface.drips) {
        surface.drips.visible = visible;
        surface.drips.material.opacity = visible ? 0.34 * (0.05 + this.wetness * 0.85) : 0;
      }
    }
    // The visuals should settle before the HUD label starts flickering.
    if (snowBefore !== this.snowLoad) this.weatherAge = Math.max(this.weatherAge, 0.01);
  }

  /** True once a snow cap has mostly melted or rain has mostly dried. */
  get weatherIsDrying() {
    if (this.snowLoad > 0.02 && !this.weather?.frozen) return true;
    if (this.weather?.frozen) return this.snowLoad < 0.8 && this.weatherAge > 1.2;
    if ((this.weather?.wetness || 0) > 0.2) return this.wetness < 0.72 && this.weatherAge > 1.2;
    return false;
  }

  /**
   * Install the log profile for the current round. Knots are deterministic for
   * a species so resetScene() rebuilds the same round.
   */
  setLog(profile, knots = [], { blockTop = 0.48, hazards = [] } = {}) {
    this.log = profile || FALLBACK_LOG;
    this.radius = this.log.radius;
    this.height = this.log.height;
    this.baseY = blockTop;
    this.knots = knots || [];
    this.hazards = hazards || [];
    this.strikesRequired = Math.max(1, Math.round(this.log.strikes || 1));
    this.strikesDone = 0;
    this.crackLines = 0;
    this.weakPulse = 0;
    const twin = Boolean(this.log.twinPith);
    if (twin) {
      const spread = this.radius * (this.log.pithSpread || 0.32);
      const angle = this.log.pithAngle || 0;
      this.piths = [
        { x: Math.cos(angle) * spread, z: Math.sin(angle) * spread },
        { x: -Math.cos(angle) * spread, z: -Math.sin(angle) * spread },
      ];
    } else {
      this.piths = [{ x: 0, z: 0 }];
    }
    // The boss weak seam moves after every bite. Seed it so a reset is stable.
    const weakRandom = mulberry32((this.log.seed || 1) * 31 + (this.log.bossIndex || 0) * 13 + 7);
    this.weakAngle = weakRandom() * TAU;
    // Sealed seams are a boss phase: later bosses hide the heart until the
    // player opens the rings with a normal bite.
    this.seamSealed = Boolean(this.log.bossSeamSealed);
    this.bossPhase = 1;
    this.bossPhaseFlash = 0;
    this.wedges = 0;
    this.wedgeMeshes = [];
    this.wedgeSlots = [];
    this.wedgeStrikes = 0;
    this.maxWedges = this.strikesRequired >= 4 || this.log.huge ? 3 : 2;
    this.lastCrackAngle = 0;
    this.kerfWidth = 0;
    this.kerfFillType = null;
    this.hollowCollapsed = false;
    this.hollowPulse = 0;
    this.hollowCavity = null;
    this.hollowPuddle = null;
    this.hollowCap = null;
    this.hollowShaft = null;
    this.hollowBottom = null;
    this.hollowDepth = 0;
    this.hollowHoleRadius = 0;
    this.hollowRimTorn = false;
    this.rivingStreak = 0;
    this.lastRiveAngle = null;
    this.masterCheckLine = null;
    this.masterCheckGlint = null;
    this.shock = 0;
    this.shockCount = 0;
    this.shockRing = null;
    this.heartPulse = 0;
    // A hollow round gets one visible rotten pocket. A centred strike punches
    // through it and collapses the core; a rim strike still has to chop.
    this.hollowCore = null;
    this.stumpPhase = this.log.stump ? (((this.log.seed || 1) * 0.618) % 1) * TAU : 0;
    if (this.log.hollow) {
      const hollowRandom = mulberry32((this.log.seed || 1) * 47 + 13);
      const angle = hollowRandom() * TAU;
      const offsetBase = this.log.hollowOffset ?? 0.04;
      const offsetJitter = this.log.hollowOffset ? 0.04 : 0.1;
      const offset = this.radius * (offsetBase + hollowRandom() * offsetJitter);
      this.hollowCore = {
        x: Math.cos(angle) * offset,
        z: Math.sin(angle) * offset,
        radius: this.radius * (this.log.hollowRadius ?? (0.24 + hollowRandom() * 0.1)),
      };
    }
    // An old stump has three exposed root notches around the bark. They are a
    // deliberate off-pith target: undercut one to crack the root ring, and the
    // next clean axe bite breaks the whole round wide open.
    this.rootNotches = [];
    this.rootsCut = 0;
    this.rootUnstable = false;
    this.rootRingBroken = false;
    if (this.log.stump) {
      const rootRandom = mulberry32((this.log.seed || 1) * 83 + 29);
      const coreAngle = this.hollowCore ? Math.atan2(this.hollowCore.z, this.hollowCore.x) : 0;
      const base = rootRandom() * TAU;
      for (let i = 0; i < 3; i++) {
        let angle = base + (i / 3) * TAU + (rootRandom() - 0.5) * 0.3;
        const delta = Math.atan2(Math.sin(angle - coreAngle), Math.cos(angle - coreAngle));
        if (this.hollowCore && Math.abs(delta) < 0.55) angle += 0.8;
        const r = this.outerRadiusAt(angle) * (0.86 + rootRandom() * 0.06);
        this.rootNotches.push({
          angle,
          x: Math.cos(angle) * r,
          z: Math.sin(angle) * r,
          radius: Math.max(0.055, this.radius * 0.2),
          cut: false,
          mesh: null,
          ring: null,
        });
      }
    }
    this.logCenter.set(0, this.baseY + this.height / 2, -0.95);
    this.buildGrainSeams();
    this.reset();
  }

  get strikesLeft() {
    return Math.max(0, this.strikesRequired - this.strikesDone);
  }

  /** Phase-two seams bite deeper and drift, so the endgame asks for timing. */
  get weakBiteBonus() {
    return this.bossPhase >= 2 ? 2.1 : 1.55;
  }

  /** Resolve one bite. Returns true when this strike finishes the round. */
  registerStrike({
    clean = true,
    glancing = false,
    hazardHit = false,
    preventSplit = false,
    weakHit = false,
    hollowHit = false,
    rimTear = false,
    riving = false,
    rivingAngle = null,
  } = {}) {
    if (this.active) return { split: false, progress: this.strikesDone, left: 0 };
    // A set wedge keeps the kerf open, so a clean axe blow finishes more of the
    // round than it would on tight, un-wedged grain. A wedge struck fully home
    // with the axe is worth more than one merely tapped in.
    const wedgeBonus = clean && !glancing && !hazardHit
      ? Math.min(
          0.95,
          this.wedges * (this.log.huge ? 0.24 : 0.16) + this.wedgeHomeCount * 0.14,
        )
      : 0;
    const hollowBonus =
      hollowHit && this.log.hollow && !this.hollowCollapsed && !glancing && !hazardHit
        ? 1.2
        : 0;
    // A clean blow just outside the rotten heart tears the rim and drops a little
    // of the pocket into the kerf. It is a consolation, not a shortcut.
    const rimBonus =
      rimTear &&
      this.log.hollow &&
      !this.hollowCollapsed &&
      !hollowBonus &&
      !glancing &&
      !hazardHit
        ? 0.28
        : 0;
    if (rimBonus > 0) this.hollowRimTorn = true;
    // A stump whose root ring has been undercut twice is ready to shear: the
    // next clean bite splits along the severed roots instead of fighting them.
    const rootBonus =
      clean && !glancing && !hazardHit && this.rootUnstable && !this.rootRingBroken
        ? this.log?.huge
          ? 0.55
          : 0.4
        : 0;
    if (rootBonus > 0) {
      this.rootUnstable = false;
      this.rootRingBroken = true;
    }
    // A deliberate off-pith blow on the golden check rives the round along the
    // grain. Hold the same line for the next bite and the split locks: nearly
    // half a bite of extra progress and a visibly true two-piece fracture.
    let rivingBonus = 0;
    let grainLock = false;
    const rivingLive =
      riving && clean && !glancing && !hazardHit && !weakHit && !hollowBonus && !rimBonus;
    if (rivingLive) {
      const angle = Number.isFinite(rivingAngle) ? rivingAngle : this.masterSeam;
      let sameLine = false;
      if (this.rivingStreak > 0 && Number.isFinite(this.lastRiveAngle) && Number.isFinite(angle)) {
        const delta = Math.abs(((angle - this.lastRiveAngle + Math.PI * 3) % TAU) - Math.PI);
        sameLine = delta < 0.3;
      }
      this.rivingStreak = sameLine ? this.rivingStreak + 1 : 1;
      this.lastRiveAngle = angle;
      grainLock = this.rivingStreak >= 2;
      rivingBonus = grainLock ? 0.5 : 0.24;
    } else {
      // A normal centre chop, a wedge, a hazard, or a glance all break the
      // line. The lock only rewards two consecutive reads of the same check.
      this.rivingStreak = 0;
      this.lastRiveAngle = null;
    }
    const bite = hazardHit
      ? 0.2
      : glancing
        ? 0.35
        : weakHit
          ? this.weakBiteBonus
          : clean
            ? 1 + wedgeBonus + hollowBonus + rimBonus + rootBonus + rivingBonus
            : 0.5 + hollowBonus * 0.5 + rimBonus * 0.5;
    if (hollowBonus > 0) {
      this.hollowCollapsed = true;
      this.collapseHollowVisual();
    }
    // Work knocks the weather off the wood: snow slips off the rim and wet grain
    // dries around the kerf. This is the live, physical half of the accumulation
    // model: a five-bite frozen round loses its frost wedge bonus before the end.
    const weatherWork = hazardHit ? 0.35 : glancing ? 0.5 : 1;
    const wetBefore = this.wetness;
    this.snowLoad = Math.max(0, this.snowLoad - 0.26 * weatherWork);
    this.wetness = Math.max(0, this.wetness - 0.18 * weatherWork);
    if (Math.abs(this.wetness - wetBefore) > 0.002) this.applyWetnessMaterials();
    this.strikesDone = Math.min(this.strikesRequired, this.strikesDone + bite);
    const phaseBefore = this.bossPhase;
    this.updateBossPhase();
    this.updateKerf();
    // A one-bite round always gives way on the first contact; the old one-swing
    // feel is preserved for pine and birch. Challenge rules can veto the split.
    const split =
      !preventSplit &&
      (this.strikesRequired <= 1 || this.strikesDone >= this.strikesRequired - 1e-6);
    return {
      split,
      progress: this.strikesDone,
      left: this.strikesLeft,
      damage: Math.min(1, bite / this.strikesRequired),
      weakHit,
      weakBonus: weakHit ? this.weakBiteBonus : 0,
      wedges: this.wedges,
      wedgeBonus,
      hollowHit: hollowBonus > 0,
      hollowBonus,
      hollowCollapse: hollowBonus > 0,
      hollowRimTear: rimBonus > 0,
      hollowRimBonus: rimBonus,
      rootBonus,
      rootRingBroken: rootBonus > 0,
      rootsCut: this.rootsCut || 0,
      rootUnstable: this.rootUnstable,
      riving: rivingLive,
      rivingBonus,
      grainLock,
      rivingStreak: this.rivingStreak,
      rivingAngle: this.lastRiveAngle,
      phase: this.bossPhase,
      phaseChanged: this.bossPhase !== phaseBefore,
    };
  }

  /** Bosses expose a faster, deeper final phase once the heart is half gone. */
  updateBossPhase() {
    if (!this.log?.boss) return;
    const phase = this.strikesDone >= this.strikesRequired * 0.55 ? 2 : 1;
    if (phase === this.bossPhase) return;
    this.bossPhase = phase;
    this.bossPhaseFlash = 0.9;
    this.updateWeakVisualState();
  }

  /** The kerf is a real widening dark split, not a HUD-only number. */
  updateKerf() {
    if (!this.kerf) return;
    const progress = this.strikesDone / Math.max(1, this.strikesRequired);
    const length = this.radius * (0.18 + progress * 0.72 + this.wedges * 0.035);
    this.kerfWidth = length;
    this.kerf.visible = this.strikesDone >= 0.28 && !this.active && progress < 0.999;
    this.kerf.scale.set(length, 1, 0.75 + this.wedges * 0.5);
    const angle = this.lastCrackAngle;
    this.kerf.position.set(
      Math.cos(angle) * length * 0.48,
      this.height / 2 + 0.0075,
      Math.sin(angle) * length * 0.48,
    );
    this.kerf.rotation.y = -angle;
    // Weather fills the opening: rain pools dark water in the check, frost
    // packs it with pale ice. Both make the kerf read before the HUD does.
    if (this.kerfWater) {
      const wet = this.wetness > 0.2;
      const frozen = Boolean(this.weather?.frozen) || this.snowLoad > 0.45;
      this.kerfFillType = frozen ? 'frost' : wet ? 'water' : null;
      this.kerfWater.visible = Boolean(this.kerfFillType) && this.kerf.visible;
      if (this.kerfFillType === 'frost') {
        this.kerfWater.material.color.setHex(0xdff1fb);
        this.kerfWater.material.opacity = 0.8;
      } else {
        this.kerfWater.material.color.setHex(0x6ca9c4);
        this.kerfWater.material.opacity = 0.62;
      }
    }
  }

  /** True when the aim point is over the rotten heart of a hollow round. */
  hollowAt(x, z) {
    if (!this.log.hollow || !this.hollowCore || this.hollowCollapsed) return null;
    const distance = Math.hypot(x - this.hollowCore.x, z - this.hollowCore.z);
    if (distance > this.hollowCore.radius * 1.18) return null;
    return { core: this.hollowCore, distance };
  }

  /** A clean strike just outside the pocket tears the fragile rim. */
  hollowRimAt(x, z) {
    if (!this.log.hollow || !this.hollowCore || this.hollowCollapsed) return null;
    const distance = Math.hypot(x - this.hollowCore.x, z - this.hollowCore.z);
    if (distance <= this.hollowCore.radius * 1.18) return null;
    if (distance > this.hollowCore.radius * 2.2) return null;
    return { distance, over: distance - this.hollowCore.radius };
  }

  /**
   * The top cap of a hollow round is a real annulus: a fan of triangles from the
   * rotten pocket out to the bark, with growth-ring UVs derived from X/Z. This
   * is what makes the cavity read as a hole rather than a dark sticker.
   */
  makeHollowCapGeometry(radius, core, holeRadius, y) {
    const positions = [];
    const uvs = [];
    const segments = this.quality?.grass > 3000 ? 48 : 32;
    const cx = core.x;
    const cz = core.z;
    const push = (x, z) => {
      positions.push(x, y, z);
      uvs.push(x / (radius * 2) + 0.5, z / (radius * 2) + 0.5);
    };
    const triangle = (ax, az, bx, bz, cx2, cz2) => {
      // Work out the winding once here; normals must point at the sky. The
      // signed area uses (x,z) with +Y up, so a positive value means the face
      // is clockwise from above and must be emitted in the reverse order.
      const wy = (bx - ax) * (cz2 - az) - (bz - az) * (cx2 - ax);
      if (wy >= 0) {
        push(ax, az);
        push(cx2, cz2);
        push(bx, bz);
      } else {
        push(ax, az);
        push(bx, bz);
        push(cx2, cz2);
      }
    };
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * TAU;
      const a1 = ((i + 1) / segments) * TAU;
      const ux0 = Math.cos(a0);
      const uz0 = Math.sin(a0);
      const ux1 = Math.cos(a1);
      const uz1 = Math.sin(a1);
      // Intersect the ray from the offset pocket with the (possibly fluted)
      // outer silhouette. Ancient Iron Stump uses the same profile as its side.
      const outerR0 = this.outerRadiusAt ? this.outerRadiusAt(a0) : radius;
      const outerR1 = this.outerRadiusAt ? this.outerRadiusAt(a1) : radius;
      const b0 = cx * ux0 + cz * uz0;
      const b1 = cx * ux1 + cz * uz1;
      const c0 = cx * cx + cz * cz - outerR0 * outerR0;
      const c1 = cx * cx + cz * cz - outerR1 * outerR1;
      const t0 = Math.max(holeRadius, -b0 + Math.sqrt(Math.max(0, b0 * b0 - c0)));
      const t1 = Math.max(holeRadius, -b1 + Math.sqrt(Math.max(0, b1 * b1 - c1)));
      const ix0 = cx + ux0 * holeRadius;
      const iz0 = cz + uz0 * holeRadius;
      const ix1 = cx + ux1 * holeRadius;
      const iz1 = cz + uz1 * holeRadius;
      const ox0 = cx + ux0 * t0;
      const oz0 = cz + uz0 * t0;
      const ox1 = cx + ux1 * t1;
      const oz1 = cz + uz1 * t1;
      triangle(ix0, iz0, ox0, oz0, ox1, oz1);
      triangle(ix0, iz0, ox1, oz1, ix1, iz1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Build (or rebuild) the open cap, interior wall, and dark cavity floor. */
  buildHollowCavity(group, cutMat, holeRadius, depth) {
    if (!group || !this.hollowCore) return;
    this.hollowHoleRadius = holeRadius;
    this.hollowDepth = depth;
    const y = this.height / 2;
    const cap = new THREE.Mesh(
      this.makeHollowCapGeometry(this.radius, this.hollowCore, holeRadius, y),
      cutMat,
    );
    cap.receiveShadow = true;
    group.add(cap);
    this.hollowCap = cap;

    const shaftGeo = new THREE.CylinderGeometry(
      holeRadius * 0.98,
      holeRadius * 0.74,
      depth,
      this.quality?.grass > 3000 ? 24 : 16,
      1,
      true,
    );
    const shaft = new THREE.Mesh(shaftGeo, this.hollowCavityMat);
    shaft.position.set(this.hollowCore.x, y - depth / 2, this.hollowCore.z);
    shaft.receiveShadow = true;
    group.add(shaft);
    this.hollowShaft = shaft;

    const bottomGeo = new THREE.CircleGeometry(holeRadius * 0.78, 18);
    const bottom = new THREE.Mesh(bottomGeo, this.hollowCavityMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(this.hollowCore.x, y - depth + 0.002, this.hollowCore.z);
    group.add(bottom);
    this.hollowBottom = bottom;
    this.hollowCavity = { group, holeRadius, depth };
    this.intactDisposables.push(cap.geometry, shaftGeo, bottomGeo);
  }

  /** Widen the pocket after a collapse without rebuilding the whole round. */
  rebuildHollowCavity(holeRadius, depth) {
    if (!this.intactGroup) return;
    for (const mesh of [this.hollowCap, this.hollowShaft, this.hollowBottom]) {
      if (!mesh) continue;
      mesh.parent?.remove(mesh);
      mesh.geometry?.dispose?.();
    }
    this.hollowCap = null;
    this.hollowShaft = null;
    this.hollowBottom = null;
    const cutMat = this.materialCache.get(this.log.id + ':cut');
    if (cutMat) this.buildHollowCavity(this.intactGroup, cutMat, holeRadius, depth);
  }

  /**
   * After the rotten heart gives way, leave the cavity visible instead of
   * painting the end grain back to a clean cut. The rim stays, the glow/wisp
   * die, and the hole opens into a real, deeper void.
   */
  collapseHollowVisual() {
    const hollow = this.hollowOverlay;
    const holeRadius = this.hollowCore ? this.hollowCore.radius * 1.28 : this.radius * 0.2;
    const depth = Math.min(this.height * 0.64, 0.34);
    this.rebuildHollowCavity(holeRadius, depth);
    if (!hollow) return;
    hollow.visible = true;
    if (this.hollowHole) {
      this.hollowHole.material.opacity = 1;
      this.hollowHole.material.color.setHex(0x0d0906);
      this.hollowHole.scale.setScalar(1.08);
      this.hollowHole.position.y = this.height / 2 - depth + 0.004;
      this.hollowHole.geometry.dispose?.();
      this.hollowHole.geometry = new THREE.CircleGeometry(holeRadius * 0.78, 14);
    }
    if (this.hollowRim) {
      this.hollowRim.material.color.setHex(0x7e4a26);
      this.hollowRim.material.opacity = 0.9;
      this.hollowRim.scale.setScalar(1.06);
    }
    if (this.hollowGlow) this.hollowGlow.visible = false;
    if (this.hollowWisp) this.hollowWisp.visible = false;
    if (this.hollowRot) this.hollowRot.visible = false;
    if (this.hollowPuddle) this.hollowPuddle.visible = true;
  }

  /** A wedge only makes sense once a check is open and the round is deep enough. */
  canDriveWedge() {
    if (this.active) return { ok: false, reason: 'The round is already split' };
    if (!this.log?.huge && this.strikesRequired < 3) {
      return { ok: false, reason: 'This round is too small for a wedge' };
    }
    if (this.strikesDone < 0.5) {
      return { ok: false, reason: 'Bite the rings first to open a check' };
    }
    if (this.wedges >= this.maxWedges) {
      return { ok: false, reason: 'The kerf is already wedged' };
    }
    return { ok: true, wedges: this.wedges, max: this.maxWedges };
  }

  /**
   * Drive a steel wedge into the open check. This spends stamina instead of a
   * full swing, advances the kerf, and makes the next clean axe blow fill more
   * of the round. It intentionally cannot finish the split on its own.
   */
  driveWedge(aim = { x: 0, z: 0 }, bonus = 0) {
    const check = this.canDriveWedge();
    if (!check.ok) return check;
    this.wedges += 1;
    const gained = (this.log?.huge ? 0.7 : 0.48) + Math.max(0, bonus);
    this.strikesDone = Math.min(this.strikesRequired - 0.05, this.strikesDone + gained);
    this.addCrack(aim.x || 0, aim.z || 0);
    this.addWedgeMesh(Math.atan2(aim.z || 0, aim.x || 0));
    const phaseBefore = this.bossPhase;
    this.updateBossPhase();
    this.updateKerf();
    this.updateWeakVisualState();
    return {
      ok: true,
      gained,
      wedges: this.wedges,
      max: this.maxWedges,
      progress: this.strikesDone,
      left: this.strikesLeft,
      phase: this.bossPhase,
      phaseChanged: this.bossPhase !== phaseBefore,
    };
  }

  /** Wedges that have been struck all the way into the check with the axe. */
  get wedgeHomeCount() {
    return this.wedgeSlots.reduce((sum, slot) => sum + (slot.homed ? 1 : 0), 0);
  }

  /**
   * A seated wedge is a physical strike target. Aim the axe at it and swing to
   * drive it deeper: the kerf opens, progress advances, and once it is home the
   * wedge permanently improves later axe bites. This cannot finish the split.
   */
  strikeWedge(slot, { power = 0.8, bonus = 0 } = {}) {
    if (!slot || slot.homed) {
      return { ok: false, reason: 'That wedge is already home', progress: this.strikesDone };
    }
    this.wedgeStrikes += 1;
    // A weak, windy swing just bounces off the steel and wastes the wind.
    if (power < 0.3) {
      return {
        ok: false,
        reason: 'The wedge rings but does not move — swing harder',
        bounced: true,
        depth: Number(slot.depth.toFixed(2)),
        progress: this.strikesDone,
      };
    }
    slot.hits += 1;
    const weatherBonus = this.weather?.frozen || this.snowLoad > 0.45
      ? 0.12
      : this.wetness > 0.2
        ? 0.08
        : 0;
    const gain = 0.3 + power * 0.24 + bonus + weatherBonus;
    slot.depth = Math.min(1, slot.depth + 0.46 + power * 0.22);
    let homedNow = false;
    if (slot.depth >= 0.999) {
      slot.homed = true;
      slot.depth = 1;
      homedNow = true;
    }
    this.strikesDone = Math.min(
      this.strikesRequired - 0.05,
      this.strikesDone + gain + (homedNow ? 0.22 : 0),
    );
    this.applyWedgeDepth(slot);
    const phaseBefore = this.bossPhase;
    this.updateBossPhase();
    this.updateKerf();
    this.updateWeakVisualState();
    return {
      ok: true,
      wedgeHit: true,
      homed: slot.homed,
      homedNow,
      depth: Number(slot.depth.toFixed(2)),
      gain: Number(gain.toFixed(2)),
      progress: this.strikesDone,
      left: this.strikesLeft,
      wedges: this.wedges,
      phase: this.bossPhase,
      phaseChanged: this.bossPhase !== phaseBefore,
    };
  }

  /** Sink the wedge mesh into the check as it is driven home. */
  applyWedgeDepth(slot) {
    if (!slot?.mesh) return;
    slot.mesh.position.y = slot.baseY - slot.depth * 0.085;
    const squash = 1 - slot.depth * 0.1;
    slot.mesh.scale.set(1.05, squash, 1.05);
    if (slot.ring) {
      slot.ring.material.opacity = slot.homed ? 0.12 : 0.4;
      slot.ring.position.y = slot.baseY - slot.depth * 0.085 + 0.002;
      slot.ring.scale.setScalar(1 + slot.depth * 0.24);
    }
  }

  /** Return the wedge under an aim point, if any. Used by the reticle and HUD. */
  wedgeAt(x, z) {
    if (!this.wedgeSlots.length) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const slot of this.wedgeSlots) {
      if (slot.homed) continue;
      const distance = Math.hypot(x - slot.x, z - slot.z);
      if (distance < slot.hitRadius && distance < bestDistance) {
        best = slot;
        bestDistance = distance;
      }
    }
    return best ? { slot: best, distance: bestDistance } : null;
  }

  /** Small steel wedge sunk into the most recent check. One draw per wedge. */
  addWedgeMesh(angle) {
    if (!this.intactGroup) return;
    const y = this.height / 2 + 0.008;
    const radial = this.radius * (0.42 + this.wedges * 0.09);
    const geo = new THREE.CylinderGeometry(0.06, 0.008, 0.155, 4, 1);
    const mesh = new THREE.Mesh(geo, this.wedgeMat);
    const x = Math.cos(angle) * radial;
    const z = Math.sin(angle) * radial;
    mesh.position.set(x, y + 0.055, z);
    mesh.rotation.set(Math.PI / 2, -angle, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.intactGroup.add(mesh);
    this.intactDisposables.push(geo);
    this.wedgeMeshes.push(mesh);

    // A faint steel-blue target ring tells the player this wedge can be struck
    // with the axe, not only tapped home with the F shortcut.
    const ringGeo = new THREE.RingGeometry(0.075, 0.105, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xa9c6cf,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.057, z);
    ring.renderOrder = 3;
    this.intactGroup.add(ring);
    this.intactDisposables.push(ringGeo, ringMat);
    // A small floating glint rises over the steel so the target reads from the
    // low gameplay camera, where a flat end-grain ring is heavily foreshortened.
    const glintMat = new THREE.MeshBasicMaterial({
      color: 0xc5e7f2,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      toneMapped: false,
    });
    const glint = new THREE.Mesh(
      new THREE.OctahedronGeometry(Math.max(0.017, this.radius * 0.095), 0),
      glintMat,
    );
    glint.position.set(x, y + 0.19, z);
    glint.renderOrder = 5;
    this.intactGroup.add(glint);
    this.intactDisposables.push(glint.geometry, glintMat);
    this.wedgeSlots.push({
      angle,
      x,
      z,
      mesh,
      ring,
      glint,
      baseY: y + 0.055,
      depth: 0,
      hits: 0,
      homed: false,
      hitRadius: Math.max(0.105, this.radius * 0.24),
    });
  }

  get seamOpen() {
    return !this.seamSealed || this.strikesDone >= 1;
  }

  /** Later bosses keep the heart hidden until their rings are opened. */
  updateWeakVisualState() {
    const open = this.seamOpen;
    const phaseTwo = this.bossPhase >= 2;
    if (this.weakOrb) {
      this.weakOrb.visible = open;
      this.weakOrb.material.color.setHex(phaseTwo ? 0xff7a3a : 0xffc86a);
    }
    if (this.weakBeam) {
      this.weakBeam.visible = open;
      this.weakBeam.material.color.setHex(phaseTwo ? 0xff5c2a : 0xffa53d);
    }
    if (this.weakBandMat) {
      this.weakBandMat.color.setHex(open ? (phaseTwo ? 0xff4d24 : 0xff9c33) : 0x707b78);
      this.weakBandMat.opacity = open ? (phaseTwo ? 0.76 : 0.62) : 0.28;
    }
    if (this.weakEdgeMat) {
      this.weakEdgeMat.color.setHex(open ? (phaseTwo ? 0xffd2a8 : 0xffe4ae) : 0xcfd8d2);
      this.weakEdgeMat.opacity = open ? (phaseTwo ? 0.98 : 0.85) : 0.3;
    }
  }

  get shockActive() {
    return this.bossPhase >= 2 && this.shock > 0.32;
  }

  /** Fire a telegraphed heartwood shock from the moving seam. */
  triggerShock() {
    if (!this.log?.boss || this.bossPhase < 2) return false;
    this.shock = 1;
    this.shockCount += 1;
    this.bossPhaseFlash = 0.25;
    const radial = ((this.bossMechanic?.inner || 0.5) + (this.bossMechanic?.outer || 0.8)) / 2;
    const pulsePoint = new THREE.Vector3(
      Math.cos(this.weakAngle) * this.radius * radial,
      this.topY + 0.015,
      -0.95 + Math.sin(this.weakAngle) * this.radius * radial,
    );
    this.spawnSparks(pulsePoint, 8, 0.6);
    this.dust.push(
      new DustBurst(
        this.scene,
        pulsePoint,
        Math.max(2, Math.round(5 * (this.quality?.dustScale ?? 1))),
        0.24,
        this.dustTexture,
        0.65,
      ),
    );
    return true;
  }

  hazardAt(x, z) {
    for (const hazard of this.hazards) {
      const d = Math.hypot(x - hazard.x, z - hazard.z);
      if (d < hazard.radius * 2.1) return { hazard, distance: d };
    }
    return null;
  }

  get topY() {
    return this.baseY + this.height;
  }

  buildGrainSeams() {
    const random = mulberry32((this.log.seed || 1) * 3 + 17);
    const count = 4 + Math.floor(random() * 3);
    this.seams = [];
    let angle = random() * TAU;
    for (let i = 0; i < count; i++) {
      this.seams.push(angle);
      angle += TAU / count + (random() - 0.5) * 0.36;
    }
    // Interlocked grain spirals outward. The checks visibly curve and the grain
    // bonus follows the same warp, so the player has to read a moving line.
    this.seamTwist = this.log?.twisted ? (0.62 + random() * 0.5) * (random() < 0.5 ? -1 : 1) : 0;

    // One check is the golden "master" line: aim slightly off-pith on it and
    // the bit rives along the grain instead of just crushing the pith. Keep it
    // away from hazards so the reward is never hidden under a stone.
    const hazardAngles = (this.hazards || []).map((hazard) => Math.atan2(hazard.z, hazard.x));
    let masterIndex = Math.floor(random() * this.seams.length) % this.seams.length;
    for (let attempt = 0; attempt < this.seams.length; attempt++) {
      const candidate = this.seams[(masterIndex + attempt) % this.seams.length];
      const blocked = hazardAngles.some((hazardAngle) => {
        const delta = Math.abs(((candidate - hazardAngle + Math.PI * 3) % TAU) - Math.PI);
        return delta < 0.32;
      });
      if (!blocked) {
        masterIndex = (masterIndex + attempt) % this.seams.length;
        break;
      }
    }
    this.masterSeam = this.seams[masterIndex] ?? null;
    this.masterSeamIndex = masterIndex;
    this.rivingStreak = 0;
    this.lastRiveAngle = null;
  }

  /**
   * The riving target: a point on the golden master check, between the pith and
   * the rim. Bosses and the old stump keep their own special targets instead.
   */
  masterCheckAt(x, z) {
    // Hollow rounds, bosses, and the stump already have their own signature
    // targets. Keeping riving off them avoids a golden line that cannot be hit
    // without triggering the rim tear / seam / root rule instead.
    if (this.masterSeam == null || this.log?.boss || this.log?.stump || this.log?.hollow) {
      return null;
    }
    const distance = Math.hypot(x, z);
    if (distance < this.radius * 0.26 || distance > this.radius * 0.76) return null;
    const angle = Math.atan2(z, x) - this.grainWarpAt(distance);
    const delta = Math.abs(((angle - this.masterSeam + Math.PI * 3) % TAU) - Math.PI);
    if (delta > 0.2) return null;
    if (this.knotAt(x, z) || this.hazardAt(x, z)) return null;
    return {
      angle: this.masterSeam,
      delta: Number(delta.toFixed(3)),
      quality: 1 - delta / 0.2,
      radius: distance,
      x,
      z,
    };
  }

  /** How far the grain has rotated at a given radius (interlocked wood only). */
  grainWarpAt(distance) {
    if (!this.seamTwist) return 0;
    return this.seamTwist * (distance / Math.max(0.0001, this.radius)) * 1.55;
  }

  /** 0..1 quality of a strike along a natural radial check. */
  grainAt(aimX, aimZ) {
    const dist = Math.hypot(aimX, aimZ);
    if (dist < this.radius * 0.2) return 0.9;
    const angle = Math.atan2(aimZ, aimX) - this.grainWarpAt(dist);
    let best = Math.PI;
    for (const seam of this.seams) {
      let d = Math.abs(((angle - seam + Math.PI * 3) % TAU) - Math.PI);
      best = Math.min(best, d);
    }
    return THREE.MathUtils.clamp(0.3 + 0.7 * (1 - best / 0.9), 0, 1);
  }

  nearestSeamAngle(aimX, aimZ) {
    const dist = Math.hypot(aimX, aimZ);
    const warp = this.grainWarpAt(dist);
    const angle = Math.atan2(aimZ, aimX) - warp;
    let best = this.seams[0] ?? 0;
    let bestD = Math.PI;
    for (const seam of this.seams) {
      const d = Math.abs(((angle - seam + Math.PI * 3) % TAU) - Math.PI);
      if (d < bestD) {
        bestD = d;
        best = seam;
      }
    }
    return bestD < 0.35 ? best + warp : angle + warp;
  }

  /**
   * A forked trunk has two hearts. Centre quality is measured from the nearer
   * pith, so the player can deliberately choose a lobe and follow its grain.
   */
  centerAt(x, z) {
    let best = 0;
    for (const pith of this.piths) {
      const distance = Math.hypot(x - pith.x, z - pith.z);
      best = Math.max(best, THREE.MathUtils.clamp(1 - distance / (this.radius * 1.02), 0, 1));
    }
    return best;
  }

  get bossMechanic() {
    return this.log?.bossMechanic || null;
  }

  /** 0..1 if a strike lands in the boss's exposed-heartwood band, else null. */
  weakAt(x, z) {
    const mechanic = this.bossMechanic;
    if (!mechanic || this.active || !this.seamOpen) return null;
    const distance = Math.hypot(x, z);
    const radial = distance / Math.max(0.0001, this.radius);
    if (radial < mechanic.inner || radial > mechanic.outer) return null;
    const angle = Math.atan2(z, x);
    const delta = Math.abs(((angle - this.weakAngle + Math.PI * 3) % TAU) - Math.PI);
    if (delta > (mechanic.arc || 2.2) / 2) return null;
    const bandMid = (mechanic.inner + mechanic.outer) / 2;
    const bandHalf = (mechanic.outer - mechanic.inner) / 2;
    const bandQuality = 1 - THREE.MathUtils.clamp(Math.abs(radial - bandMid) / Math.max(0.001, bandHalf), 0, 1);
    const arcQuality = 1 - THREE.MathUtils.clamp(delta / Math.max(0.001, (mechanic.arc || 2.2) / 2), 0, 1);
    return {
      mechanic,
      strength: THREE.MathUtils.clamp(0.55 + bandQuality * 0.25 + arcQuality * 0.2, 0, 1),
    };
  }

  /** A point in the middle of the current boss weak seam (test + HUD helper). */
  weakPointPosition() {
    const mechanic = this.bossMechanic;
    if (!mechanic || this.active || !this.seamOpen) return null;
    const radial = ((mechanic.inner + mechanic.outer) / 2) * this.radius;
    return {
      x: Math.cos(this.weakAngle) * radial,
      z: Math.sin(this.weakAngle) * radial,
      radius: radial,
      name: mechanic.label,
    };
  }

  /** Boss seams rotate after every landed bite, so the weak side must be re-read. */
  advanceWeakPoint() {
    if (!this.bossMechanic) return;
    let step = 1.35 + mulberry32((this.log.seed || 1) + this.strikesDone * 71)() * 1.35;
    if (this.bossPhase >= 2) step += 0.55;
    this.weakAngle = (this.weakAngle + step) % TAU;
    if (this.weakMarker) this.weakMarker.rotation.y = -this.weakAngle;
    this.updateWeakVisualState();
  }

  knotAt(x, z) {
    for (const knot of this.knots) {
      const d = Math.hypot(x - knot.x, z - knot.z);
      if (d < knot.radius * 1.65) return { knot, distance: d };
    }
    return null;
  }

  isBetweenKnots(x, z) {
    if (!this.knots.length) return true;
    if (this.knots.length < 2) {
      const knot = this.knots[0];
      return Math.hypot(x - knot.x, z - knot.z) > knot.radius * 1.25;
    }
    const [a, b] = this.knots;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const length = Math.hypot(abx, abz) || 1;
    const nx = -abz / length;
    const nz = abx / length;
    // Aim on the perpendicular bisector between the two knots gets the bonus.
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const offset = Math.abs((x - mx) * nx + (z - mz) * nz);
    return offset < this.radius * 0.34;
  }

  materialFor(log) {
    const key = log.id;
    if (this.materialCache.has(key + ':bark')) {
      return this.materialCache.get(key + ':bark');
    }
    const barkTex = createBarkTexture(log.seed, 1.8, 2.4);
    const endTex = createEndGrainTexture(log.seed + 1, 512);
    const bark = new THREE.MeshStandardMaterial({
      map: barkTex,
      color: log.barkTint,
      roughness: 0.95,
      bumpMap: barkTex,
      bumpScale: 0.012,
      metalness: 0,
    });
    bark.userData.kind = 'bark';
    const cut = new THREE.MeshStandardMaterial({
      map: endTex,
      color: log.cutTint,
      roughness: 0.82,
      bumpMap: endTex,
      bumpScale: 0.006,
      metalness: 0,
    });
    cut.userData.kind = 'cut';
    const barkSide = bark.clone();
    barkSide.color = new THREE.Color(log.barkTint).multiplyScalar(0.92);
    const ridge = new THREE.MeshStandardMaterial({
      color: new THREE.Color(log.barkColor || log.barkTint).multiplyScalar(0.55),
      roughness: 1,
    });
    this.materialCache.set(key + ':bark', bark);
    this.materialCache.set(key + ':cut', cut);
    this.materialCache.set(key + ':side', barkSide);
    this.materialCache.set(key + ':ridge', ridge);
    return bark;
  }

  materials() {
    const log = this.log;
    this.materialFor(log);
    return {
      bark: this.materialCache.get(log.id + ':bark'),
      cut: this.materialCache.get(log.id + ':cut'),
      side: this.materialCache.get(log.id + ':side'),
      ridge: this.materialCache.get(log.id + ':ridge'),
    };
  }

  /** Fluted silhouette radius for the Ancient Iron Stump. */
  outerRadiusAt(angle) {
    if (!this.log?.stump) return this.radius;
    const phase = this.stumpPhase || 0;
    return (
      this.radius *
      (1 +
        0.052 * Math.sin(angle * 5 + phase) +
        0.024 * Math.sin(angle * 9 - phase * 1.7) +
        0.014 * Math.sin(angle * 13 + phase * 0.4))
    );
  }

  /** Push the stump's cylinder vertices out into a root-flared, fluted trunk. */
  shapeStumpGeometry(geometry) {
    const pos = geometry.getAttribute('position');
    const half = this.height / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6) continue;
      const angle = Math.atan2(z, x);
      const y = pos.getY(i);
      const heightT = THREE.MathUtils.clamp((y + half) / Math.max(0.001, this.height), 0, 1);
      // Flutes fade out a touch at the very top, while the base spreads into a
      // buttressed root flare. The result reads as an old stump, not a cylinder.
      const flute = 1 + (this.outerRadiusAt(angle) / this.radius - 1) * (0.55 + heightT * 0.45);
      const flare = 1 + Math.pow(1 - heightT, 2.4) * 0.17;
      pos.setX(i, x * flute * flare);
      pos.setZ(i, z * flute * flare);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  /** Five gnarled root buttresses around the base of an old stump. */
  addStumpRoots(group, mats) {
    const count = this.quality?.grass > 3000 ? 6 : 5;
    const rootGeo = new THREE.BoxGeometry(this.radius * 0.17, this.height * 0.26, this.radius * 0.075);
    this.intactDisposables.push(rootGeo);
    const y = -this.height / 2 + this.height * 0.09;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + (this.stumpPhase || 0) * 0.3;
      const root = new THREE.Mesh(rootGeo, mats.ridge);
      root.position.set(
        Math.cos(angle) * this.radius * 0.94,
        y,
        Math.sin(angle) * this.radius * 0.94,
      );
      root.rotation.set(0.18 * Math.sin(angle * 2), -angle, 0.34);
      root.scale.set(1, 0.8 + (i % 3) * 0.16, 1);
      root.castShadow = true;
      root.receiveShadow = true;
      group.add(root);
    }
  }

  /** Three visible root notches on the stump's outer ring. */
  addRootNotches(group, mats) {
    if (!this.rootNotches?.length) return;
    const y = this.height / 2 + 0.012;
    for (const notch of this.rootNotches) {
      const notchMat = new THREE.MeshStandardMaterial({
        color: 0x2a170c,
        roughness: 0.95,
        metalness: 0,
        emissive: 0x120804,
        emissiveIntensity: 0.3,
      });
      const geo = new THREE.BoxGeometry(notch.radius * 1.55, 0.012, notch.radius * 0.72);
      const mesh = new THREE.Mesh(geo, notchMat);
      mesh.position.set(notch.x, y, notch.z);
      mesh.rotation.y = -notch.angle;
      mesh.renderOrder = 2;
      group.add(mesh);
      this.intactDisposables.push(geo, notchMat);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xd99a54,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const ringGeo = new THREE.RingGeometry(notch.radius * 0.72, notch.radius * 1.18, 14);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(notch.x, y + 0.006, notch.z);
      ring.renderOrder = 3;
      group.add(ring);
      this.intactDisposables.push(ringGeo, ringMat);

      // A small floating amber glint lifts the target off the dark bark so the
      // low gameplay camera can find it; the wide end-grain ring alone was too
      // easily lost against the stump silhouette.
      const glintGeo = new THREE.OctahedronGeometry(notch.radius * 0.46, 0);
      const glintMat = new THREE.MeshBasicMaterial({
        color: 0xffbe76,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      });
      const glint = new THREE.Mesh(glintGeo, glintMat);
      glint.position.set(notch.x, y + 0.075, notch.z);
      glint.renderOrder = 4;
      group.add(glint);
      this.intactDisposables.push(glintGeo, glintMat);
      notch.mesh = mesh;
      notch.ring = ring;
      notch.glint = glint;
    }
  }

  /** The root notch under an aim point, if it is still uncut. */
  rootAt(x, z) {
    if (!this.rootNotches?.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const notch of this.rootNotches) {
      if (notch.cut) continue;
      const distance = Math.hypot(x - notch.x, z - notch.z);
      if (distance < notch.radius * 0.95 && distance < bestDist) {
        best = notch;
        bestDist = distance;
      }
    }
    return best;
  }

  /**
   * Cut a root notch instead of taking a normal axe bite. Two undercuts crack
   * the root ring; the next clean bite then gets a large root-break bonus.
   */
  undercut(notch, { power = 0.8 } = {}) {
    if (!notch || notch.cut) {
      return { ok: false, split: false, progress: this.strikesDone, left: this.strikesLeft };
    }
    notch.cut = true;
    this.rootsCut = (this.rootsCut || 0) + 1;
    if (notch.ring) notch.ring.visible = false;
    if (notch.glint) notch.glint.visible = false;
    if (notch.mesh) {
      notch.mesh.material.color.setHex(0xc18e50);
      notch.mesh.material.emissive.setHex(0x2a1508);
      notch.mesh.scale.set(1.12, 1, 1.1);
    }
    const gain = 0.68 + Math.min(1, Math.max(0, power)) * 0.22 + (this.log?.huge ? 0.06 : 0);
    this.strikesDone = Math.min(this.strikesRequired - 0.05, this.strikesDone + gain);
    if (this.rootsCut >= 2) this.rootUnstable = true;
    const phaseBefore = this.bossPhase;
    this.updateBossPhase();
    this.updateKerf();
    this.updateWeakVisualState();
    return {
      ok: true,
      undercut: true,
      split: false,
      gain: Number(gain.toFixed(2)),
      rootsCut: this.rootsCut,
      rootUnstable: this.rootUnstable,
      progress: this.strikesDone,
      left: this.strikesLeft,
      damage: Math.min(1, gain / Math.max(1, this.strikesRequired)),
      phase: this.bossPhase,
      phaseChanged: this.bossPhase !== phaseBefore,
    };
  }

  buildIntactLog() {
    this.disposeIntact();
    const mats = this.materials();
    const group = new THREE.Group();
    group.position.set(0, this.baseY + this.height / 2, -0.95);
    group.name = 'standing-log';
    this.intactGroup = group;

    const radialSegments = this.quality?.grass > 3000 ? 30 : 20;
    const hollow = Boolean(this.log.hollow && this.hollowCore);
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(
        this.radius,
        this.radius * 1.012,
        this.height,
        radialSegments,
        2,
        hollow,
      ),
      hollow ? mats.side : [mats.side, mats.cut, mats.cut],
    );
    cylinder.castShadow = true;
    cylinder.receiveShadow = true;
    if (this.log.stump) this.shapeStumpGeometry(cylinder.geometry);
    group.add(cylinder);
    this.intactDisposables.push(cylinder.geometry);

    // A hollow round needs a genuine hole in its top cap, an interior wall, and
    // a dark floor. Otherwise the "cavity" is just a black disk laid on the end
    // grain and the low camera never sees depth.
    if (hollow) {
      const bottomGeo = new THREE.CircleGeometry(this.radius * 1.004, radialSegments);
      const bottom = new THREE.Mesh(bottomGeo, mats.side);
      bottom.rotation.x = Math.PI / 2;
      bottom.position.y = -this.height / 2;
      group.add(bottom);
      this.intactDisposables.push(bottomGeo);
      this.buildHollowCavity(
        group,
        mats.cut,
        (this.hollowCore.radius || this.radius * 0.2) * 0.9,
        Math.min(this.height * 0.18, 0.075),
      );
    }

    // The huge colossus gets a buttressed root flare so its silhouette reads as
    // a yard monster rather than a scaled-up birch. The old stump gets a more
    // irregular set of actual root buttresses instead.
    if (this.log.huge && !this.log.stump) {
      const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(this.radius * 1.02, this.radius * 1.17, this.height * 0.16, radialSegments, 1),
        mats.side,
      );
      flare.position.y = -this.height / 2 + this.height * 0.08;
      flare.castShadow = true;
      flare.receiveShadow = true;
      group.add(flare);
      this.intactDisposables.push(flare.geometry);
    }
    if (this.log.stump) {
      this.addStumpRoots(group, mats);
      this.addRootNotches(group, mats);
    }

    // Bark ridges as one instanced draw.
    const ridgeGeo = new THREE.BoxGeometry(0.009, this.height * 0.86, 0.02);
    const ridgeCount = this.quality?.grass > 3000 ? 18 : 10;
    const ridges = new THREE.InstancedMesh(ridgeGeo, mats.ridge, ridgeCount);
    const dummy = new THREE.Object3D();
    const random = mulberry32(this.log.seed + 5);
    for (let i = 0; i < ridgeCount; i++) {
      const a = (i / ridgeCount) * TAU + random() * 0.2;
      const r = this.radius * (1.0 + random() * 0.01);
      dummy.position.set(Math.cos(a) * r, (random() - 0.5) * 0.05, Math.sin(a) * r);
      dummy.rotation.set(0, -a, (random() - 0.5) * 0.04);
      dummy.scale.set(1, 0.6 + random() * 0.6, 1);
      dummy.updateMatrix();
      ridges.setMatrixAt(i, dummy.matrix);
    }
    ridges.instanceMatrix.needsUpdate = true;
    ridges.castShadow = true;
    group.add(ridges);
    this.intactDisposables.push(ridgeGeo);

    // Radial grain checks on the end grain. These are also the visual target
    // for the "split along the grain" bonus.
    // Twisted rounds draw their checks as spiralling polylines so the warp in
    // grainAt() is visible before the swing.
    const linePositions = [];
    const checkSegments = this.seamTwist ? 7 : 1;
    for (const a of this.seams) {
      const inner = this.radius * 0.16;
      const outer = this.radius * 0.94;
      let prevX = Math.cos(a) * inner;
      let prevZ = Math.sin(a) * inner;
      for (let i = 1; i <= checkSegments; i++) {
        const t = i / checkSegments;
        const rr = inner + (outer - inner) * t;
        const angle = a + this.grainWarpAt(rr);
        const x = Math.cos(angle) * rr;
        const z = Math.sin(angle) * rr;
        linePositions.push(prevX, this.height / 2 + 0.003, prevZ, x, this.height / 2 + 0.003, z);
        prevX = x;
        prevZ = z;
      }
    }
    const seamGeo = new THREE.BufferGeometry();
    seamGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const seams = new THREE.LineSegments(seamGeo, this.crackMat);
    group.add(seams);
    this.intactDisposables.push(seamGeo);

    // The golden master check. It is one glowing line from the pith to the rim
    // plus a small floating glint, so the riving target reads from the low
    // gameplay camera where the dark checks are nearly edge-on. Bosses and the
    // stump keep their own targets and deliberately omit it.
    this.masterCheckLine = null;
    this.masterCheckGlint = null;
    if (this.masterSeam != null && !this.log.boss && !this.log.stump && !this.log.hollow) {
      const masterPoints = [];
      const inner = this.radius * 0.2;
      const outer = this.radius * 0.78;
      const segments = this.seamTwist ? 8 : 1;
      let prevX = Math.cos(this.masterSeam) * inner;
      let prevZ = Math.sin(this.masterSeam) * inner;
      for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const rr = inner + (outer - inner) * t;
        const angle = this.masterSeam + this.grainWarpAt(rr);
        const x = Math.cos(angle) * rr;
        const z = Math.sin(angle) * rr;
        masterPoints.push(prevX, this.height / 2 + 0.006, prevZ, x, this.height / 2 + 0.006, z);
        prevX = x;
        prevZ = z;
      }
      const masterGeo = new THREE.BufferGeometry();
      masterGeo.setAttribute('position', new THREE.Float32BufferAttribute(masterPoints, 3));
      const masterMat = new THREE.LineBasicMaterial({
        color: 0xf3c47f,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        toneMapped: false,
      });
      this.masterCheckLine = new THREE.LineSegments(masterGeo, masterMat);
      this.masterCheckLine.renderOrder = 4;
      group.add(this.masterCheckLine);
      this.intactDisposables.push(masterGeo, masterMat);

      const glintR = this.radius * 0.58;
      const glintAngle = this.masterSeam + this.grainWarpAt(glintR);
      const glintGeo = new THREE.OctahedronGeometry(Math.max(0.017, this.radius * 0.085), 0);
      const glintMat = new THREE.MeshBasicMaterial({
        color: 0xffdda0,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      });
      this.masterCheckGlint = new THREE.Mesh(glintGeo, glintMat);
      this.masterCheckGlint.position.set(
        Math.cos(glintAngle) * glintR,
        this.height / 2 + 0.19,
        Math.sin(glintAngle) * glintR,
      );
      this.masterCheckGlint.renderOrder = 6;
      group.add(this.masterCheckGlint);
      this.intactDisposables.push(glintGeo, glintMat);
    }

    // A widening dark kerf. It starts hidden and grows with every bite/wedge,
    // giving the multi-strike loop a physical read on the end grain.
    const kerfGeo = new THREE.BoxGeometry(1, 0.003, 0.022);
    const kerfMat = new THREE.MeshBasicMaterial({
      color: 0x1c1109,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    });
    const kerf = new THREE.Mesh(kerfGeo, kerfMat);
    kerf.position.y = this.height / 2 + 0.0075;
    kerf.visible = false;
    kerf.renderOrder = 2;
    group.add(kerf);
    this.intactDisposables.push(kerfGeo, kerfMat);
    this.kerf = kerf;

    // Weather in the check: a thin water sheen when the round is wet, packed
    // snow/frost when it is frozen. It rides inside the kerf, so it widens with
    // every wedge and disappears when the round finally gives way.
    const waterGeo = new THREE.BoxGeometry(0.92, 0.0014, 0.012);
    const waterMat = new THREE.MeshBasicMaterial({
      color: 0x8fc4d4,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(0, 0.0018, 0);
    water.visible = false;
    water.renderOrder = 3;
    kerf.add(water);
    this.intactDisposables.push(waterGeo, waterMat);
    this.kerfWater = water;

    // Hollow Elm's rotten heart. The pocket is visible before the swing, and a
    // centred strike punches through it for a one-blow collapse.
    this.hollowOverlay = null;
    if (this.log.hollow && this.hollowCore && !this.hollowCollapsed) {
      const hollow = new THREE.Group();
      hollow.name = 'hollow-core';
      const holeMat = new THREE.MeshBasicMaterial({
        color: 0x1b120b,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const rimMat = new THREE.MeshBasicMaterial({
        color: 0xc17a44,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffa85c,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.intactDisposables.push(holeMat, rimMat, glowMat);
      this.hollowGlowMat = glowMat;
      const hole = new THREE.Mesh(
        new THREE.CircleGeometry(this.hollowCore.radius, 11),
        holeMat,
      );
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(
        this.hollowCore.x,
        this.height / 2 - (this.hollowDepth || 0) + 0.005,
        this.hollowCore.z,
      );
      hollow.add(hole);
      this.intactDisposables.push(hole.geometry);
      this.hollowHole = hole;
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(
          this.hollowCore.radius * 0.94,
          this.hollowCore.radius * 1.26,
          14,
        ),
        rimMat,
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(this.hollowCore.x, this.height / 2 + 0.010, this.hollowCore.z);
      hollow.add(rim);
      this.intactDisposables.push(rim.geometry);
      this.hollowRim = rim;
      // A bevel ring just inside the rim gives the flat pocket a throat instead
      // of a sticker-like edge.
      const throatMat = new THREE.MeshBasicMaterial({
        color: 0x4a2c18,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const throat = new THREE.Mesh(
        new THREE.RingGeometry(
          this.hollowCore.radius * 0.76,
          this.hollowCore.radius * 0.98,
          12,
        ),
        throatMat,
      );
      throat.rotation.x = -Math.PI / 2;
      throat.position.set(this.hollowCore.x, this.height / 2 + 0.0105, this.hollowCore.z);
      hollow.add(throat);
      this.intactDisposables.push(throat.geometry, throatMat);
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(
          this.hollowCore.radius * 0.9,
          this.hollowCore.radius * 1.34,
          16,
        ),
        glowMat,
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(this.hollowCore.x, this.height / 2 + 0.012, this.hollowCore.z);
      hollow.add(glow);
      this.intactDisposables.push(glow.geometry);
      this.hollowGlow = glow;
      // Rainwater sits in the rotten cup; snow will frost the rim later.
      if ((this.weather?.wetness || 0) > 0.2) {
        const puddleMat = new THREE.MeshBasicMaterial({
          color: 0x2f5866,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const puddle = new THREE.Mesh(
          new THREE.CircleGeometry(this.hollowCore.radius * 0.86, 12),
          puddleMat,
        );
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(
          this.hollowCore.x,
          this.height / 2 - (this.hollowDepth || 0) + 0.008,
          this.hollowCore.z,
        );
        puddle.visible = true;
        hollow.add(puddle);
        this.intactDisposables.push(puddle.geometry, puddleMat);
        this.hollowPuddle = puddle;
      }
      // A faint rot shimmer makes the low-camera pocket readable before the
      // player has learned the end-grain silhouette.
      const wispMat = new THREE.MeshBasicMaterial({
        color: 0xd99a58,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const wisp = new THREE.Mesh(
        new THREE.CylinderGeometry(
          this.hollowCore.radius * 0.16,
          this.hollowCore.radius * 0.34,
          0.12,
          8,
          1,
          true,
        ),
        wispMat,
      );
      wisp.position.set(this.hollowCore.x, this.height / 2 + 0.07, this.hollowCore.z);
      hollow.add(wisp);
      this.hollowWisp = wisp;
      this.intactDisposables.push(wisp.geometry, wispMat);
      // Rotten radial cracks around the pocket.
      const rotPositions = [];
      const rotRandom = mulberry32((this.log.seed || 1) + 991);
      for (let i = 0; i < 5; i++) {
        const a = rotRandom() * TAU;
        const r0 = this.hollowCore.radius * 1.12;
        const r1 = this.radius * (0.46 + rotRandom() * 0.42);
        const bx = this.hollowCore.x + Math.cos(a) * r0;
        const bz = this.hollowCore.z + Math.sin(a) * r0;
        rotPositions.push(
          bx, this.height / 2 + 0.011, bz,
          this.hollowCore.x + Math.cos(a + 0.12) * r1,
          this.height / 2 + 0.011,
          this.hollowCore.z + Math.sin(a + 0.12) * r1,
        );
      }
      const rotGeo = new THREE.BufferGeometry();
      rotGeo.setAttribute('position', new THREE.Float32BufferAttribute(rotPositions, 3));
      const rot = new THREE.LineSegments(rotGeo, this.crackMat);
      hollow.add(rot);
      this.intactDisposables.push(rotGeo);
      this.hollowRot = rot;
      group.add(hollow);
      this.hollowOverlay = hollow;
    }

    // Knots: dark end-grain whorls and a bark-side bulge.
    for (const knot of this.knots) {
      const dark = new THREE.Mesh(
        new THREE.CircleGeometry(knot.radius * 1.35, 12),
        this.knotMat,
      );
      dark.rotation.x = -Math.PI / 2;
      dark.position.set(knot.x, this.height / 2 + 0.004, knot.z);
      group.add(dark);
      this.intactDisposables.push(dark.geometry);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(knot.radius * 1.35, knot.radius * 1.75, 14),
        new THREE.MeshBasicMaterial({
          color: 0x4b2d16,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(knot.x, this.height / 2 + 0.005, knot.z);
      group.add(ring);
      this.intactDisposables.push(ring.geometry, ring.material);
      const bulge = new THREE.Mesh(
        new THREE.SphereGeometry(knot.radius * 0.85, 7, 5),
        this.knotMat,
      );
      bulge.scale.set(1, 1.4, 1);
      const angle = Math.atan2(knot.z, knot.x);
      bulge.position.set(
        Math.cos(angle) * this.radius * 0.99,
        (this.random() - 0.5) * 0.18,
        Math.sin(angle) * this.radius * 0.99,
      );
      group.add(bulge);
      this.intactDisposables.push(bulge.geometry);
    }

    // Embedded nails and stones. They read as small dark glints on the end
    // grain; a strike on one sparks and rolls the edge.
    for (const hazard of this.hazards) {
      const y = this.height / 2 + 0.012;
      if (hazard.type === 'nail') {
        const rust = new THREE.Mesh(
          new THREE.CircleGeometry(hazard.radius * 2.6, 10),
          this.hazardMats.rust,
        );
        rust.rotation.x = -Math.PI / 2;
        rust.position.set(hazard.x, y - 0.004, hazard.z);
        group.add(rust);
        this.intactDisposables.push(rust.geometry);
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(hazard.radius * 0.42, hazard.radius * 0.3, 0.022, 6),
          this.hazardMats.nail,
        );
        shaft.position.set(hazard.x, y + 0.006, hazard.z);
        group.add(shaft);
        this.intactDisposables.push(shaft.geometry);
        const head = new THREE.Mesh(
          new THREE.CylinderGeometry(hazard.radius * 0.85, hazard.radius * 0.85, 0.005, 8),
          this.hazardMats.nail,
        );
        head.position.set(hazard.x, y + 0.018, hazard.z);
        group.add(head);
        this.intactDisposables.push(head.geometry);
      } else {
        const stone = new THREE.Mesh(
          new THREE.DodecahedronGeometry(hazard.radius * 1.25, 0),
          this.hazardMats.stone,
        );
        stone.position.set(hazard.x, y + 0.002, hazard.z);
        stone.rotation.set(0.4, hazard.seed % 6, 0.2);
        stone.scale.set(1.2, 0.5, 1);
        group.add(stone);
        this.intactDisposables.push(stone.geometry);
      }
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.radius * 0.34, this.radius * 0.37, 28),
      new THREE.MeshBasicMaterial({
        color: 0xe8ddc0,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = this.height / 2 + 0.004;
    group.add(ring);
    this.intactDisposables.push(ring.geometry, ring.material);

    // Forked rounds show two dark piths joined by a healed fork seam. The
    // gameplay centring check uses the same two points.
    if (this.log.twinPith) {
      const pithMaterial = new THREE.MeshBasicMaterial({
        color: 0x5a351b,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const pithRingMaterial = new THREE.MeshBasicMaterial({
        color: 0xe3b978,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this.intactDisposables.push(pithMaterial, pithRingMaterial);
      const seamPoints = [];
      for (const pith of this.piths) {
        const dot = new THREE.Mesh(new THREE.CircleGeometry(this.radius * 0.065, 12), pithMaterial);
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(pith.x, this.height / 2 + 0.008, pith.z);
        group.add(dot);
        this.intactDisposables.push(dot.geometry);
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(this.radius * 0.085, this.radius * 0.12, 18),
          pithRingMaterial,
        );
        halo.rotation.x = -Math.PI / 2;
        halo.position.set(pith.x, this.height / 2 + 0.009, pith.z);
        group.add(halo);
        this.intactDisposables.push(halo.geometry);
        seamPoints.push(
          new THREE.Vector3(pith.x, this.height / 2 + 0.01, pith.z),
        );
      }
      const seamGeo = new THREE.BufferGeometry().setFromPoints(seamPoints);
      const seam = new THREE.Line(seamGeo, new THREE.LineBasicMaterial({
        color: 0xd6ac6d,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }));
      group.add(seam);
      this.intactDisposables.push(seamGeo, seam.material);
    }

    // Boss weak seam: a glowing heartwood band that moves after each bite.
    this.weakMarker = null;
    this.weakMaterials = [];
    const mechanic = this.bossMechanic;
    if (mechanic) {
      const marker = new THREE.Group();
      marker.name = 'boss-weak-seam';
      marker.position.y = 0;
      marker.rotation.y = -this.weakAngle;
      const arc = mechanic.arc || 2.2;
      const bandMat = new THREE.MeshBasicMaterial({
        color: 0xff9c33,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const edgeMat = new THREE.MeshBasicMaterial({
        color: 0xffe4ae,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.weakMaterials.push(bandMat, edgeMat);
      this.weakBandMat = bandMat;
      this.weakEdgeMat = edgeMat;
      this.intactDisposables.push(bandMat, edgeMat);
      const band = new THREE.Mesh(
        new THREE.RingGeometry(
          this.radius * mechanic.inner,
          this.radius * mechanic.outer,
          34,
          1,
          -arc / 2,
          arc,
        ),
        bandMat,
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = this.height / 2 + 0.014;
      marker.add(band);
      this.intactDisposables.push(band.geometry);
      const edgeWidth = Math.max(0.0025, this.radius * 0.018);
      for (const radius of [mechanic.inner, mechanic.outer]) {
        const edge = new THREE.Mesh(
          new THREE.RingGeometry(
            this.radius * radius - edgeWidth * 0.5,
            this.radius * radius + edgeWidth * 0.5,
            34,
            1,
            -arc / 2,
            arc,
          ),
          edgeMat,
        );
        edge.rotation.x = Math.PI / 2;
        edge.position.y = this.height / 2 + 0.016;
        marker.add(edge);
        this.intactDisposables.push(edge.geometry);
      }
      // A bright "heart" rises from the seam so the weak side reads at gameplay
      // distance even when the camera is low and the log is only ~70 px wide.
      const orbMat = new THREE.MeshBasicMaterial({
        color: 0xffc86a,
        transparent: true,
        opacity: 0.95,
        toneMapped: false,
      });
      const orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(this.radius * 0.17, 0),
        orbMat,
      );
      const orbRadius = ((mechanic.inner + mechanic.outer) / 2) * this.radius;
      orb.position.set(orbRadius, this.height / 2 + 0.19, 0);
      marker.add(orb);
      this.weakOrb = orb;
      this.weakMaterials.push(orbMat);
      this.intactDisposables.push(orb.geometry);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffa53d,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(this.radius * 0.012, this.radius * 0.024, 0.17, 6),
        beamMat,
      );
      beam.position.set(orbRadius, this.height / 2 + 0.085, 0);
      marker.add(beam);
      this.weakBeam = beam;
      this.weakMaterials.push(beamMat);
      this.intactDisposables.push(beamMat, beam.geometry);
      group.add(marker);
      this.weakMarker = marker;
      this.updateWeakVisualState();

      // Phase II's heartbeat is a real telegraphed shock: an expanding ring on
      // the end grain that jolts an active charge. It is built once and reused.
      const shockMat = new THREE.MeshBasicMaterial({
        color: 0xff8a4a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const shock = new THREE.Mesh(
        new THREE.RingGeometry(this.radius * 0.14, this.radius * 0.32, 36),
        shockMat,
      );
      shock.rotation.x = -Math.PI / 2;
      shock.position.y = this.height / 2 + 0.034;
      shock.visible = false;
      shock.renderOrder = 4;
      group.add(shock);
      this.intactDisposables.push(shock.geometry, shockMat);
      this.shockRing = shock;
    }

    this.addWeatherSurface(group);

    group.traverse((o) => {
      if (o.isMesh) {
        o.receiveShadow = true;
        if (!o.castShadow) o.castShadow = true;
      }
    });
    if (this.weakMarker) {
      this.weakMarker.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          o.renderOrder = 4;
        }
      });
    }
    // Weather decals are thin overlays: keep them out of the shadow pass.
    for (const overlay of [
      this.weatherSurface?.cap,
      this.weatherSurface?.rim,
      this.weatherSurface?.frost,
      this.weatherSurface?.drips,
    ]) {
      if (overlay) {
        overlay.castShadow = false;
        overlay.receiveShadow = false;
      }
    }
    this.intactGroup = group;
    this.scene.add(group);
    this.createIntactBody();
  }

  /**
   * Weather you can see on the wood itself: a snow cap and frost veins when
   * frozen, a wet rim sheen and dark drip streaks in rain. Two draws each.
   */
  addWeatherSurface(group) {
    const mods = this.weather;
    this.weatherSurface = null;
    if (!mods) return;
    const y = this.height / 2;
    if (mods.frozen || this.snowLoad > 0.05) {
      const snowMat = new THREE.MeshBasicMaterial({
        color: 0xe9f4fb,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const cap = new THREE.Mesh(
        new THREE.RingGeometry(this.radius * 0.54, this.radius * 0.995, 30),
        snowMat,
      );
      cap.rotation.x = -Math.PI / 2;
      cap.position.y = y + 0.012;
      cap.renderOrder = 2;
      group.add(cap);
      this.intactDisposables.push(cap.geometry, snowMat);

      const frostMat = new THREE.LineBasicMaterial({
        color: 0xd7ecf7,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        toneMapped: false,
      });
      const random = mulberry32((this.log.seed || 1) + 707);
      const positions = [];
      for (let i = 0; i < 12; i++) {
        const a = random() * TAU;
        const r0 = this.radius * (0.14 + random() * 0.42);
        const r1 = Math.min(this.radius * 0.97, r0 + this.radius * (0.16 + random() * 0.34));
        const bend = (random() - 0.5) * 0.22;
        const x0 = Math.cos(a) * r0;
        const z0 = Math.sin(a) * r0;
        const x1 = Math.cos(a + bend) * r1;
        const z1 = Math.sin(a + bend) * r1;
        positions.push(x0, y + 0.017, z0, x1, y + 0.017, z1);
        if (random() > 0.4) {
          const mid = 0.55;
          const bx = x0 + (x1 - x0) * mid;
          const bz = z0 + (z1 - z0) * mid;
          const ba = a + bend + (random() > 0.5 ? 0.5 : -0.5);
          positions.push(
            bx, y + 0.017, bz,
            bx + Math.cos(ba) * this.radius * 0.09,
            y + 0.017,
            bz + Math.sin(ba) * this.radius * 0.09,
          );
        }
      }
      const frostGeo = new THREE.BufferGeometry();
      frostGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const frost = new THREE.LineSegments(frostGeo, frostMat);
      frost.renderOrder = 3;
      group.add(frost);
      this.intactDisposables.push(frostGeo, frostMat);

      // Snow does not stop at the end grain: a packed skirt rides the top of
      // the bark, and a cool melt ring darkens as the cap thaws.
      const skirtGeo = new THREE.CylinderGeometry(
        this.radius * 1.006,
        this.radius * 1.026,
        this.height * 0.15,
        this.quality?.grass > 3000 ? 30 : 20,
        1,
        true,
      );
      const skirt = new THREE.Mesh(skirtGeo, snowMat);
      skirt.position.y = this.height * 0.34;
      skirt.renderOrder = 2;
      group.add(skirt);
      this.intactDisposables.push(skirtGeo);

      const meltMat = new THREE.MeshBasicMaterial({
        color: 0x83b8cc,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const melt = new THREE.Mesh(
        new THREE.RingGeometry(this.radius * 0.3, this.radius * 0.92, 24),
        meltMat,
      );
      melt.rotation.x = -Math.PI / 2;
      melt.position.y = y + 0.02;
      melt.renderOrder = 3;
      melt.visible = false;
      group.add(melt);
      this.intactDisposables.push(melt.geometry, meltMat);

      this.weatherSurface = { type: 'snow', cap, frost, skirt, melt };
      return;
    }
    if ((mods.wetness || 0) > 0.2 || this.wetness > 0.05) {
      const sheenMat = new THREE.MeshBasicMaterial({
        color: 0xb7d8e8,
        transparent: true,
        opacity: 0.16 + Math.min(1, Math.max(mods.wetness || 0, this.wetness)) * 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(this.radius * 0.7, this.radius * 1.0, 30),
        sheenMat,
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = y + 0.01;
      rim.renderOrder = 2;
      group.add(rim);
      this.intactDisposables.push(rim.geometry, sheenMat);

      const dripMat = new THREE.LineBasicMaterial({
        color: 0x9dc2d5,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        toneMapped: false,
      });
      const random = mulberry32((this.log.seed || 1) + 811);
      const positions = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + random() * 0.3;
        const length = 0.05 + random() * 0.2;
        const r = this.radius * 1.004;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        positions.push(x, y - 0.01, z, x, y - 0.01 - length, z);
      }
      const dripGeo = new THREE.BufferGeometry();
      dripGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const drips = new THREE.LineSegments(dripGeo, dripMat);
      group.add(drips);
      this.intactDisposables.push(dripGeo, dripMat);
      this.weatherSurface = { type: 'wet', rim, drips };
    }
  }

  /** Visible split checks that accumulate across multi-strike rounds. */
  addCrack(aimX = 0, aimZ = 0) {
    if (!this.intactGroup) return;
    const angle = Math.atan2(aimZ, aimX) + (this.strikesDone - 1) * 0.7;
    this.lastCrackAngle = angle;
    const random = mulberry32((this.log.seed || 1) + this.strikesDone * 97 + 5);
    const y = this.height / 2 + 0.008;
    const segments = [];
    let r = this.radius * 0.06;
    let a = angle;
    for (let i = 0; i < 6; i++) {
      const nextR = Math.min(this.radius * 0.96, r + this.radius * (0.1 + random() * 0.09));
      const nextA = a + (random() - 0.5) * 0.2;
      segments.push(
        Math.cos(a) * r, y + i * 0.0006, Math.sin(a) * r,
        Math.cos(nextA) * nextR, y + (i + 1) * 0.0006, Math.sin(nextA) * nextR,
      );
      r = nextR;
      a = nextA;
    }
    // A second short branch makes the check look fractured rather than drawn.
    const branchAngle = angle + Math.PI * (0.7 + random() * 0.5);
    let br = this.radius * (0.2 + random() * 0.2);
    for (let i = 0; i < 3; i++) {
      const nextR = Math.min(this.radius * 0.9, br + this.radius * 0.1);
      const nextA = branchAngle + (random() - 0.5) * 0.16;
      segments.push(
        Math.cos(branchAngle) * br, y, Math.sin(branchAngle) * br,
        Math.cos(nextA) * nextR, y + 0.0007, Math.sin(nextA) * nextR,
      );
      br = nextR;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    const line = new THREE.LineSegments(geo, this.crackMat);
    line.renderOrder = 2;
    this.intactGroup.add(line);
    this.intactDisposables.push(geo);
    this.crackLines += 1;
    this.updateKerf();
  }

  /** Rotten heart collapse: a dark cloud, splinter shower, and heavy thud. */
  hollowBurst(origin) {
    const qualityScale = this.quality?.dustScale ?? 1;
    const frozen = Boolean(this.weather?.frozen);
    this.dust.push(
      new DustBurst(
        this.scene,
        origin,
        Math.max(8, Math.round(22 * qualityScale)),
        0.9,
        frozen ? this.snowTexture : this.dustTexture,
        qualityScale * 1.15,
        frozen ? 0xbfd2dc : 0x6d4a28,
      ),
    );
    this.spawnSparks(origin, 8, 0.35);
    // The rotten core does not vanish: it breaks into heavy, dark chunks that
    // tumble into the open pocket and around the block.
    const RAPIER = this.RAPIER;
    const chunkCount = this.quality?.name === 'Low' ? 3 : 5;
    const rotMat = frozen ? this.frostMat : this.knotMat;
    const debrisGroups = 0x0004fffd;
    for (let i = 0; i < chunkCount; i++) {
      const size = this.hollowCore ? this.hollowCore.radius * (0.22 + this.random() * 0.22) : 0.03;
      const geo = new THREE.DodecahedronGeometry(size, 0);
      this.disposable.add(geo);
      const mesh = new THREE.Mesh(geo, rotMat);
      const a = this.random() * TAU;
      const r = (this.hollowCore?.radius || 0.04) * 0.5;
      const pos = new THREE.Vector3(
        origin.x + Math.cos(a) * r,
        origin.y + 0.01 + this.random() * 0.03,
        origin.z + Math.sin(a) * r,
      );
      mesh.position.copy(pos);
      mesh.rotation.set(this.random() * TAU, this.random() * TAU, this.random() * TAU);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({
            x: mesh.quaternion.x,
            y: mesh.quaternion.y,
            z: mesh.quaternion.z,
            w: mesh.quaternion.w,
          })
          .setLinearDamping(0.36)
          .setAngularDamping(0.4),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.ball(size * 0.85)
          .setDensity(220)
          .setFriction(0.9)
          .setRestitution(0.05)
          .setCollisionGroups(debrisGroups),
        body,
      );
      const mass = body.mass();
      body.applyImpulse(
        {
          x: Math.cos(a) * mass * (0.4 + this.random() * 0.9),
          y: mass * (0.7 + this.random() * 1.5),
          z: Math.sin(a) * mass * (0.4 + this.random() * 0.9),
        },
        true,
      );
      this.pieces.push({ mesh, body, kind: 'rot', mass });
    }
    // The punched-out heart itself is a larger piece. It is ejected from the
    // cavity as a real Rapier body, so the collapse leaves something to watch
    // tumble across the block instead of a purely painted hole.
    if (this.hollowCore) {
      const plugRadius = this.hollowCore.radius * 0.82;
      const plugGeo = new THREE.CylinderGeometry(plugRadius * 0.9, plugRadius * 1.12, 0.1, 12, 1);
      this.disposable.add(plugGeo);
      const plugMat = this.materialCache.get(this.log.id + ':cut') || this.splinterMat;
      const plug = new THREE.Mesh(plugGeo, plugMat);
      const px = this.hollowCore.x;
      const pz = -0.95 + this.hollowCore.z;
      const py = this.topY - Math.max(0.03, this.hollowDepth * 0.35);
      plug.position.set(px, py, pz);
      plug.rotation.set(0.3, this.random() * TAU, 0.18);
      plug.castShadow = true;
      plug.receiveShadow = true;
      this.scene.add(plug);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(px, py, pz)
          .setRotation({
            x: plug.quaternion.x,
            y: plug.quaternion.y,
            z: plug.quaternion.z,
            w: plug.quaternion.w,
          })
          .setLinearDamping(0.2)
          .setAngularDamping(0.3),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.05, plugRadius)
          .setDensity(260)
          .setFriction(0.8)
          .setRestitution(0.08)
          .setCollisionGroups(debrisGroups),
        body,
      );
      const mass = body.mass();
      body.applyImpulse(
        { x: mass * 0.9, y: mass * 3.4, z: mass * 1.6 },
        true,
      );
      this.pieces.push({ mesh: plug, body, kind: 'offcut', mass });
    }
    this.fragmentCount = this.pieces.length + this.chips.length;
  }

  /** Small dust + spark puff for a non-lethal bite. */
  biteBurst(origin, power = 0.6) {
    const qualityScale = this.quality?.dustScale ?? 1;
    this.dust.push(
      new DustBurst(
        this.scene,
        origin,
        Math.max(3, Math.round(7 * qualityScale)),
        0.35 + power * 0.25,
        this.dustTexture,
        qualityScale,
      ),
    );
    this.spawnSparks(origin, 5, 0.5);
  }

  createIntactBody() {
    const RAPIER = this.RAPIER;
    const y = this.baseY + this.height / 2;
    this.intactBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, y, -0.95)
        .setGravityScale(0)
        .lockTranslations()
        .lockRotations(),
    );
    this.intactCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(this.height / 2, this.radius)
        .setFriction(0.9)
        .setRestitution(0.02)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.intactBody,
    );
    this.intactColliderHandle = this.intactCollider.handle;
  }

  getIntactColliderHandle() {
    return this.intactCollider ? this.intactCollider.handle : -1;
  }

  getLogMetrics() {
    return {
      x: 0,
      z: -0.95,
      radius: this.radius,
      height: this.height,
      baseY: this.baseY,
      topY: this.baseY + this.height,
      centerY: this.baseY + this.height / 2,
    };
  }

  planSplit({
    energy = 0.8,
    center = 0.8,
    grain = 0.7,
    power = 0.75,
    knotHit = false,
    knotPrecise = false,
    weakHit = false,
  } = {}) {
    const mods = this.weather || { split: 1, splinter: 0, friction: 1, frozen: false };
    const toughness = this.log.toughness || 0.6;
    const effective = (energy * (0.72 + center * 0.28) * (0.7 + grain * 0.3)) / toughness;
    // Striking the exposed boss seam is an intentional off-pith target, so it
    // must not be treated like a wild rim hit.
    const glancing =
      center < (weakHit ? 0.12 : 0.3) ||
      effective < 0.62 ||
      (knotHit && !knotPrecise && effective < 1.05 && !weakHit);
    const maxPieces = this.log.huge ? 5 : 4;
    let mainPieces = this.log.huge ? 3 : 2;
    if (effective >= 0.98) mainPieces = this.log.huge ? 4 : 3;
    if (effective >= 1.32 && grain >= 0.48) mainPieces = maxPieces;
    if (knotHit && knotPrecise) mainPieces = Math.min(maxPieces, mainPieces + 1);
    if (glancing) mainPieces = this.log.huge ? 3 : 2;
    if (mods.frozen && effective > 1.2) mainPieces = Math.min(maxPieces, mainPieces + 1);
    const splinterBase =
      2 +
      Math.round(effective * 2.6) +
      Math.round((mods.splinter || 0) * 5) +
      (glancing ? 2 : 0) +
      (this.log.knots || 0) +
      (this.log.huge ? 2 : 0);
    const splinterCount = THREE.MathUtils.clamp(splinterBase, 2, this.quality?.name === 'Low' ? 8 : 14);
    return {
      glancing,
      mainPieces: THREE.MathUtils.clamp(mainPieces, 2, maxPieces),
      splinterCount,
      effective: Number(effective.toFixed(3)),
      penetration: Number((0.016 + effective * 0.035).toFixed(3)),
      energy: Number(energy.toFixed(3)),
      power,
      knotHit,
      knotPrecise,
    };
  }

  /**
   * Break the log into 2-4 grain-aligned rounds and a handful of splinters.
   */
  fracture({
    impactPoint = null,
    direction = new THREE.Vector3(0, -1, -0.4),
    speed = 10,
    plan = null,
    aim = null,
    weather = null,
  } = {}) {
    if (this.active) return null;
    this.active = true;
    const mods = weather || this.weather || { split: 1, friction: 1, frozen: false, splinter: 0 };
    const planData =
      plan ||
      this.planSplit({
        energy: THREE.MathUtils.clamp(speed / 12, 0.5, 2.2),
        center: 0.8,
        grain: 0.7,
        power: 0.75,
      });
    const maxPieces = this.log.huge ? 5 : 4;
    // A grain lock produces two clean, unmistakable half-rounds. The split
    // geometry actually follows the golden check instead of snapping to a fan.
    const grainLock = Boolean(planData.grainLock) && !this.log.huge;
    const mainPieces = grainLock
      ? 2
      : THREE.MathUtils.clamp(Math.round(planData.mainPieces), 2, maxPieces);
    const splinterCount = THREE.MathUtils.clamp(
      Math.round(planData.splinterCount),
      2,
      this.quality?.name === 'Low' ? 8 : 14,
    );
    const debrisGroups = 0x0004fffd;
    const center = this.logCenter.clone();
    const hit = impactPoint
      ? impactPoint.clone()
      : new THREE.Vector3(0, this.topY - 0.02, -0.95);
    const chopDir = direction.clone().normalize();
    const RAPIER = this.RAPIER;
    const mats = this.materials();

    if (this.intactGroup) this.intactGroup.visible = false;
    this.intactCollider = null;
    if (this.intactBody) {
      this.world.removeRigidBody(this.intactBody);
      this.intactBody = null;
    }

    const aimAngle = aim ? Math.atan2(aim.z, aim.x) : Math.atan2(hit.z + 0.95, hit.x);
    const primary = Number.isFinite(planData.rivingAngle)
      ? planData.rivingAngle
      : this.nearestSeamAngle(aim?.x ?? 0, aim?.z ?? 0);
    const boundaryJitter = mulberry32((this.log.seed || 1) + 99);
    const boundaries = [];
    if (mainPieces === 2) {
      boundaries.push(primary);
      boundaries.push(primary + Math.PI);
    } else {
      // 3, 4, or 5-6 wedges. Twisted wood keeps the natural-check lead boundary
      // but the rest of the fan is jittered so the split looks torn, not sawn.
      const step = TAU / mainPieces;
      for (let i = 0; i < mainPieces; i++) {
        boundaries.push(primary + step * i + (i === 0 ? 0 : (boundaryJitter() - 0.5) * 0.2));
      }
    }
    boundaries.push(boundaries[0] + TAU);

    const energyScale = THREE.MathUtils.clamp(planData.energy ?? planData.effective ?? 0.8, 0.2, 2.4);
    const spring = 0.42 + energyScale * 0.56;
    const segs = this.quality?.name === 'Low' ? 3 : 5;

    for (let i = 0; i < mainPieces; i++) {
      const def = createWedge(
        boundaries[i],
        boundaries[i + 1],
        this.radius,
        this.height,
        segs,
        (this.log.seed || 1) + i * 31,
      );
      this.disposable.add(def.geometry);
      const mesh = new THREE.Mesh(def.geometry, [mats.cut, mats.bark]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const origin = center.clone().add(def.centroid);
      mesh.position.copy(origin);
      this.scene.add(mesh);

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(origin.x, origin.y, origin.z)
          .setLinearDamping(mods.frozen ? 0.12 : 0.24)
          .setAngularDamping(mods.frozen ? 0.2 : 0.38)
          .setCcdEnabled(true),
      );
      let colliderDesc = RAPIER.ColliderDesc.convexHull(def.hullPoints);
      if (!colliderDesc) {
        colliderDesc = RAPIER.ColliderDesc.cuboid(
          def.fallbackHalf.x,
          def.fallbackHalf.y,
          def.fallbackHalf.z,
        );
      }
      const friction = THREE.MathUtils.clamp(0.8 * (mods.friction || 1), 0.35, 0.95);
      colliderDesc
        .setDensity(this.log.density || 600)
        .setFriction(friction)
        .setRestitution(mods.frozen ? 0.1 : 0.04)
        .setCollisionGroups(debrisGroups)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.world.createCollider(colliderDesc, body);

      const radial = new THREE.Vector3(def.centroid.x, 0, def.centroid.z);
      if (radial.lengthSq() < 0.00001) radial.set(Math.cos(aimAngle), 0, Math.sin(aimAngle));
      radial.normalize();
      radial.applyAxisAngle(UP, (this.random() - 0.5) * 0.22);
      const mass = body.mass();
      const impulse = new THREE.Vector3()
        .addScaledVector(radial, mass * spring * (0.55 + this.random() * 0.5))
        .addScaledVector(chopDir, mass * spring * 0.38)
        .add(new THREE.Vector3(0, mass * (0.22 + spring * 0.42 + this.random() * 0.18), 0));
      if (mods.frozen) {
        impulse.multiplyScalar(1.06);
      } else if ((mods.friction || 1) < 0.8) {
        impulse.z += mass * 0.2;
      }
      body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      body.setAngvel(
        {
          x: (this.random() - 0.5) * (1.2 + spring * 2.4),
          y: (this.random() - 0.5) * 1.6,
          z: (this.random() - 0.5) * (1.2 + spring * 2.4),
        },
        true,
      );
      this.pieces.push({ mesh, body, kind: 'wedge', mass });
    }

    // Splinters: fewer, longer and more believable than the v1 chip shower.
    const chipMats = [mats.cut, mats.bark, this.splinterMat];
    if (mods.frozen) chipMats.push(this.frostMat);
    for (let i = 0; i < splinterCount; i++) {
      const geo = this.chipGeometries[(this.random() * this.chipGeometries.length) | 0];
      const mat = chipMats[(this.random() * chipMats.length) | 0];
      const mesh = new THREE.Mesh(geo, mat);
      const a = aimAngle + (this.random() - 0.5) * 2.2;
      const radius = this.random() * this.radius * 0.85;
      const pos = new THREE.Vector3(
        hit.x + Math.cos(a) * radius,
        hit.y + 0.02 + this.random() * 0.1,
        hit.z + Math.sin(a) * radius,
      );
      mesh.position.copy(pos);
      mesh.rotation.set(this.random() * TAU, this.random() * TAU, this.random() * TAU);
      mesh.scale.setScalar(0.65 + this.random() * 1.0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({
            x: mesh.quaternion.x,
            y: mesh.quaternion.y,
            z: mesh.quaternion.z,
            w: mesh.quaternion.w,
          })
          .setLinearDamping(mods.frozen ? 0.16 : 0.32)
          .setAngularDamping(0.22),
      );
      const half = 0.018 + this.random() * 0.018;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(half, 0.008, half * 1.8)
          .setDensity((this.log.density || 600) * 0.8)
          .setFriction(THREE.MathUtils.clamp(0.72 * (mods.friction || 1), 0.3, 0.95))
          .setRestitution(mods.frozen ? 0.18 : 0.1)
          .setCollisionGroups(debrisGroups),
        body,
      );
      const speedScale = (1.2 + energyScale * 2.3) * (mods.frozen ? 1.22 : 1);
      const outward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.55 + this.random() * 0.8);
      const v = new THREE.Vector3()
        .addScaledVector(outward, speedScale)
        .addScaledVector(chopDir, (0.5 + this.random() * 1.2) * (mods.frozen ? 1.2 : 1))
        .add(
          new THREE.Vector3(
            (this.random() - 0.5) * 1.2,
            (0.8 + this.random() * 2.4) * (mods.frozen ? 1.15 : 1),
            0.2 + this.random() * 1.1,
          ),
        );
      body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      body.setAngvel(
        {
          x: (this.random() - 0.5) * 28,
          y: (this.random() - 0.5) * 28,
          z: (this.random() - 0.5) * 28,
        },
        true,
      );
      this.chips.push({ mesh, body, kind: 'splinter', mass: body.mass() });
    }

    const qualityScale = this.quality?.dustScale ?? 1;
    const dustCount = Math.max(
      6,
      Math.round((20 + energyScale * 20) * qualityScale),
    );
    const cloudTexture = mods.frozen ? this.snowTexture : this.dustTexture;
    this.dust.push(new DustBurst(this.scene, hit, dustCount, 0.5 + energyScale * 0.3, cloudTexture, qualityScale));
    this.dust.push(
      new DustBurst(
        this.scene,
        new THREE.Vector3(0, this.baseY + 0.035, -0.95),
        Math.max(4, Math.round(dustCount * 0.45)),
        0.4,
        this.dustTexture,
        qualityScale,
      ),
    );
    if (planData.glancing || planData.knotHit) {
      this.spawnSparks(
        new THREE.Vector3(hit.x, hit.y - 0.02, hit.z),
        planData.glancing ? 14 : 20,
        planData.glancing ? 0.8 : 1.1,
      );
    }

    this.mainPieces = mainPieces;
    this.splinterCount = splinterCount;
    this.fragmentCount = this.pieces.length + this.chips.length;
    return {
      count: this.fragmentCount,
      mainPieces: this.pieces.length,
      splinterCount: this.chips.length,
      impactPoint: hit,
      speed,
      plan: planData,
      grainLock,
    };
  }

  spawnSparks(origin, count = 16, power = 1) {
    this.sparks.push(new SparkBurst(this.scene, origin, count, power));
  }

  setWind(vector) {
    this.wind = vector;
  }

  update(dt) {
    this.updateWeather(dt);
    if (this.masterCheckLine) {
      this.masterCheckPulse += dt;
      const pulse = 0.56 + Math.sin(this.masterCheckPulse * 2.9) * 0.2;
      this.masterCheckLine.material.opacity = this.rivingStreak > 0 ? 0.92 : pulse;
      this.masterCheckLine.material.color.setHex(
        this.rivingStreak > 0 ? 0xffe3a8 : 0xf3c47f,
      );
      if (this.masterCheckGlint) {
        this.masterCheckGlint.rotation.y += dt * 1.4;
        this.masterCheckGlint.scale.setScalar(
          (0.85 + Math.sin(this.masterCheckPulse * 3.4) * 0.15) *
            (this.rivingStreak > 0 ? 1.25 : 1),
        );
        this.masterCheckGlint.material.opacity = this.rivingStreak > 0 ? 1 : 0.86;
      }
    }
    if (this.rootNotches?.length) {
      this.rootGlintPulse = (this.rootGlintPulse || 0) + dt;
      for (const notch of this.rootNotches) {
        if (!notch.glint || notch.cut) continue;
        notch.glint.rotation.y += dt * 1.3;
        notch.glint.position.y =
          this.height / 2 + 0.075 + Math.sin(this.rootGlintPulse * 2.6 + notch.x * 17) * 0.012;
        notch.glint.scale.setScalar(
          0.9 + Math.sin(this.rootGlintPulse * 3.1 + notch.z * 13) * 0.12,
        );
      }
    }
    const wind = this.wind;
    if (this.wedgeSlots.length) {
      this.wedgePulse = (this.wedgePulse || 0) + dt;
      for (const slot of this.wedgeSlots) {
        if (!slot.glint) continue;
        slot.glint.visible = !slot.homed;
        slot.glint.rotation.y += dt * 1.1;
        slot.glint.position.y =
          slot.baseY + 0.135 + Math.sin(this.wedgePulse * 2.2 + slot.x * 9) * 0.012;
        slot.glint.material.color.setHex(slot.depth > 0.5 ? 0xffd9a0 : 0xc5e7f2);
        if (slot.ring) {
          slot.ring.material.opacity = slot.homed
            ? 0.1
            : 0.3 + (Math.sin(this.wedgePulse * 2.4 + slot.z * 7) + 1) * 0.13;
        }
      }
    }
    if (this.weakMarker) {
      this.weakPulse += dt;
      const pulse = 0.5 + Math.sin(this.weakPulse * 4.2) * 0.18;
      const open = this.seamOpen;
      for (let i = 0; i < this.weakMaterials.length; i++) {
        const opacity = !open
          ? i === 0
            ? 0.22 + pulse * 0.1
            : 0.24
          : i === 0
            ? 0.42 + pulse * 0.35
            : i === 1
              ? 0.62 + pulse * 0.45
              : i === 2
                ? 0.75 + pulse * 0.25
                : 0.28 + pulse * 0.22;
        this.weakMaterials[i].opacity = opacity;
      }
      if (this.weakOrb && open) {
        const scale =
          1 + Math.sin(this.weakPulse * 4.2) * 0.14 + (this.bossPhase >= 2 ? 0.12 : 0);
        this.weakOrb.scale.setScalar(scale);
      }
      // Phase two: the heartwood seam slowly walks around the rings, turning a
      // static aim target into a timing read. Frost makes it wander faster;
      // wet heartwood drifts a little slower.
      if (this.bossPhase >= 2 && open && !this.active) {
        const drift = this.weather?.frozen
          ? 0.86
          : (this.weather?.wetness || 0) > 0.2
            ? 0.42
            : 0.52;
        this.weakAngle = (this.weakAngle + dt * drift) % TAU;
        this.weakMarker.rotation.y = -this.weakAngle;
        this.bossPhaseFlash = Math.max(0, this.bossPhaseFlash - dt);
        // A heartbeat every few seconds is a telegraphed shock ring, not just
        // decoration: a charge held through the pulse is torn away.
        this.heartPulse = (this.heartPulse || 0) + dt;
        if (this.heartPulse >= 3.4) {
          this.heartPulse = 0;
          this.triggerShock();
        }
      }
    }
    if (this.shock > 0) {
      this.shock = Math.max(0, this.shock - dt / 0.82);
      if (this.shockRing) {
        const t = 1 - this.shock;
        this.shockRing.visible = this.shock > 0.01;
        this.shockRing.scale.setScalar(0.55 + t * 1.35);
        this.shockRing.rotation.z += dt * 0.85;
        this.shockRing.material.opacity = this.shock * 0.8;
      }
    } else if (this.shockRing) {
      this.shockRing.visible = false;
    }
    if (this.hollowOverlay?.visible) {
      this.hollowPulse = (this.hollowPulse || 0) + dt * 0.25;
      if (this.hollowGlowMat) {
        this.hollowGlowMat.opacity = 0.22 + (Math.sin(this.hollowPulse * 2.1) + 1) * 0.06;
      }
      if (this.hollowWisp) {
        this.hollowWisp.rotation.y += dt * 0.7;
      }
    }
    for (const item of [...this.pieces, ...this.chips]) {
      if (!item.body) continue;
      if (wind && !item.body.isSleeping()) {
        const factor = item.kind === 'splinter' ? 0.09 : 0.025;
        item.body.addForce(
          {
            x: wind.x * factor * Math.max(0.2, item.mass || 0.5),
            y: 0,
            z: wind.z * factor * Math.max(0.2, item.mass || 0.5),
          },
          true,
        );
      }
      const p = item.body.translation();
      const r = item.body.rotation();
      item.mesh.position.set(p.x, p.y, p.z);
      item.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (let i = this.dust.length - 1; i >= 0; i--) {
      if (!this.dust[i].update(dt)) this.dust.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      if (!this.sparks[i].update(dt)) this.sparks.splice(i, 1);
    }
  }

  disposeIntact() {
    if (this.intactBody) {
      this.world.removeRigidBody(this.intactBody);
      this.intactBody = null;
    }
    this.intactCollider = null;
    if (this.intactGroup && this.intactGroup.parent) {
      this.intactGroup.parent.remove(this.intactGroup);
    }
    for (const d of this.intactDisposables) {
      if (d && d.dispose) d.dispose();
    }
    this.intactDisposables = [];
    this.intactGroup = null;
    this.weakMarker = null;
    this.weakMaterials = [];
    this.weakOrb = null;
    this.weakBeam = null;
    this.weakBandMat = null;
    this.weakEdgeMat = null;
    this.weatherSurface = null;
    this.wedgeMeshes = [];
    this.wedgeSlots = [];
    this.kerf = null;
    this.kerfWater = null;
    this.kerfFillType = null;
    this.hollowOverlay = null;
    this.hollowGlowMat = null;
    this.hollowWisp = null;
    this.hollowHole = null;
    this.hollowRim = null;
    this.hollowGlow = null;
    this.hollowRot = null;
    this.hollowPuddle = null;
    this.hollowCavity = null;
    this.hollowCap = null;
    this.hollowShaft = null;
    this.hollowBottom = null;
    this.hollowDepth = 0;
    this.hollowHoleRadius = 0;
    this.masterCheckLine = null;
    this.masterCheckGlint = null;
    this.shockRing = null;
  }

  clearDebris() {
    for (const item of [...this.pieces, ...this.chips]) {
      if (item.body) this.world.removeRigidBody(item.body);
      if (item.mesh.parent) item.mesh.parent.remove(item.mesh);
      item.body = null;
    }
    for (const geo of this.disposable) geo.dispose?.();
    this.disposable.clear();
    for (const burst of this.dust) burst.dispose();
    for (const burst of this.sparks) burst.dispose();
    this.pieces.length = 0;
    this.chips.length = 0;
    this.dust.length = 0;
    this.sparks.length = 0;
    this.intactDisposables = this.intactDisposables || [];
    this.fragmentCount = 0;
    this.mainPieces = 0;
    this.splinterCount = 0;
    this.active = false;
  }

  reset() {
    this.clearDebris();
    this.buildIntactLog();
  }
}

export { createWedge };
