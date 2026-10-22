// Splitting axe: curved hickory handle + wedge-shaped forged head.
// Local frame: origin at the knob end, handle along +Y, blade edge toward +X, thickness along Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER, GROUPS } from './physics.js';
import { smoothstep, lerp } from './rng.js';
import { hickoryTexture } from './textures.js';

export const AXE = {
  length: 0.8,
  headMass: 2.6, // kg (≈ 5.7 lb splitting axe head)
  handleMass: 0.9,
  headCenter: new THREE.Vector3(0.025, 0.735, 0),
};

const HEAD_U = 26, HEAD_V = 12;
const edgeX = (v) => 0.132 - 0.018 * (2 * v - 1) ** 2;
const headBottom = (u) => 0.685 - 0.045 * Math.pow(smoothstep(0.45, 1, u), 1.3);
const headTop = (u) => 0.795 + 0.035 * Math.pow(smoothstep(0.45, 1, u), 1.3) - 0.01 * (1 - smoothstep(0, 0.12, u));
const halfT = (u) => (u < 0.47 ? 0.022 : 0.0008 + 0.0212 * Math.pow(1 - (u - 0.47) / 0.53, 0.75));

function headPoint(u, v) {
  const x = -0.055 + (edgeX(v) + 0.055) * u;
  const y = lerp(headBottom(u), headTop(u), v);
  return [x, y];
}

// Points along the cutting edge (local space) used for impact detection.
export const EDGE_POINTS = [];
for (let i = 0; i <= 8; i++) {
  const v = i / 8;
  const [x, y] = headPoint(1, v);
  EDGE_POINTS.push(new THREE.Vector3(x, y, 0));
}

// Head geometry. The colour attribute is RGBA: rgb = paint/steel colour, a = "polish" (bare
// ground steel near the edge), which drives metalness/roughness in the shader.
function buildHeadGeometry(paint = [0.07, 0.07, 0.075]) {
  const front = [], back = [];
  const pos = [], col = [], idx = [];
  const polished = [0.82, 0.83, 0.85];
  const push = (x, y, z, u) => {
    pos.push(x, y, z);
    const t = smoothstep(0.8, 0.88, u);
    col.push(lerp(paint[0], polished[0], t), lerp(paint[1], polished[1], t), lerp(paint[2], polished[2], t), t);
    return pos.length / 3 - 1;
  };
  for (let i = 0; i <= HEAD_U; i++) {
    const u = i / HEAD_U;
    front.push([]);
    back.push([]);
    for (let j = 0; j <= HEAD_V; j++) {
      const v = j / HEAD_V;
      const [x, y] = headPoint(u, v);
      // Slight crown on the cheeks.
      const t = halfT(u) * (1 - 0.08 * (2 * v - 1) ** 2);
      front[i].push(push(x, y, t, u));
      back[i].push(push(x, y, -t, u));
    }
  }
  for (let i = 0; i < HEAD_U; i++) {
    for (let j = 0; j < HEAD_V; j++) {
      const a = front[i][j], b = front[i + 1][j], c = front[i + 1][j + 1], d = front[i][j + 1];
      idx.push(a, b, c, a, c, d);
      const a2 = back[i][j], b2 = back[i + 1][j], c2 = back[i + 1][j + 1], d2 = back[i][j + 1];
      idx.push(a2, c2, b2, a2, d2, c2);
    }
  }
  const cheeks = new THREE.BufferGeometry();
  cheeks.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cheeks.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  cheeks.setIndex(idx);
  cheeks.computeVertexNormals(); // smooth convex cheeks
  // Perimeter faces (poll, top, bottom, edge) get flat normals.
  const rim = [];
  for (let i = 0; i < HEAD_U; i++) {
    rim.push(front[i][0], back[i][0], back[i + 1][0], front[i][0], back[i + 1][0], front[i + 1][0]);
    const T = HEAD_V;
    rim.push(front[i][T], front[i + 1][T], back[i + 1][T], front[i][T], back[i + 1][T], back[i][T]);
  }
  for (let j = 0; j < HEAD_V; j++) {
    rim.push(front[0][j], front[0][j + 1], back[0][j + 1], front[0][j], back[0][j + 1], back[0][j]);
    const U = HEAD_U;
    rim.push(front[U][j], back[U][j], back[U][j + 1], front[U][j], back[U][j + 1], front[U][j + 1]);
  }
  const rp = [], rc = [];
  for (const k of rim) {
    rp.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    rc.push(col[k * 4], col[k * 4 + 1], col[k * 4 + 2], col[k * 4 + 3]);
  }
  const rimGeo = new THREE.BufferGeometry();
  rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rimGeo.setAttribute('color', new THREE.Float32BufferAttribute(rc, 4));
  rimGeo.computeVertexNormals();
  const cheeksFlat = cheeks.toNonIndexed();
  const merged = mergeGeometries([cheeksFlat, rimGeo]);
  cheeks.dispose(); cheeksFlat.dispose(); rimGeo.dispose();
  return merged;
}

