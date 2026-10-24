// Co-op partner avatar: a second, fully independent character rig (own skinned clone, skeleton,
// AnimationMixer and axe on RightHand), built with the same Sergey rig class the local player
// uses. coop/remote_player.js places `root` every frame from the interpolated network state and
// calls setAnim(clip) when the partner's animation changes; update(dt) here advances the mixer
// and matches the walk / run cycle speed to how fast the root actually moves.
import * as THREE from 'three';
import { Sergey, COSTUMES, CHARACTERS, AXE_MODELS, SWINGS } from './sergey.js';
import { patchScene } from './matpatch.js';

// Network clip names (coop/net.js ANIMS) -> rig action keys. Missing clips fall back to idle.
const CLIP_KEY = {
  Idle: 'idle', Axe_Stance: 'stance', Charged_Axe_Chop: 'chop', Heavy_Hammer_Swing: 'hammer',
  Casual_Walk: 'walk', Victory_Cheer: 'cheer', Run: 'run',
};
// Local rig action key -> network clip name (what we send in the state packet).
export const NET_CLIP = { idle: 'Idle', stance: 'Axe_Stance', chop: 'Charged_Axe_Chop', hammer: 'Heavy_Hammer_Swing', walk: 'Casual_Walk', walk2: 'Casual_Walk', run: 'Run', cheer: 'Victory_Cheer' };

export class RemoteAvatar {
  constructor(scene, { character, costume, axe, low = false }) {
    this.scene = scene;
    if (!COSTUMES[costume] || COSTUMES[costume].char !== character) costume = CHARACTERS[character]?.costumes[0] ?? 'tee';
    this.costume = costume;
    this.axe = AXE_MODELS[axe] ? axe : 'sergey';
    this.rig = new Sergey(scene, { name: 'coop-partner' });
    this.rig.setLow(low);
    this.root = this.rig.root;
    this.root.visible = false;
    this.headHeight = 1.95;
    this.yawOffset = 0;
    this.key = 'idle';
    this.speed = 0;
    this._last = null;
    this.disposed = false;
  }

  async load() {
    await this.rig.setCostume(this.costume);
    await this.rig.setAxe(this.axe, true);
    // Same shadow / weather handling as the local player's meshes.
    this.root.traverse((o) => { if (o.isMesh) o.userData.castOrig = false; });
    patchScene(this.root);
    this.rig.play('idle', { fade: 0 });
    return this;
  }

  // Called by coop/remote_player.js when the partner's state packet names another clip.
  setAnim(clip) {
    let key = CLIP_KEY[clip] ?? 'idle';
    if (!this.rig.cur?.actions[key]) key = key === 'run' && this.rig.cur?.actions.walk ? 'walk' : 'idle';
    this.key = key;
    if (key === 'chop' || key === 'hammer') {
      const S = SWINGS[key];
      this.rig.play(key, { fade: 0.12, loop: false, from: S.start, speed: key === 'chop' ? 1.55 : 1.15, restart: true });
    } else if (key === 'cheer') this.rig.play('cheer', { fade: 0.3, loop: false, from: 0.2 });
    else if (key === 'stance') this.rig.play('stance', { fade: 0.35, loop: false, from: 3.0 });
    else this.rig.play(key, { fade: 0.3 });
  }

  update(dt) {
    if (this.disposed || !this.rig.cur) return;
    // Cycle speed from the measured ground speed (the module moves the root, not us).
    const p = this.root.position;
    if (this._last && dt > 0) {
      const v = Math.hypot(p.x - this._last.x, p.z - this._last.z) / dt;
      this.speed += (Math.min(8, v) - this.speed) * Math.min(1, dt * 6);
    }
    (this._last ??= new THREE.Vector3()).copy(p);
    const a = this.rig.cur.actions[this.key];
    if (a && this.key === 'walk') a.timeScale = Math.min(1.8, Math.max(0.5, this.speed / 1.3));
    else if (a && this.key === 'run') a.timeScale = Math.min(1.5, Math.max(0.6, this.speed / 4.3));
    // A finished one-shot swing holds its last frame until the next packet; settle to idle.
    if ((this.key === 'chop' || this.key === 'hammer') && a && this.rig.clipTime >= SWINGS[this.key].end) { this.key = 'idle'; this.rig.play('idle', { fade: 0.35 }); }
    if (this.root.visible) this.rig.update(dt);
  }

  setLow(on) { this.rig.setLow(on); }

  dispose() {
    this.disposed = true;
    for (const rec of Object.values(this.rig.models)) rec.mixer.stopAllAction();
    this.root.removeFromParent();
    for (const p of Object.values(this.rig.axes)) Promise.resolve(p).then((ax) => ax?.mesh.geometry.dispose()).catch(() => {});
  }
}
