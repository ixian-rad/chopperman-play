import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  createBarkTextures,
  createEndGrainTextures,
  createSplitWoodTextures
} from './textures.js';
import { LOG_TYPES } from './rpgState.js';

/**
 * Manages the Chopping Block, Species-Specific Logs with 3D Knots & Grain Check Lines,
 * 3D Cursor-Aimed Strike Reticle, Grain-Aligned Fracture / Split Rigid Bodies,
 * Partial Penetration Kerf Cracks, Hazard Sparks, and Wood Chip / Sawdust Particles.
 */
export class ChoppingStation {
  constructor(scene, world, physMaterials, soundEffects) {
    this.scene = scene;
    this.world = world;
    this.physMaterials = physMaterials;
    this.sound = soundEffects;

    // Chopping block coordinates (directly in front of the humanoid woodchopper)
    this.blockPosition = new THREE.Vector3(0, 0, 0.28);
    this.blockRadius = 0.35;
    this.blockHeight = 0.62;

    // Current target log dimensions & species
    this.currentSpecies = 'pine';
    this.logRadius = LOG_TYPES.pine.radius;
    this.logHeight = LOG_TYPES.pine.height;
    this.logRotationY = 0; // Player can rotate log on the block to align grain check line
    this.grainCheckAngle = 0; // Relative to log local Y rotation (0 = aligned with Z cut plane)
    this.knotAngles = [];
    this.nailAngles = [];
    this.rockAngles = [];
    this.forkLimbMeshes = [];
    this.burlOutgrowthMeshes = [];
    this.rootFlareMeshes = [];
    this.dynamicBlockScars = [];
    this.plantedWedge = null;
    this.plantedWedges = [];
    this.tandemCrackBridge = null;
    this.isLogFlipped = false;
    this.isPeaveySeated = false;
    this.collarActive = false;
    this.hasShatteredKindling = false;
    this.spiralTwist = 0;

    // Aim state (controlled by mouse cursor / keyboard)
    this.aimOffsetX = 0; // -0.16 to +0.16 m from log center
    this.aimAngle = 0; // Strike angle offset

    // Material cache per wood species
    this.speciesMaterials = {};
    const defaultMats = this._getMaterialsForSpecies('oak');
    this.barkMaterial = defaultMats.barkMaterial;
    this.endGrainMaterial = defaultMats.endGrainMaterial;
    this.splitWoodMaterial = defaultMats.splitWoodMaterial;

    // State tracking
    this.intactLog = null; // { mesh, body, kerfGroup }
    this.isLogSplit = false;
    this.splitPieces = []; // Array of { mesh, body, isSplinter }
    this.particles = []; // Flying wood chips, sawdust & incandescent hazard sparks
    this.lastImpactSpeed = 0;
    this.sparkLightTimer = 0;

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'ChoppingStationGroup';
    this.scene.add(this.rootGroup);

    this._buildChoppingBlock();
    this._buildAimReticle();
    this._buildChipParticlePool();
    this.spawnFreshLog('pine');
  }

  _getMaterialsForSpecies(species = 'oak') {
    if (this.speciesMaterials[species]) {
      return this.speciesMaterials[species];
    }
    const barkTex = createBarkTextures(species);
    const endGrainTex = createEndGrainTextures(species);
    const splitWoodTex = createSplitWoodTextures(species);

    const barkMaterial = new THREE.MeshStandardMaterial({
      map: barkTex.map,
      bumpMap: barkTex.bumpMap,
      bumpScale: 0.035,
      roughnessMap: barkTex.roughnessMap,
      roughness: 0.88,
      metalness: 0.0
    });

    const endGrainMaterial = new THREE.MeshStandardMaterial({
      map: endGrainTex.map,
      bumpMap: endGrainTex.bumpMap,
      bumpScale: 0.02,
      roughness: 0.78,
      metalness: 0.0
    });

    const splitWoodMaterial = new THREE.MeshStandardMaterial({
      map: splitWoodTex.map,
      bumpMap: splitWoodTex.bumpMap,
      bumpScale: 0.028,
      roughness: 0.74,
      metalness: 0.0
    });

    const bundle = { barkMaterial, endGrainMaterial, splitWoodMaterial };
    this.speciesMaterials[species] = bundle;
    return bundle;
  }

