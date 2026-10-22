import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createDenimTexture, createPlaidTexture } from './utils.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();


/** Merge only the direct mesh children of one articulation group. */
function mergeDirectMeshes(group) {
  if (!group) return;
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const originals = [];
  for (const child of [...group.children]) {
    if (!child.isMesh || child.isInstancedMesh || Array.isArray(child.material)) continue;
    if (child.material.transparent) continue;
    const key = `${child.material.uuid}:${child.castShadow ? 1 : 0}:${child.receiveShadow ? 1 : 0}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        material: child.material,
        castShadow: child.castShadow,
        receiveShadow: child.receiveShadow,
        geometries: [],
      });
    }
    let geometry = child.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld));
    if (geometry.index) geometry = geometry.toNonIndexed();
    buckets.get(key).geometries.push(geometry);
    originals.push(child);
  }
  for (const child of originals) group.remove(child);
  for (const bucket of buckets.values()) {
    const merged = bucket.geometries.length === 1
      ? bucket.geometries[0]
      : mergeGeometries(bucket.geometries, false);
    if (!merged) {
      for (const geometry of bucket.geometries) geometry.dispose();
      continue;
    }
    if (bucket.geometries.length > 1) {
      for (const geometry of bucket.geometries) geometry.dispose();
    }
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    group.add(mesh);
  }
}


const _averageColorCache = new Map();
function averageTextureColor(material) {
  if (!material) return new THREE.Color(0x999999);
  const key = material.uuid;
  if (_averageColorCache.has(key)) return _averageColorCache.get(key);
  let color = material.color ? material.color.clone() : new THREE.Color(0x999999);
  const map = material.map;
  if (map && map.image && typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(map.image, 0, 0, 4, 4);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      const sample = new THREE.Color().setRGB(
        data[0] / 255,
        data[1] / 255,
        data[2] / 255,
        THREE.SRGBColorSpace,
      );
      color.multiply(sample);
    } catch {
      // Canvas readback can be blocked in some contexts; fall back to tint.
    }
  }
  _averageColorCache.set(key, color);
  return color;
}

/** Collapse one articulation group to a single flat-coloured draw. */
function mergeDirectToVertexColors(group, lowMaterial, cache) {
  if (!group || group.userData.lowMesh) return;
  const highChildren = [...group.children];
  const meshes = highChildren.filter((child) => child.isMesh && !child.material.transparent);
  if (!meshes.length) return;
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const geometries = [];
  for (const mesh of meshes) {
    let geometry = mesh.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    if (geometry.index) geometry = geometry.toNonIndexed();
    const color = averageTextureColor(mesh.material);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(geometry);
  }
  for (const mesh of meshes) group.remove(mesh);
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (merged) {
    const mesh = new THREE.Mesh(merged, lowMaterial);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    group.userData.lowMesh = mesh;
  }
  group.userData.highChildren = highChildren;
}

function buildArm(side, materials, lengths) {
  const { l1, l2 } = lengths;
  const upper = new THREE.Group();
  upper.name = `shoulder-${side < 0 ? 'right' : 'left'}`;

  const shoulderCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.082, 12, 10),
    materials.plaid,
  );
  shoulderCap.scale.set(1, 0.9, 1);
  shoulderCap.castShadow = true;
  upper.add(shoulderCap);

  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.066, 0.074, l1, 10, 1, false),
    materials.plaid,
  );
  sleeve.position.y = -l1 / 2;
  sleeve.castShadow = true;
  sleeve.receiveShadow = true;
  upper.add(sleeve);

  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.062, 0.04, 10),
    materials.plaidDark,
  );
  cuff.position.y = -l1 + 0.018;
  cuff.castShadow = true;
  upper.add(cuff);

  const lower = new THREE.Group();
  lower.name = `elbow-${side < 0 ? 'right' : 'left'}`;
  lower.position.y = -l1;

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), materials.skin);
  elbow.castShadow = true;
  lower.add(elbow);

  const forearm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.042, l2, 10, 1),
    materials.skin,
  );
  forearm.position.y = -l2 / 2;
  forearm.castShadow = true;
  forearm.receiveShadow = true;
  lower.add(forearm);

  const rolledCuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.058, 0.07, 10),
    materials.plaid,
  );
  rolledCuff.position.y = -0.065;
  rolledCuff.castShadow = true;
  lower.add(rolledCuff);

  const hand = new THREE.Group();
  hand.name = `hand-${side < 0 ? 'right' : 'left'}`;
  hand.position.y = -l2;

  const palm = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.105, 0.07),
    materials.glove,
  );
  palm.position.y = -0.015;
  palm.castShadow = true;
  hand.add(palm);

  // Four simple curled fingers and a thumb.
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.011, 0.045, 3, 5),
      materials.glove,
    );
    finger.rotation.x = Math.PI / 2;
    finger.position.set((i - 1.5) * 0.018, -0.045 + i * 0.002, -0.045);
    finger.castShadow = true;
    hand.add(finger);
  }
  const thumb = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.014, 0.045, 3, 5),
    materials.glove,
  );
  thumb.rotation.set(Math.PI / 2.2, 0, 0.5);
  thumb.position.set(0.045, -0.012, -0.02);
  thumb.castShadow = true;
  hand.add(thumb);

  lower.add(hand);
  upper.add(lower);
  return { upper, lower, hand };
}

function buildLeg(side, materials, lengths) {
  const { l1, l2 } = lengths;
  const upper = new THREE.Group();
  upper.name = `hip-${side < 0 ? 'right' : 'left'}`;

  const thigh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.082, l1, 10, 1),
    materials.denim,
  );
  thigh.position.y = -l1 / 2;
  thigh.castShadow = true;
  thigh.receiveShadow = true;
  upper.add(thigh);

  const thighOuter = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 10, 8),
    materials.denim,
  );
  thighOuter.scale.set(1, 0.8, 1);
  thighOuter.castShadow = true;
  upper.add(thighOuter);

  const kneeJoint = new THREE.Group();
  kneeJoint.position.y = -l1;

  const knee = new THREE.Mesh(new THREE.SphereGeometry(0.078, 10, 8), materials.denimDark);
  knee.scale.set(1, 0.9, 1);
  knee.castShadow = true;
  kneeJoint.add(knee);

  const shin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.076, 0.058, l2, 10, 1),
    materials.denim,
  );
  shin.position.y = -l2 / 2;
  shin.castShadow = true;
  shin.receiveShadow = true;
  kneeJoint.add(shin);

  // Rolled denim cuff at the ankle.
  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.067, 0.055, 10),
    materials.denimDark,
  );
  cuff.position.y = -l2 + 0.03;
  cuff.castShadow = true;
  kneeJoint.add(cuff);

  const ankle = new THREE.Group();
  ankle.position.y = -l2;

  const boot = new THREE.Mesh(
    new THREE.BoxGeometry(0.135, 0.115, 0.29),
    materials.boot,
  );
  boot.position.set(0, 0.025, -0.055);
  boot.castShadow = true;
  boot.receiveShadow = true;
  ankle.add(boot);

  const toe = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55),
    materials.boot,
  );
  toe.rotation.x = Math.PI / 2;
  toe.scale.set(0.9, 0.55, 1.1);
  toe.position.set(0, 0.035, -0.19);
  toe.castShadow = true;
  ankle.add(toe);

  const sole = new THREE.Mesh(
    new THREE.BoxGeometry(0.145, 0.035, 0.31),
    materials.sole,
  );
  sole.position.set(0, -0.038, -0.055);
  sole.castShadow = true;
  ankle.add(sole);

  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.055, 0.08), materials.sole);
  heel.position.set(0, -0.032, 0.075);
  ankle.add(heel);

  for (let i = 0; i < 3; i++) {
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.004, 0.006), materials.lace);
    lace.position.set(0, 0.078, -0.06 + i * 0.035);
    ankle.add(lace);
  }

  kneeJoint.add(ankle);
  upper.add(kneeJoint);
  return { upper, lower: kneeJoint, ankle };
}

function solveTwoBone(upper, lower, target, pole, l1, l2) {
  const shoulder = upper.position;
  const toTarget = _v.copy(target).sub(shoulder);
  let distance = toTarget.length();
  if (distance < 0.001) distance = 0.001;
  const dir = _v2.copy(toTarget).divideScalar(distance);
  const clampedDistance = THREE.MathUtils.clamp(distance, Math.abs(l1 - l2) + 0.004, l1 + l2 - 0.002);
  const cosAngle = THREE.MathUtils.clamp(
    (l1 * l1 + clampedDistance * clampedDistance - l2 * l2) / (2 * l1 * clampedDistance),
    -1,
    1,
  );
  const sinAngle = Math.sqrt(Math.max(0, 1 - cosAngle * cosAngle));

  const bendDir = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (bendDir.lengthSq() < 0.000001) {
    bendDir.set(0, 0, -1).cross(dir);
    if (bendDir.lengthSq() < 0.000001) bendDir.set(1, 0, 0);
  }
  bendDir.normalize();

  const elbowOffset = dir
    .clone()
    .multiplyScalar(cosAngle * l1)
    .addScaledVector(bendDir, sinAngle * l1);
  const elbow = shoulder.clone().add(elbowOffset);
  const upperDir = elbow.clone().sub(shoulder).normalize();

  upper.quaternion.setFromUnitVectors(DOWN, upperDir);

  const targetClamped = shoulder
    .clone()
    .add(dir.clone().multiplyScalar(clampedDistance));
  const forearmDir = targetClamped.clone().sub(elbow).normalize();
  const forearmLocal = forearmDir.clone().applyQuaternion(upper.quaternion.clone().invert()).normalize();
  lower.quaternion.setFromUnitVectors(DOWN, forearmLocal);

  return distance > l1 + l2 - 0.002;
}

export class Humanoid {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'anonymous-woodcutter';
    // Stance distance: far enough that the boots and knees clear the block,
    // close enough that the longer axe still lands on the log's centre.
    this.root.position.set(0, 0, 0.30);
    scene.add(this.root);

    this.basePosition = this.root.position.clone();
    this.baseZ = this.root.position.z;
    this.hipHeight = 0.91;
    this.armLengths = { l1: 0.305, l2: 0.285 };
    this.legLengths = { l1: 0.435, l2: 0.405 };
    this.time = 0;
    this.resetState();
    this.build();
  }

  resetState() {
    this.lastPose = {
      lean: 0,
      twist: 0,
      side: 0,
      crouch: 0,
      hipX: 0,
      hipZ: 0,
      headYaw: 0,
    };
  }

  build() {
    const plaidTexture = createPlaidTexture(14);
    const denimTexture = createDenimTexture(5);

    const materials = {
      plaid: new THREE.MeshStandardMaterial({
        map: plaidTexture,
        color: 0xcbb7a7,
        roughness: 0.9,
      }),
      plaidDark: new THREE.MeshStandardMaterial({ color: 0x3c2c26, roughness: 0.92 }),
      denim: new THREE.MeshStandardMaterial({
        map: denimTexture,
        color: 0xbcc6d0,
        roughness: 0.94,
      }),
      denimDark: new THREE.MeshStandardMaterial({ color: 0x2a3b4c, roughness: 0.95 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xa77a5b, roughness: 0.8 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.88 }),
      boot: new THREE.MeshStandardMaterial({ color: 0x4b3524, roughness: 0.82 }),
      sole: new THREE.MeshStandardMaterial({ color: 0x1e1d18, roughness: 0.95 }),
      lace: new THREE.MeshStandardMaterial({ color: 0xbba889, roughness: 0.9 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x2c2219, roughness: 0.8 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8d897a, metalness: 0.75, roughness: 0.4 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.96 }),
      beanie: new THREE.MeshStandardMaterial({ color: 0x48523b, roughness: 1 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x1a1813, roughness: 0.55 }),
    };
    this.materials = materials;

    // Hips / waist
    const pelvis = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.17, 0.23, 12),
      materials.denim,
    );
    pelvis.position.y = 0.92;
    pelvis.castShadow = true;
    pelvis.receiveShadow = true;
    this.root.add(pelvis);

    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.196, 0.188, 0.06, 12), materials.leather);
    belt.position.y = 1.015;
    belt.castShadow = true;
    this.root.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.052, 0.014), materials.metal);
    buckle.position.set(0, 1.015, -0.19);
    buckle.castShadow = true;
    this.root.add(buckle);

    // Torso pivots at the waist.
    this.torso = new THREE.Group();
    this.torso.name = 'torso';
    this.torso.position.y = 1.005;
    this.torso.rotation.order = 'YXZ';
    this.root.add(this.torso);

    const shirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.235, 0.185, 0.53, 14, 2),
      materials.plaid,
    );
    shirt.position.y = 0.265;
    shirt.castShadow = true;
    shirt.receiveShadow = true;
    this.torso.add(shirt);

    const upperChest = new THREE.Mesh(
      new THREE.SphereGeometry(0.232, 14, 10),
      materials.plaid,
    );
    upperChest.scale.set(1.03, 0.52, 0.7);
    upperChest.position.y = 0.49;
    upperChest.castShadow = true;
    this.torso.add(upperChest);

    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.13, 0.09, 12),
      materials.plaidDark,
    );
    collar.position.y = 0.56;
    collar.castShadow = true;
    this.torso.add(collar);

    // Placket / buttons.
    const placket = new THREE.Mesh(new THREE.BoxGeometry(0.033, 0.45, 0.012), materials.plaidDark);
    placket.position.set(0, 0.29, -0.19);
    placket.rotation.x = -0.11;
    this.torso.add(placket);
    for (let i = 0; i < 5; i++) {
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 8), materials.leather);
      button.rotation.x = Math.PI / 2;
      button.position.set(0.023, 0.16 + i * 0.075, -0.201);
      this.torso.add(button);
    }

    // Chest pocket with a pencil.
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.1, 0.008), materials.plaidDark);
    pocket.position.set(-0.1, 0.32, -0.184);
    this.torso.add(pocket);
    const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 6), materials.metal);
    pencil.position.set(-0.1, 0.365, -0.194);
    pencil.rotation.z = 0.18;
    this.torso.add(pencil);

    // Neck and head.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.13, 10), materials.skin);
    neck.position.y = 0.585;
    neck.castShadow = true;
    this.torso.add(neck);

    this.head = new THREE.Group();
    this.head.position.y = 0.715;
    this.torso.add(this.head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.118, 18, 14), materials.skin);
    skull.scale.set(1, 1.17, 0.98);
    skull.castShadow = true;
    this.head.add(skull);

    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.088, 12, 8), materials.skin);
    jaw.scale.set(0.9, 0.7, 0.92);
    jaw.position.set(0, -0.075, -0.012);
    jaw.castShadow = true;
    this.head.add(jaw);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.055, 6), materials.skin);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.005, -0.122);
    nose.castShadow = true;
    this.head.add(nose);

    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), materials.skin);
      ear.scale.set(0.5, 1.1, 0.8);
      ear.position.set(side * 0.115, 0.0, 0.0);
      this.head.add(ear);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.008, 0.012), materials.hair);
      brow.position.set(side * 0.04, 0.042, -0.108);
      brow.rotation.z = side * -0.1;
      this.head.add(brow);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 7, 5), materials.eye);
      eye.scale.set(1, 0.7, 0.45);
      eye.position.set(side * 0.04, 0.022, -0.112);
      this.head.add(eye);
    }

    const beard = new THREE.Mesh(
      new THREE.SphereGeometry(0.092, 10, 8, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.35),
      materials.hair,
    );
    beard.scale.set(0.95, 0.9, 0.95);
    beard.position.set(0, -0.078, -0.015);
    beard.castShadow = true;
    this.head.add(beard);

    // Knit cap.
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.124, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
      materials.beanie,
    );
    cap.position.y = 0.035;
    cap.scale.set(1, 1.1, 1);
    cap.castShadow = true;
    this.head.add(cap);
    const capBand = new THREE.Mesh(new THREE.CylinderGeometry(0.124, 0.126, 0.055, 18), materials.beanie);
    capBand.position.y = 0.035;
    capBand.castShadow = true;
    this.head.add(capBand);
    const capSeam = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.24), materials.beanie);
    capSeam.position.set(0, 0.138, -0.015);
    this.head.add(capSeam);

    // Arms.
    this.armR = buildArm(-1, materials, this.armLengths);
    this.armL = buildArm(1, materials, this.armLengths);
    this.armR.upper.position.set(-0.266, 0.39, 0);
    this.armL.upper.position.set(0.266, 0.39, 0);
    this.torso.add(this.armR.upper, this.armL.upper);

    // Legs.
    this.legR = buildLeg(-1, materials, this.legLengths);
    this.legL = buildLeg(1, materials, this.legLengths);
    this.legR.upper.position.set(-0.145, 0.91, 0);
    this.legL.upper.position.set(0.145, 0.91, 0);
    this.root.add(this.legR.upper, this.legL.upper);

    // World-space foot targets (ankles). The feet stay planted while the hips move.
    this.footTargets = {
      right: new THREE.Vector3(-0.19, 0.085, 0.38),
      left: new THREE.Vector3(0.18, 0.085, -0.16),
    };
    this.ankleRestY = 0.085;

    // Grounding shadow. Real shadows do the heavy lifting; this just seats the boots.
    const shadowTex = this._makeBlobTexture();
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), shadowMat);
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(0, 0.025, 0.11);
    this.root.add(contact);
    this.contactShadow = contact;

    this.root.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    // Fingers and face details should not self-shadow harshly.
    this.head.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = false;
    });

    // Batch the rigid parts inside every articulation group. The skeleton and
    // IK still work exactly as before, but the draw call count drops sharply.
    for (const group of [
      this.torso,
      this.head,
      this.armR.upper, this.armR.lower, this.armR.hand,
      this.armL.upper, this.armL.lower, this.armL.hand,
      this.legR.upper, this.legR.lower, this.legR.ankle,
      this.legL.upper, this.legL.lower, this.legL.ankle,
    ]) {
      mergeDirectMeshes(group);
    }
    mergeDirectMeshes(this.root);
  }

  _makeBlobTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 61);
    g.addColorStop(0, 'rgba(0,0,0,0.72)');
    g.addColorStop(0.46, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }

  reset() {
    this.resetState();
    this.time = 0;
    this.root.position.copy(this.basePosition);
    this.torso.rotation.set(0, 0, 0);
    this.update(0.016, this.lastPose, null, new THREE.Vector3(0, 1, 0));
  }

  /**
   * Shadow budget switch. On the low preset only the large forms cast a
   * shadow; fingers, face details and leather rings stop paying for a second
   * draw in the shadow pass.
   */
  setShadowMode(name) {
    if (!this._shadowFlags) {
      this._shadowFlags = new Map();
      this.root.traverse((object) => {
        if (!object.isMesh) return;
        const geometry = object.geometry;
        if (geometry && !geometry.boundingSphere) geometry.computeBoundingSphere();
        this._shadowFlags.set(object, {
          cast: object.castShadow,
          radius: geometry?.boundingSphere?.radius || 0,
        });
      });
    }
    const low = name === 'low';
    for (const [mesh, data] of this._shadowFlags) {
      mesh.castShadow = low ? data.cast && data.radius > 0.16 : data.cast;
    }
  }

  setAmbientTint(color, intensity) {
    if (!this.lowMaterial) return;
    if (!this.lowMaterial.userData.baseColor) {
      this.lowMaterial.userData.baseColor = new THREE.Color(0xffffff);
    }
    this.lowMaterial.color
      .copy(this.lowMaterial.userData.baseColor)
      .multiply(color)
      .multiplyScalar(intensity);
  }

  setRenderDetail(name) {
    const low = name === 'low';
    const groups = [
      this.torso,
      this.head,
      this.armR.upper, this.armR.lower, this.armR.hand,
      this.armL.upper, this.armL.lower, this.armL.hand,
      this.legR.upper, this.legR.lower, this.legR.ankle,
      this.legL.upper, this.legL.lower, this.legL.ankle,
      this.root,
    ];
    if (!this.lowMaterial) {
      this.lowMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true,
        fog: true,
      });
    }
    if (low) {
      if (this._lowDetail) return;
      for (const group of groups) mergeDirectToVertexColors(group, this.lowMaterial, null);
      this._lowDetail = true;
    } else {
      if (!this._lowDetail) return;
      for (const group of groups) {
        if (group.userData.lowMesh) {
          group.remove(group.userData.lowMesh);
          group.userData.lowMesh.geometry.dispose?.();
          group.userData.lowMesh = null;
        }
        for (const child of group.userData.highChildren || []) {
          group.add(child);
        }
        group.userData.highChildren = null;
      }
      this._lowDetail = false;
    }
    this._shadowFlags = null;
  }

  applyPose(pose) {
    this.lastPose = { ...this.lastPose, ...pose };
    const p = this.lastPose;
    this.root.position.x = this.basePosition.x + (p.hipX || 0);
    this.root.position.y = -(p.crouch || 0);
    this.root.position.z = this.baseZ + (p.hipZ || 0);
    this.torso.rotation.y = p.twist || 0;
    this.torso.rotation.x = -(p.lean || 0);
    this.torso.rotation.z = p.side || 0;
    this.head.rotation.y = p.headYaw || 0;
    this.head.rotation.x = p.headPitch || 0;

    // A little breath, always running underneath the action.
    const breath = Math.sin(this.time * 1.7) * 0.006;
    this.torso.position.y = 1.005 + breath;
    this.head.rotation.z = Math.sin(this.time * 0.73) * 0.012;
    this.contactShadow.position.x = this.root.position.x - this.basePosition.x;
  }

  update(dt, pose, axePosition, axeQuaternion, gripOffsets = { lower: -0.055, upper: 0.19 }) {
    this.time += dt;
    this.applyPose(pose);

    this.root.updateMatrixWorld(true);

    // --- Planted legs -------------------------------------------------
    for (const [key, leg, side] of [
      ['right', this.legR, -1],
      ['left', this.legL, 1],
    ]) {
      const targetWorld = this.footTargets[key];
      const targetLocal = this.root.worldToLocal(targetWorld.clone());
      const pole = new THREE.Vector3(side * 0.25, 0.1, -1.2);
      solveTwoBone(
        leg.upper,
        leg.lower,
        targetLocal,
        pole,
        this.legLengths.l1,
        this.legLengths.l2,
      );
    }

    this.root.updateMatrixWorld(true);

    // Keep the boots level with the lawn, whatever the knees are doing.
    for (const leg of [this.legR, this.legL]) {
      const lowerWorld = leg.lower.getWorldQuaternion(new THREE.Quaternion());
      const rootWorld = this.root.getWorldQuaternion(new THREE.Quaternion());
      leg.ankle.quaternion.copy(lowerWorld.invert().multiply(rootWorld));
    }

    // --- Arms follow the axe -----------------------------------------
    if (axePosition && axeQuaternion) {
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(axeQuaternion).normalize();
      const lowerGrip = axePosition.clone().addScaledVector(axis, gripOffsets.lower);
      const upperGrip = axePosition.clone().addScaledVector(axis, gripOffsets.upper);

      for (const [arm, targetWorld, side] of [
        [this.armR, lowerGrip, -1],
        [this.armL, upperGrip, 1],
      ]) {
        const parent = arm.upper.parent;
        const targetLocal = parent.worldToLocal(targetWorld.clone());
        const shoulderWorld = arm.upper.getWorldPosition(new THREE.Vector3());
        const poleWorld = shoulderWorld
          .clone()
          .add(new THREE.Vector3(side * 1.1, -0.15, 0.55).applyAxisAngle(UP, 0));
        const poleLocal = parent.worldToLocal(poleWorld).sub(arm.upper.position);
        solveTwoBone(
          arm.upper,
          arm.lower,
          targetLocal,
          poleLocal,
          this.armLengths.l1,
          this.armLengths.l2,
        );
      }

      this.root.updateMatrixWorld(true);

      // Snap wrists to the handle so fingers wrap around it rather than floating.
      for (const [arm, targetWorld] of [
        [this.armR, lowerGrip],
        [this.armL, upperGrip],
      ]) {
        const lowerWorldQ = arm.lower.getWorldQuaternion(new THREE.Quaternion());
        arm.hand.quaternion.copy(lowerWorldQ.invert().multiply(axeQuaternion));
        // Hide any tiny IK gap by pinning the hand group at the wrist; the palm covers it.
        arm.hand.position.y = -this.armLengths.l2;
        const handWorld = arm.hand.getWorldPosition(new THREE.Vector3());
        if (handWorld.distanceToSquared(targetWorld) > 0.0001) {
          // The visual handle always comes first; very small discrepancies are hidden by the glove.
          arm.hand.position.y = -this.armLengths.l2;
        }
      }
      this.root.updateMatrixWorld(true);
    } else {
      // Naturally relaxed pose before the first frame.
      this.armR.upper.rotation.set(0.1, 0, -0.15);
      this.armR.lower.rotation.x = -0.6;
      this.armL.upper.rotation.set(0.05, 0, 0.12);
      this.armL.lower.rotation.x = -0.45;
    }
  }
}
