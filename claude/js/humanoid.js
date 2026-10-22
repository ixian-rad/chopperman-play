// Stylised, anonymous low-detail humanoid. The whole body pose is a function of a single swing
// coordinate q (0 = axe overhead, ≈1 = impact). Arms and legs are solved with analytic two-bone IK
// so the hands stay on the handle and the feet stay planted.
import * as THREE from 'three';
import { RAPIER, GROUPS } from './physics.js';
import { clamp, lerp, smoothstep } from './rng.js';
import { plaidTexture, denimTexture } from './textures.js';

export const BODY = {
  hipH: 0.93,
  spine: 0.5,
  neck: 0.11,
  headR: 0.105,
  shoulderHalf: 0.19,
  hipHalf: 0.095,
  upperArm: 0.3,
  foreArm: 0.33, // includes the hand up to the grip centre
  thigh: 0.45,
  shin: 0.45,
  ankleH: 0.085,
  footHalf: 0.19,
};

// Swing shape constants (radians). alpha = arm angle from vertical (forward +),
// beta = handle angle from vertical (forward +), delta = beta - alpha (wrist cock).
const A_TOP = -0.22, A_IMP = 2.2;
const D_TOP = -2.33, D_IMP = -0.5;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

function release(q) {
  if (q <= 1) return Math.pow(Math.max(q, 0), 2.2);
  const e = Math.min(q - 1, 0.44);
  return 1 + 2.2 * e - 2.5 * e * e; // C1-continuous, slowing release after impact
}

// Axe-only kinematics (cheap): returns { S (shoulder centre), G (grip), h, b, O (knob) }.
export function axeFrame(q, stanceZ, out = {}) {
  const ex = Math.max(0, q - 1);
  const pitch = lerp(-0.14, 0.7, smoothstep(0.1, 1.0, q)) + 0.95 * ex;
  const drop = 0.1 * smoothstep(0.25, 1.0, q) + 0.3 * ex;
  const back = 0.07 * smoothstep(0.2, 1, q) + 0.08 * ex;
  const pelvis = (out.pelvis ??= new THREE.Vector3()).set(0, BODY.hipH - 0.02 - drop, stanceZ - back);
  const u = (out.spineDir ??= new THREE.Vector3()).set(0, Math.cos(pitch), Math.sin(pitch));
  const S = (out.S ??= new THREE.Vector3()).copy(pelvis).addScaledVector(u, BODY.spine);
  const alpha = A_TOP + (A_IMP - A_TOP) * q;
  const reach = lerp(0.4, 0.585, smoothstep(0, 1, q));
  const beta = alpha + D_TOP + (D_IMP - D_TOP) * release(q);
  const G = (out.G ??= new THREE.Vector3()).set(0, S.y + Math.cos(alpha) * reach, S.z + Math.sin(alpha) * reach);
  const h = (out.h ??= new THREE.Vector3()).set(0, Math.cos(beta), Math.sin(beta));
  const b = (out.b ??= new THREE.Vector3()).set(0, -Math.sin(beta), Math.cos(beta));
  const O = (out.O ??= new THREE.Vector3()).copy(G).addScaledVector(h, -0.05);
  out.pitch = pitch;
  out.alpha = alpha;
  out.beta = beta;
  out.upperGrip = lerp(0.52, 0.17, smoothstep(0.12, 0.85, q)) + 0.0 * ex;
  return out;
}

export function axeMatrix(f, m = new THREE.Matrix4()) {
  const z = new THREE.Vector3().crossVectors(f.b, f.h);
  m.makeBasis(f.b, f.h, z);
  m.setPosition(f.O);
  return m;
}

// Two-bone IK: writes the middle joint into `mid` and the (possibly clamped) end into `end`.
const _d = new THREE.Vector3(), _p = new THREE.Vector3();
export function twoBoneIK(root, target, l1, l2, pole, mid, end) {
  _d.subVectors(target, root);
  let dist = _d.length();
  const maxD = l1 + l2 - 1e-4, minD = Math.abs(l1 - l2) + 1e-4;
  _d.normalize();
  dist = clamp(dist, minD, maxD);
  end.copy(root).addScaledVector(_d, dist);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.subVectors(pole, root);
  _p.addScaledVector(_d, -_p.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0).addScaledVector(_d, -_d.y);
  _p.normalize();
  mid.copy(root).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
  return dist;
}

