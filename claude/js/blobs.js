// Blob shadows for the presets that draw no shadow maps (Low / Potato): a soft contact shadow under
// Sergey, one under the chopping block and a faint crown shade under every standing yard tree.
// One shared radial alpha texture on MeshBasicMaterial (the cheapest shader there is), depthWrite
// off and pulled toward the camera so they never fight the lawn, the mulch or the dirt decals.
import * as THREE from 'three';

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  // alphaMap reads the green channel, so the falloff is painted as opaque grey (a transparent
  // canvas would be un-premultiplied to white on upload and give the blob a hard edge).
  x.fillStyle = '#000';
  x.fillRect(0, 0, 64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 31);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.45, '#bfbfbf');
  g.addColorStop(0.8, '#3a3a3a');
  g.addColorStop(1, '#000');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const mat = (tex, opacity) => new THREE.MeshBasicMaterial({
  color: 0x000000, alphaMap: tex, transparent: true, opacity, depthWrite: false, fog: false,
  polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
});

export class BlobShadows {
  constructor(scene) {
    const tex = blobTexture();
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.group = new THREE.Group();
    this.group.name = 'blob-shadows';
    this.group.visible = false;
    scene.add(this.group);
    this.contactMat = mat(tex, 0.5);
    this.crownMat = mat(tex, 0.26);
    this.player = new THREE.Mesh(geo, this.contactMat);
    this.player.scale.set(0.95, 1, 0.8);
    this.player.position.y = 0.012;
    this.player.renderOrder = 2;
    this.block = new THREE.Mesh(geo, this.contactMat);
    this.block.scale.setScalar(1.25);
    this.block.position.set(0, 0.011, 0);
    this.block.renderOrder = 2;
    this.trees = new THREE.InstancedMesh(geo, this.crownMat, 64);
    this.trees.count = 0;
    this.trees.frustumCulled = false;
    this.trees.renderOrder = 2;
    this.group.add(this.player, this.block, this.trees);
    this.key = '';
    this.m4 = new THREE.Matrix4();
  }

  setEnabled(on) { this.group.visible = on; }

  // light: 0 (night / overcast, contact shadows only) .. 1 (clear sun).
  update(playerPos, playerYaw, field, light) {
    if (!this.group.visible) return;
    this.player.position.x = playerPos.x;
    this.player.position.z = playerPos.z;
    this.player.rotation.y = playerYaw;
    this.contactMat.opacity = 0.32 + 0.26 * light;
    this.crownMat.opacity = 0.08 + 0.22 * light;
    // Crown shade follows the standing trees (rebuilt only when one falls or the yard changes).
    let n = 0;
    const live = (t) => t.state === 'standing' || t.state === 'chopping';
    const key = field ? field.group.uuid + ':' + field.trees.filter(live).length : '';
    if (key === this.key) return;
    this.key = key;
    for (const t of field?.trees ?? []) {
      if (!live(t) || n >= 64) continue;
      const r = t.meta.crownRadius * t.scale * 1.15;
      this.m4.makeScale(r * 2, 1, r * 2).setPosition(t.position.x, 0.01, t.position.z);
      this.trees.setMatrixAt(n++, this.m4);
    }
    this.trees.count = n;
    this.trees.instanceMatrix.needsUpdate = true;
  }
}
