// Thin wrapper around Rapier: world, collision groups, body<->mesh syncing and debug lines.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

// Collision group bits.
export const G = {
  STATIC: 0x0001,
  LOG: 0x0002,
  PIECE: 0x0004,
  CHIP: 0x0008,
  AXE: 0x0010,
  BODY: 0x0020,
};
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

export const GROUPS = {
  STATIC: groups(G.STATIC, 0xffff),
  LOG: groups(G.LOG, G.PIECE | G.CHIP),
  PIECE: groups(G.PIECE, G.STATIC | G.LOG | G.PIECE | G.CHIP | G.AXE | G.BODY),
  PIECE_NO_AXE: groups(G.PIECE, G.STATIC | G.LOG | G.PIECE | G.CHIP | G.BODY),
  CHIP: groups(G.CHIP, G.STATIC | G.LOG | G.PIECE | G.CHIP | G.AXE | G.BODY),
  AXE: groups(G.AXE, G.PIECE | G.CHIP),
  BODY: groups(G.BODY, G.PIECE | G.CHIP),
};

export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.dt = 1 / 120;
    this.world.timestep = this.dt;
    this.world.numSolverIterations = 8;
    this.synced = new Set(); // { body, mesh } pairs kept in sync with rendering
    this.debugLines = null;
    this.time = 0;
  }

  step() {
    this.world.step();
    this.time += this.dt;
  }

  // Static (fixed) collider helper.
  addStatic(desc, pos = [0, 0, 0], quat = null, { friction = 0.8, restitution = 0.1 } = {}) {
    const bd = RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]);
    if (quat) bd.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const body = this.world.createRigidBody(bd);
    desc.setCollisionGroups(GROUPS.STATIC).setFriction(friction).setRestitution(restitution);
    this.world.createCollider(desc, body);
    return body;
  }

  addSynced(body, mesh) {
    const entry = { body, mesh };
    this.synced.add(entry);
    return entry;
  }

  removeSynced(entry) {
    if (!entry) return;
    this.synced.delete(entry);
    if (entry.body) this.world.removeRigidBody(entry.body);
    entry.body = null;
  }

  syncMeshes() {
    for (const e of this.synced) {
      const t = e.body.translation();
      const r = e.body.rotation();
      e.mesh.position.set(t.x, t.y, t.z);
      e.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  // ---- debug wireframes (Rapier's built-in debug renderer)
  createDebug(scene) {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 });
    this.debugLines = new THREE.LineSegments(geo, mat);
    this.debugLines.renderOrder = 999;
    this.debugLines.frustumCulled = false;
    this.debugLines.visible = false;
    scene.add(this.debugLines);
  }

  updateDebug() {
    if (!this.debugLines || !this.debugLines.visible) return;
    const { vertices, colors } = this.world.debugRender();
    const geo = this.debugLines.geometry;
    const pos = geo.getAttribute('position');
    if (!pos || pos.array.length !== vertices.length) {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 4));
    } else {
      pos.array.set(vertices);
      pos.needsUpdate = true;
      const col = geo.getAttribute('color');
      col.array.set(colors);
      col.needsUpdate = true;
    }
    geo.setDrawRange(0, vertices.length / 3);
  }

  bodyCount() {
    return this.world.bodies.len();
  }
}
