import * as THREE from 'three';

/**
 * Visual + timing layer for the campaign's final boss, The Iron Crown.
 *
 * The log itself still fractures through DebrisSystem. This module wraps three
 * stone-bound sections around it and releases one each time the round's work
 * crosses a third. Each section is a separate group and, when a Rapier world is
 * supplied, a real dynamic body with its own collider and mass, so a released
 * section collides with the block and the yard instead of merely animating
 * downward. Non-boss rounds cost no extra bodies or draw calls.
 */

const SECTION_TURNS = [0.45, 2.55, 4.65];
const SECTION_HEIGHTS = [0.3, 0.52, 0.74];

function makeStoneMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x6d7374,
    roughness: 0.72,
    metalness: 0.22,
    flatShading: true,
  });
}

function makeBandMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x3a3f41,
    roughness: 0.38,
    metalness: 0.72,
    flatShading: true,
  });
}

function makeSeamMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffb457,
    emissive: 0x7a3c08,
    emissiveIntensity: 1.1,
    roughness: 0.34,
    metalness: 0.55,
    toneMapped: false,
  });
}

export class CrownSections {
  constructor(
    scene,
    { onRelease = null, world = null, RAPIER = null, collisionGroups = 0x0004fffd } = {},
  ) {
    this.scene = scene;
    this.onRelease = onRelease;
    this.world = world;
    this.RAPIER = RAPIER;
    this.collisionGroups = collisionGroups;
    this.group = new THREE.Group();
    this.group.name = 'iron-crown';
    this.group.visible = false;
    scene.add(this.group);
    this.sections = [];
    this.metrics = null;
    this.total = 3;
    this.required = 1;
    this.released = 0;
    this.elapsed = 0;
    this.stoneMaterial = makeStoneMaterial();
    this.bandMaterial = makeBandMaterial();
    this.seamMaterial = makeSeamMaterial();
  }