// Full body pose.
export function solvePose(q, stanceZ, opts = {}, P = {}) {
  const f = axeFrame(q, stanceZ, P);
  const breathe = opts.breathe ?? 0;
  const lookAt = opts.lookAt ?? new THREE.Vector3(0, 0.8, 0);
  const u = P.spineDir;
  if (breathe) {
    const pitch = f.pitch + breathe;
    u.set(0, Math.cos(pitch), Math.sin(pitch));
    P.S.copy(P.pelvis).addScaledVector(u, BODY.spine);
  }
  const fwd = (P.fwd ??= new THREE.Vector3()).set(0, -u.z, u.y); // torso forward (perp. to spine in sagittal plane)
  if (fwd.z < 0) fwd.negate();
  // Shoulders sit slightly below the top of the spine.
  const sc = (P.shoulderC ??= new THREE.Vector3()).copy(P.S).addScaledVector(u, -0.03);
  P.shoulderL = (P.shoulderL ?? new THREE.Vector3()).copy(sc).addScaledVector(X, BODY.shoulderHalf);
  P.shoulderR = (P.shoulderR ?? new THREE.Vector3()).copy(sc).addScaledVector(X, -BODY.shoulderHalf);
  P.neckTop = (P.neckTop ?? new THREE.Vector3()).copy(P.S).addScaledVector(u, BODY.neck);
  // Head looks toward the work.
  const look = (P.look ??= new THREE.Vector3()).subVectors(lookAt, P.neckTop).normalize();
  const headUp = (P.headUp ??= new THREE.Vector3()).copy(u).lerp(Y, 0.4).addScaledVector(look, 0.25).normalize();
  P.head = (P.head ?? new THREE.Vector3()).copy(P.neckTop).addScaledVector(headUp, BODY.headR * 0.95);
  P.lookDir = look;

  // Hands on the handle: left (lower) at the grip, right (upper) slides along the handle.
  P.handL = (P.handL ?? new THREE.Vector3()).copy(P.G);
  P.handR = (P.handR ?? new THREE.Vector3()).copy(P.O).addScaledVector(P.h, P.upperGrip);
  P.elbowL ??= new THREE.Vector3();
  P.elbowR ??= new THREE.Vector3();
  P.wristL ??= new THREE.Vector3();
  P.wristR ??= new THREE.Vector3();
  const poleL = (P.poleL ??= new THREE.Vector3()).copy(P.shoulderL).addScaledVector(X, 0.6).addScaledVector(u, -0.45).addScaledVector(fwd, -0.1);
  const poleR = (P.poleR ??= new THREE.Vector3()).copy(P.shoulderR).addScaledVector(X, -0.6).addScaledVector(u, -0.45).addScaledVector(fwd, -0.1);
  twoBoneIK(P.shoulderL, P.handL, BODY.upperArm, BODY.foreArm, poleL, P.elbowL, P.wristL);
  twoBoneIK(P.shoulderR, P.handR, BODY.upperArm, BODY.foreArm, poleR, P.elbowR, P.wristR);

  // Legs: feet planted, knees pushed forward / slightly out.
  P.hipL = (P.hipL ?? new THREE.Vector3()).copy(P.pelvis).addScaledVector(X, BODY.hipHalf);
  P.hipR = (P.hipR ?? new THREE.Vector3()).copy(P.pelvis).addScaledVector(X, -BODY.hipHalf);
  P.ankleL = (P.ankleL ?? new THREE.Vector3()).set(BODY.footHalf + 0.02, BODY.ankleH, stanceZ - 0.02);
  P.ankleR = (P.ankleR ?? new THREE.Vector3()).set(-BODY.footHalf - 0.02, BODY.ankleH, stanceZ + 0.02);
  P.kneeL ??= new THREE.Vector3();
  P.kneeR ??= new THREE.Vector3();
  const kpL = (P.kpL ??= new THREE.Vector3()).copy(P.hipL).add(new THREE.Vector3(0.12, 0, 1));
  const kpR = (P.kpR ??= new THREE.Vector3()).copy(P.hipR).add(new THREE.Vector3(-0.12, 0, 1));
  const endL = (P.endL ??= new THREE.Vector3()), endR = (P.endR ??= new THREE.Vector3());
  twoBoneIK(P.hipL, P.ankleL, BODY.thigh, BODY.shin, kpL, P.kneeL, endL);
  twoBoneIK(P.hipR, P.ankleR, BODY.thigh, BODY.shin, kpR, P.kneeR, endR);
  return P;
}

