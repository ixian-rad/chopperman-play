import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * Real-time cannon-es Physics Debug Wireframe Visualizer.
 * Syncs Three.js wireframe meshes to every shape of every body in `world.bodies`.
 */
export class PhysicsDebugWireframe {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.enabled = false;

    this.group = new THREE.Group();
    this.group.name = 'PhysicsDebugWireframes';
    this.group.visible = false;
    this.scene.add(this.group);

    this.bodyMap = new Map(); // Map<CANNON.Body, THREE.Group>

    this.staticMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.55
    });
    this.kinematicMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    });
    this.dynamicMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      wireframe: true,
      transparent: true,
      opacity: 0.92
    });
  }

  setEnabled(flag) {
    this.enabled = Boolean(flag);
    this.group.visible = this.enabled;
    if (this.enabled) {
      this.update();
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  _createShapeMesh(shape, material) {
    let geo = null;

    if (shape.type === CANNON.Shape.types.BOX) {
      const he = shape.halfExtents;
      geo = new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2);
    } else if (shape.type === CANNON.Shape.types.SPHERE) {
      geo = new THREE.SphereGeometry(shape.radius, 12, 10);
    } else if (shape.type === CANNON.Shape.types.PLANE) {
      geo = new THREE.PlaneGeometry(24, 24, 12, 12);
    } else if (
      shape.type === CANNON.Shape.types.CYLINDER ||
      (shape.radiusTop !== undefined && shape.height !== undefined)
    ) {
      geo = new THREE.CylinderGeometry(
        shape.radiusTop,
        shape.radiusBottom,
        shape.height,
        12,
        1
      );
    } else if (
      shape.type === CANNON.Shape.types.CONVEXPOLYHEDRON &&
      shape.vertices &&
      shape.faces
    ) {
      const positions = [];
      for (const face of shape.faces) {
        for (let i = 1; i < face.length - 1; i++) {
          const v0 = shape.vertices[face[0]];
          const v1 = shape.vertices[face[i]];
          const v2 = shape.vertices[face[i + 1]];
          positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
        }
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    } else {
      geo = new THREE.SphereGeometry(0.1, 6, 6);
    }

    return new THREE.Mesh(geo, material);
  }

  update() {
    if (!this.enabled) return;

    const activeBodies = new Set(this.world.bodies);

    // Remove wireframe groups for bodies no longer in the physics world
    for (const [body, wfGroup] of this.bodyMap.entries()) {
      if (!activeBodies.has(body)) {
        this.group.remove(wfGroup);
        wfGroup.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
        });
        this.bodyMap.delete(body);
      }
    }

    // Add or update wireframe groups for current physics bodies
    for (const body of this.world.bodies) {
      let wfGroup = this.bodyMap.get(body);
      if (!wfGroup) {
        wfGroup = new THREE.Group();
        const mat =
          body.type === CANNON.Body.DYNAMIC
            ? this.dynamicMat
            : body.type === CANNON.Body.KINEMATIC
            ? this.kinematicMat
            : this.staticMat;

        for (let i = 0; i < body.shapes.length; i++) {
          const shape = body.shapes[i];
          const offset = body.shapeOffsets[i];
          const orient = body.shapeOrientations[i];
          const mesh = this._createShapeMesh(shape, mat);
          if (offset) {
            mesh.position.set(offset.x, offset.y, offset.z);
          }
          if (orient) {
            mesh.quaternion.set(orient.x, orient.y, orient.z, orient.w);
          }
          wfGroup.add(mesh);
        }

        this.group.add(wfGroup);
        this.bodyMap.set(body, wfGroup);
      }

      wfGroup.position.set(body.position.x, body.position.y, body.position.z);
      wfGroup.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w
      );
    }
  }
}