  /** Build three sections for a final-boss log, or hide the layer entirely. */
  setLog(metrics, { finalBoss = false, sections = 3, required = 1 } = {}) {
    this.clear();
    this.metrics = metrics ? { ...metrics } : null;
    this.total = Math.max(1, Math.round(Number(sections) || 3));
    this.required = Math.max(1, Number(required) || 1);
    this.released = 0;
    this.elapsed = 0;
    if (!finalBoss || !metrics) {
      this.group.visible = false;
      return;
    }
    const radius = Math.max(0.12, metrics.radius || 0.2);
    const height = Math.max(0.22, metrics.height || 0.5);
    this.group.position.set(metrics.x || 0, metrics.baseY || 0, metrics.z || 0);
    this.group.visible = true;
    for (let i = 0; i < this.total; i += 1) {
      const section = new THREE.Group();
      const y = height * (SECTION_HEIGHTS[i] ?? 0.3 + i * 0.22);
      const turn = SECTION_TURNS[i] ?? i * 2.1;
      section.position.y = y;
      // Iron band around the round.
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.035, radius * 0.075, 5, 22),
        this.bandMaterial,
      );
      band.rotation.x = Math.PI / 2;
      band.castShadow = true;
      section.add(band);
      // A bright seam marks where the section will break.
      const seam = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.055, radius * 0.022, 4, 22),
        this.seamMaterial,
      );
      seam.rotation.x = Math.PI / 2;
      seam.position.y = radius * 0.012;
      section.add(seam);
      // Three chunky stones clamped around the circumference.
      for (let s = 0; s < 3; s += 1) {
        const angle = turn + (s / 3) * Math.PI * 2;
        const stone = new THREE.Mesh(
          new THREE.DodecahedronGeometry(radius * (0.22 + s * 0.012), 0),
          this.stoneMaterial,
        );
        stone.position.set(
          Math.cos(angle) * radius * 1.01,
          radius * (s % 2 === 0 ? 0.045 : -0.03),
          Math.sin(angle) * radius * 1.01,
        );
        stone.scale.set(1.35, 0.8, 1.05);
        stone.rotation.set(angle * 0.7, angle, s * 0.9);
        stone.castShadow = true;
        section.add(stone);
      }
      this.group.add(section);
      this.sections.push({
        group: section,
        seam,
        released: false,
        fall: null,
        baseY: y,
      });
    }
    this.group.updateMatrixWorld(true);
  }

  /** Release sections as the log's accumulated work crosses each third. */
  sync(done = 0, required = this.required) {
    this.required = Math.max(1, Number(required) || 1);
    if (!this.group.visible) return this.released;
    const progress = Math.max(0, Math.min(1, Number(done) / this.required));
    const target = Math.min(this.total, Math.floor(progress * this.total + 1e-6));
    while (this.released < target) {
      this.releaseSection(this.released);
      this.released += 1;
    }
    return this.released;
  }

  releaseSection(index) {
    const section = this.sections[index];
    if (!section || section.released) return null;
    section.released = true;
    section.fall = {
      vy: 0.35 + Math.random() * 0.35,
      vx: (Math.random() - 0.5) * 0.9,
      vz: (Math.random() - 0.5) * 0.9,
      spin: (Math.random() - 0.5) * 6,
    };
    section.seam.material = this.seamMaterial;
    const position = new THREE.Vector3();
    section.group.getWorldPosition(position);
    // Each released section becomes its own Rapier body: a stone-bound ring is
    // heavy, collides with the block/ground/debris, and keeps its own momentum.
    if (this.world && this.RAPIER) {
      const radius = Math.max(0.08, (this.metrics?.radius || 0.2) * 1.12);
      const halfHeight = Math.max(0.045, (this.metrics?.height || 0.5) * 0.07);
      const body = this.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(position.x, position.y, position.z)
          .setLinearDamping(0.26)
          .setAngularDamping(0.42)
          .setCcdEnabled(true),
      );
      this.world.createCollider(
        this.RAPIER.ColliderDesc.cylinder(halfHeight, radius)
          .setDensity(860)
          .setFriction(0.82)
          .setRestitution(0.04)
          .setCollisionGroups(this.collisionGroups)
          .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      const mass = Math.max(0.2, body.mass() || 1);
      const angle = SECTION_TURNS[index] ?? index * 2.1;
      body.applyImpulse(
        {
          x: Math.cos(angle) * mass * 0.72,
          y: mass * 0.16,
          z: Math.sin(angle) * mass * 0.72,
        },
        true,
      );
      body.setAngvel(
        {
          x: (Math.random() - 0.5) * 2.6,
          y: (Math.random() - 0.5) * 2.2,
          z: (Math.random() - 0.5) * 2.6,
        },
        true,
      );
      section.body = body;
      section.fall = null;
    }
    if (typeof this.onRelease === 'function') {
      this.onRelease({
        index,
        total: this.total,
        released: this.released + 1,
        standing: this.total - this.released - 1,
        position,
        physical: Boolean(section.body),
        mass: section.body ? Number(section.body.mass().toFixed(2)) : null,
      });
    }
    return section;
  }

  /** Remove one section's Rapier body without touching its visuals. */
  removeBody(section) {
    if (!section || !section.body) return;
    if (this.world) this.world.removeRigidBody(section.body);
    section.body = null;
  }

  update(dt = 0) {
    if (!this.group.visible) return;
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    this.elapsed += step;
    const pulse = 0.9 + Math.sin(this.elapsed * 3.4) * 0.35;
    if (this.seamMaterial) this.seamMaterial.emissiveIntensity = pulse;
    for (const section of this.sections) {
      if (!section.released) continue;
      if (section.body && this.world) {
        // Follow the rigid body exactly: position and quaternion both, so a
        // section visibly tumbles and settles where the physics puts it.
        const bodyPosition = section.body.translation();
        const bodyRotation = section.body.rotation();
        const origin = this.group.position;
        section.group.position.set(
          bodyPosition.x - origin.x,
          bodyPosition.y - origin.y,
          bodyPosition.z - origin.z,
        );
        section.group.quaternion.set(
          bodyRotation.x,
          bodyRotation.y,
          bodyRotation.z,
          bodyRotation.w,
        );
        if (bodyPosition.y < origin.y - (this.metrics?.height || 0.5) * 1.4) {
          section.group.visible = false;
          this.removeBody(section);
        }
        continue;
      }
      if (!section.fall) continue;
      section.group.position.y -= section.fall.vy * step;
      section.group.position.x += section.fall.vx * step;
      section.group.position.z += section.fall.vz * step;
      section.group.rotation.x += section.fall.spin * step;
      section.group.rotation.z += section.fall.spin * 0.6 * step;
      section.fall.vy += 2.8 * step;
      if (section.group.position.y < -(this.metrics?.height || 0.5)) {
        section.group.visible = false;
        section.fall = null;
      }
    }
  }

  clear() {
    for (const section of this.sections) {
      this.removeBody(section);
      section.group.traverse((object) => {
        if (object.isMesh && object.geometry) object.geometry.dispose();
      });
      this.group.remove(section.group);
    }
    this.sections = [];
    this.released = 0;
  }

  /** Released sections that currently own a live Rapier body. */
  get physicalBodies() {
    return this.sections.reduce((sum, section) => sum + (section.body ? 1 : 0), 0);
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
    this.stoneMaterial?.dispose();
    this.bandMaterial?.dispose();
    this.seamMaterial?.dispose();
  }
}
