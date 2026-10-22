import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWoodTexture } from './utils.js';

export function quaternionFromHandleAndBlade(handleDirection, bladeHint) {
  const y = handleDirection.clone().normalize();
  const x = bladeHint.clone().sub(y.clone().multiplyScalar(bladeHint.dot(y)));
  if (x.lengthSq() < 0.00001) {
    x.set(1, 0, 0).sub(y.clone().multiplyScalar(y.x));
    if (x.lengthSq() < 0.00001) x.set(0, 0, 1);
  }
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const basis = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

export class Axe {
  constructor(scene, world, RAPIER) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    // Head at the end of a long-hafted felling axe. The extra reach keeps the
    // woodcutter's boots clear of the chopping block at impact.
    this.localHead = new THREE.Vector3(0.02, 0.86, 0);
    this.localEdge = new THREE.Vector3(0.265, 0.86, 0);
    this.group = new THREE.Group();
    this.group.name = 'felling-axe';
    this.buildMesh();
    scene.add(this.group);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0.2, 1.2, 0),
    );
    this.body.enableCcd(true);

    const axeGroups = 0x0002fffb;
    const handle = RAPIER.ColliderDesc.cuboid(0.032, 0.55, 0.032)
      .setTranslation(0, 0.08, 0)
      .setFriction(0.7)
      .setRestitution(0.05)
      .setCollisionGroups(axeGroups);
    this.handleCollider = world.createCollider(handle, this.body);

    const head = RAPIER.ColliderDesc.cuboid(0.16, 0.105, 0.055)
      .setTranslation(0.02, 0.86, 0)
      .setFriction(0.55)
      .setRestitution(0.08)
      .setCollisionGroups(axeGroups)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
    this.headCollider = world.createCollider(head, this.body);

    const edge = RAPIER.ColliderDesc.cuboid(0.075, 0.07, 0.035)
      .setTranslation(0.19, 0.86, 0)
      .setFriction(0.5)
      .setRestitution(0.05)
      .setCollisionGroups(axeGroups)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.edgeCollider = world.createCollider(edge, this.body);

    this.colliderHandles = new Set([
      this.handleCollider.handle,
      this.headCollider.handle,
      this.edgeCollider.handle,
    ]);
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.lastQuaternion = new THREE.Quaternion();
  }

  buildMesh() {
    const woodTexture = createWoodTexture({
      base: '#835b35',
      dark: '#4a2f1b',
      light: '#c08c54',
      grain: 80,
      seed: 118,
      repeatX: 1.4,
      repeatY: 2.2,
    });
    const handleMat = new THREE.MeshStandardMaterial({
      map: woodTexture,
      color: 0xd8b488,
      roughness: 0.68,
      metalness: 0,
    });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x3d2c20, roughness: 0.92 });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0xb4b7b1,
      metalness: 0.9,
      roughness: 0.27,
      envMapIntensity: 1.2,
    });
    const steelDark = new THREE.MeshStandardMaterial({
      color: 0x6e7473,
      metalness: 0.86,
      roughness: 0.36,
    });
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e3dc,
      metalness: 1,
      roughness: 0.14,
      envMapIntensity: 1.6,
    });
    this.materials = { handleMat, leatherMat, steelMat, steelDark, edgeMat };

    // Slightly curved handle; local +Y runs from grip toward the head.
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const y = -0.46 + t * 1.32;
      const bend = Math.sin(t * Math.PI) * 0.012;
      points.push(new THREE.Vector3(bend, y, 0));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const handleGeo = new THREE.TubeGeometry(curve, 28, 0.029, 9, false);
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.castShadow = true;
    handle.receiveShadow = true;
    this.group.add(handle);

    // Tapered swell at the butt.
    const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.09, 10), handleMat);
    butt.position.y = -0.455;
    butt.castShadow = true;
    this.group.add(butt);

    // Leather grip wraps.
    for (let i = 0; i < 13; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.0052, 5, 14), leatherMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.23 + i * 0.032;
      ring.castShadow = true;
      this.group.add(ring);
    }
    const gripBase = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.42, 10), leatherMat);
    gripBase.position.y = -0.03;
    gripBase.castShadow = true;
    gripBase.receiveShadow = true;
    // Sit the leather just under the rings so the silhouette stays slim.
    gripBase.scale.set(0.985, 1, 0.985);
    this.group.add(gripBase);

    // Lanyard.
    const lanyardCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.47, 0.02),
      new THREE.Vector3(0.01, -0.52, 0.05),
      new THREE.Vector3(0.02, -0.49, 0.075),
    ]);
    const lanyard = new THREE.Mesh(new THREE.TubeGeometry(lanyardCurve, 10, 0.005, 5, false), leatherMat);
    this.group.add(lanyard);

    // Axe head: extruded silhouette with a bright cutting edge.
    const headGroup = new THREE.Group();
    headGroup.position.y = 0.86;
    headGroup.scale.set(0.8, 0.84, 0.86);
    this.headGroup = headGroup;
    this.group.add(headGroup);

    const silhouette = new THREE.Shape();
    silhouette.moveTo(-0.12, -0.055);
    silhouette.lineTo(-0.128, 0.062);
    silhouette.lineTo(-0.045, 0.076);
    silhouette.lineTo(0.035, 0.088);
    silhouette.lineTo(0.12, 0.108);
    silhouette.lineTo(0.195, 0.106);
    silhouette.lineTo(0.24, 0.078);
    silhouette.quadraticCurveTo(0.277, 0.036, 0.288, 0.0);
    silhouette.quadraticCurveTo(0.272, -0.052, 0.24, -0.088);
    silhouette.lineTo(0.19, -0.128);
    silhouette.lineTo(0.145, -0.16);
    silhouette.lineTo(0.092, -0.118);
    silhouette.lineTo(0.032, -0.086);
    silhouette.lineTo(-0.045, -0.073);
    silhouette.lineTo(-0.128, -0.062);
    silhouette.closePath();

    const headGeo = new THREE.ExtrudeGeometry(silhouette, {
      depth: 0.07,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.007,
      bevelSegments: 2,
      curveSegments: 2,
    });
    headGeo.translate(0, 0, -0.035);
    const head = new THREE.Mesh(headGeo, steelMat);
    head.castShadow = true;
    head.receiveShadow = true;
    headGroup.add(head);

    // Poll (back of the axe).
    const poll = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.14, 0.075), steelDark);
    poll.position.x = -0.125;
    poll.castShadow = true;
    headGroup.add(poll);

    // A polished bevel near the curved cutting edge.
    const bevelShape = new THREE.Shape();
    bevelShape.moveTo(0.165, -0.148);
    bevelShape.quadraticCurveTo(0.255, -0.07, 0.284, 0);
    bevelShape.quadraticCurveTo(0.255, 0.075, 0.165, 0.11);
    bevelShape.lineTo(0.13, 0.078);
    bevelShape.quadraticCurveTo(0.235, 0.045, 0.252, 0);
    bevelShape.quadraticCurveTo(0.235, -0.045, 0.135, -0.112);
    bevelShape.closePath();
    const bevelGeo = new THREE.ExtrudeGeometry(bevelShape, {
      depth: 0.082,
      bevelEnabled: false,
      curveSegments: 3,
    });
    bevelGeo.translate(0, 0, -0.041);
    const bevel = new THREE.Mesh(bevelGeo, edgeMat);
    bevel.castShadow = true;
    headGroup.add(bevel);

    // Polished cutting-edge highlight. This catches the sun and reads clearly
    // as an axe bit from almost any orbit angle.
    const edgeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.186, 0.112, 0.037),
      new THREE.Vector3(0.241, 0.082, 0.038),
      new THREE.Vector3(0.278, 0.035, 0.039),
      new THREE.Vector3(0.287, 0.0, 0.04),
      new THREE.Vector3(0.274, -0.04, 0.039),
      new THREE.Vector3(0.241, -0.086, 0.038),
      new THREE.Vector3(0.168, -0.14, 0.037),
    ]);
    const edgeHighlight = new THREE.Mesh(
      new THREE.TubeGeometry(edgeCurve, 18, 0.0065, 5, false),
      edgeMat,
    );
    headGroup.add(edgeHighlight);
    const edgeHighlightBack = edgeHighlight.clone();
    edgeHighlightBack.position.z = -0.08;
    headGroup.add(edgeHighlightBack);

    // A small inset forge mark (anonymous).
    const mark = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.004, 5, 18), steelDark);
    mark.position.set(0.055, -0.005, 0.038);
    mark.rotation.x = Math.PI / 2;
    mark.rotation.z = 0.2;
    headGroup.add(mark);

    // Cylindrical eye collar where the handle passes through the head.
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.16, 12), steelDark);
    collar.position.set(-0.025, 0, 0);
    collar.castShadow = true;
    headGroup.add(collar);
    const topWedge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.18, 0.012), steelMat);
    topWedge.position.set(-0.025, 0.01, 0);
    topWedge.rotation.z = 0.04;
    headGroup.add(topWedge);

    // A few honest nicks in the bit.
    const nickMat = new THREE.MeshStandardMaterial({ color: 0x5b605e, metalness: 0.8, roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const nick = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.007, 0.065), nickMat);
      nick.position.set(0.267 + i * 0.0015, -0.065 + i * 0.036, 0.004);
      nick.rotation.z = (i % 2 ? 1 : -1) * 0.2;
      headGroup.add(nick);
    }

    // Handle-end keeper / metal wedge at the top.
    const keeper = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.023, 0.075), steelDark);
    keeper.position.y = 0.082;
    headGroup.add(keeper);

    this.group.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = true;
    });
    this.headMesh = head;
    this.mergeStaticMeshes();
    this.addWeatherMesh();
  }

  /** Snow packs onto the poll and the wet steel loses its dry gleam. */
  addWeatherMesh() {
    const snowMat = new THREE.MeshBasicMaterial({
      color: 0xe9f5ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const snow = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 4), snowMat);
    snow.position.set(0.02, 0.115, 0);
    snow.scale.set(1.7, 0.24, 1.0);
    snow.castShadow = false;
    snow.receiveShadow = false;
    snow.visible = false;
    snow.renderOrder = 2;
    this.headGroup.add(snow);
    this.weatherSnow = snow;
    this.weatherSnowMat = snowMat;
    this.weatherWet = 0;
    this.weatherSnowLoad = 0;
  }

  /**
   * Weather on the axe itself. A snow cap fades in/out with the same storm
   * load used by the log, and wet steel darkens and roughens. Called every
   * frame but only writes when the value has actually moved.
   */
  setWeatherLook(wetness = 0, snowLoad = 0) {
    const wet = THREE.MathUtils.clamp(wetness, 0, 1);
    const snow = THREE.MathUtils.clamp(snowLoad, 0, 1);
    if (Math.abs(wet - this.weatherWet) < 0.004 && Math.abs(snow - this.weatherSnowLoad) < 0.004) {
      return;
    }
    this.weatherWet = wet;
    this.weatherSnowLoad = snow;
    if (this.weatherSnow) {
      this.weatherSnow.visible = snow > 0.03;
      this.weatherSnowMat.opacity = snow * 0.86;
      this.weatherSnow.scale.set(1.7, 0.18 + snow * 0.28, 1.0);
    }
    const mats = this.materials;
    if (mats?.steelMat) {
      mats.steelMat.roughness = 0.27 + wet * 0.2 + snow * 0.06;
      mats.steelMat.color.setHex(wet > 0.35 ? 0x9ea5a4 : 0xb4b7b1);
    }
    if (mats?.edgeMat) {
      mats.edgeMat.roughness = 0.14 + wet * 0.24;
      mats.edgeMat.color.setHex(wet > 0.35 ? 0xc9d1d0 : 0xe2e3dc);
    }
  }

  /**
   * Collapse the thirty-odd decorative axe meshes into one draw per material.
   * The axe is a single rigid body, so all of these transforms are static.
   */
  mergeStaticMeshes() {
    this.group.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const buckets = new Map();
    const originals = [];
    this.group.traverse((object) => {
      if (!object.isMesh || Array.isArray(object.material)) return;
      const key = object.material.uuid;
      if (!buckets.has(key)) {
        buckets.set(key, {
          material: object.material,
          geometries: [],
          castShadow: object.castShadow,
          receiveShadow: object.receiveShadow,
        });
      }
      let geometry = object.geometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
      if (geometry.index) geometry = geometry.toNonIndexed();
      buckets.get(key).geometries.push(geometry);
      originals.push(object);
    });
    for (const object of originals) object.parent?.remove(object);
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
      this.group.add(mesh);
    }
  }

  setWorldTransform(position, quaternion) {
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y,
      z: position.z,
    });
    this.body.setNextKinematicRotation({
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    });
  }

  syncMesh() {
    const p = this.body.translation();
    const r = this.body.rotation();
    this.group.position.set(p.x, p.y, p.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
  }

  getHeadWorld(out = new THREE.Vector3()) {
    return out.copy(this.localHead).applyMatrix4(this.group.matrixWorld);
  }

  getEdgeWorld(out = new THREE.Vector3()) {
    return out.copy(this.localEdge).applyMatrix4(this.group.matrixWorld);
  }

  getAxisWorld(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.group.quaternion).normalize();
  }

  setDynamic(inheritedVelocity, inheritedAngularVelocity) {
    this.body.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true);
    this.body.setLinvel(
      { x: inheritedVelocity.x, y: inheritedVelocity.y, z: inheritedVelocity.z },
      true,
    );
    this.body.setAngvel(
      {
        x: inheritedAngularVelocity.x,
        y: inheritedAngularVelocity.y,
        z: inheritedAngularVelocity.z,
      },
      true,
    );
    this.body.setLinearDamping(1.2);
    this.body.setAngularDamping(2.2);
  }

  setKinematic() {
    this.body.setBodyType(this.RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.setWorldTransform(this.group.position, this.group.quaternion);
  }

  reset(position, quaternion) {
    this.setKinematic();
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.setRotation(
      { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      true,
    );
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y,
      z: position.z,
    });
    this.body.setNextKinematicRotation({
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    });
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.lastPosition.copy(position);
    this.lastQuaternion.copy(quaternion);
  }

  updateVelocity(dt) {
    if (dt <= 0) return;
    this.velocity.set(
      (this.group.position.x - this.lastPosition.x) / dt,
      (this.group.position.y - this.lastPosition.y) / dt,
      (this.group.position.z - this.lastPosition.z) / dt,
    );
    const dq = this.group.quaternion.clone().multiply(this.lastQuaternion.clone().invert());
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(dq.w, -1, 1));
    const axis = new THREE.Vector3(dq.x, dq.y, dq.z);
    if (axis.lengthSq() > 1e-8) axis.normalize();
    this.angularVelocity.copy(axis).multiplyScalar(angle / dt);
    this.lastPosition.copy(this.group.position);
    this.lastQuaternion.copy(this.group.quaternion);
  }
}
