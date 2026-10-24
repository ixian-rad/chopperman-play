import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createFlannelTexture, createDenimTexture } from './textures.js';
import {
  loadGLB,
  toFastPropMaterial,
  COSTUME_MODEL_URLS,
  AXE_MODEL_URLS,
  EXTRA_CLIP_URLS
} from './assetsLoader.js';
import { normalizeAxeId } from './rpgState.js';

/**
 * Playable Character Controller for SERGEY (with two switchable costumes: 'tee' and 'jacket',
 * 24-bone Meshy PBR rig, AnimationMixer with crossfades, and 4 attachable 3D GLB axes on RightHand),
 * plus the articulated procedural fallback rig & kinematic physics collider for log-splitting.
 */
export class HumanoidChopper {
  constructor(scene, world, physMaterials, choppingStation, soundEffects) {
    this.scene = scene;
    this.world = world;
    this.physMaterials = physMaterials;
    this.choppingStation = choppingStation;
    this.sound = soundEffects;

    // Swing state machine: 'IDLE' | 'DRAG_WINDUP' | 'WINDUP' | 'DOWNSWING' | 'IMPACT_HOLD' | 'WEDGED_PRY' | 'RECOVERY'
    this.state = 'IDLE';
    this.stateTime = 0;
    this.dragWindupRatio = 0;
    this.pryRockAngle = 0;
    this.idleClock = 0;
    this.swingForce = 1.0; // 0.2 to 1.6 (1.0 = 100% default)
    this.hasTriggeredSplit = false;
    this.whooshPlayed = false;
    this.onImpactCallback = null;

    // Mode & Locomotion state ('stump' | 'yard')
    this.interactionMode = 'stump';
    this.isMoving = false;
    this.isRunning = false;
    this.footstepTimer = 0;

    // Sergey assets-v2 state
    this.costume = 'tee';
    this.equippedAxeId = 'sergey';
    this.characterLoaded = false;
    this.axeAttachedTo = 'RightHand';
    this.currentAnimName = 'Axe_Stance';
    this._cheerTimer = 0;

    this._costumeRecords = {}; // costume -> { root, mixer, actions, rightHandBone, armScale }
    this._extraClips = {}; // 'Walk' | 'Run' -> THREE.AnimationClip
    this._axeTemplates = {}; // axeId -> THREE.Group
    this._activeCostumeRecord = null;

    this.prevBladePos = new THREE.Vector3();
    this.currentBladeVelocity = new THREE.Vector3();

    this.root = new THREE.Group();
    this.root.name = 'SergeyPlayerRoot';
    this.root.position.set(0, 0, -0.80);
    this.root.rotation.set(0, 0, 0);
    this.scene.add(this.root);

    // Fallback procedural rig group (hidden once Sergey GLB is loaded, still drives kinematic axe collider)
    this.fallbackRigGroup = new THREE.Group();
    this.fallbackRigGroup.name = 'FallbackProceduralRig';
    this.root.add(this.fallbackRigGroup);

    // Container for Sergey GLB character
    this.sergeyContainer = new THREE.Group();
    this.sergeyContainer.name = 'SergeyGLBContainer';
    this.root.add(this.sergeyContainer);

    // Socket attached to Sergey's RightHand bone
    this.rightHandSocket = new THREE.Group();
    this.rightHandSocket.name = 'RightHandAxeSocket';

    this.joints = {};
    this._buildArticulatedBody();
    this._buildAxeAndPhysics();
    this._applyPose(this._getPoseForState('IDLE', 0));
    this._syncPhysicsFromRig(1 / 60);
  }

  /**
   * Loads Sergey's GLB character (both costumes share the 24-bone Meshy skeleton),
   * extra walking/running armature clips, and all 4 axe GLBs in parallel so swapping is instant.
   */
  async initAssets(initialCostume = 'tee', initialAxeId = 'sergey') {
    this.costume = initialCostume === 'jacket' ? 'jacket' : 'tee';
    this.equippedAxeId = normalizeAxeId(initialAxeId);

    await this._loadExtraLocomotionClips();
    await Promise.all([
      this._ensureCostumeLoaded('tee'),
      this._ensureCostumeLoaded('jacket'),
      this._ensureAxeTemplateLoaded('sergey'),
      this._ensureAxeTemplateLoaded('double_bit'),
      this._ensureAxeTemplateLoaded('maul'),
      this._ensureAxeTemplateLoaded('golden')
    ]);
    await Promise.all([
      this.setCostume(this.costume),
      this.setAxeModel(this.equippedAxeId)
    ]);

    return this.characterLoaded;
  }

  async _loadExtraLocomotionClips() {
    if (this._extraClipsLoaded) return;
    try {
      const [walkGltf, runGltf] = await Promise.all([
        loadGLB(EXTRA_CLIP_URLS.walk),
        loadGLB(EXTRA_CLIP_URLS.run)
      ]);
      if (walkGltf?.animations?.length) {
        this._extraClips.Walk = this._sanitizeClip(walkGltf.animations[0], 'Walk');
      }
      if (runGltf?.animations?.length) {
        this._extraClips.Run = this._sanitizeClip(runGltf.animations[0], 'Run');
      }
      this._extraClipsLoaded = true;
    } catch {
      // Optional extra clips; built-in Casual_Walk is always present on character GLB
    }
  }

  /**
   * Removes horizontal root-motion drift on Hips.position and locks Armature.scale
   * so Sergey stays centered on `this.root.position` during locomotion and swings.
   */
  _sanitizeClip(clip, overrideName = null) {
    const cloned = clip.clone();
    if (overrideName) {
      cloned.name = overrideName;
    }
    cloned.tracks = cloned.tracks.filter((track) => {
      if (track.name.endsWith('Armature.scale') || track.name.endsWith('Armature.position')) {
        return false;
      }
      return true;
    });

    for (const track of cloned.tracks) {
      if (track.name.endsWith('Hips.position')) {
        const vals = track.values;
        for (let i = 0; i < vals.length; i += 3) {
          vals[i] = 0; // Lock local X root motion
          vals[i + 1] = Math.max(76, Math.min(106, vals[i + 1])); // Keep vertical hip bounce
          vals[i + 2] = 0; // Lock local Z root motion
        }
      }
    }

    // Trim Axe_Stance to its clean ready-stance segment (0.0s .. 1.05s) where Sergey holds the axe
    // in front of him at waist/chest level, avoiding the mid-clip overhead arm wave during idle
    if (cloned.name === 'Axe_Stance') {
      const maxTime = 1.05;
      for (const track of cloned.tracks) {
        const valueSize = track.getValueSize();
        let keepCount = 0;
        for (let i = 0; i < track.times.length; i++) {
          if (track.times[i] <= maxTime + 1e-4) {
            keepCount++;
          } else {
            break;
          }
        }
        if (keepCount >= 2 && keepCount < track.times.length) {
          track.times = track.times.slice(0, keepCount);
          track.values = track.values.slice(0, keepCount * valueSize);
        }
      }
      cloned.duration = maxTime;
    }

    return cloned;
  }