function buildHandleGeometry() {
  const RINGS = 48, SEG = 14, L = AXE.length;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= RINGS; i++) {
    const y = (i / RINGS) * L;
    const swell = Math.exp(-(((y - 0.025) / 0.03) ** 2));
    const a = (y > 0.64 ? 0.0185 : 0.0165) + 0.009 * swell;
    const b = 0.0125 + 0.006 * swell;
    const cx = 0.007 * Math.sin((Math.PI * y) / L) - 0.004 * swell;
    for (let j = 0; j <= SEG; j++) {
      const t = (j / SEG) * Math.PI * 2;
      pos.push(cx + Math.cos(t) * a, y, Math.sin(t) * b);
      uv.push(j / SEG, y * 2);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j, b = a + SEG + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // End caps.
  const capB = new THREE.CircleGeometry(1, SEG);
  capB.rotateX(Math.PI / 2);
  capB.scale(0.0255, 1, 0.0185);
  capB.translate(-0.004, 0, 0);
  const capT = new THREE.CircleGeometry(1, SEG);
  capT.rotateX(-Math.PI / 2);
  capT.scale(0.0185, 1, 0.0125);
  capT.translate(0, L, 0);
  const merged = mergeGeometries([g, capB, capT]);
  g.dispose(); capB.dispose(); capT.dispose();
  return merged;
}

function headMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.3 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
      #ifdef USE_COLOR_ALPHA
        metalnessFactor = mix(0.35, 0.95, vColor.a);
        roughnessFactor = mix(0.5, 0.2, vColor.a);
        diffuseColor.a = 1.0;
      #endif`,
    );
  };
  return m;
}

export class Axe {
  constructor(scene, physics) {
    this.group = new THREE.Group();
    this.handleMats = {
      hickory: new THREE.MeshStandardMaterial({ map: hickoryTexture(), roughness: 0.45, color: 0xfff4e6 }),
      composite: new THREE.MeshStandardMaterial({ color: 0xd8641c, roughness: 0.35, metalness: 0.05 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.4, metalness: 0.8 }),
    };
    this.handle = new THREE.Mesh(buildHandleGeometry(), this.handleMats.hickory);
    this.headMat = headMaterial();
    this.head = new THREE.Mesh(buildHeadGeometry(), this.headMat);
    // Rubber grip for non-wood handles.
    const gripGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.22, 14);
    gripGeo.translate(0, 0.13, 0);
    this.grip = new THREE.Mesh(gripGeo, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }));
    this.grip.visible = false;
    // Wedge (steel) visible in the top of the eye.
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4 }));
    wedge.position.set(0.0, 0.8, 0);
    for (const m of [this.handle, this.head, wedge, this.grip]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    scene.add(this.group);

    // Kinematic physics body (pushes chips and pieces around; doesn't touch the intact log).
    this.physics = physics;
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.019, 0.32, 0.014).setTranslation(0.004, 0.33, 0).setCollisionGroups(GROUPS.AXE).setFriction(0.5),
      this.body,
    );
    const hp = this.head.geometry.getAttribute('position').array;
    const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(hp));
    if (hull) {
      physics.world.createCollider(hull.setCollisionGroups(GROUPS.AXE).setFriction(0.4), this.body);
    }
    this._v = new THREE.Vector3();
  }

  // Swap the visual for a different axe model (mass is handled by the swing dynamics).
  setType(a) {
    this.head.geometry.dispose();
    this.head.geometry = buildHeadGeometry(a.paint);
    // Heavier heads are fatter (thicker cheeks) and a little taller.
    const k = Math.cbrt(a.headMass / 2.6);
    this.head.scale.set(1, 1, Math.pow(k, 1.6));
    this.handle.material = this.handleMats[a.handle] ?? this.handleMats.hickory;
    this.grip.visible = a.handle !== 'hickory';
  }

  // Set transform from a Matrix4 (world). teleport=true skips kinematic velocity.
  setMatrix(m, teleport = false) {
    m.decompose(this.group.position, this.group.quaternion, this.group.scale);
    const p = this.group.position, q = this.group.quaternion;
    if (teleport) {
      this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    } else {
      this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }
}