  /**
   * Builds the heavy weathered oak chopping block stump with root flare,
   * forged iron reinforcement band, metal log-dog cleats (spark hazards), and chop scars.
   */
  _buildChoppingBlock() {
    const stumpGroup = new THREE.Group();
    stumpGroup.position.copy(this.blockPosition);

    const stumpGeo = new THREE.CylinderGeometry(
      this.blockRadius,
      this.blockRadius * 1.12,
      this.blockHeight,
      28
    );
    const stumpMats = [this.barkMaterial, this.endGrainMaterial, this.endGrainMaterial];
    const stumpMesh = new THREE.Mesh(stumpGeo, stumpMats);
    stumpMesh.position.y = this.blockHeight / 2;
    stumpMesh.castShadow = true;
    stumpMesh.receiveShadow = true;
    stumpGroup.add(stumpMesh);
    this.stumpTopMesh = stumpMesh;

    // Forged iron reinforcement band + iron hazard cleats near top of chopping block
    const bandGeo = new THREE.CylinderGeometry(
      this.blockRadius + 0.008,
      this.blockRadius + 0.01,
      0.048,
      28,
      1,
      true
    );
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x2c2f33,
      roughness: 0.42,
      metalness: 0.85,
      side: THREE.DoubleSide
    });
    const bandMesh = new THREE.Mesh(bandGeo, bandMat);
    bandMesh.position.y = this.blockHeight - 0.07;
    bandMesh.castShadow = true;
    stumpGroup.add(bandMesh);

    // Left & right iron log-dog hazard brackets on outer rim of block
    [-1, 1].forEach((side) => {
      const cleat = new THREE.Mesh(
        new THREE.BoxGeometry(0.032, 0.045, 0.06),
        bandMat
      );
      cleat.position.set(side * (this.blockRadius - 0.02), this.blockHeight + 0.006, 0);
      cleat.castShadow = true;
      stumpGroup.add(cleat);
    });

    // Unlockable 3D Chopping Block Rubber Tire & Bungee-Chain Collar (holds split rounds for Kindling Quarter-Chops!)
    this.blockCollarGroup = new THREE.Group();
    this.blockCollarGroup.name = 'ChoppingBlockTireAndChainCollar';
    this.blockCollarGroup.visible = false;

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x1c1f24,
      roughness: 0.86,
      metalness: 0.08
    });
    const chainMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.3,
      metalness: 0.88
    });
    const claspMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.35,
      metalness: 0.65
    });

    const tireRing = new THREE.Mesh(
      new THREE.TorusGeometry(this.blockRadius * 0.72, 0.038, 12, 28),
      tireMat
    );
    tireRing.rotation.x = Math.PI / 2;
    tireRing.position.y = this.blockHeight + 0.038;
    tireRing.castShadow = true;
    this.blockCollarGroup.add(tireRing);

    // 12 Steel chain links & orange bungee tensioner wrapping the tire collar
    for (let c = 0; c < 12; c++) {
      const ca = (c / 12) * Math.PI * 2;
      const link = new THREE.Mesh(
        new THREE.TorusGeometry(0.022, 0.006, 6, 10),
        c === 0 ? claspMat : chainMat
      );
      link.position.set(
        Math.cos(ca) * (this.blockRadius * 0.78),
        this.blockHeight + 0.042,
        Math.sin(ca) * (this.blockRadius * 0.78)
      );
      link.rotation.y = -ca;
      if (c % 2 === 0) link.rotation.x = Math.PI / 3;
      this.blockCollarGroup.add(link);
    }
    stumpGroup.add(this.blockCollarGroup);

    // Subtle axe kerf scar marks across the top surface of the chopping block
    const kerfMat = new THREE.MeshStandardMaterial({
      color: 0x4a3119,
      roughness: 0.95
    });
    for (let i = 0; i < 9; i++) {
      const kerf = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.006, 0.18 + (i % 3) * 0.08),
        kerfMat
      );
      kerf.position.set(
        ((i % 4) - 1.5) * 0.055,
        this.blockHeight + 0.002,
        ((i % 3) - 1) * 0.04
      );
      kerf.rotation.y = (i - 4) * 0.14;
      stumpGroup.add(kerf);
    }

    // Group to accumulate persistent 3D axe overstrike scars & anvil splinters across the session
    this.dynamicScarsGroup = new THREE.Group();
    this.dynamicScarsGroup.name = 'DynamicBlockOverstrikeScars';
    stumpGroup.add(this.dynamicScarsGroup);

    // 3D Forged-Steel Cant-Hook / Peavey Log Lever resting against the chopping block (engages on [P])
    this.peaveyToolGroup = new THREE.Group();
    this.peaveyToolGroup.name = 'ForgedSteelCantHookPeavey';
    const peaveyAshMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.58
    });
    const peaveySteelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.32,
      metalness: 0.88
    });
    const peaveyShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.92, 10),
      peaveyAshMat
    );
    peaveyShaft.position.y = 0.46;
    peaveyShaft.castShadow = true;
    this.peaveyToolGroup.add(peaveyShaft);

    const peaveySpike = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.14, 8),
      peaveySteelMat
    );
    peaveySpike.position.y = -0.05;
    peaveySpike.rotation.x = Math.PI;
    this.peaveyToolGroup.add(peaveySpike);

    const cantHookClaw = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.011, 6, 12, Math.PI * 1.15),
      peaveySteelMat
    );
    cantHookClaw.position.set(-0.055, 0.22, 0);
    cantHookClaw.rotation.z = 0.45;
    cantHookClaw.castShadow = true;
    this.peaveyToolGroup.add(cantHookClaw);

    this.peaveyToolGroup.position.set(this.blockRadius + 0.11, 0.08, -0.05);
    this.peaveyToolGroup.rotation.set(0.12, 0.25, -0.36);
    stumpGroup.add(this.peaveyToolGroup);

    // 5 Root buttresses flaring into the soil
    for (let r = 0; r < 5; r++) {
      const angle = (r / 5) * Math.PI * 2 + 0.3;
      const rootGeo = new THREE.ConeGeometry(0.11, 0.36, 7);
      const rootMesh = new THREE.Mesh(rootGeo, this.barkMaterial);
      rootMesh.position.set(
        Math.cos(angle) * (this.blockRadius * 0.96),
        0.14,
        Math.sin(angle) * (this.blockRadius * 0.96)
      );
      rootMesh.rotation.z = -Math.cos(angle) * 0.58;
      rootMesh.rotation.x = Math.sin(angle) * 0.58;
      rootMesh.castShadow = true;
      rootMesh.receiveShadow = true;
      stumpGroup.add(rootMesh);
    }

    // Ambient resting wood chips around the base of the chopping block
    for (let c = 0; c < 24; c++) {
      const a = (c * 1.71) % (Math.PI * 2);
      const d = 0.44 + ((c * 0.29) % 1.15);
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.012, 0.025),
        c % 3 === 0 ? this.barkMaterial : this.splitWoodMaterial
      );
      chip.position.set(Math.cos(a) * d, 0.009, Math.sin(a) * d);
      chip.rotation.set(0.08, c * 0.9, 0.05);
      chip.castShadow = true;
      chip.receiveShadow = true;
      stumpGroup.add(chip);
    }

    // Point light for incandescent hazard spark flashes
    this.sparkLight = new THREE.PointLight(0xff9922, 0, 3.2, 2.0);
    this.sparkLight.position.set(0, this.blockHeight + 0.25, 0);
    stumpGroup.add(this.sparkLight);

    this.rootGroup.add(stumpGroup);

    // Static Physics Body for the Chopping Block
    this.blockBody = new CANNON.Body({
      mass: 0,
      material: this.physMaterials.woodPhysMat
    });
    const cylShape = new CANNON.Cylinder(
      this.blockRadius,
      this.blockRadius * 1.08,
      this.blockHeight,
      16
    );
    this.blockBody.addShape(cylShape);
    this.blockBody.position.set(
      this.blockPosition.x,
      this.blockHeight / 2,
      this.blockPosition.z
    );
    this.blockBody.userData = { label: 'ChoppingBlock' };
    this.world.addBody(this.blockBody);
  }

  setBlockCollarVisible(visible) {
    this.collarActive = Boolean(visible);
    if (this.blockCollarGroup) {
      this.blockCollarGroup.visible = this.collarActive;
    }
  }

  /**
   * Carves a persistent 3D axe bit overstrike scar & raised wood-splinter lip into the oak chopping block anvil!
   */
  _recordBlockOverstrikeScar(offsetX = 0, angle = 0, force = 1.0, isGlancing = false) {
    if (!this.dynamicScarsGroup) return;

    if (this.dynamicBlockScars.length >= 28) {
      const oldest = this.dynamicBlockScars.shift();
      if (oldest) {
        this.dynamicScarsGroup.remove(oldest);
      }
    }

    const scarGroup = new THREE.Group();
    const clampedX = Math.max(-this.blockRadius * 0.82, Math.min(this.blockRadius * 0.82, offsetX));
    const scarLen = Math.min(0.28, (0.16 + force * 0.06) * (isGlancing ? 0.72 : 1.0));

    const grooveMat = new THREE.MeshStandardMaterial({
      color: isGlancing ? 0x3b2310 : 0x241307,
      roughness: 0.96
    });
    const splinterMat = new THREE.MeshStandardMaterial({
      color: 0xcfa36e,
      roughness: 0.85
    });

    const groove = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.008, scarLen),
      grooveMat
    );
    scarGroup.add(groove);

    // Raised raw wood splinter lip beside the V-groove overstrike scar
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(0.007, 0.012, scarLen * 0.65),
      splinterMat
    );
    lip.position.set(0.009, 0.004, 0);
    lip.rotation.z = -0.32;
    scarGroup.add(lip);

    scarGroup.position.set(
      clampedX,
      this.blockHeight + 0.003,
      (Math.random() - 0.5) * 0.04
    );
    scarGroup.rotation.y = angle + (Math.random() - 0.5) * 0.08;

    this.dynamicScarsGroup.add(scarGroup);
    this.dynamicBlockScars.push(scarGroup);
  }

  /**
   * Flips / inverts the intact log 180 degrees upside-down on the chopping block (`V` / Flip button).
   */
  flipLogOnBlock(isFlipped = !this.isLogFlipped) {
    this.isLogFlipped = Boolean(isFlipped);
    if (this.intactLog && this.intactLog.invertibleGroup) {
      this.intactLog.invertibleGroup.rotation.z = this.isLogFlipped ? Math.PI : 0;
      this.intactLog.body.wakeUp();
      this.intactLog.body.velocity.set(0, 1.05, 0);
      this.intactLog.body.angularVelocity.set(0, 1.8, 0);
      const chipOrigin = new THREE.Vector3(
        this.blockPosition.x,
        this.blockHeight + this.logHeight * 0.5,
        this.blockPosition.z
      );
      this._spawnWoodChipBurst(chipOrigin, 0.45, 'sun');
    }
    this._refreshAimReticleVisual();
    return this.isLogFlipped;
  }

  /**
   * Builds the 3D Cursor-Aimed Strike Reticle projected across the top of the log.
   */
  _buildAimReticle() {
    this.aimReticleGroup = new THREE.Group();
    this.aimReticleGroup.name = 'AimStrikeReticle';

    this.aimLineMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.88,
      depthTest: false
    });

    // Strike plane indicator bar across the log top
    const lineGeo = new THREE.BoxGeometry(0.007, 0.006, 0.31);
    this.aimLineMesh = new THREE.Mesh(lineGeo, this.aimLineMat);
    this.aimReticleGroup.add(this.aimLineMesh);

    // Bullseye ring at center of strike line
    const ringGeo = new THREE.RingGeometry(0.016, 0.025, 18);
    ringGeo.rotateX(-Math.PI / 2);
    this.aimRingMesh = new THREE.Mesh(ringGeo, this.aimLineMat);
    this.aimRingMesh.position.y = 0.002;
    this.aimReticleGroup.add(this.aimRingMesh);

    this.rootGroup.add(this.aimReticleGroup);
  }

  /**
   * Updates the 3D aim reticle position & color based on cursor offset, grain alignment, and knots.
   */
  setAim(offsetX, angle = 0) {
    const maxOff = this.logRadius * 1.12;
    this.aimOffsetX = Math.max(-maxOff, Math.min(maxOff, offsetX));
    this.aimAngle = Math.max(-0.55, Math.min(0.55, angle));
    this._refreshAimReticleVisual();
  }

  rotateLog(deltaRad) {
    this.logRotationY = (this.logRotationY + deltaRad) % (Math.PI * 2);
    if (this.intactLog) {
      this.intactLog.body.quaternion.setFromEuler(0, this.logRotationY, 0);
      this.intactLog.mesh.quaternion.copy(this.intactLog.body.quaternion);
    }
    if (this.sound && typeof this.sound.playLogRotate === 'function') {
      this.sound.playLogRotate();
    }
    this._refreshAimReticleVisual();
  }

  /**
   * Returns current grain alignment error (radians), closest knot distance (meters),
   * and closest embedded nail/rock hazard distance (meters).
   */
  getAimDiagnostics() {
    // Grain check line is along local Z when logRotationY + grainCheckAngle == aimAngle
    const totalGrainAngle = this.logRotationY + this.grainCheckAngle - this.aimAngle;
    // Wrap to [-PI/2, PI/2] since a line is symmetric every 180 deg
    const grainAngleError = Math.abs(
      Math.atan2(Math.sin(totalGrainAngle), Math.cos(totalGrainAngle))
    );
    const foldedError = Math.min(grainAngleError, Math.abs(Math.PI - grainAngleError));

    // Check distance from strike line (x = aimOffsetX) to any 3D knot on the log
    let minKnotDist = 1.0;
    for (const kAngle of this.knotAngles) {
      const worldKAngle = kAngle + this.logRotationY;
      const kx = Math.cos(worldKAngle) * (this.logRadius * 0.72);
      const dist = Math.abs(this.aimOffsetX - kx);
      if (dist < minKnotDist) minKnotDist = dist;
    }

    // Check distance from strike line (x = aimOffsetX) to any embedded iron nail hazard
    let minNailDist = 1.0;
    for (const nAngle of this.nailAngles) {
      const worldNAngle = nAngle + this.logRotationY;
      const nx = Math.cos(worldNAngle) * (this.logRadius * 0.76);
      const dist = Math.abs(this.aimOffsetX - nx);
      if (dist < minNailDist) minNailDist = dist;
    }

    // Check distance from strike line (x = aimOffsetX) to any embedded granite fieldstone rock hazard
    let minRockDist = 1.0;
    for (const rAngle of this.rockAngles) {
      const worldRAngle = rAngle + this.logRotationY;
      const rx = Math.cos(worldRAngle) * (this.logRadius * 0.82);
      const dist = Math.abs(this.aimOffsetX - rx);
      if (dist < minRockDist) minRockDist = dist;
    }

    // Check if strike line is aimed directly over any planted steel splitting wedge (supports Dual Tandem Wedges!)
    let hitPlantedWedge = false;
    let hitWedgeIndex = -1;
    for (let i = 0; i < this.plantedWedges.length; i++) {
      const w = this.plantedWedges[i];
      const worldWedgeX = w.localX * Math.cos(this.logRotationY);
      if (Math.abs(this.aimOffsetX - worldWedgeX) < 0.048) {
        hitPlantedWedge = true;
        hitWedgeIndex = i;
        break;
      }
    }

    return {
      aimOffsetX: this.aimOffsetX,
      grainAngleError: foldedError,
      knotDistance: minKnotDist,
      nailDistance: minNailDist,
      rockDistance: minRockDist,
      hitPlantedWedge,
      hitWedgeIndex,
      plantedWedgeCount: this.plantedWedges.length,
      isLogFlipped: this.isLogFlipped,
      isPeaveySeated: this.isPeaveySeated
    };
  }

  _refreshAimReticleVisual() {
    if (!this.intactLog || this.isLogSplit) {
      this.aimReticleGroup.visible = false;
      return;
    }
    this.aimReticleGroup.visible = true;
    const topY = this.blockHeight + this.logHeight + 0.006;
    this.aimReticleGroup.position.set(
      this.blockPosition.x + this.aimOffsetX,
      topY,
      this.blockPosition.z
    );
    this.aimReticleGroup.rotation.y = this.aimAngle;

    // Chord length of log circle at aimOffsetX
    const r = this.logRadius;
    const clampedX = Math.min(r * 0.98, Math.abs(this.aimOffsetX));
    const chord = 2 * Math.sqrt(Math.max(0.01, r * r - clampedX * clampedX));
    this.aimLineMesh.scale.z = chord / 0.31;

    const diag = this.getAimDiagnostics();
    const normOff = Math.abs(this.aimOffsetX) / r;
    const logDef = LOG_TYPES[this.currentSpecies] || LOG_TYPES.pine;
    const nailLim = this.isLogFlipped ? 0.024 : 0.038;
    const rockLim = this.isLogFlipped ? 0.027 : 0.042;

    if (diag.hitPlantedWedge) {
      // Electric Cyan: locked onto planted steel splitting wedge!
      this.aimLineMat.color.setHex(0x38bdf8);
    } else if (
      normOff > (this.collarActive ? 0.74 : 0.65) ||
      diag.knotDistance < 0.038 ||
      diag.nailDistance < nailLim ||
      diag.rockDistance < rockLim ||
      (logDef.isHollow && !logDef.hasCrystalGeode && normOff < 0.21)
    ) {
      // Danger red: glancing rim, knot, embedded nail/rock hazard, or hollow rot cavity!
      this.aimLineMat.color.setHex(0xef4444);
    } else if (logDef.hasCrystalGeode && normOff < 0.38) {
      // Amethyst Violet: locked onto glittering Crystal Geode Seam!
      this.aimLineMat.color.setHex(0xc084fc);
    } else if (logDef.hasPinchedKerf && normOff < 0.32 && diag.grainAngleError < 0.38) {
      // Lime-Gold: locked onto Pinched Sawmill Chainsaw Kerf!
      this.aimLineMat.color.setHex(0xa3e635);
    } else if (logDef.isLightningStruck && normOff < 0.34 && diag.grainAngleError < 0.38) {
      // Electric Amber-Gold: locked onto pre-stressed Lightning Fissure fault line!
      this.aimLineMat.color.setHex(0xf97316);
    } else if (
      (logDef.isHollow && !logDef.hasCrystalGeode
        ? normOff >= 0.22 && normOff <= 0.52
        : normOff < 0.22) &&
      diag.grainAngleError < 0.35
    ) {
      // Sweet spot green: aligned with grain check line / sapwood wall!
      this.aimLineMat.color.setHex(0x4ade80);
    } else {
      // Standard amber
      this.aimLineMat.color.setHex(0xfbbf24);
    }
  }

  _buildChipParticlePool() {
    this.particleGroup = new THREE.Group();
    this.particleGroup.name = 'WoodChipAndSparkParticles';
    this.rootGroup.add(this.particleGroup);

    this.chipGeoLarge = new THREE.BoxGeometry(0.048, 0.014, 0.028);
    this.chipGeoSmall = new THREE.BoxGeometry(0.024, 0.008, 0.016);
    this.sawdustGeo = new THREE.DodecahedronGeometry(0.009, 0);
    this.sparkGeo = new THREE.BoxGeometry(0.009, 0.009, 0.038);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    this.sapDropMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xb45309,
      emissiveIntensity: 0.25,
      roughness: 0.12,
      metalness: 0.1
    });
    this.frostChipMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.25,
      metalness: 0.1
    });
    this.geodeCrystalMat = new THREE.MeshStandardMaterial({
      color: 0xd8b4fe,
      emissive: 0x9333ea,
      emissiveIntensity: 0.55,
      roughness: 0.12,
      metalness: 0.65
    });
  }

  /**
   * Spawns a fresh, unsplit log of the specified wood species on the chopping block.
   */
  spawnFreshLog(species = this.currentSpecies) {
    this._clearIntactLog();

    this.currentSpecies = LOG_TYPES[species] ? species : 'pine';
    const logDef = LOG_TYPES[this.currentSpecies];
    this.logRadius = logDef.radius;
    this.logHeight = logDef.height;
    this.spiralTwist = logDef.spiralTwist || 0;

    const mats = this._getMaterialsForSpecies(this.currentSpecies);
    this.barkMaterial = mats.barkMaterial;
    this.endGrainMaterial = mats.endGrainMaterial;
    this.splitWoodMaterial = mats.splitWoodMaterial;
    this.barkMaterial.roughness = logDef.isFrozenLog
      ? 0.28
      : logDef.isWetLog
      ? 0.36
      : 0.88;

    const logMesh = new THREE.Group();
    logMesh.name = `IntactTargetLog_${this.currentSpecies}`;

    // Invertible child group so `flipLogOnBlock()` can flip the 3D round 180 degrees upside-down!
    const invertibleGroup = new THREE.Group();
    invertibleGroup.name = 'InvertibleLogBody';
    logMesh.add(invertibleGroup);

    const logGeo = new THREE.CylinderGeometry(
      this.logRadius,
      this.logRadius * (logDef.isBoss || logDef.isIrregularStump ? 1.12 : 1.02),
      this.logHeight,
      24
    );
    const logMats = [this.barkMaterial, this.endGrainMaterial, this.endGrainMaterial];
    const coreCylMesh = new THREE.Mesh(logGeo, logMats);
    coreCylMesh.castShadow = true;
    coreCylMesh.receiveShadow = true;
    invertibleGroup.add(coreCylMesh);

    // Natural grain check line across both end-grain faces (shows ideal split line even when flipped!)
    this.grainCheckAngle = 0;
    const checkGeo = new THREE.BoxGeometry(0.007, 0.004, this.logRadius * 1.82);
    const checkMat = new THREE.MeshBasicMaterial({ color: 0x2b180a });
    [-1, 1].forEach((endDir) => {
      const checkLine = new THREE.Mesh(checkGeo, checkMat);
      checkLine.position.y = endDir * (this.logHeight / 2 + 0.0015);
      checkLine.rotation.y = this.grainCheckAngle;
      invertibleGroup.add(checkLine);
    });

    // 1. Hollow Punky Sycamore: 3D dark sunken rot cavity in the center of the round
    if (logDef.isHollow) {
      const cavityMat = new THREE.MeshStandardMaterial({
        color: 0x160d07,
        roughness: 0.98
      });
      const cavityCap = new THREE.Mesh(
        new THREE.CylinderGeometry(
          this.logRadius * 0.34,
          this.logRadius * 0.28,
          0.018,
          16
        ),
        cavityMat
      );
      cavityCap.position.y = this.logHeight / 2 - 0.004;
      invertibleGroup.add(cavityCap);

      // Punky rot rim warning ring
      const rotRing = new THREE.Mesh(
        new THREE.RingGeometry(this.logRadius * 0.33, this.logRadius * 0.42, 20),
        new THREE.MeshBasicMaterial({
          color: 0x5c3c20,
          side: THREE.DoubleSide
        })
      );
      rotRing.rotation.x = -Math.PI / 2;
      rotRing.position.y = this.logHeight / 2 + 0.0022;
      invertibleGroup.add(rotRing);
    }

    // 1b. Permafrost Boreal Tamarack: glistening blue-white frozen ice-sap core ring & frosted rime icicles
    if (logDef.isFrozenLog) {
      const iceCoreMat = new THREE.MeshStandardMaterial({
        color: 0x93c5fd,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.22,
        roughness: 0.16,
        metalness: 0.25,
        side: THREE.DoubleSide
      });
      const iceDisc = new THREE.Mesh(
        new THREE.RingGeometry(0.012, this.logRadius * 0.36, 20),
        iceCoreMat
      );
      iceDisc.rotation.x = -Math.PI / 2;
      iceDisc.position.y = this.logHeight / 2 + 0.0024;
      invertibleGroup.add(iceDisc);

      for (let ic = 0; ic < 6; ic++) {
        const ia = (ic / 6) * Math.PI * 2 + 0.2;
        const rime = new THREE.Mesh(
          new THREE.ConeGeometry(0.014, 0.085, 5),
          this.frostChipMat
        );
        rime.position.set(
          Math.cos(ia) * (this.logRadius * 1.01),
          this.logHeight * 0.25,
          Math.sin(ia) * (this.logRadius * 1.01)
        );
        rime.rotation.x = Math.PI;
        invertibleGroup.add(rime);
      }
    }

    // 1c. Jersey Pine Barrens Pitch Pine: glistening 3D golden-amber pine-resin pitch blisters & sap drips
    if (this.currentSpecies === 'pitch_pine') {
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2 + 0.35;
        const blister = new THREE.Mesh(
          new THREE.SphereGeometry(0.018, 10, 8),
          this.sapDropMat
        );
        blister.position.set(
          Math.cos(pa) * (this.logRadius * 0.99),
          ((p % 3) - 1) * (this.logHeight * 0.22),
          Math.sin(pa) * (this.logRadius * 0.99)
        );
        blister.scale.set(0.8, 1.5, 0.8);
        invertibleGroup.add(blister);
      }
      const sapRing = new THREE.Mesh(
        new THREE.RingGeometry(this.logRadius * 0.44, this.logRadius * 0.54, 20),
        this.sapDropMat
      );
      sapRing.rotation.x = -Math.PI / 2;
      sapRing.position.y = this.logHeight / 2 + 0.0023;
      invertibleGroup.add(sapRing);
    }

    // 1d. Emerald Borer-Riddled Green Ash: 3D serpentine larval gallery grooves & top gallery fault line
    if (logDef.hasBorerGalleries) {
      const galleryMat = new THREE.MeshBasicMaterial({
        color: 0x24170c,
        side: THREE.DoubleSide
      });
      for (let g = 0; g < 6; g++) {
        const ga = (g / 6) * Math.PI * 2 + 0.2;
        const groove = new THREE.Mesh(
          new THREE.BoxGeometry(0.012, 0.14, 0.012),
          galleryMat
        );
        groove.position.set(
          Math.cos(ga) * (this.logRadius * 1.004),
          ((g % 2) - 0.5) * 0.14,
          Math.sin(ga) * (this.logRadius * 1.004)
        );
        groove.rotation.z = (g % 2 === 0 ? 1 : -1) * 0.48;
        invertibleGroup.add(groove);
      }
      const faultRing = new THREE.Mesh(
        new THREE.RingGeometry(this.logRadius * 0.22, this.logRadius * 0.34, 18),
        new THREE.MeshBasicMaterial({ color: 0x84cc16, side: THREE.DoubleSide })
      );
      faultRing.rotation.x = -Math.PI / 2;
      faultRing.position.y = this.logHeight / 2 + 0.0024;
      invertibleGroup.add(faultRing);
    }

    // 1e. Figured Birdseye Sugar Maple Burl: 3 protruding 3D bulbous hemispherical burl outgrowths!
    this.burlOutgrowthMeshes = [];
    if (logDef.isBurl) {
      const burlCount = logDef.burlBulges || 3;
      const burlCapMat = new THREE.MeshStandardMaterial({
        color: 0xb45309,
        roughness: 0.65
      });
      for (let bIdx = 0; bIdx < burlCount; bIdx++) {
        const ba = (bIdx / burlCount) * Math.PI * 2 + 0.45;
        const burlGroup = new THREE.Group();
        const by = ((bIdx % 2) - 0.4) * (this.logHeight * 0.22);
        burlGroup.position.set(
          Math.cos(ba) * (this.logRadius * 0.94),
          by,
          Math.sin(ba) * (this.logRadius * 0.94)
        );

        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.056, 12, 10),
          this.barkMaterial
        );
        dome.scale.set(1.15, 0.92, 1.15);
        dome.castShadow = true;
        burlGroup.add(dome);

        const swirlCap = new THREE.Mesh(
          new THREE.CircleGeometry(0.032, 10),
          burlCapMat
        );
        swirlCap.position.set(
          Math.cos(ba) * 0.052,
          0.015,
          Math.sin(ba) * 0.052
        );
        swirlCap.lookAt(
          Math.cos(ba) * 0.2,
          0.04,
          Math.sin(ba) * 0.2
        );
        burlGroup.add(swirlCap);

        invertibleGroup.add(burlGroup);
        this.burlOutgrowthMeshes.push({
          mesh: burlGroup,
          angle: ba,
          dir: Math.cos(ba) >= 0 ? 1 : -1,
          sheared: false
        });
      }
    }

    // 1f. BOSS #4 — Petrified Bog-Oak Leviathan: glowing cyan & gold mineralized quartz/pyrite veins
    if (logDef.isPetrifiedBog) {
      const quartzMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.45,
        roughness: 0.2,
        metalness: 0.75
      });
      const pyriteMat = new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xd97706,
        emissiveIntensity: 0.38,
        roughness: 0.22,
        metalness: 0.88
      });
      for (let v = 0; v < 6; v++) {
        const va = (v / 6) * Math.PI * 2 + 0.15;
        const vein = new THREE.Mesh(
          new THREE.BoxGeometry(0.012, this.logHeight * 0.86, 0.012),
          v % 2 === 0 ? quartzMat : pyriteMat
        );
        vein.position.set(
          Math.cos(va) * (this.logRadius * 1.008),
          0,
          Math.sin(va) * (this.logRadius * 1.008)
        );
        vein.rotation.z = 0.24;
        invertibleGroup.add(vein);
      }
    }

    // 1g. Lightning-Struck Scorched Scarlet Oak & Thunderstorm Locust Colossus: glowing 3D Lichtenberg lightning fissure seams & top fault line!
    if (logDef.isLightningStruck) {
      const emberSeamMat = new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: 0xea580c,
        emissiveIntensity: 0.72,
        roughness: 0.35
      });
      for (let lf = 0; lf < 4; lf++) {
        const lfa = (lf / 4) * Math.PI * 2 + 0.12;
        const seam = new THREE.Mesh(
          new THREE.BoxGeometry(0.014, this.logHeight * 0.9, 0.014),
          emberSeamMat
        );
        seam.position.set(
          Math.cos(lfa) * (this.logRadius * 1.01),
          0,
          Math.sin(lfa) * (this.logRadius * 1.01)
        );
        seam.rotation.z = (lf % 2 === 0 ? 1 : -1) * 0.26;
        invertibleGroup.add(seam);
      }
      const fissureBar = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.006, this.logRadius * 1.88),
        emberSeamMat
      );
      fissureBar.position.y = this.logHeight / 2 + 0.0026;
      invertibleGroup.add(fissureBar);
    }

    // 1h. Mineralized Quartz-Geode Sycamore & Colonial Ironbark Behemoth: 3D glittering amethyst & quartz crystal spire clusters!
    if (logDef.hasCrystalGeode) {
      for (let c = 0; c < 8; c++) {
        const ca = (c / 8) * Math.PI * 2 + 0.25;
        const spire = new THREE.Mesh(
          new THREE.ConeGeometry(0.014, 0.052, 5),
          this.geodeCrystalMat
        );
        const cr = this.logRadius * 0.24;
        spire.position.set(
          Math.cos(ca) * cr,
          this.logHeight / 2 + 0.012,
          Math.sin(ca) * cr
        );
        spire.rotation.set(
          -Math.sin(ca) * 0.42,
          ca,
          Math.cos(ca) * 0.42
        );
        invertibleGroup.add(spire);
      }
      const geodeSeam = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.006, this.logRadius * 1.84),
        this.geodeCrystalMat
      );
      geodeSeam.position.y = this.logHeight / 2 + 0.0027;
      invertibleGroup.add(geodeSeam);
    }

    // 1i. Mis-Bucked Sawmill Hickory Crotch: 3D pinched chainsaw kerf slot & jammed steel chainsaw bar tip!
    if (logDef.hasPinchedKerf) {
      const kerfSlotMat = new THREE.MeshBasicMaterial({ color: 0x140d07 });
      const chalkLineMat = new THREE.MeshBasicMaterial({ color: 0xa3e635 });
      const kerfSlot = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.085, this.logRadius * 1.92),
        kerfSlotMat
      );
      kerfSlot.position.set(0, this.logHeight / 2 - 0.036, 0);
      invertibleGroup.add(kerfSlot);

      const chalkLine = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.006, this.logRadius * 1.88),
        chalkLineMat
      );
      chalkLine.position.set(0, this.logHeight / 2 + 0.0028, 0);
      invertibleGroup.add(chalkLine);
    }

    // 2. Forked Y-Shaped Applewood Crotch (2-limb) & Trifurcated Black Cherry Crotch (3-way crown fork)
    this.forkLimbMeshes = [];
    if (logDef.isForked) {
      const forkCount = logDef.forkCount || 2;
      if (forkCount === 3) {
        // 3-way Trifurcated Crown Fork (`cherry_crotch`)
        [-1, 0, 1].forEach((slotIdx) => {
          const forkGroup = new THREE.Group();
          const ang = slotIdx * 1.05;
          const fx = Math.sin(ang) * (this.logRadius * 0.44);
          const fz = (slotIdx === 0 ? -1 : 0.45) * (this.logRadius * 0.28);
          forkGroup.position.set(fx, this.logHeight * 0.22, fz);
          forkGroup.rotation.z = -slotIdx * 0.34;
          forkGroup.rotation.x = slotIdx === 0 ? -0.28 : 0.16;

          const forkCyl = new THREE.Mesh(
            new THREE.CylinderGeometry(
              this.logRadius * 0.48,
              this.logRadius * 0.56,
              this.logHeight * 0.5,
              14
            ),
            logMats
          );
          forkCyl.castShadow = true;
          forkCyl.receiveShadow = true;
          forkGroup.add(forkCyl);
          invertibleGroup.add(forkGroup);
          this.forkLimbMeshes.push({
            mesh: forkGroup,
            dir: slotIdx === 0 ? 1 : slotIdx,
            sheared: false
          });
        });
      } else {
        [-1, 1].forEach((dir) => {
          const forkGroup = new THREE.Group();
          forkGroup.position.set(dir * (this.logRadius * 0.42), this.logHeight * 0.22, 0);
          forkGroup.rotation.z = -dir * 0.36;

          const forkCyl = new THREE.Mesh(
            new THREE.CylinderGeometry(
              this.logRadius * 0.56,
              this.logRadius * 0.64,
              this.logHeight * 0.52,
              16
            ),
            logMats
          );
          forkCyl.castShadow = true;
          forkCyl.receiveShadow = true;
          forkGroup.add(forkCyl);
          invertibleGroup.add(forkGroup);
          this.forkLimbMeshes.push({ mesh: forkGroup, dir, sheared: false });
        });
      }
    }

    // 3. Twisted American Elm / Spiral Grain: helical bark furrow seams wrapping down the round
    if (this.spiralTwist >= 0.3) {
      const seamMat = new THREE.MeshBasicMaterial({ color: 0x1d130b });
      for (let s = 0; s < 4; s++) {
        const baseA = (s / 4) * Math.PI * 2;
        for (let seg = 0; seg < 6; seg++) {
          const t = seg / 6;
          const a = baseA + (t - 0.5) * this.spiralTwist * 1.6;
          const sy = (t - 0.5) * (this.logHeight * 0.85);
          const seamSeg = new THREE.Mesh(
            new THREE.BoxGeometry(0.01, 0.065, 0.01),
            seamMat
          );
          seamSeg.position.set(
            Math.cos(a) * (this.logRadius * 1.005),
            sy,
            Math.sin(a) * (this.logRadius * 1.005)
          );
          seamSeg.rotation.z = 0.38;
          invertibleGroup.add(seamSeg);
        }
      }
    }

    // 4. Add 3D Protruding Branch Knots & Top Knot Whorl Indicators for knotty logs!
    this.knotAngles = [];
    const knotCount = logDef.knots || 0;
    const knotBarkMat = new THREE.MeshStandardMaterial({
      color: 0x2a1b10,
      roughness: 0.92
    });
    const knotCoreMat = new THREE.MeshStandardMaterial({
      color: 0x5c3418,
      roughness: 0.85
    });

    const presetKnotAngles = [0.38, -0.46, 2.68, -2.62];
    for (let k = 0; k < knotCount; k++) {
      // Place knots off-center so center check line remains a skill shot between knots
      const kAngle = presetKnotAngles[k % presetKnotAngles.length];
      this.knotAngles.push(kAngle);

      // Protruding 3D branch stub on the side of the log
      const stubGroup = new THREE.Group();
      const ky = ((k % 2) - 0.3) * (this.logHeight * 0.28);
      stubGroup.position.set(
        Math.cos(kAngle) * (this.logRadius * 0.96),
        ky,
        Math.sin(kAngle) * (this.logRadius * 0.96)
      );
      stubGroup.rotation.z = -Math.cos(kAngle) * 1.25;
      stubGroup.rotation.x = Math.sin(kAngle) * 1.25;

      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.042, 0.038, 10),
        knotBarkMat
      );
      collar.castShadow = true;
      stubGroup.add(collar);

      const core = new THREE.Mesh(
        new THREE.CircleGeometry(0.024, 10),
        knotCoreMat
      );
      core.rotation.x = -Math.PI / 2;
      core.position.y = 0.02;
      stubGroup.add(core);
      invertibleGroup.add(stubGroup);

      // Dark knot whorl indicator on the top end-grain cap so player can see knot zone from above
      const topKnot = new THREE.Mesh(
        new THREE.CircleGeometry(0.026, 12),
        knotBarkMat
      );
      topKnot.rotation.x = -Math.PI / 2;
      topKnot.position.set(
        Math.cos(kAngle) * (this.logRadius * 0.68),
        this.logHeight / 2 + 0.002,
        Math.sin(kAngle) * (this.logRadius * 0.68)
      );
      invertibleGroup.add(topKnot);
    }

    // 5. Embedded Rusty Iron Nails / Fence Staples & Barbed-Wire Hazards (Fence-Row Ironwood, Boss Oak & Boss Osage)
    this.nailAngles = [];
    const nailCount = logDef.nails || 0;
    const rustyIronMat = new THREE.MeshStandardMaterial({
      color: 0x7c3f23,
      roughness: 0.45,
      metalness: 0.85
    });
    const hazardRingMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide
    });
    const presetNailAngles = [0.76, -0.82, 2.35];
    for (let n = 0; n < nailCount; n++) {
      const nAngle = presetNailAngles[n % presetNailAngles.length];
      this.nailAngles.push(nAngle);

      // Protruding bent iron fence nail on the upper side & top rim
      const nailGroup = new THREE.Group();
      const nx = Math.cos(nAngle) * (this.logRadius * 0.76);
      const nz = Math.sin(nAngle) * (this.logRadius * 0.76);
      nailGroup.position.set(nx, this.logHeight / 2 + 0.012, nz);
      nailGroup.rotation.z = (n % 2 === 0 ? -1 : 1) * 0.35;

      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0045, 0.0045, 0.042, 8),
        rustyIronMat
      );
      shaft.castShadow = true;
      nailGroup.add(shaft);

      const head = new THREE.Mesh(
        new THREE.CylinderGeometry(0.011, 0.011, 0.005, 10),
        rustyIronMat
      );
      head.position.y = 0.021;
      nailGroup.add(head);
      invertibleGroup.add(nailGroup);

      // Red-orange rust hazard warning ring on the top face around the embedded nail
      const warnRing = new THREE.Mesh(
        new THREE.RingGeometry(0.018, 0.026, 14),
        hazardRingMat
      );
      warnRing.rotation.x = -Math.PI / 2;
      warnRing.position.set(nx, this.logHeight / 2 + 0.0025, nz);
      invertibleGroup.add(warnRing);
    }

    // 5b. Barbed-Wire Pasture Osage Orange Boss: 2 rusty twisted barbed-wire strands wrapping the round
    if (logDef.hasBarbedWire) {
      [-0.06, 0.09].forEach((wy, wIdx) => {
        const wireStrand = new THREE.Mesh(
          new THREE.TorusGeometry(this.logRadius * 1.015, 0.0045, 6, 28),
          rustyIronMat
        );
        wireStrand.rotation.x = Math.PI / 2 + (wIdx === 0 ? 0.08 : -0.09);
        wireStrand.position.y = wy;
        invertibleGroup.add(wireStrand);

        for (let b = 0; b < 8; b++) {
          const ba = (b / 8) * Math.PI * 2 + wIdx * 0.4;
          const barb = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.011, 0),
            rustyIronMat
          );
          barb.position.set(
            Math.cos(ba) * (this.logRadius * 1.02),
            wy,
            Math.sin(ba) * (this.logRadius * 1.02)
          );
          invertibleGroup.add(barb);
        }
      });
    }

    // 6. Embedded Granite Fieldstone / Rock Hazards (Gnarled Mulberry Stump & Glacial Boss Stump)
    this.rockAngles = [];
    const rockCount = logDef.rocks || 0;
    const graniteMat = new THREE.MeshStandardMaterial({
      color: 0x7b828a,
      roughness: 0.72,
      metalness: 0.18,
      flatShading: true
    });
    const rockWarnMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      side: THREE.DoubleSide
    });
    const presetRockAngles = [-0.64, 0.68, 2.45];
    for (let rIdx = 0; rIdx < rockCount; rIdx++) {
      const rAngle = presetRockAngles[rIdx % presetRockAngles.length];
      this.rockAngles.push(rAngle);

      const rx = Math.cos(rAngle) * (this.logRadius * 0.82);
      const rz = Math.sin(rAngle) * (this.logRadius * 0.82);
      const rockMesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.032, 0),
        graniteMat
      );
      rockMesh.position.set(rx, this.logHeight * 0.28, rz);
      rockMesh.scale.set(1.25, 0.9, 1.15);
      rockMesh.rotation.set(rIdx * 0.7, rAngle, 0.35);
      rockMesh.castShadow = true;
      invertibleGroup.add(rockMesh);

      // Top face stone hazard marker ring
      const stoneWarn = new THREE.Mesh(
        new THREE.RingGeometry(0.021, 0.03, 12),
        rockWarnMat
      );
      stoneWarn.rotation.x = -Math.PI / 2;
      stoneWarn.position.set(rx, this.logHeight / 2 + 0.0026, rz);
      invertibleGroup.add(stoneWarn);
    }

    // 7. Irregular Stump / Cypress / Boss Log Basal Buttress Root Flares & Golden Crown Ring
    this.rootFlareMeshes = [];
    const flareCount = logDef.rootFlares || (logDef.isBoss ? 4 : 0);
    for (let b = 0; b < flareCount; b++) {
      const ba = (b / flareCount) * Math.PI * 2 + 0.38;
      const flareScale = logDef.isIrregularStump ? 1.25 : 1.0;
      const flare = new THREE.Mesh(
        new THREE.ConeGeometry(0.068 * flareScale, 0.24 * flareScale, 6),
        this.barkMaterial
      );
      flare.position.set(
        Math.cos(ba) * (this.logRadius * 0.96),
        -this.logHeight * 0.24,
        Math.sin(ba) * (this.logRadius * 0.96)
      );
      flare.rotation.z = -Math.cos(ba) * 0.52;
      flare.rotation.x = Math.sin(ba) * 0.52;
      flare.castShadow = true;
      invertibleGroup.add(flare);
      this.rootFlareMeshes.push({ mesh: flare, angle: ba, sheared: false });
    }

    if (logDef.isBoss) {
      const bossRing = new THREE.Mesh(
        new THREE.RingGeometry(this.logRadius * 0.92, this.logRadius * 0.99, 28),
        new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          side: THREE.DoubleSide
        })
      );
      bossRing.rotation.x = -Math.PI / 2;
      bossRing.position.y = this.logHeight / 2 + 0.0025;
      logMesh.add(bossRing);
    }

    // Group to hold partial-penetration 3D kerf cracks when a tough log takes multiple hits
    const kerfGroup = new THREE.Group();
    logMesh.add(kerfGroup);

    const startY = this.blockHeight + this.logHeight / 2;
    this.logRotationY = 0;
    this.isLogFlipped = false;
    this.isPeaveySeated = false;
    this.hasShatteredKindling = false;
    if (this.peaveyToolGroup) {
      this.peaveyToolGroup.position.set(this.blockRadius + 0.11, 0.08, -0.05);
      this.peaveyToolGroup.rotation.set(0.12, 0.25, -0.36);
    }
    logMesh.position.set(this.blockPosition.x, startY, this.blockPosition.z);
    this.rootGroup.add(logMesh);

    const logBody = new CANNON.Body({
      mass: logDef.densityMass,
      material: this.physMaterials.woodPhysMat,
      linearDamping: 0.15,
      angularDamping: 0.25
    });
    const logShape = new CANNON.Cylinder(
      this.logRadius,
      this.logRadius * 1.02,
      this.logHeight,
      14
    );
    logBody.addShape(logShape);
    logBody.position.set(this.blockPosition.x, startY, this.blockPosition.z);
    logBody.userData = { label: 'IntactLog' };
    this.world.addBody(logBody);

    this.intactLog = { mesh: logMesh, invertibleGroup, body: logBody, kerfGroup };
    this.plantedWedge = null;
    this.plantedWedges = [];
    this.tandemCrackBridge = null;
    this.isLogSplit = false;
    this._refreshAimReticleVisual();
  }

  /**
   * Hooks and seats the active log on the chopping block using the 3D Forged-Steel Cant-Hook Peavey (`P` key).
   * Aligns the natural check line toward the woodchopper, stabilizes the round on the block,
   * and engages the 3D steel cant-hook claw against the log's side!
   */
  heaveLogWithPeavey() {
    if (!this.intactLog || this.isLogSplit) return false;
    this.isPeaveySeated = true;
    this.logRotationY = 0;
    this.aimOffsetX = 0;
    this.aimAngle = 0;

    const startY = this.blockHeight + this.logHeight / 2;
    this.intactLog.body.position.set(this.blockPosition.x, startY + 0.04, this.blockPosition.z);
    this.intactLog.body.quaternion.setFromEuler(0, 0, 0);
    this.intactLog.body.wakeUp();
    this.intactLog.body.velocity.set(0, -0.85, 0);
    this.intactLog.body.angularVelocity.set(0, 0, 0);
    this.intactLog.mesh.position.copy(this.intactLog.body.position);
    this.intactLog.mesh.quaternion.copy(this.intactLog.body.quaternion);

    if (this.peaveyToolGroup) {
      this.peaveyToolGroup.position.set(
        this.logRadius + 0.06,
        this.blockHeight * 0.55,
        0.02
      );
      this.peaveyToolGroup.rotation.set(0.05, 0.15, 0.42);
    }

    const sparkOrigin = new THREE.Vector3(
      this.blockPosition.x + this.logRadius,
      this.blockHeight + this.logHeight * 0.45,
      this.blockPosition.z
    );
    this._spawnSparkBurst(sparkOrigin, 0.55);
    this._refreshAimReticleVisual();
    return true;
  }

  /**
   * Plants up to 2 Dual Tandem 3D forged-steel splitting wedges into the top face of the intact log.
   * When 2 wedges are planted side-by-side, a 3D tension crack bridge connects them for Crack-Walking!
   */
  plantSteelWedge(offsetX = this.aimOffsetX) {
    if (!this.intactLog || this.isLogSplit) return false;

    let clampedX = Math.max(
      -this.logRadius * 0.58,
      Math.min(this.logRadius * 0.58, offsetX)
    );

    if (this.plantedWedges.length === 1) {
      const existingWorldX =
        this.plantedWedges[0].localX * Math.cos(this.logRotationY);
      if (Math.abs(clampedX - existingWorldX) < 0.028) {
        clampedX = existingWorldX > 0.02 ? existingWorldX - 0.052 : existingWorldX + 0.052;
      }
    } else if (this.plantedWedges.length >= 2) {
      const oldest = this.plantedWedges.shift();
      if (oldest && oldest.group) {
        this.intactLog.mesh.remove(oldest.group);
      }
    }

    const localX = clampedX * Math.cos(-this.logRotationY);

    const wedgeGroup = new THREE.Group();
    wedgeGroup.name = `PlantedSteelSplittingWedge_${this.plantedWedges.length}`;

    const forgedMat = new THREE.MeshStandardMaterial({
      color: 0x3b424c,
      roughness: 0.32,
      metalness: 0.9
    });
    const bandColor = this.plantedWedges.length === 1 ? 0x38bdf8 : 0xf97316;
    const orangeBandMat = new THREE.MeshStandardMaterial({
      color: bandColor,
      roughness: 0.45,
      metalness: 0.25
    });
    const pollCapMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.22,
      metalness: 0.95
    });

    // Tapered 4-sided steel wedge body
    const bladeGeo = new THREE.CylinderGeometry(0.018, 0.003, 0.125, 4);
    bladeGeo.rotateY(Math.PI / 4);
    const bladeMesh = new THREE.Mesh(bladeGeo, forgedMat);
    bladeMesh.scale.set(0.65, 1.0, 1.65);
    bladeMesh.castShadow = true;
    wedgeGroup.add(bladeMesh);

    // High-visibility lumberjack collar band near top of wedge (Orange for #1, Cyan for Tandem #2)
    const bandMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.021, 0.024, 0.044),
      orangeBandMat
    );
    bandMesh.position.y = 0.032;
    bandMesh.castShadow = true;
    wedgeGroup.add(bandMesh);

    // Mushroomed steel striking poll at top of wedge
    const pollCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.015, 0.014, 10),
      pollCapMat
    );
    pollCap.position.y = 0.062;
    pollCap.castShadow = true;
    wedgeGroup.add(pollCap);

    // Starter kerf split crack under the planted wedge
    const kerfMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.06, this.logRadius * 1.9),
      new THREE.MeshBasicMaterial({ color: 0x1e0f06 })
    );
    kerfMesh.position.set(localX, this.logHeight / 2 - 0.024, 0);
    this.intactLog.kerfGroup.add(kerfMesh);

    wedgeGroup.position.set(localX, this.logHeight / 2 + 0.035, 0);
    this.intactLog.mesh.add(wedgeGroup);

    const wedgeObj = {
      group: wedgeGroup,
      kerfMesh,
      localX,
      stage: 1
    };
    this.plantedWedges.push(wedgeObj);
    this.plantedWedge = wedgeObj;

    // If 2 Dual Tandem Wedges are now planted, connect them with a 3D tension crack bridge across the top!
    if (this.plantedWedges.length === 2) {
      if (this.tandemCrackBridge) {
        this.intactLog.kerfGroup.remove(this.tandemCrackBridge);
      }
      const x0 = this.plantedWedges[0].localX;
      const x1 = this.plantedWedges[1].localX;
      const span = Math.max(0.02, Math.abs(x1 - x0));
      this.tandemCrackBridge = new THREE.Mesh(
        new THREE.BoxGeometry(span, 0.012, 0.022),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      this.tandemCrackBridge.position.set((x0 + x1) * 0.5, this.logHeight / 2 + 0.003, 0);
      this.intactLog.kerfGroup.add(this.tandemCrackBridge);
    }

    const sparkOrigin = new THREE.Vector3(
      this.blockPosition.x + clampedX,
      this.blockHeight + this.logHeight + 0.05,
      this.blockPosition.z
    );
    this._spawnSparkBurst(sparkOrigin, 0.45);
    this._refreshAimReticleVisual();
    return true;
  }

  _clearIntactLog() {
    if (this.intactLog) {
      this.rootGroup.remove(this.intactLog.mesh);
      this.intactLog.mesh.traverse((child) => {
        if (child.isMesh && child.geometry) {
          child.geometry.dispose();
        }
      });
      this.world.removeBody(this.intactLog.body);
      this.intactLog = null;
    }
  }

  /**
   * Clears all fractured pieces, splinters, and particles, and places a fresh intact log.
   */
  reset(species = this.currentSpecies) {
    this._clearIntactLog();

    for (const piece of this.splitPieces) {
      this.rootGroup.remove(piece.mesh);
      if (piece.mesh.geometry) piece.mesh.geometry.dispose();
      this.world.removeBody(piece.body);
    }
    this.splitPieces.length = 0;

    for (const p of this.particles) {
      this.particleGroup.remove(p.mesh);
    }
    this.particles.length = 0;

    this.lastImpactSpeed = 0;
    this.spawnFreshLog(species);
  }

  /**
   * Executes the physical & visual result of an axe strike evaluated by `GameStateManager`:
   * 1. Clean Split -> fractures log along the strike plane and radial rays into 3D sectors.
   * 2. Partial Penetration / Wedged -> carves a 3D kerf crack to `penetrationDepth` and rocks the log.
   * 3. Glancing / Hazard Hit -> shears off a bark sliver, wobbles the log, and showers metal sparks!
   */
  executeStrikePhysics({
    strikeResult,
    swingForce = 1.0,
    impactPoint = null,
    axeVelocity = null,
    wedgePower = 1.0,
    weather = 'sun'
  }) {
    if (this.isLogSplit || !this.intactLog) return;

    this.isPeaveySeated = false;
    if (this.peaveyToolGroup) {
      this.peaveyToolGroup.position.set(this.blockRadius + 0.11, 0.08, -0.05);
      this.peaveyToolGroup.rotation.set(0.12, 0.25, -0.36);
    }

    const rawSpeed = axeVelocity ? axeVelocity.length() * 0.45 : 12.2 * swingForce;
    const effectiveForce = Math.max(0.35, swingForce * wedgePower);
    this.lastImpactSpeed = Math.max(5.8, Math.min(24.5, rawSpeed));

    const logPos = new THREE.Vector3().copy(this.intactLog.body.position);
    const burstOrigin = impactPoint
      ? impactPoint.clone()
      : new THREE.Vector3(
          logPos.x + this.aimOffsetX,
          logPos.y + this.logHeight * 0.38,
          logPos.z
        );

    if (this.sound && strikeResult && typeof this.sound.playStrikeImpact === 'function') {
      this.sound.playStrikeImpact(strikeResult, effectiveForce);
    }

    // CASE 1: Glancing, Embedded Nail, or Embedded Granite Rock Hazard Hit
    if (
      strikeResult &&
      (strikeResult.glancing || strikeResult.hitNail || strikeResult.hitRock)
    ) {
      if (this.sound) {
        if (strikeResult.hitRock && typeof this.sound.playRockRicochet === 'function') {
          this.sound.playRockRicochet();
        } else {
          this.sound.playSparkClang(
            strikeResult.hitNail ? effectiveForce * 1.45 : effectiveForce
          );
          this.sound.playWoodKnock(0.75);
        }
      }

      // Apply off-center impulse to the intact log so it skids/tips on the block
      const side = this.aimOffsetX >= 0 ? 1 : -1;
      const slipMult = weather === 'rain' ? 1.65 : 1.0;
      this.intactLog.body.wakeUp();
      this.intactLog.body.velocity.set(
        -side * 0.85 * slipMult,
        0.45,
        (Math.random() - 0.5) * 0.5
      );
      this.intactLog.body.angularVelocity.set(
        (Math.random() - 0.5) * 2.0,
        side * 3.5,
        side * 3.2 * slipMult
      );

      // Spawn incandescent sparks from the embedded nail, granite rock, or chopping block's iron hazard collar
      const sparkOrigin =
        strikeResult.hitNail || strikeResult.hitRock
          ? burstOrigin.clone()
          : new THREE.Vector3(
              this.blockPosition.x + side * (this.blockRadius * 0.85),
              this.blockHeight + 0.02,
              this.blockPosition.z
            );
      this._spawnSparkBurst(
        sparkOrigin,
        strikeResult.hitNail || strikeResult.hitRock
          ? effectiveForce * 1.45
          : effectiveForce
      );
      if (strikeResult.glancing) {
        this._recordBlockOverstrikeScar(this.aimOffsetX, this.aimAngle, effectiveForce, true);
      }
      this._spawnWoodChipBurst(burstOrigin, effectiveForce * 0.4, weather);
      return;
    }

    // CASE 2: Partial Penetration / Wedged in Tough Hardwood, Knot, Planted Steel Wedge, or Multi-Hit Boss Round
    if (strikeResult && !strikeResult.split) {
      if (this.sound) {
        if (
          strikeResult.isTandemCrackWalk &&
          typeof this.sound.playTandemCrackWalk === 'function'
        ) {
          this.sound.playTandemCrackWalk();
        } else if (
          strikeResult.struckWedge &&
          typeof this.sound.playWedgeHammer === 'function'
        ) {
          this.sound.playWedgeHammer(strikeResult.plantedWedgeStage || 2);
        } else {
          this.sound.playWoodWedge(effectiveForce);
          if (strikeResult.hitKnot) {
            this.sound.playSparkClang(0.55);
          }
        }
      }

      // If driving a planted Steel Splitting Wedge (or Dual Tandem Wedges), sink the struck wedge deeper!
      if (strikeResult.struckWedge && this.plantedWedges.length > 0) {
        const wIdx =
          typeof strikeResult.struckWedgeIdx === 'number' &&
          strikeResult.struckWedgeIdx >= 0 &&
          strikeResult.struckWedgeIdx < this.plantedWedges.length
            ? strikeResult.struckWedgeIdx
            : 0;
        const targetWedge = this.plantedWedges[wIdx];
        if (targetWedge) {
          targetWedge.stage = Math.min(3, (targetWedge.stage || 1) + 1);
          targetWedge.group.position.y =
            this.logHeight / 2 + 0.042 - targetWedge.stage * 0.022;
          if (targetWedge.kerfMesh) {
            targetWedge.kerfMesh.scale.x = 1.0 + targetWedge.stage * 0.85;
            targetWedge.kerfMesh.scale.y = 1.0 + targetWedge.stage * 0.55;
          }
        }
        if (this.tandemCrackBridge) {
          this.tandemCrackBridge.scale.z = 1.0 + (strikeResult.plantedWedgeStage || 2) * 0.9;
        }
        this._spawnSparkBurst(burstOrigin, strikeResult.isTandemCrackWalk ? 1.45 : 1.1);
      }

      // Add a visible 3D darkened split kerf wedge scar into the intact log at aimOffsetX
      const depth = strikeResult.penetrationDepth || 0.08;
      const kerfGeo = new THREE.BoxGeometry(0.016, depth, this.logRadius * 1.88);
      const kerfMat = new THREE.MeshBasicMaterial({ color: 0x241308 });
      const kerfMesh = new THREE.Mesh(kerfGeo, kerfMat);
      kerfMesh.position.set(
        this.aimOffsetX,
        this.logHeight / 2 - depth * 0.48 + 0.003,
        0
      );
      kerfMesh.rotation.y = this.aimAngle - this.logRotationY;
      this.intactLog.kerfGroup.add(kerfMesh);

      // Piece-by-piece dismemberment: Y-Fork limb lopping, Figured Burl dome shearing, Irregular Stump root buttress shearing, or side slabbing!
      if (strikeResult.forkBranchSheared) {
        this._shearForkLimb(logPos, effectiveForce);
      } else if (strikeResult.burlOutgrowthSheared) {
        this._shearBurlOutgrowth(logPos, effectiveForce);
      } else if (strikeResult.rootButtressSheared) {
        this._shearRootButtress(logPos, effectiveForce);
      } else if (strikeResult.slabSheared) {
        this._spawnPartialSideSlab(logPos, effectiveForce);
      }

      if (LOG_TYPES[this.currentSpecies]?.isResinous) {
        this._spawnSapSplashBurst(burstOrigin, effectiveForce * 0.8);
      }
      if (strikeResult.geodeCrystalShatter) {
        if (this.sound && typeof this.sound.playGeodeCrystalShatter === 'function') {
          this.sound.playGeodeCrystalShatter();
        }
        this._spawnGeodeCrystalBurst(burstOrigin, 1.15);
      }
      if (strikeResult.lightningFissureShatter || strikeResult.emberTempered) {
        if (
          strikeResult.lightningFissureShatter &&
          this.sound &&
          typeof this.sound.playLightningFissureShatter === 'function'
        ) {
          this.sound.playLightningFissureShatter();
        }
        this._spawnSparkBurst(burstOrigin, strikeResult.lightningFissureShatter ? 1.35 : 0.85);
      }

      // Rock the log slightly on the block
      this.intactLog.body.wakeUp();
      this.intactLog.body.velocity.set(
        (Math.random() - 0.5) * 0.35,
        0.25,
        0.25
      );
      this.intactLog.body.angularVelocity.set(
        0.8,
        (Math.random() - 0.5) * 1.4,
        -this.aimOffsetX * 8.0
      );

      if (strikeResult.hitKnot) {
        this._spawnSparkBurst(burstOrigin, 0.65);
      }
      this._spawnWoodChipBurst(burstOrigin, effectiveForce * 0.6, weather);
      return;
    }

    // CASE 3: Full Grain-Aligned Log Fracture!
    this._recordBlockOverstrikeScar(this.aimOffsetX, this.aimAngle, effectiveForce, false);
    if (LOG_TYPES[this.currentSpecies]?.isResinous) {
      this._spawnSapSplashBurst(burstOrigin, effectiveForce);
    }
    if (strikeResult && strikeResult.geodeCrystalShatter) {
      if (this.sound && typeof this.sound.playGeodeCrystalShatter === 'function') {
        this.sound.playGeodeCrystalShatter();
      }
      this._spawnGeodeCrystalBurst(burstOrigin, 1.5);
    }
    if (strikeResult && (strikeResult.lightningFissureShatter || strikeResult.emberTempered)) {
      if (
        strikeResult.lightningFissureShatter &&
        this.sound &&
        typeof this.sound.playLightningFissureShatter === 'function'
      ) {
        this.sound.playLightningFissureShatter();
      }
      this._spawnSparkBurst(burstOrigin, strikeResult.lightningFissureShatter ? 1.55 : 0.95);
    }
    this.fractureLog(effectiveForce, burstOrigin, axeVelocity, weather);
  }

  /**
   * Sprays a glittering burst of amethyst & quartz crystal shards when cleaving a Mineralized Geode round!
   */
  _spawnGeodeCrystalBurst(origin, intensity = 1.0) {
    const count = Math.floor(18 + intensity * 12);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.sawdustGeo, this.geodeCrystalMat);
      mesh.scale.setScalar(1.35);
      mesh.position.copy(origin);
      this.particleGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const spd = (2.2 + Math.random() * 4.2) * intensity;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * spd,
        1.6 + Math.random() * 3.4,
        Math.sin(angle) * spd
      );
      const rotVel = new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18
      );

      this.particles.push({
        mesh,
        velocity,
        rotVel,
        settled: false,
        isSpark: false,
        life: 99,
        halfH: 0.007
      });
    }
  }

  /**
   * Shears off one of the bulbous 3D hemispherical Birdseye Burl Outgrowth domes on `burl_maple`
   * as an independent rolling `cannon-es` rigid body!
   */
  _shearBurlOutgrowth(logPos, effectiveForce) {
    const unsheared = this.burlOutgrowthMeshes.filter((b) => !b.sheared);
    if (unsheared.length === 0) {
      this._spawnPartialSideSlab(logPos, effectiveForce);
      return;
    }

    const targetSide = this.aimOffsetX >= 0 ? 1 : -1;
    const chosen =
      unsheared.find((b) => b.dir === targetSide) || unsheared[0];
    chosen.sheared = true;
    chosen.mesh.visible = false;

    if (this.sound && typeof this.sound.playBurlShear === 'function') {
      this.sound.playBurlShear();
    }

    const burlGeo = new THREE.SphereGeometry(0.058, 12, 10);
    const burlMesh = new THREE.Mesh(burlGeo, this.barkMaterial);
    burlMesh.scale.set(1.18, 0.92, 1.15);
    burlMesh.castShadow = true;
    burlMesh.receiveShadow = true;

    const worldA = chosen.angle + this.logRotationY;
    const sx = logPos.x + Math.cos(worldA) * (this.logRadius * 0.98);
    const sy = logPos.y + 0.04;
    const sz = logPos.z + Math.sin(worldA) * (this.logRadius * 0.98);
    burlMesh.position.set(sx, sy, sz);
    this.rootGroup.add(burlMesh);

    const body = new CANNON.Body({
      mass: 0.95,
      material: this.physMaterials.woodPhysMat,
      linearDamping: 0.08,
      angularDamping: 0.14
    });
    body.addShape(new CANNON.Sphere(0.056));
    body.position.set(sx, sy, sz);
    body.velocity.set(
      Math.cos(worldA) * 3.1 * effectiveForce,
      1.35 * effectiveForce,
      Math.sin(worldA) * 3.1 * effectiveForce
    );
    body.angularVelocity.set(
      (Math.random() - 0.5) * 9,
      (Math.random() - 0.5) * 9,
      (Math.random() - 0.5) * 9
    );
    body.userData = { label: 'ShearedBurlDome', hasKnocked: false };
    this.world.addBody(body);
    this.splitPieces.push({ mesh: burlMesh, body, isSplinter: false });
  }

  /**
   * Sprays a burst of glistening golden-amber Pine Pitch / Sap droplets when chopping resinous logs!
   */
  _spawnSapSplashBurst(origin, intensity = 1.0) {
    const count = Math.floor(14 + intensity * 10);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.sawdustGeo, this.sapDropMat);
      mesh.position.copy(origin);
      this.particleGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const spd = (1.6 + Math.random() * 3.2) * intensity;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * spd,
        1.2 + Math.random() * 2.8,
        Math.sin(angle) * spd
      );
      const rotVel = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      );

      this.particles.push({
        mesh,
        velocity,
        rotVel,
        settled: false,
        isSpark: false,
        life: 99,
        halfH: 0.006
      });
    }
  }

  /**
   * Lops off one of the diverging 3D Y-fork upper branches on `forked_apple` as an independent rigid body.
   */
  _shearForkLimb(logPos, effectiveForce) {
    const unsheared = this.forkLimbMeshes.filter((f) => !f.sheared);
    if (unsheared.length === 0) {
      this._spawnPartialSideSlab(logPos, effectiveForce);
      return;
    }

    // Pick the branch on the aimed side, or the first remaining branch
    const targetSide = this.aimOffsetX >= 0 ? 1 : -1;
    const chosen =
      unsheared.find((f) => f.dir === targetSide) || unsheared[0];
    chosen.sheared = true;
    chosen.mesh.visible = false;

    if (this.sound && typeof this.sound.playBranchLop === 'function') {
      this.sound.playBranchLop();
    }

    const r = this.logRadius * 0.54;
    const h = this.logHeight * 0.52;
    const limbGeo = new THREE.CylinderGeometry(r * 0.9, r, h, 14);
    const limbMesh = new THREE.Mesh(limbGeo, [
      this.barkMaterial,
      this.endGrainMaterial,
      this.splitWoodMaterial
    ]);
    limbMesh.castShadow = true;
    limbMesh.receiveShadow = true;

    const sx = logPos.x + chosen.dir * (this.logRadius * 0.55);
    const sy = logPos.y + this.logHeight * 0.24;
    const sz = logPos.z;
    limbMesh.position.set(sx, sy, sz);
    this.rootGroup.add(limbMesh);

    const body = new CANNON.Body({
      mass: 1.25,
      material: this.physMaterials.woodPhysMat,
      linearDamping: 0.08,
      angularDamping: 0.14
    });
    body.addShape(new CANNON.Cylinder(r * 0.9, r, h, 10));
    body.position.set(sx, sy, sz);
    body.velocity.set(
      chosen.dir * (2.6 + Math.random() * 1.4) * effectiveForce,
      1.35 * effectiveForce,
      (Math.random() - 0.5) * 1.6
    );
    body.angularVelocity.set(
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5,
      -chosen.dir * 7.5
    );
    body.userData = { label: 'ShearedForkLimb', hasKnocked: false };
    this.world.addBody(body);
    this.splitPieces.push({ mesh: limbMesh, body, isSplinter: false });
  }

  /**
   * Shears off an individual 3D basal root buttress flare from an Irregular Stump or Boss Round.
   */
  _shearRootButtress(logPos, effectiveForce) {
    const unsheared = this.rootFlareMeshes.filter((f) => !f.sheared);
    if (unsheared.length === 0) {
      this._spawnPartialSideSlab(logPos, effectiveForce);
      return;
    }

    const chosen = unsheared[0];
    chosen.sheared = true;
    chosen.mesh.visible = false;

    if (this.sound && typeof this.sound.playBranchLop === 'function') {
      this.sound.playBranchLop();
    }

    const flareGeo = new THREE.ConeGeometry(0.075, 0.26, 7);
    const flareMesh = new THREE.Mesh(flareGeo, this.barkMaterial);
    flareMesh.castShadow = true;
    flareMesh.receiveShadow = true;

    const worldA = chosen.angle + this.logRotationY;
    const sx = logPos.x + Math.cos(worldA) * (this.logRadius * 0.96);
    const sy = logPos.y - this.logHeight * 0.2;
    const sz = logPos.z + Math.sin(worldA) * (this.logRadius * 0.96);
    flareMesh.position.set(sx, sy, sz);
    this.rootGroup.add(flareMesh);

    const body = new CANNON.Body({
      mass: 0.85,
      material: this.physMaterials.woodPhysMat,
      linearDamping: 0.1,
      angularDamping: 0.16
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.05, 0.11, 0.05)));
    body.position.set(sx, sy, sz);
    body.velocity.set(
      Math.cos(worldA) * 2.8 * effectiveForce,
      1.1 * effectiveForce,
      Math.sin(worldA) * 2.8 * effectiveForce
    );
    body.angularVelocity.set(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8
    );
    body.userData = { label: 'ShearedRootButtress', hasKnocked: false };
    this.world.addBody(body);
    this.splitPieces.push({ mesh: flareMesh, body, isSplinter: false });
  }

  /**
   * Pops all planted 3D steel splitting wedges out as dynamic rigid bodies when the log cleaves apart.
   */
  _popPlantedWedgeBody(logPos, effectiveForce = 1.0) {
    if (this.sound && typeof this.sound.playWedgeExtract === 'function') {
      this.sound.playWedgeExtract(false);
    }
    const forgedMat = new THREE.MeshStandardMaterial({
      color: 0x3b424c,
      roughness: 0.32,
      metalness: 0.9
    });
    const list =
      this.plantedWedges.length > 0
        ? this.plantedWedges
        : this.plantedWedge
        ? [this.plantedWedge]
        : [];

    list.forEach((w, idx) => {
      const wedgeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.12, 0.044),
        forgedMat
      );
      wedgeMesh.castShadow = true;
      const wx = logPos.x + (w ? w.localX : 0);
      const wy = logPos.y + this.logHeight * 0.45;
      const wz = logPos.z;
      wedgeMesh.position.set(wx, wy, wz);
      this.rootGroup.add(wedgeMesh);

      const body = new CANNON.Body({
        mass: 1.4,
        material: this.physMaterials.steelPhysMat,
        linearDamping: 0.1,
        angularDamping: 0.15
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.012, 0.06, 0.022)));
      body.position.set(wx, wy, wz);
      const sideSign = idx === 0 ? -1 : 1;
      body.velocity.set(
        sideSign * (0.9 + Math.random() * 0.8),
        (1.85 + idx * 0.3) * Math.min(1.4, effectiveForce),
        -0.8 - Math.random() * 0.8
      );
      body.angularVelocity.set(6.5, (Math.random() - 0.5) * 5, 4.2 * sideSign);
      body.userData = { label: `PoppedSteelWedge_${idx}` };
      this.world.addBody(body);
      this.splitPieces.push({ mesh: wedgeMesh, body, isSplinter: true });
    });
  }

  /**
   * Shears off a physical 3D side bark slab when a heavy strike partially cleaves a tough multi-hit round.
   */
  _spawnPartialSideSlab(logPos, effectiveForce) {
    const side = this.aimOffsetX >= 0 ? 1 : -1;
    const materials = [this.barkMaterial, this.endGrainMaterial, this.splitWoodMaterial];
    const startA = side > 0 ? -0.45 : Math.PI - 0.45;
    const endA = side > 0 ? 0.45 : Math.PI + 0.45;

    const { geometry, halfExtents } = createSplitLogSectorGeometry(
      this.logRadius * 0.55,
      this.logHeight * 0.92,
      startA,
      endA,
      6,
      7,
      this.knotAngles,
      this.spiralTwist
    );

    const slabMesh = new THREE.Mesh(geometry, materials);
    slabMesh.castShadow = true;
    slabMesh.receiveShadow = true;
    const sx = logPos.x + side * (this.logRadius * 0.78);
    const sy = logPos.y + 0.02;
    const sz = logPos.z;
    slabMesh.position.set(sx, sy, sz);
    this.rootGroup.add(slabMesh);

    const body = new CANNON.Body({
      mass: 0.95,
      material: this.physMaterials.woodPhysMat,
      linearDamping: 0.08,
      angularDamping: 0.14
    });
    body.addShape(
      new CANNON.Box(
        new CANNON.Vec3(
          Math.max(0.024, halfExtents.x * 0.8),
          this.logHeight * 0.44,
          Math.max(0.024, halfExtents.z * 0.8)
        )
      )
    );
    body.position.set(sx, sy, sz);
    body.velocity.set(
      side * (2.2 + Math.random() * 1.4) * effectiveForce,
      0.95 * effectiveForce,
      (Math.random() - 0.5) * 1.2
    );
    body.angularVelocity.set(
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 4,
      -side * 6.5
    );
    body.userData = { label: 'ShearedBarkSlab', hasKnocked: false };
    this.world.addBody(body);
    this.splitPieces.push({ mesh: slabMesh, body, isSplinter: false });
  }

  /**
   * Fractures / splits the intact log along the vertical wood grain into multiple rigid-body
   * wedge pieces, 3D physical wood splinters, and a burst of wood chips & sawdust.
   */
  fractureLog(
    swingForce = 1.0,
    impactPoint = null,
    axeVelocity = null,
    weather = 'sun'
  ) {
    if (this.isLogSplit || !this.intactLog) return;

    const logPos = new THREE.Vector3().copy(this.intactLog.body.position);
    const logQuat = new THREE.Quaternion().copy(this.intactLog.body.quaternion);
    const logDef = LOG_TYPES[this.currentSpecies] || LOG_TYPES.pine;
    const hadPlantedWedge = this.plantedWedges.length > 0 || Boolean(this.plantedWedge);

    this._clearIntactLog();
    this.isLogSplit = true;
    this.aimReticleGroup.visible = false;

    const rawSpeed = axeVelocity ? axeVelocity.length() * 0.45 : 12.2 * swingForce;
    const isFrozen = weather === 'snow' || Boolean(logDef.isFrozenLog);
    // Frozen wood in Snow/Frost (or Permafrost Tamarack) shatters with higher brittle velocity!
    const brittleMult = isFrozen ? 1.32 : 1.0;
    const effectiveForce = Math.max(0.35, swingForce * brittleMult);
    this.lastImpactSpeed = Math.max(5.8, Math.min(24.5, rawSpeed));

    if (hadPlantedWedge) {
      this._popPlantedWedgeBody(logPos, effectiveForce);
      this.plantedWedge = null;
      this.plantedWedges = [];
      this.tandemCrackBridge = null;
    }

    if (this.sound) {
      if (logDef.isBoss && typeof this.sound.playBossSplit === 'function') {
        this.sound.playBossSplit();
      } else {
        this.sound.playWoodSplit(effectiveForce, isFrozen);
      }
    }

    // Shift sector angles slightly based on lateral aimOffsetX so off-center splits produce
    // an asymmetric slab + larger main round!
    const asymShift = (this.aimOffsetX / this.logRadius) * 0.32;

    const sectorDefs = logDef.isBoss
      ? [
          { start: -Math.PI * 0.48, end: -0.05, mass: 2.2, sideX: 1.15, sideZ: -0.5 },
          { start: -0.05, end: Math.PI * 0.32, mass: 1.9, sideX: 1.1, sideZ: 0.2 },
          { start: Math.PI * 0.32, end: Math.PI * 0.56, mass: 1.5, sideX: 0.45, sideZ: 0.85 },
          { start: Math.PI * 0.56, end: Math.PI * 0.96, mass: 2.1, sideX: -1.1, sideZ: 0.45 },
          { start: Math.PI * 0.96, end: Math.PI * 1.28, mass: 1.8, sideX: -1.15, sideZ: -0.25 },
          { start: Math.PI * 1.28, end: Math.PI * 1.52, mass: 1.5, sideX: -0.45, sideZ: -0.85 }
        ]
      : isFrozen || effectiveForce >= 0.9
      ? [
          {
            start: -Math.PI * 0.48 + asymShift,
            end: 0.12,
            mass: 1.85,
            sideX: 1,
            sideZ: -0.35
          },
          {
            start: 0.12,
            end: Math.PI * 0.48 - asymShift,
            mass: 1.45,
            sideX: 1,
            sideZ: 0.45
          },
          {
            start: Math.PI * 0.52 - asymShift,
            end: Math.PI * 1.08,
            mass: 1.75,
            sideX: -1,
            sideZ: 0.35
          },
          {
            start: Math.PI * 1.08,
            end: Math.PI * 1.48 + asymShift,
            mass: 1.35,
            sideX: -1,
            sideZ: -0.45
          }
        ]
      : [
          {
            start: -Math.PI * 0.48 + asymShift,
            end: Math.PI * 0.42 - asymShift,
            mass: 2.8,
            sideX: 1,
            sideZ: 0.05
          },
          {
            start: Math.PI * 0.42 - asymShift,
            end: Math.PI * 0.62,
            mass: 0.8,
            sideX: 0.25,
            sideZ: 0.9
          },
          {
            start: Math.PI * 0.62,
            end: Math.PI * 1.52 + asymShift,
            mass: 2.8,
            sideX: -1,
            sideZ: -0.05
          }
        ];

    const materials = [this.barkMaterial, this.endGrainMaterial, this.splitWoodMaterial];

    sectorDefs.forEach((def, idx) => {
      const { geometry, centroidOffset, halfExtents } = createSplitLogSectorGeometry(
        this.logRadius,
        this.logHeight,
        def.start,
        def.end,
        10,
        idx + 1,
        this.knotAngles,
        this.spiralTwist
      );

      const pieceMesh = new THREE.Mesh(geometry, materials);
      pieceMesh.castShadow = true;
      pieceMesh.receiveShadow = true;
      pieceMesh.name = `SplitLogPiece_${idx}`;

      const worldCentroid = centroidOffset.clone().applyQuaternion(logQuat).add(logPos);
      pieceMesh.position.copy(worldCentroid);
      pieceMesh.quaternion.copy(logQuat);
      this.rootGroup.add(pieceMesh);

      const midAngle = (def.start + def.end) * 0.5;
      const body = new CANNON.Body({
        mass: def.mass,
        material: this.physMaterials.woodPhysMat,
        linearDamping: 0.08,
        angularDamping: 0.14
      });

      const shape = new CANNON.Box(
        new CANNON.Vec3(
          Math.max(0.032, halfExtents.x * 0.85),
          this.logHeight * 0.48,
          Math.max(0.032, halfExtents.z * 0.85)
        )
      );
      const shapeQuat = new CANNON.Quaternion();
      shapeQuat.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -midAngle);
      body.addShape(shape, new CANNON.Vec3(0, 0, 0), shapeQuat);

      body.position.set(worldCentroid.x, worldCentroid.y, worldCentroid.z);
      body.quaternion.set(logQuat.x, logQuat.y, logQuat.z, logQuat.w);

      // If the Chopping Block Tire Collar is active, keep split sectors more upright on the block
      // so the player can follow up with a Kindling Quarter-Chop!
      const collarRestraint = this.collarActive ? 0.38 : 1.0;
      const baseLatSpeed = (2.35 + (idx % 2) * 0.65) * effectiveForce * collarRestraint;
      const vx = def.sideX * baseLatSpeed + (Math.random() - 0.5) * 0.45 * collarRestraint;
      const vy = (0.75 + Math.random() * 0.65) * Math.min(1.45, effectiveForce) * collarRestraint;
      const vz = def.sideZ * (1.25 + Math.random() * 0.6) * effectiveForce * collarRestraint;

      body.velocity.set(vx, vy, vz);

      const rollZ = -def.sideX * (5.2 + Math.random() * 2.4) * effectiveForce * collarRestraint;
      const pitchX = def.sideZ * (2.6 + Math.random() * 1.8) * effectiveForce * collarRestraint;
      const yawY = (Math.random() - 0.5) * 3.2 * collarRestraint;
      body.angularVelocity.set(pitchX, yawY, rollZ);
      body.userData = { label: `SplitLogPiece_${idx}`, hasKnocked: false, hasRolled: false };

      body.addEventListener('collide', (ev) => {
        const impactVel = Math.abs(ev.contact.getImpactVelocityAlongNormal());
        if (!body.userData.hasKnocked && impactVel > 1.4) {
          body.userData.hasKnocked = true;
          if (this.sound) {
            this.sound.playWoodKnock(Math.min(1.15, impactVel / 5.5), false);
          }
        } else if (
          body.userData.hasKnocked &&
          !body.userData.hasRolled &&
          impactVel > 0.65
        ) {
          body.userData.hasRolled = true;
          if (this.sound) {
            this.sound.playWoodKnock(Math.min(0.85, impactVel / 5.5), true);
          }
        }
      });

      this.world.addBody(body);
      this.splitPieces.push({ mesh: pieceMesh, body, isSplinter: false });
    });

    // Spawn 8 to 14 rigid-body 3D wood splinters/slivers along the cleavage line
    const splinterCount = Math.floor(7 + effectiveForce * 4.5);
    for (let s = 0; s < splinterCount; s++) {
      const sw = 0.016 + Math.random() * 0.018;
      const sh = 0.09 + Math.random() * 0.16;
      const sd = 0.022 + Math.random() * 0.028;

      const sGeo = new THREE.BoxGeometry(sw, sh, sd);
      const sMesh = new THREE.Mesh(
        sGeo,
        s % 3 === 0 ? this.barkMaterial : this.splitWoodMaterial
      );
      sMesh.castShadow = true;
      sMesh.receiveShadow = true;

      const side = s % 2 === 0 ? 1 : -1;
      const sx = logPos.x + this.aimOffsetX + side * (0.025 + Math.random() * 0.05);
      const sy = logPos.y + (Math.random() - 0.2) * 0.16;
      const sz = logPos.z + (Math.random() - 0.5) * 0.18;

      sMesh.position.set(sx, sy, sz);
      this.rootGroup.add(sMesh);

      const sBody = new CANNON.Body({
        mass: 0.12,
        material: this.physMaterials.woodPhysMat,
        linearDamping: 0.1,
        angularDamping: 0.15
      });
      sBody.addShape(new CANNON.Box(new CANNON.Vec3(sw / 2, sh / 2, sd / 2)));
      sBody.position.set(sx, sy, sz);
      sBody.quaternion.setFromEuler(
        (Math.random() - 0.5) * 0.5,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 0.5
      );

      sBody.velocity.set(
        side * (2.6 + Math.random() * 3.8) * effectiveForce,
        (1.6 + Math.random() * 2.8) * effectiveForce,
        (Math.random() - 0.5) * 4.2 * effectiveForce
      );
      sBody.angularVelocity.set(
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 16
      );
      sBody.userData = { label: `WoodSplinter_${s}` };

      this.world.addBody(sBody);
      this.splitPieces.push({ mesh: sMesh, body: sBody, isSplinter: true });
    }

    const burstOrigin = impactPoint
      ? impactPoint.clone()
      : new THREE.Vector3(logPos.x, logPos.y + this.logHeight * 0.35, logPos.z);
    this._spawnWoodChipBurst(burstOrigin, effectiveForce, weather);
  }

  /**
   * Quarters collar-held split sectors on the chopping block into 8 flying cordwood kindling sticks!
   */
  shatterSplitPiecesIntoKindling(weather = 'sun') {
    if (!this.isLogSplit || this.hasShatteredKindling) return false;
    this.hasShatteredKindling = true;

    if (this.sound && typeof this.sound.playKindlingShatter === 'function') {
      this.sound.playKindlingShatter();
    }

    // Remove large sector pieces and replace them with 8 crisp kindling quarter-sticks
    for (let i = this.splitPieces.length - 1; i >= 0; i--) {
      const piece = this.splitPieces[i];
      if (!piece.isSplinter) {
        this.rootGroup.remove(piece.mesh);
        if (piece.mesh.geometry) piece.mesh.geometry.dispose();
        this.world.removeBody(piece.body);
        this.splitPieces.splice(i, 1);
      }
    }

    const logTopY = this.blockHeight + this.logHeight * 0.5;
    const materials = [this.barkMaterial, this.endGrainMaterial, this.splitWoodMaterial];
    for (let k = 0; k < 8; k++) {
      const startA = (k / 8) * Math.PI * 2;
      const endA = ((k + 0.92) / 8) * Math.PI * 2;
      const midA = (startA + endA) * 0.5;

      const { geometry, halfExtents } = createSplitLogSectorGeometry(
        this.logRadius * 0.72,
        this.logHeight * 0.96,
        startA,
        endA,
        5,
        k + 10,
        [],
        0
      );

      const stickMesh = new THREE.Mesh(geometry, materials);
      stickMesh.castShadow = true;
      stickMesh.receiveShadow = true;
      const sx = this.blockPosition.x + Math.cos(midA) * (this.logRadius * 0.38);
      const sy = logTopY;
      const sz = this.blockPosition.z + Math.sin(midA) * (this.logRadius * 0.38);
      stickMesh.position.set(sx, sy, sz);
      this.rootGroup.add(stickMesh);

      const body = new CANNON.Body({
        mass: 0.65,
        material: this.physMaterials.woodPhysMat,
        linearDamping: 0.08,
        angularDamping: 0.14
      });
      body.addShape(
        new CANNON.Box(
          new CANNON.Vec3(
            Math.max(0.022, halfExtents.x * 0.8),
            this.logHeight * 0.45,
            Math.max(0.022, halfExtents.z * 0.8)
          )
        )
      );
      body.position.set(sx, sy, sz);
      body.velocity.set(
        Math.cos(midA) * (3.1 + Math.random() * 1.4),
        1.5 + Math.random() * 1.1,
        Math.sin(midA) * (3.1 + Math.random() * 1.4)
      );
      body.angularVelocity.set(
        Math.sin(midA) * 6.5,
        (Math.random() - 0.5) * 5,
        -Math.cos(midA) * 6.5
      );
      body.userData = { label: `KindlingStick_${k}`, hasKnocked: false };
      this.world.addBody(body);
      this.splitPieces.push({ mesh: stickMesh, body, isSplinter: false });
    }

    const burstOrigin = new THREE.Vector3(
      this.blockPosition.x,
      this.blockHeight + this.logHeight * 0.45,
      this.blockPosition.z
    );
    this._spawnWoodChipBurst(burstOrigin, 1.35, weather);
    return true;
  }

  /**
   * Spawns a burst of incandescent orange-gold metal sparks when the blade hits an iron hazard or knot.
   */
  _spawnSparkBurst(origin, intensity = 1.0) {
    this.sparkLight.position.copy(origin).sub(this.blockPosition);
    this.sparkLight.intensity = 4.5 * intensity;
    this.sparkLightTimer = 0.18;

    const count = Math.floor(24 + intensity * 16);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      mesh.position.copy(origin);
      this.particleGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const spd = (2.8 + Math.random() * 5.5) * intensity;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * spd,
        1.8 + Math.random() * 4.2,
        Math.sin(angle) * spd
      );
      const rotVel = new THREE.Vector3(
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 25
      );

      this.particles.push({
        mesh,
        velocity,
        rotVel,
        settled: false,
        isSpark: true,
        life: 0.35 + Math.random() * 0.35,
        halfH: 0.005
      });
    }
  }

  /**
   * Spawns wood chips, bark fragments, sawdust, and frosty ice crystals (in snow weather).
   */
  _spawnWoodChipBurst(origin, force, weather = 'sun') {
    const totalParticles = Math.min(95, Math.floor(50 + force * 30));
    for (let i = 0; i < totalParticles; i++) {
      const isSawdust = i > totalParticles * 0.58;
      const isLarge = i < totalParticles * 0.25;
      const geo = isSawdust
        ? this.sawdustGeo
        : isLarge
        ? this.chipGeoLarge
        : this.chipGeoSmall;
      const mat =
        weather === 'snow' && i % 5 === 0
          ? this.frostChipMat
          : i % 4 === 0
          ? this.barkMaterial
          : this.splitWoodMaterial;

      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !isSawdust;
      mesh.position.set(
        origin.x + (Math.random() - 0.5) * 0.08,
        origin.y + (Math.random() - 0.5) * 0.14,
        origin.z + (Math.random() - 0.5) * 0.18
      );
      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      this.particleGroup.add(mesh);

      const side = i % 2 === 0 ? 1 : -1;
      const speedScale = isSawdust ? 0.65 : 1.0;
      const velocity = new THREE.Vector3(
        side * (1.5 + Math.random() * 4.5) * force * speedScale,
        (1.4 + Math.random() * 3.8) * force * speedScale,
        (Math.random() - 0.5) * 4.8 * force * speedScale
      );

      const rotVel = new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18
      );

      this.particles.push({
        mesh,
        velocity,
        rotVel,
        settled: false,
        isSpark: false,
        life: 99,
        halfH: isSawdust ? 0.005 : 0.008
      });
    }
  }

  /**
   * Synchronizes Three.js meshes with cannon-es rigid bodies and steps wood-chip & spark particles.
   */
  update(dt, windVector = null) {
    if (this.sparkLightTimer > 0) {
      this.sparkLightTimer = Math.max(0, this.sparkLightTimer - dt);
      this.sparkLight.intensity = (this.sparkLightTimer / 0.18) * 4.5;
    }

    if (this.intactLog) {
      this.intactLog.mesh.position.copy(this.intactLog.body.position);
      this.intactLog.mesh.quaternion.copy(this.intactLog.body.quaternion);
    }

    for (const piece of this.splitPieces) {
      piece.mesh.position.copy(piece.body.position);
      piece.mesh.quaternion.copy(piece.body.quaternion);
    }

    const gravity = -9.81;
    const blockX = this.blockPosition.x;
    const blockZ = this.blockPosition.z;
    const blockR2 = this.blockRadius * this.blockRadius;
    const blockTop = this.blockHeight;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.isSpark) {
        p.life -= dt;
        if (p.life <= 0) {
          this.particleGroup.remove(p.mesh);
          this.particles.splice(i, 1);
          continue;
        }
      }

      if (p.settled) continue;

      p.velocity.y += gravity * dt;
      if (windVector) {
        p.velocity.x += windVector.x * 1.4 * dt;
        p.velocity.z += windVector.z * 1.4 * dt;
      }
      p.mesh.position.addScaledVector(p.velocity, dt);

      p.mesh.rotation.x += p.rotVel.x * dt;
      p.mesh.rotation.y += p.rotVel.y * dt;
      p.mesh.rotation.z += p.rotVel.z * dt;

      // Check collision with top/sides of the chopping block
      const dx = p.mesh.position.x - blockX;
      const dz = p.mesh.position.z - blockZ;
      const dist2 = dx * dx + dz * dz;

      if (
        dist2 < blockR2 &&
        p.mesh.position.y <= blockTop + p.halfH &&
        p.mesh.position.y > blockTop - 0.12 &&
        p.velocity.y < 0
      ) {
        p.mesh.position.y = blockTop + p.halfH;
        p.velocity.y = -p.velocity.y * (p.isSpark ? 0.55 : 0.28);
        p.velocity.x *= 0.62;
        p.velocity.z *= 0.62;
        p.rotVel.multiplyScalar(0.5);
        if (!p.isSpark && p.velocity.lengthSq() < 0.04) {
          p.settled = true;
          p.mesh.rotation.x = 0;
          p.mesh.rotation.z = 0;
        }
      }

      // Check collision with the lawn ground (y = 0)
      if (p.mesh.position.y <= p.halfH) {
        p.mesh.position.y = p.halfH;
        if (Math.abs(p.velocity.y) > 0.45) {
          p.velocity.y = -p.velocity.y * (p.isSpark ? 0.5 : 0.25);
          p.velocity.x *= 0.55;
          p.velocity.z *= 0.55;
          p.rotVel.multiplyScalar(0.45);
        } else if (!p.isSpark) {
          p.settled = true;
          p.mesh.rotation.x = 0;
          p.mesh.rotation.z = 0;
        }
      }
    }
  }
}