// ------------------------------------------------------------------------------------ meshes

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.len = len;
  return m;
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();

function placeSegment(mesh, a, b) {
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  _v.subVectors(b, a).normalize();
  mesh.quaternion.setFromUnitVectors(Y, _v);
}

export class Humanoid {
  constructor(scene, physics) {
    const shirt = new THREE.MeshStandardMaterial({ map: plaidTexture(), roughness: 0.92 });
    const jeans = new THREE.MeshStandardMaterial({ map: denimTexture(), roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb98c6e, roughness: 0.75 });
    const glove = new THREE.MeshStandardMaterial({ color: 0xb48a52, roughness: 0.85 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.7 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x2f4636, roughness: 0.85 });
    const belt = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.6 });
    this.group = new THREE.Group();
    scene.add(this.group);
    const add = (m) => { this.group.add(m); return m; };

    this.torso = add(capsule(0.15, BODY.spine - 0.16, shirt));
    this.torso.scale.set(1.18, 1, 0.74);
    this.shoulders = add(capsule(0.072, BODY.shoulderHalf * 2 - 0.04, shirt));
    this.pelvisM = add(capsule(0.115, 0.13, jeans));
    this.pelvisM.scale.set(1, 1, 0.78);
    this.beltM = add(new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.04, 20), belt));
    this.beltM.scale.set(1.15, 1, 0.8);
    this.neckM = add(capsule(0.048, BODY.neck * 0.8, skin));
    this.headM = add(new THREE.Mesh(new THREE.SphereGeometry(BODY.headR, 24, 18), skin));
    this.headM.scale.set(0.92, 1.08, 1.0);
    this.headM.castShadow = true;
    const capG = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(BODY.headR * 1.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), cap);
    dome.position.y = BODY.headR * 0.18;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), cap);
    brim.scale.set(1.1, 1, 1.25);
    brim.position.set(0, BODY.headR * 0.2, BODY.headR * 0.85);
    brim.rotation.x = 0.12;
    for (const m of [dome, brim]) { m.castShadow = true; capG.add(m); }
    this.capG = add(capG);
    this.upperArmL = add(capsule(0.05, BODY.upperArm - 0.04, shirt));
    this.upperArmR = add(capsule(0.05, BODY.upperArm - 0.04, shirt));
    this.foreArmL = add(capsule(0.042, BODY.foreArm - 0.1, shirt));
    this.foreArmR = add(capsule(0.042, BODY.foreArm - 0.1, shirt));
    this.handLM = add(new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), glove));
    this.handRM = add(new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), glove));
    for (const h of [this.handLM, this.handRM]) { h.scale.set(1.0, 1.25, 0.8); h.castShadow = true; }
    this.thighL = add(capsule(0.072, BODY.thigh - 0.06, jeans));
    this.thighR = add(capsule(0.072, BODY.thigh - 0.06, jeans));
    this.shinL = add(capsule(0.056, BODY.shin - 0.06, jeans));
    this.shinR = add(capsule(0.056, BODY.shin - 0.06, jeans));
    const bootGeo = new THREE.BoxGeometry(0.115, 0.1, 0.28);
    bootGeo.translate(0, -0.035, 0.07);
    this.bootL = add(new THREE.Mesh(bootGeo, boot));
    this.bootR = add(new THREE.Mesh(bootGeo, boot));
    for (const b of [this.bootL, this.bootR]) { b.castShadow = true; b.receiveShadow = true; }

    // Kinematic capsule colliders so flying pieces and chips bounce off the body.
    this.physics = physics;
    this.colliders = [];
    const defs = [
      ['pelvis', 'S', 0.15], ['hipL', 'kneeL', 0.07], ['hipR', 'kneeR', 0.07],
      ['kneeL', 'ankleL', 0.055], ['kneeR', 'ankleR', 0.055],
      ['shoulderL', 'elbowL', 0.05], ['shoulderR', 'elbowR', 0.05],
      ['elbowL', 'handL', 0.045], ['elbowR', 'handR', 0.045],
    ];
    for (const [a, b, r] of defs) {
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      this.colliders.push({ a, b, r, body, collider: null, len: 0 });
    }
  }

  setPose(P) {
    placeSegment(this.torso, P.pelvis, P.S);
    this.torso.position.addScaledVector(P.spineDir, 0.02);
    // Keep the torso's wide axis lateral.
    _m.makeBasis(X, P.spineDir, _v.crossVectors(X, P.spineDir));
    this.torso.quaternion.setFromRotationMatrix(_m);
    this.shoulders.position.copy(P.shoulderC);
    this.shoulders.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    this.pelvisM.position.copy(P.pelvis);
    this.pelvisM.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    this.beltM.position.copy(P.pelvis).addScaledVector(P.spineDir, 0.085);
    this.beltM.quaternion.setFromRotationMatrix(_m);
    placeSegment(this.neckM, P.S, P.neckTop);
    this.headM.position.copy(P.head);
    // Head orientation: forward = look direction, up = headUp.
    const f = _v.copy(P.lookDir);
    const up = P.headUp.clone().addScaledVector(f, -P.headUp.dot(f)).normalize();
    const side = new THREE.Vector3().crossVectors(up, f).normalize();
    _m.makeBasis(side, up, f);
    this.headM.quaternion.setFromRotationMatrix(_m);
    this.capG.position.copy(P.head);
    this.capG.quaternion.copy(this.headM.quaternion);

    placeSegment(this.upperArmL, P.shoulderL, P.elbowL);
    placeSegment(this.upperArmR, P.shoulderR, P.elbowR);
    placeSegment(this.foreArmL, P.elbowL, P.wristL);
    placeSegment(this.foreArmR, P.elbowR, P.wristR);
    this.foreArmL.position.lerpVectors(P.elbowL, P.wristL, 0.42);
    this.foreArmR.position.lerpVectors(P.elbowR, P.wristR, 0.42);
    this.handLM.position.copy(P.handL);
    this.handRM.position.copy(P.handR);
    this.handLM.quaternion.copy(this.foreArmL.quaternion);
    this.handRM.quaternion.copy(this.foreArmR.quaternion);
    placeSegment(this.thighL, P.hipL, P.kneeL);
    placeSegment(this.thighR, P.hipR, P.kneeR);
    placeSegment(this.shinL, P.kneeL, P.ankleL);
    placeSegment(this.shinR, P.kneeR, P.ankleR);
    this.bootL.position.copy(P.ankleL);
    this.bootR.position.copy(P.ankleR);
    this.bootL.rotation.set(0, 0.12, 0);
    this.bootR.rotation.set(0, -0.12, 0);
  }

  // Kinematic colliders follow the pose; `rig` maps the rig-local pose into the world.
  updateColliders(P, teleport = false, rig = null) {
    const rq = (this._rq ??= new THREE.Quaternion());
    if (rig) rq.setFromRotationMatrix(rig);
    else rq.identity();
    for (const c of this.colliders) {
      const a = P[c.a], b = P[c.b];
      const len = a.distanceTo(b);
      if (!c.collider || Math.abs(len - c.len) > 0.03) {
        if (c.collider) this.physics.world.removeCollider(c.collider, false);
        c.collider = this.physics.world.createCollider(
          RAPIER.ColliderDesc.capsule(Math.max(0.01, len / 2 - c.r * 0.5), c.r).setCollisionGroups(GROUPS.BODY).setFriction(0.6),
          c.body,
        );
        c.len = len;
      }
      _v.addVectors(a, b).multiplyScalar(0.5);
      _q.setFromUnitVectors(Y, new THREE.Vector3().subVectors(b, a).normalize());
      if (rig) {
        _v.applyMatrix4(rig);
        _q.premultiply(rq);
      }
      if (teleport) {
        c.body.setTranslation({ x: _v.x, y: _v.y, z: _v.z }, true);
        c.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
      } else {
        c.body.setNextKinematicTranslation({ x: _v.x, y: _v.y, z: _v.z });
        c.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      }
    }
  }
}