  async _ensureCostumeLoaded(target) {
    if (this._costumeRecords[target]) return true;
    const url = COSTUME_MODEL_URLS[target] || COSTUME_MODEL_URLS.tee;
    try {
      const gltf = await loadGLB(url);
      const modelRoot = gltf.scene;
      modelRoot.name = `Sergey_${target}`;

      let rightHandBone = null;
      let armatureNode = null;
      modelRoot.traverse((node) => {
        if (node.isMesh || node.isSkinnedMesh) {
          node.castShadow = false;
          node.receiveShadow = true;
          node.frustumCulled = false;
          if (node.material) {
            node.material = toFastPropMaterial(node.material, true, 0.04);
          }
        }
        if (node.name === 'RightHand') {
          rightHandBone = node;
        } else if (node.name === 'Armature') {
          armatureNode = node;
        }
      });

      // Normalize Sergey height to ~1.78m and ensure feet sit at y = 0
      modelRoot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelRoot);
      const size = new THREE.Vector3();
      box.getSize(size);
      if (size.y > 0.1 && (size.y < 1.4 || size.y > 2.1)) {
        const s = 1.78 / size.y;
        modelRoot.scale.multiplyScalar(s);
        modelRoot.updateMatrixWorld(true);
      }

      const mixer = new THREE.AnimationMixer(modelRoot);
      const actions = {};

      for (const rawClip of gltf.animations || []) {
        const clean = this._sanitizeClip(rawClip, rawClip.name);
        const action = mixer.clipAction(clean);
        actions[clean.name] = action;
      }
      for (const [extraName, extraClip] of Object.entries(this._extraClips)) {
        if (!actions[extraName]) {
          actions[extraName] = mixer.clipAction(extraClip);
        }
      }

      const armScale = armatureNode && armatureNode.scale.x > 0 ? armatureNode.scale.x : 0.01;

      this._costumeRecords[target] = {
        costume: target,
        root: modelRoot,
        mixer,
        actions,
        activeAction: null,
        rightHandBone,
        armScale
      };
      return true;
    } catch (err) {
      console.warn('Failed to load Sergey costume GLB, using fallback rig:', err);
      this.fallbackRigGroup.visible = true;
      return false;
    }
  }

  /**
   * Switches Sergey's costume ('tee' | 'jacket') and resolves when the GLB model is active.
   */
  async setCostume(costumeName = 'tee') {
    const target = costumeName === 'jacket' ? 'jacket' : 'tee';
    this.costume = target;

    await this._loadExtraLocomotionClips();
    const ok = await this._ensureCostumeLoaded(target);
    if (!ok) return false;

    // Hide all loaded costume roots and activate the chosen one
    for (const rec of Object.values(this._costumeRecords)) {
      if (rec.root.parent === this.sergeyContainer) {
        this.sergeyContainer.remove(rec.root);
      }
    }

    const activeRec = this._costumeRecords[target];
    if (activeRec) {
      this.sergeyContainer.add(activeRec.root);
      this._activeCostumeRecord = activeRec;
      this.characterLoaded = true;
      this.fallbackRigGroup.visible = false;

      // Attach the rightHandSocket to this costume's RightHand bone
      if (activeRec.rightHandBone) {
        this.axeAttachedTo = activeRec.rightHandBone.name || 'RightHand';
        activeRec.rightHandBone.add(this.rightHandSocket);
        // Compensate for Armature 0.01 cm-to-m scale so socket children are in metres
        const invScale = 1.0 / (activeRec.armScale || 0.01);
        this.rightHandSocket.scale.setScalar(invScale);
        // Place socket in Sergey's right palm (in bone cm coordinates)
        this.rightHandSocket.position.set(-1.0, 9.5, 1.5);
        this.rightHandSocket.rotation.set(Math.PI * 0.5, -0.15, Math.PI * 0.5);
      }

      // Start appropriate animation immediately (start Axe_Stance at 0.35s for natural grip pose)
      const desiredClip = this._getDesiredIdleOrMoveClip();
      this.playAnimation(
        desiredClip,
        0.05,
        true,
        desiredClip === 'Axe_Stance' ? 0.45 : 1.0,
        desiredClip === 'Axe_Stance' ? 0.35 : 0
      );
      activeRec.mixer.update(0.016);
      activeRec.root.updateMatrixWorld(true);
    }

    return true;
  }

  async _ensureAxeTemplateLoaded(normId) {
    if (this._axeTemplates[normId]) return true;
    const url = AXE_MODEL_URLS[normId] || AXE_MODEL_URLS.sergey;
    try {
      const gltf = await loadGLB(url);
      const rawScene = gltf.scene.clone(true);

      // Pre-orient each axe so the shaft always runs vertically along +Y
      // (pommel at -Y, head at +Y, blade facing forward)
      const orientGroup = new THREE.Group();
      orientGroup.add(rawScene);

      if (normId === 'double_bit') {
        // double_bit GLB has shaft along +X (pommel at -X, head at +X)
        rawScene.rotation.set(0, 0, Math.PI / 2);
      } else if (normId === 'maul') {
        // splitting_maul GLB has shaft diagonally from (-X,+Y) to (+X,-Y)
        rawScene.rotation.set(0, 0, 2.24);
      } else {
        // axe_sergey and axe_golden have shaft along +Y and blade facing -X
        rawScene.rotation.set(0, Math.PI, 0);
      }

      orientGroup.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(orientGroup);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const targetLen = normId === 'maul' ? 0.88 : 0.82;
      const maxAxis = Math.max(size.x, size.y, size.z, 0.001);
      const scale = targetLen / maxAxis;

      const normalizedAxe = new THREE.Group();
      normalizedAxe.name = `AxeGLB_${normId}`;
      orientGroup.scale.setScalar(scale);

      // Place grip point (~16% up from the bottom pommel) at local (0, 0, 0)
      const gripY = box.min.y + size.y * 0.16;
      orientGroup.position.set(
        -center.x * scale,
        -gripY * scale,
        -center.z * scale
      );

      orientGroup.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = false;
          c.receiveShadow = true;
          c.frustumCulled = false;
          if (c.material) {
            c.material = toFastPropMaterial(c.material, true, 0.05);
          }
        }
      });

      normalizedAxe.add(orientGroup);
      this._axeTemplates[normId] = normalizedAxe;
      return true;
    } catch (err) {
      console.warn(`Failed to load axe GLB (${normId}):`, err);
      return false;
    }
  }

  /**
   * Loads and attaches one of the 4 GLB axes ('sergey' | 'double_bit' | 'maul' | 'golden')
   * to Sergey's RightHand bone socket.
   */
  async setAxeModel(axeId = 'sergey') {
    const normId = normalizeAxeId(axeId);
    this.equippedAxeId = normId;

    const ok = await this._ensureAxeTemplateLoaded(normId);
    if (!ok) return false;

    // Clear previous axe children from rightHandSocket
    while (this.rightHandSocket.children.length > 0) {
      this.rightHandSocket.remove(this.rightHandSocket.children[0]);
    }

    const template = this._axeTemplates[normId];
    if (template) {
      const instance = template.clone(true);
      this.rightHandSocket.add(instance);
    }
    return true;
  }

  _getDesiredIdleOrMoveClip() {
    if (this._cheerTimer > 0) {
      return 'Victory_Cheer';
    }
    if (this.interactionMode === 'yard') {
      if (this.isMoving) {
        if (this.isRunning && this._activeCostumeRecord?.actions?.Run) {
          return 'Run';
        }
        return 'Casual_Walk';
      }
      return 'Idle';
    }
    return 'Axe_Stance';
  }

  /**
   * Crossfades Sergey's AnimationMixer to the specified clip name.
   */
  playAnimation(clipName, fadeDuration = 0.18, loop = true, timeScale = 1.0, startTime = 0) {
    const rec = this._activeCostumeRecord;
    if (!rec || !rec.mixer) {
      this.currentAnimName = clipName;
      return;
    }

    const action =
      rec.actions[clipName] ||
      rec.actions.Axe_Stance ||
      rec.actions.Idle ||
      Object.values(rec.actions)[0];
    if (!action) return;

    const resolvedName = action.getClip().name;
    this.currentAnimName = resolvedName;

    if (rec.activeAction === action && loop) {
      action.timeScale = timeScale;
      return;
    }

    action.enabled = true;
    const loopMode =
      loop && resolvedName === 'Axe_Stance'
        ? THREE.LoopPingPong
        : loop
        ? THREE.LoopRepeat
        : THREE.LoopOnce;
    action.setLoop(loopMode, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = resolvedName === 'Axe_Stance' && loop ? Math.min(timeScale, 0.45) : timeScale;

    if (!loop || rec.activeAction !== action) {
      action.reset();
      if (startTime > 0) {
        action.time = startTime;
      }
    }

    if (rec.activeAction && rec.activeAction !== action) {
      rec.activeAction.crossFadeTo(action, fadeDuration, false);
    }
    action.play();
    rec.activeAction = action;
  }

  /**
   * Triggers Sergey's `Victory_Cheer` animation on milestones (level up, boss log, tree felled).
   */
  playVictoryCheer(duration = 2.2) {
    this._cheerTimer = duration;
    this.playAnimation('Victory_Cheer', 0.2, true, 1.15);
  }

  setInteractionMode(mode = 'stump') {
    this.interactionMode = mode === 'yard' ? 'yard' : 'stump';
    if (this.interactionMode === 'stump') {
      this.isMoving = false;
      this.isRunning = false;
      this.root.position.set(0, 0, -0.80);
      this.root.rotation.set(0, 0, 0);
      this._cheerTimer = 0;
      this.playAnimation('Axe_Stance', 0.2, true, 0.45, 0.35);
    } else {
      this.playAnimation(this._getDesiredIdleOrMoveClip(), 0.2, true);
    }
  }

  setLocomotionState(isMoving, isRunning = false, dt = 0, surface = 'grass') {
    this.isMoving = Boolean(isMoving);
    this.isRunning = Boolean(isRunning && isMoving);

    if (this.state === 'IDLE') {
      const nextClip = this._getDesiredIdleOrMoveClip();
      const speedScale = this.isMoving ? (this.isRunning ? 1.35 : 1.1) : 1.0;
      this.playAnimation(nextClip, 0.16, true, speedScale);
    }

    if (this.isMoving && dt > 0) {
      const stepInterval = this.isRunning ? 0.31 : 0.46;
      this.footstepTimer += dt;
      if (this.footstepTimer >= stepInterval) {
        this.footstepTimer -= stepInterval;
        if (this.sound && typeof this.sound.playFootstep === 'function') {
          this.sound.playFootstep(surface, this.isRunning);
        }
      }
    } else {
      this.footstepTimer = 0.25;
    }
  }

  _buildArticulatedBody() {
    const flannelMap = createFlannelTexture();
    const denimMap = createDenimTexture();

    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xd8a984,
      roughness: 0.65
    });
    const flannelMat = new THREE.MeshStandardMaterial({
      map: flannelMap,
      roughness: 0.82
    });
    const denimMat = new THREE.MeshStandardMaterial({
      map: denimMap,
      roughness: 0.85
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x3b2516,
      roughness: 0.72
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0xc48b3f,
      roughness: 0.78
    });
    const beanieMat = new THREE.MeshStandardMaterial({
      color: 0x232830,
      roughness: 0.9
    });
    const beltMat = new THREE.MeshStandardMaterial({
      color: 0x1e1610,
      roughness: 0.5,
      metalness: 0.2
    });

    // 1. Pelvis / Hips root joint
    const pelvis = new THREE.Group();
    pelvis.position.set(0, 0.94, 0);
    this.fallbackRigGroup.add(pelvis);
    this.joints.pelvis = pelvis;

    const pelvisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.16, 0.23),
      denimMat
    );
    pelvisMesh.castShadow = true;
    pelvisMesh.receiveShadow = true;
    pelvis.add(pelvisMesh);

    const beltMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.365, 0.045, 0.24),
      beltMat
    );
    beltMesh.position.y = 0.065;
    pelvis.add(beltMesh);

    // 2. Articulated Legs
    const buildLeg = (side) => {
      const s = side === 'left' ? 1 : -1;
      const hip = new THREE.Group();
      hip.position.set(s * 0.115, -0.04, 0);
      pelvis.add(hip);

      const thighLen = 0.44;
      const thighMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.078, thighLen - 0.14, 8, 12),
        denimMat
      );
      thighMesh.position.y = -thighLen / 2;
      thighMesh.castShadow = true;
      thighMesh.receiveShadow = true;
      hip.add(thighMesh);

      const knee = new THREE.Group();
      knee.position.set(0, -thighLen, 0);
      hip.add(knee);

      const shinLen = 0.43;
      const shinMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.065, shinLen - 0.12, 8, 12),
        denimMat
      );
      shinMesh.position.y = -shinLen / 2;
      shinMesh.castShadow = true;
      shinMesh.receiveShadow = true;
      knee.add(shinMesh);

      const ankle = new THREE.Group();
      ankle.position.set(0, -shinLen, 0);
      knee.add(ankle);

      const bootCuff = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.075, 0.11, 12),
        bootMat
      );
      bootCuff.position.set(0, 0.04, 0);
      bootCuff.castShadow = true;
      ankle.add(bootCuff);

      const bootFoot = new THREE.Mesh(
        new THREE.BoxGeometry(0.115, 0.085, 0.26),
        bootMat
      );
      bootFoot.position.set(0, -0.025, 0.055);
      bootFoot.castShadow = true;
      bootFoot.receiveShadow = true;
      ankle.add(bootFoot);

      this.joints[`${side}Hip`] = hip;
      this.joints[`${side}Knee`] = knee;
      this.joints[`${side}Ankle`] = ankle;
    };

    buildLeg('left');
    buildLeg('right');

    // 3. Lower Spine
    const lowerSpine = new THREE.Group();
    lowerSpine.position.set(0, 0.08, 0);
    pelvis.add(lowerSpine);
    this.joints.lowerSpine = lowerSpine;

    const abdomenMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.25, 0.22),
      flannelMat
    );
    abdomenMesh.position.y = 0.125;
    abdomenMesh.castShadow = true;
    abdomenMesh.receiveShadow = true;
    lowerSpine.add(abdomenMesh);

    // 4. Upper Torso
    const upperTorso = new THREE.Group();
    upperTorso.position.set(0, 0.24, 0);
    lowerSpine.add(upperTorso);
    this.joints.upperTorso = upperTorso;

    const chestMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.41, 0.34, 0.25),
      flannelMat
    );
    chestMesh.position.y = 0.17;
    chestMesh.castShadow = true;
    chestMesh.receiveShadow = true;
    upperTorso.add(chestMesh);

    const collarMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.11, 0.06, 12),
      flannelMat
    );
    collarMesh.position.set(0, 0.35, 0);
    upperTorso.add(collarMesh);

    // 5. Neck & Anonymous Stylized Head with Knit Beanie
    const neck = new THREE.Group();
    neck.position.set(0, 0.36, 0);
    upperTorso.add(neck);
    this.joints.neck = neck;

    const neckMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.066, 0.09, 12),
      skinMat
    );
    neckMesh.position.y = 0.04;
    neck.add(neckMesh);

    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 18, 16),
      skinMat
    );
    headMesh.position.set(0, 0.145, 0.01);
    headMesh.scale.set(0.92, 1.12, 0.98);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    neck.add(headMesh);

    const beanieDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      beanieMat
    );
    beanieDome.position.set(0, 0.16, 0.0);
    beanieDome.rotation.x = -0.18;
    beanieDome.castShadow = true;
    neck.add(beanieDome);

    const beanieCuff = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.024, 10, 20),
      beanieMat
    );
    beanieCuff.position.set(0, 0.18, 0.005);
    beanieCuff.rotation.x = Math.PI / 2 - 0.18;
    neck.add(beanieCuff);

    // 6. Articulated Arms
    this.upperArmLen = 0.30;
    this.forearmLen = 0.28;

    const buildArm = (side) => {
      const s = side === 'left' ? 1 : -1;
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.245, 0.295, 0);
      upperTorso.add(shoulder);

      const deltoid = new THREE.Mesh(
        new THREE.SphereGeometry(0.068, 12, 10),
        flannelMat
      );
      deltoid.castShadow = true;
      shoulder.add(deltoid);

      const upperArmMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.056, this.upperArmLen - 0.09, 8, 10),
        flannelMat
      );
      upperArmMesh.position.y = -this.upperArmLen / 2;
      upperArmMesh.castShadow = true;
      upperArmMesh.receiveShadow = true;
      shoulder.add(upperArmMesh);

      const elbow = new THREE.Group();
      elbow.position.set(0, -this.upperArmLen, 0);
      shoulder.add(elbow);

      const forearmMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.048, this.forearmLen - 0.08, 8, 10),
        flannelMat
      );
      forearmMesh.position.y = -this.forearmLen / 2;
      forearmMesh.castShadow = true;
      forearmMesh.receiveShadow = true;
      elbow.add(forearmMesh);

      const wrist = new THREE.Group();
      wrist.position.set(0, -this.forearmLen, 0);
      elbow.add(wrist);

      const handMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.052, 12, 10),
        gloveMat
      );
      handMesh.scale.set(0.9, 1.15, 0.85);
      handMesh.position.y = -0.02;
      handMesh.castShadow = true;
      wrist.add(handMesh);

      this.joints[`${side}Shoulder`] = shoulder;
      this.joints[`${side}Elbow`] = elbow;
      this.joints[`${side}Wrist`] = wrist;
    };

    buildArm('left');
    buildArm('right');
  }

  _buildAxeAndPhysics() {
    this.axePivot = new THREE.Group();
    this.axePivot.name = 'AxePivot';
    this.joints.rightWrist.add(this.axePivot);

    this.hickoryMat = new THREE.MeshStandardMaterial({
      color: 0xc89658,
      roughness: 0.55
    });
    const gripWrapMat = new THREE.MeshStandardMaterial({
      color: 0x3b2718,
      roughness: 0.82
    });
    this.forgedSteelMat = new THREE.MeshStandardMaterial({
      color: 0x393e46,
      roughness: 0.35,
      metalness: 0.86
    });
    this.polishedBitMat = new THREE.MeshStandardMaterial({
      color: 0xd8dee6,
      roughness: 0.16,
      metalness: 0.95
    });

    this.handleLength = 0.80;

    const shaftGeo = new THREE.CylinderGeometry(0.019, 0.024, this.handleLength, 12);
    shaftGeo.rotateX(Math.PI / 2);
    const shaftMesh = new THREE.Mesh(shaftGeo, this.hickoryMat);
    shaftMesh.position.set(0, 0, this.handleLength * 0.44);
    shaftMesh.scale.set(0.72, 1.18, 1.0);
    shaftMesh.castShadow = true;
    shaftMesh.receiveShadow = true;
    this.axePivot.add(shaftMesh);

    const pommelGeo = new THREE.CylinderGeometry(0.025, 0.031, 0.16, 12);
    pommelGeo.rotateX(Math.PI / 2);
    const pommelMesh = new THREE.Mesh(pommelGeo, gripWrapMat);
    pommelMesh.position.set(0, 0, 0.02);
    pommelMesh.scale.set(0.75, 1.2, 1.0);
    this.axePivot.add(pommelMesh);

    // 3D Upgradeable Axe Handle Grip Wrap & Overstrike Shock-Mount Collar
    this.handleWrapGroup = new THREE.Group();
    this.handleWrapGroup.name = 'CustomHandleGripWrap';
    this.handleWrapGroup.visible = false;
    this.wrapCordMat = new THREE.MeshStandardMaterial({
      color: 0x7c3f1d,
      roughness: 0.72,
      metalness: 0.15
    });
    this.wrapBandMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.4,
      metalness: 0.55
    });

    for (let r = 0; r < 7; r++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.024, 0.0055, 6, 12),
        r === 0 || r === 6 ? this.wrapBandMat : this.wrapCordMat
      );
      ring.position.set(0, 0, 0.14 + r * 0.042);
      ring.scale.set(0.76, 1.22, 1.0);
      this.handleWrapGroup.add(ring);
    }

    const collarGeo = new THREE.CylinderGeometry(0.023, 0.025, 0.09, 12);
    collarGeo.rotateX(Math.PI / 2);
    const neckCollar = new THREE.Mesh(collarGeo, this.wrapBandMat);
    neckCollar.position.set(0, 0, 0.64);
    neckCollar.scale.set(0.76, 1.22, 1.0);
    this.handleWrapGroup.add(neckCollar);
    this.axePivot.add(this.handleWrapGroup);

    this.axeHeadGroup = new THREE.Group();
    this.axeHeadGroup.position.set(0, 0, 0.74);
    this.axePivot.add(this.axeHeadGroup);

    const pollMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.11, 0.095),
      this.forgedSteelMat
    );
    pollMesh.position.set(0, 0.01, 0);
    pollMesh.castShadow = true;
    this.axeHeadGroup.add(pollMesh);

    const wedgeGeo = new THREE.CylinderGeometry(0.006, 0.048, 0.15, 4);
    wedgeGeo.rotateY(Math.PI / 4);
    const wedgeMesh = new THREE.Mesh(wedgeGeo, this.forgedSteelMat);
    wedgeMesh.position.set(0, -0.09, 0);
    wedgeMesh.scale.set(0.85, 1.0, 1.85);
    wedgeMesh.castShadow = true;
    this.axeHeadGroup.add(wedgeMesh);

    const bitGeo = new THREE.BoxGeometry(0.008, 0.045, 0.185);
    const bitMesh = new THREE.Mesh(bitGeo, this.polishedBitMat);
    bitMesh.position.set(0, -0.165, 0.005);
    bitMesh.castShadow = true;
    this.axeHeadGroup.add(bitMesh);

    this.emberGlowMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const emberGeo = new THREE.BoxGeometry(0.016, 0.055, 0.195);
    this.emberGlowMesh = new THREE.Mesh(emberGeo, this.emberGlowMat);
    this.emberGlowMesh.position.set(0, -0.166, 0.005);
    this.emberGlowMesh.visible = false;
    this.axeHeadGroup.add(this.emberGlowMesh);

    this.sapCoatingMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0x92400e,
      emissiveIntensity: 0.18,
      roughness: 0.14,
      metalness: 0.12,
      transparent: true,
      opacity: 0.0
    });
    const sapCoatGeo = new THREE.CylinderGeometry(0.008, 0.052, 0.135, 4);
    sapCoatGeo.rotateY(Math.PI / 4);
    this.sapCoatingMesh = new THREE.Mesh(sapCoatGeo, this.sapCoatingMat);
    this.sapCoatingMesh.position.set(0, -0.1, 0.002);
    this.sapCoatingMesh.scale.set(0.92, 1.0, 1.88);
    this.sapCoatingMesh.visible = false;
    this.axeHeadGroup.add(this.sapCoatingMesh);

    this.bladeTipNode = new THREE.Object3D();
    this.bladeTipNode.position.set(0, -0.175, 0);
    this.axeHeadGroup.add(this.bladeTipNode);

    this.leftGripNode = new THREE.Object3D();
    this.leftGripNode.position.set(0, 0, 0.28);
    this.axePivot.add(this.leftGripNode);

    this.axeBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      material: this.physMaterials.steelPhysMat
    });
    this.axeBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.02, 0.025, this.handleLength * 0.48)),
      new CANNON.Vec3(0, 0, -0.32)
    );
    this.axeBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.028, 0.11, 0.095)),
      new CANNON.Vec3(0, -0.06, 0)
    );
    this.axeBody.userData = { label: 'AxeHeadAndShaft' };
    this.world.addBody(this.axeBody);

    this.humanoidBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      material: this.physMaterials.woodPhysMat
    });
    this.humanoidBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.20, 0.42, 0.14)),
      new CANNON.Vec3(0, 1.28, 0)
    );
    this.humanoidBody.addShape(
      new CANNON.Cylinder(0.08, 0.07, 0.85, 8),
      new CANNON.Vec3(-0.12, 0.44, 0)
    );
    this.humanoidBody.addShape(
      new CANNON.Cylinder(0.08, 0.07, 0.85, 8),
      new CANNON.Vec3(0.12, 0.44, 0)
    );
    this.humanoidBody.position.set(this.root.position.x, 0, this.root.position.z);
    this.humanoidBody.userData = { label: 'HumanoidCollider' };
    this.world.addBody(this.humanoidBody);
  }

  /**
   * Updates the 3D axe appearance when equipping a new Axe Tier from the Upgrade Shop.
   */
  applyAxeVisuals(axeDef) {
    if (!axeDef) return;
    this.hickoryMat.color.setHex(axeDef.handleColor);
    this.forgedSteelMat.color.setHex(axeDef.headColor);
    this.polishedBitMat.color.setHex(axeDef.bitColor);
    if (axeDef.headScale) {
      this.axeHeadGroup.scale.set(
        axeDef.headScale[0],
        axeDef.headScale[1],
        axeDef.headScale[2]
      );
    }
    this.setAxeModel(axeDef.id);
  }

  applyHandleWrapVisuals(wrapDef) {
    if (!this.handleWrapGroup || !wrapDef) return;
    this.handleWrapGroup.visible = Boolean(wrapDef.visible);
    if (wrapDef.wrapColor !== undefined) {
      this.wrapCordMat.color.setHex(wrapDef.wrapColor);
    }
    if (wrapDef.bandColor !== undefined) {
      this.wrapBandMat.color.setHex(wrapDef.bandColor);
    }
  }

  updateBladeConditionVisuals(
    axeCondition = 100,
    axeSapBuildup = 0,
    emberTempered = false
  ) {
    const condFrac = Math.max(0, Math.min(1, axeCondition / 100));
    this.polishedBitMat.roughness = 0.62 - condFrac * 0.46;
    this.polishedBitMat.metalness = 0.65 + condFrac * 0.3;

    if (this.emberGlowMesh) {
      this.emberGlowMesh.visible = Boolean(emberTempered);
    }

    const sapFrac = emberTempered ? 0 : Math.max(0, Math.min(1, axeSapBuildup / 100));
    if (this.sapCoatingMesh && this.sapCoatingMat) {
      this.sapCoatingMesh.visible = sapFrac > 0.04;
      this.sapCoatingMat.opacity = Math.min(0.84, sapFrac * 0.85);
    }
  }

  setDragWindup(ratio) {
    this.dragWindupRatio = Math.max(0, Math.min(1, ratio));
    this.state = 'DRAG_WINDUP';
    this.stateTime = 0;
    if (this.sound && typeof this.sound.playWindupCreak === 'function') {
      this.sound.playWindupCreak(this.dragWindupRatio);
    }
  }

  cancelDragWindup() {
    if (this.state === 'DRAG_WINDUP') {
      this.state = 'IDLE';
      this.dragWindupRatio = 0;
      this.playAnimation(this._getDesiredIdleOrMoveClip(), 0.15, true);
    }
  }

  /**
   * Triggers a full biomechanical axe swing (synced with Sergey's AnimationMixer clip).
   */
  triggerSwing(forceMultiplier = null, skipWindup = false, preserveSplitState = false) {
    if (forceMultiplier !== null && !Number.isNaN(Number(forceMultiplier))) {
      this.swingForce = Math.max(0.2, Math.min(1.6, Number(forceMultiplier)));
    }

    if (
      this.interactionMode === 'stump' &&
      !preserveSplitState &&
      this.choppingStation &&
      this.choppingStation.isLogSplit
    ) {
      this.choppingStation.reset();
    }

    this.state = skipWindup ? 'DOWNSWING' : 'WINDUP';
    this.stateTime = 0;
    this.hasTriggeredSplit = false;
    this.whooshPlayed = false;
    this._cheerTimer = 0;

    // Trigger Sergey's swing animation clip synced so blade lands at hit
    const useMaulClip =
      this.equippedAxeId === 'maul' &&
      this._activeCostumeRecord?.actions?.Heavy_Hammer_Swing;
    if (useMaulClip) {
      this.playAnimation('Heavy_Hammer_Swing', 0.08, false, 2.2, skipWindup ? 0.35 : 0.0);
    } else if (this._activeCostumeRecord?.actions?.Charged_Axe_Chop) {
      this.playAnimation('Charged_Axe_Chop', 0.08, false, 3.2, skipWindup ? 2.1 : 1.5);
    } else {
      this.playAnimation('Heavy_Hammer_Swing', 0.08, false, 2.2, 0);
    }

    if (skipWindup && this.sound) {
      this.whooshPlayed = true;
      this.sound.playWhoosh(this.swingForce, true);
    }
    return true;
  }

  reset() {
    this.state = 'IDLE';
    this.stateTime = 0;
    this.dragWindupRatio = 0;
    this.pryRockAngle = 0;
    this.hasTriggeredSplit = false;
    this.whooshPlayed = false;
    this._cheerTimer = 0;
    this.playAnimation(this._getDesiredIdleOrMoveClip(), 0.15, true);
    this._applyPose(this._getPoseForState('IDLE', 0));
    this._syncPhysicsFromRig(1 / 60);
  }

  enterWedgedPry() {
    this.state = 'WEDGED_PRY';
    this.stateTime = 0;
    this.pryRockAngle = 0;
  }

  rockWedgedBlade(dir = 1) {
    if (this.state !== 'WEDGED_PRY') return false;
    this.pryRockAngle = dir * 0.22;
    this.state = 'RECOVERY';
    this.stateTime = 0;
    return true;
  }

  _getPoseForState(stateName, phaseProgress) {
    const aimOffX =
      this.interactionMode === 'stump' && this.choppingStation
        ? this.choppingStation.aimOffsetX
        : 0;
    const aimYaw = -aimOffX * 0.85;

    const poses = {
      IDLE: {
        pelvisY: 0.93,
        pelvisZ: 0.0,
        pelvisRotY: -0.18 + aimYaw * 0.3,
        spineRotX: 0.08,
        spineRotY: -0.08 + aimYaw * 0.3,
        torsoRotX: 0.06,
        torsoRotY: -0.10 + aimYaw * 0.4,
        neckRotX: 0.22,
        neckRotY: 0.22,
        lHipX: -0.16,
        lHipZ: 0.11,
        lKneeX: 0.28,
        rHipX: 0.06,
        rHipZ: -0.11,
        rKneeX: 0.18,
        rShoulderX: -0.62,
        rShoulderY: -0.22,
        rShoulderZ: -0.18,
        rElbowX: -0.82,
        rWristX: 0.45,
        leftSlideZ: 0.38
      },
      PEAK_WINDUP: {
        pelvisY: 0.96,
        pelvisZ: -0.04,
        pelvisRotY: -0.06 + aimYaw * 0.4,
        spineRotX: -0.25,
        spineRotY: -0.04 + aimYaw * 0.4,
        torsoRotX: -0.26,
        torsoRotY: -0.04 + aimYaw * 0.5,
        neckRotX: 0.48,
        neckRotY: 0.08,
        lHipX: -0.10,
        lHipZ: 0.12,
        lKneeX: 0.18,
        rHipX: -0.20,
        rHipZ: -0.12,
        rKneeX: 0.32,
        rShoulderX: -2.55,
        rShoulderY: aimYaw * 0.5,
        rShoulderZ: 0.16,
        rElbowX: -0.52,
        rWristX: -0.10,
        leftSlideZ: 0.36
      },
      IMPACT: {
        pelvisY: 0.82,
        pelvisZ: 0.09,
        pelvisRotY: aimYaw * 0.4,
        spineRotX: 0.38,
        spineRotY: aimYaw * 0.4,
        torsoRotX: 0.36,
        torsoRotY: aimYaw * 0.6,
        neckRotX: -0.18,
        neckRotY: 0.0,
        lHipX: -0.38,
        lHipZ: 0.11,
        lKneeX: 0.56,
        rHipX: -0.26,
        rHipZ: -0.11,
        rKneeX: 0.48,
        rShoulderX: -0.78,
        rShoulderY: aimYaw * 0.5,
        rShoulderZ: -0.04 - aimOffX * 0.6,
        rElbowX: -0.22,
        rWristX: 0.72,
        leftSlideZ: 0.12
      },
      FOLLOW_THROUGH: {
        pelvisY: 0.80,
        pelvisZ: 0.11,
        pelvisRotY: aimYaw * 0.4,
        spineRotX: 0.44,
        spineRotY: aimYaw * 0.4,
        torsoRotX: 0.42,
        torsoRotY: aimYaw * 0.6,
        neckRotX: -0.22,
        neckRotY: 0.0,
        lHipX: -0.42,
        lHipZ: 0.11,
        lKneeX: 0.60,
        rHipX: -0.30,
        rHipZ: -0.11,
        rKneeX: 0.52,
        rShoulderX: -0.52,
        rShoulderY: aimYaw * 0.5,
        rShoulderZ: -0.04 - aimOffX * 0.6,
        rElbowX: -0.18,
        rWristX: 0.88,
        leftSlideZ: 0.10
      }
    };

    const lerpPose = (pA, pB, t) => {
      const out = {};
      for (const key of Object.keys(pA)) {
        out[key] = pA[key] + (pB[key] - pA[key]) * t;
      }
      return out;
    };

    if (stateName === 'IDLE') {
      const breath = Math.sin(this.idleClock * 2.4) * 0.015;
      const p = { ...poses.IDLE };
      p.torsoRotX += breath;
      p.rShoulderX += breath * 1.4;
      return p;
    }
    if (stateName === 'DRAG_WINDUP') {
      return lerpPose(poses.IDLE, poses.PEAK_WINDUP, this.dragWindupRatio);
    }
    if (stateName === 'WINDUP') {
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, phaseProgress));
      return lerpPose(poses.IDLE, poses.PEAK_WINDUP, ease);
    }
    if (stateName === 'DOWNSWING') {
      const accel = Math.pow(Math.min(1, phaseProgress), 1.65);
      return lerpPose(poses.PEAK_WINDUP, poses.IMPACT, accel);
    }
    if (stateName === 'IMPACT_HOLD') {
      const ease = 1 - Math.pow(1 - Math.min(1, phaseProgress), 2);
      return lerpPose(poses.IMPACT, poses.FOLLOW_THROUGH, ease);
    }
    if (stateName === 'WEDGED_PRY') {
      const p = { ...poses.IMPACT };
      const pryOsc = Math.sin(this.stateTime * 18.0) * 0.08 + this.pryRockAngle;
      p.torsoRotY += pryOsc * 0.5;
      p.rShoulderZ += pryOsc;
      return p;
    }
    if (stateName === 'RECOVERY') {
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, phaseProgress));
      return lerpPose(poses.FOLLOW_THROUGH, poses.IDLE, ease);
    }
    return poses.IDLE;
  }

  _applyPose(pose) {
    const j = this.joints;

    j.pelvis.position.set(0, pose.pelvisY, pose.pelvisZ);
    j.pelvis.rotation.set(0, pose.pelvisRotY, 0);

    j.lowerSpine.rotation.set(pose.spineRotX, pose.spineRotY, 0);
    j.upperTorso.rotation.set(pose.torsoRotX, pose.torsoRotY, 0);
    j.neck.rotation.set(pose.neckRotX, pose.neckRotY, 0);

    j.leftHip.rotation.set(pose.lHipX, 0, pose.lHipZ);
    j.leftKnee.rotation.set(pose.lKneeX, 0, 0);
    j.leftAnkle.rotation.set(-(pose.lHipX + pose.lKneeX), 0, -pose.lHipZ);

    j.rightHip.rotation.set(pose.rHipX, 0, pose.rHipZ);
    j.rightKnee.rotation.set(pose.rKneeX, 0, 0);
    j.rightAnkle.rotation.set(-(pose.rHipX + pose.rKneeX), 0, -pose.rHipZ);

    j.rightShoulder.rotation.set(pose.rShoulderX, pose.rShoulderY, pose.rShoulderZ);
    j.rightElbow.rotation.set(pose.rElbowX, 0, 0);
    j.rightWrist.rotation.set(pose.rWristX, 0, 0);

    this.leftGripNode.position.set(0, 0, pose.leftSlideZ);

    this.fallbackRigGroup.updateMatrixWorld(true);
    this._solveLeftArmIK();
  }

  _solveLeftArmIK() {
    const shoulder = this.joints.leftShoulder;
    const elbow = this.joints.leftElbow;
    const upperTorso = this.joints.upperTorso;

    const shoulderWorld = new THREE.Vector3();
    const targetWorld = new THREE.Vector3();
    shoulder.getWorldPosition(shoulderWorld);
    this.leftGripNode.getWorldPosition(targetWorld);

    const torsoInv = new THREE.Matrix4().copy(upperTorso.matrixWorld).invert();
    const localTarget = targetWorld
      .clone()
      .applyMatrix4(torsoInv)
      .sub(shoulder.position);

    const L1 = this.upperArmLen;
    const L2 = this.forearmLen;
    const rawDist = localTarget.length();
    const maxReach = L1 + L2 - 0.004;
    const minReach = Math.abs(L1 - L2) + 0.004;
    const d = Math.max(minReach, Math.min(maxReach, rawDist));

    const cosElbow = Math.max(
      -1,
      Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))
    );
    const elbowInterior = Math.acos(cosElbow);
    const elbowFlex = -(Math.PI - elbowInterior);

    const cosShoulderOffset = Math.max(
      -1,
      Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))
    );
    const shoulderOffset = Math.acos(cosShoulderOffset);

    const dir = localTarget.clone().normalize();
    const aimPitchX = Math.atan2(dir.z, -dir.y);
    const aimRollZ = Math.atan2(dir.x, Math.sqrt(dir.y * dir.y + dir.z * dir.z));

    shoulder.rotation.set(-(aimPitchX + shoulderOffset), 0, aimRollZ);
    elbow.rotation.set(elbowFlex, 0, 0);
    shoulder.updateMatrixWorld(true);
  }

  _syncPhysicsFromRig(dt) {
    this.fallbackRigGroup.updateMatrixWorld(true);

    const headWorldPos = new THREE.Vector3();
    const headWorldQuat = new THREE.Quaternion();
    this.axeHeadGroup.getWorldPosition(headWorldPos);
    this.axeHeadGroup.getWorldQuaternion(headWorldQuat);

    const bladeWorldPos = new THREE.Vector3();
    this.bladeTipNode.getWorldPosition(bladeWorldPos);

    if (dt > 0.0001) {
      this.currentBladeVelocity
        .subVectors(bladeWorldPos, this.prevBladePos)
        .divideScalar(dt);
    }
    this.prevBladePos.copy(bladeWorldPos);

    this.axeBody.position.set(headWorldPos.x, headWorldPos.y, headWorldPos.z);
    this.axeBody.quaternion.set(
      headWorldQuat.x,
      headWorldQuat.y,
      headWorldQuat.z,
      headWorldQuat.w
    );
    this.axeBody.velocity.set(
      this.currentBladeVelocity.x,
      this.currentBladeVelocity.y,
      this.currentBladeVelocity.z
    );

    this.humanoidBody.position.set(this.root.position.x, 0, this.root.position.z);
  }

  update(dt) {
    this.idleClock += dt;

    if (this._cheerTimer > 0) {
      this._cheerTimer = Math.max(0, this._cheerTimer - dt);
      if (this._cheerTimer <= 0 && this.state === 'IDLE') {
        this.playAnimation(this._getDesiredIdleOrMoveClip(), 0.22, true);
      }
    }

    if (this._activeCostumeRecord && this._activeCostumeRecord.mixer) {
      this._activeCostumeRecord.mixer.update(dt);
    }

    if (this.state === 'IDLE' || this.state === 'DRAG_WINDUP') {
      this._applyPose(this._getPoseForState(this.state, 0));
      this._syncPhysicsFromRig(dt);
      return;
    }

    this.stateTime += dt;

    const windupDuration = 0.22;
    const downswingDuration = 0.14 / Math.sqrt(Math.max(0.35, this.swingForce));
    const holdDuration = 0.14;
    const recoveryDuration = 0.34;

    if (this.state === 'WINDUP') {
      const p = this.stateTime / windupDuration;
      this._applyPose(this._getPoseForState('WINDUP', p));
      this._syncPhysicsFromRig(dt);
      if (p >= 1.0) {
        this.state = 'DOWNSWING';
        this.stateTime = 0;
        if (!this.whooshPlayed && this.sound) {
          this.whooshPlayed = true;
          this.sound.playWhoosh(this.swingForce);
        }
      }
      return;
    }

    if (this.state === 'DOWNSWING') {
      const p = this.stateTime / downswingDuration;
      this._applyPose(this._getPoseForState('DOWNSWING', p));
      this._syncPhysicsFromRig(dt);

      const bladeWorldPos = new THREE.Vector3();
      this.bladeTipNode.getWorldPosition(bladeWorldPos);

      const logTopY =
        this.choppingStation.blockHeight + this.choppingStation.logHeight;
      if (
        !this.hasTriggeredSplit &&
        ((p >= 0.72 && bladeWorldPos.y <= logTopY + 0.05) || p >= 0.95)
      ) {
        this.hasTriggeredSplit = true;
        if (typeof this.onImpactCallback === 'function') {
          this.onImpactCallback(bladeWorldPos, this.currentBladeVelocity);
        } else if (this.interactionMode === 'stump') {
          this.choppingStation.fractureLog(
            this.swingForce,
            bladeWorldPos,
            this.currentBladeVelocity
          );
        }
      }

      if (p >= 1.0) {
        this.state = 'IMPACT_HOLD';
        this.stateTime = 0;
      }
      return;
    }

    if (this.state === 'IMPACT_HOLD') {
      const p = this.stateTime / holdDuration;
      this._applyPose(this._getPoseForState('IMPACT_HOLD', p));
      this._syncPhysicsFromRig(dt);
      if (p >= 1.0) {
        this.state = 'RECOVERY';
        this.stateTime = 0;
      }
      return;
    }

    if (this.state === 'WEDGED_PRY') {
      const pryHoldDuration = 0.85;
      const p = this.stateTime / pryHoldDuration;
      this._applyPose(this._getPoseForState('WEDGED_PRY', p));
      this._syncPhysicsFromRig(dt);
      if (p >= 1.0) {
        this.pryRockAngle = 0;
        this.state = 'RECOVERY';
        this.stateTime = 0;
      }
      return;
    }

    if (this.state === 'RECOVERY') {
      const p = this.stateTime / recoveryDuration;
      this._applyPose(this._getPoseForState('RECOVERY', p));
      this._syncPhysicsFromRig(dt);
      if (p >= 1.0) {
        this.state = 'IDLE';
        this.stateTime = 0;
        this.playAnimation(this._getDesiredIdleOrMoveClip(), 0.2, true);
      }
    }
  }
}