/**
 * Procedurally constructs a 3D cylindrical wedge sector geometry cleaved along the vertical
 * wood grain, centered around its own local centroid `(0, 0, 0)`, with 3 material groups:
 *   Group 0: Outer curved bark face (`barkMaterial`)
 *   Group 1: Top & bottom cross-section caps (`endGrainMaterial`)
 *   Group 2: Inner radial split wood faces (`splitWoodMaterial`)
 */
function createSplitLogSectorGeometry(
  radius,
  height,
  startAngle,
  endAngle,
  arcSteps = 10,
  seed = 1,
  knotAngles = [],
  spiralTwist = 0
) {
  const halfH = height / 2;
  const heightSteps = 6;

  const midAngle = (startAngle + endAngle) * 0.5;
  const halfSpan = Math.max(0.05, (endAngle - startAngle) * 0.5);
  const centroidRadius = ((2 / 3) * radius * Math.sin(halfSpan)) / halfSpan;
  const centroidOffset = new THREE.Vector3(
    Math.cos(midAngle) * centroidRadius,
    0,
    Math.sin(midAngle) * centroidRadius
  );

  function grainWave(rFrac, yFrac, planeSeed) {
    let wave =
      Math.sin(rFrac * Math.PI * 2 + planeSeed * 1.7) * 0.006 * rFrac +
      Math.cos(yFrac * Math.PI * 1.5 + planeSeed) * 0.004 * rFrac;

    // Route interior split cleavage face around 3D branch knots (burl bulge on one side, socket on mating face)
    if (knotAngles && knotAngles.length > 0 && rFrac > 0.25) {
      for (let k = 0; k < knotAngles.length; k++) {
        const kyFrac = k % 2 === 0 ? 0.36 : 0.68;
        const dy = yFrac - kyFrac;
        const dr = rFrac - 0.68;
        const distSq = dy * dy * 3.5 + dr * dr * 4.0;
        if (distSq < 0.22) {
          const sign = planeSeed % 2 === 0 ? 1 : -1;
          wave += sign * Math.exp(-distSq * 14.0) * 0.095 * rFrac;
        }
      }
    }
    return wave;
  }

  const positions = [];
  const normals = [];
  const uvs = [];

  function pushTriangle(v0, v1, v2, uv0, uv1, uv2) {
    const e1 = new THREE.Vector3().subVectors(v1, v0);
    const e2 = new THREE.Vector3().subVectors(v2, v0);
    const n = new THREE.Vector3().crossVectors(e1, e2).normalize();

    [v0, v1, v2].forEach((v) => {
      positions.push(
        v.x - centroidOffset.x,
        v.y - centroidOffset.y,
        v.z - centroidOffset.z
      );
      normals.push(n.x, n.y, n.z);
    });
    [uv0, uv1, uv2].forEach((u) => {
      uvs.push(u.x, u.y);
    });
  }

  function pointOnSector(rFrac, angle, yFrac, whichPlane = 0) {
    const r = rFrac * radius;
    const y = (yFrac - 0.5) * height;
    const wave = whichPlane !== 0 ? grainWave(rFrac, yFrac, whichPlane) : 0;
    const helicalTwist = (yFrac - 0.5) * spiralTwist * rFrac;
    const a = angle + wave + helicalTwist;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  }

  // GROUP 0: Outer curved bark surface
  const group0Start = 0;
  for (let iy = 0; iy < heightSteps; iy++) {
    const yf0 = iy / heightSteps;
    const yf1 = (iy + 1) / heightSteps;
    for (let ia = 0; ia < arcSteps; ia++) {
      const af0 = ia / arcSteps;
      const af1 = (ia + 1) / arcSteps;
      const a0 = startAngle + af0 * (endAngle - startAngle);
      const a1 = startAngle + af1 * (endAngle - startAngle);

      const p00 = pointOnSector(1, a0, yf0, 0);
      const p10 = pointOnSector(1, a1, yf0, 0);
      const p01 = pointOnSector(1, a0, yf1, 0);
      const p11 = pointOnSector(1, a1, yf1, 0);

      const u0 = a0 / (Math.PI * 2);
      const u1 = a1 / (Math.PI * 2);

      pushTriangle(
        p00,
        p01,
        p11,
        new THREE.Vector2(u0, yf0),
        new THREE.Vector2(u0, yf1),
        new THREE.Vector2(u1, yf1)
      );
      pushTriangle(
        p00,
        p11,
        p10,
        new THREE.Vector2(u0, yf0),
        new THREE.Vector2(u1, yf1),
        new THREE.Vector2(u1, yf0)
      );
    }
  }
  const group0Count = positions.length / 3 - group0Start;

  // GROUP 1: Top & Bottom End-Grain Caps
  const group1Start = positions.length / 3;
  const centerTop = new THREE.Vector3(0, halfH, 0);
  const centerBot = new THREE.Vector3(0, -halfH, 0);
  const uvCenter = new THREE.Vector2(0.5, 0.5);

  for (let ia = 0; ia < arcSteps; ia++) {
    const a0 = startAngle + (ia / arcSteps) * (endAngle - startAngle);
    const a1 = startAngle + ((ia + 1) / arcSteps) * (endAngle - startAngle);

    const t0 = pointOnSector(1, a0, 1, 0);
    const t1 = pointOnSector(1, a1, 1, 0);
    const uvt0 = new THREE.Vector2(0.5 + Math.cos(a0) * 0.48, 0.5 + Math.sin(a0) * 0.48);
    const uvt1 = new THREE.Vector2(0.5 + Math.cos(a1) * 0.48, 0.5 + Math.sin(a1) * 0.48);

    pushTriangle(centerTop, t1, t0, uvCenter, uvt1, uvt0);

    const b0 = pointOnSector(1, a0, 0, 0);
    const b1 = pointOnSector(1, a1, 0, 0);
    pushTriangle(centerBot, b0, b1, uvCenter, uvt0, uvt1);
  }
  const group1Count = positions.length / 3 - group1Start;

  // GROUP 2: Inner Radial Split Wood Grain Faces
  const group2Start = positions.length / 3;
  const radialSteps = 4;

  for (let iy = 0; iy < heightSteps; iy++) {
    const yf0 = iy / heightSteps;
    const yf1 = (iy + 1) / heightSteps;

    for (let ir = 0; ir < radialSteps; ir++) {
      const rf0 = ir / radialSteps;
      const rf1 = (ir + 1) / radialSteps;

      const s00 = pointOnSector(rf0, startAngle, yf0, seed);
      const s10 = pointOnSector(rf1, startAngle, yf0, seed);
      const s01 = pointOnSector(rf0, startAngle, yf1, seed);
      const s11 = pointOnSector(rf1, startAngle, yf1, seed);

      pushTriangle(
        s00,
        s10,
        s11,
        new THREE.Vector2(rf0, yf0),
        new THREE.Vector2(rf1, yf0),
        new THREE.Vector2(rf1, yf1)
      );
      pushTriangle(
        s00,
        s11,
        s01,
        new THREE.Vector2(rf0, yf0),
        new THREE.Vector2(rf1, yf1),
        new THREE.Vector2(rf0, yf1)
      );

      const e00 = pointOnSector(rf0, endAngle, yf0, seed + 1);
      const e10 = pointOnSector(rf1, endAngle, yf0, seed + 1);
      const e01 = pointOnSector(rf0, endAngle, yf1, seed + 1);
      const e11 = pointOnSector(rf1, endAngle, yf1, seed + 1);

      pushTriangle(
        e00,
        e11,
        e10,
        new THREE.Vector2(rf0, yf0),
        new THREE.Vector2(rf1, yf1),
        new THREE.Vector2(rf1, yf0)
      );
      pushTriangle(
        e00,
        e01,
        e11,
        new THREE.Vector2(rf0, yf0),
        new THREE.Vector2(rf0, yf1),
        new THREE.Vector2(rf1, yf1)
      );
    }
  }
  const group2Count = positions.length / 3 - group2Start;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  geometry.addGroup(group0Start, group0Count, 0);
  geometry.addGroup(group1Start, group1Count, 1);
  geometry.addGroup(group2Start, group2Count, 2);
  geometry.computeBoundingBox();

  const bb = geometry.boundingBox;
  const halfExtents = new THREE.Vector3(
    (bb.max.x - bb.min.x) * 0.5,
    (bb.max.y - bb.min.y) * 0.5,
    (bb.max.z - bb.min.z) * 0.5
  );

  return { geometry, centroidOffset, halfExtents };
}
