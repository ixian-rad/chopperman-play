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
    this._refreshAimReticleVisual();
  }

  /**
   * Returns current grain alignment error (radians) and closest knot distance (meters).
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

    return {
      aimOffsetX: this.aimOffsetX,
      grainAngleError: foldedError,
      knotDistance: minKnotDist
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

    if (normOff > 0.65 || diag.knotDistance < 0.038) {
      // Danger red: glancing rim or directly over a knot!
      this.aimLineMat.color.setHex(0xef4444);
    } else if (normOff < 0.22 && diag.grainAngleError < 0.35) {
      // Sweet spot green: dead center & aligned with grain check line!
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
    this.frostChipMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.25,
      metalness: 0.1
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

    const mats = this._getMaterialsForSpecies(this.currentSpecies);
    this.barkMaterial = mats.barkMaterial;
    this.endGrainMaterial = mats.endGrainMaterial;
    this.splitWoodMaterial = mats.splitWoodMaterial;

    const logGeo = new THREE.CylinderGeometry(
      this.logRadius,
      this.logRadius * 1.02,
      this.logHeight,
      24
    );
    const logMats = [this.barkMaterial, this.endGrainMaterial, this.endGrainMaterial];
    const logMesh = new THREE.Mesh(logGeo, logMats);
    logMesh.castShadow = true;
    logMesh.receiveShadow = true;
    logMesh.name = `IntactTargetLog_${this.currentSpecies}`;

    // Natural grain check line across the top end-grain face (shows ideal split line!)
    this.grainCheckAngle = 0;
    const checkGeo = new THREE.BoxGeometry(0.007, 0.004, this.logRadius * 1.82);
    const checkMat = new THREE.MeshBasicMaterial({ color: 0x2b180a });
    const checkLine = new THREE.Mesh(checkGeo, checkMat);
    checkLine.position.y = this.logHeight / 2 + 0.0015;
    checkLine.rotation.y = this.grainCheckAngle;
    logMesh.add(checkLine);

    // Add 3D Protruding Branch Knots & Top Knot Whorl Indicators for knotty logs!
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
      logMesh.add(stubGroup);

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
      logMesh.add(topKnot);
    }

    // Group to hold partial-penetration 3D kerf cracks when a tough log takes multiple hits
    const kerfGroup = new THREE.Group();
    logMesh.add(kerfGroup);

    const startY = this.blockHeight + this.logHeight / 2;
    this.logRotationY = 0;
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

    this.intactLog = { mesh: logMesh, body: logBody, kerfGroup };
    this.isLogSplit = false;
    this._refreshAimReticleVisual();
  }

  _clearIntactLog() {
    if (this.intactLog) {
      this.rootGroup.remove(this.intactLog.mesh);
      this.intactLog.mesh.geometry.dispose();
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

    // CASE 1: Glancing / Off-Center Hazard Hit (sparks + bark chip + log tip/wobble)
    if (strikeResult && strikeResult.glancing) {
      if (this.sound) {
        this.sound.playSparkClang(effectiveForce);
        this.sound.playWoodKnock(0.7);
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

      // Spawn incandescent sparks from the chopping block's iron hazard collar
      const sparkOrigin = new THREE.Vector3(
        this.blockPosition.x + side * (this.blockRadius * 0.85),
        this.blockHeight + 0.02,
        this.blockPosition.z
      );
      this._spawnSparkBurst(sparkOrigin, effectiveForce);
      this._spawnWoodChipBurst(burstOrigin, effectiveForce * 0.4, weather);
      return;
    }

    // CASE 2: Partial Penetration / Wedged in Tough Hardwood or Knot
    if (strikeResult && !strikeResult.split) {
      if (this.sound) {
        this.sound.playWoodWedge(effectiveForce);
        if (strikeResult.hitKnot) {
          this.sound.playSparkClang(0.55);
        }
      }

      // Add a visible 3D darkened split kerf wedge scar into the intact log at aimOffsetX
      const depth = strikeResult.penetrationDepth || 0.08;
      const kerfGeo = new THREE.BoxGeometry(0.014, depth, this.logRadius * 1.85);
      const kerfMat = new THREE.MeshBasicMaterial({ color: 0x241308 });
      const kerfMesh = new THREE.Mesh(kerfGeo, kerfMat);
      kerfMesh.position.set(
        this.aimOffsetX,
        this.logHeight / 2 - depth * 0.48 + 0.003,
        0
      );
      kerfMesh.rotation.y = this.aimAngle - this.logRotationY;
      this.intactLog.kerfGroup.add(kerfMesh);

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
      this._spawnWoodChipBurst(burstOrigin, effectiveForce * 0.55, weather);
      return;
    }

    // CASE 3: Full Grain-Aligned Log Fracture!
    this.fractureLog(effectiveForce, burstOrigin, axeVelocity, weather);
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

    this._clearIntactLog();
    this.isLogSplit = true;
    this.aimReticleGroup.visible = false;

    const rawSpeed = axeVelocity ? axeVelocity.length() * 0.45 : 12.2 * swingForce;
    const isFrozen = weather === 'snow';
    // Frozen wood in Snow/Frost shatters with higher brittle velocity and more radial pieces!
    const brittleMult = isFrozen ? 1.32 : 1.0;
    const effectiveForce = Math.max(0.35, swingForce * brittleMult);
    this.lastImpactSpeed = Math.max(5.8, Math.min(24.5, rawSpeed));

    if (this.sound) {
      this.sound.playWoodSplit(effectiveForce, isFrozen);
    }

    // Shift sector angles slightly based on lateral aimOffsetX so off-center splits produce
    // an asymmetric slab + larger main round!
    const asymShift = (this.aimOffsetX / this.logRadius) * 0.32;

    const sectorDefs =
      isFrozen || effectiveForce >= 0.9
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
        idx + 1
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

      const baseLatSpeed = (2.35 + (idx % 2) * 0.65) * effectiveForce;
      const vx = def.sideX * baseLatSpeed + (Math.random() - 0.5) * 0.45;
      const vy = (0.75 + Math.random() * 0.65) * Math.min(1.45, effectiveForce);
      const vz = def.sideZ * (1.25 + Math.random() * 0.6) * effectiveForce;

      body.velocity.set(vx, vy, vz);

      const rollZ = -def.sideX * (5.2 + Math.random() * 2.4) * effectiveForce;
      const pitchX = def.sideZ * (2.6 + Math.random() * 1.8) * effectiveForce;
      const yawY = (Math.random() - 0.5) * 3.2;
      body.angularVelocity.set(pitchX, yawY, rollZ);
      body.userData = { label: `SplitLogPiece_${idx}`, hasKnocked: false };

      body.addEventListener('collide', (ev) => {
        if (
          !body.userData.hasKnocked &&
          Math.abs(ev.contact.getImpactVelocityAlongNormal()) > 1.8
        ) {
          body.userData.hasKnocked = true;
          if (this.sound) {
            this.sound.playWoodKnock(
              Math.min(1.0, Math.abs(ev.contact.getImpactVelocityAlongNormal()) / 6.0)
            );
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
  seed = 1
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
    return (
      Math.sin(rFrac * Math.PI * 2 + planeSeed * 1.7) * 0.006 * rFrac +
      Math.cos(yFrac * Math.PI * 1.5 + planeSeed) * 0.004 * rFrac
    );
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
    const a = angle + wave;
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
